/* Расчёты подробных отчётов. Строки продаж — общие с обзором (overview/analytics), поэтому итоги сходятся. */
import type { Client, DB, Delivery, Employee, ID, ISODate, Product, Promo, RoleKey } from '../../data/types';
import { categoryFamily, clientBalances, courierCash, indexes, stockIndex } from '../../data/selectors';
import { diffDays, plusDays } from '../../data/dates';
import { planProgress, type PlanProgress } from '../../data/kpis';
import { isBelowMin } from '../../data/thresholds';
import {
  DEAD_DAYS,
  deliveryLateNow,
  demandIndex,
  firstPurchaseIndex,
  newClientIds,
  nowAt,
  emptyAgg,
  addFact,
  groupFacts,
  isDead,
  isShortage,
  lastSaleIndex,
  marginOf,
  memoDB,
  outDays,
  productAgg,
  saleFacts,
  topCategoryId,
  totalFacts,
  type Agg,
} from '../overview/analytics';

export const periodDays = (from: ISODate, to: ISODate) => diffDays(from, to) + 1;

/* ---------- товары ---------- */

export interface ProductRow {
  p: Product;
  brand: string;
  category: string;
  catId: ID;
  agg: Agg;
  margin: number | null;
  share: number;
  onHand: number;
  available: number;
  stockValue: number | null;
  outDays: number;
  lastSale: ISODate | null;
  sinceSale: number | null;
  prevRevenue: number;
}

export function productRows(db: DB, from: ISODate, to: ISODate, prevFrom: ISODate, prevTo: ISODate): ProductRow[] {
  return memoDB(db, `rp-prod|${from}|${to}|${prevFrom}`, () => {
    const ix = indexes(db);
    const agg = productAgg(db, from, to);
    const prev = productAgg(db, prevFrom, prevTo);
    const si = stockIndex(db);
    const last = lastSaleIndex(db);
    const total = [...agg.values()].reduce((s, a) => s + a.revenue, 0);
    const today = db.meta.today;
    return db.products.map((p) => {
      const a = agg.get(p.id) ?? emptyAgg();
      const s = si.get(p.id);
      const catId = topCategoryId(db, p.categoryId);
      const ls = last.get(p.id) ?? null;
      return {
        p,
        brand: ix.brands.get(p.brandId)?.name ?? '—',
        category: ix.categories.get(catId)?.name ?? '—',
        catId,
        agg: a,
        margin: marginOf(a),
        share: total > 0 ? a.revenue / total : 0,
        onHand: s?.total.onHand ?? 0,
        available: s?.total.available ?? 0,
        stockValue: p.cost === null ? null : (s?.total.onHand ?? 0) * p.cost,
        outDays: outDays(db, p.id, from, to),
        lastSale: ls,
        sinceSale: ls ? diffDays(ls, today) : null,
        prevRevenue: prev.get(p.id)?.revenue ?? 0,
      };
    });
  });
}

export interface GroupRow {
  id: ID;
  name: string;
  agg: Agg;
  margin: number | null;
  share: number;
  skus: number;
  prevRevenue: number;
  products: ID[];
}

export function groupRows(rows: ProductRow[], by: 'category' | 'brand'): GroupRow[] {
  const m = new Map<ID, GroupRow>();
  const total = rows.reduce((s, r) => s + r.agg.revenue, 0);
  for (const r of rows) {
    if (!r.agg.lines && !r.agg.returnsQty && !r.prevRevenue) continue;
    const id = by === 'category' ? r.catId : r.p.brandId;
    let g = m.get(id);
    if (!g) {
      g = { id, name: by === 'category' ? r.category : r.brand, agg: emptyAgg(), margin: null, share: 0, skus: 0, prevRevenue: 0, products: [] };
      m.set(id, g);
    }
    const a = g.agg;
    const b = r.agg;
    a.qty += b.qty;
    a.soldQty += b.soldQty;
    a.revenue += b.revenue;
    a.profit += b.profit;
    a.knownRevenue += b.knownRevenue;
    a.lines += b.lines;
    a.knownLines += b.knownLines;
    a.returns += b.returns;
    a.returnsQty += b.returnsQty;
    a.promoDiscount += b.promoDiscount;
    a.manualDiscount += b.manualDiscount;
    if (b.lines > 0 || b.returnsQty > 0) g.skus++; // тот же счёт, что в рейтинге: товары с продажами или возвратами за период
    g.prevRevenue += r.prevRevenue;
    g.products.push(r.p.id);
  }
  for (const g of m.values()) {
    g.margin = marginOf(g.agg);
    g.share = total > 0 ? g.agg.revenue / total : 0;
  }
  return [...m.values()].sort((a, b) => b.agg.revenue - a.agg.revenue);
}

