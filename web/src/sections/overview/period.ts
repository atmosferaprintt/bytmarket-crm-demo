/* Период для обзора и отчётов: вид (день, неделя, месяц, квартал) и дата внутри него. Стрелки сдвигают на один период. */
import { useEffect, useState } from 'react';
import type { ISODate } from '../../data/types';
import type { DateRange, PeriodKind } from '../../data/selectors';
import { previousRange } from '../../data/selectors';
import { dow, firstOfMonth, lastOfMonth, plusDays, plusMonths } from '../../data/dates';

export interface PeriodState {
  kind: PeriodKind;
  anchor: ISODate;
}

/** Период по умолчанию для обзора и отчётов: месяц. В первую неделю месяца — прошлый полный месяц:
    пять неполных дней дают ложный минус ко всему. */
export function defaultPeriod(today: ISODate): PeriodState {
  return { kind: 'month', anchor: Number(today.slice(8, 10)) <= 7 ? plusDays(firstOfMonth(today), -1) : today };
}

/* Один выбранный период на обзор и отчёты: перешли с обзора в отчёт — период тот же. Живёт до перезагрузки. */
let shared: { today: ISODate; period: PeriodState } | null = null;

/** Состояние периода, общее для обзора и отчётов. fromUrl — период из адреса («?from=…&to=…»): с ним открыли экран — он и выбран. */
export function useSharedPeriod(today: ISODate, fromUrl?: PeriodState | null): [PeriodState, (p: PeriodState) => void] {
  const [period, setLocal] = useState<PeriodState>(() => {
    if (fromUrl) {
      shared = { today, period: fromUrl };
      return fromUrl;
    }
    return shared && shared.today === today ? shared.period : defaultPeriod(today);
  });
  const set = (p: PeriodState) => {
    shared = { today, period: p };
    setLocal(p);
  };
  // адрес сменился, пока экран открыт (перешли с обзора за другой период) — берём период из адреса
  const urlKey = fromUrl ? `${fromUrl.kind}|${fromUrl.anchor}` : '';
  useEffect(() => {
    if (!fromUrl) return;
    const a = rangeOf(fromUrl, today);
    const b = rangeOf(period, today);
    if (a.from !== b.from || a.to !== b.to || fromUrl.kind !== period.kind) set(fromUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlKey]);
  return [period, set];
}

/** С каким днём сравнивать остаток «на сегодня» (долги): тот же день прошлого периода. */
export function sameDayPrevPeriod(kind: PeriodKind, today: ISODate): ISODate {
  if (kind === 'today' || kind === 'week') return plusDays(today, -7);
  return plusMonths(today, kind === 'month' ? -1 : -3);
}

/** Переключатель периода: «Вчера» — быстрый выбор дня, «День» — любой день стрелками. */
export type PeriodPick = 'yesterday' | PeriodKind;
export const PERIOD_KINDS: { value: PeriodPick; label: string }[] = [
  { value: 'yesterday', label: 'Вчера' },
  { value: 'today', label: 'День' },
  { value: 'week', label: 'Неделя' },
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: 'Квартал' },
];

/** Что подсвечено в переключателе: вчерашний день — «Вчера», любой другой день — «День». */
export function periodPick(p: PeriodState, today: ISODate): PeriodPick {
  return p.kind === 'today' && p.anchor === plusDays(today, -1) ? 'yesterday' : p.kind;
}

export function fromPick(v: PeriodPick, today: ISODate): PeriodState {
  return v === 'yesterday' ? { kind: 'today', anchor: plusDays(today, -1) } : { kind: v, anchor: today };
}

/** Период в адресе: «?from=2026-10-01&to=2026-10-31» — переход с обзора открывает журнал и отчёты за тот же период. */
export function periodQuery(r: { from: ISODate; to: ISODate }): string {
  return `from=${r.from}&to=${r.to}`;
}

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Отрезок из адреса; null — не задан или неверный. */
export function rangeFromQuery(params: URLSearchParams): { from: ISODate; to: ISODate } | null {
  const from = params.get('from');
  const to = params.get('to');
  if (!from || !to || !ISO_RE.test(from) || !ISO_RE.test(to) || from > to) return null;
  return { from, to };
}

/** Какой период обзора соответствует отрезку из адреса: день, неделя, месяц или квартал (обрезанный сегодняшним днём). */
export function periodFromRange(r: { from: ISODate; to: ISODate }, today: ISODate): PeriodState | null {
  const kinds: PeriodKind[] = ['today', 'week', 'month', 'quarter'];
  for (const kind of kinds) {
    const p: PeriodState = { kind, anchor: r.from };
    const x = rangeOf(p, today);
    if (x.from === r.from && x.to === r.to) return p;
  }
  return null;
}

/** Весь период без обрезки: месяц целиком, неделя пн–вс. */
export function fullRange(p: PeriodState): DateRange {
  const a = p.anchor;
  if (p.kind === 'today') return { kind: 'today', from: a, to: a };
  if (p.kind === 'week') {
    const back = (dow(a) + 6) % 7;
    const from = plusDays(a, -back);
    return { kind: 'week', from, to: plusDays(from, 6) };
  }
  if (p.kind === 'month') return { kind: 'month', from: firstOfMonth(a), to: lastOfMonth(a) };
  const m = +a.slice(5, 7);
  const qm = Math.floor((m - 1) / 3) * 3 + 1;
  const from = `${a.slice(0, 4)}-${String(qm).padStart(2, '0')}-01`;
  return { kind: 'quarter', from, to: lastOfMonth(plusMonths(from, 2)) };
}

