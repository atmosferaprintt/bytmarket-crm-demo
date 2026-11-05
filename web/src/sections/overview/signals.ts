/* «Требует внимания»: объяснимые сигналы по §13. Каждый — что случилось, подтверждающие цифры,
   ответственный сотрудник и одно действие. Чистый расчёт без React:
   computeSignals(db) — все сигналы; signalsForRole — что видит роль; arrangeSignals — главное на виду, однотипное мелкое — группами. */
import type { DB, ID, ISODate, RoleKey, TaskLink } from '../../data/types';
import type { EntityType } from '../../shell/entities';
import { clientBalances, courierCash, indexes, shiftSummary, stockIndex } from '../../data/selectors';
import { diffDays, plusDays } from '../../data/dates';
import { URGENT_OVERDUE_DAYS } from '../../data/thresholds';
import {
  DEAD_DAYS,
  delayedOrders,
  demandIndex,
  fmtDay,
  isDead,
  isShortage,
  lastSaleIndex,
  memoDB,
  nowAt,
  outDays,
  saleFacts,
  supplierWeek,
  topCategoryId,
  emptyAgg,
  addFact,
  marginOf,
  type Agg,
} from './analytics';

export type SignalKind = 'stock_low' | 'dead_stock' | 'overdue' | 'missed_order' | 'margin_drop' | 'order_delay' | 'reconcile' | 'payment' | 'supplier';

export const SIGNAL_KINDS: { key: SignalKind; label: string }[] = [
  { key: 'overdue', label: 'Просрочка оплаты' },
  { key: 'payment', label: 'Платежи' },
  { key: 'supplier', label: 'Поставщикам' },
  { key: 'reconcile', label: 'Сверка' },
  { key: 'order_delay', label: 'Задержка заказа' },
  { key: 'stock_low', label: 'Заканчивается' },
  { key: 'missed_order', label: 'Пропустил заказ' },
  { key: 'margin_drop', label: 'Маржа' },
  { key: 'dead_stock', label: 'Без движения' },
];

export type SignalAction =
  | { type: 'open'; entity: EntityType; id: ID; label: string }
  | { type: 'go'; to: string; label: string; fallback: SignalAction }
  | { type: 'task'; link: TaskLink | null; title: string; assigneeId: ID | null; label: string };

export interface SignalFact {
  label: string;
  value: string;
  tone?: 'bad' | 'warn' | 'ok';
}

export interface Signal {
  id: string; // устойчивый: вид + запись
  kind: SignalKind;
  severity: 'high' | 'medium' | 'low';
  title: string;
  reason: string; // пусто, если заголовок и цифры уже всё говорят
  facts: SignalFact[];
  amount: number; // сколько денег за этим стоит, ₽ — для порядка
  responsibleId: ID | null;
  action: SignalAction;
  subject: { type: EntityType; id: ID } | null; // запись, к которой относится сигнал
  date: ISODate; // когда возник
  money: boolean; // денежный сигнал: его видит бухгалтер
  tag?: 'pending' | 'unidentified'; // для платежей: ждёт подтверждения или не опознан
  count?: number; // сколько случаев за сигналом (сводный «ещё N товаров»), по умолчанию 1
  members?: Signal[]; // для группы однотипных: что внутри
}

const SEV: Record<Signal['severity'], number> = { high: 0, medium: 1, low: 2 };
/** Сигналы на сумму меньше этой — мелкие. */
export const SMALL_AMOUNT = 3000;

/* ---------- форматы (как в ui/format, но без React) ---------- */
const NB = ' ';
const THIN = ' ';
const grp = (v: number) => (v < 0 ? '−' : '') + String(Math.abs(Math.round(v))).replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
const rub = (v: number) => grp(v) + NB + '₽';
const pcs = (v: number) => grp(v) + NB + 'шт';
const plural = (n: number, one: string, few: string, many: string) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
};
const cnt = (n: number, one: string, few: string, many: string) => `${grp(n)}${NB}${plural(n, one, few, many)}`;
const days = (n: number) => `${n}${NB}${plural(n, 'день', 'дня', 'дней')}`;
const pct1 = (v: number) => String(Math.round(v * 10) / 10).replace('.', ',') + NB + '%';
const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + pct1(Math.abs(v));
const pp = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + String(Math.round(Math.abs(v) * 10) / 10).replace('.', ',') + NB + 'п.' + NB + 'п.';
const perDay = (v: number) => (v >= 10 ? grp(v) : String(Math.round(v * 10) / 10).replace('.', ','));
const when = (iso: string, today: ISODate) => {
  const a = diffDays(iso.slice(0, 10), today);
  return a === 0 ? 'сегодня' : a === 1 ? 'вчера' : fmtDay(iso);
};

function shortName(name: string): string {
  return name.length > 54 ? name.slice(0, 52).trimEnd() + '…' : name;
}

