/* Операции изменения данных демо. Каждая — чистый детерминированный редьюсер
   (db, payload, ctx) => OpResult: меняет db на месте; при нарушении правила бросает OpError
   и ничего не меняет (сначала все проверки, потом изменения; applyOp дополнительно откатывает
   добавленные записи и счётчики). Этими же операциями генератор строит историю магазина. */
import type {
  AccountKey,
  Allocation,
  Chat,
  ChatFile,
  Client,
  ClientContact,
  ClientPoint,
  DB,
  Delivery,
  Employee,
  ID,
  ISODate,
  LocationKey,
  Order,
  OrderSource,
  Pack,
  PackKey,
  PayMethod,
  Payment,
  Product,
  Promo,
  Purchase,
  QuarantineItem,
  Receipt,
  Return,
  ReturnLine,
  ReturnReason,
  RoleKey,
  Settings,
  Shift,
  StockDoc,
  StockDocKind,
  StockDocLine,
  Supplier,
  Task,
  TaskLink,
  Visit,
  VisitResult,
  WaAutoKey,
  WhatsAppSettings,
  ChatPurpose,
  TaskKind,
  WriteoffReason,
} from './types';
import { ACCOUNT_NAMES, EXPENSE_CATEGORIES, PAY_METHOD_NAMES, RETURN_REASONS, TASK_KINDS, WA_AUTO_KEYS, WRITEOFF_REASONS } from './types';
import { byIdempotencyKey, get, removeFrom, stockRow } from './idx';
import {
  accountBalances,
  clientBalance,
  orderPayment,
  orderReturns,
  priceFor,
  purchaseAccepted,
  purchasePaid,
  shiftSummary,
  stockIndex,
  supplierBalance,
} from './selectors';
import {
  LOCATIONS,
  OpError,
  ROLE_NAMES,
  actor,
  arr,
  audit,
  available,
  commitStock,
  dayOf,
  fail,
  hasRole,
  isoDate,
  locIn,
  nextId,
  nextNo,
  nonNegInt,
  obj,
  oneOf,
  parseLines,
  posInt,
  priceLines,
  product,
  qtyByProduct,
  requireRole,
  shortName,
  text,
} from './opkit';
import type { OpCtx, OpResult, StockDelta } from './opkit';
import { dateOf, dayNum, dayText, diffDays, plusDays } from './dates';
import { days, pcs, rub } from './text';
import { isEan13, isInn, makeEan13 } from './codes';
import { SALES_WINDOW_DAYS, SUGGEST_SAFETY_DAYS, isBelowMin } from './thresholds';
import { WA_AUTO_META, ensureChat, waAfterOp } from './whatsapp';

export { OpError, ROLE_NAMES };
export type { OpCtx, OpResult };

/* ---------- общие помощники ---------- */

const PAY_METHODS: readonly PayMethod[] = ['cash', 'card', 'transfer'];
const ACCOUNTS: readonly AccountKey[] = ['shop_cash', 'courier_cash', 'bank'];

function empName(db: DB, id: ID | null | undefined): string {
  return get(db, 'employees', id)?.name ?? 'сотрудник';
}

function clientOf(db: DB, id: unknown): Client {
  const c = typeof id === 'string' ? get(db, 'clients', id) : undefined;
  if (!c) fail('Клиент не найден');
  return c;
}

function orderOf(db: DB, id: unknown): Order {
  const o = typeof id === 'string' ? get(db, 'orders', id) : undefined;
  if (!o) fail('Заказ не найден');
  return o;
}

function deliveryOf(db: DB, id: unknown): Delivery {
  const d = typeof id === 'string' ? get(db, 'deliveries', id) : undefined;
  if (!d) fail('Доставка не найдена');
  return d;
}

function purchaseOf(db: DB, id: unknown): Purchase {
  const p = typeof id === 'string' ? get(db, 'purchases', id) : undefined;
  if (!p) fail('Закупка не найдена');
  return p;
}

function event(o: Order, ctx: OpCtx, txt: string): void {
  o.history.push({ at: ctx.at, actorId: ctx.actorId, text: txt });
}

function openShiftOf(db: DB): Shift | undefined {
  for (let i = db.shifts.length - 1; i >= 0; i--) if (!db.shifts[i].closedAt) return db.shifts[i];
  return undefined;
}

function defaultAccount(method: PayMethod): AccountKey {
  return method === 'cash' ? 'shop_cash' : 'bank';
}

function needMoney(db: DB, account: AccountKey, amount: number): void {
  const b = accountBalances(db)[account];
  if (b < amount) fail(`${ACCOUNT_NAMES[account]}: ${rub(b)}, а нужно ${rub(amount)}`);
}

type NewPayment = Partial<Payment> & Pick<Payment, 'kind' | 'direction' | 'amount' | 'method' | 'account'>;

function newPayment(db: DB, ctx: OpCtx, p: NewPayment): Payment {
  const n = nextNo(db, 'payment');
  const pay: Payment = {
    id: 'pay-' + n,
    number: n,
    at: ctx.at,
    clientId: null,
    supplierId: null,
    toAccount: null,
    allocations: [],
    status: 'posted',
    shiftId: null,
    deliveryId: null,
    returnId: null,
    expenseCategory: null,
    authorId: ctx.actorId,
    comment: '',
    idempotencyKey: null,
    ...p,
  };
  db.payments.push(pay);
  return pay;
}

function idemKey(p: Record<string, unknown>): string | null {
  return typeof p.idempotencyKey === 'string' && p.idempotencyKey.trim() ? p.idempotencyKey.trim() : null;
}

function newQuarantine(
  db: DB,
  ctx: OpCtx,
  q: Pick<QuarantineItem, 'productId' | 'location' | 'qty' | 'source' | 'sourceId' | 'reason'>,
): QuarantineItem {
  const item: QuarantineItem = {
    id: nextId(db, 'quarantine', 'q-'),
    ...q,
    state: 'check',
    createdAt: ctx.at,
    decidedAt: null,
    decidedBy: null,
  };
  db.quarantine.push(item);
  return item;
}

function newStockDoc(db: DB, ctx: OpCtx, d: Pick<StockDoc, 'kind' | 'from' | 'to' | 'lines' | 'comment'> & { purchaseId?: ID | null }): StockDoc {
  const n = nextNo(db, 'stockDoc');
  const doc: StockDoc = {
    id: 'sd-' + n,
    number: n,
    kind: d.kind,
    at: ctx.at,
    authorId: ctx.actorId,
    from: d.from,
    to: d.to,
    lines: d.lines,
    comment: d.comment,
    purchaseId: d.purchaseId ?? null,
  };
  db.stockDocs.push(doc);
  return doc;
}

/* =====================================================================
   КАССА
   ===================================================================== */

function shiftOpen(db: DB, payload: { openingCash?: number; sellerId?: ID } | undefined, ctx: OpCtx): OpResult {
  const p = obj(payload ?? {});
  requireRole(db, ctx, ['seller'], 'Открыть смену');
  const cur = openShiftOf(db);
  if (cur) fail(`Смена уже открыта: ${empName(db, cur.sellerId)} с ${cur.openedAt.slice(11, 16)}`);
  const sellerId = typeof p.sellerId === 'string' ? p.sellerId : ctx.actorId;
  if (!hasRole(db, sellerId, 'seller', 'owner')) fail('Смену открывает продавец');
  const openingCash = p.openingCash === undefined ? 5000 : nonNegInt(p.openingCash, 'Размен');
  const n = nextNo(db, 'shift');
  const s: Shift = { id: 'sh-' + n, number: n, sellerId, openedAt: ctx.at, closedAt: null, openingCash, countedCash: null };
  db.shifts.push(s);
  return { id: s.id };
}

function shiftClose(db: DB, payload: { shiftId?: ID; countedCash: number; diffReason?: string }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['seller'], 'Закрыть смену');
  const s = typeof p.shiftId === 'string' ? get(db, 'shifts', p.shiftId) : openShiftOf(db);
  if (!s) fail('Открытой смены нет');
  if (s.closedAt) fail('Смена уже закрыта');
  const counted = nonNegInt(p.countedCash, 'Пересчитано наличных');
  const sum = shiftSummary(db, s.id);
  const cashNet = counted - s.openingCash;
  if (cashNet !== 0) {
    newPayment(db, ctx, {
      kind: 'shift',
      direction: cashNet > 0 ? 'in' : 'out',
      amount: Math.abs(cashNet),
      method: 'cash',
      account: 'shop_cash',
      shiftId: s.id,
      authorId: s.sellerId,
      comment: `Выручка смены №${s.number}, наличные`,
    });
  }
  if (sum.card !== 0) {
    newPayment(db, ctx, {
      kind: 'shift',
      direction: sum.card > 0 ? 'in' : 'out',
      amount: Math.abs(sum.card),
      method: 'card',
      account: 'bank',
      shiftId: s.id,
      authorId: s.sellerId,
      comment: `Выручка смены №${s.number}, карты`,
    });
  }
  s.closedAt = ctx.at;
  s.countedCash = counted;
  const diff = counted - sum.expectedCash;
  const reason = diff !== 0 ? text(p.diffReason, 'Причина расхождения', false) : '';
  if (reason) s.diffReason = reason;
  if (diff !== 0) audit(db, ctx, 'payment', s.id, `Смена №${s.number}: расхождение в кассе ${diff > 0 ? '+' : ''}${rub(diff)}${reason ? ` — ${reason}` : ''}`);
  return { id: s.id, info: diff === 0 ? 'Касса сошлась' : `Расхождение в кассе: ${diff > 0 ? '+' : ''}${rub(diff)}` };
}

interface CheckoutPayload {
  lines: { productId: ID; pack?: PackKey; packQty: number; discountPct?: number; discountReason?: string }[];
  clientId?: ID | null;
  cash?: number;
  card?: number;
  idempotencyKey?: string;
}

function receiptCheckout(db: DB, payload: CheckoutPayload, ctx: OpCtx): OpResult {
  const p = obj(payload);
  const me = requireRole(db, ctx, ['seller'], 'Продажа на кассе');
  const ik = idemKey(p);
  if (ik) {
    const ex = byIdempotencyKey(db, 'receipts', ik);
    if (ex) return { id: ex.id, info: 'Чек уже пробит — повтор не создаёт второй' };
  }
  const shift = openShiftOf(db);
  if (!shift) fail('Сначала откройте смену');
  const client = p.clientId ? clientOf(db, p.clientId) : null;
  const priceType = client?.priceType ?? 'retail';
  const { lines, info } = priceLines(db, parseLines(p.lines, 'Чек'), priceType, ctx);
  for (const [pid, q] of qtyByProduct(lines)) {
    const a = available(db, pid, 'shop');
    if (a < q) fail(`${shortName(product(db, pid))}: в магазине доступно ${pcs(a)}, а в чеке ${pcs(q)}`);
  }
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  let cash: number;
  let card: number;
  if (p.cash === undefined && p.card === undefined) {
    cash = total;
    card = 0;
  } else {
    cash = p.cash === undefined ? 0 : nonNegInt(p.cash, 'Наличные');
    card = p.card === undefined ? 0 : nonNegInt(p.card, 'Карта');
  }
  if (card > total) fail('Оплата картой больше суммы чека');
  if (cash + card < total) fail(`Не хватает оплаты: к оплате ${rub(total)}, внесено ${rub(cash + card)}`);
  const change = cash + card - total;
  const n = nextNo(db, 'receipt');
  const r: Receipt = {
    id: 'r-' + n,
    number: n,
    shiftId: shift.id,
    at: ctx.at,
    sellerId: me.id,
    clientId: client?.id ?? null,
    lines,
    total,
    cash,
    card,
    change,
    kind: 'sale',
    refundOf: null,
    fiscal: 'not_connected',
    idempotencyKey: ik,
  };
  db.receipts.push(r);
  commitStock(
    db,
    lines.map((l) => ({ productId: l.productId, location: 'shop' as LocationKey, dOnHand: -l.qty, dReserved: 0, kind: 'sale' as const, docType: 'receipt' as const, docId: r.id })),
    ctx,
  );
  const msg = [change > 0 ? `Сдача ${rub(change)}` : '', ...info].filter(Boolean).join('. ');
  return { id: r.id, info: msg || undefined };
}

interface RefundPayload {
  receiptId: ID;
  lines: { productId: ID; qty: number; reason?: ReturnReason }[];
  method?: 'cash' | 'card';
  comment?: string;
}

const RETURN_REASON_KEYS = Object.keys(RETURN_REASONS) as ReturnReason[];

function receiptRefund(db: DB, payload: RefundPayload, ctx: OpCtx): OpResult {
  const p = obj(payload);
  const me = requireRole(db, ctx, ['seller'], 'Возврат по чеку');
  const orig = typeof p.receiptId === 'string' ? get(db, 'receipts', p.receiptId) : undefined;
  if (!orig) fail('Чек не найден');
  if (orig.kind !== 'sale') fail('Это чек возврата — возврат по нему невозможен');
  const shift = openShiftOf(db);
  if (!shift) fail('Сначала откройте смену — деньги возвращаются из кассы');
  const sold = qtyByProduct(orig.lines);
  const refunded = new Map<ID, number>();
  for (const r of db.receipts) if (r.refundOf === orig.id) for (const l of r.lines) refunded.set(l.productId, (refunded.get(l.productId) ?? 0) + l.qty);
  const lines = arr(p.lines, 'Возврат').map((x) => {
    const l = obj(x);
    const pr = product(db, l.productId);
    const qty = posInt(l.qty, 'Количество');
    const reason = oneOf(l.reason ?? 'not_fit', RETURN_REASON_KEYS, 'Причина');
    const left = (sold.get(pr.id) ?? 0) - (refunded.get(pr.id) ?? 0);
    if (qty > left) fail(`${shortName(pr)}: по чеку можно вернуть ${pcs(left)}, а указано ${pcs(qty)}`);
    refunded.set(pr.id, (refunded.get(pr.id) ?? 0) + qty);
    const ol = orig.lines.find((z) => z.productId === pr.id)!;
    return { ol, qty, reason };
  });
  const amount = lines.reduce((s, l) => s + l.qty * l.ol.price, 0);
  const method: 'cash' | 'card' =
    p.method === 'cash' || p.method === 'card' ? p.method : orig.card >= orig.total ? 'card' : 'cash';
  if (method === 'card' && orig.card === 0) fail('Чек оплачен наличными — вернуть можно только наличными');
  if (method === 'card' && amount > orig.card) fail(`На карту можно вернуть не больше ${rub(orig.card)} — остальное наличными`);
  if (method === 'cash') {
    const s = shiftSummary(db, shift.id);
    if (s.expectedCash < amount) fail(`В кассе ${rub(s.expectedCash)} наличными — не хватает для возврата ${rub(amount)}`);
  }
  const comment = text(p.comment, 'Комментарий', false);
  const n = nextNo(db, 'receipt');
  const refund: Receipt = {
    id: 'r-' + n,
    number: n,
    shiftId: shift.id,
    at: ctx.at,
    sellerId: me.id,
    clientId: orig.clientId,
    lines: lines.map((l) => ({ ...l.ol, pack: 'pcs' as PackKey, packSize: 1, packQty: l.qty, qty: l.qty })),
    total: amount,
    cash: method === 'cash' ? amount : 0,
    card: method === 'card' ? amount : 0,
    change: 0,
    kind: 'refund',
    refundOf: orig.id,
    fiscal: 'not_connected',
    idempotencyKey: null,
  };
  db.receipts.push(refund);
  const rn = nextNo(db, 'return');
  const ret: Return = {
    id: 'ret-' + rn,
    number: rn,
    at: ctx.at,
    source: 'receipt',
    receiptId: orig.id,
    orderId: null,
    clientId: orig.clientId,
    location: 'shop',
    lines: lines.map((l) => ({ productId: l.ol.productId, qty: l.qty, price: l.ol.price, reason: l.reason })),
    amount,
    refundPaymentId: null,
    authorId: me.id,
    comment: comment || `Возврат по чеку №${orig.number}`,
  };
  db.returns.push(ret);
  for (const l of lines) {
    newQuarantine(db, ctx, { productId: l.ol.productId, location: 'shop', qty: l.qty, source: 'return', sourceId: ret.id, reason: RETURN_REASONS[l.reason] });
  }
  audit(db, ctx, 'payment', refund.id, `Возврат по чеку: ${rub(amount)} ${method === 'cash' ? 'наличными' : 'на карту'}, возврат №${rn}`);
  return { id: refund.id, info: `Возврат ${rub(amount)} ${method === 'cash' ? 'наличными' : 'на карту'}, чек возврата №${refund.number}. Товар отправлен на проверку` };
}

/* =====================================================================
   ОПТОВЫЕ ЗАКАЗЫ
   ===================================================================== */

function isRepOnly(e: Employee): boolean {
  return e.roles.includes('rep') && !e.roles.includes('manager') && !e.roles.includes('owner');
}

function remainingByProduct(o: Order): Map<ID, number> {
  const m = new Map<ID, number>();
  for (const l of o.lines) {
    const rest = l.qty - l.shipped;
    if (rest > 0) m.set(l.productId, (m.get(l.productId) ?? 0) + rest);
  }
  return m;
}

function checkAvailableForOrder(db: DB, o: Order): void {
  for (const [pid, q] of remainingByProduct(o)) {
    const a = available(db, pid, o.location);
    if (a < q) fail(`${shortName(product(db, pid))}: ${locIn(o.location)} доступно ${pcs(a)}, а в заказе ${pcs(q)}`);
  }
}

function reserveDeltas(o: Order, sign: 1 | -1): StockDelta[] {
  const out: StockDelta[] = [];
  for (const [pid, q] of remainingByProduct(o)) {
    out.push({ productId: pid, location: o.location, dOnHand: 0, dReserved: sign * q, kind: sign > 0 ? 'reserve' : 'unreserve', docType: 'order', docId: o.id });
  }
  return out;
}

