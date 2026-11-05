/* Доставка: общие расчёты раздела — день, опоздание, загрузка курьеров, ссылки на карты. */
import type { Client, DB, Delivery, DeliveryState, Employee, ID, ISODate, Order, PayMethod } from '../../data/types';
import { nowDemo } from '../../data/store';
import { fmt } from '../../ui';

/** Интервалы, которые предлагаем при оформлении и переносе. */
export const INTERVALS = ['09:00–12:00', '10:00–13:00', '10:00–14:00', '11:00–14:00', '12:00–15:00', '14:00–17:00', '15:00–18:00', '17:00–20:00'];

/** Причины, если курьер получил меньше, чем к получению. */
export const LESS_REASONS = ['Клиент доплатит позже', 'Часть товара не взяли', 'Скидка по согласованию', 'Не хватило денег у клиента'] as const;

/** Состояния, которые ещё требуют работы. */
export const OPEN_STATES: DeliveryState[] = ['waiting', 'assigned', 'on_way', 'failed'];
export const isOpen = (d: Delivery): boolean => OPEN_STATES.includes(d.state);
export const isDone = (d: Delivery): boolean => d.state === 'delivered' || d.state === 'returned';

/* ---------- время ---------- */

/** «Сейчас» демо как 'YYYY-MM-DDTHH:mm'. */
export function nowIso(): string {
  const n: unknown = nowDemo();
  if (typeof n === 'string') return n.length >= 16 ? n.slice(0, 16) : n + 'T12:00';
  if (n instanceof Date) {
    const p = (x: number) => String(x).padStart(2, '0');
    return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}T${p(n.getHours())}:${p(n.getMinutes())}`;
  }
  return new Date().toISOString().slice(0, 16);
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function intervalStart(iv: string): number {
  return minutesOf(iv.split('–')[0] ?? '00:00');
}
export function intervalEnd(iv: string): number {
  return minutesOf(iv.split('–')[1] ?? '23:59');
}

export interface Clock {
  today: ISODate;
  tomorrow: ISODate;
  nowMin: number;
}

export function clockOf(db: DB): Clock {
  const now = nowIso();
  const today = db.meta.today;
  const nowMin = now.slice(0, 10) === today ? minutesOf(now.slice(11, 16)) : now.slice(0, 10) > today ? 24 * 60 : 0;
  return { today, tomorrow: fmt.addDays(today, 1), nowMin };
}

/** Опоздание: интервал прошёл, а доставка не вручена. */
export function lateOf(d: Delivery, c: Clock): { label: string; minutes: number } | null {
  if (d.state !== 'waiting' && d.state !== 'assigned' && d.state !== 'on_way') return null;
  if (d.date > c.today) return null;
  if (d.date < c.today) {
    const days = fmt.daysBetween(d.date, c.today);
    return { label: `Опоздание ${days} дн.`, minutes: days * 24 * 60 };
  }
  const m = c.nowMin - intervalEnd(d.interval);
  if (m <= 0) return null;
  return { label: `Опоздание ${durationText(m)}`, minutes: m };
}

export function durationText(m: number): string {
  if (m < 60) return `${m} мин`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} ч ${r} мин` : `${h} ч`;
}

/** Время, когда доставку вручили, — по последней удачной попытке. */
export function deliveredAt(d: Delivery): string | null {
  for (let i = d.attempts.length - 1; i >= 0; i--) if (d.attempts[i].result === 'delivered') return d.attempts[i].at;
  return null;
}

export function lastFail(d: Delivery): { at: string; reason: string } | null {
  for (let i = d.attempts.length - 1; i >= 0; i--) {
    const a = d.attempts[i];
    if (a.result === 'failed') return { at: a.at, reason: a.reason ?? 'Причина не указана' };
  }
  return null;
}

/* ---------- день ---------- */

export function dayLabel(day: ISODate, c: Clock): string {
  if (day === c.today) return 'Сегодня';
  if (day === c.tomorrow) return 'Завтра';
  if (day === fmt.addDays(c.today, -1)) return 'Вчера';
  return fmt.date(day);
}

/** Доставки дня. На сегодня добавляем незакрытые с прошлых дней — они опаздывают и ждут решения. */
export function forDay(list: Delivery[], day: ISODate, c: Clock): Delivery[] {
  if (day !== c.today) return list.filter((d) => d.date === day);
  return list.filter((d) => d.date === day || (d.date < day && isOpen(d)));
}

/** Порядок маршрута: сначала по порядку курьера, потом по началу интервала. */
export function byRoute(a: Delivery, b: Delivery): number {
  return a.routeOrder - b.routeOrder || intervalStart(a.interval) - intervalStart(b.interval) || a.number - b.number;
}

/* ---------- курьеры ---------- */

export function couriersOf(db: DB): Employee[] {
  return db.employees.filter((e) => e.active && e.roles.includes('courier'));
}

export interface CourierLoad {
  courier: Employee;
  list: Delivery[]; // точки дня по маршруту (без возвращённых на склад)
  points: number;
  places: number;
  kg: number;
  collect: number;
  done: number; // вручено
  failed: number;
  left: number; // назначена или в пути
  districts: string[];
}

export function loadOf(db: DB, courier: Employee, day: ISODate, c: Clock): CourierLoad {
  const list = forDay(db.deliveries, day, c)
    .filter((d) => d.courierId === courier.id && d.state !== 'returned' && d.state !== 'waiting')
    .sort(byRoute);
  let places = 0;
  let kg = 0;
  let collect = 0;
  let done = 0;
  let failed = 0;
  const ds = new Set<string>();
  for (const d of list) {
    places += d.places;
    kg += d.weightKg;
    if (d.state !== 'delivered') collect += d.collect;
    if (d.state === 'delivered') done++;
    if (d.state === 'failed') failed++;
    ds.add(shortDistrict(d.district));
  }
  return { courier, list, points: list.length, places, kg: Math.round(kg), collect, done, failed, left: list.length - done - failed, districts: [...ds] };
}

