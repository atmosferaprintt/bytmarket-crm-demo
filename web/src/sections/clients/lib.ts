/* Клиенты и представители: общие расчёты раздела. Считаются один раз на версию базы. */
import { useCallback, useEffect, useState } from 'react';
import type { Client, ClientPoint, DB, Employee, ID, ISODate, Order, Visit } from '../../data/types';
import { CLIENT_KIND_NAMES, CLIENT_SEGMENT_NAMES } from '../../data/types';
import { clientBalances, indexes, orderReturns, type ClientBalance } from '../../data/selectors';
import { diffDays, firstOfMonth, lastOfMonth, plusDays } from '../../data/dates';

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

/* ---------- ссылки ---------- */

export const mapUrl = (p: Pick<ClientPoint, 'lat' | 'lng'>): string => `https://yandex.ru/maps/?pt=${p.lng},${p.lat}&z=17&l=map`;

export function telUrl(phone: string | null | undefined): string | null {
  if (!phone) return null;
  let d = phone.replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 11 && d[0] === '8') d = '7' + d.slice(1);
  if (d.length === 10) d = '7' + d;
  return 'tel:+' + d;
}

/** Телефон точки для звонка: контакт клиента, иначе общий телефон. */
export function callPhone(c: Client): string | null {
  return c.contacts.find((x) => x.phone)?.phone ?? (c.phone || null);
}

/* ---------- подписи ---------- */

export const kindName = (c: Client): string => CLIENT_KIND_NAMES[c.kind];
export const segmentName = (c: Client): string => CLIENT_SEGMENT_NAMES[c.segment];
export const priceTypeName = (t: Client['priceType']): string => (t === 'wholesale' ? 'Опт' : 'Розница');

export const DISTRICTS: { name: string; lat: number; lng: number }[] = [
  { name: 'Кировский район', lat: 46.3497, lng: 48.0408 },
  { name: 'Советский район', lat: 46.3152, lng: 48.0583 },
  { name: 'Ленинский район', lat: 46.3651, lng: 48.0702 },
  { name: 'Трусовский район', lat: 46.3302, lng: 47.9921 },
];

/* ---------- строки списка клиентов ---------- */

export interface ClientRow {
  c: Client;
  b: ClientBalance;
  owner: Employee | null;
  sales90: number;
  daysSince: number | null;
  /** прошло больше привычной частоты заказа */
  missed: boolean;
  /** давно не заказывали: пропустил привычный заказ или больше 45 дней без покупок */
  stale: boolean;
  overLimit: boolean;
}

/** Продажи клиентам за 90 дней: оптовые заказы (подтверждённые и завершённые) за вычетом возвратов и чеки с карточкой. */
export function sales90(db: DB): Map<ID, number> {
  return memoDB(db, 'sales90', () => {
    const from = plusDays(db.meta.today, -89);
    const m = new Map<ID, number>();
    const add = (id: ID, v: number) => m.set(id, (m.get(id) ?? 0) + v);
    const ret = orderReturns(db);
    for (const o of db.orders) {
      if (o.state !== 'confirmed' && o.state !== 'closed') continue;
      if (o.createdAt.slice(0, 10) < from) continue;
      add(o.clientId, o.total - (ret.get(o.id)?.amount ?? 0));
    }
    for (const r of db.receipts) {
      if (!r.clientId || r.at.slice(0, 10) < from) continue;
      add(r.clientId, r.kind === 'sale' ? r.total : -r.total);
    }
    return m;
  });
}

export function clientRows(db: DB): Map<ID, ClientRow> {
  return memoDB(db, 'clientRows', () => {
    const bal = clientBalances(db);
    const s90 = sales90(db);
    const emp = indexes(db).employees;
    const today = db.meta.today;
    const out = new Map<ID, ClientRow>();
    for (const c of db.clients) {
      const b = bal.get(c.id)!;
      const daysSince = b.lastOrderAt ? diffDays(b.lastOrderAt.slice(0, 10), today) : null;
      const missed = !!c.orderEveryDays && daysSince !== null && daysSince > c.orderEveryDays;
      const stale = missed || (c.orderEveryDays === null && c.segment !== 'retail' && (daysSince === null || daysSince > 45));
      out.set(c.id, {
        c,
        b,
        owner: c.ownerId ? emp.get(c.ownerId) ?? null : null,
        sales90: s90.get(c.id) ?? 0,
        daysSince,
        missed,
        stale,
        overLimit: c.creditLimit > 0 && b.debt > c.creditLimit,
      });
    }
    return out;
  });
}

/** Последний заказ или чек клиента: дата и сумма. */
export function lastPurchases(db: DB): Map<ID, { at: string; total: number; orderId: ID | null }> {
  return memoDB(db, 'lastPurchases', () => {
    const m = new Map<ID, { at: string; total: number; orderId: ID | null }>();
    for (const o of db.orders) {
      if (o.state === 'cancelled' || o.state === 'draft') continue;
      const cur = m.get(o.clientId);
      if (!cur || o.createdAt > cur.at) m.set(o.clientId, { at: o.createdAt, total: o.total, orderId: o.id });
    }
    for (const r of db.receipts) {
      if (!r.clientId || r.kind !== 'sale') continue;
      const cur = m.get(r.clientId);
      if (!cur || r.at > cur.at) m.set(r.clientId, { at: r.at, total: r.total, orderId: null });
    }
    return m;
  });
}

/** Заказы по клиенту, новые первыми. */
export function ordersByClient(db: DB): Map<ID, Order[]> {
  return memoDB(db, 'ordersByClient', () => {
    const m = new Map<ID, Order[]>();
    for (const o of db.orders) {
      let a = m.get(o.clientId);
      if (!a) m.set(o.clientId, (a = []));
      a.push(o);
    }
    for (const a of m.values()) a.sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    return m;
  });
}