/* ---------- кто отвечает ---------- */
function people(db: DB) {
  return memoDB(db, 'sig-people', () => {
    const by = (r: string) => db.employees.find((e) => e.active && e.roles.includes(r as never))?.id ?? db.employees.find((e) => e.roles.includes(r as never))?.id ?? null;
    const authored = new Map<ID, number>();
    const wh = new Set(db.employees.filter((e) => e.roles.includes('warehouse')).map((e) => e.id));
    for (const pu of db.purchases) if (wh.has(pu.authorId)) authored.set(pu.authorId, (authored.get(pu.authorId) ?? 0) + 1);
    let buyer = by('warehouse');
    let best = -1;
    for (const [id, n] of authored) if (n > best) ((best = n), (buyer = id));
    return { owner: by('owner'), accountant: by('accountant'), dispatcher: by('dispatcher'), buyer };
  });
}

/* ---------- расчёт ---------- */

export function computeSignals(db: DB, today: ISODate = db.meta.today, now: string = nowAt()): Signal[] {
  return memoDB(db, `signals|${today}|${now}`, () => {
    const out: Signal[] = [];
    stockSignals(db, today, out);
    deadStockSignals(db, today, out);
    overdueSignals(db, today, out);
    missedOrderSignals(db, today, out);
    marginSignals(db, today, out);
    delaySignals(db, now, out);
    reconcileSignals(db, today, out);
    paymentSignals(db, today, out);
    supplierSignals(db, today, out);
    out.sort(bySeverity);
    return out;
  });
}

const bySeverity = (a: Signal, b: Signal) => SEV[a.severity] - SEV[b.severity] || b.amount - a.amount;

function stockSignals(db: DB, today: ISODate, out: Signal[]) {
  const ix = indexes(db);
  const { buyer } = people(db);
  const list = [...demandIndex(db).values()].filter((d) => isShortage(d) && ix.products.get(d.productId)?.active).sort((a, b) => b.revenue30 - a.revenue30);
  for (const d of list) {
    const p = ix.products.get(d.productId)!;
    const cover = d.cover === null ? 0 : Math.floor(d.cover);
    const none = d.available <= 0;
    const atRisk = Math.round(d.daily * p.retailPrice * Math.max(1, d.leadDays + 2 - cover));
    const facts: SignalFact[] = [
      { label: 'Продано за 30 дней', value: pcs(d.sold30) },
      { label: 'Доступно', value: pcs(d.available), tone: none ? 'bad' : undefined },
      { label: 'Ожидается', value: pcs(d.expected) },
    ];
    // «хватит на меньше дня» рядом с «доступно 0» — повтор; показываем запас, только если товар есть
    if (!none) facts.push({ label: 'Хватит на', value: cover < 1 ? 'меньше дня' : days(cover), tone: 'warn' });
    out.push({
      id: 'stock_low:' + p.id,
      kind: 'stock_low',
      severity: (none && d.expected <= 0) || cover < 2 ? 'high' : 'medium',
      title: none ? `${shortName(p.name)} закончился` : `${shortName(p.name)} заканчивается`,
      reason: none
        ? `Ходовой товар, продавался по ${perDay(d.daily)} шт в день`
        : `Продаётся по ${perDay(d.daily)} шт в день, поставка идёт ${days(d.leadDays)} — ${cover <= d.leadDays ? 'закончится раньше, чем приедет' : `заказать нужно ${cover - d.leadDays <= 1 ? 'сегодня или завтра' : `в ближайшие ${days(cover - d.leadDays)}`}`}`,
      facts,
      amount: atRisk,
      responsibleId: buyer,
      action: { type: 'go', to: '/purchases/suggest', label: 'Заказать', fallback: { type: 'open', entity: 'product', id: p.id, label: 'Открыть' } },
      subject: { type: 'product', id: p.id },
      date: today,
      money: false,
    });
  }
}

