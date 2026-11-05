/* Общие расчёты для всех разделов. Результаты запоминаются по версии базы (db.meta.version):
   пока база не менялась, повторный вызов ничего не пересчитывает. */
import type {
  AccountKey,
  Brand,
  Category,
  Client,
  DB,
  Employee,
  ID,
  ISODate,
  ISODateTime,
  Order,
  PriceType,
  Product,
  Promo,
  Supplier,
} from './types';
import { get } from './idx';
import { dayNum, diffDays, dow, firstOfMonth, isoDay, lastOfMonth, plusDays, plusMonths } from './dates';

/* ---------- запоминание ---------- */

const memoCache = new WeakMap<DB, { v: number; m: Map<string, unknown> }>();

function memo<T>(db: DB, key: string, fn: () => T): T {
  let c = memoCache.get(db);
  if (!c || c.v !== db.meta.version) {
    c = { v: db.meta.version, m: new Map() };
    memoCache.set(db, c);
  }
  if (c.m.has(key)) return c.m.get(key) as T;
  const value = fn();
  c.m.set(key, value);
  return value;
}

export function today(db: DB): ISODate {
  return db.meta.today;
}

/* ---------- индексы по id ---------- */

export interface Indexes {
  employees: Map<ID, Employee>;
  products: Map<ID, Product>;
  clients: Map<ID, Client>;
  suppliers: Map<ID, Supplier>;
  orders: Map<ID, Order>;
  categories: Map<ID, Category>;
  brands: Map<ID, Brand>;
}

function mapById<T extends { id: ID }>(arr: T[]): Map<ID, T> {
  const m = new Map<ID, T>();
  for (const x of arr) m.set(x.id, x);
  return m;
}

export function indexes(db: DB): Indexes {
  return memo(db, 'indexes', () => ({
    employees: mapById(db.employees),
    products: mapById(db.products),
    clients: mapById(db.clients),
    suppliers: mapById(db.suppliers),
    orders: mapById(db.orders),
    categories: mapById(db.categories),
    brands: mapById(db.brands),
  }));
}

/** Категория и все её подкатегории. */
export function categoryFamily(db: DB, categoryId: ID): Set<ID> {
  return memo(db, 'catfam|' + categoryId, () => {
    const s = new Set<ID>([categoryId]);
    for (const c of db.categories) if (c.parentId === categoryId) s.add(c.id);
    return s;
  });
}

/* ---------- остатки ---------- */

export interface StockPlace {
  onHand: number;
  reserved: number;
  available: number;
}

export interface StockInfo {
  shop: StockPlace;
  warehouse: StockPlace;
  total: StockPlace;
  expected: number; // ожидается по незакрытым закупкам
  quarantine: number; // на проверке (не в доступном)
  nearestExpiry: ISODate | null;
}

const emptyPlace = (): StockPlace => ({ onHand: 0, reserved: 0, available: 0 });
const emptyInfo = (): StockInfo => ({
  shop: emptyPlace(),
  warehouse: emptyPlace(),
  total: emptyPlace(),
  expected: 0,
  quarantine: 0,
  nearestExpiry: null,
});

export function stockIndex(db: DB): Map<ID, StockInfo> {
  return memo(db, 'stockIndex', () => {
    const m = new Map<ID, StockInfo>();
    const info = (pid: ID): StockInfo => {
      let x = m.get(pid);
      if (!x) {
        x = emptyInfo();
        m.set(pid, x);
      }
      return x;
    };
    for (const p of db.products) info(p.id);
    for (const r of db.stock) {
      const x = info(r.productId);
      const place = x[r.location];
      place.onHand += r.onHand;
      place.reserved += r.reserved;
      place.available = place.onHand - place.reserved;
      x.total.onHand += r.onHand;
      x.total.reserved += r.reserved;
      x.total.available = x.total.onHand - x.total.reserved;
    }
    for (const pu of db.purchases) {
      if (pu.state !== 'ordered' && pu.state !== 'partial') continue;
      for (const l of pu.lines) {
        const rest = l.qty - (l.received ?? 0);
        if (rest > 0) info(l.productId).expected += rest;
      }
    }
    for (const q of db.quarantine) if (q.state === 'check') info(q.productId).quarantine += q.qty;
    for (const b of db.batches) {
      if (b.qty <= 0) continue;
      const x = info(b.productId);
      if (x.nearestExpiry === null || b.expiry < x.nearestExpiry) x.nearestExpiry = b.expiry;
    }
    return m;
  });
}