/** Проверка кредитного лимита, просрочки и минимальной суммы. Владелец с override — разрешает. */
function confirmChecks(db: DB, o: Order, client: Client, ctx: OpCtx, override: boolean): string | null {
  const b = clientBalance(db, client.id);
  const problems: string[] = [];
  if (b.overdue > 0) problems.push(`просрочка ${days(b.maxOverdueDays)} на ${rub(b.overdue)}`);
  if (client.creditLimit > 0 && client.deferDays > 0) {
    const exposure = b.debt + b.openOrders + o.total;
    if (exposure > client.creditLimit) {
      problems.push(
        `долг ${rub(b.debt)}${b.openOrders ? ` и открытые заказы ${rub(b.openOrders)}` : ''} вместе с заказом ${rub(o.total)} — больше лимита ${rub(client.creditLimit)}`,
      );
    }
  }
  if (client.minOrder > 0 && o.total < client.minOrder) problems.push(`сумма ${rub(o.total)} меньше минимального заказа ${rub(client.minOrder)}`);
  if (!problems.length) return null;
  if (!override) fail(`Нельзя подтвердить: ${problems.join('; ')}. Подтвердить сверх лимита может владелец`);
  if (!hasRole(db, ctx.actorId, 'owner')) fail('Подтвердить сверх лимита может только владелец');
  return `Подтверждено владельцем сверх лимита: ${problems.join('; ')}`;
}

interface OrderLinePayload {
  productId: ID;
  pack?: PackKey;
  packQty: number;
  discountPct?: number;
  discountReason?: string;
}

interface OrderCreatePayload {
  clientId: ID;
  lines: OrderLinePayload[];
  state?: 'draft' | 'request' | 'confirmed';
  pointId?: ID | null;
  source?: OrderSource;
  location?: LocationKey;
  fulfillment?: 'delivery' | 'pickup';
  comment?: string;
  idempotencyKey?: string;
  override?: boolean;
}

function pointCheck(client: Client, pointId: unknown): ID | null {
  if (pointId === undefined || pointId === null) return client.points[0]?.id ?? null;
  if (typeof pointId !== 'string' || !client.points.some((pt) => pt.id === pointId)) fail('Точка не принадлежит клиенту');
  return pointId;
}

function orderCreate(db: DB, payload: OrderCreatePayload, ctx: OpCtx): OpResult {
  const p = obj(payload);
  const me = requireRole(db, ctx, ['manager', 'rep'], 'Создать заказ');
  const ik = idemKey(p);
  if (ik) {
    const ex = byIdempotencyKey(db, 'orders', ik);
    if (ex) return { id: ex.id, info: 'Заказ уже создан — повтор не создаёт второй' };
  }
  const client = clientOf(db, p.clientId);
  if (!client.active) fail('Клиент неактивен');
  const repOnly = isRepOnly(me);
  const state = oneOf(p.state ?? (repOnly ? 'request' : 'confirmed'), ['draft', 'request', 'confirmed'] as const, 'Состояние');
  if (repOnly && state === 'confirmed') fail('Представитель оформляет заявку — подтверждает менеджер');
  if (repOnly && client.ownerId !== me.id) fail('Это клиент другого сотрудника');
  const pointId = pointCheck(client, p.pointId);
  const location = oneOf(p.location ?? 'warehouse', LOCATIONS, 'Место отгрузки');
  const fulfillment = oneOf(p.fulfillment ?? 'delivery', ['delivery', 'pickup'] as const, 'Способ получения');
  const source = oneOf(p.source ?? (repOnly ? 'rep' : 'manager'), ['manager', 'rep', 'phone', 'chat', 'repeat'] as const, 'Источник');
  const { lines, info } = priceLines(db, parseLines(p.lines, 'Заказ'), client.priceType, ctx);
  const total = lines.reduce((s, l) => s + l.qty * l.price, 0);
  const n = nextNo(db, 'order');
  const o: Order = {
    id: 'o-' + n,
    number: n,
    createdAt: ctx.at,
    clientId: client.id,
    pointId,
    authorId: me.id,
    ownerId: client.ownerId ?? me.id,
    source,
    location,
    priceType: client.priceType,
    lines: lines.map((l) => ({ ...l, shipped: 0 })),
    state: 'draft',
    pick: 'none',
    ship: 'none',
    fulfillment,
    deliveryId: null,
    dueDate: null,
    comment: text(p.comment, 'Комментарий', false),
    total,
    idempotencyKey: ik,
    history: [],
  };
  if (state === 'confirmed') {
    const note = confirmChecks(db, o, client, ctx, p.override === true);
    checkAvailableForOrder(db, o);
    db.orders.push(o);
    commitStock(db, reserveDeltas(o, 1), ctx);
    o.state = 'confirmed';
    event(o, ctx, 'Создан и подтверждён, товар зарезервирован');
    if (note) {
      event(o, ctx, note);
      audit(db, ctx, 'order', o.id, `Заказ №${o.number}: ${note.charAt(0).toLowerCase()}${note.slice(1)}`);
    }
  } else {
    db.orders.push(o);
    o.state = state;
    event(o, ctx, state === 'request' ? 'Заявка создана, ждёт подтверждения — товар не зарезервирован' : 'Черновик сохранён');
  }
  return { id: o.id, info: info.join('. ') || undefined };
}

function orderUpdate(
  db: DB,
  payload: { orderId: ID; lines?: OrderLinePayload[]; comment?: string; pointId?: ID; fulfillment?: 'delivery' | 'pickup'; state?: 'request' },
  ctx: OpCtx,
): OpResult {
  const p = obj(payload);
  const me = requireRole(db, ctx, ['manager', 'rep'], 'Изменить заказ');
  const o = orderOf(db, p.orderId);
  if (o.state !== 'draft' && o.state !== 'request') fail('Изменить можно только черновик или заявку');
  if (isRepOnly(me) && o.authorId !== me.id && o.ownerId !== me.id) fail('Это заказ другого сотрудника');
  const client = clientOf(db, o.clientId);
  const changes: string[] = [];
  let newLines: Order['lines'] | null = null;
  let newTotal = o.total;
  if (p.lines !== undefined) {
    const priced = priceLines(db, parseLines(p.lines, 'Заказ'), client.priceType, ctx);
    newLines = priced.lines.map((l) => ({ ...l, shipped: 0 }));
    newTotal = newLines.reduce((s, l) => s + l.qty * l.price, 0);
    changes.push(`состав: ${newLines.length} поз., ${rub(newTotal)}`);
  }
  const pointId = p.pointId !== undefined ? pointCheck(client, p.pointId) : o.pointId;
  const fulfillment = p.fulfillment !== undefined ? oneOf(p.fulfillment, ['delivery', 'pickup'] as const, 'Способ получения') : o.fulfillment;
  const comment = p.comment !== undefined ? text(p.comment, 'Комментарий', false) : o.comment;
  if (p.state !== undefined && p.state !== 'request') fail('Из черновика можно сделать только заявку');
  if (newLines) {
    o.lines = newLines;
    o.total = newTotal;
  }
  if (pointId !== o.pointId) changes.push('точка');
  if (fulfillment !== o.fulfillment) changes.push(fulfillment === 'pickup' ? 'самовывоз' : 'доставка');
  if (comment !== o.comment) changes.push('комментарий');
  o.pointId = pointId;
  o.fulfillment = fulfillment;
  o.comment = comment;
  if (p.state === 'request' && o.state === 'draft') {
    o.state = 'request';
    changes.push('отправлен как заявка');
  }
  event(o, ctx, changes.length ? `Изменён: ${changes.join(', ')}` : 'Сохранён без изменений');
  return { id: o.id };
}

function orderConfirm(db: DB, payload: { orderId: ID; override?: boolean }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['manager'], 'Подтвердить заказ');
  const o = orderOf(db, p.orderId);
  if (o.state === 'confirmed') fail('Заказ уже подтверждён');
  if (o.state !== 'draft' && o.state !== 'request') fail(o.state === 'cancelled' ? 'Заказ отменён' : 'Заказ уже закрыт');
  const client = clientOf(db, o.clientId);
  const note = confirmChecks(db, o, client, ctx, p.override === true);
  checkAvailableForOrder(db, o);
  commitStock(db, reserveDeltas(o, 1), ctx);
  o.state = 'confirmed';
  event(o, ctx, 'Подтверждён, товар зарезервирован');
  if (note) {
    event(o, ctx, note);
    audit(db, ctx, 'order', o.id, `Заказ №${o.number}: ${note.charAt(0).toLowerCase()}${note.slice(1)}`);
  }
  return { id: o.id, info: note ?? undefined };
}

function orderCancel(db: DB, payload: { orderId: ID; reason?: string }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  const me = requireRole(db, ctx, ['manager', 'rep'], 'Отменить заказ');
  const o = orderOf(db, p.orderId);
  if (o.state === 'cancelled') fail('Заказ уже отменён');
  if (o.state === 'closed' || o.ship === 'shipped' || o.ship === 'delivered') fail('Отгруженный заказ отменить нельзя — оформите возврат');
  if (isRepOnly(me) && (o.state === 'confirmed' || o.authorId !== me.id)) fail('Представитель может отменить только свою заявку');
  const reason = text(p.reason, 'Причина', false);
  const d = o.deliveryId ? get(db, 'deliveries', o.deliveryId) : undefined;
  if (d && (d.state === 'on_way' || d.state === 'failed')) fail('Заказ у курьера — сначала дождитесь результата доставки');
  const wasConfirmed = o.state === 'confirmed';
  if (wasConfirmed) commitStock(db, reserveDeltas(o, -1), ctx);
  if (d && (d.state === 'waiting' || d.state === 'assigned')) {
    removeFrom(db, 'deliveries', d);
    o.deliveryId = null;
  }
  const pay = orderPayment(db, o);
  if (o.ship === 'partial') {
    o.state = 'closed';
    o.ship = 'shipped';
    event(o, ctx, `Остаток заказа отменён${reason ? ': ' + reason : ''}, резерв снят`);
  } else {
    o.state = 'cancelled';
    event(o, ctx, `Отменён${reason ? ': ' + reason : ''}${wasConfirmed ? ', резерв снят' : ''}`);
  }
  const info = pay.paid > 0 && o.state === 'cancelled' ? `Оплата по заказу ${rub(pay.paid)} осталась авансом клиента` : undefined;
  return { id: o.id, info };
}

function orderPick(db: DB, payload: { orderId: ID; stage?: 'picking' | 'picked' }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['warehouse', 'manager'], 'Сборка заказа');
  const o = orderOf(db, p.orderId);
  if (o.state !== 'confirmed') fail('Собирать можно только подтверждённый заказ');
  const stage = oneOf(p.stage ?? (o.pick === 'none' ? 'picking' : 'picked'), ['picking', 'picked'] as const, 'Этап сборки');
  if (stage === 'picking') {
    if (o.pick !== 'none') fail('Сборка уже начата');
    o.pick = 'picking';
    event(o, ctx, 'Сборка начата');
  } else {
    if (o.pick === 'picked') fail('Заказ уже собран');
    o.pick = 'picked';
    event(o, ctx, 'Собран');
  }
  return { id: o.id };
}

/** Отметки сборщика по строкам заказа: сохраняются, чтобы прогресс не терялся. Первая отметка начинает сборку. */
function orderPickProgress(db: DB, payload: { orderId: ID; checked: ID[] }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['warehouse', 'manager'], 'Сборка заказа');
  const o = orderOf(db, p.orderId);
  if (o.state !== 'confirmed') fail('Собирать можно только подтверждённый заказ');
  if (o.pick === 'picked') fail('Заказ уже собран');
  const ids = new Set(o.lines.map((l) => l.productId));
  const checked = arr(p.checked, 'Отмеченные строки').map((x) => String(x)).filter((x) => ids.has(x));
  o.pickChecked = [...new Set(checked)];
  if (o.pick === 'none' && checked.length) {
    o.pick = 'picking';
    event(o, ctx, 'Сборка начата');
  }
  return { id: o.id };
}

/** Отгрузка: списывает факт и резерв, ставит срок оплаты. Без lines — весь остаток. */
function shipOrder(db: DB, o: Order, linesRaw: unknown, ctx: OpCtx): string {
  if (o.state !== 'confirmed') fail('Отгрузить можно только подтверждённый заказ');
  if (o.pick !== 'picked') fail('Заказ ещё не собран');
  const plan = new Map<number, number>();
  if (linesRaw === undefined || linesRaw === null) {
    o.lines.forEach((l, i) => {
      if (l.qty > l.shipped) plan.set(i, l.qty - l.shipped);
    });
  } else {
    for (const x of arr(linesRaw, 'Отгрузка')) {
      const l = obj(x);
      const pr = product(db, l.productId);
      let q = nonNegInt(l.qty, 'Количество');
      const idxs = o.lines.map((ln, i) => (ln.productId === pr.id ? i : -1)).filter((i) => i >= 0);
      if (!idxs.length) fail(`${shortName(pr)} нет в заказе`);
      const rest = idxs.reduce((s, i) => s + o.lines[i].qty - o.lines[i].shipped - (plan.get(i) ?? 0), 0);
      if (q > rest) fail(`${shortName(pr)}: осталось отгрузить ${pcs(rest)}, указано ${pcs(q)}`);
      for (const i of idxs) {
        const free = o.lines[i].qty - o.lines[i].shipped - (plan.get(i) ?? 0);
        const take = Math.min(free, q);
        if (take > 0) plan.set(i, (plan.get(i) ?? 0) + take);
        q -= take;
      }
    }
  }
  const totalQty = [...plan.values()].reduce((s, q) => s + q, 0);
  if (totalQty === 0) fail('Нечего отгружать');
  const deltas: StockDelta[] = [];
  for (const [i, q] of plan) {
    deltas.push({ productId: o.lines[i].productId, location: o.location, dOnHand: -q, dReserved: -q, kind: 'ship', docType: 'order', docId: o.id });
  }
  commitStock(db, deltas, ctx);
  for (const [i, q] of plan) o.lines[i].shipped += q;
  const all = o.lines.every((l) => l.shipped >= l.qty);
  o.ship = all ? 'shipped' : 'partial';
  if (all) o.state = 'closed';
  if (!o.dueDate) {
    const c = get(db, 'clients', o.clientId);
    o.dueDate = plusDays(dayOf(ctx), c?.deferDays ?? 0);
  }
  const shippedLines = o.lines.filter((l) => l.shipped > 0).length;
  const msg = all ? 'Отгружен полностью' : `Отгружено частично: ${shippedLines} из ${o.lines.length} позиций`;
  event(o, ctx, msg);
  return msg;
}

function orderShip(db: DB, payload: { orderId: ID; lines?: { productId: ID; qty: number }[] }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['warehouse', 'manager'], 'Отгрузить заказ');
  const o = orderOf(db, p.orderId);
  const msg = shipOrder(db, o, p.lines, ctx);
  return { id: o.id, info: msg };
}

/* ---------- повтор заказа ---------- */

export interface RepeatLine {
  productId: ID;
  name: string;
  pack: PackKey;
  packQty: number; // предлагаемое количество упаковок
  oldPackSize: number;
  packSize: number;
  oldQty: number;
  qty: number; // предлагаемое количество штук
  oldPrice: number;
  price: number;
  promoId: ID | null;
  available: number;
  status: 'same' | 'changed' | 'short' | 'unavailable';
  changes: string[];
}

export interface RepeatPreviewResult {
  orderId: ID;
  clientId: ID;
  date: ISODate;
  lines: RepeatLine[];
  oldTotal: number;
  total: number;
  changes: { productId: ID; text: string }[]; // «было → стало»
  canRepeat: boolean;
  payloadLines: { productId: ID; pack: PackKey; packQty: number }[]; // готово для order.create
}

/** Повтор заказа: текущие цены, акции и доступность, список изменений «было → стало». Базу не меняет. */
export function repeatPreview(db: DB, orderId: ID, at?: string): RepeatPreviewResult {
  const o = get(db, 'orders', orderId);
  if (!o) throw new OpError('Заказ не найден');
  const date = (at ?? db.meta.today).slice(0, 10);
  const client = get(db, 'clients', o.clientId);
  const priceType = client?.priceType ?? o.priceType;
  const si = stockIndex(db);
  const used = new Map<ID, number>();
  const lines: RepeatLine[] = [];
  const changes: { productId: ID; text: string }[] = [];
  let oldTotal = 0;
  let total = 0;
  for (const l of o.lines) {
    oldTotal += l.qty * l.price;
    const p = get(db, 'products', l.productId);
    const ch: string[] = [];
    if (!p || !p.active) {
      ch.push('Снят с продажи');
      lines.push({
        productId: l.productId,
        name: p?.name ?? 'Товар удалён',
        pack: l.pack,
        packQty: 0,
        oldPackSize: l.packSize,
        packSize: l.packSize,
        oldQty: l.qty,
        qty: 0,
        oldPrice: l.price,
        price: 0,
        promoId: null,
        available: 0,
        status: 'unavailable',
        changes: ch,
      });
      changes.push({ productId: l.productId, text: `${p ? shortName(p) : 'Товар'}: снят с продажи` });
      continue;
    }
    let pack = l.pack;
    let pk: Pack | undefined = p.packs.find((x) => x.key === pack);
    let packQty = l.packQty;
    if (!pk) {
      pk = p.packs[0];
      pack = pk.key;
      packQty = l.qty;
      ch.push(`Упаковки больше нет — считаем штуками`);
    } else if (pk.qty !== l.packSize) {
      ch.push(`${pack === 'box' ? 'Коробка' : 'Упаковка'}: было ${l.packSize} шт, стало ${pk.qty} шт`);
    }
    const pr = priceFor(db, p.id, { priceType, date });
    if (pr.price !== l.price) ch.push(`Цена: была ${rub(l.price)}, стала ${rub(pr.price)}`);
    if (pr.promo && pr.promo.id !== l.promoId) ch.push(`Акция «${pr.promo.name}»`);
    if (l.promoId && !pr.promo) {
      const old = get(db, 'promos', l.promoId);
      ch.push(`Акция${old ? ` «${old.name}»` : ''} закончилась`);
    }
    const avail = Math.max(0, (si.get(p.id)?.warehouse.available ?? 0) - (used.get(p.id) ?? 0));
    let qty = packQty * pk.qty;
    let status: RepeatLine['status'] = ch.length ? 'changed' : 'same';
    if (avail < qty) {
      const fit = Math.floor(avail / pk.qty);
      ch.push(avail === 0 ? 'Нет в наличии' : `Доступно ${pcs(avail)} из ${pcs(qty)}`);
      packQty = fit;
      qty = fit * pk.qty;
      status = fit > 0 ? 'short' : 'unavailable';
    }
    used.set(p.id, (used.get(p.id) ?? 0) + qty);
    total += qty * pr.price;
    lines.push({
      productId: p.id,
      name: p.name,
      pack,
      packQty,
      oldPackSize: l.packSize,
      packSize: pk.qty,
      oldQty: l.qty,
      qty,
      oldPrice: l.price,
      price: pr.price,
      promoId: pr.promo?.id ?? null,
      available: avail,
      status,
      changes: ch,
    });
    for (const c of ch) changes.push({ productId: p.id, text: `${shortName(p)}: ${c}` });
  }
  const payloadLines = lines.filter((l) => l.packQty > 0).map((l) => ({ productId: l.productId, pack: l.pack, packQty: l.packQty }));
  return { orderId: o.id, clientId: o.clientId, date, lines, oldTotal, total, changes, canRepeat: payloadLines.length > 0, payloadLines };
}