function deadStockSignals(db: DB, today: ISODate, out: Signal[]) {
  const si = stockIndex(db);
  const last = lastSaleIndex(db);
  const border = plusDays(today, -DEAD_DAYS);
  const { owner } = people(db);
  const items: { id: ID; name: string; qty: number; value: number; last: ISODate | undefined }[] = [];
  for (const p of db.products) {
    const s = si.get(p.id);
    if (!s || s.total.onHand <= 0 || p.cost === null) continue;
    if (!isDead(p, last.get(p.id), border)) continue;
    const absent = outDays(db, p.id, border, today);
    if (absent > DEAD_DAYS / 2) continue; // товара почти не было — отсутствие продаж не говорит о спросе
    items.push({ id: p.id, name: p.name, qty: s.total.onHand, value: s.total.onHand * p.cost, last: last.get(p.id) });
  }
  items.sort((a, b) => b.value - a.value);
  const big = items.filter((x) => x.value >= 5000).slice(0, 6);
  for (const x of big) {
    const since = x.last ? diffDays(x.last, today) : null;
    out.push({
      id: 'dead_stock:' + x.id,
      kind: 'dead_stock',
      severity: x.value >= 20000 ? 'medium' : 'low',
      title: `${shortName(x.name)}: без продаж ${since !== null ? days(since) : 'с начала учёта'}`,
      reason: 'Товар всё это время был в наличии — дело не в остатке',
      facts: [
        { label: 'Остаток', value: pcs(x.qty) },
        { label: 'По себестоимости', value: rub(x.value), tone: 'warn' },
        { label: 'Последняя продажа', value: x.last ? fmtDay(x.last) : 'не было' },
      ],
      amount: Math.round(x.value),
      responsibleId: owner,
      action: { type: 'go', to: '/products/pricing', label: 'Акция', fallback: { type: 'open', entity: 'product', id: x.id, label: 'Открыть' } },
      subject: { type: 'product', id: x.id },
      date: today,
      money: false,
    });
  }
  const rest = items.filter((x) => !big.includes(x));
  if (rest.length) {
    const sum = rest.reduce((s, x) => s + x.value, 0);
    out.push({
      id: 'dead_stock:rest',
      kind: 'dead_stock',
      severity: 'low',
      title: `${cnt(rest.length, 'товар', 'товара', 'товаров')} без движения ${DEAD_DAYS} дней`,
      reason: 'Каждый меньше чем на 5 000 ₽. Список — в отчёте по товарам',
      facts: [{ label: 'По себестоимости', value: rub(sum) }],
      amount: Math.round(sum),
      responsibleId: owner,
      action: { type: 'go', to: '/reports?list=dead', label: 'Открыть отчёт', fallback: { type: 'task', link: null, title: 'Разобрать товары без движения', assigneeId: owner, label: 'Задача' } },
      subject: null,
      date: today,
      money: false,
      count: rest.length,
    });
  }
}

function overdueSignals(db: DB, today: ISODate, out: Signal[]) {
  const ix = indexes(db);
  const lastPay = memoDB(db, 'sig-lastpay', () => {
    const m = new Map<ID, string>();
    for (const p of db.payments) if (p.kind === 'client' && p.status === 'posted' && p.clientId) m.set(p.clientId, p.at > (m.get(p.clientId) ?? '') ? p.at : m.get(p.clientId)!);
    return m;
  });
  for (const [cid, b] of clientBalances(db)) {
    if (b.overdue <= 0) continue;
    const c = ix.clients.get(cid);
    if (!c) continue;
    const overLimit = b.creditLimit > 0 && b.debt > b.creditLimit;
    // меньше URGENT_OVERDUE_DAYS дней — ещё не «срочно», а «важно»
    const severity: Signal['severity'] =
      b.overdue < SMALL_AMOUNT ? 'low' : b.maxOverdueDays < URGENT_OVERDUE_DAYS ? 'medium' : b.overdue >= 20000 || b.maxOverdueDays >= 14 || overLimit ? 'high' : 'medium';
    const lp = lastPay.get(cid);
    const facts: SignalFact[] = [
      { label: 'Просрочено', value: rub(b.overdue), tone: 'bad' },
      { label: 'Весь долг', value: rub(b.debt) },
    ];
    if (b.creditLimit > 0) facts.push({ label: 'Лимит', value: rub(b.creditLimit), tone: overLimit ? 'bad' : undefined });
    facts.push({ label: 'Последняя оплата', value: lp ? fmtDay(lp) : 'не было' });
    out.push({
      id: 'overdue:' + cid,
      kind: 'overdue',
      severity,
      title: `${c.name}: просрочка ${days(b.maxOverdueDays)}`,
      reason: overLimit ? `Долг больше кредитного лимита на ${rub(b.debt - b.creditLimit)}` : '',
      facts,
      amount: b.overdue,
      responsibleId: c.ownerId,
      action: { type: 'task', link: { type: 'client', id: cid }, title: `Напомнить об оплате: просрочено ${rub(b.overdue)}`, assigneeId: c.ownerId, label: 'Напомнить' },
      subject: { type: 'client', id: cid },
      date: today,
      money: true,
    });
  }
}