export function stockOf(db: DB, productId: ID): StockInfo {
  return stockIndex(db).get(productId) ?? emptyInfo();
}

/* ---------- цены и акции ---------- */

export function activePromos(db: DB, date: ISODate): Promo[] {
  return memo(db, 'promos|' + date, () => db.promos.filter((p) => p.active && p.start <= date && date <= p.end));
}

export function promoApplies(db: DB, promo: Promo, product: Product, priceType: PriceType): boolean {
  if (promo.audience !== 'all' && promo.audience !== priceType) return false;
  const t = promo.target;
  if (t.type === 'products') return t.ids.includes(product.id);
  if (t.type === 'brand') return product.brandId === t.id;
  return categoryFamily(db, t.id).has(product.categoryId);
}

export interface PriceInfo {
  base: number; // цена по типу цены клиента
  price: number; // лучшая из базовой и акционной
  promo: Promo | null;
}

/** Цена за штуку: берётся меньшая из цены по типу клиента и акционной. Ручная скидка — отдельно. */
export function priceFor(db: DB, productId: ID, opts: { priceType: PriceType; date: ISODate }): PriceInfo {
  const p = get(db, 'products', productId);
  if (!p) return { base: 0, price: 0, promo: null };
  const base = opts.priceType === 'wholesale' ? p.wholesalePrice : p.retailPrice;
  let price = base;
  let promo: Promo | null = null;
  for (const pr of activePromos(db, opts.date)) {
    if (!promoApplies(db, pr, p, opts.priceType)) continue;
    const v = pr.kind === 'percent' ? Math.round((base * (100 - pr.value)) / 100) : pr.value;
    if (v < price) {
      price = v;
      promo = pr;
    }
  }
  // опт не дороже розницы: если розничная акция дала цену ниже оптовой, оптовый клиент платит её
  if (opts.priceType === 'wholesale') {
    const r = priceFor(db, productId, { priceType: 'retail', date: opts.date });
    if (r.promo && r.price < price) {
      price = r.price;
      promo = r.promo;
    }
  }
  return { base, price, promo };
}

/* ---------- деньги по заказам ---------- */

interface PayIdx {
  orderPaid: Map<ID, number>; // проведённые поступления минус возвраты денег
  orderPending: Map<ID, number>;
  purchasePaid: Map<ID, number>;
  clientUnallocated: Map<ID, number>; // аванс: не распределённый остаток проведённых платежей
  supplierUnallocated: Map<ID, number>;
}

const add = (m: Map<ID, number>, k: ID, v: number): void => {
  m.set(k, (m.get(k) ?? 0) + v);
};

function payIdx(db: DB): PayIdx {
  return memo(db, 'payIdx', () => {
    const x: PayIdx = {
      orderPaid: new Map(),
      orderPending: new Map(),
      purchasePaid: new Map(),
      clientUnallocated: new Map(),
      supplierUnallocated: new Map(),
    };
    for (const p of db.payments) {
      if (p.kind === 'client') {
        let allocated = 0;
        for (const a of p.allocations) {
          if (!a.orderId) continue;
          allocated += a.amount;
          if (p.status === 'posted') add(x.orderPaid, a.orderId, a.amount);
          else if (p.status === 'pending') add(x.orderPending, a.orderId, a.amount);
        }
        if (p.status === 'posted' && p.clientId) add(x.clientUnallocated, p.clientId, p.amount - allocated);
      } else if (p.kind === 'refund' && p.status === 'posted') {
        let allocated = 0;
        for (const a of p.allocations) {
          if (!a.orderId) continue;
          allocated += a.amount;
          add(x.orderPaid, a.orderId, -a.amount);
        }
        if (p.clientId) add(x.clientUnallocated, p.clientId, -(p.amount - allocated));
      } else if (p.kind === 'supplier' && p.status === 'posted') {
        let allocated = 0;
        for (const a of p.allocations) {
          if (!a.purchaseId) continue;
          allocated += a.amount;
          add(x.purchasePaid, a.purchaseId, a.amount);
        }
        if (p.supplierId) add(x.supplierUnallocated, p.supplierId, p.amount - allocated);
      }
    }
    return x;
  });
}