/* =====================================================================
   ДЕНЬГИ
   ===================================================================== */

/** Свободный остаток к распределению по заказу (без учёта ожидающих подтверждения). */
function orderFree(db: DB, o: Order): { debtFree: number; restFree: number } {
  const op = orderPayment(db, o);
  const free = Math.max(0, op.due - op.pending);
  const debtFree = Math.max(0, Math.min(free, op.debt - op.pending));
  return { debtFree, restFree: free - debtFree };
}

/** Авто-распределение: сначала самые старые долги за отгруженное, затем предоплата открытых заказов. */
function autoAllocate(db: DB, clientId: ID, amount: number, preferOrderId?: ID | null): Allocation[] {
  const orders = db.orders
    .filter((o) => o.clientId === clientId && o.state !== 'cancelled' && o.state !== 'draft' && o.state !== 'request')
    .map((o) => ({ o, ...orderFree(db, o) }));
  const out = new Map<ID, number>();
  let left = amount;
  const take = (id: ID, v: number): void => {
    const q = Math.min(v, left);
    if (q <= 0) return;
    out.set(id, (out.get(id) ?? 0) + q);
    left -= q;
  };
  if (preferOrderId) {
    const x = orders.find((z) => z.o.id === preferOrderId);
    if (x) {
      take(x.o.id, x.debtFree + x.restFree);
      x.debtFree = 0;
      x.restFree = 0;
    }
  }
  const byDue = orders
    .filter((x) => x.debtFree > 0)
    .sort((a, b) => (a.o.dueDate ?? '9999').localeCompare(b.o.dueDate ?? '9999') || a.o.number - b.o.number);
  for (const x of byDue) take(x.o.id, x.debtFree);
  const byNum = orders.filter((x) => x.restFree > 0).sort((a, b) => a.o.number - b.o.number);
  for (const x of byNum) take(x.o.id, x.restFree);
  return [...out].map(([orderId, v]) => ({ orderId, amount: v }));
}

function parseAllocations(db: DB, raw: unknown, clientId: ID, amount: number): Allocation[] {
  const list = arr(raw, 'Распределение', 0, 200).map((x) => {
    const a = obj(x);
    const o = orderOf(db, a.orderId);
    if (o.clientId !== clientId) fail(`Заказ №${o.number} другого клиента`);
    const v = posInt(a.amount, 'Сумма распределения');
    const { debtFree, restFree } = orderFree(db, o);
    if (v > debtFree + restFree) fail(`На заказ №${o.number} к оплате ${rub(debtFree + restFree)}, а распределено ${rub(v)}`);
    return { orderId: o.id, amount: v };
  });
  const sum = list.reduce((s, a) => s + a.amount, 0);
  if (sum > amount) fail(`Распределено ${rub(sum)} — больше суммы платежа ${rub(amount)}`);
  return list;
}

interface ClientPaymentArgs {
  clientId: ID | null;
  amount: number;
  method: PayMethod;
  account: AccountKey;
  status: 'posted' | 'pending' | 'unidentified';
  allocations: Allocation[];
  comment: string;
  idempotencyKey: string | null;
  deliveryId: ID | null;
}

function pushClientPayment(db: DB, ctx: OpCtx, a: ClientPaymentArgs): Payment {
  return newPayment(db, ctx, {
    kind: 'client',
    direction: 'in',
    clientId: a.clientId,
    amount: a.amount,
    method: a.method,
    account: a.account,
    status: a.status,
    allocations: a.allocations,
    comment: a.comment,
    idempotencyKey: a.idempotencyKey,
    deliveryId: a.deliveryId,
  });
}

interface PaymentClientPayload {
  clientId: ID | null;
  amount: number;
  method: PayMethod;
  account?: AccountKey;
  allocations?: { orderId: ID; amount: number }[];
  status?: 'posted' | 'pending';
  comment?: string;
  idempotencyKey?: string;
  /** плательщик из выписки — для поступления без назначения */
  payer?: { name: string; inn: string };
}

function paymentClient(db: DB, payload: PaymentClientPayload, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['manager', 'accountant'], 'Принять оплату');
  const ik = idemKey(p);
  if (ik) {
    const ex = byIdempotencyKey(db, 'payments', ik);
    if (ex) return { id: ex.id, info: 'Оплата уже записана — повтор не создаёт второй платёж' };
  }
  const amount = posInt(p.amount, 'Сумма');
  const method = oneOf(p.method ?? 'transfer', PAY_METHODS, 'Способ оплаты');
  const comment = text(p.comment, 'Комментарий', false);
  if (p.clientId === null || p.clientId === undefined) {
    const pay = pushClientPayment(db, ctx, {
      clientId: null,
      amount,
      method: 'transfer',
      account: 'bank',
      status: 'unidentified',
      allocations: [],
      comment: comment || 'Поступление на счёт, плательщик не ясен',
      idempotencyKey: ik,
      deliveryId: null,
    });
    if (p.payer !== undefined && p.payer !== null) {
      const py = obj(p.payer);
      pay.payer = { name: text(py.name, 'Плательщик'), inn: text(py.inn, 'ИНН плательщика', false) };
    }
    return { id: pay.id, info: 'Неопознанное поступление — разнесите его на клиента' };
  }
  const client = clientOf(db, p.clientId);
  const account = oneOf(p.account ?? defaultAccount(method), ACCOUNTS, 'Касса или счёт');
  const status = oneOf(p.status ?? 'posted', ['posted', 'pending'] as const, 'Статус');
  const allocations = p.allocations !== undefined ? parseAllocations(db, p.allocations, client.id, amount) : autoAllocate(db, client.id, amount);
  const pay = pushClientPayment(db, ctx, { clientId: client.id, amount, method, account, status, allocations, comment, idempotencyKey: ik, deliveryId: null });
  const allocated = allocations.reduce((s, a) => s + a.amount, 0);
  const notes: string[] = [];
  if (status === 'pending') notes.push('Ждёт подтверждения банка — долг не уменьшен');
  if (amount > allocated) notes.push(`Аванс ${rub(amount - allocated)}`);
  return { id: pay.id, info: notes.join('. ') || undefined };
}

function paymentConfirm(db: DB, payload: { paymentId: ID }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['accountant'], 'Подтвердить оплату');
  const pay = typeof p.paymentId === 'string' ? get(db, 'payments', p.paymentId) : undefined;
  if (!pay) fail('Платёж не найден');
  if (pay.status !== 'pending') fail(pay.status === 'posted' ? 'Платёж уже проведён' : 'Сначала определите плательщика');
  pay.status = 'posted';
  audit(db, ctx, 'payment', pay.id, `Платёж №${pay.number} на ${rub(pay.amount)} подтверждён банком`);
  return { id: pay.id, info: 'Оплата проведена, долг уменьшен' };
}

function paymentIdentify(db: DB, payload: { paymentId: ID; clientId: ID; allocations?: { orderId: ID; amount: number }[] }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['accountant'], 'Разнести поступление');
  const pay = typeof p.paymentId === 'string' ? get(db, 'payments', p.paymentId) : undefined;
  if (!pay) fail('Платёж не найден');
  if (pay.status !== 'unidentified') fail('Плательщик уже определён');
  const client = clientOf(db, p.clientId);
  const allocations = p.allocations !== undefined ? parseAllocations(db, p.allocations, client.id, pay.amount) : autoAllocate(db, client.id, pay.amount);
  pay.clientId = client.id;
  pay.status = 'posted';
  pay.allocations = allocations;
  audit(db, ctx, 'payment', pay.id, `Неопознанный платёж №${pay.number} на ${rub(pay.amount)} разнесён: ${client.name}`);
  return { id: pay.id };
}

function paymentRefund(
  db: DB,
  payload: { clientId: ID; amount: number; method?: PayMethod; account?: AccountKey; orderId?: ID; returnId?: ID; comment?: string },
  ctx: OpCtx,
): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['accountant', 'manager'], 'Вернуть деньги');
  const client = clientOf(db, p.clientId);
  const amount = posInt(p.amount, 'Сумма');
  const method = oneOf(p.method ?? 'transfer', PAY_METHODS, 'Способ');
  const account = oneOf(p.account ?? defaultAccount(method), ACCOUNTS, 'Касса или счёт');
  let order: Order | null = null;
  if (p.orderId) {
    order = orderOf(db, p.orderId);
    if (order.clientId !== client.id) fail('Заказ другого клиента');
    const op = orderPayment(db, order);
    const over = Math.max(0, op.paid - op.amount);
    if (amount > over) fail(`По заказу №${order.number} переплата ${rub(over)} — вернуть больше нельзя`);
  } else {
    const adv = clientBalance(db, client.id).advance;
    if (amount > adv) fail(`Аванс клиента ${rub(adv)} — вернуть больше нельзя`);
  }
  let ret: Return | undefined;
  if (p.returnId) {
    ret = get(db, 'returns', String(p.returnId));
    if (!ret) fail('Возврат не найден');
    if (ret.refundPaymentId) fail('Деньги по этому возврату уже вернули');
  }
  needMoney(db, account, amount);
  const pay = newPayment(db, ctx, {
    kind: 'refund',
    direction: 'out',
    clientId: client.id,
    amount,
    method,
    account,
    allocations: order ? [{ orderId: order.id, amount }] : [],
    returnId: ret?.id ?? null,
    comment: text(p.comment, 'Комментарий', false) || (order ? `Возврат переплаты по заказу №${order.number}` : 'Возврат аванса'),
  });
  if (ret) ret.refundPaymentId = pay.id;
  return { id: pay.id };
}

function paymentSupplier(
  db: DB,
  payload: { supplierId: ID; amount: number; method?: PayMethod; account?: AccountKey; allocations?: { purchaseId: ID; amount: number }[]; comment?: string },
  ctx: OpCtx,
): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['accountant'], 'Оплатить поставщику');
  const s = typeof p.supplierId === 'string' ? get(db, 'suppliers', p.supplierId) : undefined;
  if (!s) fail('Поставщик не найден');
  const amount = posInt(p.amount, 'Сумма');
  const method = oneOf(p.method ?? 'transfer', PAY_METHODS, 'Способ');
  const account = oneOf(p.account ?? defaultAccount(method), ACCOUNTS, 'Касса или счёт');
  let allocations: Allocation[];
  if (p.allocations !== undefined) {
    allocations = arr(p.allocations, 'Распределение', 0, 100).map((x) => {
      const a = obj(x);
      const pu = purchaseOf(db, a.purchaseId);
      if (pu.supplierId !== s.id) fail(`Закупка №${pu.number} другого поставщика`);
      const v = posInt(a.amount, 'Сумма');
      const left = purchaseAccepted(db, pu.id) - purchasePaid(db, pu.id);
      if (v > left) fail(`По закупке №${pu.number} к оплате ${rub(left)}, а распределено ${rub(v)}`);
      return { purchaseId: pu.id, amount: v };
    });
    if (allocations.reduce((z, a) => z + a.amount, 0) > amount) fail('Распределено больше суммы платежа');
  } else {
    allocations = [];
    let left = amount;
    for (const u of supplierBalance(db, s.id).upcoming) {
      if (left <= 0) break;
      const v = Math.min(left, u.amount);
      allocations.push({ purchaseId: u.purchaseId, amount: v });
      left -= v;
    }
  }
  needMoney(db, account, amount);
  const pay = newPayment(db, ctx, {
    kind: 'supplier',
    direction: 'out',
    supplierId: s.id,
    amount,
    method,
    account,
    allocations,
    comment: text(p.comment, 'Комментарий', false) || `Оплата поставщику ${s.name}`,
  });
  return { id: pay.id };
}

function paymentExpense(db: DB, payload: { category: string; amount: number; method?: PayMethod; account?: AccountKey; comment?: string; date?: ISODate }, ctx0: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx0, ['accountant'], 'Записать расход');
  // дата расхода: сегодня или прошлые дни (счёт за электричество за октябрь записывают в ноябре — датой счёта)
  let ctx = ctx0;
  if (p.date !== undefined && p.date !== null && p.date !== dayOf(ctx0)) {
    const date = isoDate(p.date, 'Дата расхода');
    if (date > dayOf(ctx0)) fail('Дата расхода не может быть в будущем');
    if (diffDays(date, dayOf(ctx0)) > 62) fail('Расход старше двух месяцев записать нельзя');
    ctx = { ...ctx0, at: `${date}T12:00` };
  }
  const category = oneOf(p.category, EXPENSE_CATEGORIES, 'Категория расхода');
  const amount = posInt(p.amount, 'Сумма');
  const method = oneOf(p.method ?? 'transfer', PAY_METHODS, 'Способ');
  const account = oneOf(p.account ?? defaultAccount(method), ACCOUNTS, 'Касса или счёт');
  needMoney(db, account, amount);
  const pay = newPayment(db, ctx, {
    kind: 'expense',
    direction: 'out',
    amount,
    method,
    account,
    expenseCategory: category,
    comment: text(p.comment, 'Комментарий', false) || category,
  });
  return { id: pay.id };
}

function paymentTransfer(db: DB, payload: { from: AccountKey; to: AccountKey; amount: number; comment?: string }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['accountant', 'seller'], 'Перемещение денег');
  const from = oneOf(p.from, ACCOUNTS, 'Откуда');
  const to = oneOf(p.to, ACCOUNTS, 'Куда');
  if (from === to) fail('Выберите разные кассы или счёт');
  const amount = posInt(p.amount, 'Сумма');
  needMoney(db, from, amount);
  const pay = newPayment(db, ctx, {
    kind: 'transfer',
    direction: 'out',
    amount,
    method: from === 'bank' || to === 'bank' ? 'transfer' : 'cash',
    account: from,
    toAccount: to,
    comment: text(p.comment, 'Комментарий', false) || (from === 'shop_cash' && to === 'bank' ? 'Инкассация' : `Из «${ACCOUNT_NAMES[from]}» в «${ACCOUNT_NAMES[to]}»`),
  });
  return { id: pay.id };
}

/** Начальные остатки денег на дату начала учёта (как документ «initial» для склада). */
function balanceInitial(db: DB, payload: { balances: Partial<Record<AccountKey, number>>; comment?: string }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['accountant'], 'Начальные остатки денег');
  const b = obj(p.balances);
  const list = ACCOUNTS.filter((a) => b[a] !== undefined).map((a) => ({ a, v: nonNegInt(b[a], ACCOUNT_NAMES[a]) }));
  if (!list.length) fail('Укажите остатки');
  let last: Payment | null = null;
  for (const { a, v } of list) {
    if (v === 0) continue;
    last = newPayment(db, ctx, {
      kind: 'transfer',
      direction: 'in',
      amount: v,
      method: a === 'bank' ? 'transfer' : 'cash',
      account: a,
      toAccount: null,
      comment: text(p.comment, 'Комментарий', false) || `Остаток на начало учёта, ${dayText(dayOf(ctx))}`,
    });
  }
  return { id: last?.id };
}

/* =====================================================================
   СКЛАД
   ===================================================================== */

interface QtyLine {
  productId: ID;
  qty: number;
  expiry?: ISODate;
  reason?: WriteoffReason;
}

function parseQtyLines(db: DB, raw: unknown, label: string, allowZero = false): QtyLine[] {
  return arr(raw, label, 1, 1500).map((x) => {
    const l = obj(x);
    const p = product(db, l.productId);
    const qty = allowZero ? nonNegInt(l.qty, 'Количество') : posInt(l.qty, 'Количество');
    const expiry = l.expiry === undefined || l.expiry === null ? undefined : isoDate(l.expiry, 'Срок годности');
    const reason = l.reason === undefined ? undefined : oneOf(l.reason, Object.keys(WRITEOFF_REASONS) as WriteoffReason[], 'Причина списания');
    return { productId: p.id, qty, expiry, reason };
  });
}

function stockInitial(db: DB, payload: { location: LocationKey; lines: QtyLine[]; comment?: string }, ctx: OpCtx): OpResult {
  return incomeLike(db, payload, ctx, 'initial');
}

function stockIncome(db: DB, payload: { location: LocationKey; lines: QtyLine[]; comment?: string }, ctx: OpCtx): OpResult {
  return incomeLike(db, payload, ctx, 'income');
}

function incomeLike(db: DB, payload: { location: LocationKey; lines: QtyLine[]; comment?: string }, ctx: OpCtx, kind: 'initial' | 'income'): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['warehouse'], kind === 'initial' ? 'Начальные остатки' : 'Приход товара');
  const location = oneOf(p.location ?? 'warehouse', LOCATIONS, 'Место');
  const lines = parseQtyLines(db, p.lines, 'Приход', kind === 'initial');
  const comment = text(p.comment, 'Основание', kind === 'income');
  const doc = newStockDoc(db, ctx, { kind, from: null, to: location, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })), comment });
  commitStock(
    db,
    lines.map((l) => ({ productId: l.productId, location, dOnHand: l.qty, dReserved: 0, kind, docType: 'stockdoc' as const, docId: doc.id, expiry: l.expiry })),
    ctx,
  );
  return { id: doc.id };
}

