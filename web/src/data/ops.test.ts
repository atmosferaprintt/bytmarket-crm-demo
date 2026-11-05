/* Операции: критерии приёмки §18 и правила остатков, денег, скидок и доставки. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DB, ID, Order, Product } from './types';
import { generate } from './generate';
import { OpError, applyOp, purchaseSuggestion, repeatPreview } from './ops';
import type { OpType } from './ops';
import { checkInvariants } from './invariants';
import { stockRow } from './idx';
import {
  accountBalances,
  clientBalance,
  courierCash,
  orderPayment,
  priceFor,
  salesForPeriod,
  shiftSummary,
  stockIndex,
  stockOf,
} from './selectors';
import { SUGGEST_SAFETY_DAYS, isBelowMin } from './thresholds';

let base: DB;
beforeAll(() => {
  base = generate();
});

const T = '2026-11-05';
const OWNER = 'e-volkov';
const MANAGER = 'e-sokolov';
const SELLER = 'e-orlova';
const WAREHOUSE = 'e-krylov';
const ACCOUNTANT = 'e-belova';
const DISPATCHER = 'e-lebedeva';

/** Сообщения используют неразрывные пробелы (как в интерфейсе) — для проверки заменяем на обычные. */
function errorOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    if (e instanceof OpError) return e.message.replace(/[\u00A0\u202F]/g, ' ');
    throw e;
  }
  throw new Error('Ожидалась ошибка операции');
}