export interface ExpiryRow {
  id: ID;
  p: Product;
  location: 'shop' | 'warehouse';
  qty: number;
  expiry: ISODate;
  daysLeft: number;
  value: number | null;
}

export function expiryRows(db: DB, horizon = 60): ExpiryRow[] {
  return memoDB(db, 'rp-expiry|' + horizon, () => {
    const ix = indexes(db);
    const today = db.meta.today;
    const border = plusDays(today, horizon);
    const out: ExpiryRow[] = [];
    for (const b of db.batches) {
      if (b.qty <= 0 || b.expiry > border) continue;
      const p = ix.products.get(b.productId);
      if (!p) continue;
      out.push({ id: b.id, p, location: b.location, qty: b.qty, expiry: b.expiry, daysLeft: diffDays(today, b.expiry), value: p.cost === null ? null : p.cost * b.qty });
    }
    return out.sort((a, z) => a.daysLeft - z.daysLeft);
  });
}

export interface DeficitRow {
  p: Product;
  sold30: number;
  daily: number;
  available: number;
  expected: number;
  minStock: number;
  cover: number | null;
  leadDays: number;
  fast: boolean;
  shortage: boolean;
  belowMin: boolean;
  out: boolean;
}

export function deficitRows(db: DB): DeficitRow[] {
  return memoDB(db, 'rp-deficit', () => {
    const ix = indexes(db);
    const out: DeficitRow[] = [];
    for (const d of demandIndex(db).values()) {
      const p = ix.products.get(d.productId);
      if (!p || !p.active) continue;
      const shortage = isShortage(d);
      const belowMin = isBelowMin(d.available, p.minStock);
      if (!shortage && !belowMin) continue;
      out.push({
        p,
        sold30: d.sold30,
        daily: d.daily,
        available: d.available,
        expected: d.expected,
        minStock: p.minStock,
        cover: d.cover,
        leadDays: d.leadDays,
        fast: d.fast,
        shortage,
        belowMin,
        out: d.available <= 0,
      });
    }
    return out.sort((a, b) => Number(b.shortage) - Number(a.shortage) || b.daily * b.p.retailPrice - a.daily * a.p.retailPrice);
  });
}

export { DEAD_DAYS, isDead };

/* ---------- клиенты ---------- */

export interface ClientRow {
  c: Client;
  ownerName: string;
  agg: Agg;
  margin: number | null;
  docs: number;
  avg: number;
  everyDays: number | null; // фактическая частота за историю
  lastAt: string | null;
  last30: number;
  prev30: number;
  activity: 'drop' | 'stopped' | 'growth' | 'flat' | 'new' | 'back';
  isNew: boolean; // новый клиент за период — то же правило, что в отчёте «Сотрудники»
  activityPct: number | null;
  debt: number;
  overdue: number;
  overdueDays: number;
  onTime: number | null; // доля заказов, оплаченных в срок, 0…1
  dueOrders: number;
  missing: string[]; // ходовые категории сегмента, которых клиент не берёт
}

/** Для каждого заказа с наступившим сроком: оплачен ли полностью к сроку. */
function paidOnTimeIndex(db: DB): Map<ID, { due: number; onTime: number }> {
  return memoDB(db, 'rp-ontime', () => {
    const pays = new Map<ID, { at: string; amount: number }[]>();
    for (const p of db.payments) {
      if (p.status !== 'posted') continue;
      if (p.kind !== 'client' && p.kind !== 'refund') continue;
      const sign = p.kind === 'client' ? 1 : -1;
      for (const a of p.allocations) {
        if (!a.orderId) continue;
        let arr = pays.get(a.orderId);
        if (!arr) pays.set(a.orderId, (arr = []));
        arr.push({ at: p.at, amount: sign * a.amount });
      }
    }
    const today = db.meta.today;
    const res = new Map<ID, { due: number; onTime: number }>();
    for (const o of db.orders) {
      if (!o.dueDate || o.dueDate > today || o.state === 'cancelled' || o.state === 'draft') continue;
      let shipped = 0;
      for (const l of o.lines) shipped += l.shipped * l.price;
      if (shipped <= 0) continue;
      const hi = o.dueDate + 'T99';
      let paid = 0;
      for (const x of pays.get(o.id) ?? []) if (x.at <= hi) paid += x.amount;
      const r = res.get(o.clientId) ?? { due: 0, onTime: 0 };
      r.due++;
      if (paid >= shipped - 1) r.onTime++;
      res.set(o.clientId, r);
    }
    return res;
  });
}