function stockTransfer(db: DB, payload: { from: LocationKey; to: LocationKey; lines: QtyLine[]; comment?: string }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['warehouse'], 'Перемещение товара');
  const from = oneOf(p.from, LOCATIONS, 'Откуда');
  const to = oneOf(p.to, LOCATIONS, 'Куда');
  if (from === to) fail('Выберите разные места хранения');
  const lines = parseQtyLines(db, p.lines, 'Перемещение');
  for (const [pid, q] of qtyByProduct(lines)) {
    const a = available(db, pid, from);
    if (a < q) fail(`${shortName(product(db, pid))}: ${locIn(from)} свободно ${pcs(a)}, а переместить нужно ${pcs(q)}`);
  }
  const doc = newStockDoc(db, ctx, {
    kind: 'transfer',
    from,
    to,
    lines: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
    comment: text(p.comment, 'Основание', false) || (to === 'shop' ? 'Пополнение магазина' : 'Возврат на склад'),
  });
  const deltas: StockDelta[] = [];
  for (const l of lines) {
    deltas.push({ productId: l.productId, location: from, dOnHand: -l.qty, dReserved: 0, kind: 'transfer_out', docType: 'stockdoc', docId: doc.id });
    deltas.push({ productId: l.productId, location: to, dOnHand: l.qty, dReserved: 0, kind: 'transfer_in', docType: 'stockdoc', docId: doc.id });
  }
  commitStock(db, deltas, ctx);
  return { id: doc.id, info: 'Перемещение проведено. Общий остаток не изменился' };
}

function stockWriteoff(db: DB, payload: { location: LocationKey; lines: QtyLine[]; comment?: string }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['warehouse'], 'Списание');
  const location = oneOf(p.location ?? 'warehouse', LOCATIONS, 'Место');
  const lines = parseQtyLines(db, p.lines, 'Списание');
  for (const l of lines) if (!l.reason) fail(`Укажите причину списания: ${shortName(product(db, l.productId))}`);
  for (const [pid, q] of qtyByProduct(lines)) {
    const a = available(db, pid, location);
    if (a < q) fail(`${shortName(product(db, pid))}: списать можно только свободный товар — ${locIn(location)} ${pcs(a)}, а списать нужно ${pcs(q)}`);
  }
  const doc = newStockDoc(db, ctx, {
    kind: 'writeoff',
    from: location,
    to: null,
    lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, reason: l.reason })),
    comment: text(p.comment, 'Комментарий', false),
  });
  commitStock(
    db,
    lines.map((l) => ({ productId: l.productId, location, dOnHand: -l.qty, dReserved: 0, kind: 'writeoff' as const, docType: 'stockdoc' as const, docId: doc.id })),
    ctx,
  );
  audit(db, ctx, 'stock', doc.id, `Списание №${doc.number}: ${lines.length} поз., ${lines.reduce((sum, l) => sum + l.qty, 0)} шт`);
  return { id: doc.id };
}

function stockCount(db: DB, payload: { location: LocationKey; lines: QtyLine[]; comment?: string }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['warehouse'], 'Пересчёт');
  const location = oneOf(p.location ?? 'warehouse', LOCATIONS, 'Место');
  const lines = parseQtyLines(db, p.lines, 'Пересчёт', true);
  const seen = new Set<ID>();
  for (const l of lines) {
    if (seen.has(l.productId)) fail(`${shortName(product(db, l.productId))} указан в пересчёте дважды`);
    seen.add(l.productId);
  }
  const docLines: StockDocLine[] = lines.map((l) => ({ productId: l.productId, qty: l.qty, expected: stockRow(db, l.productId, location)?.onHand ?? 0 }));
  const doc = newStockDoc(db, ctx, { kind: 'count', from: location, to: location, lines: docLines, comment: text(p.comment, 'Комментарий', false) || 'Пересчёт' });
  const deltas: StockDelta[] = [];
  const warn: string[] = [];
  let diffPos = 0;
  let diffNeg = 0;
  for (const l of docLines) {
    const d = l.qty - (l.expected ?? 0);
    if (d !== 0) deltas.push({ productId: l.productId, location, dOnHand: d, dReserved: 0, kind: 'count', docType: 'stockdoc', docId: doc.id });
    if (d > 0) diffPos += d;
    if (d < 0) diffNeg += d;
    const res = stockRow(db, l.productId, location)?.reserved ?? 0;
    if (l.qty < res) warn.push(`${shortName(product(db, l.productId))}: факт ${pcs(l.qty)} меньше резерва ${pcs(res)} — проверьте заказы`);
  }
  commitStock(db, deltas, ctx, { allowReserveOverOnHand: true });
  const parts = [deltas.length ? `Расхождений: ${deltas.length} поз., излишек ${pcs(diffPos)}, недостача ${pcs(-diffNeg)}` : 'Расхождений нет', ...warn];
  return { id: doc.id, info: parts.join('. ') };
}

function quarantineOf(db: DB, id: unknown): QuarantineItem {
  const q = typeof id === 'string' ? get(db, 'quarantine', id) : undefined;
  if (!q) fail('Товар на проверке не найден');
  if (q.state !== 'check') fail('По этому товару уже принято решение');
  return q;
}

/** В продажу после проверки возвращается только целый товар: «Не подошёл», «Привезли не то», «Не доставлен».
    Брак, истёкший срок и брак при приёмке — только списание. */
export function quarantineCanRelease(q: Pick<QuarantineItem, 'source' | 'reason'>): boolean {
  if (q.source === 'delivery_failed') return true;
  if (q.source === 'purchase_defect') return false;
  return q.reason === RETURN_REASONS.not_fit || q.reason === RETURN_REASONS.wrong_item || q.reason.startsWith(RETURN_REASONS.delivery_failed);
}

function quarantineRelease(db: DB, payload: { itemId: ID; comment?: string }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['warehouse'], 'Вернуть в продажу');
  const q = quarantineOf(db, p.itemId);
  if (!quarantineCanRelease(q)) fail(`Товар с причиной «${q.reason}» в продажу не возвращают — только списание`);
  const docType = q.source === 'purchase_defect' ? ('purchase' as const) : q.source === 'delivery_failed' ? ('delivery' as const) : ('return' as const);
  commitStock(db, [{ productId: q.productId, location: q.location, dOnHand: q.qty, dReserved: 0, kind: 'return_in', docType, docId: q.sourceId }], ctx);
  q.state = 'released';
  q.decidedAt = ctx.at;
  q.decidedBy = ctx.actorId;
  return { id: q.id, info: `${pcs(q.qty)} возвращено в продажу ${q.location === 'shop' ? 'в магазине' : 'на складе'}` };
}

function quarantineWriteoff(db: DB, payload: { itemId: ID; reason?: WriteoffReason; comment?: string }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['warehouse'], 'Списать с проверки');
  const q = quarantineOf(db, p.itemId);
  const reason = oneOf(p.reason ?? 'damage', Object.keys(WRITEOFF_REASONS) as WriteoffReason[], 'Причина');
  const doc = newStockDoc(db, ctx, {
    kind: 'writeoff',
    from: q.location,
    to: null,
    lines: [{ productId: q.productId, qty: q.qty, reason }],
    comment: text(p.comment, 'Комментарий', false) || `С проверки: ${q.reason}`,
  });
  q.state = 'written_off';
  q.decidedAt = ctx.at;
  q.decidedBy = ctx.actorId;
  audit(db, ctx, 'stock', doc.id, `Списан товар с проверки: ${q.qty} шт, ${q.reason}`);
  return { id: doc.id };
}

/* =====================================================================
   ЗАКУПКИ
   ===================================================================== */

function boxSizeOf(p: Product): number {
  const box = p.packs.find((x) => x.key === 'box') ?? p.packs.find((x) => x.key === 'pack');
  return box?.qty ?? 1;
}

function purchaseCreate(
  db: DB,
  payload: { supplierId: ID; lines: { productId: ID; boxes: number; boxSize?: number; price?: number }[]; expectedAt?: ISODate; location?: LocationKey; comment?: string },
  ctx: OpCtx,
): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['warehouse'], 'Заказ поставщику');
  const s = typeof p.supplierId === 'string' ? get(db, 'suppliers', p.supplierId) : undefined;
  if (!s) fail('Поставщик не найден');
  const seen = new Set<ID>();
  const lines = arr(p.lines, 'Закупка', 1, 400).map((x) => {
    const l = obj(x);
    const pr = product(db, l.productId);
    if (seen.has(pr.id)) fail(`${shortName(pr)} уже есть в закупке`);
    seen.add(pr.id);
    const boxes = posInt(l.boxes, 'Коробок');
    const boxSize = l.boxSize === undefined ? boxSizeOf(pr) : posInt(l.boxSize, 'Штук в коробке');
    const price = l.price === undefined ? (pr.cost ?? Math.round(pr.wholesalePrice * 0.7)) : posInt(l.price, 'Закупочная цена');
    return { productId: pr.id, boxSize, boxes, qty: boxes * boxSize, received: null, defect: 0, price, diffReason: null };
  });
  const n = nextNo(db, 'purchase');
  const pu: Purchase = {
    id: 'pu-' + n,
    number: n,
    supplierId: s.id,
    createdAt: ctx.at,
    expectedAt: p.expectedAt === undefined ? plusDays(dayOf(ctx), s.leadDays) : isoDate(p.expectedAt, 'Ожидаемая дата'),
    receivedAt: null,
    state: 'draft',
    location: oneOf(p.location ?? 'warehouse', LOCATIONS, 'Место'),
    lines,
    total: lines.reduce((z, l) => z + l.qty * l.price, 0),
    dueDate: null,
    authorId: ctx.actorId,
    approvedBy: null,
    comment: text(p.comment, 'Комментарий', false),
  };
  db.purchases.push(pu);
  const info = s.minOrder > 0 && pu.total < s.minOrder ? `Сумма ${rub(pu.total)} меньше минимального заказа поставщика ${rub(s.minOrder)}` : undefined;
  return { id: pu.id, info };
}

function purchaseApprove(db: DB, payload: { purchaseId: ID; expectedAt?: ISODate }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  const me = actor(db, ctx);
  if (!me.roles.includes('owner')) fail('Подтвердить закупку может только владелец');
  const pu = purchaseOf(db, p.purchaseId);
  if (pu.state !== 'draft') fail('Закупка уже подтверждена');
  const s = get(db, 'suppliers', pu.supplierId);
  pu.state = 'ordered';
  pu.approvedBy = me.id;
  pu.expectedAt = p.expectedAt !== undefined ? isoDate(p.expectedAt, 'Ожидаемая дата') : plusDays(dayOf(ctx), s?.leadDays ?? 3);
  audit(db, ctx, 'purchase', pu.id, `Закупка №${pu.number} у ${s?.name ?? 'поставщика'} на ${rub(pu.total)} подтверждена, ждём ${dayText(pu.expectedAt)}`);
  return { id: pu.id };
}

function purchaseReceive(
  db: DB,
  payload: { purchaseId: ID; lines: { productId: ID; received: number; defect?: number; diffReason?: string; expiry?: ISODate }[]; final?: boolean },
  ctx: OpCtx,
): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['warehouse'], 'Приёмка');
  const pu = purchaseOf(db, p.purchaseId);
  if (pu.state !== 'ordered' && pu.state !== 'partial') fail(pu.state === 'draft' ? 'Закупка ещё не подтверждена' : 'Закупка уже принята или отменена');
  const final = p.final === true;
  const plan = arr(p.lines, 'Приёмка', 1, 400).map((x) => {
    const l = obj(x);
    const pr = product(db, l.productId);
    const line = pu.lines.find((z) => z.productId === pr.id);
    if (!line) fail(`${shortName(pr)} нет в закупке`);
    const received = nonNegInt(l.received, 'Принято');
    const defect = l.defect === undefined ? line.defect : nonNegInt(l.defect, 'Брак');
    if (defect > received) fail(`${shortName(pr)}: брак больше принятого`);
    const prevReceived = line.received ?? 0;
    const goodDelta = received - defect - (prevReceived - line.defect);
    const defectDelta = defect - line.defect;
    if (goodDelta < 0 || defectDelta < 0) fail(`${shortName(pr)}: принятое нельзя уменьшить — оформите списание или возврат`);
    const diffReason = typeof l.diffReason === 'string' && l.diffReason.trim() ? l.diffReason.trim() : line.diffReason;
    const expiry = l.expiry === undefined ? undefined : isoDate(l.expiry, 'Срок годности');
    return { pr, line, received, defect, goodDelta, defectDelta, diffReason, expiry };
  });
  if (final) {
    for (const x of plan) {
      if (x.received !== x.line.qty && !x.diffReason) fail(`Укажите причину расхождения: ${shortName(x.pr)} — заказано ${pcs(x.line.qty)}, принято ${pcs(x.received)}`);
      if (x.defect > 0 && !x.diffReason) fail(`Укажите причину брака: ${shortName(x.pr)}`);
    }
  }
  const deltas: StockDelta[] = plan
    .filter((x) => x.goodDelta > 0)
    .map((x) => ({
      productId: x.pr.id,
      location: pu.location,
      dOnHand: x.goodDelta,
      dReserved: 0,
      kind: 'income' as const,
      docType: 'purchase' as const,
      docId: pu.id,
      expiry: x.pr.expiryTracked ? (x.expiry ?? plusDays(dayOf(ctx), 365)) : undefined,
    }));
  commitStock(db, deltas, ctx);
  for (const x of plan) {
    if (x.defectDelta > 0) {
      newQuarantine(db, ctx, { productId: x.pr.id, location: pu.location, qty: x.defectDelta, source: 'purchase_defect', sourceId: pu.id, reason: x.diffReason ?? 'Брак при приёмке' });
    }
    x.line.received = x.received;
    x.line.defect = x.defect;
    x.line.diffReason = x.diffReason;
    if (x.goodDelta > 0 && x.pr.cost !== null) x.pr.cost = x.line.price;
  }
  const all = pu.lines.every((l) => (l.received ?? 0) >= l.qty);
  const changed = deltas.length > 0 || plan.some((x) => x.defectDelta > 0);
  pu.state = final || all ? 'received' : 'partial';
  if (changed || final) pu.receivedAt = ctx.at;
  if (!pu.dueDate && pu.lines.some((l) => l.received !== null)) {
    const s = get(db, 'suppliers', pu.supplierId);
    pu.dueDate = plusDays(dayOf(ctx), s?.deferDays ?? 0);
  }
  pu.total = pu.lines.reduce((z, l) => z + (l.received === null ? l.qty : l.received - l.defect) * l.price, 0);
  const defects = plan.reduce((z, x) => z + x.defectDelta, 0);
  const parts = [
    changed ? `Принято на склад ${pcs(deltas.reduce((z, d) => z + d.dOnHand, 0))}` : 'Новых поступлений нет — движения не созданы',
    defects ? `брак ${pcs(defects)} отправлен на проверку` : '',
    pu.state === 'partial' ? 'остальное ожидается' : '',
  ].filter(Boolean);
  return { id: pu.id, info: parts.join(', ') };
}

function purchaseCancel(db: DB, payload: { purchaseId: ID; reason?: string }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['warehouse'], 'Отменить закупку');
  const pu = purchaseOf(db, p.purchaseId);
  if (pu.state !== 'draft' && pu.state !== 'ordered') fail('Отменить можно только непринятую закупку');
  pu.state = 'cancelled';
  audit(db, ctx, 'purchase', pu.id, `Закупка №${pu.number} отменена${p.reason ? ': ' + text(p.reason, 'Причина', false) : ''}`);
  return { id: pu.id };
}

export interface SuggestionLine {
  supplierId: ID;
  productId: ID;
  name: string;
  perDay: number; // продаётся в день
  available: number;
  reserved: number;
  expected: number;
  daysLeft: number | null; // хватит на … дней (null — продаж нет)
  leadDays: number;
  boxSize: number;
  boxes: number;
  qty: number;
  price: number;
  amount: number;
  reason: SuggestionReason; // только «почему» — цифры стоят в колонках
}

export type SuggestionReason = 'Кончится раньше поставки' | 'Кончится вскоре после поставки' | 'Ниже минимума' | 'Под оптовый заказ';

export interface SuggestionOptions {
  at?: string;
  /** На сколько дней после поставки закупать. */
  coverDays?: number;
  /** Товар, которого хватит дольше, не предлагаем (кроме «ниже минимума»). По умолчанию — срок поставки + SUGGEST_SAFETY_DAYS. */
  horizonDays?: number;
  /** Дополнительный запас сверх минимального остатка, штук (генератор держит на складе коробки под опт). */
  extraStock?: (p: Product, perDay: number, boxSize: number) => number;
}

/** Предложение на закупку: продажи за 30 дней, доступное, резерв, ожидаемое, срок поставки, кратность.
    Не предлагает товар, которого хватит дольше срока поставки + запаса, и товар без продаж за 30 дней — если он не ниже минимума. */