/** Свежая копия базы для теста и счётчик времени операций (после 14:00, по возрастанию). */
function fresh(): { db: DB; op: (type: OpType, payload: unknown, actor: ID) => { id?: ID; info?: string } } {
  const db = structuredClone(base);
  let minute = 14 * 60 + 5;
  const op = (type: OpType, payload: unknown, actor: ID): { id?: ID; info?: string } => {
    const m = minute++;
    const at = `${T}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return applyOp(db, type, payload, { actorId: actor, at });
  };
  return { db, op };
}

/** Новый оптовый клиент без истории: без долга, без минимальной суммы. */
function newClient(op: ReturnType<typeof fresh>['op'], over: Record<string, unknown> = {}): ID {
  return op(
    'client.create',
    {
      name: 'ИП Тестова · «Проверка»',
      kind: 'ip',
      segment: 'shop',
      phone: '+79170000000',
      points: [{ name: '«Проверка» на Кирова', address: 'ул. Кирова, 1', district: 'Кировский район', lat: 46.349, lng: 48.036 }],
      contacts: [{ name: 'Анна Тестова', role: 'Владелец', phone: '+79170000001' }],
      ownerId: MANAGER,
      deferDays: 0,
      creditLimit: 0,
      minOrder: 0,
      ...over,
    },
    MANAGER,
  ).id!;
}

function productWhere(db: DB, f: (p: Product) => boolean): Product {
  const p = db.products.find((x) => x.active && f(x));
  if (!p) throw new Error('Нет подходящего товара для теста');
  return p;
}

const wh = (db: DB, pid: ID): { onHand: number; reserved: number } => {
  const r = stockRow(db, pid, 'warehouse');
  return { onHand: r?.onHand ?? 0, reserved: r?.reserved ?? 0 };
};

function shipAll(op: ReturnType<typeof fresh>['op'], orderId: ID): void {
  op('order.pick', { orderId, stage: 'picking' }, WAREHOUSE);
  op('order.pick', { orderId, stage: 'picked' }, WAREHOUSE);
  op('order.ship', { orderId }, WAREHOUSE);
}

const orderOf = (db: DB, id: ID): Order => db.orders.find((o) => o.id === id)!;

describe('§18: продажа коробок пересчитывается в штуки', () => {
  it('3 коробки по 12 = 36 шт в резерве и в списании', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => x.packs.some((k) => k.key === 'box' && k.qty === 12) && stockOf(db, x.id).warehouse.available >= 36);
    const client = newClient(op);
    const before = wh(db, p.id);
    const id = op('order.create', { clientId: client, lines: [{ productId: p.id, pack: 'box', packQty: 3 }], state: 'confirmed' }, MANAGER).id!;
    const o = orderOf(db, id);
    expect(o.lines[0]).toMatchObject({ pack: 'box', packSize: 12, packQty: 3, qty: 36 });
    expect(wh(db, p.id)).toEqual({ onHand: before.onHand, reserved: before.reserved + 36 });
    shipAll(op, id);
    expect(wh(db, p.id)).toEqual({ onHand: before.onHand - 36, reserved: before.reserved });
    const ship = db.movements.filter((m) => m.docId === id && m.kind === 'ship');
    expect(ship.map((m) => [m.dOnHand, m.dReserved])).toEqual([[-36, -36]]);
    expect(o.state).toBe('closed');
    expect(o.dueDate).toBe(T);
    expect(checkInvariants(db)).toEqual([]);
  });

  it('на кассе 3 коробки по 12 списывают 36 шт из магазина', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => x.packs.some((k) => k.key === 'box' && k.qty === 12) && stockOf(db, x.id).warehouse.available >= 40);
    op('stock.transfer', { from: 'warehouse', to: 'shop', lines: [{ productId: p.id, qty: 36 }] }, WAREHOUSE);
    const shop0 = stockRow(db, p.id, 'shop')!.onHand;
    const id = op('receipt.checkout', { lines: [{ productId: p.id, pack: 'box', packQty: 3 }], card: 36 * priceFor(db, p.id, { priceType: 'retail', date: T }).price }, SELLER).id!;
    expect(db.receipts.find((r) => r.id === id)!.lines[0].qty).toBe(36);
    expect(stockRow(db, p.id, 'shop')!.onHand).toBe(shop0 - 36);
  });
});

describe('§18: два заказа не берут последнюю единицу', () => {
  it('второй заказ получает ошибку с цифрами и ничего не меняет', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 2);
    const a = stockOf(db, p.id).warehouse.available;
    const c1 = newClient(op);
    const c2 = newClient(op, { name: 'ИП Второва · «Сосед»', inn: null });
    op('order.create', { clientId: c1, lines: [{ productId: p.id, pack: 'pcs', packQty: a }], state: 'confirmed' }, MANAGER);
    expect(stockOf(db, p.id).warehouse.available).toBe(0);
    const orders = db.orders.length;
    const counter = db.counters.order;
    const movements = db.movements.length;
    expect(errorOf(() => op('order.create', { clientId: c2, lines: [{ productId: p.id, pack: 'pcs', packQty: 1 }], state: 'confirmed' }, 'e-petrova'))).toMatch(
      /на складе доступно 0 шт, а в заказе 1 шт/,
    );
    expect(db.orders.length).toBe(orders);
    expect(db.counters.order).toBe(counter);
    expect(db.movements.length).toBe(movements);
    // заявка без резерва создаётся, но подтвердить её нельзя
    const req = op('order.create', { clientId: c2, lines: [{ productId: p.id, pack: 'pcs', packQty: 1 }], state: 'request' }, 'e-petrova').id!;
    expect(() => op('order.confirm', { orderId: req }, 'e-petrova')).toThrow(OpError);
    expect(orderOf(db, req).state).toBe('request');
    expect(checkInvariants(db)).toEqual([]);
  });

  it('продать в магазине больше доступного нельзя', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => (stockRow(db, x.id, 'shop')?.onHand ?? 0) > 0);
    const a = stockRow(db, p.id, 'shop')!.onHand;
    expect(() => op('receipt.checkout', { lines: [{ productId: p.id, packQty: a + 1 }], cash: 100000 }, SELLER)).toThrow(/в магазине доступно/);
  });
});

describe('§18: повторная отправка не создаёт второй заказ и платёж', () => {
  it('order.create, payment.client и receipt.checkout с тем же ключом', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 10);
    const client = newClient(op);
    const payload = { clientId: client, lines: [{ productId: p.id, packQty: 2 }], state: 'confirmed', idempotencyKey: 'order-key-1' };
    const n0 = db.orders.length;
    const r1 = op('order.create', payload, MANAGER);
    const r2 = op('order.create', payload, MANAGER);
    expect(r2.id).toBe(r1.id);
    expect(db.orders.length).toBe(n0 + 1);
    expect(wh(db, p.id).reserved).toBe(wh(base, p.id).reserved + 2);

    const pay = { clientId: client, amount: 500, method: 'cash', idempotencyKey: 'pay-key-1' };
    const m0 = db.payments.length;
    const q1 = op('payment.client', pay, MANAGER);
    const q2 = op('payment.client', pay, MANAGER);
    expect(q2.id).toBe(q1.id);
    expect(db.payments.length).toBe(m0 + 1);

    const sp = productWhere(db, (x) => (stockRow(db, x.id, 'shop')?.onHand ?? 0) >= 2);
    const rc = { lines: [{ productId: sp.id, packQty: 1 }], cash: 100000, idempotencyKey: 'rc-1' };
    const k0 = db.receipts.length;
    expect(op('receipt.checkout', rc, SELLER).id).toBe(op('receipt.checkout', rc, SELLER).id);
    expect(db.receipts.length).toBe(k0 + 1);
  });
});

describe('§18: частичная оплата оставляет правильный долг; скриншот не гасит долг', () => {
  it('частичная оплата и подтверждение банка', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 10 && x.wholesalePrice > 100);
    const client = newClient(op, { deferDays: 14, creditLimit: 100000 });
    const id = op('order.create', { clientId: client, lines: [{ productId: p.id, packQty: 10 }], state: 'confirmed' }, MANAGER).id!;
    shipAll(op, id);
    const o = orderOf(db, id);
    expect(clientBalance(db, client).debt).toBe(o.total);
    op('payment.client', { clientId: client, amount: 1000, method: 'transfer' }, ACCOUNTANT);
    let pay = orderPayment(db, o);
    expect(pay).toMatchObject({ paid: 1000, due: o.total - 1000, debt: o.total - 1000, state: 'partial' });
    expect(clientBalance(db, client).debt).toBe(o.total - 1000);
    // скриншот перевода: долг не меняется, пока банк не подтвердил
    const pid = op('payment.client', { clientId: client, amount: o.total - 1000, method: 'transfer', status: 'pending' }, MANAGER).id!;
    pay = orderPayment(db, o);
    expect(pay.paid).toBe(1000);
    expect(pay.pending).toBe(o.total - 1000);
    expect(clientBalance(db, client).debt).toBe(o.total - 1000);
    expect(accountBalances(db).bank).toBe(accountBalances(base).bank + 1000);
    op('payment.confirm', { paymentId: pid }, ACCOUNTANT);
    expect(orderPayment(db, o)).toMatchObject({ paid: o.total, debt: 0, state: 'paid' });
    expect(clientBalance(db, client).debt).toBe(0);
  });

  it('одна оплата на несколько заказов и аванс', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 10);
    const client = newClient(op, { deferDays: 7, creditLimit: 200000 });
    const a = op('order.create', { clientId: client, lines: [{ productId: p.id, packQty: 3 }], state: 'confirmed' }, MANAGER).id!;
    const b = op('order.create', { clientId: client, lines: [{ productId: p.id, packQty: 2 }], state: 'confirmed' }, MANAGER).id!;
    shipAll(op, a);
    shipAll(op, b);
    const total = orderOf(db, a).total + orderOf(db, b).total;
    const pid = op('payment.client', { clientId: client, amount: total + 700, method: 'cash' }, MANAGER).id!;
    const payment = db.payments.find((x) => x.id === pid)!;
    expect(payment.allocations.map((x) => x.orderId)).toEqual([a, b]);
    expect(clientBalance(db, client)).toMatchObject({ debt: 0, advance: 700 });
  });
});

describe('§18: отмена освобождает резерв', () => {
  it('отмена подтверждённого снимает резерв, отгруженный отменить нельзя', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 20);
    const client = newClient(op);
    const before = wh(db, p.id);
    const id = op('order.create', { clientId: client, lines: [{ productId: p.id, packQty: 5 }], state: 'confirmed', fulfillment: 'delivery' }, MANAGER).id!;
    op('delivery.create', { orderId: id, date: '2026-11-06', interval: '10:00–13:00' }, MANAGER);
    expect(wh(db, p.id).reserved).toBe(before.reserved + 5);
    const deliveries = db.deliveries.length;
    op('order.cancel', { orderId: id, reason: 'Клиент передумал' }, MANAGER);
    expect(wh(db, p.id)).toEqual(before);
    expect(orderOf(db, id).state).toBe('cancelled');
    expect(db.deliveries.length).toBe(deliveries - 1);
    expect(db.movements.some((m) => m.docId === id && m.kind === 'unreserve' && m.dReserved === -5)).toBe(true);
    const id2 = op('order.create', { clientId: client, lines: [{ productId: p.id, packQty: 1 }], state: 'confirmed' }, MANAGER).id!;
    shipAll(op, id2);
    expect(() => op('order.cancel', { orderId: id2 }, MANAGER)).toThrow(/оформите возврат/);
    expect(checkInvariants(db)).toEqual([]);
  });

  it('частичная отгрузка: остаток можно отменить, резерв снимается', () => {
    const { db, op } = fresh();
    const [p1, p2] = db.products.filter((x) => x.active && stockOf(db, x.id).warehouse.available >= 10).slice(0, 2);
    const client = newClient(op);
    const id = op('order.create', { clientId: client, lines: [{ productId: p1.id, packQty: 4 }, { productId: p2.id, packQty: 6 }], state: 'confirmed' }, MANAGER).id!;
    op('order.pick', { orderId: id }, WAREHOUSE);
    op('order.pick', { orderId: id }, WAREHOUSE);
    op('order.ship', { orderId: id, lines: [{ productId: p1.id, qty: 4 }, { productId: p2.id, qty: 2 }] }, WAREHOUSE);
    expect(orderOf(db, id).ship).toBe('partial');
    expect(wh(db, p2.id).reserved).toBe(wh(base, p2.id).reserved + 4);
    op('order.cancel', { orderId: id, reason: 'Остаток не нужен' }, MANAGER);
    expect(orderOf(db, id)).toMatchObject({ state: 'closed', ship: 'shipped' });
    expect(wh(db, p2.id).reserved).toBe(wh(base, p2.id).reserved);
    expect(orderPayment(db, orderOf(db, id)).amount).toBe(4 * orderOf(db, id).lines[0].price + 2 * orderOf(db, id).lines[1].price);
    expect(checkInvariants(db)).toEqual([]);
  });
});

describe('§18: частичный возврат меняет остаток (в карантин), деньги и выручку', () => {
  it('возврат по чеку', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => (stockRow(db, x.id, 'shop')?.onHand ?? 0) >= 3 && x.retailPrice > 100);
    const shift = db.shifts.find((s) => !s.closedAt)!;
    const price = priceFor(db, p.id, { priceType: 'retail', date: T }).price;
    const rid = op('receipt.checkout', { lines: [{ productId: p.id, packQty: 3 }], cash: 3 * price }, SELLER).id!;
    const shop = stockRow(db, p.id, 'shop')!.onHand;
    const cash = shiftSummary(db, shift.id).expectedCash;
    const sales = salesForPeriod(db, T, T);
    const q0 = stockOf(db, p.id).quarantine;
    op('receipt.refund', { receiptId: rid, lines: [{ productId: p.id, qty: 1, reason: 'not_fit' }] }, SELLER);
    expect(stockRow(db, p.id, 'shop')!.onHand).toBe(shop); // в продажу не вернулся
    expect(stockOf(db, p.id).quarantine).toBe(q0 + 1);
    expect(db.quarantine[db.quarantine.length - 1]).toMatchObject({ productId: p.id, qty: 1, state: 'check', location: 'shop', source: 'return' });
    expect(shiftSummary(db, shift.id).expectedCash).toBe(cash - price);
    const after = salesForPeriod(db, T, T);
    expect(after.retail).toBe(sales.retail - price);
    expect(after.returns).toBe(sales.returns + price);
    expect(errorOf(() => op('receipt.refund', { receiptId: rid, lines: [{ productId: p.id, qty: 3 }] }, SELLER))).toMatch(/можно вернуть 2 шт/);
    // после проверки — «Не подошёл» возвращается в продажу
    const item = db.quarantine[db.quarantine.length - 1];
    op('quarantine.release', { itemId: item.id }, WAREHOUSE);
    expect(stockRow(db, p.id, 'shop')!.onHand).toBe(shop + 1);
    // брак в продажу не возвращают — только списание
    op('receipt.refund', { receiptId: rid, lines: [{ productId: p.id, qty: 1, reason: 'defect' }] }, SELLER);
    const bad = db.quarantine[db.quarantine.length - 1];
    expect(bad.reason).toBe('Брак');
    expect(errorOf(() => op('quarantine.release', { itemId: bad.id }, WAREHOUSE))).toMatch(/только списание/);
    op('quarantine.writeoff', { itemId: bad.id }, WAREHOUSE);
    expect(bad.state).toBe('written_off');
    expect(stockRow(db, p.id, 'shop')!.onHand).toBe(shop + 1);
    expect(checkInvariants(db)).toEqual([]);
  });

  it('возврат по заказу: не больше отгруженного, долг и выручка уменьшаются, при оплате — деньги или аванс', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 10 && x.wholesalePrice > 50);
    const client = newClient(op, { deferDays: 14, creditLimit: 100000 });
    const id = op('order.create', { clientId: client, lines: [{ productId: p.id, packQty: 6 }], state: 'confirmed' }, MANAGER).id!;
    shipAll(op, id);
    const o = orderOf(db, id);
    const price = o.lines[0].price;
    const sales = salesForPeriod(db, T, T);
    const before = wh(db, p.id).onHand;
    expect(errorOf(() => op('return.create', { orderId: id, lines: [{ productId: p.id, qty: 7, reason: 'defect' }] }, WAREHOUSE))).toMatch(/отгружено и не возвращено 6 шт/);
    op('return.create', { orderId: id, lines: [{ productId: p.id, qty: 2, reason: 'defect' }] }, WAREHOUSE);
    expect(wh(db, p.id).onHand).toBe(before);
    expect(stockOf(db, p.id).quarantine).toBe(stockOf(base, p.id).quarantine + 2);
    expect(clientBalance(db, client).debt).toBe(o.total - 2 * price);
    expect(salesForPeriod(db, T, T).wholesale).toBe(sales.wholesale - 2 * price);
    // оплатил всё, потом вернул ещё — по флагу деньги возвращаются
    op('payment.client', { clientId: client, amount: o.total - 2 * price, method: 'transfer' }, ACCOUNTANT);
    const bank = accountBalances(db).bank;
    const rid = op('return.create', { orderId: id, lines: [{ productId: p.id, qty: 1, reason: 'not_fit' }], refund: true }, MANAGER).id!;
    expect(accountBalances(db).bank).toBe(bank - price);
    expect(db.returns.find((r) => r.id === rid)!.refundPaymentId).toBeTruthy();
    expect(orderPayment(db, o)).toMatchObject({ debt: 0, state: 'paid' });
    // без флага — переплата остаётся авансом
    op('return.create', { orderId: id, lines: [{ productId: p.id, qty: 1, reason: 'not_fit' }] }, WAREHOUSE);
    expect(clientBalance(db, client).advance).toBe(price);
    expect(checkInvariants(db)).toEqual([]);
  });
});

describe('§18: повтор заказа видит новую цену и нехватку', () => {
  it('repeatPreview показывает «было → стало» и не меняет базу', () => {
    const { db, op } = fresh();
    const [p1, p2] = db.products.filter((x) => x.active && stockOf(db, x.id).warehouse.available >= 12 && !priceFor(db, x.id, { priceType: 'wholesale', date: T }).promo).slice(0, 2);
    const client = newClient(op);
    const id = op('order.create', { clientId: client, lines: [{ productId: p1.id, packQty: 2 }, { productId: p2.id, packQty: 3 }], state: 'confirmed' }, MANAGER).id!;
    shipAll(op, id);
    const oldPrice = orderOf(db, id).lines[0].price;
    op('price.set', { productId: p1.id, retailPrice: p1.retailPrice + 20, wholesalePrice: p1.wholesalePrice + 15 }, OWNER);
    // кто-то другой забрал почти весь p2
    const other = newClient(op, { name: 'ИП Другая · «Конкурент»' });
    const free = stockOf(db, p2.id).warehouse.available;
    op('order.create', { clientId: other, lines: [{ productId: p2.id, packQty: free - 1 }], state: 'confirmed' }, MANAGER);
    const snapshot = JSON.stringify(db.orders) + db.movements.length;
    const pv = repeatPreview(db, id, T + 'T15:00');
    expect(JSON.stringify(db.orders) + db.movements.length).toBe(snapshot);
    const l1 = pv.lines.find((l) => l.productId === p1.id)!;
    const l2 = pv.lines.find((l) => l.productId === p2.id)!;
    expect(l1.price).toBe(oldPrice + 15);
    expect(l1.changes.join()).toContain('стала');
    expect(l2.status).toBe('short');
    expect(l2.qty).toBe(1);
    expect(pv.changes.length).toBeGreaterThanOrEqual(2);
    // история заказа не изменилась
    expect(orderOf(db, id).lines[0].price).toBe(oldPrice);
    expect(db.priceChanges[db.priceChanges.length - 1]).toMatchObject({ productId: p1.id, wholesaleTo: p1.wholesalePrice });
    const nid = op('order.create', { clientId: client, lines: pv.payloadLines, source: 'repeat', state: 'confirmed' }, MANAGER).id!;
    expect(orderOf(db, nid).lines.find((l) => l.productId === p1.id)!.price).toBe(oldPrice + 15);
  });
});

describe('§18: курьер видит только свои доставки', () => {
  it('у доставки один курьер, чужую нельзя начать, деньги курьера сдаются в кассу', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 10 && x.wholesalePrice * 10 >= 5000);
    const client = newClient(op);
    const id = op('order.create', { clientId: client, lines: [{ productId: p.id, packQty: 10 }], state: 'confirmed' }, MANAGER).id!;
    op('order.pick', { orderId: id }, WAREHOUSE);
    op('order.pick', { orderId: id }, WAREHOUSE);
    const did = op('delivery.create', { orderId: id, date: T, interval: '15:00–18:00' }, MANAGER).id!;
    const d = db.deliveries.find((x) => x.id === did)!;
    expect(d.state).toBe('waiting');
    expect(d.collect).toBe(orderOf(db, id).total);
    op('delivery.assign', { deliveryId: did, courierId: 'e-morozov' }, DISPATCHER);
    expect(d.courierId).toBe('e-morozov');
    expect(() => op('delivery.start', { deliveryId: did }, 'e-zaytsev')).toThrow(/другого курьера/);
    op('delivery.start', { deliveryId: did }, 'e-morozov');
    expect(orderOf(db, id).state).toBe('closed');
    const cash0 = courierCash(db, 'e-morozov').onHand;
    op('delivery.deliver', { deliveryId: did, collected: d.collect - 500, method: 'cash' }, 'e-morozov');
    // доставлено — не значит оплачено
    expect(orderOf(db, id).ship).toBe('delivered');
    expect(orderPayment(db, orderOf(db, id))).toMatchObject({ debt: 500, state: 'partial' });
    expect(courierCash(db, 'e-morozov').onHand).toBe(cash0 + d.collect - 500);
    const shop = accountBalances(db).shop_cash;
    op('courier.handIn', { courierId: 'e-morozov' }, 'e-morozov');
    expect(courierCash(db, 'e-morozov').onHand).toBe(0);
    expect(accountBalances(db).shop_cash).toBe(shop + cash0 + d.collect - 500);
    expect(checkInvariants(db)).toEqual([]);
  });

  it('неудачная доставка и возврат на склад: товар в карантин, отгрузка откатывается', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 10);
    const client = newClient(op);
    const id = op('order.create', { clientId: client, lines: [{ productId: p.id, packQty: 4 }], state: 'confirmed' }, MANAGER).id!;
    op('order.pick', { orderId: id }, WAREHOUSE);
    op('order.pick', { orderId: id }, WAREHOUSE);
    const did = op('delivery.create', { orderId: id, date: T, courierId: 'e-vlasov' }, DISPATCHER).id!;
    op('delivery.start', { deliveryId: did }, 'e-vlasov');
    const sales = salesForPeriod(db, T, T).wholesale;
    expect(() => op('delivery.fail', { deliveryId: did, reason: '' }, 'e-vlasov')).toThrow(/Причина/);
    op('delivery.fail', { deliveryId: did, reason: 'Отказ от товара' }, 'e-vlasov');
    op('delivery.returnToStock', { deliveryId: did }, DISPATCHER);
    const o = orderOf(db, id);
    expect(o).toMatchObject({ state: 'cancelled', ship: 'none' });
    expect(o.lines[0].shipped).toBe(0);
    expect(db.quarantine.filter((q) => q.sourceId === did).reduce((s, q) => s + q.qty, 0)).toBe(4);
    expect(salesForPeriod(db, T, T).wholesale).toBe(sales - o.total);
    expect(clientBalance(db, client).debt).toBe(0);
    expect(checkInvariants(db)).toEqual([]);
  });
});

describe('неудачная доставка и маршрут', () => {
  it('пока доставка «Неудачная попытка», просрочки по заказу нет, долг остаётся', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 10);
    const client = newClient(op, { deferDays: 7, creditLimit: 100000 });
    const id = op('order.create', { clientId: client, lines: [{ productId: p.id, packQty: 4 }], state: 'confirmed' }, MANAGER).id!;
    op('order.pick', { orderId: id }, WAREHOUSE);
    op('order.pick', { orderId: id }, WAREHOUSE);
    const did = op('delivery.create', { orderId: id, date: T, courierId: 'e-vlasov' }, DISPATCHER).id!;
    op('delivery.start', { deliveryId: did }, 'e-vlasov');
    const o = orderOf(db, id);
    o.dueDate = '2026-10-30'; // как будто срок оплаты уже прошёл
    db.meta.version++;
    expect(orderPayment(db, o).overdueDays).toBe(6);
    op('delivery.fail', { deliveryId: did, reason: 'Клиента нет на месте' }, 'e-vlasov');
    expect(orderPayment(db, o)).toMatchObject({ overdueDays: 0, debt: o.total });
    expect(clientBalance(db, client)).toMatchObject({ overdue: 0, debt: o.total });
  });

  it('назначение без порядка ставит доставку в маршрут по началу интервала', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 30);
    const client = newClient(op);
    const D = '2026-11-07';
    const ids = ['15:00–18:00', '09:00–12:00', '12:00–15:00'].map((interval) => {
      const id = op('order.create', { clientId: client, lines: [{ productId: p.id, packQty: 2 }], state: 'confirmed' }, MANAGER).id!;
      return op('delivery.create', { orderId: id, date: D, interval }, MANAGER).id!;
    });
    for (const did of ids) op('delivery.assign', { deliveryId: did, courierId: 'e-zaytsev' }, DISPATCHER);
    const route = db.deliveries.filter((d) => d.courierId === 'e-zaytsev' && d.date === D).sort((a, b) => a.routeOrder - b.routeOrder);
    expect(route.map((d) => d.interval)).toEqual(['09:00–12:00', '12:00–15:00', '15:00–18:00']);
    expect(route.map((d) => d.routeOrder)).toEqual([1, 2, 3]);
  });
});

describe('лимит, просрочка и подтверждение владельцем', () => {
  it('при просрочке подтвердить нельзя; владелец с override — можно, с записью в истории', () => {
    const { db, op } = fresh();
    const c = db.clients.find((x) => clientBalance(db, x.id).overdue > 0)!;
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 5);
    const id = op('order.create', { clientId: c.id, lines: [{ productId: p.id, packQty: 1 }], state: 'request' }, MANAGER).id!;
    expect(() => op('order.confirm', { orderId: id }, MANAGER)).toThrow(/просрочка/);
    expect(() => op('order.confirm', { orderId: id, override: true }, MANAGER)).toThrow(/только владелец/);
    op('order.confirm', { orderId: id, override: true }, OWNER);
    expect(orderOf(db, id).state).toBe('confirmed');
    expect(orderOf(db, id).history.some((h) => h.text.startsWith('Подтверждено владельцем сверх лимита'))).toBe(true);
  });

  it('превышение кредитного лимита', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 30 && x.wholesalePrice >= 150);
    const client = newClient(op, { deferDays: 14, creditLimit: 2000 });
    expect(() => op('order.create', { clientId: client, lines: [{ productId: p.id, packQty: 20 }], state: 'confirmed' }, MANAGER)).toThrow(/больше лимита/);
    op('order.create', { clientId: client, lines: [{ productId: p.id, packQty: 20 }], state: 'confirmed', override: true }, OWNER);
  });

  it('представитель создаёт только заявку без резерва', () => {
    const { db, op } = fresh();
    const c = db.clients.find((x) => x.ownerId === 'e-mironova' && clientBalance(db, x.id).overdue === 0)!;
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 5);
    const before = wh(db, p.id);
    const id = op('order.create', { clientId: c.id, lines: [{ productId: p.id, packQty: 2 }] }, 'e-mironova').id!;
    expect(orderOf(db, id).state).toBe('request');
    expect(wh(db, p.id)).toEqual(before);
    expect(() => op('order.confirm', { orderId: id }, 'e-mironova')).toThrow(/недоступно/);
    expect(() => op('order.create', { clientId: c.id, lines: [{ productId: p.id, packQty: 1 }], state: 'confirmed' }, 'e-mironova')).toThrow(/подтверждает менеджер/);
  });
});

describe('скидки и наценка', () => {
  it('лимит скидки роли, основание, сочетание с акцией, минимальная наценка', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => (stockRow(db, x.id, 'shop')?.onHand ?? 0) >= 2 && !priceFor(db, x.id, { priceType: 'retail', date: T }).promo && x.cost !== null);
    expect(() => op('receipt.checkout', { lines: [{ productId: p.id, packQty: 1, discountPct: 8, discountReason: 'Постоянный покупатель' }], cash: 100000 }, SELLER)).toThrow(/больше лимита роли «Продавец»/);
    expect(() => op('receipt.checkout', { lines: [{ productId: p.id, packQty: 1, discountPct: 5 }], cash: 100000 }, SELLER)).toThrow(/основание скидки/);
    const rid = op('receipt.checkout', { lines: [{ productId: p.id, packQty: 1, discountPct: 5, discountReason: 'Мятая коробка' }], cash: 100000 }, SELLER).id!;
    const line = db.receipts.find((r) => r.id === rid)!.lines[0];
    expect(line.price).toBe(Math.round((p.retailPrice * 95) / 100));
    expect(line.discountReason).toBe('Мятая коробка');
    // акция Fairy 169 ₽ + ручная скидка выше лимита продавца
    const fairy = db.products.find((x) => x.active && x.name.startsWith('Fairy') && x.volume === '450 мл' && priceFor(db, x.id, { priceType: 'retail', date: T }).promo && (stockRow(db, x.id, 'shop')?.onHand ?? 0) > 0);
    if (fairy) {
      expect(priceFor(db, fairy.id, { priceType: 'retail', date: T }).price).toBe(169);
      expect(() => op('receipt.checkout', { lines: [{ productId: fairy.id, packQty: 1, discountPct: 3, discountReason: 'Постоянный покупатель' }], cash: 1000 }, SELLER)).toThrow(/вместе с акцией/);
    }
    // наценка: менеджер со скидкой 10 % на товар с высокой себестоимостью
    const thin = productWhere(
      db,
      (x) => x.cost !== null && x.wholesalePrice * 0.9 < x.cost * 1.12 && stockOf(db, x.id).warehouse.available >= 2 && !priceFor(db, x.id, { priceType: 'wholesale', date: T }).promo,
    );
    const client = newClient(op);
    expect(() => op('order.create', { clientId: client, lines: [{ productId: thin.id, packQty: 1, discountPct: 10, discountReason: 'Договорились' }], state: 'confirmed' }, MANAGER)).toThrow(/Цена ниже минимальной наценки/);
    const r = op('order.create', { clientId: client, lines: [{ productId: thin.id, packQty: 1, discountPct: 10, discountReason: 'Решение владельца' }], state: 'confirmed' }, OWNER);
    expect(r.info).toContain('ниже минимальной наценки');
  });
});

describe('склад и закупки', () => {
  it('пересчёт: разница — движением; факт меньше резерва — предупреждение, резерв не трогаем', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 6);
    const client = newClient(op);
    op('order.create', { clientId: client, lines: [{ productId: p.id, packQty: 5 }], state: 'confirmed' }, MANAGER);
    const r = wh(db, p.id);
    const res = op('stock.count', { location: 'warehouse', lines: [{ productId: p.id, qty: r.reserved - 1 }] }, WAREHOUSE);
    expect(res.info).toContain('меньше резерва');
    expect(wh(db, p.id)).toEqual({ onHand: r.reserved - 1, reserved: r.reserved });
    expect(checkInvariants(db, { allowReserveOverOnHand: true })).toEqual([]);
  });

  it('списание по причине только свободного товара; перемещение не меняет общий остаток', () => {
    const { db, op } = fresh();
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 10);
    const total = stockOf(db, p.id).total.onHand;
    op('stock.transfer', { from: 'warehouse', to: 'shop', lines: [{ productId: p.id, qty: 4 }] }, WAREHOUSE);
    expect(stockOf(db, p.id).total.onHand).toBe(total);
    expect(() => op('stock.writeoff', { location: 'shop', lines: [{ productId: p.id, qty: 1 }] }, WAREHOUSE)).toThrow(/причину/);
    op('stock.writeoff', { location: 'shop', lines: [{ productId: p.id, qty: 1, reason: 'damage' }] }, WAREHOUSE);
    expect(stockOf(db, p.id).total.onHand).toBe(total - 1);
    expect(() => op('stock.writeoff', { location: 'warehouse', lines: [{ productId: p.id, qty: 1, reason: 'leak' }] }, SELLER)).toThrow(/недоступно/);
  });

  it('приёмка: частичная оставляет ожидаемое, повтор не дублирует движения, брак — в карантин', () => {
    const { db, op } = fresh();
    const s = db.suppliers[0];
    const [p1, p2] = db.products.filter((x) => x.active && x.supplierIds.includes(s.id)).slice(0, 2);
    const id = op('purchase.create', { supplierId: s.id, lines: [{ productId: p1.id, boxes: 2 }, { productId: p2.id, boxes: 1 }] }, WAREHOUSE).id!;
    const pu = db.purchases.find((x) => x.id === id)!;
    expect(pu.lines[0].qty).toBe(2 * pu.lines[0].boxSize);
    expect(() => op('purchase.approve', { purchaseId: id }, WAREHOUSE)).toThrow(/только владелец/);
    op('purchase.approve', { purchaseId: id }, OWNER);
    const exp1 = stockOf(db, p1.id).expected;
    const mv = db.movements.length;
    op('purchase.receive', { purchaseId: id, lines: [{ productId: p1.id, received: pu.lines[0].qty, defect: 2, diffReason: 'Бой при перевозке' }] }, WAREHOUSE);
    expect(pu.state).toBe('partial');
    expect(db.movements.length).toBe(mv + 1);
    expect(stockOf(db, p1.id).expected).toBe(exp1 - pu.lines[0].qty);
    expect(stockOf(db, p2.id).expected).toBeGreaterThanOrEqual(pu.lines[1].qty);
    expect(db.quarantine.some((q) => q.sourceId === id && q.qty === 2 && q.source === 'purchase_defect')).toBe(true);
    // та же приёмка ещё раз — без новых движений
    op('purchase.receive', { purchaseId: id, lines: [{ productId: p1.id, received: pu.lines[0].qty, defect: 2 }] }, WAREHOUSE);
    expect(db.movements.length).toBe(mv + 1);
    expect(() => op('purchase.receive', { purchaseId: id, lines: [{ productId: p2.id, received: pu.lines[1].qty - 1 }], final: true }, WAREHOUSE)).toThrow(/причину расхождения/);
    op('purchase.receive', { purchaseId: id, lines: [{ productId: p2.id, received: pu.lines[1].qty - 1, diffReason: 'Недовоз' }], final: true }, WAREHOUSE);
    expect(pu.state).toBe('received');
    expect(pu.dueDate).toBeTruthy();
    expect(checkInvariants(db)).toEqual([]);
  });

  it('предложение на закупку: только то, что кончится до поставки + запас или ниже минимума; короткое «почему»', () => {
    const sug = purchaseSuggestion(base);
    expect(sug.length).toBeGreaterThan(0);
    const si = stockIndex(base);
    for (const s of sug) {
      const p = base.products.find((x) => x.id === s.productId)!;
      const below = isBelowMin(s.available, p.minStock);
      expect(['Кончится раньше поставки', 'Кончится вскоре после поставки', 'Ниже минимума', 'Под оптовый заказ']).toContain(s.reason);
      if (!below) {
        expect(s.perDay).toBeGreaterThan(0); // без продаж за 30 дней — только если ниже минимума
        expect((s.available + s.expected) / s.perDay).toBeLessThanOrEqual(s.leadDays + SUGGEST_SAFETY_DAYS);
      }
      if (s.reason === 'Под оптовый заказ') expect(si.get(p.id)!.total.reserved).toBeGreaterThan(0);
      expect(s.qty % s.boxSize).toBe(0);
      expect(s.qty).toBe(s.boxes * s.boxSize);
    }
    expect(sug.some((s) => s.reason === 'Кончится раньше поставки' || s.reason === 'Кончится вскоре после поставки')).toBe(true);
    expect(sug.some((s) => s.reason === 'Ниже минимума')).toBe(true);
  });
});

describe('ошибка не меняет базу', () => {
  it('после OpError база та же', () => {
    const { db, op } = fresh();
    const before = JSON.stringify({ ...db, meta: null });
    const p = productWhere(db, (x) => stockOf(db, x.id).warehouse.available >= 1);
    const client = newClient(op);
    const after1 = JSON.stringify({ ...db, meta: null });
    expect(() => op('order.create', { clientId: client, lines: [{ productId: p.id, packQty: 1 }, { productId: p.id, packQty: 100000 }], state: 'confirmed' }, MANAGER)).toThrow(OpError);
    expect(JSON.stringify({ ...db, meta: null })).toBe(after1);
    expect(after1).not.toBe(before);
    expect(() => op('payment.transfer', { from: 'shop_cash', to: 'bank', amount: 99999999 }, ACCOUNTANT)).toThrow(/Касса магазина/);
    expect(() => op('shift.open', {}, SELLER)).toThrow(/Смена уже открыта/);
    expect(() => op('visit.complete', { visitId: db.visits.find((v) => v.state === 'planned' && v.repId === 'e-abdullaev')!.id, result: 'refusal' }, 'e-abdullaev')).toThrow(/Причина отказа/);
    expect(JSON.stringify({ ...db, meta: null })).toBe(after1);
  });
});