export function clientRows(db: DB, from: ISODate, to: ISODate): ClientRow[] {
  return memoDB(db, `rp-clients|${from}|${to}`, () => {
    const ix = indexes(db);
    const today = db.meta.today;
    const facts = saleFacts(db, from, to).filter((f) => f.clientId);
    const agg = groupFacts(facts, (f) => f.clientId);
    const docs = new Map<ID, Set<ID>>();
    for (const f of facts) {
      if (f.isReturn) continue;
      let s = docs.get(f.clientId!);
      if (!s) docs.set(f.clientId!, (s = new Set()));
      s.add(f.docId);
    }
    const f30 = groupFacts(saleFacts(db, plusDays(today, -29), today), (f) => f.clientId);
    const p30 = groupFacts(saleFacts(db, plusDays(today, -59), plusDays(today, -30)), (f) => f.clientId);
    // частота: среднее между днями покупок за всю историю
    const days = new Map<ID, Set<ISODate>>();
    const catsByClient = new Map<ID, Set<ID>>();
    for (const f of saleFacts(db, db.meta.startDate, today)) {
      if (!f.clientId || f.isReturn) continue;
      let s = days.get(f.clientId);
      if (!s) days.set(f.clientId, (s = new Set()));
      s.add(f.date);
      const p = ix.products.get(f.productId);
      if (p) {
        let c = catsByClient.get(f.clientId);
        if (!c) catsByClient.set(f.clientId, (c = new Set()));
        c.add(topCategoryId(db, p.categoryId));
      }
    }
    // ходовые категории сегмента: берут не меньше 60 % клиентов сегмента
    const segCats = new Map<string, { id: ID; share: number }[]>();
    const segClients = new Map<string, ID[]>();
    for (const c of db.clients) {
      if (!catsByClient.has(c.id)) continue;
      const a = segClients.get(c.segment) ?? [];
      a.push(c.id);
      segClients.set(c.segment, a);
    }
    for (const [seg, ids] of segClients) {
      const cnt = new Map<ID, number>();
      for (const id of ids) for (const cat of catsByClient.get(id) ?? []) cnt.set(cat, (cnt.get(cat) ?? 0) + 1);
      segCats.set(
        seg,
        [...cnt.entries()]
          .map(([id, n]) => ({ id, share: n / ids.length }))
          .filter((x) => x.share >= 0.6)
          .sort((a, b) => b.share - a.share),
      );
    }
    const bal = clientBalances(db);
    const onTime = paidOnTimeIndex(db);
    const fresh = newClientIds(db, from, to);
    const rows: ClientRow[] = [];
    for (const c of db.clients) {
      const a = agg.get(c.id) ?? emptyAgg();
      const b = bal.get(c.id);
      const l30 = f30.get(c.id)?.revenue ?? 0;
      const pr30 = p30.get(c.id)?.revenue ?? 0;
      if (!a.lines && !a.returnsQty && !(b && b.debt > 0) && !l30 && !pr30) continue;
      const ds = [...(days.get(c.id) ?? [])].sort();
      const everyDays = ds.length >= 3 ? Math.round(diffDays(ds[0], ds[ds.length - 1]) / (ds.length - 1)) : null;
      let activity: ClientRow['activity'] = 'flat';
      let activityPct: number | null = null;
      if (pr30 > 0) activityPct = ((l30 - pr30) / pr30) * 100;
      const isNew = fresh.has(c.id);
      if (isNew) activity = 'new';
      else if (pr30 > 0 && l30 === 0) activity = 'stopped';
      else if (pr30 === 0 && l30 > 0) activity = 'back';
      else if (activityPct !== null && activityPct <= -30 && pr30 >= 3000) activity = 'drop';
      else if (activityPct !== null && activityPct >= 25) activity = 'growth';
      const has = catsByClient.get(c.id) ?? new Set<ID>();
      const missing = c.segment === 'retail' ? [] : (segCats.get(c.segment) ?? []).filter((x) => !has.has(x.id)).slice(0, 2).map((x) => ix.categories.get(x.id)?.name ?? '');
      const ot = onTime.get(c.id);
      const nDocs = docs.get(c.id)?.size ?? 0;
      rows.push({
        c,
        ownerName: c.ownerId ? ix.employees.get(c.ownerId)?.name ?? '—' : '—',
        agg: a,
        margin: marginOf(a),
        docs: nDocs,
        avg: nDocs ? Math.round(a.revenue / nDocs) : 0,
        everyDays,
        lastAt: b?.lastOrderAt ?? null,
        last30: l30,
        prev30: pr30,
        activity,
        activityPct,
        isNew,
        debt: b?.debt ?? 0,
        overdue: b?.overdue ?? 0,
        overdueDays: b?.maxOverdueDays ?? 0,
        onTime: ot && ot.due ? ot.onTime / ot.due : null,
        dueOrders: ot?.due ?? 0,
        missing,
      });
    }
    return rows.sort((a, b) => b.agg.revenue - a.agg.revenue);
  });
}