export function purchaseSuggestion(db: DB, supplierId?: ID, opts: SuggestionOptions = {}): SuggestionLine[] {
  const at = opts.at ?? db.meta.today + 'T23:59';
  const cover = opts.coverDays ?? 14;
  const day = at.slice(0, 10);
  const fromDay = plusDays(day, -SALES_WINDOW_DAYS);
  const span = Math.max(1, Math.min(SALES_WINDOW_DAYS, diffDays(db.meta.startDate, day)));
  const sold = new Map<ID, number>();
  for (let i = db.movements.length - 1; i >= 0; i--) {
    const m = db.movements[i];
    if (m.at.slice(0, 10) < fromDay) {
      if (m.at.slice(0, 10) < plusDays(fromDay, -5)) break; // движения идут по времени — дальше старые
      continue;
    }
    if (m.at > at) continue;
    if (m.kind === 'sale' || m.kind === 'ship') sold.set(m.productId, (sold.get(m.productId) ?? 0) - m.dOnHand);
  }
  const si = stockIndex(db);
  const out: SuggestionLine[] = [];
  for (const p of db.products) {
    if (!p.active || !p.supplierIds.length) continue;
    const sid = supplierId ?? p.supplierIds[0];
    if (supplierId && !p.supplierIds.includes(supplierId)) continue;
    const s = get(db, 'suppliers', sid);
    if (!s) continue;
    const st = si.get(p.id);
    const avail = Math.max(0, st?.total.available ?? 0);
    const reserved = st?.total.reserved ?? 0;
    const expected = st?.expected ?? 0;
    const perDay = (sold.get(p.id) ?? 0) / span;
    const boxSize = boxSizeOf(p);
    const horizon = opts.horizonDays ?? s.leadDays + SUGGEST_SAFETY_DAYS;
    const target = perDay * (s.leadDays + cover) + p.minStock + (opts.extraStock ? opts.extraStock(p, perDay, boxSize) : 0);
    // нужен ли товар при таком доступном остатке
    const needs = (free: number): boolean => {
      const below = isBelowMin(free, p.minStock);
      if (perDay === 0 && !below) return false; // не продаётся и не ниже минимума
      if (!below && (free + expected) / perDay > horizon) return false; // хватит дольше срока поставки + запаса
      return target - free - expected > 0.5;
    };
    if (!needs(avail)) continue;
    const need = target - avail - expected;
    const boxes = Math.max(1, Math.ceil(need / boxSize));
    const price = p.cost ?? Math.round(p.wholesalePrice * 0.7);
    const daysLeft = perDay > 0 ? Math.floor(avail / perDay) : null;
    const reason: SuggestionReason =
      reserved > 0 && !needs(avail + reserved)
        ? 'Под оптовый заказ'
        : isBelowMin(avail, p.minStock)
          ? 'Ниже минимума'
          : daysLeft !== null && daysLeft <= s.leadDays
            ? 'Кончится раньше поставки'
            : 'Кончится вскоре после поставки';
    out.push({
      supplierId: s.id,
      productId: p.id,
      name: p.name,
      perDay,
      available: avail,
      reserved,
      expected,
      daysLeft,
      leadDays: s.leadDays,
      boxSize,
      boxes,
      qty: boxes * boxSize,
      price,
      amount: boxes * boxSize * price,
      reason,
    });
  }
  out.sort((a, b) => (a.daysLeft ?? 9999) - a.leadDays - ((b.daysLeft ?? 9999) - b.leadDays) || b.perDay - a.perDay);
  return out;
}

/* =====================================================================
   ВОЗВРАТЫ ПО ЗАКАЗАМ
   ===================================================================== */

function returnCreate(
  db: DB,
  payload: { orderId: ID; lines: { productId: ID; qty: number; reason: ReturnReason }[]; refund?: boolean; method?: PayMethod; account?: AccountKey; comment?: string },
  ctx: OpCtx,
): OpResult {
  requireRole(db, ctx, ['manager', 'warehouse', 'accountant'], 'Оформить возврат');
  return returnFromOrder(db, payload, ctx);
}

function returnFromOrder(
  db: DB,
  payload: { orderId: ID; lines: { productId: ID; qty: number; reason: ReturnReason }[]; refund?: boolean; method?: PayMethod; account?: AccountKey; comment?: string },
  ctx: OpCtx,
): OpResult {
  const p = obj(payload);
  const o = orderOf(db, p.orderId);
  if (o.state === 'cancelled') fail('Заказ отменён');
  const returned = orderReturns(db).get(o.id)?.byProduct ?? new Map<ID, number>();
  const shipped = new Map<ID, number>();
  for (const l of o.lines) shipped.set(l.productId, (shipped.get(l.productId) ?? 0) + l.shipped);
  const used = new Map<ID, number>();
  const lines: ReturnLine[] = arr(p.lines, 'Возврат').map((x) => {
    const l = obj(x);
    const pr = product(db, l.productId);
    const qty = posInt(l.qty, 'Количество');
    const reason = oneOf(l.reason ?? 'other', RETURN_REASON_KEYS, 'Причина');
    const left = (shipped.get(pr.id) ?? 0) - (returned.get(pr.id) ?? 0) - (used.get(pr.id) ?? 0);
    if (qty > left) fail(`${shortName(pr)}: отгружено и не возвращено ${pcs(left)}, а возвращают ${pcs(qty)}`);
    used.set(pr.id, (used.get(pr.id) ?? 0) + qty);
    const ol = o.lines.find((z) => z.productId === pr.id)!;
    return { productId: pr.id, qty, price: ol.price, reason };
  });
  const amount = lines.reduce((z, l) => z + l.qty * l.price, 0);
  const before = orderPayment(db, o);
  const overAfter = Math.max(0, before.paid - Math.max(0, before.amount - amount));
  const refundAmount = p.refund === true ? Math.min(amount, overAfter) : 0;
  const method = oneOf(p.method ?? 'transfer', PAY_METHODS, 'Способ');
  const account = oneOf(p.account ?? defaultAccount(method), ACCOUNTS, 'Касса или счёт');
  if (refundAmount > 0) needMoney(db, account, refundAmount);
  const n = nextNo(db, 'return');
  const ret: Return = {
    id: 'ret-' + n,
    number: n,
    at: ctx.at,
    source: 'order',
    receiptId: null,
    orderId: o.id,
    clientId: o.clientId,
    location: o.location,
    lines,
    amount,
    refundPaymentId: null,
    authorId: ctx.actorId,
    comment: text(p.comment, 'Комментарий', false),
  };
  db.returns.push(ret);
  for (const l of lines) {
    newQuarantine(db, ctx, { productId: l.productId, location: o.location, qty: l.qty, source: 'return', sourceId: ret.id, reason: RETURN_REASONS[l.reason] });
  }
  let info: string;
  if (refundAmount > 0) {
    const pay = newPayment(db, ctx, {
      kind: 'refund',
      direction: 'out',
      clientId: o.clientId,
      amount: refundAmount,
      method,
      account,
      allocations: [{ orderId: o.id, amount: refundAmount }],
      returnId: ret.id,
      comment: `Возврат денег по возврату №${n} (заказ №${o.number})`,
    });
    ret.refundPaymentId = pay.id;
    info = `Возврат №${n} на ${rub(amount)}: деньги ${rub(refundAmount)} возвращены клиенту`;
  } else if (overAfter > 0) {
    info = `Возврат №${n} на ${rub(amount)}: переплата ${rub(Math.min(amount, overAfter))} осталась у клиента авансом`;
  } else {
    info = `Возврат №${n} на ${rub(amount)}: долг клиента уменьшен`;
  }
  event(o, ctx, `Возврат №${n}: ${lines.length} поз. на ${rub(amount)}, товар на проверке`);
  audit(db, ctx, 'order', o.id, `Возврат №${n} по заказу №${o.number} на ${rub(amount)}`);
  return { id: ret.id, info: info + '. Товар на проверке' };
}

/* =====================================================================
   ДОСТАВКА
   ===================================================================== */

const INTERVAL_RE = /^\d{2}:\d{2}–\d{2}:\d{2}$/;

function deliveryCreate(
  db: DB,
  payload: {
    orderId: ID;
    date: ISODate;
    interval?: string;
    pointId?: ID;
    places?: number;
    weightKg?: number;
    collect?: number;
    fee?: number;
    cost?: number;
    comment?: string;
    courierId?: ID;
    routeOrder?: number;
  },
  ctx: OpCtx,
): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['manager', 'dispatcher'], 'Назначить доставку');
  const o = orderOf(db, p.orderId);
  if (o.state !== 'confirmed' && o.state !== 'closed') fail('Доставку можно оформить только по подтверждённому заказу');
  if (o.deliveryId) {
    const prev = get(db, 'deliveries', o.deliveryId);
    if (prev && prev.state !== 'delivered' && prev.state !== 'returned') fail(`У заказа уже есть доставка №${prev.number}`);
  }
  const client = clientOf(db, o.clientId);
  const pointId = pointCheck(client, p.pointId ?? o.pointId);
  const pt: ClientPoint | undefined = client.points.find((x) => x.id === pointId);
  if (!pt) fail('У клиента нет адреса доставки — добавьте точку');
  const date = isoDate(p.date, 'Дата доставки');
  const interval = p.interval === undefined ? '10:00–14:00' : String(p.interval).replace('-', '–');
  if (!INTERVAL_RE.test(interval)) fail('Интервал: в виде «10:00–13:00»');
  const fee = p.fee === undefined ? (o.total >= db.settings.freeDeliveryFrom ? 0 : db.settings.deliveryFee) : nonNegInt(p.fee, 'Стоимость для клиента');
  const pay = orderPayment(db, o);
  // к получению — остаток по заказу у клиента без отсрочки; плата за доставку хранится отдельно (fee)
  const collect = p.collect === undefined ? (client.deferDays === 0 ? Math.max(0, pay.due - pay.pending) : 0) : nonNegInt(p.collect, 'К получению');
  let weight = 0;
  let places = 0;
  for (const l of o.lines) {
    const pr = get(db, 'products', l.productId);
    weight += (l.qty * (pr?.weightG ?? 300)) / 1000;
    places += l.pack === 'box' ? l.packQty : Math.ceil(l.qty / 12);
  }
  let courierId: ID | null = null;
  if (p.courierId !== undefined && p.courierId !== null) {
    if (!hasRole(db, String(p.courierId), 'courier')) fail('Назначить можно только курьера');
    courierId = String(p.courierId);
  }
  const n = nextNo(db, 'delivery');
  const contact: ClientContact | undefined = client.contacts[0];
  const d: Delivery = {
    id: 'd-' + n,
    number: n,
    orderId: o.id,
    clientId: client.id,
    pointId: pt.id,
    address: pt.address,
    district: pt.district,
    lat: pt.lat,
    lng: pt.lng,
    contactName: contact?.name ?? client.name,
    contactPhone: contact?.phone ?? client.phone,
    date,
    interval,
    courierId,
    state: courierId ? 'assigned' : 'waiting',
    routeOrder: courierId && p.routeOrder !== undefined ? posInt(p.routeOrder, 'Порядок') : 0,
    places: p.places === undefined ? Math.max(1, places) : posInt(p.places, 'Мест'),
    weightKg: p.weightKg === undefined ? Math.round(weight * 10) / 10 : Number(p.weightKg),
    cost: p.cost === undefined ? (pt.district.startsWith('Трусов') ? 450 : 300) : nonNegInt(p.cost, 'Стоимость доставки'),
    fee,
    collect,
    collected: 0,
    collectedMethod: null,
    handedIn: true,
    comment: text(p.comment, 'Комментарий', false),
    attempts: [],
  };
  db.deliveries.push(d);
  if (courierId && p.routeOrder === undefined) placeInRoute(db, d);
  o.deliveryId = d.id;
  o.fulfillment = 'delivery';
  event(o, ctx, `Доставка №${n} на ${dayText(date)}, ${interval}${collect ? `, к получению ${rub(collect)}` : ''}`);
  return { id: d.id };
}

/** Поставить доставку в маршрут курьера на день по началу интервала: остальные сдвигаются, номера идут подряд. */
function placeInRoute(db: DB, d: Delivery): void {
  if (!d.courierId) {
    d.routeOrder = 0;
    return;
  }
  const list = db.deliveries
    .filter((x) => x !== d && x.courierId === d.courierId && x.date === d.date && x.routeOrder > 0)
    .sort((a, b) => a.routeOrder - b.routeOrder);
  const start = d.interval.slice(0, 5);
  let pos = list.findIndex((x) => x.interval.slice(0, 5) > start);
  if (pos < 0) pos = list.length;
  list.splice(pos, 0, d);
  list.forEach((x, i) => (x.routeOrder = i + 1));
}

function deliveryAssign(db: DB, payload: { deliveryId: ID; courierId: ID; date?: ISODate; interval?: string; routeOrder?: number }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['dispatcher', 'manager'], 'Назначить курьера');
  const d = deliveryOf(db, p.deliveryId);
  if (d.state !== 'waiting' && d.state !== 'assigned' && d.state !== 'failed') fail('Доставку уже нельзя переназначить');
  const courier = get(db, 'employees', String(p.courierId ?? ''));
  if (!courier || !courier.roles.includes('courier')) fail('Назначить можно только курьера');
  if (!courier.active) fail(`${courier.name} не работает`);
  const date = p.date === undefined ? d.date : isoDate(p.date, 'Дата');
  const routeOrder = p.routeOrder === undefined ? null : posInt(p.routeOrder, 'Порядок');
  const wasFailed = d.state === 'failed';
  if (p.interval !== undefined) {
    const iv = String(p.interval).replace('-', '–');
    if (!INTERVAL_RE.test(iv)) fail('Интервал: в виде «10:00–13:00»');
    d.interval = iv;
  }
  d.courierId = courier.id;
  d.date = date;
  d.state = 'assigned';
  d.delayUntil = null;
  d.wish = null;
  if (routeOrder === null) placeInRoute(db, d);
  else d.routeOrder = routeOrder;
  const o = get(db, 'orders', d.orderId);
  if (o) event(o, ctx, `${wasFailed ? 'Повторная доставка' : 'Доставка'} №${d.number}: курьер ${courier.name}, ${dayText(date)}`);
  return { id: d.id };
}

function courierMayAct(db: DB, ctx: OpCtx, d: Delivery, what: string): void {
  const me = requireRole(db, ctx, ['courier', 'dispatcher'], what);
  if (me.roles.includes('courier') && !me.roles.includes('dispatcher') && !me.roles.includes('owner') && d.courierId !== me.id) {
    fail('Это доставка другого курьера');
  }
}

function deliveryStart(db: DB, payload: { deliveryId: ID }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  const d = deliveryOf(db, p.deliveryId);
  courierMayAct(db, ctx, d, 'Выезд');
  if (d.state !== 'assigned') fail(d.state === 'waiting' ? 'Сначала назначьте курьера' : 'Доставка уже в пути или завершена');
  const o = orderOf(db, d.orderId);
  let info: string | undefined;
  if (o.state === 'confirmed') info = shipOrder(db, o, undefined, ctx);
  d.state = 'on_way';
  event(o, ctx, `Курьер выехал: ${empName(db, d.courierId)}`);
  return { id: d.id, info };
}

function deliveryDeliver(db: DB, payload: { deliveryId: ID; collected?: number; method?: PayMethod; comment?: string; returned?: { productId: ID; qty: number }[] }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  const d = deliveryOf(db, p.deliveryId);
  courierMayAct(db, ctx, d, 'Вручение');
  if (d.state !== 'on_way') fail(d.state === 'assigned' ? 'Сначала отметьте выезд' : 'Доставка не в пути');
  const o = orderOf(db, d.orderId);
  const collected = p.collected === undefined ? 0 : nonNegInt(p.collected, 'Получено');
  const method = oneOf(p.method ?? 'cash', PAY_METHODS, 'Способ оплаты');
  if (collected > 0) {
    const account: AccountKey = method === 'cash' ? 'courier_cash' : 'bank';
    pushClientPayment(db, ctx, {
      clientId: o.clientId,
      amount: collected,
      method,
      account,
      status: method === 'transfer' ? 'pending' : 'posted',
      allocations: autoAllocate(db, o.clientId, collected, o.id),
      comment: `Получено курьером при доставке №${d.number}`,
      idempotencyKey: null,
      deliveryId: d.id,
    });
    d.collected += collected;
    d.collectedMethod = method;
    if (method === 'cash') d.handedIn = false;
  }
  d.attempts.push({ at: ctx.at, courierId: d.courierId ?? ctx.actorId, result: 'delivered', reason: null });
  d.state = 'delivered';
  if (p.comment !== undefined) d.comment = text(p.comment, 'Комментарий', false) || d.comment;
  if (o.ship === 'shipped') o.ship = 'delivered';
  event(o, ctx, `Доставлен${collected ? `, курьер получил ${rub(collected)} (${PAY_METHOD_NAMES[method].toLowerCase()})` : ''}`);
  const notes: string[] = [];
  // часть товара клиент не взял: курьер везёт её обратно — оформляем возврат (товар на проверку, долг клиента меньше)
  if (Array.isArray(p.returned) && p.returned.length) {
    const lines = (p.returned as unknown[]).map((x) => {
      const l = obj(x);
      return { productId: String(l.productId ?? ''), qty: posInt(l.qty, 'Не взяли, шт'), reason: 'not_taken' as ReturnReason };
    });
    const r = returnFromOrder(db, { orderId: o.id, lines, comment: `Не взяли при доставке №${d.number}` }, ctx);
    const ret = get(db, 'returns', r.id ?? '');
    if (ret) notes.push(`Не взяли товара на ${rub(ret.amount)} — курьер везёт его обратно, долг клиента уменьшен`);
  }
  if (d.collect > 0 && collected < d.collect) notes.push(`Получено ${rub(collected)} из ${rub(d.collect)} — остаток в долге клиента`);
  if (method === 'transfer' && collected > 0) notes.push('Перевод ждёт подтверждения банка');
  return { id: d.id, info: notes.join('. ') || undefined };
}

function deliveryFail(db: DB, payload: { deliveryId: ID; reason: string; comment?: string; wish?: { date: ISODate; interval: string } }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  const d = deliveryOf(db, p.deliveryId);
  courierMayAct(db, ctx, d, 'Неудачная попытка');
  if (d.state !== 'on_way' && d.state !== 'assigned') fail('Отметить неудачу можно только для доставки в пути');
  const reason = text(p.reason, 'Причина');
  const comment = text(p.comment, 'Комментарий', false);
  let wishText = '';
  if (p.wish !== undefined && p.wish !== null) {
    const w = obj(p.wish);
    const date = isoDate(w.date, 'Когда привезти');
    const iv = String(w.interval ?? '').replace('-', '–');
    if (!INTERVAL_RE.test(iv)) fail('Интервал: в виде «10:00–13:00»');
    wishText = `клиент просит ${dayText(date)}, ${iv}`;
    d.wish = { date, interval: iv };
  }
  d.attempts.push({ at: ctx.at, courierId: d.courierId ?? ctx.actorId, result: 'failed', reason });
  d.state = 'failed';
  d.delayUntil = null;
  if (comment || wishText) addNote(d, ctx, [wishText && wishText.charAt(0).toUpperCase() + wishText.slice(1), comment].filter(Boolean).join('. '));
  const o = get(db, 'orders', d.orderId);
  if (o) event(o, ctx, `Доставка не удалась: ${reason}${wishText ? `; ${wishText}` : ''}`);
  return { id: d.id, info: 'Диспетчер решит, когда привезти снова' };
}

function addNote(d: Delivery, ctx: OpCtx, txt: string): void {
  (d.notes ??= []).push({ at: ctx.at, actorId: ctx.actorId, text: txt });
}