function missedOrderSignals(db: DB, today: ISODate, out: Signal[]) {
  const ix = indexes(db);
  const open = new Set<ID>();
  for (const o of db.orders) if (o.state === 'request' || o.state === 'confirmed' || o.state === 'draft') open.add(o.clientId);
  const bal = clientBalances(db);
  for (const c of db.clients) {
    if (!c.active || !c.orderEveryDays || c.segment === 'retail' || open.has(c.id)) continue;
    const b = bal.get(c.id);
    if (!b?.lastOrderAt) continue;
    const since = diffDays(b.lastOrderAt.slice(0, 10), today);
    const grace = Math.max(3, Math.ceil(c.orderEveryDays * 0.5));
    if (since < c.orderEveryDays + grace) continue;
    const owner = c.ownerId ? ix.employees.get(c.ownerId) : undefined;
    const isRep = !!owner?.roles.includes('rep');
    out.push({
      id: 'missed_order:' + c.id,
      kind: 'missed_order',
      severity: b.avgOrder >= SMALL_AMOUNT && since >= c.orderEveryDays * 2 ? 'medium' : 'low',
      title: `${c.name}: пропущен привычный заказ`,
      reason: `Заказывает раз в ${days(c.orderEveryDays)}, а с последнего заказа прошло ${days(since)}`,
      facts: [
        { label: 'Последний заказ', value: fmtDay(b.lastOrderAt), tone: 'warn' },
        { label: 'Средний заказ', value: rub(b.avgOrder) },
      ],
      amount: b.avgOrder,
      responsibleId: c.ownerId,
      action: {
        type: 'task',
        link: { type: 'client', id: c.id },
        title: isRep ? 'Визит: давно не заказывал, узнать причину' : 'Позвонить: давно не заказывал, предложить заказ',
        assigneeId: c.ownerId,
        label: isRep ? 'Визит' : 'Позвонить',
      },
      subject: { type: 'client', id: c.id },
      date: today,
      money: false,
    });
  }
}

function marginSignals(db: DB, today: ISODate, out: Signal[]) {
  const ix = indexes(db);
  const { owner } = people(db);
  const curFrom = plusDays(today, -29);
  const prevFrom = plusDays(today, -59);
  const prevTo = plusDays(today, -30);
  if (prevFrom < db.meta.startDate) return;
  const by = (facts: ReturnType<typeof saleFacts>) => {
    const m = new Map<ID, Agg & { promo: number; promoName: Map<ID, number> }>();
    for (const f of facts) {
      const p = ix.products.get(f.productId);
      if (!p) continue;
      const k = topCategoryId(db, p.categoryId);
      let a = m.get(k);
      if (!a) {
        a = { ...emptyAgg(), promo: 0, promoName: new Map() };
        m.set(k, a);
      }
      addFact(a, f);
      if (f.promoId) {
        a.promo += f.revenue;
        a.promoName.set(f.promoId, (a.promoName.get(f.promoId) ?? 0) + f.revenue);
      }
    }
    return m;
  };
  const cur = by(saleFacts(db, curFrom, today));
  const prev = by(saleFacts(db, prevFrom, prevTo));
  const promos = new Map(db.promos.map((p) => [p.id, p]));
  for (const [catId, a] of cur) {
    const b = prev.get(catId);
    if (!b || b.revenue < 20000) continue;
    const growth = ((a.revenue - b.revenue) / b.revenue) * 100;
    const ma = marginOf(a);
    const mb = marginOf(b);
    if (ma === null || mb === null) continue;
    const drop = ma - mb;
    if (growth < 5 || drop > -1.5) continue;
    const cat = ix.categories.get(catId);
    const promoShareCur = a.revenue > 0 ? a.promo / a.revenue : 0;
    const promoSharePrev = b.revenue > 0 ? b.promo / b.revenue : 0;
    const manualCur = a.revenue > 0 ? a.manualDiscount / a.revenue : 0;
    const manualPrev = b.revenue > 0 ? b.manualDiscount / b.revenue : 0;
    let reason: string;
    if (promoShareCur - promoSharePrev > 0.08) {
      const topPromo = [...a.promoName.entries()].sort((x, y) => y[1] - x[1])[0];
      const name = topPromo ? promos.get(topPromo[0])?.name : null;
      reason = `Продажи выросли за счёт акции${name ? ` «${name}»` : ''}: со скидкой продано ${Math.round(promoShareCur * 100)} % выручки, месяцем раньше — ${Math.round(promoSharePrev * 100)} %`;
    } else if (manualCur - manualPrev > 0.01) reason = 'Чаще дают ручную скидку: прибыль растёт медленнее выручки';
    else reason = 'Больше продают товаров с низкой наценкой: прибыль растёт медленнее выручки';
    const profitDelta = a.profit - b.profit;
    out.push({
      id: 'margin_drop:' + catId,
      kind: 'margin_drop',
      severity: profitDelta < 0 ? 'high' : 'medium',
      title: `${cat?.name ?? 'Категория'}: продажи ${signed(growth)}, маржа ${pp(drop)}`,
      reason,
      facts: [
        { label: 'Выручка за 30 дней', value: rub(a.revenue) },
        { label: 'Маржа', value: `${pct1(ma)}, было ${pct1(mb)}`, tone: 'bad' },
        { label: 'Прибыль', value: (profitDelta >= 0 ? '+' : '') + rub(profitDelta), tone: profitDelta < 0 ? 'bad' : undefined },
      ],
      amount: Math.round(Math.abs((drop / 100) * a.revenue)),
      responsibleId: owner,
      action: { type: 'go', to: `/reports?cat=${catId}`, label: 'Разобрать', fallback: { type: 'task', link: null, title: `Разобрать маржу: ${cat?.name ?? ''}`, assigneeId: owner, label: 'Задача' } },
      subject: null,
      date: today,
      money: false,
    });
  }
}