export interface OrderReturnInfo {
  amount: number;
  cost: number; // себестоимость возвращённого (по известной)
  costKnownAmount: number; // сумма возвращённого с известной себестоимостью
  byProduct: Map<ID, number>; // штук возвращено
}

/** Возвраты по заказам: сумма и штуки по товарам. */
export function orderReturns(db: DB): Map<ID, OrderReturnInfo> {
  return memo(db, 'orderReturns', () => {
    const m = new Map<ID, OrderReturnInfo>();
    for (const r of db.returns) {
      if (r.source !== 'order' || !r.orderId) continue;
      let x = m.get(r.orderId);
      if (!x) {
        x = { amount: 0, cost: 0, costKnownAmount: 0, byProduct: new Map() };
        m.set(r.orderId, x);
      }
      const o = get(db, 'orders', r.orderId);
      for (const l of r.lines) {
        x.amount += l.qty * l.price;
        x.byProduct.set(l.productId, (x.byProduct.get(l.productId) ?? 0) + l.qty);
        const ol = o?.lines.find((ln) => ln.productId === l.productId);
        if (ol && ol.cost !== null) {
          x.cost += l.qty * ol.cost;
          x.costKnownAmount += l.qty * l.price;
        }
      }
    }
    return m;
  });
}

export interface OrderPayment {
  amount: number; // сколько клиент должен заплатить по заказу всего (с учётом отгрузки, отмены и возвратов)
  shipped: number; // стоимость отгруженного за вычетом возвратов — это и есть основание долга
  paid: number; // проведённые оплаты минус возвраты денег
  pending: number; // ждут подтверждения банка (скриншот перевода)
  due: number; // осталось оплатить по заказу
  debt: number; // долг за уже отгруженное
  advance: number; // оплачено сверх отгруженного (предоплата или переплата)
  overdueDays: number;
  state: 'unpaid' | 'partial' | 'paid' | 'overpaid';
}

export function orderShippedValue(order: Order): number {
  let s = 0;
  for (const l of order.lines) s += l.shipped * l.price;
  return s;
}

export function orderPayment(db: DB, order: Order): OrderPayment {
  const pi = payIdx(db);
  const ret = orderReturns(db).get(order.id)?.amount ?? 0;
  const shipped = Math.max(0, orderShippedValue(order) - ret);
  const amount =
    order.state === 'cancelled' || order.state === 'draft'
      ? 0
      : order.state === 'closed'
        ? shipped
        : Math.max(0, order.total - ret);
  const paid = pi.orderPaid.get(order.id) ?? 0;
  const pending = pi.orderPending.get(order.id) ?? 0;
  const due = Math.max(0, amount - paid);
  const debt = Math.max(0, shipped - paid);
  const advance = Math.max(0, paid - shipped);
  const t = db.meta.today;
  // доставка сейчас в состоянии «Неудачная попытка» — клиент товар не принял, просрочки нет (долг остаётся)
  const failedDelivery = order.deliveryId !== null && get(db, 'deliveries', order.deliveryId)?.state === 'failed';
  const overdueDays = debt > 0 && order.dueDate && order.dueDate < t && !failedDelivery ? diffDays(order.dueDate, t) : 0;
  const state: OrderPayment['state'] =
    paid > amount ? 'overpaid' : paid >= amount ? 'paid' : paid > 0 ? 'partial' : 'unpaid';
  return { amount, shipped, paid, pending, due, debt, advance, overdueDays, state };
}