/* ---------- сотрудники ---------- */

export interface StaffRow {
  e: Employee;
  role: RoleKey;
  agg: Agg;
  margin: number | null;
  receipts: number;
  orders: number;
  docsTotal: number; // сумма созданных за период чеков и заказов
  avg: number;
  newClients: number;
  repeatDocs: number;
  cancelled: number;
  clientsDebt: number;
  clientsOverdue: number;
  plan: PlanProgress; // план месяца — planProgress, одна формула со всеми экранами
  visits: VisitStat | null;
}

export interface VisitStat {
  planned: number;
  done: number;
  missed: number;
  order: number;
  callback: number;
  refusal: number;
  topRefusal: string | null;
  orderSum: number;
}

export function staffRows(db: DB, from: ISODate, to: ISODate): StaffRow[] {
  return memoDB(db, `rp-staff|${from}|${to}`, () => {
    const ix = indexes(db);
    const hi = to + 'T99';
    const facts = saleFacts(db, from, to);
    const agg = groupFacts(facts, (f) => f.employeeId);
    // новый клиент засчитан тому, кто оформил его первую покупку; правило — newClientIds, как в отчёте «Клиенты»
    const first = firstPurchaseIndex(db);
    const newBy = new Map<ID, number>();
    for (const cid of newClientIds(db, from, to)) {
      const emp = first.get(cid)?.employeeId;
      if (emp) newBy.set(emp, (newBy.get(emp) ?? 0) + 1);
    }
    const receipts = new Map<ID, { n: number; sum: number; repeat: number }>();
    for (const r of db.receipts) {
      if (r.kind !== 'sale' || r.at < from || r.at > hi) continue;
      const x = receipts.get(r.sellerId) ?? { n: 0, sum: 0, repeat: 0 };
      x.n++;
      x.sum += r.total;
      if (r.clientId && (first.get(r.clientId)?.date ?? '9') < r.at.slice(0, 10)) x.repeat++;
      receipts.set(r.sellerId, x);
    }
    const orders = new Map<ID, { n: number; sum: number; repeat: number; cancelled: number }>();
    for (const o of db.orders) {
      if (!o.ownerId) continue;
      const x = orders.get(o.ownerId) ?? { n: 0, sum: 0, repeat: 0, cancelled: 0 };
      if (o.state === 'cancelled') {
        const ev = o.history.find((h) => h.text.startsWith('Отменён') || h.text.startsWith('Возвращён'));
        const at = ev?.at ?? o.createdAt;
        if (at >= from && at <= hi) x.cancelled++;
      } else if (o.state !== 'draft' && o.createdAt >= from && o.createdAt <= hi) {
        x.n++;
        x.sum += o.total;
        if ((first.get(o.clientId)?.date ?? '9') < o.createdAt.slice(0, 10)) x.repeat++;
      }
      orders.set(o.ownerId, x);
    }
    const bal = clientBalances(db);
    const debtBy = new Map<ID, { debt: number; overdue: number }>();
    for (const c of db.clients) {
      if (!c.ownerId) continue;
      const b = bal.get(c.id);
      if (!b) continue;
      const x = debtBy.get(c.ownerId) ?? { debt: 0, overdue: 0 };
      x.debt += b.debt;
      x.overdue += b.overdue;
      debtBy.set(c.ownerId, x);
    }
    const visits = new Map<ID, VisitStat>();
    const refusals = new Map<ID, Map<string, number>>();
    for (const v of db.visits) {
      if (v.date < from || v.date > to) continue;
      const x = visits.get(v.repId) ?? { planned: 0, done: 0, missed: 0, order: 0, callback: 0, refusal: 0, topRefusal: null, orderSum: 0 };
      x.planned++;
      if (v.state === 'done') x.done++;
      if (v.state === 'missed') x.missed++;
      if (v.result === 'order') {
        x.order++;
        const o = v.orderId ? ix.orders.get(v.orderId) : undefined;
        if (o && o.state !== 'cancelled') x.orderSum += o.total;
      }
      if (v.result === 'callback') x.callback++;
      if (v.result === 'refusal') {
        x.refusal++;
        const m = refusals.get(v.repId) ?? new Map<string, number>();
        const k = v.refusalReason ?? 'Без причины';
        m.set(k, (m.get(k) ?? 0) + 1);
        refusals.set(v.repId, m);
      }
      visits.set(v.repId, x);
    }
    for (const [rep, m] of refusals) {
      const top = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
      const x = visits.get(rep);
      if (x && top) x.topRefusal = top[0];
    }
    const rows: StaffRow[] = [];
    for (const e of db.employees) {
      const role = (['seller', 'manager', 'rep'] as RoleKey[]).find((r) => e.roles.includes(r)) ?? (e.roles.includes('owner') ? 'owner' : null);
      if (!role) continue;
      const a = agg.get(e.id) ?? emptyAgg();
      const rc = receipts.get(e.id);
      const oc = orders.get(e.id);
      const plan = planProgress(db, e.id, to);
      if (!a.lines && !a.returnsQty && !oc?.n && !rc?.n && plan.plan === null && !visits.get(e.id)) continue;
      const docsN = (rc?.n ?? 0) + (oc?.n ?? 0);
      const docsSum = (rc?.sum ?? 0) + (oc?.sum ?? 0);
      rows.push({
        e,
        role,
        agg: a,
        margin: marginOf(a),
        receipts: rc?.n ?? 0,
        orders: oc?.n ?? 0,
        docsTotal: docsSum,
        avg: docsN ? Math.round(docsSum / docsN) : 0,
        newClients: newBy.get(e.id) ?? 0,
        repeatDocs: (rc?.repeat ?? 0) + (oc?.repeat ?? 0),
        cancelled: oc?.cancelled ?? 0,
        clientsDebt: debtBy.get(e.id)?.debt ?? 0,
        clientsOverdue: debtBy.get(e.id)?.overdue ?? 0,
        plan,
        visits: visits.get(e.id) ?? null,
      });
    }
    const order: Record<string, number> = { manager: 0, rep: 1, seller: 2, owner: 3 };
    return rows.sort((a, b) => order[a.role] - order[b.role] || b.agg.revenue - a.agg.revenue);
  });
}

