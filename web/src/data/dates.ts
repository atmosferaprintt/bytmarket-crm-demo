/* Быстрые даты для слоя данных. Считаем в днях от 1970-01-01 по UTC, без часовых поясов:
   'YYYY-MM-DD' ↔ номер дня, 'YYYY-MM-DDTHH:mm' ↔ дата + минуты. */
import type { ISODate, ISODateTime } from './types';

const MS_DAY = 86_400_000;
const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n));

const isoCache = new Map<number, string>();

/** Номер дня по дате 'YYYY-MM-DD' (можно передать и дату со временем). */
export function dayNum(iso: string): number {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  const d = +iso.slice(8, 10);
  return Math.round(Date.UTC(y, m - 1, d) / MS_DAY);
}

/** Дата 'YYYY-MM-DD' по номеру дня. */
export function isoDay(n: number): ISODate {
  let s = isoCache.get(n);
  if (s === undefined) {
    const dt = new Date(n * MS_DAY);
    s = `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
    isoCache.set(n, s);
  }
  return s;
}

export function plusDays(iso: string, k: number): ISODate {
  return isoDay(dayNum(iso) + k);
}

/** b − a в днях. */
export function diffDays(a: string, b: string): number {
  return dayNum(b) - dayNum(a);
}

/** День недели: 0 — воскресенье, 1 — понедельник … 6 — суббота. */
export function dow(iso: string): number {
  return (((dayNum(iso) + 4) % 7) + 7) % 7; // 1970-01-01 — четверг
}

export function dateOf(at: string): ISODate {
  return at.slice(0, 10);
}

/** Минуты от начала суток для 'YYYY-MM-DDTHH:mm' или 'HH:mm'. */
export function minutesOf(atOrTime: string): number {
  const t = atOrTime.length > 5 ? atOrTime.slice(11, 16) : atOrTime;
  return +t.slice(0, 2) * 60 + +t.slice(3, 5);
}

export function hhmm(minutes: number): string {
  const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(minutes)));
  return pad2(Math.floor(m / 60)) + ':' + pad2(m % 60);
}

/** 'YYYY-MM-DDTHH:mm' из даты и минут от начала суток. */
export function atTime(date: ISODate, minutes: number): ISODateTime {
  return date + 'T' + hhmm(minutes);
}

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function firstOfMonth(iso: string): ISODate {
  return iso.slice(0, 7) + '-01';
}

export function lastOfMonth(iso: string): ISODate {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7);
  return isoDay(Math.round(Date.UTC(y, m, 0) / MS_DAY));
}

/** Дата + k месяцев с ограничением по последнему дню месяца. */
export function plusMonths(iso: string, k: number): ISODate {
  const y = +iso.slice(0, 4);
  const m = +iso.slice(5, 7) - 1 + k;
  const d = +iso.slice(8, 10);
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
  return `${yy}-${pad2(mm + 1)}-${pad2(Math.min(d, last))}`;
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «5 ноября» — для текстов истории и журнала. */
export function dayText(iso: string): string {
  return `${+iso.slice(8, 10)} ${MONTHS_GEN[+iso.slice(5, 7) - 1]}`;
}