const N = (n: number) => `№${NB}${n}`;
const DELAY_TITLE: Record<string, (n: number, days: number) => string> = {
  picking: (n) => `Заказ ${N(n)} задержан на сборке`,
  partial: (n) => `Заказ ${N(n)} отгружен частично`,
  not_shipped: (n) => `Заказ ${N(n)} собран, но не отгружен`,
  waiting_courier: (n) => `Заказ ${N(n)} ждёт курьера`,
  late: (n, d) => `Доставка заказа ${N(n)} опаздывает${d > 0 ? ` на ${days(d)}` : ''}`,
  failed: (n) => `Заказ ${N(n)} не доставлен`,
  rescheduled: (n) => `Доставка заказа ${N(n)} перенесена`,
};

function delaySignals(db: DB, now: string, out: Signal[]) {
  const ix = indexes(db);
  for (const d of delayedOrders(db, now)) {
    const o = d.order;
    const c = ix.clients.get(o.clientId);
    const severity: Signal['severity'] =
      d.kind === 'rescheduled'
        ? 'low'
        : d.kind === 'failed' || (d.kind === 'late' && (d.minutes ?? 0) >= 60) || (d.kind === 'not_shipped' && d.days >= 2) || (d.kind === 'partial' && d.days >= 2) || (d.kind === 'picking' && d.days >= 3)
          ? 'high'
          : 'medium';
    const viaDelivery = d.deliveryId && (d.kind === 'failed' || d.kind === 'late' || d.kind === 'waiting_courier' || d.kind === 'rescheduled');
    const facts: SignalFact[] = [
      { label: 'Клиент', value: c?.name ?? '—' },
      { label: 'Сумма', value: rub(o.total) },
    ];
    if (d.days > 0 && d.kind !== 'late') facts.push({ label: 'Ждёт', value: days(d.days), tone: 'warn' });
    out.push({
      id: 'order_delay:' + o.id,
      kind: 'order_delay',
      severity,
      title: DELAY_TITLE[d.kind](o.number, d.days),
      reason: d.reason,
      facts,
      amount: o.total,
      responsibleId: d.responsibleId,
      action: viaDelivery ? { type: 'open', entity: 'delivery', id: d.deliveryId!, label: 'Открыть' } : { type: 'open', entity: 'order', id: o.id, label: 'Открыть' },
      subject: { type: 'order', id: o.id },
      date: db.meta.today,
      money: false,
    });
  }
}