/* ---------- акции ---------- */

export type PromoState = 'active' | 'future' | 'ended' | 'off'; // слова — PROMO_STATE

export interface PromoRow {
  pr: Promo;
  state: PromoState;
  target: string;
  productIds: ID[];
  agg: Agg;
  margin: number | null;
  receipts: number;
  avgWith: number;
  avgAll: number;
  before: number; // выручка тех же товаров за столько же дней до акции
  during: number; // выручка тех же товаров за дни акции (до сегодня)
  growth: number | null;
  stockQty: number;
  stockValue: number;
  absentProducts: number; // товаров, которых не было 3 дня и больше за время акции
}

export function promoTargets(db: DB, pr: Promo): ID[] {
  const t = pr.target;
  if (t.type === 'products') return t.ids;
  if (t.type === 'brand') return db.products.filter((p) => p.brandId === t.id).map((p) => p.id);
  const fam = categoryFamily(db, t.id);
  return db.products.filter((p) => fam.has(p.categoryId)).map((p) => p.id);
}

export function promoRows(db: DB, from: ISODate, to: ISODate): PromoRow[] {
  return memoDB(db, `rp-promos|${from}|${to}`, () => {
    const ix = indexes(db);
    const today = db.meta.today;
    const si = stockIndex(db);
    const facts = saleFacts(db, from, to);
    const byPromo = groupFacts(facts, (f) => f.promoId);
    const receiptsWith = new Map<ID, Set<ID>>();
    for (const f of facts) {
      if (!f.promoId || f.docType !== 'receipt' || f.isReturn) continue;
      let s = receiptsWith.get(f.promoId);
      if (!s) receiptsWith.set(f.promoId, (s = new Set()));
      s.add(f.docId);
    }
    const rIx = new Map(db.receipts.map((r) => [r.id, r]));
    let allSum = 0;
    let allN = 0;
    const hi = to + 'T99';
    for (const r of db.receipts) if (r.kind === 'sale' && r.at >= from && r.at <= hi) ((allSum += r.total), allN++);
    const rows: PromoRow[] = [];
    for (const pr of db.promos) {
      if (pr.start > to || pr.end < from) continue;
      const ids = promoTargets(db, pr);
      const idSet = new Set(ids);
      const a = byPromo.get(pr.id) ?? emptyAgg();
      const rec = receiptsWith.get(pr.id);
      let wSum = 0;
      for (const id of rec ?? []) wSum += rIx.get(id)?.total ?? 0;
      const state: PromoState = !pr.active ? 'off' : pr.start > today ? 'future' : pr.end < today ? 'ended' : 'active';
      // сравнение: дни акции (до сегодня) против стольких же дней перед ней; с учётом аудитории
      const dFrom = pr.start < db.meta.startDate ? db.meta.startDate : pr.start;
      const dTo = pr.end > today ? today : pr.end;
      let during = 0;
      let before = 0;
      let growth: number | null = null;
      let absent = 0;
      if (dFrom <= dTo) {
        const len = diffDays(dFrom, dTo) + 1;
        const bFrom = plusDays(dFrom, -len);
        const bTo = plusDays(dFrom, -1);
        const ok = (ch: 'retail' | 'wholesale') => pr.audience === 'all' || (pr.audience === 'retail' ? ch === 'retail' : ch === 'wholesale');
        for (const f of saleFacts(db, dFrom, dTo)) if (idSet.has(f.productId) && ok(f.channel)) during += f.revenue;
        if (bFrom >= db.meta.startDate) {
          for (const f of saleFacts(db, bFrom, bTo)) if (idSet.has(f.productId) && ok(f.channel)) before += f.revenue;
          growth = before > 0 ? ((during - before) / before) * 100 : null;
        }
        for (const id of ids) if (outDays(db, id, dFrom, dTo) >= 3) absent++;
      }
      let stockQty = 0;
      let stockValue = 0;
      for (const id of ids) {
        const s = si.get(id);
        const p = ix.products.get(id);
        if (!s || !p) continue;
        stockQty += s.total.onHand;
        stockValue += s.total.onHand * (p.cost ?? 0);
      }
      const t = pr.target;
      const target =
        t.type === 'products'
          ? ids.length === 1
            ? ix.products.get(ids[0])?.name ?? 'Товар'
            : `${ids.length} ${ids.length % 10 >= 2 && ids.length % 10 <= 4 && (ids.length % 100 < 10 || ids.length % 100 >= 20) ? 'товара' : ids.length % 10 === 1 && ids.length % 100 !== 11 ? 'товар' : 'товаров'}`
          : t.type === 'brand'
            ? `Бренд ${ix.brands.get(t.id)?.name ?? ''}`
            : `Категория «${ix.categories.get(t.id)?.name ?? ''}»`;
      rows.push({
        pr,
        state,
        target,
        productIds: ids,
        agg: a,
        margin: marginOf(a),
        receipts: rec?.size ?? 0,
        avgWith: rec?.size ? Math.round(wSum / rec.size) : 0,
        avgAll: allN ? Math.round(allSum / allN) : 0,
        before,
        during,
        growth,
        stockQty,
        stockValue: Math.round(stockValue),
        absentProducts: absent,
      });
    }
    const rank: Record<PromoState, number> = { active: 0, future: 1, ended: 2, off: 3 };
    return rows.sort((a, b) => rank[a.state] - rank[b.state] || b.agg.revenue - a.agg.revenue);
  });
}