/* ---------- клиенты ---------- */

export interface ClientBalance {
  debt: number; // за отгруженное
  overdue: number; // из долга — просрочено
  maxOverdueDays: number;
  creditLimit: number;
  creditLeft: number;
  advance: number; // аванс и переплата
  openOrders: number; // подтверждено, но ещё не отгружено (за вычетом предоплаты)
  pending: number; // оплаты на подтверждении
  lastOrderAt: ISODateTime | null;
  ordersCount: number;
  avgOrder: number;
}

const emptyBalance = (c?: Client): ClientBalance => ({
  debt: 0,
  overdue: 0,
  maxOverdueDays: 0,
  creditLimit: c?.creditLimit ?? 0,
  creditLeft: c?.creditLimit ?? 0,
  advance: 0,
  openOrders: 0,
  pending: 0,
  lastOrderAt: null,
  ordersCount: 0,
  avgOrder: 0,
});

export function clientBalances(db: DB): Map<ID, ClientBalance> {
  return memo(db, 'clientBalances', () => {
    const m = new Map<ID, ClientBalance>();
    const sums = new Map<ID, number>();
    for (const c of db.clients) m.set(c.id, emptyBalance(c));
    const bal = (id: ID): ClientBalance => {
      let b = m.get(id);
      if (!b) {
        b = emptyBalance(get(db, 'clients', id));
        m.set(id, b);
      }
      return b;
    };
    for (const o of db.orders) {
      const b = bal(o.clientId);
      const op = orderPayment(db, o);
      b.debt += op.debt;
      b.advance += op.advance;
      b.pending += op.pending;
      if (op.overdueDays > 0) {
        b.overdue += op.debt;
        if (op.overdueDays > b.maxOverdueDays) b.maxOverdueDays = op.overdueDays;
      }
      if (o.state === 'confirmed') b.openOrders += Math.max(0, op.amount - op.shipped - Math.max(0, op.paid - op.shipped));
      if (o.state !== 'cancelled' && o.state !== 'draft') {
        b.ordersCount++;
        sums.set(o.clientId, (sums.get(o.clientId) ?? 0) + o.total);
        if (!b.lastOrderAt || o.createdAt > b.lastOrderAt) b.lastOrderAt = o.createdAt;
      }
    }
    for (const r of db.receipts) {
      if (!r.clientId || r.kind !== 'sale') continue;
      const b = bal(r.clientId);
      b.ordersCount++;
      sums.set(r.clientId, (sums.get(r.clientId) ?? 0) + r.total);
      if (!b.lastOrderAt || r.at > b.lastOrderAt) b.lastOrderAt = r.at;
    }
    const pi = payIdx(db);
    for (const [cid, v] of pi.clientUnallocated) bal(cid).advance += v;
    for (const [cid, b] of m) {
      b.advance = Math.max(0, b.advance);
      b.avgOrder = b.ordersCount ? Math.round((sums.get(cid) ?? 0) / b.ordersCount) : 0;
      // остаток лимита — та же формула, что при подтверждении заказа: лимит − долг − подтверждённые, но не отгруженные заказы
      b.creditLeft = b.creditLimit > 0 ? b.creditLimit - b.debt - b.openOrders : 0;
    }
    return m;
  });
}

export function clientBalance(db: DB, clientId: ID): ClientBalance {
  return clientBalances(db).get(clientId) ?? emptyBalance(get(db, 'clients', clientId));
}

/* ---------- поставщики ---------- */

export interface SupplierUpcoming {
  purchaseId: ID;
  amount: number;
  dueDate: ISODate;
}

export interface SupplierBalance {
  debt: number;
  overdue: number;
  advance: number;
  upcoming: SupplierUpcoming[]; // все неоплаченные закупки по сроку оплаты, включая просроченные
}