/** Период до сегодняшнего дня включительно. */
export function rangeOf(p: PeriodState, today: ISODate): DateRange {
  const f = fullRange(p);
  return { ...f, to: f.to > today ? today : f.to };
}

/** Сопоставимый прошлый отрезок: те же дни прошлого месяца, прошлая неделя, тот же день неделей раньше. */
export function compareRange(p: PeriodState, today: ISODate): DateRange {
  return previousRange(rangeOf(p, today));
}

export function shiftPeriod(p: PeriodState, dir: 1 | -1): PeriodState {
  const a = p.anchor;
  if (p.kind === 'today') return { ...p, anchor: plusDays(a, dir) };
  if (p.kind === 'week') return { ...p, anchor: plusDays(a, 7 * dir) };
  if (p.kind === 'month') return { ...p, anchor: plusMonths(firstOfMonth(a), dir) };
  return { ...p, anchor: plusMonths(fullRange(p).from, 3 * dir) };
}

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
const MONTHS_DAT = ['январю', 'февралю', 'марту', 'апрелю', 'маю', 'июню', 'июлю', 'августу', 'сентябрю', 'октябрю', 'ноябрю', 'декабрю'];
const NB = '\u00a0';
const d = (iso: string) => +iso.slice(8, 10);
const m = (iso: string) => +iso.slice(5, 7) - 1;

/** «1–5 ноября», «27 октября – 2 ноября», «5 ноября». */
export function rangeText(r: { from: ISODate; to: ISODate }): string {
  if (r.from === r.to) return `${d(r.from)}${NB}${MONTHS_GEN[m(r.from)]}`;
  if (r.from.slice(0, 7) === r.to.slice(0, 7)) return `${d(r.from)}–${d(r.to)}${NB}${MONTHS_GEN[m(r.to)]}`;
  return `${d(r.from)}${NB}${MONTHS_GEN[m(r.from)]} – ${d(r.to)}${NB}${MONTHS_GEN[m(r.to)]}`;
}

/** Подпись периода в переключателе: «Ноябрь 2026», «4 квартал 2026», «2–8 ноября», «5 ноября». */
export function periodTitle(p: PeriodState, today: ISODate): string {
  const f = fullRange(p);
  if (p.kind === 'month') return `${MONTHS_NOM[m(f.from)]}${NB}${f.from.slice(0, 4)}`;
  if (p.kind === 'quarter') return `${Math.floor(m(f.from) / 3) + 1}${NB}квартал ${f.from.slice(0, 4)}`;
  if (p.kind === 'week') return rangeText(rangeOf(p, today));
  if (p.anchor === today) return `Сегодня, ${rangeText(f)}`;
  if (p.anchor === plusDays(today, -1)) return `Вчера, ${rangeText(f)}`;
  return `${rangeText(f)}, ${WEEKDAYS[dow(p.anchor)]}`;
}

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

/** Подпись, с чем сравниваются изменения: «к октябрю» для целого месяца, иначе «к 1–5 октября». Это подпись, не кнопка. */
export function compareText(p: PeriodState, today: ISODate): string {
  const r = rangeOf(p, today);
  const prev = compareRange(p, today);
  const full = fullRange(p);
  if (p.kind === 'month' && r.to === full.to) return `Изменения к ${MONTHS_DAT[m(prev.from)]}`;
  if (p.kind === 'today') return p.anchor === today ? `Изменения к ${rangeText(prev)} до этого часа` : `Изменения к ${rangeText(prev)}, неделей раньше`;
  return `Изменения к ${rangeText(prev)}`;
}

/** Короткое имя прошлого периода для легенды: «Октябрь», «Прошлая неделя». */
export function prevName(p: PeriodState): string {
  const f = fullRange(shiftPeriod(p, -1));
  if (p.kind === 'month') return MONTHS_NOM[m(f.from)];
  if (p.kind === 'quarter') return `${Math.floor(m(f.from) / 3) + 1} квартал`;
  if (p.kind === 'week') return 'Прошлая неделя';
  return 'Неделей раньше';
}

export function curName(p: PeriodState, today: ISODate): string {
  const f = fullRange(p);
  if (p.kind === 'month') return MONTHS_NOM[m(f.from)];
  if (p.kind === 'quarter') return `${Math.floor(m(f.from) / 3) + 1} квартал`;
  if (p.kind === 'week') return p.anchor >= plusDays(today, -((dow(today) + 6) % 7)) ? 'Эта неделя' : 'Неделя';
  return p.anchor === today ? 'Сегодня' : p.anchor === plusDays(today, -1) ? 'Вчера' : rangeText(f);
}

export function canShift(p: PeriodState, dir: 1 | -1, today: ISODate, start: ISODate): boolean {
  const next = fullRange(shiftPeriod(p, dir));
  return dir > 0 ? next.from <= today : next.to >= start;
}

/** Сравнение имеет смысл, только если прошлый отрезок целиком попадает в историю базы. */
export function hasCompare(p: PeriodState, today: ISODate, start: ISODate): boolean {
  return compareRange(p, today).from >= start;
}

/** Изменение в процентах; null — сравнивать не с чем. */
export function change(cur: number, prev: number | null): number | null {
  if (prev === null || !Number.isFinite(prev) || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}