function deliveryReschedule(db: DB, payload: { deliveryId: ID; date: ISODate; interval?: string; courierId?: ID; reason?: string }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['dispatcher', 'manager'], 'Перенести доставку');
  const d = deliveryOf(db, p.deliveryId);
  if (d.state === 'on_way' || d.state === 'delivered' || d.state === 'returned') fail('Эту доставку перенести нельзя');
  const wasFailedR = d.state === 'failed';
  const date = isoDate(p.date, 'Новая дата');
  if (p.courierId && !hasRole(db, String(p.courierId), 'courier')) fail('Назначить можно только курьера');
  if (p.interval !== undefined) {
    const iv = String(p.interval).replace('-', '–');
    if (!INTERVAL_RE.test(iv)) fail('Интервал: в виде «10:00–13:00»');
    d.interval = iv;
  }
  d.date = date;
  if (p.courierId) {
    d.courierId = String(p.courierId);
    d.state = 'assigned';
    placeInRoute(db, d);
  } else {
    d.courierId = null;
    d.state = 'waiting';
    d.routeOrder = 0;
  }
  d.delayUntil = null;
  d.wish = null;
  const reason = text(p.reason, 'Причина переноса', false);
  const what = wasFailedR ? 'Повторная доставка' : 'Перенесена';
  addNote(d, ctx, `${what}: ${dayText(date)}, ${d.interval}${reason ? `. ${reason}` : ''}`);
  const o = get(db, 'orders', d.orderId);
  if (o) event(o, ctx, `${wasFailedR ? 'Повторная доставка' : 'Доставка перенесена'}: ${dayText(date)}${reason ? ` — ${reason}` : ''}`);
  return { id: d.id };
}

/** Курьер задерживается: ожидаемое время и причина — видно диспетчеру и в карточке доставки. */
function deliveryDelay(db: DB, payload: { deliveryId: ID; until: string; reason: string }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  const d = deliveryOf(db, p.deliveryId);
  courierMayAct(db, ctx, d, 'Задержка');
  if (d.state !== 'assigned' && d.state !== 'on_way') fail('Задержку можно отметить только у доставки в работе');
  const until = String(p.until ?? '');
  if (!/^\d{2}:\d{2}$/.test(until)) fail('Время приезда: в виде «15:30»');
  const reason = text(p.reason, 'Причина задержки');
  d.delayUntil = until;
  addNote(d, ctx, `Задерживается до ${until}: ${reason}`);
  const o = get(db, 'orders', d.orderId);
  if (o) event(o, ctx, `Курьер задерживается до ${until}: ${reason}`);
  return { id: d.id, info: 'Диспетчер увидит задержку' };
}

function deliveryReturnToStock(db: DB, payload: { deliveryId: ID; comment?: string }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['dispatcher', 'warehouse'], 'Возврат на склад');
  const d = deliveryOf(db, p.deliveryId);
  if (d.state !== 'failed') fail('На склад возвращают товар после неудачной доставки');
  const o = orderOf(db, d.orderId);
  const returned = orderReturns(db).get(o.id)?.byProduct ?? new Map<ID, number>();
  const lastReason = d.attempts[d.attempts.length - 1]?.reason ?? 'не доставлен';
  const lines: ReturnLine[] = [];
  const left = new Map(returned);
  for (const l of o.lines) {
    const already = Math.min(l.shipped, left.get(l.productId) ?? 0);
    left.set(l.productId, (left.get(l.productId) ?? 0) - already);
    const q = l.shipped - already;
    if (q > 0) lines.push({ productId: l.productId, qty: q, price: l.price, reason: 'delivery_failed' });
  }
  if (!lines.length) fail('По заказу нечего возвращать');
  const amount = lines.reduce((z, l) => z + l.qty * l.price, 0);
  const n = nextNo(db, 'return');
  const ret: Return = {
    id: 'ret-' + n,
    number: n,
    at: ctx.at,
    source: 'order',
    receiptId: null,
    orderId: o.id,
    clientId: o.clientId,
    location: o.location,
    lines,
    amount,
    refundPaymentId: null,
    authorId: ctx.actorId,
    comment: text(p.comment, 'Комментарий', false) || `Не доставлен: ${lastReason}`,
  };
  db.returns.push(ret);
  for (const l of lines) {
    newQuarantine(db, ctx, { productId: l.productId, location: o.location, qty: l.qty, source: 'delivery_failed', sourceId: d.id, reason: `Не доставлен: ${lastReason}` });
  }
  const pay = orderPayment(db, o);
  for (const l of o.lines) l.shipped = 0;
  o.ship = 'none';
  o.pick = 'none';
  o.state = 'cancelled';
  o.dueDate = null;
  d.state = 'returned';
  event(o, ctx, `Возвращён на склад после неудачной доставки, заказ отменён. Товар на проверке (возврат №${n})`);
  return { id: ret.id, info: pay.paid > 0 ? `Оплата ${rub(pay.paid)} осталась авансом клиента` : undefined };
}

function courierHandIn(db: DB, payload: { courierId?: ID; counted?: number; comment?: string } | undefined, ctx: OpCtx): OpResult {
  const p = obj(payload ?? {});
  const me = requireRole(db, ctx, ['courier', 'dispatcher', 'seller', 'accountant'], 'Сдача денег курьером');
  const courierId = typeof p.courierId === 'string' ? p.courierId : me.id;
  const courier = get(db, 'employees', courierId);
  if (!courier || !courier.roles.includes('courier')) fail('Курьер не найден');
  if (me.roles.includes('courier') && me.roles.length === 1 && me.id !== courierId) fail('Сдать можно только свои деньги');
  const list = db.deliveries.filter((d) => d.courierId === courierId && d.collectedMethod === 'cash' && d.collected > 0 && !d.handedIn);
  const sum = list.reduce((z, d) => z + d.collected, 0);
  if (sum === 0) fail('Курьеру нечего сдавать');
  needMoney(db, 'courier_cash', sum);
  // пересчитали меньше, чем курьер получил по доставкам: принимаем пересчитанное, разницу записываем недостачей на курьере
  const counted = p.counted === undefined ? sum : nonNegInt(p.counted, 'Пересчитано');
  if (counted > sum) fail(`Пересчитано ${rub(counted)} — больше, чем курьер получил по доставкам (${rub(sum)}). Проверьте сумму`);
  const shortage = sum - counted;
  const reason = text(p.comment, 'Комментарий', false);
  if (shortage > 0 && !reason) fail('Недостача: напишите, что сказал курьер');
  let payId: ID | null = null;
  if (counted > 0) {
    const pay = newPayment(db, ctx, {
      kind: 'transfer',
      direction: 'out',
      amount: counted,
      method: 'cash',
      account: 'courier_cash',
      toAccount: 'shop_cash',
      deliveryId: list[list.length - 1].id,
      comment: `Сдал курьер ${courier.name}: ${list.length} ${list.length === 1 ? 'доставка' : list.length < 5 ? 'доставки' : 'доставок'}`,
    });
    payId = pay.id;
  }
  if (shortage > 0) {
    const loss = newPayment(db, ctx, {
      kind: 'expense',
      direction: 'out',
      amount: shortage,
      method: 'cash',
      account: 'courier_cash',
      expenseCategory: 'Недостача',
      comment: `Недостача у курьера ${courier.name} при сдаче денег: ${reason}`,
    });
    payId ??= loss.id;
    audit(db, ctx, 'payment', loss.id, `Недостача ${rub(shortage)} у курьера ${courier.name}: ${reason}`);
  }
  for (const d of list) d.handedIn = true;
  return { id: payId!, info: shortage > 0 ? `Принято ${rub(counted)}, недостача ${rub(shortage)} записана на курьера` : `Принято ${rub(sum)} в кассу магазина` };
}

/* =====================================================================
   ВИЗИТЫ ПРЕДСТАВИТЕЛЕЙ
   ===================================================================== */

function visitPlan(db: DB, payload: { repId?: ID; clientId: ID; pointId?: ID; date: ISODate; time: string; routeOrder?: number; comment?: string }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  const me = requireRole(db, ctx, ['rep', 'manager'], 'Запланировать визит');
  const repId = typeof p.repId === 'string' ? p.repId : me.id;
  if (!hasRole(db, repId, 'rep')) fail('Визиты планируются представителю');
  const client = clientOf(db, p.clientId);
  if (client.ownerId !== repId) fail('Клиент закреплён за другим сотрудником');
  const pointId = pointCheck(client, p.pointId);
  const date = isoDate(p.date, 'Дата визита');
  const time = String(p.time ?? '');
  if (!/^\d{2}:\d{2}$/.test(time)) fail('Время визита: в виде «10:30»');
  // в маршруте дня клиент один раз, даже если у него несколько точек
  if (db.visits.some((x) => x.repId === repId && x.date === date && x.clientId === client.id)) fail(`${client.name} уже в маршруте на ${dayText(date)}`);
  let order = 0;
  for (const v of db.visits) if (v.repId === repId && v.date === date && v.routeOrder > order) order = v.routeOrder;
  const v: Visit = {
    id: nextId(db, 'visit', 'v-'),
    repId,
    clientId: client.id,
    pointId,
    date,
    time,
    routeOrder: p.routeOrder === undefined ? order + 1 : posInt(p.routeOrder, 'Порядок'),
    state: 'planned',
    result: null,
    refusalReason: null,
    comment: text(p.comment, 'Комментарий', false),
    orderId: null,
    doneAt: null,
  };
  db.visits.push(v);
  return { id: v.id };
}

function visitComplete(
  db: DB,
  payload: { visitId: ID; result?: VisitResult; refusalReason?: string; comment?: string; orderId?: ID; missed?: boolean },
  ctx: OpCtx,
): OpResult {
  const p = obj(payload);
  const me = requireRole(db, ctx, ['rep'], 'Отметить визит');
  const v = typeof p.visitId === 'string' ? get(db, 'visits', p.visitId) : undefined;
  if (!v) fail('Визит не найден');
  if (v.state !== 'planned') fail('Визит уже отмечен');
  if (!me.roles.includes('owner') && v.repId !== me.id) fail('Это визит другого представителя');
  const comment = text(p.comment, 'Комментарий', false);
  if (p.missed === true) {
    v.state = 'missed';
    v.comment = comment || v.comment;
    v.doneAt = ctx.at;
    return { id: v.id };
  }
  const result = oneOf(p.result, ['order', 'callback', 'refusal'] as const, 'Результат визита');
  let refusalReason: string | null = null;
  let orderId: ID | null = null;
  if (result === 'refusal') refusalReason = text(p.refusalReason, 'Причина отказа');
  if (result === 'order') {
    const o = orderOf(db, p.orderId);
    if (o.clientId !== v.clientId) fail('Заявка другого клиента');
    orderId = o.id;
  }
  v.state = 'done';
  v.result = result;
  v.refusalReason = refusalReason;
  v.orderId = orderId;
  v.comment = comment || v.comment;
  v.doneAt = ctx.at;
  return { id: v.id };
}

/* =====================================================================
   ЗАДАЧИ
   ===================================================================== */

function taskCreate(
  db: DB,
  payload: { title: string; assigneeId: ID; due: ISODate; dueTime?: string | null; priority?: 'normal' | 'high'; link?: TaskLink | null; kind?: TaskKind },
  ctx: OpCtx,
): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['seller', 'manager', 'rep', 'accountant', 'warehouse', 'dispatcher', 'courier'], 'Создать задачу');
  const title = text(p.title, 'Задача');
  const assignee = get(db, 'employees', String(p.assigneeId ?? ''));
  if (!assignee) fail('Исполнитель не найден');
  const due = isoDate(p.due, 'Срок');
  const dueTime = p.dueTime === undefined || p.dueTime === null ? null : String(p.dueTime);
  if (dueTime !== null && !/^\d{2}:\d{2}$/.test(dueTime)) fail('Время: в виде «15:00»');
  let link: TaskLink | null = null;
  if (p.link) {
    const l = obj(p.link);
    const type = oneOf(l.type, ['client', 'order', 'delivery', 'product', 'purchase', 'payment', 'supplier'] as const, 'Связь');
    const key = ({ client: 'clients', order: 'orders', delivery: 'deliveries', product: 'products', purchase: 'purchases', payment: 'payments', supplier: 'suppliers' } as const)[type];
    if (!get(db, key, String(l.id ?? ''))) fail('Связанная запись не найдена');
    link = { type, id: String(l.id) };
  }
  const t: Task = {
    id: nextId(db, 'task', 't-'),
    title,
    assigneeId: assignee.id,
    authorId: ctx.actorId,
    due,
    dueTime,
    priority: p.priority === 'high' ? 'high' : 'normal',
    state: 'open',
    link,
    createdAt: ctx.at,
    doneAt: null,
    ...(p.kind !== undefined ? { kind: oneOf(p.kind, TASK_KINDS, 'Вид задачи') } : {}),
  };
  db.tasks.push(t);
  if (t.kind === 'order_returned' && link?.type === 'order') {
    const o = get(db, 'orders', link.id);
    if (o) event(o, ctx, `Не согласовано, вернули менеджеру: ${title.replace(/^[^:]*:\s*/, '')}`);
  }
  if (t.kind === 'approve_order' && link?.type === 'order') {
    const o = get(db, 'orders', link.id);
    if (o) event(o, ctx, 'Отправлен владельцу на согласование');
    for (const x of db.tasks) if (x.state === 'open' && x.kind === 'order_returned' && x.link?.type === 'order' && x.link.id === link.id) { x.state = 'done'; x.doneAt = ctx.at; }
  }
  return { id: t.id };
}

function taskOf(db: DB, id: unknown): Task {
  const t = typeof id === 'string' ? get(db, 'tasks', id) : undefined;
  if (!t) fail('Задача не найдена');
  return t;
}

function taskComplete(db: DB, payload: { taskId: ID }, ctx: OpCtx): OpResult {
  const t = taskOf(db, obj(payload).taskId);
  actorAny(db, ctx);
  if (t.state === 'done') fail('Задача уже выполнена');
  t.state = 'done';
  t.doneAt = ctx.at;
  return { id: t.id };
}

function taskReopen(db: DB, payload: { taskId: ID }, ctx: OpCtx): OpResult {
  const t = taskOf(db, obj(payload).taskId);
  actorAny(db, ctx);
  if (t.state === 'open') fail('Задача и так открыта');
  t.state = 'open';
  t.doneAt = null;
  return { id: t.id };
}

function actorAny(db: DB, ctx: OpCtx): Employee {
  const e = get(db, 'employees', ctx.actorId);
  if (!e) fail('Сотрудник не найден');
  return e;
}

/* =====================================================================
   ЦЕНЫ, АКЦИИ, КАТАЛОГ
   ===================================================================== */

function setPrices(db: DB, ctx: OpCtx, p: Product, retail: number, wholesale: number): void {
  if (wholesale > retail) fail('Оптовая цена не может быть выше розничной');
  if (retail === p.retailPrice && wholesale === p.wholesalePrice) fail('Цена не изменилась');
  db.priceChanges.push({
    id: nextId(db, 'priceChange', 'pc-'),
    at: ctx.at,
    productId: p.id,
    retailFrom: p.retailPrice,
    retailTo: retail,
    wholesaleFrom: p.wholesalePrice,
    wholesaleTo: wholesale,
    authorId: ctx.actorId,
  });
  const parts: string[] = [];
  if (retail !== p.retailPrice) parts.push(`розница: была ${rub(p.retailPrice)}, стала ${rub(retail)}`);
  if (wholesale !== p.wholesalePrice) parts.push(`опт: был ${rub(p.wholesalePrice)}, стал ${rub(wholesale)}`);
  audit(db, ctx, 'price', p.id, `Цена ${shortName(p)}: ${parts.join(', ')}`);
  p.retailPrice = retail;
  p.wholesalePrice = wholesale;
}

function priceSet(db: DB, payload: { productId: ID; retailPrice?: number; wholesalePrice?: number }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, [], 'Изменить цену');
  const pr = product(db, p.productId);
  const retail = p.retailPrice === undefined ? pr.retailPrice : posInt(p.retailPrice, 'Розничная цена');
  const wholesale = p.wholesalePrice === undefined ? pr.wholesalePrice : posInt(p.wholesalePrice, 'Оптовая цена');
  setPrices(db, ctx, pr, retail, wholesale);
  const warn = pr.cost !== null && wholesale < Math.ceil((pr.cost * (100 + db.settings.minMarginPct)) / 100) ? 'Оптовая цена ниже минимальной наценки' : undefined;
  return { id: pr.id, info: warn ? `${warn}. История заказов не меняется` : 'История заказов не меняется' };
}

function promoCreate(
  db: DB,
  payload: { name: string; target: Promo['target']; kind: 'percent' | 'price'; value: number; start: ISODate; end: ISODate; audience?: Promo['audience']; active?: boolean },
  ctx: OpCtx,
): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, [], 'Создать акцию');
  const name = text(p.name, 'Название акции');
  const t = obj(p.target);
  let target: Promo['target'];
  if (t.type === 'products') {
    const ids = arr(t.ids, 'Товары акции').map((id) => product(db, id).id);
    target = { type: 'products', ids };
  } else if (t.type === 'category') {
    if (!get(db, 'categories', String(t.id ?? ''))) fail('Категория не найдена');
    target = { type: 'category', id: String(t.id) };
  } else if (t.type === 'brand') {
    if (!get(db, 'brands', String(t.id ?? ''))) fail('Бренд не найден');
    target = { type: 'brand', id: String(t.id) };
  } else fail('На что действует акция: товары, категория или бренд');
  const kind = oneOf(p.kind, ['percent', 'price'] as const, 'Вид скидки');
  const value = posInt(p.value, kind === 'percent' ? 'Процент' : 'Цена');
  if (kind === 'percent' && value > 90) fail('Скидка по акции — не больше 90 %');
  const start = isoDate(p.start, 'Начало');
  const end = isoDate(p.end, 'Окончание');
  if (end < start) fail('Акция заканчивается раньше, чем начинается');
  const audience = oneOf(p.audience ?? 'all', ['all', 'retail', 'wholesale'] as const, 'Для кого');
  const promo: Promo = { id: nextId(db, 'promo', 'pr-'), name, target, kind, value, start, end, audience, active: p.active !== false, createdBy: ctx.actorId };
  db.promos.push(promo);
  audit(db, ctx, 'promo', promo.id, `Акция «${name}»: ${kind === 'percent' ? `−${value} %` : `цена ${rub(value)}`}, ${dayText(start)} — ${dayText(end)}`);
  return { id: promo.id };
}