/** Стоимость принятого по закупке (без брака) — основание долга поставщику. */
export function purchaseAccepted(db: DB, purchaseId: ID): number {
  const pu = get(db, 'purchases', purchaseId);
  if (!pu) return 0;
  let s = 0;
  for (const l of pu.lines) if (l.received !== null) s += (l.received - l.defect) * l.price;
  return s;
}

export function purchasePaid(db: DB, purchaseId: ID): number {
  return payIdx(db).purchasePaid.get(purchaseId) ?? 0;
}

export function supplierBalances(db: DB): Map<ID, SupplierBalance> {
  return memo(db, 'supplierBalances', () => {
    const m = new Map<ID, SupplierBalance>();
    for (const s of db.suppliers) m.set(s.id, { debt: 0, overdue: 0, advance: 0, upcoming: [] });
    const t = db.meta.today;
    const pi = payIdx(db);
    for (const pu of db.purchases) {
      if (pu.state !== 'partial' && pu.state !== 'received') continue;
      const b = m.get(pu.supplierId);
      if (!b) continue;
      const left = purchaseAccepted(db, pu.id) - (pi.purchasePaid.get(pu.id) ?? 0);
      if (left <= 0) continue;
      b.debt += left;
      const due = pu.dueDate ?? t;
      if (due < t) b.overdue += left;
      b.upcoming.push({ purchaseId: pu.id, amount: left, dueDate: due });
    }
    for (const [sid, v] of pi.supplierUnallocated) {
      const b = m.get(sid);
      if (b) b.advance += v;
    }
    for (const b of m.values()) b.upcoming.sort((a, z) => (a.dueDate < z.dueDate ? -1 : a.dueDate > z.dueDate ? 1 : 0));
    return m;
  });
}

export function supplierBalance(db: DB, supplierId: ID): SupplierBalance {
  return supplierBalances(db).get(supplierId) ?? { debt: 0, overdue: 0, advance: 0, upcoming: [] };
}

/* ---------- кассы и счета ---------- */

/** Остатки касс и счёта: проведённые платежи плюс деньги открытой смены (по чекам). */
export function accountBalances(db: DB): Record<AccountKey, number> {
  return memo(db, 'accountBalances', () => {
    const b: Record<AccountKey, number> = { shop_cash: 0, courier_cash: 0, bank: 0 };
    for (const p of db.payments) {
      if (p.status !== 'posted') continue;
      if (p.kind === 'transfer' && p.toAccount) {
        b[p.account] -= p.amount;
        b[p.toAccount] += p.amount;
      } else if (p.direction === 'in') b[p.account] += p.amount;
      else b[p.account] -= p.amount;
    }
    for (const s of db.shifts) {
      if (s.closedAt) continue;
      const sum = shiftSummary(db, s.id);
      b.shop_cash += sum.cash;
      b.bank += sum.card;
    }
    return b;
  });
}

export interface CourierCash {
  collected: number;
  handedIn: number;
  onHand: number;
  deliveries: number; // доставок с наличными, ещё не сданных
}

export function courierCash(db: DB, courierId: ID): CourierCash {
  return memo(db, 'courierCash|' + courierId, () => {
    let collected = 0;
    let handedIn = 0;
    let deliveries = 0;
    for (const d of db.deliveries) {
      if (d.courierId !== courierId || d.collectedMethod !== 'cash' || d.collected <= 0) continue;
      collected += d.collected;
      if (d.handedIn) handedIn += d.collected;
      else deliveries++;
    }
    return { collected, handedIn, onHand: collected - handedIn, deliveries };
  });
}

/* ---------- смена ---------- */

export interface ShiftSummary {
  receipts: number; // чеков продажи
  total: number; // сумма продаж
  cash: number; // наличные за смену: принято минус сдача минус возвраты наличными
  card: number; // по карте за вычетом возвратов на карту
  refunds: number; // сумма возвратов по чекам
  refundsCount: number;
  expectedCash: number; // должно быть в кассе: размен + наличные
  countedCash: number | null;
  difference: number | null; // пересчитано − ожидалось
}

