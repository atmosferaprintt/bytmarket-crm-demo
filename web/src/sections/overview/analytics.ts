/* Расчёты аналитики владельца: обзор, «Требует внимания», отчёты. Всё — из базы, поверх общих расчётов selectors.ts.
   Правила те же, что в salesForPeriod: розница — по чекам (возврат по чеку — минус), опт — по отгрузке,
   возврат по заказу — минус в день возврата. Прибыль — только по строкам с известной себестоимостью. */
import type { DB, ID, ISODate, Order, Product } from '../../data/types';
import { clientBalances, indexes, stockIndex, supplierBalances, shiftSummary, purchaseAccepted } from '../../data/selectors';
import { dayNum, diffDays, firstOfMonth, isoDay, lastOfMonth, plusDays } from '../../data/dates';

/* ---------- запоминание по версии базы ---------- */

const cache = new WeakMap<DB, { v: number; m: Map<string, unknown> }>();

export function memoDB<T>(db: DB, key: string, fn: () => T): T {
  let c = cache.get(db);
  if (!c || c.v !== db.meta.version) {
    c = { v: db.meta.version, m: new Map() };
    cache.set(db, c);
  }
  if (c.m.has(key)) return c.m.get(key) as T;
  const value = fn();
  c.m.set(key, value);
  return value;
}

/* ---------- строки продаж ---------- */

export interface SaleFact {
  at: string;
  date: ISODate;
  productId: ID;
  qty: number; // со знаком: возврат — минус
  revenue: number; // со знаком
  cost: number | null; // себестоимость за штуку
  profit: number; // со знаком; 0, если себестоимость неизвестна
  channel: 'retail' | 'wholesale';
  clientId: ID | null;
  employeeId: ID | null; // продавец чека или ответственный за заказ
  docType: 'receipt' | 'order';
  docId: ID;
  promoId: ID | null;
  promoDiscount: number; // скидка по акции, ₽, со знаком
  manualDiscount: number; // ручная скидка, ₽, со знаком
  isReturn: boolean;
}

function splitDiscount(basePrice: number, price: number, pct: number, qty: number): { promo: number; manual: number } {
  const before = pct > 0 && pct < 100 ? price / (1 - pct / 100) : price;
  return { promo: Math.max(0, basePrice - before) * qty, manual: Math.max(0, before - price) * qty };
}

function allFacts(db: DB): SaleFact[] {
  return memoDB(db, 'facts', () => {
    const out: SaleFact[] = [];
    const ix = indexes(db);
    for (const r of db.receipts) {
      const sign = r.kind === 'sale' ? 1 : -1;
      for (const l of r.lines) {
        const q = sign * l.qty;
        const d = splitDiscount(l.basePrice, l.price, l.discountPct, q);
        out.push({
          at: r.at,
          date: r.at.slice(0, 10),
          productId: l.productId,
          qty: q,
          revenue: q * l.price,
          cost: l.cost,
          profit: l.cost !== null ? (l.price - l.cost) * q : 0,
          channel: 'retail',
          clientId: r.clientId,
          employeeId: r.sellerId,
          docType: 'receipt',
          docId: r.id,
          promoId: l.promoId,
          promoDiscount: d.promo,
          manualDiscount: d.manual,
          isReturn: sign < 0,
        });
      }
    }
    for (const m of db.movements) {
      if (m.kind !== 'ship') continue;
      const o = ix.orders.get(m.docId);
      if (!o) continue;
      const l = o.lines.find((ln) => ln.productId === m.productId);
      if (!l) continue;
      const q = -m.dOnHand;
      const d = splitDiscount(l.basePrice, l.price, l.discountPct, q);
      out.push({
        at: m.at,
        date: m.at.slice(0, 10),
        productId: m.productId,
        qty: q,
        revenue: q * l.price,
        cost: l.cost,
        profit: l.cost !== null ? (l.price - l.cost) * q : 0,
        channel: 'wholesale',
        clientId: o.clientId,
        employeeId: o.ownerId,
        docType: 'order',
        docId: o.id,
        promoId: l.promoId,
        promoDiscount: d.promo,
        manualDiscount: d.manual,
        isReturn: false,
      });
    }
    for (const r of db.returns) {
      if (r.source !== 'order' || !r.orderId) continue;
      const o = ix.orders.get(r.orderId);
      if (!o) continue;
      for (const l of r.lines) {
        const ol = o.lines.find((ln) => ln.productId === l.productId);
        const cost = ol ? ol.cost : null;
        const q = -l.qty;
        const d = ol ? splitDiscount(ol.basePrice, ol.price, ol.discountPct, q) : { promo: 0, manual: 0 };
        out.push({
          at: r.at,
          date: r.at.slice(0, 10),
          productId: l.productId,
          qty: q,
          revenue: q * l.price,
          cost,
          profit: cost !== null ? (l.price - cost) * q : 0,
          channel: 'wholesale',
          clientId: o.clientId,
          employeeId: o.ownerId,
          docType: 'order',
          docId: o.id,
          promoId: ol?.promoId ?? null,
          promoDiscount: d.promo,
          manualDiscount: d.manual,
          isReturn: true,
        });
      }
    }
    out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
    return out;
  });
}