function promoToggle(db: DB, payload: { promoId: ID; active?: boolean }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, [], 'Включить или выключить акцию');
  const promo = typeof p.promoId === 'string' ? get(db, 'promos', p.promoId) : undefined;
  if (!promo) fail('Акция не найдена');
  const active = typeof p.active === 'boolean' ? p.active : !promo.active;
  if (active === promo.active) fail(active ? 'Акция уже включена' : 'Акция уже выключена');
  promo.active = active;
  audit(db, ctx, 'promo', promo.id, `Акция «${promo.name}» ${active ? 'включена' : 'выключена'}`);
  return { id: promo.id };
}

function allBarcodes(db: DB, exceptProductId?: ID): Set<string> {
  const s = new Set<string>();
  for (const p of db.products) if (p.id !== exceptProductId) for (const pk of p.packs) s.add(pk.barcode);
  return s;
}

function parsePacks(db: DB, raw: unknown, exceptProductId?: ID): Pack[] {
  const used = allBarcodes(db, exceptProductId);
  const packs = arr(raw, 'Упаковки', 1, 3).map((x, i) => {
    const pk = obj(x);
    const key = oneOf(pk.key ?? (i === 0 ? 'pcs' : 'box'), ['pcs', 'pack', 'box'] as const, 'Упаковка');
    const qty = key === 'pcs' ? 1 : posInt(pk.qty, 'Штук в упаковке');
    let barcode = typeof pk.barcode === 'string' ? pk.barcode.trim() : '';
    if (!barcode) {
      // внутренний код магазина: префикс 2 (диапазон для внутреннего учёта)
      const n = nextNo(db, 'innerBarcode');
      barcode = makeEan13('20' + String(n).padStart(10, '0'));
    }
    if (!isEan13(barcode)) fail(`Штрихкод ${barcode}: нужен EAN-13 с верной контрольной цифрой`);
    if (used.has(barcode)) fail(`Штрихкод ${barcode} уже есть у другого товара`);
    used.add(barcode);
    const name = typeof pk.name === 'string' && pk.name.trim() ? pk.name.trim() : key === 'pcs' ? 'шт' : key === 'pack' ? `упак. ${qty} шт` : `коробка ${qty} шт`;
    return { key, name, qty, barcode };
  });
  if (packs[0].key !== 'pcs') fail('Первая единица — штука');
  if (new Set(packs.map((x) => x.key)).size !== packs.length) fail('Упаковки повторяются');
  return packs;
}

type ProductInput = Partial<Omit<Product, 'id' | 'createdAt'>>;

function productCreate(db: DB, payload: ProductInput, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, [], 'Добавить товар');
  const name = text(p.name, 'Название');
  const brand = get(db, 'brands', String(p.brandId ?? ''));
  if (!brand) fail('Укажите бренд');
  const cat = get(db, 'categories', String(p.categoryId ?? ''));
  if (!cat) fail('Укажите категорию');
  const retailPrice = posInt(p.retailPrice, 'Розничная цена');
  const wholesalePrice = p.wholesalePrice === undefined ? retailPrice : posInt(p.wholesalePrice, 'Оптовая цена');
  if (wholesalePrice > retailPrice) fail('Оптовая цена не может быть выше розничной');
  const n = nextNo(db, 'product');
  const sku = typeof p.sku === 'string' && p.sku.trim() ? p.sku.trim() : `БМ-${String(n).padStart(5, '0')}`;
  if (db.products.some((x) => x.sku === sku)) fail(`Артикул ${sku} уже занят`);
  const packs = parsePacks(db, p.packs ?? [{ key: 'pcs' }]);
  const pr: Product = {
    id: 'p-' + n,
    sku,
    name,
    groupId: typeof p.groupId === 'string' ? p.groupId : null,
    variant: typeof p.variant === 'string' ? p.variant : null,
    brandId: brand.id,
    categoryId: cat.id,
    volume: typeof p.volume === 'string' ? p.volume : null,
    weightG: typeof p.weightG === 'number' ? p.weightG : null,
    scent: typeof p.scent === 'string' ? p.scent : null,
    packs,
    retailPrice,
    wholesalePrice,
    cost: p.cost === undefined || p.cost === null ? null : posInt(p.cost, 'Себестоимость'),
    minStock: p.minStock === undefined ? 0 : nonNegInt(p.minStock, 'Минимальный остаток'),
    active: p.active !== false,
    supplierIds: Array.isArray(p.supplierIds) ? p.supplierIds.map(String).filter((id) => get(db, 'suppliers', id)) : [],
    expiryTracked: p.expiryTracked === true,
    marking: p.marking === true,
    createdAt: dayOf(ctx),
  };
  db.products.push(pr);
  audit(db, ctx, 'product', pr.id, `Новый товар: ${pr.name}, ${rub(retailPrice)}`);
  return { id: pr.id };
}

/** Фото товара: загрузить своё (уменьшенное в браузере) или убрать — тогда снова рисованная упаковка. Только владелец. */
function productPhoto(db: DB, payload: { productId: ID; photo: string | null }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, [], 'Фото товара');
  const pr = product(db, p.productId);
  if (p.photo === null) {
    if (!pr.photo) fail('Своего фото у товара нет');
    pr.photo = null;
    audit(db, ctx, 'product', pr.id, `Фото товара «${shortName(pr)}» убрано`);
    return { id: pr.id };
  }
  const photo = String(p.photo ?? '');
  if (!/^data:image\/(jpeg|png|webp);base64,/.test(photo)) fail('Фото: нужен файл JPEG, PNG или WebP');
  if (photo.length > 400_000) fail('Фото слишком большое — уменьшите до 300 КБ');
  pr.photo = photo;
  audit(db, ctx, 'product', pr.id, `Загружено фото товара «${shortName(pr)}»`);
  return { id: pr.id };
}

function productUpdate(db: DB, payload: { productId: ID; patch: ProductInput }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, [], 'Изменить товар');
  const pr = product(db, p.productId);
  const patch = obj(p.patch);
  const changes: string[] = [];
  const next: Partial<Product> = {};
  if (patch.name !== undefined) {
    const v = text(patch.name, 'Название');
    if (v !== pr.name) {
      next.name = v;
      changes.push(`название: было «${pr.name}», стало «${v}»`);
    }
  }
  if (patch.brandId !== undefined && patch.brandId !== pr.brandId) {
    if (!get(db, 'brands', String(patch.brandId))) fail('Бренд не найден');
    next.brandId = String(patch.brandId);
    changes.push('бренд');
  }
  if (patch.categoryId !== undefined && patch.categoryId !== pr.categoryId) {
    if (!get(db, 'categories', String(patch.categoryId))) fail('Категория не найдена');
    next.categoryId = String(patch.categoryId);
    changes.push('категория');
  }
  if (patch.minStock !== undefined) {
    const v = nonNegInt(patch.minStock, 'Минимальный остаток');
    if (v !== pr.minStock) {
      next.minStock = v;
      changes.push(`мин. остаток: был ${pr.minStock}, стал ${v}`);
    }
  }
  if (patch.cost !== undefined) {
    const v = patch.cost === null ? null : posInt(patch.cost, 'Себестоимость');
    if (v !== pr.cost) {
      next.cost = v;
      changes.push(`себестоимость: была ${pr.cost === null ? 'не указана' : rub(pr.cost)}, стала ${v === null ? 'не указана' : rub(v)}`);
    }
  }
  if (patch.active !== undefined && patch.active !== pr.active) {
    next.active = patch.active === true;
    changes.push(next.active ? 'снова в продаже' : 'снят с продажи');
  }
  if (patch.packs !== undefined) {
    next.packs = parsePacks(db, patch.packs, pr.id);
    changes.push(`упаковки: ${next.packs.map((x) => x.name).join(', ')}`);
  }
  for (const k of ['volume', 'scent', 'variant', 'groupId'] as const) {
    if (patch[k] !== undefined && patch[k] !== pr[k]) {
      next[k] = patch[k] === null ? null : String(patch[k]);
      changes.push(k === 'volume' ? 'объём' : k === 'scent' ? 'аромат' : k === 'variant' ? 'вариант' : 'группа');
    }
  }
  if (patch.weightG !== undefined && patch.weightG !== pr.weightG) {
    next.weightG = patch.weightG === null ? null : nonNegInt(patch.weightG, 'Вес');
    changes.push('вес');
  }
  if (patch.supplierIds !== undefined) {
    const ids = arr(patch.supplierIds, 'Поставщики', 0, 10).map(String);
    for (const id of ids) if (!get(db, 'suppliers', id)) fail('Поставщик не найден');
    next.supplierIds = ids;
    changes.push('поставщики');
  }
  if (patch.expiryTracked !== undefined && patch.expiryTracked !== pr.expiryTracked) {
    next.expiryTracked = patch.expiryTracked === true;
    changes.push(next.expiryTracked ? 'учёт сроков годности включён' : 'учёт сроков выключен');
  }
  if (patch.marking !== undefined && patch.marking !== pr.marking) {
    next.marking = patch.marking === true;
    changes.push(next.marking ? 'подлежит маркировке' : 'без маркировки');
  }
  const priceChange = patch.retailPrice !== undefined || patch.wholesalePrice !== undefined;
  const retail = patch.retailPrice === undefined ? pr.retailPrice : posInt(patch.retailPrice, 'Розничная цена');
  const wholesale = patch.wholesalePrice === undefined ? pr.wholesalePrice : posInt(patch.wholesalePrice, 'Оптовая цена');
  const pricesDiffer = priceChange && (retail !== pr.retailPrice || wholesale !== pr.wholesalePrice);
  if (pricesDiffer && wholesale > retail) fail('Оптовая цена не может быть выше розничной');
  if (!changes.length && !pricesDiffer) fail('Изменений нет');
  Object.assign(pr, next);
  if (pricesDiffer) setPrices(db, ctx, pr, retail, wholesale);
  if (changes.length) audit(db, ctx, 'product', pr.id, `${shortName(pr)}: ${changes.join('; ')}`);
  return { id: pr.id };
}

/* =====================================================================
   КЛИЕНТЫ
   ===================================================================== */

const SEGMENTS = ['retail', 'shop', 'horeca', 'cleaning', 'market'] as const;

function parsePoints(db: DB, raw: unknown): ClientPoint[] {
  return arr(raw, 'Точки', 0, 20).map((x) => {
    const pt = obj(x);
    return {
      id: typeof pt.id === 'string' && pt.id ? pt.id : nextId(db, 'point', 'pt-'),
      name: text(pt.name, 'Название точки'),
      address: text(pt.address, 'Адрес'),
      district: text(pt.district, 'Район', false),
      lat: typeof pt.lat === 'number' ? pt.lat : 46.3497,
      lng: typeof pt.lng === 'number' ? pt.lng : 48.0408,
    };
  });
}

function parseContacts(db: DB, raw: unknown): ClientContact[] {
  return arr(raw, 'Контакты', 0, 20).map((x) => {
    const c = obj(x);
    return {
      id: typeof c.id === 'string' && c.id ? c.id : nextId(db, 'contact', 'ct-'),
      name: text(c.name, 'Имя контакта'),
      role: text(c.role, 'Роль контакта', false),
      phone: text(c.phone, 'Телефон контакта'),
    };
  });
}

function ownerCheck(db: DB, ownerId: unknown, segment: string): ID | null {
  if (ownerId === null || ownerId === undefined || ownerId === '') {
    if (segment !== 'retail') fail('Укажите ответственного: менеджера или представителя');
    return null;
  }
  const e = get(db, 'employees', String(ownerId));
  if (!e || !e.roles.some((r) => r === 'manager' || r === 'rep')) fail('Ответственный — менеджер или представитель');
  return e.id;
}

function clientCreate(db: DB, payload: Partial<Client>, ctx: OpCtx): OpResult {
  const p = obj(payload);
  const me = requireRole(db, ctx, ['manager', 'rep', 'seller'], 'Добавить клиента');
  const name = text(p.name, 'Название клиента');
  const kind = oneOf(p.kind ?? 'ip', ['person', 'ip', 'ooo'] as const, 'Тип клиента');
  const segment = oneOf(p.segment ?? (kind === 'person' ? 'retail' : 'shop'), SEGMENTS, 'Сегмент');
  const sellerOnly = me.roles.includes('seller') && !me.roles.some((r) => r === 'manager' || r === 'rep' || r === 'owner');
  if (sellerOnly && segment !== 'retail') fail('Продавец заводит только розничного покупателя — оптового клиента добавляет менеджер');
  const inn = p.inn === undefined || p.inn === null || p.inn === '' ? null : String(p.inn).trim();
  if (inn && !isInn(inn)) fail('ИНН указан с ошибкой: проверьте цифры');
  if (inn && db.clients.some((c) => c.inn === inn)) fail('Клиент с таким ИНН уже есть');
  const ownerId = ownerCheck(db, p.ownerId ?? (segment === 'retail' ? null : me.id), segment);
  const n = nextNo(db, 'client');
  const c: Client = {
    id: 'cl-' + n,
    name,
    kind,
    segment,
    priceType: oneOf(p.priceType ?? (segment === 'retail' ? 'retail' : 'wholesale'), ['retail', 'wholesale'] as const, 'Тип цены'),
    inn,
    phone: text(p.phone, 'Телефон', false),
    points: parsePoints(db, p.points ?? []),
    contacts: parseContacts(db, p.contacts ?? []),
    deferDays: p.deferDays === undefined ? 0 : nonNegInt(p.deferDays, 'Отсрочка'),
    creditLimit: p.creditLimit === undefined ? 0 : nonNegInt(p.creditLimit, 'Кредитный лимит'),
    ownerId,
    orderEveryDays: p.orderEveryDays === undefined || p.orderEveryDays === null ? null : posInt(p.orderEveryDays, 'Частота заказа'),
    minOrder: p.minOrder === undefined ? 0 : nonNegInt(p.minOrder, 'Минимальный заказ'),
    note: text(p.note, 'Заметка', false),
    createdAt: dayOf(ctx),
    active: p.active !== false,
  };
  db.clients.push(c);
  audit(db, ctx, 'client', c.id, `Новый клиент: ${c.name}${ownerId ? `, ответственный ${empName(db, ownerId)}` : ''}`);
  return { id: c.id };
}

function clientUpdate(db: DB, payload: { clientId: ID; patch: Partial<Client> }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  const me = requireRole(db, ctx, ['manager', 'rep'], 'Изменить клиента');
  const c = clientOf(db, p.clientId);
  if (isRepOnly(me) && c.ownerId !== me.id) fail('Это клиент другого сотрудника');
  const patch = obj(p.patch);
  const next: Partial<Client> = {};
  const changes: string[] = [];
  if (patch.name !== undefined) {
    const v = text(patch.name, 'Название');
    if (v !== c.name) {
      next.name = v;
      changes.push(`название: было «${c.name}», стало «${v}»`);
    }
  }
  if (patch.phone !== undefined && patch.phone !== c.phone) {
    next.phone = text(patch.phone, 'Телефон', false);
    changes.push('телефон');
  }
  if (patch.inn !== undefined && patch.inn !== c.inn) {
    const inn = patch.inn ? String(patch.inn).trim() : null;
    if (inn && !isInn(inn)) fail('ИНН указан с ошибкой: проверьте цифры');
    next.inn = inn;
    changes.push('ИНН');
  }
  if (patch.segment !== undefined && patch.segment !== c.segment) {
    next.segment = oneOf(patch.segment, SEGMENTS, 'Сегмент');
    changes.push('сегмент');
  }
  if (patch.kind !== undefined && patch.kind !== c.kind) {
    next.kind = oneOf(patch.kind, ['person', 'ip', 'ooo'] as const, 'Тип клиента');
    changes.push('тип');
  }
  if (patch.priceType !== undefined && patch.priceType !== c.priceType) {
    next.priceType = oneOf(patch.priceType, ['retail', 'wholesale'] as const, 'Тип цены');
    changes.push(`тип цены: ${next.priceType === 'wholesale' ? 'опт' : 'розница'}`);
  }
  if (patch.deferDays !== undefined) {
    const v = nonNegInt(patch.deferDays, 'Отсрочка');
    if (v !== c.deferDays) {
      next.deferDays = v;
      changes.push(`отсрочка: была ${c.deferDays} дн., стала ${v} дн.`);
    }
  }
  if (patch.creditLimit !== undefined) {
    const v = nonNegInt(patch.creditLimit, 'Кредитный лимит');
    if (v !== c.creditLimit) {
      next.creditLimit = v;
      changes.push(`кредитный лимит: был ${rub(c.creditLimit)}, стал ${rub(v)}`);
    }
  }
  if (patch.minOrder !== undefined) {
    const v = nonNegInt(patch.minOrder, 'Минимальный заказ');
    if (v !== c.minOrder) {
      next.minOrder = v;
      changes.push(`минимальный заказ: был ${rub(c.minOrder)}, стал ${rub(v)}`);
    }
  }
  if (patch.orderEveryDays !== undefined && patch.orderEveryDays !== c.orderEveryDays) {
    next.orderEveryDays = patch.orderEveryDays === null ? null : posInt(patch.orderEveryDays, 'Частота заказа');
    changes.push('частота заказа');
  }
  if (patch.ownerId !== undefined && patch.ownerId !== c.ownerId) {
    if (isRepOnly(me)) fail('Передать клиента может менеджер или владелец');
    next.ownerId = ownerCheck(db, patch.ownerId, next.segment ?? c.segment);
    changes.push(`ответственный: был ${c.ownerId ? empName(db, c.ownerId) : 'не назначен'}, стал ${next.ownerId ? empName(db, next.ownerId) : 'не назначен'}`);
  }
  if (patch.points !== undefined) {
    next.points = parsePoints(db, patch.points);
    changes.push(`точки: ${next.points.length}`);
  }
  if (patch.contacts !== undefined) {
    next.contacts = parseContacts(db, patch.contacts);
    changes.push(`контакты: ${next.contacts.length}`);
  }
  if (patch.note !== undefined && patch.note !== c.note) {
    next.note = text(patch.note, 'Заметка', false);
    changes.push('заметка');
  }
  if (patch.active !== undefined && patch.active !== c.active) {
    next.active = patch.active === true;
    changes.push(next.active ? 'снова активен' : 'отключён');
  }
  if (!changes.length) fail('Изменений нет');
  Object.assign(c, next);
  audit(db, ctx, 'client', c.id, `${c.name}: ${changes.join('; ')}`);
  return { id: c.id };
}

