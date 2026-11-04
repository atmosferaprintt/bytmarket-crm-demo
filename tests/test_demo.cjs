'use strict';

// Run with: node --test tests/test_demo.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

function setup() {
  const storage = new Map();
  const listeners = new Map();
  let fetchCalls = 0;
  const context = vm.createContext({
    window: {},
    document: { addEventListener(type, callback) { listeners.set(type, callback); } },
    localStorage: {
      getItem(key) { return storage.has(key) ? storage.get(key) : null; },
      setItem(key, value) { storage.set(key, String(value)); },
      removeItem(key) { storage.delete(key); },
    },
    structuredClone, Intl, Date,
    fetch() { fetchCalls++; throw new Error('Demo must not use the network'); },
    refresh: async () => {},
    notify: () => {},
  });
  context.window.fetch = context.fetch;
  for (const filename of ['demo.js', 'operations.js', 'demo-controller.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../app/static', filename), 'utf8'),
      context, { filename });
  }
  const call = (expression, args) => {
    context.testArgs = args;
    return vm.runInContext(expression, context);
  };
  return {
    state: () => call("demoApi('/api/state')"),
    api: (route, data) => call('demoApi(testArgs.route, testArgs.data)', { route, data }),
    action: (action, id, payload = {}) => call(
      'window.BytDemo.handleAction(testArgs.action,testArgs.id,demoLoad(),testArgs.payload); demoSave();',
      { action, id, payload }),
    clickAction: async (action, id) => listeners.get('click')({ target: {
      closest(selector) { return selector === '[data-demo-action]'
        ? { dataset: { demoAction: action, id: String(id) } } : null; },
    } }),
    operation: (action, id, payload) => call('window.BytOperations.handleAction(testArgs.action,testArgs.id,demoLoad(),testArgs.payload); demoSave();', {action,id,payload}),
    balance: id => call('window.BytDemo.balance(demoLoad().orders.find(o=>o.id===testArgs),demoLoad())',id),
    persisted: () => JSON.parse(storage.get('bytmarket-demo-v1')),
    assertNoNetwork: () => assert.equal(fetchCalls, 0),
  };
}

function orderPayload(key, quantity = 1) {
  return { idempotency_key: key, client_id: 1,
    lines: [{ product_id: 1, quantity, unit_size: 1 }] };
}

function product(state, id) { return state.products.find(p => p.id === id); }
function order(state, id) { return state.orders.find(o => o.id === id); }
function assertReservations(state) {
  for (const p of state.products) {
    const reserved = state.orders.filter(o => o.status === 'reserved').reduce((sum, o) =>
      sum + o.lines.filter(l => l.product_id === p.id)
        .reduce((qty, l) => qty + l.quantity * l.unit_size, 0), 0);
    assert.equal(p.reserved, reserved, `Reservation mismatch for product ${p.id}`);
    assert.equal(p.available, p.stock - p.reserved);
    assert.ok(p.stock >= p.reserved && p.reserved >= 0);
  }
}

test('seed quantities agree with reserved order lines and payment ledger', () => {
  const demo = setup();
  const state = demo.state();
  assertReservations(state);
  for (const o of state.orders) {
    assert.equal(o.total, o.lines.reduce((sum, l) => sum + l.total, 0));
    assert.equal(o.paid, state.payments.filter(p => p.order_id === o.id)
      .reduce((sum, p) => sum + p.amount, 0));
  }
  demo.assertNoNetwork();
});

test('new order reserves boxes once; same key retries and conflicting payload are safe', () => {
  const demo = setup();
  const before = demo.state();
  const payload = orderPayload('boxes', 3);
  payload.lines[0].unit_size = 12;
  const created = demo.api('/api/orders', payload);
  const after = demo.state();
  assert.equal(product(after, 1).reserved - product(before, 1).reserved, 36);
  assert.equal(after.orders.length, before.orders.length + 1);
  assert.equal(created.total, product(before, 1).price * 36);
  assert.equal(demo.api('/api/orders', structuredClone(payload)).id, created.id);
  assert.deepEqual(demo.state(), after);
  const changed = structuredClone(payload);
  changed.lines[0].quantity = 2;
  assert.throws(() => demo.api('/api/orders', changed), /другим содержимым/);
  assert.deepEqual(demo.state(), after);
  assertReservations(after);
  demo.assertNoNetwork();
});

test('insufficient second line rolls back earlier reservation and leaves storage unchanged', () => {
  const demo = setup();
  demo.api('/api/orders', orderPayload('existing'));
  const before = demo.state();
  const persistedBefore = demo.persisted();
  const payload = orderPayload('rollback', 2);
  payload.lines.push({ product_id: 2, quantity: product(before, 2).available + 1, unit_size: 1 });
  assert.throws(() => demo.api('/api/orders', payload), /Недостаточно товара/);
  assert.deepEqual(demo.state(), before);
  assert.deepEqual(demo.persisted(), persistedBefore);
  payload.lines[1].quantity = 1;
  demo.api('/api/orders', payload);
  assert.equal(demo.state().orders.length, before.orders.length + 1);
  assertReservations(demo.state());
  demo.assertNoNetwork();
});