/** Визиты по клиенту. */
export function visitsByClient(db: DB): Map<ID, Visit[]> {
  return memoDB(db, 'visitsByClient', () => {
    const m = new Map<ID, Visit[]>();
    for (const v of db.visits) {
      let a = m.get(v.clientId);
      if (!a) m.set(v.clientId, (a = []));
      a.push(v);
    }
    for (const a of m.values()) a.sort((x, y) => (y.date + y.time).localeCompare(x.date + x.time));
    return m;
  });
}

/** Заказы, к которым уже привязан визит. */
export function linkedOrderIds(db: DB): Set<ID> {
  return memoDB(db, 'linkedOrders', () => {
    const s = new Set<ID>();
    for (const v of db.visits) if (v.orderId) s.add(v.orderId);
    return s;
  });
}

export function pointOf(c: Client | undefined, pointId: ID | null): ClientPoint | null {
  if (!c) return null;
  return c.points.find((p) => p.id === pointId) ?? c.points[0] ?? null;
}

/* ---------- представители ---------- */

export interface RepStats {
  rep: Employee;
  plan: number;
  /** заказы и заявки клиентов представителя за месяц (без черновиков и отмен) */
  fact: number;
  planPct: number | null;
  /** где должны быть к сегодняшнему дню, % плана */
  expectedPct: number;
  /** темп: факт к плану на сегодня; 1 — идём по графику */
  pace: number | null;
  todayTotal: number;
  todayDone: number;
  monthDone: number;
  monthWithOrder: number;
  orderShare: number | null;
  clients: number;
  points: number;
  requestsToday: number;
  requestsTodaySum: number;
}

export function repList(db: DB): Employee[] {
  return db.employees.filter((e) => e.active && e.roles.includes('rep'));
}

export function repStats(db: DB, rep: Employee): RepStats {
  return memoDB(db, 'repStats|' + rep.id, () => {
    const today = db.meta.today;
    const month = today.slice(0, 7);
    const from = firstOfMonth(today);
    const plan = db.plans.find((p) => p.month === month && p.employeeId === rep.id)?.amount ?? 0;
    let fact = 0;
    for (const o of db.orders) {
      if (o.ownerId !== rep.id || o.state === 'cancelled' || o.state === 'draft') continue;
      const d = o.createdAt.slice(0, 10);
      if (d >= from && d <= today) fact += o.total;
    }
    const daysInMonth = diffDays(from, lastOfMonth(today)) + 1;
    const share = (diffDays(from, today) + 1) / daysInMonth;
    let todayTotal = 0;
    let todayDone = 0;
    let monthDone = 0;
    let monthWithOrder = 0;
    for (const v of db.visits) {
      if (v.repId !== rep.id) continue;
      if (v.date === today) {
        todayTotal++;
        if (v.state === 'done') todayDone++;
      }
      if (v.date >= from && v.date <= today && v.state === 'done') {
        monthDone++;
        if (v.result === 'order') monthWithOrder++;
      }
    }
    let clients = 0;
    let points = 0;
    for (const c of db.clients) {
      if (c.ownerId !== rep.id || !c.active) continue;
      clients++;
      points += c.points.length;
    }
    let requestsToday = 0;
    let requestsTodaySum = 0;
    for (const o of db.orders) {
      if (o.authorId !== rep.id || o.state === 'cancelled' || o.state === 'draft') continue;
      if (o.createdAt.slice(0, 10) !== today) continue;
      requestsToday++;
      requestsTodaySum += o.total;
    }
    return {
      rep,
      plan,
      fact,
      planPct: plan > 0 ? (fact / plan) * 100 : null,
      expectedPct: share * 100,
      pace: plan > 0 ? fact / (plan * share) : null,
      todayTotal,
      todayDone,
      monthDone,
      monthWithOrder,
      orderShare: monthDone > 0 ? (monthWithOrder / monthDone) * 100 : null,
      clients,
      points,
      requestsToday,
      requestsTodaySum,
    };
  });
}

/** Итоги визитов за период: по результатам и причинам отказа. */
export function visitSummary(db: DB, from: ISODate, to: ISODate, repId: ID | null) {
  return memoDB(db, `visitSummary|${from}|${to}|${repId ?? ''}`, () => {
    const results = { order: 0, callback: 0, refusal: 0, missed: 0 };
    const reasons = new Map<string, number>();
    for (const v of db.visits) {
      if (v.date < from || v.date > to) continue;
      if (repId && v.repId !== repId) continue;
      if (v.state === 'missed') results.missed++;
      if (v.state !== 'done' || !v.result) continue;
      results[v.result]++;
      if (v.result === 'refusal') {
        const r = v.refusalReason || 'Другое';
        reasons.set(r, (reasons.get(r) ?? 0) + 1);
      }
    }
    return { results, reasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]) };
  });
}

/* ---------- телефон и запоминание в браузере ---------- */

export function useIsPhone(): boolean {
  const q = '(max-width: 760px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const h = () => setPhone(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return phone;
}

/** Состояние, которое переживает перезагрузку страницы (только показ, не данные магазина). */
export function useStored<T>(key: string, initial: T): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const v = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        try {
          localStorage.setItem(key, JSON.stringify(v));
        } catch {
          /* не запомним — не страшно */
        }
        return v;
      });
    },
    [key],
  );
  return [value, set];
}

/** Тон по темпу выполнения плана. */
export function paceTone(pace: number | null): 'ok' | 'warn' | 'bad' | 'info' {
  if (pace === null) return 'info';
  if (pace >= 0.95) return 'ok';
  if (pace >= 0.75) return 'warn';
  return 'bad';
}
