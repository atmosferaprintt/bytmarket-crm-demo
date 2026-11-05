/* Симуляция магазина по дням: с 5 августа до сегодняшнего дня 14:00.
   Все изменения идут через операции (applyOp) — так же, как из интерфейса. Поэтому остатки,
   резерв, долги и деньги согласованы между собой по построению. */
import type { DB, Delivery, ID, ISODate, ISODateTime, Order, PackKey, PayMethod, Product, WriteoffReason } from '../types';
import { DELIVERY_FAIL_REASONS, REFUSAL_REASONS, RETURN_REASONS } from '../types';
import { Rng, WeightedTable } from '../rng';
import { OpError, applyOp, purchaseSuggestion, quarantineCanRelease, repeatPreview } from '../ops';
import type { OpResult, OpType } from '../ops';
import { get, stockRow } from '../idx';
import { accountBalances, clientBalance, orderPayment, orderReturns, priceFor, purchaseAccepted, purchasePaid } from '../selectors';
import { atTime, dayNum, dow, isoDay, minutesOf, plusDays } from '../dates';
import { MISSED_ORDER_FACTOR } from '../thresholds';
import { roundRetail } from './catalog';
import type { ProdMeta } from './catalog';
import type { AssortItem, ClientMeta } from './clients';
import { COURIERS, E, MANAGERS, REPS, SELLERS, KHALILOV_START, WAREHOUSE } from './org';

/* ---------- очередь событий ---------- */

interface Ev {
  at: string;
  seq: number;
  fn: () => void;
}

class Queue {
  private h: Ev[] = [];
  private seq = 0;
  private less(a: Ev, b: Ev): boolean {
    return a.at < b.at || (a.at === b.at && a.seq < b.seq);
  }
  push(at: string, fn: () => void): void {
    const e = { at, seq: this.seq++, fn };
    const h = this.h;
    h.push(e);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i], h[p])) break;
      [h[i], h[p]] = [h[p], h[i]];
      i = p;
    }
  }
  peek(): Ev | undefined {
    return this.h[0];
  }
  pop(): Ev | undefined {
    const h = this.h;
    if (!h.length) return undefined;
    const top = h[0];
    const last = h.pop()!;
    if (h.length) {
      h[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < h.length && this.less(h[l], h[m])) m = l;
        if (r < h.length && this.less(h[r], h[m])) m = r;
        if (m === i) break;
        [h[i], h[m]] = [h[m], h[i]];
        i = m;
      }
    }
    return top;
  }
}

/* ---------- входные данные ---------- */

export interface SimInput {
  db: DB;
  rng: Rng;
  meta: ProdMeta[];
  clients: ClientMeta[];
  supplierIds: Map<string, ID>;
}

export interface SimStats {
  failed: Record<string, number>;
  errors: string[];
  outOfStockPicks: number;
  stuck: [ID, ID | null][]; // должник → неоплаченный заказ
}

const MONTH_SEASON: Record<string, number> = { '08': 0.95, '09': 1.0, '10': 1.06, '11': 1.1 };