function reconcileSignals(db: DB, today: ISODate, out: Signal[]) {
  const ix = indexes(db);
  const { dispatcher } = people(db);
  const border = plusDays(today, -14);
  // касса: недостача или излишек при закрытии смены
  for (const s of db.shifts) {
    if (!s.closedAt || s.closedAt.slice(0, 10) < border) continue;
    const sum = shiftSummary(db, s.id);
    if (sum.difference === null || Math.abs(sum.difference) < 50) continue;
    const short = sum.difference < 0;
    const diff = Math.abs(sum.difference);
    const date = s.openedAt.slice(0, 10);
    out.push({
      id: 'reconcile:shift:' + s.id,
      kind: 'reconcile',
      severity: diff >= 1000 ? 'high' : diff >= 200 ? 'medium' : 'low',
      title: `Касса ${fmtDay(date)}: ${short ? 'не хватает' : 'лишние'} ${rub(diff)}`,
      reason: '',
      facts: [
        { label: 'Смена', value: N(s.number) },
        { label: 'По чекам', value: rub(sum.expectedCash) },
        { label: 'Пересчитали', value: rub(sum.countedCash ?? 0), tone: short ? 'bad' : 'warn' },
      ],
      amount: diff,
      responsibleId: s.sellerId,
      action: {
        type: 'go',
        to: '/register/shift',
        label: 'Сверить',
        fallback: { type: 'task', link: null, title: `Разобрать расхождение смены №${NB}${s.number} за ${fmtDay(date)}`, assigneeId: s.sellerId, label: 'Задача' },
      },
      subject: null,
      date,
      money: true,
    });
  }
  // курьер не сдал деньги
  for (const e of db.employees) {
    if (!e.roles.includes('courier')) continue;
    const cc = courierCash(db, e.id);
    if (cc.onHand <= 0) continue;
    const list = db.deliveries.filter((d) => d.courierId === e.id && d.collectedMethod === 'cash' && d.collected > 0 && !d.handedIn);
    const oldest = list.reduce((m, d) => (d.date < m ? d.date : m), today);
    if (oldest >= today) continue; // сегодняшние деньги сдаются вечером
    out.push({
      id: 'reconcile:courier:' + e.id,
      kind: 'reconcile',
      severity: cc.onHand >= 10000 || diffDays(oldest, today) >= 2 ? 'high' : 'medium',
      title: `${e.name} не сдал ${rub(cc.onHand)}`,
      reason: '',
      facts: [
        { label: 'Доставок', value: grp(list.length) },
        { label: 'Деньги на руках с', value: fmtDay(oldest), tone: 'warn' },
      ],
      amount: cc.onHand,
      responsibleId: e.id,
      action: {
        type: 'go',
        to: '/delivery/cash',
        label: 'Сверить',
        fallback: { type: 'task', link: null, title: `Принять деньги у курьера: ${e.name}, ${rub(cc.onHand)}`, assigneeId: dispatcher, label: 'Задача' },
      },
      subject: null,
      date: oldest,
      money: true,
    });
  }
  // приёмка с расхождением — товарный сигнал, бухгалтеру не показываем
  for (const pu of db.purchases) {
    if (!pu.receivedAt || pu.receivedAt.slice(0, 10) < border) continue;
    let ordered = 0;
    let received = 0;
    let defect = 0;
    let value = 0;
    let reason: string | null = null;
    for (const l of pu.lines) {
      if (l.received === null) continue;
      ordered += l.qty;
      received += l.received;
      defect += l.defect;
      const diff = Math.abs(l.qty - l.received) + l.defect;
      value += diff * l.price;
      if ((l.received !== l.qty || l.defect > 0) && !reason) reason = l.diffReason;
    }
    if (received === ordered && defect === 0) continue;
    const sup = ix.suppliers.get(pu.supplierId);
    out.push({
      id: 'reconcile:purchase:' + pu.id,
      kind: 'reconcile',
      severity: value < SMALL_AMOUNT ? 'low' : 'medium',
      title: `Приёмка ${N(pu.number)}: расхождение с заказом`,
      reason: `${sup?.name ?? 'Поставщик'}: ${received < ordered ? `не довезли ${pcs(ordered - received)}` : received > ordered ? `привезли лишние ${pcs(received - ordered)}` : 'количество сошлось'}${defect ? `, брак ${pcs(defect)}` : ''}${reason ? `. Причина: ${reason.toLowerCase()}` : ''}`,
      facts: [
        { label: 'Заказано', value: pcs(ordered) },
        { label: 'Принято', value: pcs(received) },
        ...(defect ? [{ label: 'Брак', value: pcs(defect), tone: 'bad' as const }] : []),
        { label: 'На сумму', value: rub(value) },
      ],
      amount: Math.round(value),
      responsibleId: pu.authorId,
      action: { type: 'open', entity: 'purchase', id: pu.id, label: 'Открыть' },
      subject: { type: 'purchase', id: pu.id },
      date: pu.receivedAt.slice(0, 10),
      money: false,
    });
  }
}

function paymentSignals(db: DB, today: ISODate, out: Signal[]) {
  const ix = indexes(db);
  const { accountant } = people(db);
  for (const p of db.payments) {
    if (p.status === 'posted') continue;
    const date = p.at.slice(0, 10);
    const age = diffDays(date, today);
    const c = p.clientId ? ix.clients.get(p.clientId) : undefined;
    if (p.status === 'pending') {
      out.push({
        id: 'payment:' + p.id,
        kind: 'payment',
        severity: age >= 2 ? 'high' : p.amount < SMALL_AMOUNT ? 'low' : 'medium',
        tag: 'pending',
        title: `Перевод ${rub(p.amount)} ждёт подтверждения`,
        reason: 'Пока банк не подтвердит, долг клиента не уменьшается',
        facts: [
          { label: 'Клиент', value: c?.name ?? '—' },
          { label: 'Прислали', value: when(date, today) },
        ],
        amount: p.amount,
        responsibleId: accountant,
        action: { type: 'go', to: '/money', label: 'Проверить', fallback: { type: 'task', link: { type: 'payment', id: p.id }, title: 'Проверить перевод по выписке', assigneeId: accountant, label: 'Задача' } },
        subject: c ? { type: 'client', id: c.id } : null,
        date,
        money: true,
      });
    } else {
      out.push({
        id: 'payment:' + p.id,
        kind: 'payment',
        severity: p.amount >= 10000 || age >= 3 ? 'high' : 'medium',
        tag: 'unidentified',
        title: `Поступление ${rub(p.amount)} не опознано`,
        reason: `Плательщик не ясен — долг никому не уменьшен${p.comment ? `. Назначение: «${p.comment}»` : ''}`,
        facts: [{ label: 'Пришло на счёт', value: when(date, today) }],
        amount: p.amount,
        responsibleId: accountant,
        action: { type: 'go', to: '/money', label: 'Разнести', fallback: { type: 'task', link: { type: 'payment', id: p.id }, title: 'Определить плательщика', assigneeId: accountant, label: 'Задача' } },
        subject: null,
        date,
        money: true,
      });
    }
  }
}