/** Строки продаж за [from, to] включительно. */
export function saleFacts(db: DB, from: ISODate, to: ISODate): SaleFact[] {
  return memoDB(db, `facts|${from}|${to}`, () => {
    const all = allFacts(db);
    const lo = lowerBound(all, from);
    const hiKey = to + 'T99';
    const res: SaleFact[] = [];
    for (let i = lo; i < all.length && all[i].at < hiKey; i++) res.push(all[i]);
    return res;
  });
}

function lowerBound(a: SaleFact[], from: string): number {
  let lo = 0;
  let hi = a.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (a[mid].at < from) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export interface Agg {
  qty: number; // нетто, штук
  soldQty: number; // продано без возвратов
  revenue: number;
  profit: number;
  knownRevenue: number;
  lines: number;
  knownLines: number;
  returns: number; // сумма возвратов
  returnsQty: number;
  promoDiscount: number;
  manualDiscount: number;
  retail: number;
  wholesale: number;
}

export const emptyAgg = (): Agg => ({
  qty: 0,
  soldQty: 0,
  revenue: 0,
  profit: 0,
  knownRevenue: 0,
  lines: 0,
  knownLines: 0,
  returns: 0,
  returnsQty: 0,
  promoDiscount: 0,
  manualDiscount: 0,
  retail: 0,
  wholesale: 0,
});

export function addFact(a: Agg, f: SaleFact): void {
  a.qty += f.qty;
  a.revenue += f.revenue;
  a.profit += f.profit;
  if (f.cost !== null) a.knownRevenue += f.revenue;
  if (f.channel === 'retail') a.retail += f.revenue;
  else a.wholesale += f.revenue;
  a.promoDiscount += f.promoDiscount;
  a.manualDiscount += f.manualDiscount;
  if (f.isReturn) {
    a.returns += -f.revenue;
    a.returnsQty += -f.qty;
  } else {
    a.soldQty += f.qty;
    a.lines++;
    if (f.cost !== null) a.knownLines++;
  }
}

export function marginOf(a: Pick<Agg, 'profit' | 'knownRevenue'>): number | null {
  return a.knownRevenue > 0 ? (a.profit / a.knownRevenue) * 100 : null;
}

export function costShareOf(a: Pick<Agg, 'lines' | 'knownLines'>): number {
  return a.lines > 0 ? a.knownLines / a.lines : 1;
}

/** Свести строки продаж по ключу. */
export function groupFacts(facts: SaleFact[], key: (f: SaleFact) => string | null): Map<string, Agg> {
  const m = new Map<string, Agg>();
  for (const f of facts) {
    const k = key(f);
    if (k === null) continue;
    let a = m.get(k);
    if (!a) {
      a = emptyAgg();
      m.set(k, a);
    }
    addFact(a, f);
  }
  return m;
}

export function totalFacts(facts: SaleFact[]): Agg {
  const a = emptyAgg();
  for (const f of facts) addFact(a, f);
  return a;
}

export function productAgg(db: DB, from: ISODate, to: ISODate): Map<ID, Agg> {
  return memoDB(db, `pagg|${from}|${to}`, () => groupFacts(saleFacts(db, from, to), (f) => f.productId));
}

/** Категория верхнего уровня: «Гели для стирки» → «Стирка». */
export function topCategoryId(db: DB, categoryId: ID): ID {
  const c = indexes(db).categories.get(categoryId);
  return c?.parentId ?? categoryId;
}

/* ---------- товар: последняя продажа, дни без товара, спрос ---------- */

/** Дата последней продажи товара (касса или отгрузка), за всю историю. */
export function lastSaleIndex(db: DB): Map<ID, ISODate> {
  return memoDB(db, 'lastSale', () => {
    const m = new Map<ID, ISODate>();
    for (const f of allFacts(db)) if (!f.isReturn && f.qty > 0) m.set(f.productId, f.date);
    return m;
  });
}

interface OutIndex {
  start: number;
  days: Map<ID, Uint8Array>; // 1 — к концу дня товара не было ни в магазине, ни на складе
}

/** Дни отсутствия товара: восстанавливаем остаток на конец каждого дня по движениям, от сегодня назад. */
function outIndex(db: DB): OutIndex {
  return memoDB(db, 'outIndex', () => {
    const start = dayNum(db.meta.startDate);
    const end = dayNum(db.meta.today);
    const n = end - start + 1;
    const level = new Map<ID, number>();
    for (const s of db.stock) level.set(s.productId, (level.get(s.productId) ?? 0) + s.onHand);
    const movs = db.movements
      .filter((m) => m.dOnHand !== 0)
      .map((m) => ({ d: dayNum(m.at), p: m.productId, dq: m.dOnHand }))
      .sort((a, b) => a.d - b.d);
    const first = new Map<ID, number>();
    for (const m of movs) if (!first.has(m.p)) first.set(m.p, m.d);
    const days = new Map<ID, Uint8Array>();
    const prods = db.products.map((p) => ({ id: p.id, from: Math.max(start, dayNum(p.createdAt), first.get(p.id) ?? start) }));
    for (const p of prods) days.set(p.id, new Uint8Array(n));
    let i = movs.length - 1;
    for (let d = end; d >= start; d--) {
      while (i >= 0 && movs[i].d > d) {
        const m = movs[i];
        level.set(m.p, (level.get(m.p) ?? 0) - m.dq);
        i--;
      }
      for (const p of prods) {
        if (d < p.from) continue;
        if ((level.get(p.id) ?? 0) <= 0) days.get(p.id)![d - start] = 1;
      }
    }
    return { start, days };
  });
}

/** Сколько дней в [from, to] товара не было в наличии. */
export function outDays(db: DB, productId: ID, from: ISODate, to: ISODate): number {
  const ix = outIndex(db);
  const arr = ix.days.get(productId);
  if (!arr) return 0;
  const a = Math.max(0, dayNum(from) - ix.start);
  const b = Math.min(arr.length - 1, dayNum(to) - ix.start);
  let n = 0;
  for (let k = a; k <= b; k++) n += arr[k];
  return n;
}

export interface Demand {
  productId: ID;
  sold30: number; // продано за 30 дней, штук
  revenue30: number;
  inStockDays: number; // из 30 дней товар был в наличии
  daily: number; // продаж в день в дни наличия
  available: number; // магазин + склад, доступно
  expected: number; // ожидается по закупкам
  cover: number | null; // на сколько дней хватит с учётом ожидаемого
  leadDays: number; // срок поставки основного поставщика
  supplierId: ID | null;
  fast: boolean; // ходовой
}

/** Спрос за последние 30 дней и запас. «Ходовой» — верхние 20 % по выручке и не меньше 10 штук за 30 дней. */
export function demandIndex(db: DB): Map<ID, Demand> {
  return memoDB(db, 'demand', () => {
    const today = db.meta.today;
    const from = plusDays(today, -29);
    const agg = productAgg(db, from, today);
    const si = stockIndex(db);
    const ix = indexes(db);
    const rows: Demand[] = [];
    for (const p of db.products) {
      const a = agg.get(p.id);
      const st = si.get(p.id);
      const sold30 = a?.soldQty ?? 0;
      const absent = outDays(db, p.id, from, today);
      const inStockDays = Math.max(1, 30 - absent);
      const daily = sold30 / inStockDays;
      const available = Math.max(0, st?.total.available ?? 0);
      const expected = st?.expected ?? 0;
      const sup = p.supplierIds[0] ? ix.suppliers.get(p.supplierIds[0]) : undefined;
      rows.push({
        productId: p.id,
        sold30,
        revenue30: a?.revenue ?? 0,
        inStockDays,
        daily,
        available,
        expected,
        cover: daily > 0 ? (available + expected) / daily : null,
        leadDays: sup?.leadDays ?? 5,
        supplierId: sup?.id ?? null,
        fast: false,
      });
    }
    const sorted = rows.filter((r) => r.sold30 >= 10).sort((a, b) => b.revenue30 - a.revenue30);
    const cut = Math.ceil(rows.filter((r) => r.sold30 > 0).length * 0.2);
    sorted.slice(0, cut).forEach((r) => (r.fast = true));
    return new Map(rows.map((r) => [r.productId, r]));
  });
}

/** Ходовой товар заканчивается: запаса меньше, чем срок поставки плюс 2 дня. */
export function isShortage(d: Demand): boolean {
  if (!d.fast) return false;
  if (d.available <= 0 && d.expected <= 0) return true;
  return d.cover !== null && d.cover < d.leadDays + 2;
}

/** Продажи одного дня до заданного времени — чтобы сравнить «сегодня до 14:05» с тем же отрезком неделю назад. */
export function salesUntil(db: DB, date: ISODate, time: string): import('../../data/selectors').SalesSummary {
  return memoDB(db, `salesUntil|${date}|${time}`, () => {
    const hi = date + 'T' + time;
    const a = emptyAgg();
    const receipts = new Set<ID>();
    let retailSales = 0;
    for (const f of saleFacts(db, date, date)) {
      if (f.at > hi) continue;
      addFact(a, f);
      if (f.channel === 'retail' && !f.isReturn) {
        receipts.add(f.docId);
        retailSales += f.revenue;
      }
    }
    let orders = 0;
    for (const o of db.orders) if (o.createdAt.slice(0, 10) === date && o.createdAt <= hi && o.state !== 'cancelled' && o.state !== 'draft') orders++;
    return {
      revenue: a.revenue,
      retail: a.retail,
      wholesale: a.wholesale,
      grossProfit: a.profit,
      marginPct: a.knownRevenue > 0 ? (a.profit / a.knownRevenue) * 100 : 0,
      costKnownShare: a.lines > 0 ? a.knownLines / a.lines : 1,
      receiptsCount: receipts.size,
      ordersCount: orders,
      avgReceipt: receipts.size ? Math.round(retailSales / receipts.size) : 0,
      returns: a.returns,
      writeoffs: 0,
    };
  });
}

/* ---------- остатки ---------- */

export interface StockValue {
  total: number;
  shop: number;
  warehouse: number;
  unknownCost: number; // товаров с остатком без себестоимости
  dead: { value: number; count: number; days: number };
  belowMin: number;
  outOfStock: number;
}

export const DEAD_DAYS = 60;

/** Стоимость остатков по себестоимости, без движения, ниже минимума. Ниже минимума — как в меню: доступно < минимума. */
export function stockValue(db: DB): StockValue {
  return memoDB(db, 'stockValue', () => {
    const si = stockIndex(db);
    const last = lastSaleIndex(db);
    const today = db.meta.today;
    const border = plusDays(today, -DEAD_DAYS);
    let shop = 0;
    let warehouse = 0;
    let unknownCost = 0;
    let deadValue = 0;
    let deadCount = 0;
    let belowMin = 0;
    let outOfStock = 0;
    for (const p of db.products) {
      const s = si.get(p.id);
      if (!s) continue;
      if (p.active && s.total.available < p.minStock) belowMin++;
      if (p.active && s.total.onHand <= 0) outOfStock++;
      if (s.total.onHand <= 0) continue;
      if (p.cost === null) {
        unknownCost++;
        continue;
      }
      shop += s.shop.onHand * p.cost;
      warehouse += s.warehouse.onHand * p.cost;
      if (isDead(p, last.get(p.id), border)) {
        deadValue += s.total.onHand * p.cost;
        deadCount++;
      }
    }
    return {
      total: Math.round(shop + warehouse),
      shop: Math.round(shop),
      warehouse: Math.round(warehouse),
      unknownCost,
      dead: { value: Math.round(deadValue), count: deadCount, days: DEAD_DAYS },
      belowMin,
      outOfStock,
    };
  });
}

/** Без движения: продаж не было с даты border, и товар заведён раньше неё. */
export function isDead(p: Product, lastSale: ISODate | undefined, border: ISODate): boolean {
  if (p.createdAt > border) return false;
  return !lastSale || lastSale < border;
}

/* ---------- деньги ---------- */

/** Фактические поступления от покупателей: проведённые платежи по заказам и выручка смен, плюс открытая смена. */
export function cashIn(db: DB, from: ISODate, to: ISODate, until?: string): { total: number; bank: number; cash: number } {
  return memoDB(db, `cashIn|${from}|${to}|${until ?? ''}`, () => {
    let bank = 0;
    let cash = 0;
    const hi = until ? to + 'T' + until : to + 'T99';
    for (const p of db.payments) {
      if (p.status !== 'posted' || p.kind === 'transfer') continue;
      if (p.kind !== 'client' && p.kind !== 'shift') continue;
      if (p.at < from || p.at > hi) continue;
      const v = p.direction === 'in' ? p.amount : -p.amount;
      if (p.account === 'bank') bank += v;
      else cash += v;
    }
    for (const s of db.shifts) {
      if (s.closedAt || until) continue;
      const d = s.openedAt.slice(0, 10);
      if (d < from || d > to) continue;
      const sum = shiftSummary(db, s.id);
      cash += sum.cash;
      bank += sum.card;
    }
    return { total: bank + cash, bank, cash };
  });
}

export function clientDebtNow(db: DB): { debt: number; overdue: number; clients: number; overdueClients: number } {
  return memoDB(db, 'clientDebtNow', () => {
    let debt = 0;
    let overdue = 0;
    let clients = 0;
    let overdueClients = 0;
    for (const b of clientBalances(db).values()) {
      debt += b.debt;
      overdue += b.overdue;
      if (b.debt > 0) clients++;
      if (b.overdue > 0) overdueClients++;
    }
    return { debt, overdue, clients, overdueClients };
  });
}

/** Долг покупателей на конец дня date: отгружено минус возвраты минус оплачено, по каждому заказу. */
export function clientDebtAt(db: DB, date: ISODate): { debt: number; overdue: number } {
  return memoDB(db, 'clientDebtAt|' + date, () => {
    const hi = date + 'T99';
    const ix = indexes(db);
    const shipped = new Map<ID, number>();
    const paid = new Map<ID, number>();
    const add = (m: Map<ID, number>, k: ID, v: number) => m.set(k, (m.get(k) ?? 0) + v);
    for (const m of db.movements) {
      if (m.kind !== 'ship' || m.at > hi) continue;
      const o = ix.orders.get(m.docId);
      const l = o?.lines.find((ln) => ln.productId === m.productId);
      if (l) add(shipped, m.docId, -m.dOnHand * l.price);
    }
    for (const r of db.returns) {
      if (r.source !== 'order' || !r.orderId || r.at > hi) continue;
      add(shipped, r.orderId, -r.amount);
    }
    for (const p of db.payments) {
      if (p.status !== 'posted' || p.at > hi) continue;
      if (p.kind === 'client') for (const a of p.allocations) a.orderId && add(paid, a.orderId, a.amount);
      else if (p.kind === 'refund') for (const a of p.allocations) a.orderId && add(paid, a.orderId, -a.amount);
    }
    let debt = 0;
    let overdue = 0;
    for (const [oid, s] of shipped) {
      const d = Math.max(0, s - (paid.get(oid) ?? 0));
      if (d <= 0) continue;
      debt += d;
      const o = ix.orders.get(oid);
      if (o?.dueDate && o.dueDate < date) overdue += d;
    }
    return { debt, overdue };
  });
}

export function supplierDebtNow(db: DB): { debt: number; overdue: number; next: { date: ISODate; amount: number; supplierId: ID } | null } {
  return memoDB(db, 'supplierDebtNow', () => {
    let debt = 0;
    let overdue = 0;
    let next: { date: ISODate; amount: number; supplierId: ID } | null = null;
    const today = db.meta.today;
    for (const [sid, b] of supplierBalances(db)) {
      debt += b.debt;
      overdue += b.overdue;
      for (const u of b.upcoming) {
        if (u.dueDate < today) continue;
        if (!next || u.dueDate < next.date) next = { date: u.dueDate, amount: u.amount, supplierId: sid };
        else if (u.dueDate === next.date && next.supplierId === sid) next.amount += u.amount;
      }
    }
    return { debt, overdue, next };
  });
}

/** Долг поставщикам на конец дня date: принятое минус оплаченное. */
export function supplierDebtAt(db: DB, date: ISODate): number {
  return memoDB(db, 'supplierDebtAt|' + date, () => {
    const hi = date + 'T99';
    const paid = new Map<ID, number>();
    for (const p of db.payments) {
      if (p.kind !== 'supplier' || p.status !== 'posted' || p.at > hi) continue;
      for (const a of p.allocations) if (a.purchaseId) paid.set(a.purchaseId, (paid.get(a.purchaseId) ?? 0) + a.amount);
    }
    let debt = 0;
    for (const pu of db.purchases) {
      if (pu.state !== 'partial' && pu.state !== 'received') continue;
      if (!pu.receivedAt || pu.receivedAt > hi) continue;
      debt += Math.max(0, purchaseAccepted(db, pu.id) - (paid.get(pu.id) ?? 0));
    }
    return debt;
  });
}

/* ---------- план ---------- */

/** План на отрезок: месячный план × доля дней месяца в отрезке. null — плана нет. */
export function planFor(db: DB, from: ISODate, to: ISODate, employeeId: ID | null = null): number | null {
  let sum = 0;
  let any = false;
  let d = firstOfMonth(from);
  while (d <= to) {
    const month = d.slice(0, 7);
    const plan = db.plans.find((p) => p.month === month && p.employeeId === employeeId);
    const mFrom = d < from ? from : d;
    const last = lastOfMonth(d);
    const mTo = last > to ? to : last;
    if (plan) {
      any = true;
      const daysInMonth = diffDays(d, last) + 1;
      sum += (plan.amount * (diffDays(mFrom, mTo) + 1)) / daysInMonth;
    }
    d = plusDays(last, 1);
  }
  return any ? Math.round(sum) : null;
}

/* ---------- заказы с задержкой ---------- */

export type DelayKind = 'failed' | 'late' | 'waiting_courier' | 'not_shipped' | 'picking' | 'rescheduled';

export interface DelayItem {
  order: Order;
  kind: DelayKind;
  days: number;
  label: string; // текст чипа
  tone: 'bad' | 'warn' | 'info' | 'violet';
  reason: string; // простыми словами
  responsibleId: ID | null;
  deliveryId: ID | null;
}

const DELAY_RANK: Record<DelayKind, number> = { failed: 0, late: 1, waiting_courier: 2, not_shipped: 3, picking: 4, rescheduled: 5 };

function eventAt(o: Order, prefix: string): { at: string; actorId: ID } | null {
  for (let i = o.history.length - 1; i >= 0; i--) if (o.history[i].text.startsWith(prefix)) return o.history[i];
  return null;
}

const dd = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'день' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'дня' : 'дней'}`;

/** Заказы, которые застряли: на сборке, собраны и не отгружены, ждут курьера, опаздывают, не доставлены, перенесены. */
export function delayedOrders(db: DB): DelayItem[] {
  return memoDB(db, 'delayed', () => {
    const today = db.meta.today;
    const firstWarehouse = db.employees.find((e) => e.active && e.roles.includes('warehouse'))?.id ?? null;
    const dispatcher = db.employees.find((e) => e.active && e.roles.includes('dispatcher'))?.id ?? null;
    const res: DelayItem[] = [];
    const deliveries = new Map(db.deliveries.map((x) => [x.id, x]));
    for (const o of db.orders) {
      if (o.state !== 'confirmed' && o.state !== 'closed') continue;
      const d = o.deliveryId ? deliveries.get(o.deliveryId) : undefined;
      const items: DelayItem[] = [];
      if (d && d.state !== 'delivered' && d.state !== 'returned') {
        if (d.state === 'failed') {
          const last = d.attempts[d.attempts.length - 1];
          items.push({
            order: o,
            kind: 'failed',
            days: last ? Math.max(0, diffDays(last.at.slice(0, 10), today)) : 0,
            label: 'Не доставлен',
            tone: 'bad',
            reason: `Доставка не удалась${last?.reason ? ': ' + last.reason.toLowerCase() : ''}. Нужно решить: повторить или вернуть на склад`,
            responsibleId: dispatcher,
            deliveryId: d.id,
          });
        } else if ((d.state === 'assigned' || d.state === 'on_way') && d.date < today) {
          const n = diffDays(d.date, today);
          items.push({ order: o, kind: 'late', days: n, label: `Опаздывает ${dd(n)}`, tone: 'bad', reason: `Доставку ждали ${fmtDay(d.date)}, до клиента не доехала`, responsibleId: d.courierId ?? dispatcher, deliveryId: d.id });
        } else if (d.state === 'waiting' && d.date <= today) {
          const n = diffDays(d.date, today);
          items.push({
            order: o,
            kind: 'waiting_courier',
            days: n,
            label: 'Ждёт курьера',
            tone: 'info',
            reason: n > 0 ? `Доставка на ${fmtDay(d.date)} так и не назначена курьеру` : 'Доставка на сегодня ещё не назначена курьеру',
            responsibleId: dispatcher,
            deliveryId: d.id,
          });
        } else if (eventAt(o, 'Доставка перенесена')) {
          const ev = eventAt(o, 'Доставка перенесена')!;
          items.push({ order: o, kind: 'rescheduled', days: diffDays(ev.at.slice(0, 10), today), label: 'Перенос', tone: 'warn', reason: `Доставку перенесли на ${fmtDay(d.date)}`, responsibleId: dispatcher, deliveryId: d.id });
        }
      }
      if (o.state === 'confirmed' && o.ship !== 'shipped' && o.ship !== 'delivered') {
        const confirmed = eventAt(o, 'Подтверждён')?.at ?? o.createdAt;
        if (o.pick !== 'picked') {
          const n = diffDays(confirmed.slice(0, 10), today);
          const started = eventAt(o, 'Сборка начата');
          if (n >= 2)
            items.push({
              order: o,
              kind: 'picking',
              days: n,
              label: `Сборка ${dd(n)}`,
              tone: 'warn',
              reason: o.pick === 'picking' ? `Сборку начали ${fmtDay(started!.at)}, заказ до сих пор не собран` : `Заказ подтверждён ${fmtDay(confirmed)}, сборку не начинали`,
              responsibleId: started?.actorId ?? firstWarehouse,
              deliveryId: d?.id ?? null,
            });
        } else {
          const picked = eventAt(o, 'Собран')?.at ?? confirmed;
          const n = diffDays(picked.slice(0, 10), today);
          const waitingForDate = d && d.date > today;
          if (n >= 1 && !waitingForDate)
            items.push({
              order: o,
              kind: 'not_shipped',
              days: n,
              label: 'Не отгружен',
              tone: 'bad',
              reason: o.fulfillment === 'pickup' ? `Собран ${fmtDay(picked)}, клиент не забрал` : `Собран ${fmtDay(picked)}, не отгружен${d ? '' : ': доставка не оформлена'}`,
              responsibleId: o.fulfillment === 'pickup' ? o.ownerId : d ? dispatcher : o.ownerId,
              deliveryId: d?.id ?? null,
            });
        }
      }
      if (items.length) {
        items.sort((a, b) => DELAY_RANK[a.kind] - DELAY_RANK[b.kind]);
        res.push(items[0]);
      }
    }
    res.sort((a, b) => DELAY_RANK[a.kind] - DELAY_RANK[b.kind] || b.days - a.days || b.order.total - a.order.total);
    return res;
  });
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export function fmtDay(iso: string): string {
  return `${+iso.slice(8, 10)} ${MONTHS_GEN[+iso.slice(5, 7) - 1]}`;
}

/* ---------- возвраты и списания ---------- */

export interface LossSummary {
  returns: number; // возвраты покупателей по цене продажи
  returnsCount: number;
  writeoffs: { reason: string; key: string; value: number; qty: number }[]; // по себестоимости
  writeoffTotal: number;
  total: number;
}

const WO_NAMES: Record<string, string> = { leak: 'протечка', damage: 'повреждение', expired: 'истёк срок', shortage: 'недостача', other: 'другое' };

export function lossesFor(db: DB, from: ISODate, to: ISODate): LossSummary {
  return memoDB(db, `loss|${from}|${to}`, () => {
    const hi = to + 'T99';
    let returns = 0;
    let returnsCount = 0;
    for (const r of db.receipts) {
      if (r.kind !== 'refund' || r.at < from || r.at > hi) continue;
      returns += r.total;
      returnsCount++;
    }
    for (const r of db.returns) {
      if (r.source !== 'order' || r.at < from || r.at > hi) continue;
      returns += r.amount;
      returnsCount++;
    }
    const by = new Map<string, { value: number; qty: number }>();
    const ix = indexes(db);
    for (const doc of db.stockDocs) {
      if (doc.kind !== 'writeoff' || doc.at < from || doc.at > hi) continue;
      for (const l of doc.lines) {
        const k = l.reason ?? 'other';
        const x = by.get(k) ?? { value: 0, qty: 0 };
        x.value += l.qty * (ix.products.get(l.productId)?.cost ?? 0);
        x.qty += l.qty;
        by.set(k, x);
      }
    }
    const writeoffs = [...by.entries()]
      .map(([key, v]) => ({ key, reason: WO_NAMES[key] ?? key, value: Math.round(v.value), qty: v.qty }))
      .sort((a, b) => b.value - a.value);
    const writeoffTotal = writeoffs.reduce((s, w) => s + w.value, 0);
    return { returns, returnsCount, writeoffs, writeoffTotal, total: returns + writeoffTotal };
  });
}

/* ---------- по дням и часам ---------- */

export interface HourPoint {
  hour: number;
  revenue: number;
  retail: number;
  wholesale: number;
}

/** Продажи по часам за один день (для периода «Сегодня»). */
export function hourlySeries(db: DB, date: ISODate): HourPoint[] {
  return memoDB(db, 'hourly|' + date, () => {
    const pts: HourPoint[] = [];
    for (let h = 8; h <= 20; h++) pts.push({ hour: h, revenue: 0, retail: 0, wholesale: 0 });
    for (const f of saleFacts(db, date, date)) {
      const h = Math.min(20, Math.max(8, +f.at.slice(11, 13)));
      const p = pts[h - 8];
      p.revenue += f.revenue;
      if (f.channel === 'retail') p.retail += f.revenue;
      else p.wholesale += f.revenue;
    }
    return pts;
  });
}

/** Дни отрезка списком. */
export function daysOf(from: ISODate, to: ISODate): ISODate[] {
  const a = dayNum(from);
  const b = dayNum(to);
  const out: ISODate[] = [];
  for (let n = a; n <= b; n++) out.push(isoDay(n));
  return out;
}