test('repeated cancellation releases only its own reserve', () => {
  const demo = setup();
  const before = demo.state();
  const first = demo.api('/api/orders', orderPayload('cancel-me', 4));
  demo.api('/api/orders', orderPayload('keep-me', 3));
  const route = `/api/orders/${first.id}/cancel`;
  demo.api(route, {});
  const cancelled = demo.state();
  assert.equal(order(cancelled, first.id).status, 'cancelled');
  assert.equal(product(cancelled, 1).reserved, product(before, 1).reserved + 3);
  demo.api(route, {});
  assert.deepEqual(demo.state(), cancelled);
  assertReservations(cancelled);
  demo.assertNoNetwork();
});

test('delivery click path deducts stock and reserve once without changing paid money', async () => {
  const demo = setup();
  const before = demo.state();
  const delivery = before.deliveries[0];
  const originalOrder = order(before, delivery.order_id);
  await demo.clickAction('advance-delivery', delivery.id);
  const shipped = demo.state();
  assert.equal(order(shipped, originalOrder.id).status, 'shipped');
  for (const p of before.products) {
    const units = originalOrder.lines.filter(l => l.product_id === p.id)
      .reduce((sum, l) => sum + l.quantity * l.unit_size, 0);
    assert.equal(product(shipped, p.id).stock, p.stock - units);
    assert.equal(product(shipped, p.id).reserved, p.reserved - units);
  }
  await demo.clickAction('advance-delivery', delivery.id);
  const delivered = demo.state();
  assert.equal(order(delivered, originalOrder.id).status, 'delivered');
  assert.deepEqual(delivered.products, shipped.products);
  assert.deepEqual(delivered.movements, shipped.movements);
  assert.equal(order(delivered, originalOrder.id).paid, originalOrder.paid);
  assert.deepEqual(delivered.payments, before.payments);
  await demo.clickAction('advance-delivery', delivery.id);
  assert.deepEqual(demo.state(), delivered);
  assertReservations(delivered);
  demo.assertNoNetwork();
});

test('refund adds one reversing payment, is repeat-safe and preserves physical goods', () => {
  const demo = setup();
  const before = demo.state();
  const originalOrder = before.orders.find(o => o.paid > 0);
  const netBefore = before.payments.reduce((sum, p) => sum + p.amount, 0);
  demo.action('refund-order', originalOrder.id);
  const refunded = demo.state();
  assert.equal(refunded.payments.length, before.payments.length + 1);
  assert.equal(refunded.payments.at(-1).amount, -originalOrder.paid);
  assert.equal(order(refunded, originalOrder.id).paid, 0);
  assert.equal(refunded.payments.filter(p => p.order_id === originalOrder.id)
    .reduce((sum, p) => sum + p.amount, 0), 0);
  assert.equal(refunded.payments.reduce((sum, p) => sum + p.amount, 0), netBefore - originalOrder.paid);
  assert.deepEqual(refunded.products, before.products);
  assert.deepEqual(refunded.deliveries, before.deliveries);
  demo.action('refund-order', originalOrder.id);
  assert.deepEqual(demo.state(), refunded);
  demo.assertNoNetwork();
});

test('demo message stays in browser state and storage without sending a request', () => {
  const demo = setup();
  const before = demo.state();
  const chat = before.chats[0];
  demo.action('send-message', chat.id, { message: '  Учебное сообщение  ' });
  const after = demo.state();
  const messages = after.chats.find(c => c.id === chat.id).messages;
  assert.equal(messages.length, chat.messages.length + 1);
  assert.equal(messages.at(-1).text, 'Учебное сообщение');
  assert.equal(messages.at(-1).direction, 'out');
  assert.equal(demo.persisted().chats.find(c => c.id === chat.id).messages.at(-1).text,
    'Учебное сообщение');
  assert.deepEqual(after.orders, before.orders);
  assert.deepEqual(after.payments, before.payments);
  assert.deepEqual(after.products, before.products);
  demo.assertNoNetwork();
});

test('merchandise return reduces amount due before payment and keeps quarantine out of stock', () => {
  const demo=setup();
  demo.action('advance-delivery',31);
  const stock=product(demo.state(),1).stock;
  demo.operation('create-return',105,{order_id:105,qty_1:12,reason:'Демо-проверка возврата'});
  assert.equal(demo.balance(105).returned,1740);
  assert.equal(demo.balance(105).due,1300);
  assert.equal(product(demo.state(),1).stock,stock);
  assert.throws(()=>demo.action('pay-order',105,{amount:3040}),/не больше остатка/);
  demo.action('pay-order',105,{amount:300});
  assert.equal(demo.balance(105).due,1000);
  demo.action('pay-order',105);
  assert.equal(order(demo.state(),105).paid,3300);
  assert.equal(demo.balance(105).due,0);
  demo.assertNoNetwork();
});
test('partial money refund clears return credit without changing stock or original totals', () => {
  const demo=setup();
  demo.action('advance-delivery',32);
  const stock=product(demo.state(),6).stock;
  demo.operation('create-return',103,{order_id:103,qty_6:2,reason:'Демо-проверка возврата'});
  assert.equal(demo.balance(103).credit,390);
  demo.action('refund-order',103,{amount:100});
  assert.equal(demo.balance(103).credit,290);
  demo.action('refund-order',103,{amount:290});
  assert.equal(demo.balance(103).credit,0);
  assert.equal(demo.balance(103).due,0);
  assert.equal(order(demo.state(),103).total,4240);
  assert.equal(product(demo.state(),6).stock,stock);
  assert.throws(()=>demo.action('refund-order',103,{amount:5000}),/не больше полученной/);
  demo.assertNoNetwork();
});