/** Долги поставщикам: просроченные — по поставщику, к оплате до воскресенья — одной строкой. Как в «Деньги → Долги поставщикам». */
function supplierSignals(db: DB, today: ISODate, out: Signal[]) {
  const ix = indexes(db);
  const { accountant } = people(db);
  const w = supplierWeek(db);
  const go = (label: string, title: string): SignalAction => ({ type: 'go', to: '/money/suppliers', label, fallback: { type: 'task', link: null, title, assigneeId: accountant, label: 'Задача' } });
  const bySup = new Map<ID, { sum: number; n: number; oldest: ISODate }>();
  for (const u of w.overdue) {
    const x = bySup.get(u.supplierId) ?? { sum: 0, n: 0, oldest: u.dueDate };
    x.sum += u.amount;
    x.n++;
    if (u.dueDate < x.oldest) x.oldest = u.dueDate;
    bySup.set(u.supplierId, x);
  }
  for (const [sid, x] of bySup) {
    const s = ix.suppliers.get(sid);
    const late = diffDays(x.oldest, today);
    out.push({
      id: 'supplier:overdue:' + sid,
      kind: 'supplier',
      severity: late >= URGENT_OVERDUE_DAYS && x.sum >= SMALL_AMOUNT ? 'high' : x.sum >= SMALL_AMOUNT ? 'medium' : 'low',
      title: `${s?.name ?? 'Поставщик'}: просрочен платёж ${rub(x.sum)}`,
      reason: '',
      facts: [
        { label: 'Поставок', value: grp(x.n) },
        { label: 'Срок был', value: fmtDay(x.oldest), tone: 'bad' },
        { label: 'Просрочка', value: days(late), tone: 'bad' },
      ],
      amount: x.sum,
      responsibleId: accountant,
      action: go('Оплатить', `Оплатить поставщику: ${s?.name ?? ''}, ${rub(x.sum)}`),
      subject: { type: 'supplier', id: sid },
      date: x.oldest,
      money: true,
    });
  }
  if (w.thisWeekSum > 0) {
    const first = w.thisWeek[0];
    out.push({
      id: 'supplier:week:' + w.weekEnd,
      kind: 'supplier',
      severity: 'medium',
      title: `Поставщикам к оплате до воскресенья ${rub(w.thisWeekSum)}`,
      reason: '',
      facts: [
        { label: 'Поставок', value: grp(w.thisWeek.length) },
        { label: 'Ближайший платёж', value: `${fmtDay(first.dueDate)}, ${rub(first.amount)}` },
      ],
      amount: w.thisWeekSum,
      responsibleId: accountant,
      action: go('График', 'Подготовить платежи поставщикам на неделю'),
      subject: null,
      date: today,
      money: true,
    });
  }
}

/* ---------- кому что показывать ---------- */

/** Бухгалтеру — только деньги: оплаты и просрочки, переводы и неопознанные поступления, кассы и деньги курьеров, долги поставщикам. */
export function signalsForRole(list: Signal[], role: RoleKey): Signal[] {
  if (role === 'accountant') return list.filter((s) => s.money);
  return list;
}

export function kindsForRole(role: RoleKey): typeof SIGNAL_KINDS {
  if (role === 'accountant') return SIGNAL_KINDS.filter((k) => k.key === 'overdue' || k.key === 'payment' || k.key === 'supplier' || k.key === 'reconcile');
  return SIGNAL_KINDS;
}

/* ---------- главное на виду, однотипное — группой ---------- */

/** Сколько по-настоящему важных сигналов держим на виду. */
export const IMPORTANT_MAX = 14;
/** Сколько сигналов одного вида на виду; остальные этого вида — одной строкой-группой. */
const KIND_CAP: Record<SignalKind, number> = { overdue: 5, payment: 3, supplier: 2, reconcile: 2, order_delay: 3, stock_low: 2, missed_order: 1, margin_drop: 1, dead_stock: 1 };

const sizeOf = (s: Signal) => s.count ?? 1;

