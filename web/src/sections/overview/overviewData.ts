/* Цифры обзора владельца за выбранный период и сопоставимый прошлый. */
import type { DB, ID, ISODate } from '../../data/types';
import { dailySeries, salesForPeriod, type SalesSummary } from '../../data/selectors';
import { diffDays } from '../../data/dates';
import { planProgress, type PlanProgress } from '../../data/kpis';
import {
  cashIn,
  clientDebtAt,
  clientDebtNow,
  daysOf,
  delayedOrders,
  hourlySeries,
  lossesFor,
  salesUntil,
  stockValue,
  supplierDebtAt,
  supplierDebtNow,
  supplierWeek,
  type DelayItem,
  type LossSummary,
  type StockValue,
  type SupplierWeek,
} from './analytics';
import { compareRange, fullRange, hasCompare, rangeOf, sameDayPrevPeriod, shiftPeriod, type PeriodState } from './period';
import type { ComboPoint } from '../../ui/charts';

export type SeriesKey = 'all' | 'retail' | 'wholesale';

export interface OverviewData {
  from: ISODate;
  to: ISODate;
  prevFrom: ISODate;
  prevTo: ISODate;
  cmp: boolean;
  sales: SalesSummary;
  prevSales: SalesSummary | null;
  /** План месяца, в который попадает конец периода: одна формула со всеми экранами (planProgress). */
  plan: PlanProgress;
  cash: { total: number; bank: number; cash: number };
  prevCash: number | null;
  /** Долги — остаток на сегодня, независимо от периода. Сравнение — с тем же днём прошлого периода. */
  debtDate: ISODate;
  debtCmpDate: ISODate | null;
  debt: { debt: number; overdue: number };
  prevDebt: number | null;
  sup: { debt: number; overdue: number };
  prevSup: number | null;
  nextPay: { date: ISODate; amount: number; supplierId: ID } | null;
  week: SupplierWeek;
  stock: StockValue;
  losses: LossSummary;
  delayed: DelayItem[];
}

export function computeOverview(db: DB, p: PeriodState, nowTime: string): OverviewData {
  const today = db.meta.today;
  const r = rangeOf(p, today);
  const prev = compareRange(p, today);
  const cmp = hasCompare(p, today, db.meta.startDate);
  const sales = salesForPeriod(db, r.from, r.to);
  // сегодня ещё не кончилось: сравниваем с тем же днём неделю назад до того же часа
  const partialDay = p.kind === 'today' && p.anchor === today;
  const prevSales = !cmp ? null : partialDay ? salesUntil(db, prev.from, nowTime) : salesForPeriod(db, prev.from, prev.to);
  const debtNow = clientDebtNow(db);
  const supNow = supplierDebtNow(db);
  const cmpDate = sameDayPrevPeriod(p.kind, today);
  const debtCmpDate = cmpDate >= db.meta.startDate ? cmpDate : null;
  return {
    from: r.from,
    to: r.to,
    prevFrom: prev.from,
    prevTo: prev.to,
    cmp,
    sales,
    prevSales,
    plan: planProgress(db, null, r.to),
    cash: cashIn(db, r.from, r.to),
    prevCash: cmp ? cashIn(db, prev.from, prev.to, partialDay ? nowTime : undefined).total : null,
    debtDate: today,
    debtCmpDate,
    debt: { debt: debtNow.debt, overdue: debtNow.overdue },
    prevDebt: debtCmpDate ? clientDebtAt(db, debtCmpDate).debt : null,
    sup: { debt: supNow.debt, overdue: supNow.overdue },
    prevSup: debtCmpDate ? supplierDebtAt(db, debtCmpDate) : null,
    nextPay: supNow.next,
    week: supplierWeek(db),
    stock: stockValue(db),
    losses: lossesFor(db, r.from, r.to),
    delayed: delayedOrders(db),
  };
}

const MON_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const MON_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WD = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WD_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const NB = '\u00a0';
const wd = (iso: string) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10))).getUTCDay();
const dayLong = (iso: string) => `${+iso.slice(8, 10)}${NB}${MON_GEN[+iso.slice(5, 7) - 1]}`;

/** Точки графика: весь период по дням (или по часам для «Сегодня»), столбцы — до сегодня, линия — прошлый период. */
export function chartPoints(db: DB, p: PeriodState, series: SeriesKey, nowTime: string): ComboPoint[] {
  const today = db.meta.today;
  const pick = (x: { revenue: number; retail: number; wholesale: number }) => (series === 'all' ? x.revenue : series === 'retail' ? x.retail : x.wholesale);
  if (p.kind === 'today') {
    const prevDay = compareRange(p, today).from;
    const cur = hourlySeries(db, p.anchor);
    const prev = prevDay >= db.meta.startDate ? hourlySeries(db, prevDay) : null;
    const nowHour = p.anchor === today ? +nowTime.slice(0, 2) : 99;
    return cur.map((h, i) => ({
      key: String(h.hour),
      axis: `${h.hour}:00`,
      title: `${dayLong(p.anchor)}, ${h.hour}:00–${h.hour + 1}:00`,
      value: h.hour > nowHour ? null : pick(h),
      prev: prev ? pick(prev[i]) : null,
      prevTitle: dayLong(prevDay),
    }));
  }
  const full = fullRange(p);
  const prevFull = fullRange(shiftPeriod(p, -1));
  const curTo = full.to > today ? today : full.to;
  const cur = full.from <= today ? dailySeries(db, full.from, curTo) : [];
  const prevDays = daysOf(prevFull.from, prevFull.to);
  const prevOk = prevFull.to >= db.meta.startDate;
  const prevSeries = prevOk ? dailySeries(db, prevFull.from, prevFull.to) : [];
  const days = daysOf(full.from, full.to);
  return days.map((d, i) => {
    const c = i < cur.length ? cur[i] : null;
    const pd = prevDays[i];
    const pv = pd && prevOk && pd >= db.meta.startDate ? prevSeries[i] : null;
    const day = +d.slice(8, 10);
    return {
      key: d,
      axis: p.kind === 'week' ? `${WD_SHORT[wd(d)]}, ${day}` : `${day}${NB}${MON_SHORT[+d.slice(5, 7) - 1]}`,
      title: `${dayLong(d)}, ${WD[wd(d)]}`,
      value: c ? pick(c) : null,
      prev: pv ? pick(pv) : null,
      prevTitle: pd ? dayLong(pd) : undefined,
    };
  });
}

export function daysLeft(from: ISODate, to: ISODate): number {
  return diffDays(from, to);
}
