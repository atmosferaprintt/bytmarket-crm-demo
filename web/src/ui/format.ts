/* Единые форматы. Деньги «12 400 ₽», в итогах без копеек; даты «5 ноября», «05.11»; проценты «32,4 %».
   Неразрывные пробелы: между разрядами и перед ₽ и % — U+00A0. */

const NB = ' ';
const THIN = ' '; // узкий U+202F в Manrope почти не виден — разряды сливались

function groupDigits(intStr: string): string {
  return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

/** Целое число с разрядами: 12 400 */
export function num(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  const fixed = abs.toFixed(digits);
  const [i, f] = fixed.split('.');
  return sign + groupDigits(i) + (f ? ',' + f : '');
}

/** Деньги без копеек: 12 400 ₽ */
export function money(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return num(Math.round(value)) + NB + '₽';
}

/** Деньги с копейками, только если они есть: 137,75 ₽ / 140 ₽ */
export function price(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const rounded = Math.round(value * 100) / 100;
  return num(rounded, Number.isInteger(rounded) ? 0 : 2) + NB + '₽';
}

/** Короткие деньги для плиток и графиков: 4,2 млн ₽ / 860 тыс. ₽ */
export function moneyShort(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000) return sign + num(abs / 1_000_000, abs >= 10_000_000 ? 0 : 1).replace(',0', '') + NB + 'млн' + NB + '₽';
  if (abs >= 10_000) return sign + num(Math.round(abs / 1000)) + NB + 'тыс.' + NB + '₽';
  return money(value);
}

/** Процент: 32,4 % */
export function pct(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return '—';
  const s = num(value, digits).replace(/,0+$/, '');
  return s + NB + '%';
}

/** Изменение со знаком: +12,4 % / −3 % */
export function delta(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return '—';
  const s = pct(Math.abs(value), digits);
  if (Math.abs(value) < 0.05) return '0' + NB + '%';
  return (value > 0 ? '+' : '−') + s;
}

/** Количество штук: 36 шт */
export function qty(value: number | null | undefined, unit = 'шт'): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return num(value) + NB + unit;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const WEEKDAYS_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function parts(iso: string): { y: number; m: number; d: number; hh: string | null; mm: string | null } {
  const [date, time] = iso.split('T');
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time ? time.split(':') : [null, null];
  return { y, m, d, hh, mm };
}

export function toDate(iso: string): Date {
  const p = parts(iso);
  return new Date(p.y, p.m - 1, p.d, Number(p.hh ?? 0), Number(p.mm ?? 0));
}

/** «5 ноября» (год — только если не текущий год демо) */
export function date(iso: string | null | undefined, opts: { year?: boolean } = {}): string {
  if (!iso) return '—';
  const p = parts(iso);
  return `${p.d}${NB}${MONTHS_GEN[p.m - 1]}${opts.year ? NB + p.y : ''}`;
}

/** «05.11» или «05.11.2026» */
export function dateShort(iso: string | null | undefined, withYear = false): string {
  if (!iso) return '—';
  const p = parts(iso);
  const s = `${String(p.d).padStart(2, '0')}.${String(p.m).padStart(2, '0')}`;
  return withYear ? `${s}.${p.y}` : s;
}

/** «14:30» */
export function time(iso: string | null | undefined): string {
  if (!iso) return '—';
  const p = parts(iso);
  return p.hh ? `${p.hh}:${p.mm}` : '—';
}

/** «5 ноября, 14:30» */
export function dateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return `${date(iso)}, ${time(iso)}`;
}

/** «Ноябрь 2026» */
export function monthName(ym: string, withYear = true): string {
  const [y, m] = ym.split('-').map(Number);
  return MONTHS_NOM[m - 1] + (withYear ? NB + y : '');
}

export function weekday(iso: string, short = false): string {
  const d = toDate(iso);
  return (short ? WEEKDAYS_SHORT : WEEKDAYS)[d.getDay()];
}

/** Относительная дата для списков: «сегодня», «вчера», «завтра», иначе «3 ноября» */
export function relDate(iso: string | null | undefined, today: string): string {
  if (!iso) return '—';
  const d = daysBetween(today, iso.slice(0, 10));
  if (d === 0) return 'сегодня';
  if (d === -1) return 'вчера';
  if (d === 1) return 'завтра';
  return date(iso);
}

/** Разница в днях: b − a */
export function daysBetween(a: string, b: string): number {
  const da = toDate(a.slice(0, 10));
  const db = toDate(b.slice(0, 10));
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso.slice(0, 10));
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Склонение: plural(5, 'заказ', 'заказа', 'заказов') → «заказов» */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

/** «5 заказов» */
export function count(n: number, one: string, few: string, many: string): string {
  return `${num(n)}${NB}${plural(n, one, few, many)}`;
}

/** Телефон «+7 917 123-45-67» */
export function phone(raw: string | null | undefined): string {
  if (!raw) return '—';
  const d = raw.replace(/\D/g, '');
  if (d.length !== 11) return raw;
  return `+7${NB}${d.slice(1, 4)}${NB}${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}

/** Инициалы для аватара */
export function initials(name: string): string {
  const words = name.replace(/[«»"]/g, '').split(/[\s·]+/).filter(Boolean);
  return (words[0]?.[0] ?? '') + (words[1]?.[0] ?? '');
}