/* ---------- доставка ---------- */

/** on_time — вручена вовремя; late — вручена с опозданием; late_now — не вручена, а интервал уже прошёл (как «Опаздывают» на экране доставки);
    failed — не доставлена; open — в работе и пока в срок. */
export type DeliveryOutcome = 'on_time' | 'late' | 'late_now' | 'failed' | 'open';

export interface DeliveryFact {
  d: Delivery;
  outcome: DeliveryOutcome;
  failedAttempts: number;
  repeat: boolean;
  lastReason: string | null;
  underpaid: boolean;
  spent: boolean; // курьер уже выезжал — расход на доставку случился
}

export function deliveryFacts(db: DB, from: ISODate, to: ISODate, now: string = nowAt()): DeliveryFact[] {
  return memoDB(db, `rp-deliv|${from}|${to}|${now}`, () => {
    const out: DeliveryFact[] = [];
    for (const d of db.deliveries) {
      if (d.date < from || d.date > to) continue;
      const failed = d.attempts.filter((a) => a.result === 'failed');
      const done = d.attempts.find((a) => a.result === 'delivered');
      let outcome: DeliveryOutcome = 'open';
      if (d.state === 'delivered' && done) {
        const end = d.interval.split('–')[1] ?? '23:59';
        const onTime = !failed.length && done.at.slice(0, 10) <= d.date && done.at.slice(11, 16) <= end;
        outcome = onTime ? 'on_time' : 'late';
      } else if (d.state === 'failed' || d.state === 'returned') outcome = 'failed';
      else if (deliveryLateNow(d, now)) outcome = 'late_now';
      out.push({
        d,
        outcome,
        failedAttempts: failed.length,
        repeat: d.attempts.length > 1,
        lastReason: failed.length ? failed[failed.length - 1].reason : null,
        underpaid: d.state === 'delivered' && d.collect > 0 && d.collected < d.collect,
        spent: d.attempts.length > 0 || d.state === 'on_way',
      });
    }
    return out;
  });
}