export function simulate(input: SimInput): SimStats {
  const { db, rng, meta, clients } = input;
  const START = db.meta.startDate;
  const TODAY = db.meta.today;
  const CUTOFF = TODAY + 'T14:00';
  const YESTERDAY = plusDays(TODAY, -1);
  const q = new Queue();
  const stats: SimStats = { failed: {}, errors: [], outOfStockPicks: 0, stuck: [] };
  const P = db.products;

  /* ---------- запуск операций ---------- */
  let lastErr = '';
  const run = (type: OpType, payload: unknown, actorId: ID, at: ISODateTime): OpResult | null => {
    try {
      lastErr = '';
      return applyOp(db, type, payload, { actorId, at });
    } catch (e) {
      if (e instanceof OpError) {
        lastErr = e.message;
        stats.failed[type] = (stats.failed[type] ?? 0) + 1;
        if (stats.errors.length < 2000) stats.errors.push(`${at} ${type}: ${e.message}`);
        return null;
      }
      throw e;
    }
  };
  const lastError = (): string => lastErr;
  const at = (d: ISODate, min: number): ISODateTime => atTime(d, Math.max(0, Math.min(23 * 60 + 59, Math.round(min))));
  const sched = (when: ISODateTime, fn: () => void): void => {
    if (when <= CUTOFF) q.push(when, fn);
  };
  const isSun = (d: ISODate): boolean => dow(d) === 0;
  const isSat = (d: ISODate): boolean => dow(d) === 6;
  const workday = (d: ISODate): boolean => !isSun(d);
  const officeDay = (d: ISODate): boolean => dow(d) >= 1 && dow(d) <= 5;
  const nextWorkday = (d: ISODate): ISODate => {
    let x = plusDays(d, 1);
    while (!workday(x)) x = plusDays(x, 1);
    return x;
  };
  const nextOfficeDay = (d: ISODate): ISODate => {
    let x = d;
    while (!officeDay(x)) x = plusDays(x, 1);
    return x;
  };
  const monthKey = (d: ISODate): string => d.slice(5, 7);

  /* ---------- оценки спроса ---------- */
  const RETAIL_PCS_PER_DAY = 100;
  const activeIdx = meta.filter((m) => m.pop > 0 && !m.inactiveFromStart);
  const retailWeight = (m: ProdMeta): number => {
    const p = P[m.index];
    let w = m.pop * (m.sizeIdx === 0 ? 1.3 : m.sizeIdx === 1 ? 0.9 : 0.45);
    if (m.heavy) w *= 0.4;
    if (p.packs.some((x) => x.key === 'box' && x.qty === 6) && (p.weightG ?? 0) > 3000) w *= 0.6;
    return w;
  };
  const rw = activeIdx.map(retailWeight);
  const rwSum = rw.reduce((s, x) => s + x, 0);
  const retailTable = new WeightedTable(
    activeIdx.map((m) => m.index),
    rw,
  );
  const retailRate = new Float64Array(P.length);
  activeIdx.forEach((m, i) => (retailRate[m.index] = (RETAIL_PCS_PER_DAY * rw[i]) / rwSum));
  const wholesaleRate = new Float64Array(P.length);
  for (const c of clients) {
    if (c.seg === 'retail') continue;
    const per = c.seg === 'shop' ? c.cadence * 1.4 : c.cadence;
    for (const a of c.assortment) {
      const p = P[a.pi];
      const qty = (p.packs.find((x) => x.key === a.pack)?.qty ?? 1) * a.packQty;
      wholesaleRate[a.pi] += (c.pickQ * qty * (c.client.points.length > 1 ? 1.5 : 1)) / per;
    }
  }

  // минимальный остаток — примерно неделя продаж
  for (const m of meta) {
    const p = P[m.index];
    const rate = retailRate[m.index] + wholesaleRate[m.index];
    if (m.dead || m.inactiveFromStart) p.minStock = rng.int(2, 4);
    else {
      const raw = Math.max(3, rate * 7);
      p.minStock = raw < 10 ? Math.round(raw) : raw < 50 ? Math.round(raw / 2) * 2 : Math.round(raw / 6) * 6;
    }
  }

  /** Ходовой товар (продаётся хотя бы коробка в месяц) держим на складе с запасом в столько коробок. */
  const WH_BOXES = 3;
  const boxOf = (p: Product): number => p.packs.find((x) => x.key === 'box')?.qty ?? p.packs.find((x) => x.key === 'pack')?.qty ?? 1;
  const avail = (pid: ID, loc: 'shop' | 'warehouse'): number => {
    const r = stockRow(db, pid, loc);
    return r ? r.onHand - r.reserved : 0;
  };

  /* ---------- 5 августа: начальные остатки денег и товара ---------- */
  const d0 = START;
  run('balance.initial', { balances: { bank: 680_000, shop_cash: 16_000 } }, E.suleymanova, at(d0, 7 * 60));
  const whLines: { productId: ID; qty: number; expiry?: ISODate }[] = [];
  const shLines: { productId: ID; qty: number; expiry?: ISODate }[] = [];
  const pushBatches = (arr: typeof whLines, m: ProdMeta, qty: number, loc: 'shop' | 'warehouse'): void => {
    const p = P[m.index];
    if (qty <= 0) return;
    if (!p.expiryTracked) {
      arr.push({ productId: p.id, qty });
      return;
    }
    if (m.nearExpiry) {
      // старая партия, которой хватит до сегодняшнего дня, со сроком в ближайшие 30 дней
      const total = retailRate[m.index] + wholesaleRate[m.index];
      const old = Math.max(4, Math.ceil(total * 100 * (loc === 'shop' ? 0.3 : 1.2)) + rng.int(3, 10));
      arr.push({ productId: p.id, qty: Math.min(qty, old), expiry: plusDays(TODAY, rng.int(4, 27)) });
      if (qty > old) arr.push({ productId: p.id, qty: qty - old, expiry: plusDays(TODAY, rng.int(200, 420)) });
      return;
    }
    const a = Math.ceil(qty * rng.float(0.3, 0.6));
    arr.push({ productId: p.id, qty: a, expiry: plusDays(START, rng.int(160, 330)) });
    if (qty > a) arr.push({ productId: p.id, qty: qty - a, expiry: plusDays(START, rng.int(340, 720)) });
  };
  for (const m of meta) {
    const p = P[m.index];
    const box = boxOf(p);
    let wh = 0;
    let sh = 0;
    if (m.inactiveFromStart) {
      if (rng.chance(0.45)) wh = rng.int(1, 6);
    } else if (m.dead) {
      wh = rng.int(4, 30);
      sh = rng.int(2, 8);
    } else {
      const rate = retailRate[m.index] + wholesaleRate[m.index];
      const days = m.deficit ? rng.float(22, 30) : rng.float(20, 34);
      wh = Math.max(box, Math.ceil((rate * days) / box) * box);
      if (m.nearExpiry) wh += Math.ceil((rate * 60) / box) * box;
      if (!m.deficit && rate * 30 >= box) wh += 2 * box; // ходовой: коробки под оптовые заказы
      sh = Math.max(2, Math.ceil(retailRate[m.index] * rng.float(7, 12)) + 2);
    }
    pushBatches(whLines, m, wh, 'warehouse');
    pushBatches(shLines, m, sh, 'shop');
  }
  run('stock.initial', { location: 'warehouse', lines: whLines, comment: 'Начальные остатки склада на 5 августа' }, E.ibragimov, at(d0, 7 * 60 + 5));
  run('stock.initial', { location: 'shop', lines: shLines, comment: 'Начальные остатки магазина на 5 августа' }, E.ibragimov, at(d0, 7 * 60 + 10));

  /* ---------- состояние симуляции ---------- */
  const cmById = new Map<ID, ClientMeta>();
  for (const c of clients) if (!c.isNew) cmById.set(c.id, c);
  const retailCards = clients.filter((c) => c.seg === 'retail');
  const lastVisit = new Map<ID, number>(); // точка → номер дня
  const lastOrderDay = new Map<ID, number>(); // клиент → номер дня
  const nextMgrOrder = new Map<ID, number>();
  const requestAttempts = new Map<ID, number>();
  const pendingRequests = new Set<ID>();
  const partialPlan: { from: ISODate; rest: 'ship' | 'cancel' | 'wait'; used: boolean }[] = [
    { from: '2026-09-01', rest: 'ship', used: false },
    { from: '2026-09-22', rest: 'cancel', used: false },
    { from: '2026-10-12', rest: 'ship', used: false },
    { from: plusDays(TODAY, -3), rest: 'wait', used: false },
  ];
  let returnToStockLeft = 3;
  let overpayLeft = 3;
  let receiptRefundsLeft = 9;
  let deliverySeq = 0;
  // одиннадцать клиентов с отсрочкой, у которых на сегодня есть просрочка 5–40 дней; остальные успевают заплатить
  const overdueSet = new Set(
    rng
      .shuffle(clients.filter((c) => c.seg !== 'retail' && !c.isNew && c.client.deferDays > 0 && !c.tight))
      .sort((a, b) => (a.discipline === 'good' ? 1 : 0) - (b.discipline === 'good' ? 1 : 0))
      .slice(0, 11)
      .map((c) => c.id),
  );
  // должники платят с опозданием, но регулярно заказывают: «плохая» дисциплина держала бы их в блоке месяцами
  for (const c of clients) if (overdueSet.has(c.id)) c.discipline = 'late';
  // «Пропустил привычный заказ» у менеджеров: у Омарова двое, у Магомедовой один клиент перестали заказывать
  // на 0,2–0,6 привычного срока позже порога MISSED_ORDER_FACTOR. Должники и лимит впритык не берутся — у них своя история.
  // метка генератора подобрана так, чтобы остальные показатели демо (дефицит ходовых, заказы в работе) остались прежними
  const lrng = rng.fork('lapsed-v2');
  const lapsedFrom = new Map<ID, number>(); // клиент → с этого дня заказов нет
  for (const [mgr, n] of [[E.omarov, 2], [E.magomedova, 1]] as const) {
    const pool = clients.filter((c) => c.owner === mgr && c.seg !== 'retail' && !c.isNew && !c.tight && !overdueSet.has(c.id) && c.cadence <= 21);
    const good = pool.filter((c) => c.discipline === 'good');
    for (const c of lrng.sample(good.length >= n ? good : pool, n)) lapsedFrom.set(c.id, dayNum(TODAY) - Math.round(c.cadence * lrng.float(MISSED_ORDER_FACTOR + 0.2, MISSED_ORDER_FACTOR + 0.6)));
  }
  const lapsed = (cid: ID, d: ISODate): boolean => dayNum(d) >= (lapsedFrom.get(cid) ?? Infinity);
  // у должника не оплачен один счёт: первый со сроком в его окне (5–40 дней назад). Старые оплачены,
  // новые заказы идут дальше (владелец разрешает отгрузку) и оплачиваются по сроку — долг не равен просрочке.
  const orng = rng.fork('overdue');
  const stuckFrom = new Map<ID, ISODate>();
  for (const c of clients) if (overdueSet.has(c.id)) stuckFrom.set(c.id, plusDays(TODAY, -5 - Math.min(35, Math.max(c.cadence + 3, orng.int(8, 35)))));
  const stuck = new Map<ID, ID>(); // клиент → неоплаченный заказ
  /** Есть ли у должника неоплаченный счёт (отменённый после неудачной доставки не считается). */
  const hasStuck = (cid: ID): boolean => {
    const id = stuck.get(cid);
    if (!id) return false;
    if (get(db, 'orders', id)?.state !== 'cancelled') return true;
    stuck.delete(cid);
    return false;
  };
  let supplierLateLeft = 1;
  const mgrOf = (d: ISODate, i = 0): ID => (isSat(d) ? E.magomedova : MANAGERS[(dayNum(d) + i) % 2]);
  // два через два: Патимат Алиева — вчера и сегодня, Мадина Курбанова — два дня до этого
  const sellerOn = (d: ISODate): ID => SELLERS[(((dayNum(d) - dayNum(TODAY) + 1) % 4) + 4) % 4 < 2 ? 0 : 1];
  const whOn = (d: ISODate, i = 0): ID => WAREHOUSE[(dayNum(d) + i) % 2];

  const season = (d: ISODate): number => MONTH_SEASON[monthKey(d)] ?? 1;

  /* ---------- оптовые строки из привычного ассортимента ---------- */
  const buildLines = (cm: ClientMeta, d: ISODate, factor = 1): { productId: ID; pack: PackKey; packQty: number }[] => {
    const used = new Map<ID, number>();
    const out: { productId: ID; pack: PackKey; packQty: number }[] = [];
    const take = (a: AssortItem): void => {
      const p = P[a.pi];
      if (!p.active) return;
      const pk = p.packs.find((x) => x.key === a.pack) ?? p.packs[0];
      let pq = Math.max(1, Math.round(a.packQty * rng.float(0.7, 1.45) * season(d) * factor));
      const free = avail(p.id, 'warehouse') - (used.get(p.id) ?? 0);
      if (free < pk.qty * pq) pq = Math.floor(free / pk.qty);
      if (pq <= 0) {
        stats.outOfStockPicks++;
        return;
      }
      used.set(p.id, (used.get(p.id) ?? 0) + pk.qty * pq);
      out.push({ productId: p.id, pack: pk.key, packQty: pq });
    };
    for (const a of cm.assortment) if (rng.chance(cm.pickQ)) take(a);
    // иногда пробуют новый товар — расширение ассортимента
    if (rng.chance(0.3)) {
      const pi = retailTable.sample(rng);
      if (!cm.assortment.some((a) => a.pi === pi)) take({ pi, pack: P[pi].packs.find((x) => x.key === 'pack') ? 'pack' : 'pcs', packQty: P[pi].packs.find((x) => x.key === 'pack') ? 1 : 4 });
    }
    return out;
  };

  /** Подогнать строки заявки под доступное на складе. */
  const fitLines = (o: Order): { productId: ID; pack: PackKey; packQty: number }[] => {
    const used = new Map<ID, number>();
    const out: { productId: ID; pack: PackKey; packQty: number }[] = [];
    for (const l of o.lines) {
      const p = get(db, 'products', l.productId);
      if (!p || !p.active) continue;
      const pk = p.packs.find((x) => x.key === l.pack) ?? p.packs[0];
      const free = avail(p.id, o.location) - (used.get(p.id) ?? 0);
      const pq = Math.min(l.packQty, Math.floor(free / pk.qty));
      if (pq <= 0) continue;
      used.set(p.id, (used.get(p.id) ?? 0) + pq * pk.qty);
      out.push({ productId: p.id, pack: pk.key, packQty: pq });
    }
    return out;
  };

  const deliveryProb = (cm: ClientMeta, d: ISODate): number => {
    if (d >= YESTERDAY) return cm.seg === 'market' ? 0.3 : 0.92;
    const ramp = 0.16 + 0.24 * Math.min(1, Math.max(0, (dayNum(d) - dayNum(START)) / 90));
    if (cm.seg === 'horeca' || cm.seg === 'cleaning') return 0.78;
    if (cm.seg === 'market') return 0.05;
    return Math.min(0.9, ramp * (0.6 + cm.delivery));
  };

  const INTERVALS = ['09:00–12:00', '10:00–13:00', '11:00–14:00', '12:00–15:00', '14:00–17:00', '15:00–18:00'];
  const TODAY_INTERVALS = ['09:00–12:00', '10:00–13:00', '11:00–14:00', '10:00–13:00', '12:00–15:00', '14:00–17:00'];

  /* ---------- после подтверждения: доставка, сборка, отгрузка, оплата ---------- */
  const onConfirmed = (orderId: ID, cm: ClientMeta, when: ISODateTime): void => {
    const o = get(db, 'orders', orderId);
    if (!o || o.state !== 'confirmed') return;
    const d = when.slice(0, 10);
    const mins = minutesOf(when);
    const mgr = MANAGERS.includes(cm.owner as (typeof MANAGERS)[number]) ? cm.owner : mgrOf(d);
    lastOrderDay.set(cm.id, dayNum(d));
    // предоплата переводом от части клиентов без отсрочки
    if (cm.client.deferDays === 0 && cm.payMethod === 'transfer' && rng.chance(0.3)) {
      const t = at(d, mins + 2);
      sched(t, () => {
        const x = get(db, 'orders', orderId);
        if (!x || x.state !== 'confirmed') return;
        const op = orderPayment(db, x);
        if (op.due <= 0) return;
        run('payment.client', { clientId: cm.id, amount: op.due, method: 'transfer', status: d < TODAY && rng.chance(0.25) ? 'pending' : 'posted', comment: `Предоплата по заказу №${x.number}` }, E.suleymanova, t);
      });
    }
    // сборка
    let pickDay = d;
    let pickStart = mins + rng.int(30, 120);
    if (!workday(d) || pickStart > 17 * 60 + 20) {
      pickDay = nextWorkday(d);
      pickStart = 8 * 60 + 10 + rng.int(0, 80);
    }
    if (d < plusDays(TODAY, -3) && rng.chance(0.04)) {
      pickDay = nextWorkday(nextWorkday(pickDay)); // задержка на сборке
    }
    if (d === plusDays(TODAY, -1) && mins > 16 * 60) {
      pickDay = TODAY;
      pickStart = 8 * 60 + 5 + rng.int(0, 25);
    }
    if (d === TODAY) {
      pickStart = mins + rng.int(20, 90);
      // часть сегодняшних заказов ещё не начали собирать — чтобы на складе была очередь «Не собран».
      // Выбор по номеру заказа, а не через rng: остальные данные дня не сдвигаются.
      if (Number(String(orderId).replace(/\D/g, '')) % 3 === 0) pickStart = 15 * 60 + 10;
    }
    const morningRush = d === YESTERDAY && pickDay === TODAY;
    let pickDur = d === TODAY ? rng.int(120, 240) : morningRush ? rng.int(20, 40) : rng.int(35, 110);
    if (d === TODAY) pickDur = Math.max(pickDur, 14 * 60 + 15 - pickStart); // сегодняшние ещё собираются
    let pickedDay = pickDay;
    let pickedAt = pickStart + pickDur;
    if (pickedAt > 18 * 60) {
      pickedDay = nextWorkday(pickDay);
      pickedAt = 8 * 60 + 20 + rng.int(0, 30);
    }
    const tPick = at(pickDay, pickStart);
    const tPicked = at(pickedDay, pickedAt);
    const wh = whOn(pickDay);
    sched(tPick, () => void run('order.pick', { orderId, stage: 'picking' }, wh, tPick));
    sched(tPicked, () => void run('order.pick', { orderId, stage: 'picked' }, wh, tPicked));

    if (d < plusDays(TODAY, -3) && rng.chance(0.007)) {
      const tc = at(d, mins + rng.int(20, 90));
      sched(tc, () => void run('order.cancel', { orderId, reason: rng.pick(['Клиент передумал', 'Клиент закрыл точку на ремонт', 'Заказали у другого поставщика']) }, mgr, tc));
      return;
    }
    if (o.fulfillment === 'delivery') {
      const tCreate = at(d, mins + 4);
      let date = pickedDay > d ? pickedDay : nextWorkday(d);
      if (d === YESTERDAY) date = TODAY;
      if (pickedDay === TODAY && d < TODAY) date = TODAY;
      if (date < pickedDay) date = pickedDay;
      sched(tCreate, () => {
        const iv = rng.pick(INTERVALS);
        run('delivery.create', { orderId, date, interval: date === TODAY ? TODAY_INTERVALS[INTERVALS.indexOf(iv)] : iv }, mgr, tCreate);
      });
    } else {
      // самовывоз: клиент забирает после сборки
      let pDay = pickedDay;
      let pMin = pickedAt + rng.int(40, 300);
      if (pMin > 18 * 60) {
        pDay = nextWorkday(pDay);
        pMin = 9 * 60 + rng.int(0, 420);
      }
      if (rng.chance(0.3)) {
        pDay = nextWorkday(pDay);
        pMin = 9 * 60 + rng.int(0, 480);
      }
      const tShip = at(pDay, pMin);
      sched(tShip, () => pickup(orderId, cm, tShip));
    }
  };

  const pickup = (orderId: ID, cm: ClientMeta, t: ISODateTime): void => {
    const o = get(db, 'orders', orderId);
    if (!o || o.state !== 'confirmed') return;
    if (o.pick !== 'picked') {
      const nt = at(nextWorkday(t.slice(0, 10)), 10 * 60 + rng.int(0, 300));
      sched(nt, () => pickup(orderId, cm, nt));
      return;
    }
    const d = t.slice(0, 10);
    const wh = whOn(d, 1);
    // частичные отгрузки: три в течение периода (остаток довезли или отменили), одна свежая — остаток ждёт
    const slot = partialPlan.findIndex((p) => !p.used && d >= p.from);
    if (o.lines.length >= 4 && slot >= 0) {
      const plan = partialPlan[slot];
      plan.used = true;
      const keep = o.lines.slice(0, o.lines.length - rng.int(1, 2));
      run('order.ship', { orderId, lines: keep.map((l) => ({ productId: l.productId, qty: l.qty - l.shipped })) }, wh, t);
      const rest = at(nextWorkday(plusDays(d, rng.int(1, 2))), 11 * 60 + rng.int(0, 240));
      if (plan.rest === 'cancel') sched(rest, () => void run('order.cancel', { orderId, reason: 'Клиент не стал ждать остаток' }, mgrOf(rest.slice(0, 10)), rest));
      else if (plan.rest === 'ship')
        sched(rest, () => {
          if (run('order.ship', { orderId }, wh, rest)) afterShip(orderId, cm, rest, false); // остаток оплачивают так же
        });
    } else run('order.ship', { orderId }, wh, t);
    afterShip(orderId, cm, t, false);
  };

  /** Оплата после отгрузки: без отсрочки — сразу, с отсрочкой — по дисциплине клиента. */
  const afterShip = (orderId: ID, cm: ClientMeta, t: ISODateTime, byCourier: boolean): void => {
    const o = get(db, 'orders', orderId);
    if (!o || !o.dueDate) return;
    const d = t.slice(0, 10);
    const mins = minutesOf(t);
    if (cm.client.deferDays === 0) {
      if (byCourier) return; // деньги берёт курьер при вручении
      const pay = orderPayment(db, o);
      const amount = Math.max(0, pay.debt - pay.pending);
      if (amount <= 0) return;
      const method: PayMethod = cm.payMethod;
      const tp = at(d, mins + 3);
      sched(tp, () => {
        run(
          'payment.client',
          {
            clientId: cm.id,
            amount,
            allocations: [{ orderId, amount }],
            method,
            status: method === 'transfer' && d < TODAY && rng.chance(0.5) ? 'pending' : 'posted',
            comment: method === 'transfer' ? 'Перевод при самовывозе' : 'Оплата при самовывозе',
          },
          mgrOf(d),
          tp,
        );
      });
      return;
    }
    const due = o.dueDate;
    let payDay: ISODate;
    let fraction = 1;
    if (cm.discipline === 'good') payDay = plusDays(due, -rng.int(0, Math.min(4, cm.client.deferDays - 1)));
    else if (cm.discipline === 'late') payDay = plusDays(due, rng.int(3, 12));
    else {
      payDay = plusDays(due, rng.int(14, 36));
      fraction = rng.float(0.5, 0.8);
    }
    payDay = nextOfficeDay(payDay);
    const lastPay = plusDays(TODAY, -1);
    const again = stuck.get(cm.id) === orderId; // повторный выезд после неудачной доставки
    if (again || (overdueSet.has(cm.id) && !hasStuck(cm.id) && due >= stuckFrom.get(cm.id)! && due <= plusDays(TODAY, -5))) {
      stuck.set(cm.id, orderId);
      payDay = plusDays(TODAY, rng.int(2, 15)); // ещё не заплатил — просрочка на сегодня
    } else if (due < lastPay && payDay > lastPay) {
      payDay = lastPay; // остальные успевают закрыть долг до сегодняшнего дня
      while (!officeDay(payDay) && payDay > due) payDay = plusDays(payDay, -1);
    }
    const tp = at(payDay, 10 * 60 + rng.int(0, 360));
    sched(tp, () => payClient(cm, tp, fraction, orderId));
    if (fraction < 1) {
      let d2 = nextOfficeDay(plusDays(payDay, rng.int(8, 20)));
      if (payDay <= lastPay && d2 > lastPay) d2 = payDay;
      const t2 = at(d2, d2 === payDay ? 16 * 60 + 30 : 11 * 60 + rng.int(0, 300));
      sched(t2, () => payClient(cm, t2, 1, orderId));
    }
  };

  /** Клиент гасит долги со сроком до «сейчас + 5 дней» и этот заказ (одним платежом на несколько заказов). */
  const payClient = (cm: ClientMeta, t: ISODateTime, fraction: number, orderId?: ID): void => {
    const d = t.slice(0, 10);
    const horizon = plusDays(d, 5);
    let skip = hasStuck(cm.id) ? stuck.get(cm.id) : undefined; // неоплаченный счёт должника: платит за остальные
    let debt = 0;
    const parts: { o: Order; v: number }[] = [];
    for (const o of db.orders) {
      if (o.clientId !== cm.id || !o.dueDate || (o.dueDate > horizon && o.id !== orderId)) continue;
      if (skip === o.id && o.id !== orderId) continue;
      const op = orderPayment(db, o);
      const v = Math.max(0, op.debt - op.pending);
      debt += v;
      if (v > 0) parts.push({ o, v });
    }
    // должник без неоплаченного счёта в конце периода оставляет неоплаченным самый старый из просроченных
    if (!skip && overdueSet.has(cm.id) && d >= plusDays(TODAY, -20)) {
      const old = parts
        .filter((x) => x.o.dueDate! <= plusDays(TODAY, -5) && x.o.dueDate! < d)
        .sort((a, b) => a.o.dueDate!.localeCompare(b.o.dueDate!))[0];
      if (old) {
        stuck.set(cm.id, old.o.id);
        skip = old.o.id;
        debt -= old.v;
        parts.splice(parts.indexOf(old), 1);
      }
    }
    if (debt <= 0) return;
    let amount = Math.round(debt * fraction);
    if (fraction < 1) amount = Math.max(1000, Math.round(amount / 1000) * 1000);
    if (overpayLeft > 0 && d >= '2026-10-12' && fraction === 1 && rng.chance(0.15)) {
      overpayLeft--;
      amount = Math.ceil((debt + 1) / 5000) * 5000; // округлили вверх — переплата осталась авансом
    }
    const method: PayMethod = cm.payMethod === 'cash' ? 'cash' : 'transfer';
    let allocations: { orderId: ID; amount: number }[] | undefined;
    if (skip) {
      // распределяем сами — авто-распределение закрыло бы самый старый, неоплаченный счёт
      allocations = [];
      let left = amount;
      parts.sort((a, b) => a.o.dueDate!.localeCompare(b.o.dueDate!) || a.o.number - b.o.number);
      for (const x of parts) {
        const q = Math.min(x.v, left);
        if (q > 0) allocations.push({ orderId: x.o.id, amount: q });
        left -= q;
      }
    }
    run(
      'payment.client',
      {
        clientId: cm.id,
        amount,
        ...(allocations ? { allocations } : {}),
        method,
        status: method === 'transfer' && d < TODAY && rng.chance(0.1) ? 'pending' : 'posted',
        comment: method === 'transfer' ? 'Оплата по счёту' : 'Оплата наличными в офисе',
      },
      method === 'cash' ? mgrOf(d) : E.suleymanova,
      t,
    );
  };

  /* ---------- создание заказов ---------- */
  const isCreditError = (msg: string): boolean => msg.startsWith('Нельзя подтвердить');

  const isFirstOrder = (cm: ClientMeta): boolean => cm.isNew && !db.orders.some((o) => o.clientId === cm.id && o.state !== 'cancelled');

  const createRequest = (cm: ClientMeta, rep: ID, pointId: ID, t: ISODateTime): ID | null => {
    const d = t.slice(0, 10);
    const lines = buildLines(cm, d);
    if (!lines.length) return null;
    const first = isFirstOrder(cm);
    const fulfillment = rng.chance(deliveryProb(cm, d)) || first ? 'delivery' : 'pickup';
    const note = rng.chance(0.15) ? rng.pick(['Привезти до обеда', 'Позвонить перед доставкой', 'Нужны свежие сроки', 'Без замен']) : '';
    const r = run(
      'order.create',
      { clientId: cm.id, pointId, state: 'request', source: 'rep', lines, fulfillment, comment: first ? 'Первый заказ новой точки — оплата при получении' : note },
      rep,
      t,
    );
    if (!r?.id) return null;
    pendingRequests.add(r.id);
    lastOrderDay.set(cm.id, dayNum(d));
    return r.id;
  };

  const managerOrder = (cm: ClientMeta, t: ISODateTime, sourceHint?: 'chat' | 'phone'): void => {
    const d = t.slice(0, 10);
    if (lapsed(cm.id, d)) return; // перестал заказывать — ждёт звонка менеджера
    const mgr = MANAGERS.includes(cm.owner as (typeof MANAGERS)[number]) ? cm.owner : mgrOf(d);
    let source: 'phone' | 'manager' | 'repeat' | 'chat' = sourceHint ?? rng.weighted(['phone', 'manager', 'repeat', 'chat'] as const, [45, 20, 25, 10]);
    let lines: { productId: ID; pack: PackKey; packQty: number }[] = [];
    if (source === 'repeat') {
      const last = [...db.orders].reverse().find((o) => o.clientId === cm.id && o.state === 'closed');
      if (last) {
        const pv = repeatPreview(db, last.id, t);
        lines = pv.payloadLines;
      }
      if (!lines.length) source = 'phone';
    }
    if (!lines.length) lines = buildLines(cm, d);
    if (!lines.length) return;
    const fulfillment = sourceHint === 'phone' && d === YESTERDAY ? 'delivery' : rng.chance(deliveryProb(cm, d)) ? 'delivery' : 'pickup';
    const payload = { clientId: cm.id, state: 'confirmed', source, lines, fulfillment, comment: isFirstOrder(cm) ? 'Первый заказ нового клиента' : source === 'repeat' ? 'Повтор прошлого заказа' : '' };
    let r = run('order.create', payload, mgr, t);
    if (!r && isCreditError(lastError())) {
      if (cm.tight || rng.chance(hasStuck(cm.id) ? 0.6 : 0.2)) {
        const to = at(d, minutesOf(t) + 25);
        sched(to, () => {
          const r2 = run('order.create', { ...payload, override: true }, E.owner, to);
          if (r2?.id) onConfirmed(r2.id, cm, to);
        });
        return;
      } else {
        nextMgrOrder.set(cm.id, dayNum(d) + 3); // попросили сначала погасить долг — перезвонят
        return;
      }
    }
    if (r?.id) onConfirmed(r.id, cm, t);
  };

  /* ---------- подтверждение заявок представителей ---------- */
  const confirmBatch = (d: ISODate, t: ISODateTime): void => {
    const ids = [...pendingRequests];
    ids.forEach((id, i) => {
      const o0 = get(db, 'orders', id);
      if (!o0 || o0.state !== 'request' || o0.createdAt >= t) return;
      const tt = at(d, minutesOf(t) + Math.floor(i / 2));
      sched(tt, () => confirmOne(id, d, tt, i));
    });
  };

  const confirmOne = (id: ID, d: ISODate, tt: ISODateTime, i: number): void => {
    {
      const o = get(db, 'orders', id);
      if (!o || o.state !== 'request') {
        pendingRequests.delete(id);
        return;
      }
      const cm = cmById.get(o.clientId);
      if (!cm) return;
      const mgr = mgrOf(d, i);
      const fit = fitLines(o);
      if (!fit.length) {
        run('order.cancel', { orderId: id, reason: 'Нужного товара нет на складе' }, mgr, tt);
        pendingRequests.delete(id);
        return;
      }
      const changed = fit.length !== o.lines.length || fit.some((l, k) => l.packQty !== o.lines[k].packQty || l.productId !== o.lines[k].productId);
      if (changed) run('order.update', { orderId: id, lines: fit }, mgr, tt);
      let r = run('order.confirm', { orderId: id }, mgr, tt);
      if (!r && isCreditError(lastError())) {
        const n = (requestAttempts.get(id) ?? 0) + 1;
        requestAttempts.set(id, n);
        if (cm.tight || hasStuck(cm.id)) r = run('order.confirm', { orderId: id, override: true }, E.owner, tt);
        else if (n >= 6) {
          if (rng.chance(0.6)) r = run('order.confirm', { orderId: id, override: true }, E.owner, tt);
          else {
            run('order.cancel', { orderId: id, reason: 'Клиент с просрочкой — заявка отклонена до оплаты' }, mgr, tt);
            pendingRequests.delete(id);
            return;
          }
        } else return;
      }
      if (r) {
        pendingRequests.delete(id);
        onConfirmed(id, cm, tt);
      }
    }
  };

  /* ---------- курьеры ---------- */
  const courierFor = (dl: Delivery, load: Map<ID, number>): ID => {
    const pref = dl.district === 'Советский район' ? E.ramazanov : dl.district === 'Трусовский район' ? E.daudov : E.musaev;
    const min = Math.min(...COURIERS.map((c) => load.get(c) ?? 0));
    if ((load.get(pref) ?? 0) <= min + 1) return pref;
    return COURIERS.reduce((a, c) => ((load.get(c) ?? 0) < (load.get(a) ?? 0) ? c : a), COURIERS[0]);
  };

  const dispatchDay = (d: ISODate, t: ISODateTime): void => {
    // неудачные вчера: повторная доставка или возврат на склад
    for (const dl of db.deliveries) {
      if (dl.state !== 'failed') continue;
      const reason = dl.attempts[dl.attempts.length - 1]?.reason ?? '';
      if (returnToStockLeft > 0 && (reason === 'Отказ от товара' || rng.chance(0.25))) {
        returnToStockLeft--;
        run('delivery.returnToStock', { deliveryId: dl.id }, E.abakarova, t);
      } else {
        run('delivery.reschedule', { deliveryId: dl.id, date: d, interval: rng.pick(INTERVALS) }, E.abakarova, t);
      }
    }
    const todays = db.deliveries.filter((x) => x.date === d && x.state === 'waiting');
    if (d === TODAY) {
      todays.sort((a, b) => a.number - b.number);
      const nWait = 2 + (todays.length > 17 ? 1 : 0);
      // самые свежие — ждут назначения; клиенты, заказавшие сегодня, ждут вечером, а не утром
      const waitingNow = todays.splice(Math.max(0, todays.length - nWait), nWait);
      waitingNow.forEach((dl, i) => {
        if (minutesOf(dl.interval.slice(-5)) < 17 * 60) dl.interval = ['15:00–18:00', '16:00–19:00', '14:00–17:00'][i % 3];
      });
      // лишние — на завтра
      while (todays.length > 15) {
        const x = todays.pop()!;
        run('delivery.reschedule', { deliveryId: x.id, date: plusDays(TODAY, 1) }, E.abakarova, t);
      }
    }
    const load = new Map<ID, number>();
    const byCourier = new Map<ID, Delivery[]>();
    const sorted = todays.slice().sort((a, b) => a.interval.localeCompare(b.interval) || a.lng - b.lng);
    for (const dl of sorted) {
      const c = courierFor(dl, load);
      load.set(c, (load.get(c) ?? 0) + 1);
      const list = byCourier.get(c) ?? [];
      list.push(dl);
      byCourier.set(c, list);
    }
    if (d === TODAY) {
      // сегодня к 14:00 курьер успевает 2–3 точки и едет к следующей; остальные клиенты ждут днём.
      // Опаздывает одна доставка — чтобы на показе было видно, как выглядит опоздание, а не красный весь маршрут
      let lateLeft = 1;
      const AFTERNOON = ['14:00–17:00', '15:00–18:00', '16:00–19:00'];
      for (const [courier, list] of byCourier) {
        const morning = courier === E.daudov ? 2 : 3; // столько точек в плане до 14:00 (см. todayRoute)
        list.forEach((dl, i) => {
          const end = minutesOf(dl.interval.slice(-5));
          if (i < morning - 1) return;
          if (i === morning - 1) {
            if (end < 14 * 60 + 30) dl.interval = '13:00–16:00'; // к этой точке курьер едет сейчас
            return;
          }
          if (end > 15 * 60) return;
          if (lateLeft > 0) {
            lateLeft--;
            return;
          }
          dl.interval = AFTERNOON[(i - morning) % AFTERNOON.length];
        });
        list.sort((a, b) => a.interval.localeCompare(b.interval));
      }
    }
    for (const [courier, list] of byCourier) {
      // маршрут курьера — по началу интервала (список уже отсортирован по интервалу)
      list.forEach((dl, i) => {
        run('delivery.assign', { deliveryId: dl.id, courierId: courier, date: d, routeOrder: i + 1 }, E.abakarova, t);
      });
      if (d === TODAY) todayRoute(courier, list);
      else route(courier, list, d);
    }
  };

  const collectFor = (dl: Delivery, cm: ClientMeta | undefined, forced?: PayMethod): { collected: number; method: PayMethod } => {
    if (dl.collect <= 0) return { collected: 0, method: 'cash' };
    const method: PayMethod = forced ?? (cm?.payMethod === 'card' ? 'card' : cm?.payMethod === 'transfer' ? (rng.chance(0.5) ? 'transfer' : 'cash') : 'cash');
    let collected = dl.collect;
    if (!forced && rng.chance(0.05)) collected = Math.round((dl.collect * rng.float(0.5, 0.8)) / 100) * 100;
    return { collected, method };
  };

  const route = (courier: ID, list: Delivery[], d: ISODate): void => {
    let t = 9 * 60 + 25 + rng.int(0, 15);
    for (const dl of list) {
      const startWin = minutesOf(dl.interval.slice(0, 5));
      const start = Math.max(t, startWin - 40);
      const dur = rng.int(20, 45);
      // вручение — не раньше начала интервала: приехал раньше — ждёт клиента
      const end = Math.max(start + dur, startWin + 3 + (dur % 19));
      t = end + rng.int(10, 25);
      if (end > 19 * 60) {
        const tr = at(d, 18 * 60 + 30);
        sched(tr, () => void run('delivery.reschedule', { deliveryId: dl.id, date: nextWorkday(d) }, E.abakarova, tr));
        continue;
      }
      const ts = at(d, start);
      const te = at(d, end);
      const dlId = dl.id;
      sched(ts, () => {
        const x = get(db, 'deliveries', dlId);
        const o = x ? get(db, 'orders', x.orderId) : undefined;
        if (!x || !o || x.state !== 'assigned') return;
        if (o.state === 'confirmed' && o.pick !== 'picked') {
          run('delivery.reschedule', { deliveryId: dlId, date: nextWorkday(d) }, E.abakarova, ts);
          return;
        }
        if (!run('delivery.start', { deliveryId: dlId }, courier, ts)) return;
        const cm = cmById.get(o.clientId);
        if (cm && cm.client.deferDays > 0) afterShip(o.id, cm, ts, true);
        sched(te, () => {
          const y = get(db, 'deliveries', dlId);
          if (!y || y.state !== 'on_way') return;
          if (++deliverySeq % 13 === 6) {
            const reason = rng.weighted([...DELIVERY_FAIL_REASONS], [30, 20, 12, 10, 18, 10]);
            run('delivery.fail', { deliveryId: dlId, reason }, courier, te);
            return;
          }
          const { collected, method } = collectFor(y, cm);
          run('delivery.deliver', { deliveryId: dlId, collected, method }, courier, te);
          if (cm && cm.client.deferDays === 0 && collected < y.collect) {
            // недоплатил при вручении — довозит деньги в офис через несколько дней (до сегодня)
            let d2 = nextOfficeDay(plusDays(d, rng.int(3, 9)));
            if (d2 >= TODAY) d2 = d < plusDays(TODAY, -1) ? plusDays(TODAY, -1) : TODAY;
            const t2 = at(d2, d2 === TODAY ? 12 * 60 : 11 * 60 + rng.int(0, 300));
            sched(t2, () => payClient(cm, t2, 1, o.id));
          }
        });
      });
    }
  };

  /** Сегодня до 14:00: курьер идёт по маршруту — часть вручена, одна в пути, остальные назначены.
      Несобранный заказ пропускает: он остаётся в маршруте до сборки. */
  const todayRoute = (courier: ID, list: Delivery[]): void => {
    const d = TODAY;
    const plan: ('deliver' | 'fail' | 'onway')[] =
      courier === E.musaev ? ['deliver', 'deliver', 'onway'] : courier === E.ramazanov ? ['deliver', 'fail', 'onway'] : ['deliver', 'onway'];
    const methods: PayMethod[] = courier === E.musaev ? ['cash', 'transfer'] : courier === E.ramazanov ? ['cash'] : ['card'];
    let k = 0;
    let paid = 0;
    const step = (i: number, t: number): void => {
      if (k >= plan.length || i >= list.length) return;
      const dl = list[i];
      const dlId = dl.id;
      const win = minutesOf(dl.interval.slice(0, 5));
      let what = plan[k];
      let start = Math.max(t, win - 40);
      if (what === 'onway') start = Math.max(start, 13 * 60 + 15 + rng.int(0, 30));
      if (start > 13 * 60 + 58) return; // к следующему ещё не выехал
      const ts = at(d, start);
      sched(ts, () => {
        const x = get(db, 'deliveries', dlId);
        const o = x ? get(db, 'orders', x.orderId) : undefined;
        if (!x || !o || x.state !== 'assigned' || (o.state === 'confirmed' && o.pick !== 'picked')) {
          step(i + 1, start); // заказ ещё не собран — едет к следующему
          return;
        }
        const end = Math.max(start + rng.int(30, 45), win + rng.int(5, 20));
        if (what !== 'onway' && end > 13 * 60 + 55) what = 'onway'; // до 14:00 не успевает — сейчас в пути
        if (!run('delivery.start', { deliveryId: dlId }, courier, ts)) {
          step(i + 1, start);
          return;
        }
        k = what === 'onway' ? plan.length : k + 1;
        const cm = cmById.get(o.clientId);
        if (cm && cm.client.deferDays > 0) afterShip(o.id, cm, ts, true);
        if (what === 'onway') return;
        const te = at(d, end);
        sched(te, () => {
          const y = get(db, 'deliveries', dlId);
          if (!y || y.state !== 'on_way') return;
          if (what === 'fail') run('delivery.fail', { deliveryId: dlId, reason: 'Клиента нет на месте' }, courier, te);
          else {
            const { collected, method } = collectFor(y, cm, y.collect > 0 ? methods[Math.min(paid++, methods.length - 1)] : undefined);
            run('delivery.deliver', { deliveryId: dlId, collected, method }, courier, te);
          }
          step(i + 1, end + rng.int(10, 20));
        });
      });
    };
    step(0, 9 * 60 + 30);
  };

  const handIn = (d: ISODate): void => {
    COURIERS.forEach((c, i) => {
      if (d === YESTERDAY && c === E.musaev) return; // Денис вчера не заехал в магазин
      const t = at(d, 18 * 60 + 35 + i * 7);
      sched(t, () => {
        const has = db.deliveries.some((x) => x.courierId === c && x.collectedMethod === 'cash' && x.collected > 0 && !x.handedIn);
        if (has) run('courier.handIn', { courierId: c }, c, t);
      });
    });
  };

  /* ---------- касса ---------- */
  const RECEIPT_LINES = [1, 2, 3, 4, 5, 6, 7, 8];
  const RECEIPT_LINES_W = [36, 29, 17, 9, 5, 2, 1, 1];
  // ручные скидки продавца — отдельный поток случайностей, чтобы не сдвигать остальную историю
  const drng = rng.fork('discounts');
  type SaleLine = { productId: ID; pack: PackKey; packQty: number; discountPct?: number; discountReason?: string };

  /** Скидка на строку, если она в пределах лимита продавца и минимальной наценки. */
  const tryDiscount = (l: SaleLine, d: ISODate, pct: number, reason: string): boolean => {
    const p = get(db, 'products', l.productId)!;
    const pi = priceFor(db, p.id, { priceType: 'retail', date: d });
    const after = Math.round((pi.price * (100 - pct)) / 100);
    const floor = Math.round((pi.base * (100 - db.settings.discountLimits.seller)) / 100);
    if (after < floor || after >= pi.price) return false;
    if (p.cost !== null && after < Math.ceil((p.cost * (100 + db.settings.minMarginPct)) / 100)) return false;
    l.discountPct = pct;
    l.discountReason = reason;
    return true;
  };

  /** Ручная скидка в ~4 % чеков: постоянному покупателю, за повреждённую упаковку, при покупке оптом в рознице.
      Возвращает карту покупателя, если скидка — постоянному. */
  const manualDiscount = (lines: SaleLine[], d: ISODate): ID | null => {
    if (!drng.chance(0.05)) return null;
    let kind = drng.weighted(['regular', 'damaged', 'bulk'] as const, [40, 32, 28]);
    if (kind === 'bulk') {
      // покупатель берёт десяток одного товара — продавец даёт 5 %
      const best = lines.map((l) => ({ l, a: avail(l.productId, 'shop') })).sort((a, b) => b.a - a.a)[0];
      const want = drng.int(6, 12);
      if (best && best.a >= 6) {
        best.l.packQty = Math.min(best.a, Math.max(best.l.packQty, want));
        const ok = lines.map((l) => tryDiscount(l, d, 5, 'Оптом в рознице')).some(Boolean);
        if (ok) return null;
      }
      kind = 'damaged';
    }
    if (kind === 'regular') {
      const cards = retailCards.filter((c) => (!c.isNew || c.createdAt <= d) && get(db, 'clients', c.id));
      const ok = lines.map((l) => tryDiscount(l, d, 5, 'Постоянный покупатель')).some(Boolean);
      return ok && cards.length ? drng.pick(cards).id : null;
    }
    for (const l of drng.shuffle(lines)) if (tryDiscount(l, d, 5, 'Повреждённая упаковка')) break;
    return null;
  };

  const receipt = (d: ISODate, seller: ID, t: ISODateTime): void => {
    const n = rng.weighted(RECEIPT_LINES, RECEIPT_LINES_W);
    const lines: SaleLine[] = [];
    const used = new Set<number>();
    for (let i = 0; i < n; i++) {
      for (let tries = 0; tries < 6; tries++) {
        const pi = retailTable.sample(rng);
        if (used.has(pi)) continue;
        const p = P[pi];
        if (!p.active) continue;
        const a = avail(p.id, 'shop');
        if (a <= 0) {
          stats.outOfStockPicks++;
          continue;
        }
        const cheap = p.retailPrice < 100;
        let qty = cheap ? rng.weighted([1, 2, 3], [65, 25, 10]) : rng.weighted([1, 2, 3], [86, 12, 2]);
        qty = Math.min(qty, a);
        used.add(pi);
        lines.push({ productId: p.id, pack: 'pcs', packQty: qty });
        break;
      }
    }
    if (!lines.length) return;
    const regular = manualDiscount(lines, d);
    let total = 0;
    for (const l of lines) {
      const pr = priceFor(db, l.productId, { priceType: 'retail', date: d }).price;
      total += l.packQty * (l.discountPct ? Math.round((pr * (100 - l.discountPct)) / 100) : pr);
    }
    const card = rng.chance(0.5 + 0.03 * (+monthKey(d) - 8)) ? total : 0;
    let payment: { cash?: number; card?: number };
    if (card) payment = { card };
    else if (rng.chance(0.08) && total > 600) {
      const part = Math.round((total * rng.float(0.2, 0.5)) / 100) * 100;
      payment = { card: total - part, cash: part };
    } else {
      const notes = [50, 100, 500, 1000, 2000, 5000];
      const exact = rng.chance(0.3);
      const up = notes.find((x) => x >= total && x - total < total + 500) ?? Math.ceil(total / 1000) * 1000;
      payment = { cash: exact ? total : rng.chance(0.5) ? up : Math.ceil(total / 100) * 100 };
    }
    const card0 = rng.chance(0.12) ? rng.pick(retailCards.filter((c) => !c.isNew || c.createdAt <= d)).id : null;
    const clientId = regular ?? card0;
    run('receipt.checkout', { lines, clientId: clientId && get(db, 'clients', clientId) ? clientId : null, ...payment }, seller, t);
  };

  const shiftDay = (d: ISODate): void => {
    const seller = sellerOn(d);
    const sun = isSun(d);
    const open = sun ? 9 * 60 : 8 * 60 + 30;
    const close = sun ? 18 * 60 : 20 * 60;
    const tOpen = at(d, open);
    sched(tOpen, () => void run('shift.open', { openingCash: 5000 }, seller, tOpen));
    const wd = dow(d);
    let n = wd === 6 ? rng.int(40, 52) : wd === 0 ? rng.int(30, 40) : rng.int(26, 39);
    n = Math.round(n * (0.97 + 0.06 * (season(d) - 1) * 10 * 0.1));
    let times: number[] = [];
    if (d === TODAY) {
      n = rng.int(19, 22);
      for (let i = 0; i < n; i++) times.push(rng.int(open + 6, 13 * 60 + 57));
    } else {
      for (let i = 0; i < n; i++) {
        // два пика: перед обедом и вечером
        const r = rng.next();
        const peak = r < 0.4 ? 12 * 60 : r < 0.85 ? 18 * 60 : rng.int(open, close);
        times.push(Math.round(Math.max(open + 5, Math.min(close - 5, peak + rng.gauss(0, 95)))));
      }
    }
    times = times.sort((a, b) => a - b);
    for (const m of times) {
      const t = at(d, m);
      sched(t, () => receipt(d, seller, t));
    }
    // возвраты по чекам
    if (receiptRefundsLeft > 0 && d !== TODAY && rng.chance(0.1)) {
      const tr = at(d, rng.int(open + 120, close - 60));
      sched(tr, () => {
        const from = plusDays(d, -6);
        const refunded = new Set<ID>();
        const cands: typeof db.receipts = [];
        for (let i = db.receipts.length - 1; i >= 0; i--) {
          const r = db.receipts[i];
          if (r.at.slice(0, 10) < from) break;
          if (r.refundOf) refunded.add(r.refundOf);
          else if (r.kind === 'sale' && r.total > 150 && !refunded.has(r.id)) cands.push(r);
        }
        if (!cands.length) return;
        const r = rng.pick(cands);
        const l = rng.pick(r.lines);
        const res = run('receipt.refund', { receiptId: r.id, lines: [{ productId: l.productId, qty: 1, reason: rng.weighted(['not_fit', 'defect', 'other'] as const, [50, 40, 10]) }] }, seller, tr);
        if (res) receiptRefundsLeft--;
      });
    }
    if (d !== TODAY) {
      const tClose = at(d, close);
      sched(tClose, () => {
        const s = db.shifts[db.shifts.length - 1];
        if (!s || s.closedAt) return;
        const sum = shiftSummaryLocal(s.id);
        const counted = sum + (CASH_DIFF[d] ?? 0);
        run('shift.close', { countedCash: Math.max(0, counted) }, seller, tClose);
      });
    }
  };

  /** Сверка кассы: смены с расхождением при пересчёте (остальные сошлись). */
  const CASH_DIFF: Record<ISODate, number> = {
    [plusDays(TODAY, -13)]: 200, // излишек
    [plusDays(TODAY, -7)]: -350, // недостача
    [YESTERDAY]: -600, // у Патимат Алиевой не хватает 600 ₽
  };

  const shiftSummaryLocal = (shiftId: ID): number => {
    const s = get(db, 'shifts', shiftId)!;
    let cash = s.openingCash;
    for (let i = db.receipts.length - 1; i >= 0; i--) {
      const r = db.receipts[i];
      if (r.shiftId !== shiftId) {
        if (r.at < s.openedAt) break;
        continue;
      }
      cash += r.kind === 'sale' ? r.cash - r.change : -r.cash;
    }
    return cash;
  };

  /* ---------- склад ---------- */
  // ходовые товары магазин держит целой коробкой (до 12 шт): покупатель часто берёт коробку — её продают с кассы
  const popularRate = (() => {
    const r = activeIdx.map((m) => retailRate[m.index]).sort((x, y) => y - x);
    return r[Math.floor(r.length * 0.2)] ?? Infinity;
  })();
  const restockShop = (d: ISODate, t: ISODateTime): void => {
    const lines: { productId: ID; qty: number }[] = [];
    for (const m of activeIdx) {
      const p = P[m.index];
      if (!p.active) continue;
      const rate = retailRate[m.index];
      const box = p.packs.find((k) => k.key === 'box')?.qty ?? 0;
      const boxTarget = rate >= popularRate && box > 0 && box <= 12 ? box + 2 : 0;
      const target = Math.max(3, Math.ceil(rate * 7) + 2, boxTarget);
      const sh = stockRow(db, p.id, 'shop')?.onHand ?? 0;
      if (sh >= target * 0.6) continue;
      const qty = Math.min(target - sh, avail(p.id, 'warehouse'));
      if (qty > 0) lines.push({ productId: p.id, qty });
    }
    if (lines.length) run('stock.transfer', { from: 'warehouse', to: 'shop', lines, comment: 'Пополнение магазина' }, E.ismailov, t);
  };

  // закупки: цикл по каждому поставщику
  const supplierKeys = [...input.supplierIds.keys()];
  const nextPurchase = new Map<string, number>();
  const prng = rng.fork('purchase-cycle');
  supplierKeys.forEach((k) => nextPurchase.set(k, dayNum(START) + prng.int(4, 10)));
  const deficitIds = new Set(meta.filter((m) => m.deficit).map((m) => P[m.index].id));
  const noCostIds = new Set(meta.filter((m) => m.noCost).map((m) => P[m.index].id));

  const makePurchase = (key: string, t: ISODateTime, mode: 'normal' | 'transit' | 'partial' | 'draft'): void => {
    const sid = input.supplierIds.get(key)!;
    const s = get(db, 'suppliers', sid)!;
    const d = t.slice(0, 10);
    // черновик — по тем же правилам, что предложение на закупку в разделе; обычные закупки — на весь цикл поставщика
    // и с запасом: у ходовых товаров на складе держим не меньше двух коробок под оптовые заказы
    const opts =
      mode === 'draft'
        ? { at: t, coverDays: 21 }
        : { at: t, coverDays: 24, horizonDays: Infinity, extraStock: (p: Product, perDay: number, box: number) => (perDay * 30 >= box ? (deficitIds.has(p.id) ? 2 : WH_BOXES) * box : 0) };
    let sug = purchaseSuggestion(db, sid, opts).filter((x) => !noCostIds.has(x.productId));
    if (mode === 'normal' && d >= '2026-10-05') sug = sug.filter((x) => !deficitIds.has(x.productId) || rng.chance(0.1));
    if (!sug.length) return;
    sug = sug.slice(0, 140);
    const r = run(
      'purchase.create',
      { supplierId: sid, lines: sug.map((x) => ({ productId: x.productId, boxes: x.boxes, boxSize: x.boxSize })), comment: mode === 'draft' ? 'Предложение на закупку — проверить и подтвердить' : '' },
      E.ibragimov,
      t,
    );
    if (!r?.id || mode === 'draft') return;
    const purchaseId = r.id;
    const tApprove = at(d, minutesOf(t) + rng.int(40, 160));
    sched(tApprove, () => {
      if (!run('purchase.approve', { purchaseId }, E.owner, tApprove)) return;
      const pu = get(db, 'purchases', purchaseId)!;
      let day = pu.expectedAt;
      while (!workday(day)) day = plusDays(day, 1);
      if (mode === 'transit') return;
      if (mode === 'partial') day = plusDays(TODAY, -1);
      const tr = at(day, 9 * 60 + 20 + rng.int(0, 60));
      sched(tr, () => receivePurchase(purchaseId, tr, mode === 'partial'));
    });
  };

  const defectDays: ISODate[] = ['2026-08-24', '2026-09-28', '2026-10-24'];
  const DIFF = ['Недовоз', 'Пересорт: привезли другой аромат', 'Бой при перевозке', 'Протечка упаковки', 'Нет в наличии у поставщика'];

  const receivePurchase = (purchaseId: ID, t: ISODateTime, partial: boolean): void => {
    const pu = get(db, 'purchases', purchaseId);
    if (!pu || (pu.state !== 'ordered' && pu.state !== 'partial')) return;
    const d = t.slice(0, 10);
    const withDiff = rng.chance(0.3);
    // брак при приёмке — три раза за период, в первой приёмке после этих дней
    let defectHere = !partial && defectDays.length > 0 && d >= defectDays[0];
    if (defectHere) defectDays.shift();
    const lines = pu.lines.map((l, i) => {
      let received = l.qty;
      let defect = 0;
      let diffReason: string | undefined;
      const p = get(db, 'products', l.productId)!;
      if (deficitIds.has(l.productId) && d >= '2026-10-05') {
        received = rng.chance(0.5) ? Math.max(0, Math.floor((l.qty * 0.3) / l.boxSize) * l.boxSize) : 0;
        diffReason = received ? 'Недовоз: поставщик привёз часть' : 'Нет в наличии у поставщика';
      } else if (defectHere && !deficitIds.has(l.productId)) {
        defectHere = false;
        diffReason = defectDays.length % 2 ? 'Бой при перевозке' : 'Протечка упаковки';
        defect = Math.min(l.qty, 2 + (l.qty % 4));
      } else if (withDiff && rng.chance(0.03)) {
        let r = rng.int(0, 4);
        if (r === 2 || r === 3) r = 0; // брак при приёмке — только в отмеченные дни
        diffReason = DIFF[r];
        if (r === 0 || r === 4) received = Math.max(0, l.qty - l.boxSize);
        else if (r === 1) received = l.qty + l.boxSize;
      }
      if (partial && i % 2 === 1) return null;
      return { productId: p.id, received, defect, diffReason, expiry: p.expiryTracked ? plusDays(d, rng.int(300, 720)) : undefined };
    });
    const list = lines.filter((x): x is NonNullable<typeof x> => x !== null);
    run('purchase.receive', { purchaseId, lines: list, final: !partial }, rng.pick(WAREHOUSE), t);
    // оплата поставщику по сроку
    const after = get(db, 'purchases', purchaseId)!;
    if (!after.dueDate || partial) return;
    const r = rng.next();
    let offset = r < 0.85 ? -rng.int(0, 2) : r < 0.96 ? rng.int(2, 6) : rng.int(8, 14);
    if (after.dueDate >= TODAY) offset = Math.max(0, offset);
    let part = 1;
    if (supplierLateLeft > 0 && after.dueDate >= plusDays(TODAY, -12) && after.dueDate <= plusDays(TODAY, -2)) {
      supplierLateLeft--;
      offset = rng.int(12, 20); // не успели оплатить остаток — просрочка на сегодня
      if (after.total > 250000) part = 0.6; // большую закупку оплатили частично в срок
    }
    if (part < 1) {
      const t0 = at(nextOfficeDay(after.dueDate), 11 * 60 + 30);
      sched(t0, () => paySupplier(purchaseId, t0, 0, part));
    }
    const payDay = nextOfficeDay(plusDays(after.dueDate, offset));
    const tp = at(payDay, 11 * 60 + rng.int(0, 200));
    sched(tp, () => paySupplier(purchaseId, tp, 0));
  };

  const paySupplier = (purchaseId: ID, t: ISODateTime, attempt: number, part = 1): void => {
    const pu = get(db, 'purchases', purchaseId);
    if (!pu) return;
    const rest = purchaseAccepted(db, purchaseId) - purchasePaid(db, purchaseId);
    const left = part < 1 ? Math.round((rest * part) / 1000) * 1000 : rest;
    if (left <= 0) return;
    const ok = run('payment.supplier', { supplierId: pu.supplierId, amount: left, allocations: [{ purchaseId, amount: left }], comment: `Оплата по закупке №${pu.number}` }, E.suleymanova, t);
    if (!ok && attempt < 6) {
      const nt = at(nextOfficeDay(plusDays(t.slice(0, 10), 2)), 11 * 60 + rng.int(0, 120));
      sched(nt, () => paySupplier(purchaseId, nt, attempt + 1, part));
    }
  };

  /* ---------- представители: маршрут дня ---------- */
  const fieldDay = (d: ISODate): boolean => [2, 3, 4].includes(dow(d));
  const LAST_VISIT = 18 * 60;
  const repActive = (rep: ID, d: ISODate): boolean => rep !== E.khalilov || d >= KHALILOV_START;
  const REFUSAL_W = [34, 15, 15, 15, 13, 8];
  const CALLBACK_TEXT = [
    'Перезвонить в пятницу — хозяйка будет на месте',
    'Попросили прайс на освежители и мешки',
    'Обещали заказ на следующей неделе',
    'Ждут, когда освободится склад',
    'Сравнивают цены с конкурентом — прислать акции',
    'Нужен счёт на организацию, перезвонить бухгалтеру',
  ];

  const planVisits = (d: ISODate): void => {
    for (const rep of REPS) {
      if (!repActive(rep, d)) continue;
      const pts: { cm: ClientMeta; pointId: ID; lng: number }[] = [];
      for (const c of db.clients) {
        if (c.ownerId !== rep || !c.active) continue;
        const cm = cmById.get(c.id);
        if (!cm) continue;
        for (const pt of c.points) pts.push({ cm, pointId: pt.id, lng: pt.lng });
      }
      if (!pts.length) continue;
      const today = dayNum(d);
      const scored = pts.map((x) => ({ ...x, s: today - (lastVisit.get(x.pointId) ?? today - rng.int(5, 20)) + rng.float(0, 4) }));
      scored.sort((a, b) => b.s - a.s);
      // клиент в маршруте дня один раз: у магазина с несколькими точками — та, где дольше не были
      const seen = new Set<ID>();
      const perClient = scored.filter((x) => !seen.has(x.cm.id) && !!seen.add(x.cm.id));
      const k = d === TODAY ? rng.int(6, 8) : rng.weighted([5, 6, 7, 8], [36, 31, 21, 12]);
      const chosen = perClient.slice(0, Math.min(k, perClient.length)).sort((a, b) => a.lng - b.lng);
      const done = d === TODAY ? rng.int(2, 3) : chosen.length;
      let t = 9 * 60 + 25 + rng.int(0, 20);
      chosen.forEach((x, i) => {
        if (d === TODAY && i === done) t = Math.max(t, 14 * 60 + 15 + rng.int(0, 20));
        // последний визит — не позже 18:00, чтобы отметка была до 18:30
        const visitTime = Math.min(t, LAST_VISIT);
        const time = atTime(d, visitTime).slice(11);
        const step = rng.int(55, 80);
        const left = chosen.length - 1 - i;
        t += left > 0 ? Math.min(step, Math.max(35, Math.floor((LAST_VISIT - t) / left))) : step;
        lastVisit.set(x.pointId, today);
        const tp = at(d, 7 * 60 + 50 + i);
        const later = d === TODAY && i >= done; // сегодняшние после 14:00 — ещё впереди
        sched(tp, () => {
          const r = run('visit.plan', { repId: rep, clientId: x.cm.id, pointId: x.pointId, date: d, time, routeOrder: i + 1 }, rep, tp);
          if (!r?.id) return;
          const visitId = r.id;
          // фактическое время — в пределах ±40 минут от планового
          const off = rng.int(-20, 30);
          const tc = at(d, visitTime + (later ? Math.max(off, 5) : off));
          sched(tc, () => completeVisit(visitId, x.cm, x.pointId, rep, tc, d === TODAY));
        });
      });
    }
  };

  const todayDone = new Map<ID, number>();
  /** Сколько заявок ждут подтверждения сегодня: вчерашние вечерние и сегодняшние с утренних точек. */
  const TODAY_REQUESTS = 5;
  const completeVisit = (visitId: ID, cm: ClientMeta, pointId: ID, rep: ID, t: ISODateTime, isToday: boolean): void => {
    if (!isToday && rng.chance(0.03)) {
      run('visit.complete', { visitId, missed: true, comment: 'Не успел — перенёс на следующий маршрут' }, rep, t);
      return;
    }
    const blocked = clientBalance(db, cm.id).overdue > 0;
    // должник по одному счёту всё равно заказывает — заявку подтверждает владелец
    let pOrder = blocked ? (hasStuck(cm.id) ? 0.35 : 0.06) : 0.55;
    if (isToday) {
      // сегодня у каждого представителя первая точка без долга дала заявку, пока ждущих меньше пяти;
      // если вчерашних мало — заявку дают и следующие точки, но место под первые точки остальных держим
      const k = (todayDone.get(rep) ?? 0) + (blocked ? 0 : 1);
      todayDone.set(rep, k);
      const room = TODAY_REQUESTS - db.orders.filter((o) => o.state === 'request').length;
      const firstsLeft = REPS.filter((x) => x !== rep && repActive(x, TODAY) && !todayDone.get(x)).length;
      pOrder = blocked || room <= 0 ? 0 : k === 1 || room > firstsLeft ? 1 : 0;
    }
    if (!isToday && isFirstOrder(cm)) pOrder = 1;
    const r = rng.next();
    if (r < pOrder) {
      const orderId = createRequest(cm, rep, pointId, t);
      if (orderId) {
        run('visit.complete', { visitId, result: 'order', orderId, comment: rng.chance(0.2) ? 'Заказ по привычному списку' : '' }, rep, t);
        return;
      }
      run('visit.complete', { visitId, result: 'callback', comment: 'Нужного товара нет — перезвонить после поставки' }, rep, t);
      return;
    }
    if (r < pOrder + (blocked ? 0.35 : 0.25)) {
      run('visit.complete', { visitId, result: 'callback', comment: rng.pick(CALLBACK_TEXT) }, rep, t);
      return;
    }
    const reason = blocked && rng.chance(0.5) ? 'Нет денег' : rng.weighted([...REFUSAL_REASONS], REFUSAL_W);
    run('visit.complete', { visitId, result: 'refusal', refusalReason: reason, comment: reason === 'Взяли у конкурента' ? 'Брали у «Оптторга» дешевле на порошки' : '' }, rep, t);
  };

  /* ---------- разовые события периода ---------- */
  const once: { at: ISODateTime; fn: () => void }[] = [];
  let started = false;
  const on = (when: ISODateTime, fn: () => void): void => {
    if (started) sched(when, fn);
    else once.push({ at: when, fn });
  };
  buildCalendar();

  function buildCalendar(): void {
    // права и настройки
    on('2026-08-12T09:15', () => void run('employee.update', { employeeId: E.owner, patch: { roles: ['owner', 'manager'] } }, E.owner, '2026-08-12T09:15'));
    on('2026-09-01T09:05', () => void run('settings.update', { patch: { discountLimits: { rep: 7 } } }, E.owner, '2026-09-01T09:05'));
    on('2026-10-01T09:05', () => void run('settings.update', { patch: { minMarginPct: 12 } }, E.owner, '2026-10-01T09:05'));
    // WhatsApp магазина подключили 20 октября: с этого дня клиенты получают автосообщения о заказах, доставке и оплате
    on('2026-10-20T08:30', () => void run('settings.whatsapp', { connected: true }, E.owner, '2026-10-20T08:30'));
    on(KHALILOV_START + 'T09:00', () => {
      run('employee.update', { employeeId: E.khalilov, patch: { active: true } }, E.owner, KHALILOV_START + 'T09:00');
      for (const cm of clients) {
        if (cm.owner !== E.khalilov || cm.isNew) continue;
        run('client.update', { clientId: cm.id, patch: { ownerId: E.khalilov } }, E.owner, KHALILOV_START + 'T09:00');
      }
    });
    // новые клиенты
    for (const cm of clients) {
      if (!cm.isNew) continue;
      const t = cm.createdAt + 'T' + (cm.seg === 'retail' ? '15:20' : '11:40');
      on(t, () => {
        const c = cm.client;
        const actor = cm.seg === 'retail' ? sellerOn(cm.createdAt) : cm.owner;
        const r = run(
          'client.create',
          {
            name: c.name, kind: c.kind, segment: c.segment, priceType: c.priceType, inn: c.inn, phone: c.phone,
            points: c.points, contacts: c.contacts, deferDays: c.deferDays, creditLimit: c.creditLimit,
            ownerId: cm.seg === 'retail' ? null : cm.owner, orderEveryDays: c.orderEveryDays, minOrder: c.minOrder, note: c.note,
          },
          actor,
          t,
        );
        if (!r?.id) return;
        cm.id = r.id;
        cm.client = get(db, 'clients', r.id)!;
        cm.startOwner = cm.owner;
        cmById.set(cm.id, cm);
        if (MANAGERS.includes(cm.owner as (typeof MANAGERS)[number])) nextMgrOrder.set(cm.id, dayNum(cm.createdAt) + 1);
        // новую точку представитель ставит первой в ближайший маршрут
        else if (cm.seg !== 'retail') for (const pt of cm.client.points) lastVisit.set(pt.id, dayNum(START) - 60);
      });
    }
    // акции
    const brand = (name: string): ID => db.brands.find((b) => b.name === name)!.id;
    const promo = (when: string, payload: unknown): void => on(when, () => void run('promo.create', payload, E.owner, when));
    promo('2026-08-08T10:00', { name: 'Неделя Domestos', target: { type: 'brand', id: brand('Domestos') }, kind: 'percent', value: 15, start: '2026-08-10', end: '2026-08-24', audience: 'all' });
    promo('2026-08-25T10:00', { name: 'Бумага к сентябрю', target: { type: 'category', id: 'cat-paper' }, kind: 'percent', value: 7, start: '2026-09-01', end: '2026-09-30', audience: 'wholesale' });
    on('2026-09-03T12:00', () => {
      const ids = P.filter((p) => p.categoryId === 'cat-sp-sponges' && p.active).slice(0, 3).map((p) => p.id);
      const r = run('promo.create', { name: 'Губки за полцены', target: { type: 'products', ids }, kind: 'percent', value: 50, start: '2026-09-05', end: '2026-09-20', audience: 'retail' }, E.owner, '2026-09-03T12:00');
      if (r?.id) {
        const pid = r.id;
        on('2026-09-04T09:30', () => void run('promo.toggle', { promoId: pid, active: false }, E.owner, '2026-09-04T09:30'));
      }
    });
    promo('2026-09-25T10:00', { name: 'Осенняя стирка', target: { type: 'category', id: 'cat-laundry-powder' }, kind: 'percent', value: 10, start: '2026-10-01', end: '2026-11-15', audience: 'all' });
    promo('2026-10-10T10:00', { name: 'Synergetic для клининга', target: { type: 'brand', id: brand('Synergetic') }, kind: 'percent', value: 8, start: '2026-10-15', end: '2026-11-30', audience: 'wholesale' });
    on('2026-10-15T10:00', () => {
      const ids = P.filter((p) => p.name.startsWith('Fairy') && p.volume === '450 мл' && p.active).map((p) => p.id);
      run('promo.create', { name: 'Fairy по спеццене', target: { type: 'products', ids }, kind: 'price', value: 169, start: '2026-10-20', end: '2026-11-10', audience: 'retail' }, E.owner, '2026-10-15T10:00');
    });
    promo('2026-10-28T10:00', { name: 'Ароматы ноября', target: { type: 'brand', id: brand('Glade') }, kind: 'percent', value: 12, start: '2026-11-10', end: '2026-11-30', audience: 'all' });
    promo('2026-11-02T10:00', { name: 'Чистый Новый год', target: { type: 'category', id: 'cat-cleaning' }, kind: 'percent', value: 10, start: '2026-12-01', end: '2026-12-31', audience: 'all' });

    // изменения цен: три волны от поставщиков и отдельные правки
    const wave = (when: string, brands: string[], n: number, from: number, to: number): void =>
      on(when, () => {
        const ids = new Set(brands.map(brand));
        const pool = P.filter((p) => p.active && ids.has(p.brandId));
        rng.sample(pool, n).forEach((p) => priceChange(p, rng.float(from, to), when));
      });
    wave('2026-09-01T10:00', ['Persil', 'Losk', 'Ласка', 'Vernel', 'Пемолюкс', 'Clin', 'Санфор'], 14, 0.05, 0.08);
    wave('2026-10-01T10:00', ['Fairy', 'Tide', 'Ariel', 'Lenor', 'Mr. Proper', 'Comet'], 12, 0.04, 0.07);
    wave('2026-10-20T10:00', ['Zewa', 'Papia', 'Мягкий знак'], 8, 0.03, 0.06);
    for (let i = 0; i < 14; i++) {
      const day = isoDay(dayNum(START) + rng.int(3, 88));
      if (isSun(day)) continue;
      const when = at(day, 9 * 60 + rng.int(0, 400));
      on(when, () => {
        const p = P[rng.pick(activeIdx).index];
        if (p.active) priceChange(p, rng.chance(0.7) ? rng.float(0.03, 0.1) : -rng.float(0.04, 0.09), when);
      });
    }
    // карточки товаров: снятие с продажи и минимальные остатки
    const lowActive = meta.filter((m) => !m.hot && !m.deficit && !m.inactiveFromStart && !m.dead && !m.nearExpiry && m.pop < 0.25);
    rng.sample(lowActive, 14).forEach((m) => {
      const day = isoDay(dayNum(START) + rng.int(10, 80));
      const when = at(isSun(day) ? plusDays(day, 1) : day, 12 * 60 + rng.int(0, 240));
      on(when, () => void run('product.update', { productId: P[m.index].id, patch: { active: false } }, E.owner, when));
    });
    rng.sample(meta.filter((m) => m.hot), 7).forEach((m) => {
      const day = isoDay(dayNum(START) + rng.int(15, 85));
      const when = at(isSun(day) ? plusDays(day, 1) : day, 13 * 60 + rng.int(0, 200));
      on(when, () => {
        const p = P[m.index];
        run('product.update', { productId: p.id, patch: { minStock: Math.max(p.minStock + 6, Math.round(p.minStock * 1.4)) } }, E.owner, when);
      });
    });
    // клиенты: лимиты, отсрочка, контакты
    const wholesale = clients.filter((c) => c.seg !== 'retail' && !c.isNew);
    rng.sample(wholesale.filter((c) => c.client.creditLimit > 0 && c.discipline === 'good' && !c.tight), 5).forEach((cm) => {
      const when = at(isoDay(dayNum(START) + rng.int(20, 85)), 12 * 60 + rng.int(0, 200));
      on(when, () => {
        const c = get(db, 'clients', cm.id);
        if (c) run('client.update', { clientId: c.id, patch: { creditLimit: c.creditLimit + 20000 } }, E.owner, when);
      });
    });
    rng.sample(wholesale.filter((c) => c.client.deferDays === 7), 2).forEach((cm) => {
      const when = at(isoDay(dayNum(START) + rng.int(25, 80)), 11 * 60 + rng.int(0, 200));
      on(when, () => {
        const c = get(db, 'clients', cm.id);
        if (c) run('client.update', { clientId: c.id, patch: { deferDays: 14 } }, E.owner, when);
      });
    });
    rng.sample(wholesale, 5).forEach((cm) => {
      const when = at(isoDay(dayNum(START) + rng.int(5, 88)), 14 * 60 + rng.int(0, 200));
      on(when, () => {
        const c = get(db, 'clients', cm.id);
        if (!c) return;
        const actor = c.ownerId ?? E.omarov;
        if (c.contacts.length) {
          const contacts = c.contacts.map((x, i) => (i === 0 ? { ...x, phone: '+79' + rng.pick(['17', '27', '37', '61']) + String(rng.int(1000000, 9999999)) } : x));
          run('client.update', { clientId: c.id, patch: { contacts, note: c.note || 'Сменился номер владельца' } }, actor, when);
        }
      });
    });

    // списания, пересчёты, возвраты по заказам
    const reasons: WriteoffReason[] = ['leak', 'damage', 'expired', 'shortage'];
    for (let i = 0; i < 6; i++) {
      let day = isoDay(dayNum(START) + 3 + Math.floor((i * 86) / 6) + rng.int(0, 4));
      if (isSun(day)) day = plusDays(day, 1);
      if (day >= TODAY) continue;
      const when = at(day, 17 * 60 + rng.int(0, 50));
      const reason = reasons[i % 4];
      on(when, () => writeoff(when, reason));
    }
    on('2026-09-21T07:30', () => countDoc('shop', ['cat-hygiene', 'cat-paper'], '2026-09-21T07:30'));
    on('2026-10-26T07:30', () => countDoc('warehouse', ['cat-air', 'cat-sponges'], '2026-10-26T07:30'));
    for (let i = 0; i < 10; i++) {
      const day = isoDay(dayNum(START) + rng.int(14, 91));
      if (isSun(day) || day >= TODAY) continue;
      const when = at(day, 15 * 60 + rng.int(0, 120));
      on(when, () => orderReturn(when));
    }
    // деньги: расходы, инкассация, неопознанные поступления
    for (const month of ['2026-08', '2026-09', '2026-10', '2026-11']) {
      const mName = { '2026-08': 'июль', '2026-09': 'август', '2026-10': 'сентябрь', '2026-11': 'октябрь' }[month]!;
      const mCur = { '2026-08': 'август', '2026-09': 'сентябрь', '2026-10': 'октябрь', '2026-11': 'ноябрь' }[month]!;
      const exp = (day: string, time: string, category: string, amount: number, comment: string, method: PayMethod = 'transfer'): void => {
        const when = `${month}-${day}T${time}`;
        if (when.slice(0, 10) < START) return;
        const d = when.slice(0, 10);
        const t = officeDay(d) ? when : at(nextOfficeDay(d), minutesOf(when));
        on(t, () => void run('payment.expense', { category, amount, method, comment }, E.suleymanova, t));
      };
      exp('05', '10:00', 'Аренда', 75000, 'Аренда магазина, ул. Бориса Алексеева');
      exp('05', '10:05', 'Аренда', 105000, 'Аренда склада');
      exp('05', '11:00', 'Зарплата', 380000 + rng.int(-9, 9) * 1000, `Зарплата за ${mName}, вторая часть`);
      exp('20', '11:00', 'Зарплата', 265000 + rng.int(-6, 6) * 1000, `Аванс за ${mCur}`);
      exp('03', '12:00', 'Связь и интернет', 6900, 'Интернет и телефония');
      exp('12', '12:00', 'Коммунальные услуги', 28000 + rng.int(0, 8) * 1000, 'Электричество и вода, магазин и склад');
      exp('10', '12:30', 'Реклама', 18000 + rng.int(0, 7) * 1000, '2ГИС и Авито');
      exp('16', '12:30', 'Реклама', 7500, 'Листовки для почтовых ящиков', 'card');
      exp('08', '15:00', 'Упаковка и расходники', 4000 + rng.int(0, 5) * 1000, 'Плёнка, скотч, кассовая лента', 'cash');
      exp('22', '15:00', 'Упаковка и расходники', 3500 + rng.int(0, 4) * 1000, 'Пакеты для магазина, перчатки', 'cash');
    }
    for (let day = dayNum(START) + 5; day < dayNum(TODAY); day += 7) {
      const d = isoDay(day);
      const t = at(nextOfficeDay(d), 9 * 60 + 30);
      on(t, () => void run('payment.expense', { category: 'Топливо и доставка', amount: 11000 + rng.int(0, 6) * 1000, method: 'card', comment: 'Бензин для машин доставки' }, E.suleymanova, t));
    }
    on('2026-08-21T14:00', () => void run('payment.expense', { category: 'Ремонт и обслуживание', amount: 14500, method: 'cash', comment: 'Ремонт гидравлической тележки' }, E.suleymanova, '2026-08-21T14:00'));
    on('2026-09-28T14:00', () => void run('payment.expense', { category: 'Ремонт и обслуживание', amount: 6000, method: 'transfer', comment: 'Обслуживание кассового терминала' }, E.suleymanova, '2026-09-28T14:00'));
    on('2026-10-16T14:00', () => void run('payment.expense', { category: 'Ремонт и обслуживание', amount: 23000, method: 'transfer', comment: 'Ремонт ворот склада' }, E.suleymanova, '2026-10-16T14:00'));
    const usedPayers = new Set<ID>();
    const unknown = (when: string, amount: number, identifyIn: number | null): void =>
      on(when, () => {
        // в выписке есть плательщик и ИНН, но нет назначения: бухгалтер находит клиента по ИНН
        const payerClient = clients.find((c) => c.seg !== 'retail' && c.client.inn && !usedPayers.has(c.id) && clientBalance(db, c.id).debt >= amount);
        if (payerClient) usedPayers.add(payerClient.id);
        const payer = payerClient ? { name: payerClient.client.name.split(' · ')[0], inn: payerClient.client.inn! } : undefined;
        const r = run('payment.client', { clientId: null, amount, method: 'transfer', comment: 'Поступление на счёт без назначения платежа', ...(payer ? { payer } : {}) }, E.suleymanova, when);
        if (!r?.id || identifyIn === null) return;
        const pid = r.id;
        const t2 = at(nextOfficeDay(plusDays(when.slice(0, 10), identifyIn)), 10 * 60 + 40);
        on(t2, () => {
          const debtor = (payerClient && clientBalance(db, payerClient.id).debt >= amount ? payerClient : undefined) ?? clients.find((c) => c.seg !== 'retail' && clientBalance(db, c.id).debt >= amount);
          if (debtor) run('payment.identify', { paymentId: pid, clientId: debtor.id }, E.suleymanova, t2);
        });
      });
    unknown('2026-09-17T11:20', 18400, 2);
    unknown('2026-10-14T12:05', 9750, 1);
    unknown('2026-11-02T11:45', 12300, null);
    unknown('2026-11-04T15:10', 7850, null);

    // конец периода: закупки в пути, частичная приёмка, черновик
    on('2026-10-29T10:00', () => makePurchase('hoz', '2026-10-29T10:00', 'normal'));
    on('2026-11-02T10:30', () => makePurchase('eko', '2026-11-02T10:30', 'transit'));
    on('2026-11-03T10:30', () => makePurchase('volga', '2026-11-03T10:30', 'transit'));
    on('2026-11-04T10:30', () => makePurchase('dvor', '2026-11-04T10:30', 'transit'));
    on('2026-11-02T11:00', () => makePurchase('hoz', '2026-11-02T11:00', 'partial'));
    on(TODAY + 'T09:10', () => makePurchase('paper', TODAY + 'T09:10', 'draft'));
    // сегодня: скриншот перевода от клиента — ждёт банк
    on(TODAY + 'T12:40', () => {
      const debtor = clients.find((c) => c.seg !== 'retail' && c.client.deferDays > 0 && clientBalance(db, c.id).debt > 5000);
      if (!debtor) return;
      const b = clientBalance(db, debtor.id);
      run('payment.client', { clientId: debtor.id, amount: Math.round(b.debt / 2 / 100) * 100, method: 'transfer', status: 'pending', comment: 'Прислали скриншот перевода в WhatsApp' }, E.omarov, TODAY + 'T12:40');
    });
    on(TODAY + 'T11:25', () => {
      const debtor = clients.filter((c) => c.seg !== 'retail' && c.client.deferDays > 0 && clientBalance(db, c.id).debt > 3000)[3];
      if (!debtor) return;
      const b = clientBalance(db, debtor.id);
      run('payment.client', { clientId: debtor.id, amount: Math.round(b.debt / 100) * 100, method: 'transfer', status: 'pending', comment: 'Скриншот перевода от бухгалтера клиента' }, E.suleymanova, TODAY + 'T11:25');
    });
    // лимит снижен после просрочки — у двух должников долг теперь выше лимита
    const cutIds = new Set<ID>();
    const raiseOthers = (when: ISODateTime): void => {
      for (const c of clients) {
        if (c.seg === 'retail' || c.isNew || cutIds.has(c.id) || c.client.creditLimit <= 0) continue;
        const b = clientBalance(db, c.id);
        if (b.debt <= c.client.creditLimit) continue;
        run('client.update', { clientId: c.id, patch: { creditLimit: Math.ceil((b.debt + 20000) / 10000) * 10000 } }, E.owner, when);
      }
    };
    on(plusDays(TODAY, -3) + 'T11:00', () => {
      const when = plusDays(TODAY, -3) + 'T11:00';
      // неоплаченный счёт должника не закроется до сегодня — долг останется выше нового лимита
      const stuckDebt = (cid: ID): number => {
        const o = get(db, 'orders', stuck.get(cid) ?? '');
        return o ? orderPayment(db, o).debt : 0;
      };
      const cut = clients
        .filter((c) => c.seg !== 'retail' && !c.isNew && c.client.creditLimit > 0 && stuckDebt(c.id) >= 11000)
        .sort((a, b) => stuckDebt(b.id) - stuckDebt(a.id))
        .slice(0, 2);
      for (const c of cut) cutIds.add(c.id);
      raiseOthers(when); // остальным, у кого долг выше лимита, лимит подняли
      for (const c of cut) {
        const limit = Math.max(10000, Math.floor((stuckDebt(c.id) * 0.9) / 10000) * 10000);
        run('client.update', { clientId: c.id, patch: { creditLimit: limit, note: 'Лимит снижен после просрочки — новые заказы через владельца' } }, E.owner, when);
      }
    });
    // утром владелец пересмотрел лимиты: сверх лимита остаются только должники со сниженным лимитом
    on(TODAY + 'T08:50', () => raiseOthers(TODAY + 'T08:50'));
    // должники продолжают брать товар: владелец разрешает отгрузку, если после просрочки заказов не было
    on(plusDays(TODAY, -3) + 'T10:15', () => {
      let i = 0;
      for (const [cid, oid] of stuck) {
        const cm = cmById.get(cid);
        const so = get(db, 'orders', oid);
        if (!cm || !so?.dueDate) continue;
        if (db.orders.some((o) => o.clientId === cid && o.state !== 'cancelled' && o.createdAt.slice(0, 10) > so.dueDate!)) continue;
        const t = at(plusDays(TODAY, -3), 10 * 60 + 15 + 7 * i++);
        sched(t, () => {
          const lines = buildLines(cm, t.slice(0, 10));
          if (!lines.length) return;
          const r = run(
            'order.create',
            { clientId: cid, state: 'confirmed', source: 'phone', lines, fulfillment: rng.chance(deliveryProb(cm, t.slice(0, 10))) ? 'delivery' : 'pickup', comment: 'Отгрузка разрешена владельцем: клиент обещал закрыть долг', override: true },
            E.owner,
            t,
          );
          if (r?.id) onConfirmed(r.id, cm, t);
        });
      }
    });
    // сегодня менеджеры принимают заказы по телефону — они собираются
    for (const [hhmm, k] of [['10:40', 0], ['12:35', 1]] as const) {
      on(TODAY + 'T' + hhmm, () => {
        const pool = clients.filter((c) => c.seg !== 'retail' && !c.isNew && !lapsedFrom.has(c.id) && cmById.has(c.id) && clientBalance(db, c.id).overdue === 0 && (c.seg === 'horeca' || c.seg === 'cleaning' || c.seg === 'shop'));
        const cm = pool[(k * 7 + 3) % pool.length];
        if (cm) managerOrder(cm, TODAY + 'T' + hhmm, k === 1 ? 'chat' : 'phone');
      });
    }
    // свежие возвраты — ещё на проверке
    on(plusDays(TODAY, -2) + 'T15:40', () => orderReturn(plusDays(TODAY, -2) + 'T15:40'));
    on(YESTERDAY + 'T16:20', () => orderReturn(YESTERDAY + 'T16:20'));
    // вчера вечером — дополнительные заказы на сегодняшнюю доставку
    on(YESTERDAY + 'T17:30', () => {
      const count = db.deliveries.filter((x) => x.date === TODAY).length;
      const need = Math.max(0, 15 - count);
      const base = clients.filter((c) => c.seg !== 'retail' && c.seg !== 'market' && !c.isNew && !lapsedFrom.has(c.id) && clientBalance(db, c.id).overdue === 0);
      const pool = [...rng.shuffle(base.filter((c) => c.client.deferDays === 0)), ...rng.shuffle(base.filter((c) => c.client.deferDays > 0))];
      for (let i = 0; i < need && i < pool.length; i++) {
        const cm = pool[i];
        const tt = at(YESTERDAY, 17 * 60 + 31 + i * 3);
        sched(tt, () => managerOrder(cm, tt, 'phone'));
      }
    });
  }

  function priceChange(p: Product, x: number, when: ISODateTime): void {
    const retail = roundRetail(p.retailPrice * (1 + x));
    let wholesale = Math.round(p.wholesalePrice * (1 + x));
    if (wholesale > retail) wholesale = retail - 1;
    if (retail === p.retailPrice) return;
    run('price.set', { productId: p.id, retailPrice: retail, wholesalePrice: wholesale }, E.owner, when);
  }

  function writeoff(when: ISODateTime, reason: WriteoffReason): void {
    const loc: 'shop' | 'warehouse' = rng.chance(0.3) ? 'shop' : 'warehouse';
    const n = rng.int(1, 3);
    const lines: { productId: ID; qty: number; reason: WriteoffReason }[] = [];
    const pool = activeIdx
      .map((m) => P[m.index])
      .filter((p) => p.active && avail(p.id, loc) >= 3 && (reason !== 'expired' || p.expiryTracked) && (reason !== 'leak' || / (мл|л)$/.test(p.volume ?? '')));
    for (const p of rng.sample(pool, n)) lines.push({ productId: p.id, qty: Math.min(avail(p.id, loc) - 1, rng.int(1, 4)), reason });
    if (!lines.length) return;
    const comment = { leak: 'Протекли при разгрузке', damage: 'Повреждены при перемещении', expired: 'Истёк срок годности', shortage: 'Недостача по итогам проверки полки', supplier_return: 'Возврат поставщику', other: '' }[reason];
    run('stock.writeoff', { location: loc, lines, comment }, E.ibragimov, when);
  }

  function countDoc(loc: 'shop' | 'warehouse', cats: string[], when: ISODateTime): void {
    const fam = new Set<string>();
    for (const c of db.categories) if (cats.includes(c.id) || (c.parentId && cats.includes(c.parentId))) fam.add(c.id);
    const lines: { productId: ID; qty: number }[] = [];
    for (const p of P) {
      if (!fam.has(p.categoryId)) continue;
      const r = stockRow(db, p.id, loc);
      if (!r || r.onHand <= 0) continue;
      let fact = r.onHand;
      if (rng.chance(0.08)) fact = Math.max(r.reserved, fact + rng.pick([-3, -2, -1, -1, 1, 2]));
      lines.push({ productId: p.id, qty: fact });
    }
    if (lines.length) run('stock.count', { location: loc, lines, comment: loc === 'shop' ? 'Пересчёт магазина: мыло, гигиена, бумага' : 'Пересчёт склада: освежители, губки и тряпки' }, E.ibragimov, when);
  }

  function orderReturn(when: ISODateTime): void {
    const d = when.slice(0, 10);
    const from = plusDays(d, -20);
    const to = plusDays(d, -2);
    const shippedAt = (o: Order): string => o.history.find((h) => h.text.startsWith('Отгружен'))?.at.slice(0, 10) ?? '';
    const cands = db.orders.filter((o) => {
      if (o.state !== 'closed' || o.lines.length < 3) return false;
      const sd = shippedAt(o);
      return sd >= from && sd <= to;
    });
    if (!cands.length) return;
    const o = rng.pick(cands);
    const n = rng.int(1, 2);
    const back = orderReturns(db).get(o.id)?.byProduct;
    const lines = rng
      .sample(o.lines, n)
      .map((l) => ({
        productId: l.productId,
        qty: Math.min(l.shipped - (back?.get(l.productId) ?? 0), l.pack === 'pcs' ? rng.int(1, 3) : l.packSize),
        reason: rng.weighted(['defect', 'wrong_item', 'expired', 'not_fit'] as const, [30, 25, 10, 35]),
      }))
      .filter((l) => l.qty > 0);
    if (!lines.length) return;
    const pay = orderPayment(db, o);
    const refund = pay.state === 'paid' && rng.chance(0.6);
    run('return.create', { orderId: o.id, lines, refund, method: 'transfer', comment: refund ? 'Вернули деньги переводом' : '' }, refund ? E.omarov : E.ibragimov, when);
  }

  /** Решения по товару на проверке: вернуть в продажу или списать. */
  const quarantineDecisions = (d: ISODate, t: ISODateTime): void => {
    const keepFrom = plusDays(TODAY, -6);
    for (const item of db.quarantine) {
      if (item.state !== 'check') continue;
      const created = item.createdAt.slice(0, 10);
      if (created >= keepFrom) continue;
      if (dayNum(d) - dayNum(created) < 2 + (item.id.length % 3)) continue;
      const roll = item.source === 'purchase_defect' || rng.chance(item.source === 'delivery_failed' ? 0.05 : 0.18);
      // брак, истёкший срок и «другое» — только списание; целый товар возвращается в продажу
      const writeOff = !quarantineCanRelease(item);
      void roll; // не доставленный товар целый — возвращается в продажу
      if (writeOff) {
        const expired = item.reason === RETURN_REASONS.expired;
        const comment =
          item.source === 'purchase_defect'
            ? 'Брак — возврат поставщику'
            : expired
              ? 'Истёк срок годности — в продажу нельзя'
              : item.reason === RETURN_REASONS.defect
                ? 'Брак подтверждён при проверке'
                : `С проверки: ${item.reason}`;
        run('quarantine.writeoff', { itemId: item.id, reason: expired ? 'expired' : 'damage', comment }, E.ibragimov, t);
      } else run('quarantine.release', { itemId: item.id }, E.ibragimov, t);
    }
  };

  /* ---------- день за днём ---------- */
  for (const m of clients) {
    if (m.seg === 'retail' || m.isNew) continue;
    if (MANAGERS.includes(m.owner as (typeof MANAGERS)[number])) nextMgrOrder.set(m.id, dayNum(START) + rng.int(0, m.cadence - 1));
  }

  for (let n = dayNum(START); n <= dayNum(TODAY); n++) {
    const d = isoDay(n);
    q.push(at(d, 0), () => planDay(d));
  }
  for (const o of once) sched(o.at, o.fn);
  started = true;

  function planDay(d: ISODate): void {
    db.meta.today = d; // просрочка и сроки считаются от текущего дня симуляции
    db.meta.version++;
    const wd = dow(d);
    shiftDay(d);
    if (wd === 1 || wd === 3 || wd === 5) {
      const t = at(d, 7 * 60 + 40);
      sched(t, () => restockShop(d, t));
    }
    if ((wd === 2 || wd === 4 || wd === 6) && d !== START) {
      const t = at(d, 8 * 60 + 10);
      sched(t, () => {
        const cash = accountBalances(db).shop_cash;
        const amount = Math.floor((cash - 15000) / 1000) * 1000;
        if (amount >= 20000) run('payment.transfer', { from: 'shop_cash', to: 'bank', amount, comment: 'Инкассация' }, officeDay(d) ? E.suleymanova : sellerOn(d), t);
      });
    }
    if (workday(d)) {
      const td = at(d, 8 * 60 + 5);
      sched(td, () => dispatchDay(d, td));
      for (const bt of isSat(d) ? [10 * 60 + 30] : [10 * 60 + 30, 16 * 60]) {
        if (d === TODAY) continue; // сегодня утром менеджеры на планёрке — заявки ждут подтверждения
        const t = at(d, bt);
        sched(t, () => confirmBatch(d, t));
      }
      const tq = at(d, 15 * 60 + 10);
      sched(tq, () => quarantineDecisions(d, tq));
      handIn(d);
    }
    if (officeDay(d)) {
      const t = at(d, 10 * 60 + 5);
      sched(t, () => {
        for (const p of db.payments) {
          if (p.status !== 'pending' || p.at.slice(0, 10) >= d) continue;
          run('payment.confirm', { paymentId: p.id }, E.suleymanova, t);
        }
      });
    }
    if (fieldDay(d)) planVisits(d);
    // заказы клиентов менеджеров
    if (workday(d)) {
      let i = 0;
      for (const [cid, next] of nextMgrOrder) {
        if (next > dayNum(d)) continue;
        const cm = cmById.get(cid);
        if (!cm) continue;
        if (isSat(d) && rng.chance(0.5)) continue;
        const t = at(d, 9 * 60 + 30 + rng.int(0, 400) + i++);
        sched(t, () => managerOrder(cm, t));
        nextMgrOrder.set(cid, dayNum(d) + Math.max(5, Math.round(cm.cadence * rng.float(0.8, 1.25))));
      }
      // изредка клиенты представителей звонят сами
      if (!isSat(d)) {
        for (const cm of clients) {
          if (cm.seg === 'retail' || !cmById.has(cm.id) || MANAGERS.includes(cm.owner as (typeof MANAGERS)[number])) continue;
          const last = lastOrderDay.get(cm.id) ?? dayNum(START) - rng.int(0, 10);
          if (dayNum(d) - last > cm.cadence * 1.6 && rng.chance(0.03)) {
            const t = at(d, 10 * 60 + rng.int(0, 360));
            sched(t, () => managerOrder(cm, t, 'phone'));
          }
        }
      }
    }
    // закупки по циклу поставщика (последние — так, чтобы успели прийти до сегодня)
    for (const key of supplierKeys) {
      if (nextPurchase.get(key)! > dayNum(d) || !officeDay(d)) continue;
      const s = get(db, 'suppliers', input.supplierIds.get(key)!)!;
      if (dayNum(d) + s.leadDays >= dayNum(TODAY) - 1) continue;
      const t = at(d, 9 * 60 + 15);
      sched(t, () => makePurchase(key, t, 'normal'));
      nextPurchase.set(key, dayNum(d) + prng.int(16, 21));
    }
  }

  // главный цикл
  for (;;) {
    const ev = q.peek();
    if (!ev || ev.at > CUTOFF) break;
    q.pop();
    ev.fn();
  }
  db.meta.today = TODAY;
  db.meta.version++;
  stats.stuck = [...overdueSet].map((id) => [id, stuck.get(id) ?? null]);
  return stats;
}