function receiptsByShift(db: DB): Map<ID, typeof db.receipts> {
  return memo(db, 'receiptsByShift', () => {
    const m = new Map<ID, typeof db.receipts>();
    for (const r of db.receipts) {
      let a = m.get(r.shiftId);
      if (!a) {
        a = [];
        m.set(r.shiftId, a);
      }
      a.push(r);
    }
    return m;
  });
}

export function shiftSummary(db: DB, shiftId: ID): ShiftSummary {
  return memo(db, 'shift|' + shiftId, () => {
    const s = get(db, 'shifts', shiftId);
    let receipts = 0;
    let total = 0;
    let cash = 0;
    let card = 0;
    let refunds = 0;
    let refundsCount = 0;
    for (const r of receiptsByShift(db).get(shiftId) ?? []) {
      if (r.kind === 'sale') {
        receipts++;
        total += r.total;
        cash += r.cash - r.change;
        card += r.card;
      } else {
        refundsCount++;
        refunds += r.total;
        cash -= r.cash;
        card -= r.card;
      }
    }
    const opening = s?.openingCash ?? 0;
    const counted = s?.countedCash ?? null;
    const expectedCash = opening + cash;
    return {
      receipts,
      total,
      cash,
      card,
      refunds,
      refundsCount,
      expectedCash,
      countedCash: counted,
      difference: counted === null ? null : counted - expectedCash,
    };
  });
}

/* ---------- продажи и прибыль ---------- */

export interface SalesFilter {
  employeeId?: ID;
  clientId?: ID;
  categoryId?: ID;
}

export interface SalesSummary {
  revenue: number; // выручка за вычетом возвратов: розница по чекам + опт по отгрузке
  retail: number;
  wholesale: number;
  grossProfit: number; // только по строкам с известной себестоимостью
  marginPct: number; // валовая прибыль / выручка строк с известной себестоимостью
  costKnownShare: number; // доля строк продаж с известной себестоимостью, 0…1
  receiptsCount: number;
  ordersCount: number; // оптовых заказов создано за период (без черновиков и отмен)
  avgReceipt: number;
  returns: number; // сумма возвратов (по чекам и заказам)
  writeoffs: number; // списания по себестоимости
}

interface Shipment {
  date: ISODate;
  orderId: ID;
  productId: ID;
  qty: number;
}

/** Отгрузки оптовых заказов из движений (дата отгрузки — дата выручки опта). */
function shipments(db: DB): Shipment[] {
  return memo(db, 'shipments', () => {
    const a: Shipment[] = [];
    for (const m of db.movements) {
      if (m.kind !== 'ship') continue;
      a.push({ date: m.at.slice(0, 10), orderId: m.docId, productId: m.productId, qty: -m.dOnHand });
    }
    return a;
  });
}

interface Acc {
  revenue: number;
  retail: number;
  wholesale: number;
  grossProfit: number;
  knownRevenue: number;
  lines: number;
  knownLines: number;
  receiptsCount: number;
  ordersCount: number;
  retailSales: number;
  returns: number;
  writeoffs: number;
}

const newAcc = (): Acc => ({
  revenue: 0,
  retail: 0,
  wholesale: 0,
  grossProfit: 0,
  knownRevenue: 0,
  lines: 0,
  knownLines: 0,
  receiptsCount: 0,
  ordersCount: 0,
  retailSales: 0,
  returns: 0,
  writeoffs: 0,
});