/** Доля «вовремя»: врученные вовремя ÷ (врученные + опаздывающие сейчас). Неудачные считаются отдельно. */
export function onTimeShare(onTime: number, late: number, lateNow: number): number | null {
  const base = onTime + late + lateNow;
  return base > 0 ? onTime / base : null;
}

export interface CourierRow {
  e: Employee;
  total: number;
  delivered: number;
  onTime: number;
  late: number;
  lateNow: number;
  failedAttempts: number;
  repeat: number;
  cost: number;
  collected: number;
  onHand: number;
}

/** Курьеры. Расходы — по тем же правилам, что итог «Расходы на доставку»: доставки, на которые курьер уже выезжал. */
export function courierRows(db: DB, facts: DeliveryFact[]): CourierRow[] {
  const m = new Map<ID, CourierRow>();
  for (const e of db.employees) {
    if (!e.roles.includes('courier')) continue;
    m.set(e.id, { e, total: 0, delivered: 0, onTime: 0, late: 0, lateNow: 0, failedAttempts: 0, repeat: 0, cost: 0, collected: 0, onHand: courierCash(db, e.id).onHand });
  }
  for (const f of facts) {
    const r = f.d.courierId ? m.get(f.d.courierId) : undefined;
    if (!r) continue;
    r.total++;
    if (f.outcome === 'on_time' || f.outcome === 'late') r.delivered++;
    if (f.outcome === 'on_time') r.onTime++;
    if (f.outcome === 'late') r.late++;
    if (f.outcome === 'late_now') r.lateNow++;
    r.failedAttempts += f.failedAttempts;
    if (f.repeat) r.repeat++;
    if (f.spent) r.cost += f.d.cost;
    r.collected += f.d.collected;
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

export function totalsFor(db: DB, from: ISODate, to: ISODate): Agg {
  return memoDB(db, `rp-total|${from}|${to}`, () => totalFacts(saleFacts(db, from, to)));
}

export { addFact, emptyAgg };