export function loadsOf(db: DB, day: ISODate, c: Clock): CourierLoad[] {
  return couriersOf(db).map((e) => loadOf(db, e, day, c));
}

export function loadText(l: Pick<CourierLoad, 'points' | 'places' | 'kg'>): string {
  return `${fmt.count(l.points, 'точка', 'точки', 'точек')} · ${fmt.count(l.places, 'место', 'места', 'мест')} · ${fmt.num(l.kg)} кг`;
}

/** Кого предложить: курьер, у которого уже есть точки в этом районе, иначе самый свободный. */
export function suggestCourier(loads: CourierLoad[], district: string): ID | null {
  if (!loads.length) return null;
  const sd = shortDistrict(district);
  const scored = loads.map((l) => ({ id: l.courier.id, same: l.list.filter((d) => shortDistrict(d.district) === sd).length, points: l.points }));
  scored.sort((a, b) => (b.same > 0 ? 1 : 0) - (a.same > 0 ? 1 : 0) || a.points - b.points || b.same - a.same);
  return scored[0].id;
}

export function shortDistrict(d: string): string {
  return d.replace(/\s*район$/i, '');
}

/* ---------- деньги курьера ---------- */

export interface CourierDay {
  cash: number; // получено наличными за день
  card: number; // картой и переводом за день
  handedToday: number; // сдано в кассу за день
  onHand: number; // на руках всего, не сдано
  list: Delivery[]; // доставки дня с деньгами
}

export function moneyOfDay(db: DB, courierId: ID, day: ISODate, onHand: number): CourierDay {
  let cash = 0;
  let card = 0;
  const list: Delivery[] = [];
  for (const d of db.deliveries) {
    if (d.courierId !== courierId || d.collected <= 0) continue;
    const at = deliveredAt(d);
    if (!at || at.slice(0, 10) !== day) continue;
    if (d.collectedMethod === 'cash') cash += d.collected;
    else card += d.collected;
    list.push(d);
  }
  let handedToday = 0;
  for (const p of db.payments) {
    if (p.kind !== 'transfer' || p.account !== 'courier_cash' || p.at.slice(0, 10) !== day || !p.deliveryId) continue;
    const d = db.deliveries.find((x) => x.id === p.deliveryId);
    if (d?.courierId === courierId) handedToday += p.amount;
  }
  list.sort((a, b) => (deliveredAt(a) ?? '').localeCompare(deliveredAt(b) ?? ''));
  return { cash, card, handedToday, onHand, list };
}

/** Доставки курьера с наличными, которые ещё не сданы. */
export function notHandedIn(db: DB, courierId: ID): Delivery[] {
  return db.deliveries
    .filter((d) => d.courierId === courierId && d.collectedMethod === 'cash' && d.collected > 0 && !d.handedIn)
    .sort((a, b) => (deliveredAt(a) ?? '').localeCompare(deliveredAt(b) ?? ''));
}

/** С какого дня у курьера на руках несданные наличные; null — на руках ничего. */
export function onHandSince(db: DB, courierId: ID): ISODate | null {
  let since: ISODate | null = null;
  for (const d of notHandedIn(db, courierId)) {
    const day = (deliveredAt(d) ?? d.date).slice(0, 10);
    if (!since || day < since) since = day;
  }
  return since;
}

/** «На руках» или «На руках, с 4 ноября» — если среди несданных есть деньги прошлых дней. */
export function onHandLabel(since: ISODate | null, today: ISODate): string {
  return since && since < today ? `На руках, с ${fmt.date(since)}` : 'На руках';
}

const BY_METHOD: Record<PayMethod, string> = { cash: 'наличными', card: 'картой', transfer: 'переводом' };

/** Деньги по вручённой доставке: «получено наличными 14 485 ₽», «оплата по отсрочке», «оплачено заранее». */
export function deliveredMoneyText(d: Delivery, client: Client | undefined): string {
  if (d.collected > 0) return `получено ${BY_METHOD[d.collectedMethod ?? 'cash']} ${fmt.money(d.collected)}`;
  if (d.collect > 0) return 'деньги не получены';
  return client && client.deferDays > 0 ? 'оплата по отсрочке' : 'оплачено заранее';
}

/* ---------- ссылки ---------- */

export function mapUrl(d: Pick<Delivery, 'lat' | 'lng'>): string {
  return `https://yandex.ru/maps/?pt=${d.lng},${d.lat}&z=17&l=map`;
}

export function routeUrl(list: Pick<Delivery, 'lat' | 'lng'>[]): string {
  return `https://yandex.ru/maps/?rtext=${list.map((d) => `${d.lat},${d.lng}`).join('~')}&rtt=auto`;
}

export function telUrl(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  return `tel:${digits.startsWith('+') ? digits : '+' + digits}`;
}

/* ---------- прочее ---------- */

export function orderNo(o: Order | undefined): string {
  return o ? `№ ${o.number}` : '—';
}

export function placesText(n: number): string {
  return fmt.count(n, 'место', 'места', 'мест');
}

export function kgText(n: number): string {
  return `${fmt.num(Math.round(n * 10) / 10, Number.isInteger(Math.round(n * 10) / 10) ? 0 : 1)} кг`;
}