function collect(db: DB, from: ISODate, to: ISODate, f: SalesFilter, bucket: (date: ISODate) => Acc): void {
  const cat = f.categoryId ? categoryFamily(db, f.categoryId) : null;
  const okProduct = (pid: ID): boolean => {
    if (!cat) return true;
    const p = get(db, 'products', pid);
    return !!p && cat.has(p.categoryId);
  };
  const inRange = (d: ISODate): boolean => d >= from && d <= to;

  // розница по чекам
  for (const r of db.receipts) {
    const d = r.at.slice(0, 10);
    if (!inRange(d)) continue;
    if (f.employeeId && r.sellerId !== f.employeeId) continue;
    if (f.clientId && r.clientId !== f.clientId) continue;
    const acc = bucket(d);
    const sign = r.kind === 'sale' ? 1 : -1;
    let any = false;
    for (const l of r.lines) {
      if (!okProduct(l.productId)) continue;
      any = true;
      const sum = l.qty * l.price;
      acc.retail += sign * sum;
      acc.revenue += sign * sum;
      if (sign > 0) {
        acc.retailSales += sum;
        acc.lines++;
      } else acc.returns += sum;
      if (l.cost !== null) {
        acc.grossProfit += sign * (l.price - l.cost) * l.qty;
        acc.knownRevenue += sign * sum;
        if (sign > 0) acc.knownLines++;
      }
    }
    if (any && sign > 0) acc.receiptsCount++;
  }

  // опт по отгрузке
  for (const s of shipments(db)) {
    if (!inRange(s.date)) continue;
    const o = get(db, 'orders', s.orderId);
    if (!o) continue;
    if (f.employeeId && o.ownerId !== f.employeeId) continue;
    if (f.clientId && o.clientId !== f.clientId) continue;
    if (!okProduct(s.productId)) continue;
    const l = o.lines.find((ln) => ln.productId === s.productId);
    if (!l) continue;
    const acc = bucket(s.date);
    const sum = s.qty * l.price;
    acc.wholesale += sum;
    acc.revenue += sum;
    acc.lines++;
    if (l.cost !== null) {
      acc.grossProfit += (l.price - l.cost) * s.qty;
      acc.knownRevenue += sum;
      acc.knownLines++;
    }
  }

  // возвраты по заказам (возвраты по чекам уже учтены чеками возврата)
  for (const r of db.returns) {
    if (r.source !== 'order' || !r.orderId) continue;
    const d = r.at.slice(0, 10);
    if (!inRange(d)) continue;
    const o = get(db, 'orders', r.orderId);
    if (!o) continue;
    if (f.employeeId && o.ownerId !== f.employeeId) continue;
    if (f.clientId && o.clientId !== f.clientId) continue;
    const acc = bucket(d);
    for (const l of r.lines) {
      if (!okProduct(l.productId)) continue;
      const sum = l.qty * l.price;
      acc.wholesale -= sum;
      acc.revenue -= sum;
      acc.returns += sum;
      const ol = o.lines.find((ln) => ln.productId === l.productId);
      if (ol && ol.cost !== null) {
        acc.grossProfit -= (l.price - ol.cost) * l.qty;
        acc.knownRevenue -= sum;
      }
    }
  }

  // заказы, созданные за период
  for (const o of db.orders) {
    const d = o.createdAt.slice(0, 10);
    if (!inRange(d) || o.state === 'cancelled' || o.state === 'draft') continue;
    if (f.employeeId && o.ownerId !== f.employeeId) continue;
    if (f.clientId && o.clientId !== f.clientId) continue;
    if (cat && !o.lines.some((l) => okProduct(l.productId))) continue;
    bucket(d).ordersCount++;
  }

  // списания по себестоимости
  if (!f.employeeId && !f.clientId) {
    for (const doc of db.stockDocs) {
      if (doc.kind !== 'writeoff') continue;
      const d = doc.at.slice(0, 10);
      if (!inRange(d)) continue;
      const acc = bucket(d);
      for (const l of doc.lines) {
        if (!okProduct(l.productId)) continue;
        const p = get(db, 'products', l.productId);
        acc.writeoffs += l.qty * (p?.cost ?? 0);
      }
    }
  }
}

function finish(a: Acc): SalesSummary {
  return {
    revenue: a.revenue,
    retail: a.retail,
    wholesale: a.wholesale,
    grossProfit: a.grossProfit,
    marginPct: a.knownRevenue > 0 ? (a.grossProfit / a.knownRevenue) * 100 : 0,
    costKnownShare: a.lines > 0 ? a.knownLines / a.lines : 1,
    receiptsCount: a.receiptsCount,
    ordersCount: a.ordersCount,
    avgReceipt: a.receiptsCount > 0 ? Math.round(a.retailSales / a.receiptsCount) : 0,
    returns: a.returns,
    writeoffs: Math.round(a.writeoffs),
  };
}