const GROUP_NOUN: Record<SignalKind, (n: number, more: boolean) => string> = {
  overdue: (n, m) => `${m ? 'Ещё ' : ''}${cnt(n, 'клиент', 'клиента', 'клиентов')} с просрочкой оплаты`,
  payment: (n, m) => `${m ? 'Ещё ' : ''}${cnt(n, 'платёж ждёт', 'платежа ждут', 'платежей ждут')} разбора`,
  supplier: (n, m) => `${m ? 'Ещё ' : ''}${cnt(n, 'платёж', 'платежа', 'платежей')} поставщикам`,
  reconcile: (n, m) => `${m ? 'Ещё ' : ''}${cnt(n, 'расхождение', 'расхождения', 'расхождений')} при сверке`,
  order_delay: (n, m) => `${m ? 'Ещё ' : ''}${cnt(n, 'заказ', 'заказа', 'заказов')} с задержкой`,
  stock_low: (n, m) => `${m ? 'Ещё ' : ''}${cnt(n, 'ходовой товар заканчивается', 'ходовых товара заканчиваются', 'ходовых товаров заканчиваются')}`,
  missed_order: (n, m) => `${m ? 'Ещё ' : ''}${cnt(n, 'клиент пропустил', 'клиента пропустили', 'клиентов пропустили')} привычный заказ`,
  margin_drop: (n, m) => `${m ? 'Ещё ' : ''}${cnt(n, 'категория', 'категории', 'категорий')} с падением маржи`,
  dead_stock: (n, m) => `${m ? 'Ещё ' : ''}${cnt(n, 'товар', 'товара', 'товаров')} без движения ${DEAD_DAYS} дней`,
};

/** Что показать одной цифрой у группы: деньги, если они есть, иначе количество. */
function groupFact(kind: SignalKind, members: Signal[]): SignalFact {
  const sum = members.reduce((z, s) => z + s.amount, 0);
  if (kind === 'stock_low' || kind === 'missed_order' || kind === 'margin_drop') {
    const n = members.reduce((z, s) => z + sizeOf(s), 0);
    return { label: 'Сколько', value: kind === 'margin_drop' ? cnt(n, 'категория', 'категории', 'категорий') : kind === 'stock_low' ? cnt(n, 'товар', 'товара', 'товаров') : cnt(n, 'клиент', 'клиента', 'клиентов') };
  }
  return { label: kind === 'overdue' ? 'Просрочено' : kind === 'dead_stock' ? 'По себестоимости' : 'Сумма', value: rub(sum), tone: kind === 'overdue' ? 'bad' : undefined };
}

export interface Arranged {
  important: Signal[]; // «Срочно» и «Важно», не больше IMPORTANT_MAX
  rest: Signal[]; // «Остальное»: группы однотипных и одиночные мелкие
}

/** Главное на виду: по важности и сумме, не больше KIND_CAP одного вида и IMPORTANT_MAX всего.
    Остальное однотипное сворачивается в одну строку-группу на вид. */
export function arrangeSignals(list: Signal[]): Arranged {
  const sorted = [...list].sort(bySeverity);
  const important: Signal[] = [];
  const per = new Map<SignalKind, number>();
  const restBy = new Map<SignalKind, Signal[]>();
  for (const s of sorted) {
    const n = per.get(s.kind) ?? 0;
    if (s.severity !== 'low' && !s.count && important.length < IMPORTANT_MAX && n < KIND_CAP[s.kind]) {
      important.push(s);
      per.set(s.kind, n + 1);
    } else {
      const a = restBy.get(s.kind) ?? [];
      a.push(s);
      restBy.set(s.kind, a);
    }
  }
  const rest: Signal[] = [];
  for (const k of SIGNAL_KINDS) {
    const members = restBy.get(k.key);
    if (!members?.length) continue;
    if (members.length === 1) {
      rest.push({ ...members[0], severity: 'low' });
      continue;
    }
    const n = members.reduce((z, s) => z + sizeOf(s), 0);
    const sum = members.reduce((z, s) => z + s.amount, 0);
    const resp = new Set(members.map((s) => s.responsibleId));
    rest.push({
      id: 'group:' + k.key,
      kind: k.key,
      severity: 'low',
      title: GROUP_NOUN[k.key](n, (per.get(k.key) ?? 0) > 0),
      reason: '',
      facts: [groupFact(k.key, members)],
      amount: sum,
      responsibleId: resp.size === 1 ? [...resp][0] : null,
      action: { type: 'go', to: `/overview/attention?kind=${k.key}`, label: 'Показать', fallback: { type: 'task', link: null, title: `Разобрать: ${k.label.toLowerCase()}`, assigneeId: null, label: 'Задача' } },
      subject: null,
      date: members[0].date,
      money: members.every((s) => s.money),
      count: n,
      members,
    });
  }
  rest.sort((a, b) => b.amount - a.amount);
  return { important, rest };
}

/* ---------- «Разобрано»: хранится у пользователя, чтобы не шуметь ---------- */

const KEY = 'bm-attention-done-v1';

export function loadResolved(): Record<string, string> {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function saveResolved(v: Record<string, string>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    /* хранилище недоступно — отметка живёт до перезагрузки */
  }
}