/* =====================================================================
   ЧАТЫ, НАСТРОЙКИ, СОТРУДНИКИ
   ===================================================================== */

function chatOf(db: DB, id: unknown): Chat {
  const c = typeof id === 'string' ? get(db, 'chats', id) : undefined;
  if (!c) fail('Диалог не найден');
  return c;
}

function chatFile(raw: unknown): ChatFile | undefined {
  if (raw === undefined || raw === null) return undefined;
  const f = obj(raw);
  const name = text(f.name, 'Файл');
  if (name.length > 120) fail('Слишком длинное имя файла');
  return { name, size: text(f.size, 'Размер файла', false) || '—', kind: oneOf(f.kind ?? 'pdf', ['pdf', 'xlsx'] as const, 'Тип файла') };
}

/** Сообщение клиенту в WhatsApp: в диалог (chatId) или клиенту (clientId) — диалог появится, если его не было. */
function chatSend(db: DB, payload: { chatId?: ID; clientId?: ID; text: string; orderId?: ID | null; file?: ChatFile; purpose?: ChatPurpose }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, ['manager', 'rep', 'accountant'], 'Написать клиенту');
  if (!db.settings.whatsapp.connected) fail('WhatsApp не подключён — подключите его в настройках');
  let chat: Chat;
  if (p.chatId !== undefined) chat = chatOf(db, p.chatId);
  else {
    const client = clientOf(db, p.clientId);
    if (!client.phone) fail('У клиента нет телефона');
    chat = ensureChat(db, client);
  }
  const file = chatFile(p.file);
  const msg = text(p.text, 'Сообщение', !file);
  let orderId: ID | null = null;
  if (p.orderId) {
    const o = orderOf(db, p.orderId);
    if (o.clientId !== chat.clientId) fail('Заказ другого клиента');
    orderId = o.id;
  }
  const purpose = p.purpose === undefined ? undefined : oneOf(p.purpose, ['invoice', 'reminder', 'act', 'price'] as const, 'Что отправляем');
  chat.messages.push({ at: ctx.at, from: 'staff', authorId: ctx.actorId, text: msg, orderId, ...(file ? { file } : {}), ...(purpose ? { purpose } : {}) });
  chat.unread = 0;
  if (orderId && purpose === 'invoice') event(orderOf(db, orderId), ctx, `Счёт отправлен клиенту в WhatsApp: ${empName(db, ctx.actorId)}`);
  if (purpose === 'reminder') audit(db, ctx, 'client', chat.clientId, 'Напоминание об оплате отправлено в WhatsApp');
  return { id: chat.id };
}

function chatRead(db: DB, payload: { chatId: ID }, ctx: OpCtx): OpResult {
  actorAny(db, ctx);
  const chat = chatOf(db, obj(payload).chatId);
  chat.unread = 0;
  return { id: chat.id };
}

function settingsUpdate(
  db: DB,
  payload: { patch: Partial<Omit<Settings, 'company' | 'discountLimits'>> & { company?: Partial<Settings['company']>; discountLimits?: Partial<Record<RoleKey, number>> } },
  ctx: OpCtx,
): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, [], 'Настройки');
  const patch = obj(p.patch);
  const s = db.settings;
  const changes: string[] = [];
  const next: Settings = { ...s, company: { ...s.company }, discountLimits: { ...s.discountLimits } };
  if (patch.company !== undefined) {
    const c = obj(patch.company);
    for (const k of Object.keys(s.company) as (keyof Settings['company'])[]) {
      if (c[k] !== undefined && c[k] !== s.company[k]) {
        next.company[k] = text(c[k], 'Реквизиты', false);
        changes.push('реквизиты');
      }
    }
  }
  if (patch.discountLimits !== undefined) {
    const d = obj(patch.discountLimits);
    for (const k of Object.keys(s.discountLimits) as RoleKey[]) {
      if (d[k] === undefined) continue;
      const v = d[k];
      if (typeof v !== 'number' || v < 0 || v > 100) fail('Лимит скидки: от 0 до 100 %');
      if (v !== s.discountLimits[k]) {
        next.discountLimits[k] = v;
        changes.push(`лимит скидки «${ROLE_NAMES[k]}»: был ${s.discountLimits[k]} %, стал ${v} %`);
      }
    }
  }
  for (const k of ['minMarginPct', 'defaultDeferDays', 'deliveryFee', 'freeDeliveryFrom'] as const) {
    if (patch[k] === undefined) continue;
    const v = nonNegInt(patch[k], k);
    if (v !== s[k]) {
      next[k] = v;
      changes.push(
        k === 'minMarginPct' ? `минимальная наценка: была ${s[k]} %, стала ${v} %` : k === 'defaultDeferDays' ? `отсрочка по умолчанию: ${v} дн.` : k === 'deliveryFee' ? `доставка: ${rub(v)}` : `бесплатная доставка от ${rub(v)}`,
      );
    }
  }
  if (!changes.length) fail('Изменений нет');
  db.settings = next;
  audit(db, ctx, 'settings', 'settings', [...new Set(changes)].join('; '));
  return {};
}

/** WhatsApp: подключить или отключить, включить или выключить автосообщения. Только владелец. */
function settingsWhatsapp(db: DB, payload: { connected?: boolean; auto?: Partial<Record<WaAutoKey, boolean>> }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, [], 'Настройки WhatsApp');
  const cur = db.settings.whatsapp;
  const next: WhatsAppSettings = { ...cur, auto: { ...cur.auto }, hours: { ...cur.hours } };
  const changes: string[] = [];
  if (p.connected !== undefined) {
    if (typeof p.connected !== 'boolean') fail('Подключение: неверное значение');
    if (p.connected !== cur.connected) {
      next.connected = p.connected;
      if (p.connected) next.since = dayOf(ctx);
      changes.push(p.connected ? `WhatsApp подключён, номер ${cur.phone}` : 'WhatsApp отключён');
    }
  }
  if (p.auto !== undefined) {
    const a = obj(p.auto);
    for (const k of WA_AUTO_KEYS) {
      if (a[k] === undefined) continue;
      if (typeof a[k] !== 'boolean') fail('Автосообщение: неверное значение');
      if (a[k] !== cur.auto[k]) {
        next.auto[k] = a[k] as boolean;
        changes.push(`автосообщение «${WA_AUTO_META[k].label}» ${a[k] ? 'включено' : 'выключено'}`);
      }
    }
  }
  if (!changes.length) fail('Изменений нет');
  db.settings = { ...db.settings, whatsapp: next };
  const t = changes.join('; ');
  audit(db, ctx, 'settings', 'settings', t.charAt(0).toUpperCase() + t.slice(1));
  return {};
}

function employeeCreate(db: DB, payload: { name: string; phone: string; roles: RoleKey[] }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, [], 'Новый сотрудник');
  const name = text(p.name, 'Имя').replace(/\s+/g, ' ').trim();
  const words = name.split(' ');
  if (words.length < 2) fail('Укажите имя и фамилию');
  const roles = arr(p.roles, 'Роли', 1, 8).map((r) => oneOf(r, Object.keys(ROLE_NAMES) as RoleKey[], 'Роль'));
  if (new Set(roles).size !== roles.length) fail('Роли повторяются');
  if (roles.includes('owner')) fail('Владелец в магазине один');
  const phone = text(p.phone, 'Телефон');
  if (phone.replace(/\D/g, '').length !== 11) fail('Телефон: нужно 11 цифр, например +7 917 123-45-67');
  if (db.employees.some((e) => e.name.toLowerCase() === name.toLowerCase())) fail('Сотрудник с таким именем уже есть');
  const id = nextId(db, 'employee', 'emp-');
  db.employees.push({ id, name, short: `${words[0]} ${words[1][0]}.`, roles, phone, active: true, hiredAt: dayOf(ctx) });
  audit(db, ctx, 'employee', id, `${name}: принят, роли «${roles.map((r) => ROLE_NAMES[r]).join(', ')}»`);
  return { id };
}

function employeeUpdate(db: DB, payload: { employeeId: ID; patch: { roles?: RoleKey[]; active?: boolean; phone?: string } }, ctx: OpCtx): OpResult {
  const p = obj(payload);
  requireRole(db, ctx, [], 'Права сотрудников');
  const e = get(db, 'employees', String(p.employeeId ?? ''));
  if (!e) fail('Сотрудник не найден');
  const patch = obj(p.patch);
  const changes: string[] = [];
  let roles = e.roles;
  if (patch.roles !== undefined) {
    roles = arr(patch.roles, 'Роли', 1, 8).map((r) => oneOf(r, Object.keys(ROLE_NAMES) as RoleKey[], 'Роль'));
    if (new Set(roles).size !== roles.length) fail('Роли повторяются');
    if (e.roles.includes('owner') && !roles.includes('owner')) fail('Нельзя снять роль владельца');
    if (roles.join() !== e.roles.join()) changes.push(`роли: были «${e.roles.map((r) => ROLE_NAMES[r]).join(', ')}», стали «${roles.map((r) => ROLE_NAMES[r]).join(', ')}»`);
  }
  let active = e.active;
  if (patch.active !== undefined && patch.active !== e.active) {
    if (e.roles.includes('owner')) fail('Владельца отключить нельзя');
    active = patch.active === true;
    changes.push(active ? 'доступ открыт' : 'доступ закрыт');
  }
  let phone = e.phone;
  if (patch.phone !== undefined && patch.phone !== e.phone) {
    phone = text(patch.phone, 'Телефон');
    changes.push('телефон');
  }
  if (!changes.length) fail('Изменений нет');
  e.roles = roles;
  e.active = active;
  e.phone = phone;
  audit(db, ctx, 'employee', e.id, `${e.name}: ${changes.join('; ')}`);
  return { id: e.id };
}

/* =====================================================================
   КАРТА ОПЕРАЦИЙ
   ===================================================================== */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyOp = (db: DB, payload: any, ctx: OpCtx) => OpResult;

export const ops = {
  'shift.open': shiftOpen,
  'shift.close': shiftClose,
  'receipt.checkout': receiptCheckout,
  'receipt.refund': receiptRefund,

  'order.create': orderCreate,
  'order.update': orderUpdate,
  'order.confirm': orderConfirm,
  'order.cancel': orderCancel,
  'order.pick': orderPick,
  'order.pickProgress': orderPickProgress,
  'order.ship': orderShip,

  'payment.client': paymentClient,
  'payment.confirm': paymentConfirm,
  'payment.identify': paymentIdentify,
  'payment.refund': paymentRefund,
  'payment.supplier': paymentSupplier,
  'payment.expense': paymentExpense,
  'payment.transfer': paymentTransfer,
  'balance.initial': balanceInitial,

  'stock.initial': stockInitial,
  'stock.income': stockIncome,
  'stock.transfer': stockTransfer,
  'stock.writeoff': stockWriteoff,
  'stock.count': stockCount,
  'quarantine.release': quarantineRelease,
  'quarantine.writeoff': quarantineWriteoff,

  'purchase.create': purchaseCreate,
  'purchase.approve': purchaseApprove,
  'purchase.receive': purchaseReceive,
  'purchase.cancel': purchaseCancel,

  'return.create': returnCreate,

  'delivery.create': deliveryCreate,
  'delivery.assign': deliveryAssign,
  'delivery.start': deliveryStart,
  'delivery.deliver': deliveryDeliver,
  'delivery.fail': deliveryFail,
  'delivery.reschedule': deliveryReschedule,
  'delivery.delay': deliveryDelay,
  'delivery.returnToStock': deliveryReturnToStock,
  'courier.handIn': courierHandIn,

  'visit.plan': visitPlan,
  'visit.complete': visitComplete,

  'task.create': taskCreate,
  'task.complete': taskComplete,
  'task.reopen': taskReopen,

  'price.set': priceSet,
  'promo.create': promoCreate,
  'promo.toggle': promoToggle,
  'product.create': productCreate,
  'product.update': productUpdate,
  'product.photo': productPhoto,
  'client.create': clientCreate,
  'client.update': clientUpdate,

  'chat.send': chatSend,
  'chat.read': chatRead,

  'settings.update': settingsUpdate,
  'settings.whatsapp': settingsWhatsapp,
  'employee.create': employeeCreate,
  'employee.update': employeeUpdate,
} satisfies Record<string, AnyOp>;

export type OpType = keyof typeof ops;
export type OpPayload<T extends OpType> = Parameters<(typeof ops)[T]>[1];

const AT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

/** Выполнить операцию: проверка времени и автора, номер версии, откат добавленного при ошибке. */
/** Задачи, о которых было действие, закрываются сами. Возвращает, сколько закрыто. */
function tasksAfterOp(db: DB, type: string, payload: unknown, r: OpResult, ctx: OpCtx): number {
  const open = db.tasks.filter((t) => t.state === 'open' && t.kind);
  if (!open.length) return 0;
  const pl = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  let n = 0;
  const close = (pred: (t: Task) => boolean): void => {
    for (const t of open) {
      if (t.state === 'open' && pred(t)) {
        t.state = 'done';
        t.doneAt = ctx.at;
        n++;
      }
    }
  };
  const linked = (t: Task, lt: TaskLink['type'], id: unknown): boolean => t.link?.type === lt && t.link.id === id;
  const clientMoney = (clientId: ID | null | undefined): void => {
    if (!clientId) return;
    close((t) => t.kind === 'remind_debt' && linked(t, 'client', clientId));
    if (clientBalance(db, clientId).overdue === 0) close((t) => (t.kind === 'call_debt' || t.kind === 'remind_debt') && linked(t, 'client', clientId));
  };
  switch (type) {
    case 'order.confirm':
    case 'order.cancel':
      close((t) => (t.kind === 'approve_order' || t.kind === 'order_returned') && linked(t, 'order', r.id));
      if (!db.orders.some((o) => o.state === 'request')) close((t) => t.kind === 'confirm_requests');
      break;
    case 'chat.send': {
      const chat = db.chats.find((c) => c.id === r.id);
      if (pl.purpose === 'invoice' && pl.orderId) close((t) => t.kind === 'send_invoice' && linked(t, 'order', pl.orderId));
      if (pl.purpose === 'reminder' && chat) close((t) => t.kind === 'remind_debt' && linked(t, 'client', chat.clientId));
      break;
    }
    case 'payment.client':
    case 'payment.confirm':
    case 'payment.identify': {
      const pay = get(db, 'payments', r.id ?? '');
      if (type === 'payment.confirm') close((t) => t.kind === 'check_transfer' && linked(t, 'payment', r.id));
      if (type === 'payment.identify') close((t) => t.kind === 'identify_payment' && linked(t, 'payment', r.id));
      clientMoney(pay?.clientId);
      break;
    }
    case 'payment.supplier':
      close((t) => t.kind === 'pay_supplier' && linked(t, 'supplier', pl.supplierId));
      break;
    case 'stock.transfer':
      if (pl.to === 'shop' && Array.isArray(pl.lines))
        for (const l of pl.lines as { productId?: unknown }[]) close((t) => t.kind === 'move_to_shop' && linked(t, 'product', l.productId));
      break;
    case 'order.pick': {
      const o = get(db, 'orders', r.id ?? '');
      if (o?.pick === 'picked') close((t) => t.kind === 'pick_order' && linked(t, 'order', o.id));
      break;
    }
    case 'delivery.assign':
    case 'delivery.reschedule':
    case 'delivery.returnToStock':
      close((t) => t.kind === 'failed_delivery' && linked(t, 'delivery', r.id));
      if (!db.deliveries.some((d) => d.state === 'waiting' && d.date <= dateOf(ctx.at))) close((t) => t.kind === 'assign_couriers');
      break;
    case 'courier.handIn':
      close((t) => t.kind === 'courier_cash');
      break;
  }
  return n;
}

export function applyOp(db: DB, type: OpType | string, payload: unknown, ctx: OpCtx): OpResult {
  const fn = (ops as Record<string, AnyOp>)[type];
  if (!fn) throw new OpError(`Неизвестная операция: ${type}`);
  if (!ctx || typeof ctx.at !== 'string' || !AT_RE.test(ctx.at)) throw new OpError('Неверное время операции');
  if (typeof ctx.actorId !== 'string' || !get(db, 'employees', ctx.actorId)) throw new OpError('Сотрудник не найден');
  const lengths = new Map<string, number>();
  for (const [k, v] of Object.entries(db)) if (Array.isArray(v)) lengths.set(k, v.length);
  const counters = { ...db.counters };
  const settings = db.settings;
  db.meta.version++;
  try {
    const r = fn(db, payload, ctx) ?? {};
    db.meta.version++;
    // автосообщение клиенту в WhatsApp по событию (после версии: подсчёты долга видят новое состояние)
    const wa = waAfterOp(db, type, r, ctx);
    if (wa) db.meta.version++;
    // задачи, о которых это действие, закрываются сами: «разнести платёж», «отправить счёт», «согласовать заказ»…
    const closed = tasksAfterOp(db, type, payload, r, ctx);
    if (closed) db.meta.version++;
    const notes = [r.info, wa, closed ? (closed === 1 ? 'Задача отмечена выполненной' : `Задачи отмечены выполненными: ${closed}`) : undefined].filter(Boolean);
    return notes.length ? { ...r, info: notes.join('. ') } : r;
  } catch (e) {
    for (const [k, n] of lengths) {
      const a = (db as unknown as Record<string, unknown[]>)[k];
      if (a.length > n) a.length = n;
    }
    for (const k of Object.keys(db.counters)) if (!(k in counters)) delete db.counters[k];
    Object.assign(db.counters, counters);
    db.settings = settings;
    db.meta.version++;
    throw e;
  }
}