/** Продажи за период [from, to] включительно. */
export function salesForPeriod(db: DB, from: ISODate, to: ISODate, filter: SalesFilter = {}): SalesSummary {
  const key = `sales|${from}|${to}|${filter.employeeId ?? ''}|${filter.clientId ?? ''}|${filter.categoryId ?? ''}`;
  return memo(db, key, () => {
    const acc = newAcc();
    collect(db, from, to, filter, () => acc);
    return finish(acc);
  });
}

export interface DayPoint extends SalesSummary {
  date: ISODate;
  cashIn: number; // фактические поступления денег от покупателей (заказы и смены), проведённые
}

/** По дням: выручка, прибыль, чеки, заказы, возвраты, поступления. */
export function dailySeries(db: DB, from: ISODate, to: ISODate, filter: SalesFilter = {}): DayPoint[] {
  const key = `daily|${from}|${to}|${filter.employeeId ?? ''}|${filter.clientId ?? ''}|${filter.categoryId ?? ''}`;
  return memo(db, key, () => {
    const start = dayNum(from);
    const end = dayNum(to);
    const accs: Acc[] = [];
    for (let n = start; n <= end; n++) accs.push(newAcc());
    collect(db, from, to, filter, (d) => accs[dayNum(d) - start]);
    const cash: number[] = accs.map(() => 0);
    if (!filter.employeeId && !filter.categoryId) {
      for (const p of db.payments) {
        if (p.status !== 'posted' || p.direction !== 'in') continue;
        if (p.kind !== 'client' && p.kind !== 'shift') continue;
        if (filter.clientId && p.clientId !== filter.clientId) continue;
        const n = dayNum(p.at) - start;
        if (n >= 0 && n < cash.length) cash[n] += p.amount;
      }
    }
    return accs.map((a, i) => ({ date: isoDay(start + i), cashIn: cash[i], ...finish(a) }));
  });
}

/* ---------- периоды ---------- */

export type PeriodKind = 'today' | 'week' | 'month' | 'quarter';
export interface DateRange {
  kind?: PeriodKind;
  from: ISODate;
  to: ISODate;
}

/** Текущий период до сегодняшнего дня включительно: день, неделя с понедельника, месяц, квартал. */
export function periodRange(kind: PeriodKind, todayIso: ISODate): DateRange {
  if (kind === 'today') return { kind, from: todayIso, to: todayIso };
  if (kind === 'week') {
    const back = (dow(todayIso) + 6) % 7;
    return { kind, from: plusDays(todayIso, -back), to: todayIso };
  }
  if (kind === 'month') return { kind, from: firstOfMonth(todayIso), to: todayIso };
  const m = +todayIso.slice(5, 7);
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  return { kind, from: `${todayIso.slice(0, 4)}-${String(qm).padStart(2, '0')}-01`, to: todayIso };
}

/** Сопоставимый прошлый период: день — тот же день недели неделей раньше; неделя — прошлая неделя;
    месяц и квартал — те же дни прошлого месяца или квартала. Без вида — такой же отрезок прямо перед. */
export function previousRange(range: DateRange): DateRange {
  const len = diffDays(range.from, range.to);
  if (range.kind === 'today' || range.kind === 'week') {
    return { kind: range.kind, from: plusDays(range.from, -7), to: plusDays(range.to, -7) };
  }
  if (range.kind === 'month' || range.kind === 'quarter') {
    const k = range.kind === 'month' ? 1 : 3;
    const from = plusMonths(range.from, -k);
    let to = plusMonths(range.to, -k);
    const lastPrev = lastOfMonth(plusMonths(range.to, -k));
    if (range.to === lastOfMonth(range.to)) to = lastPrev;
    return { kind: range.kind, from, to };
  }
  return { from: plusDays(range.from, -(len + 1)), to: plusDays(range.from, -1) };
}
