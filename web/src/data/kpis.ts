/* Единые показатели сотрудников и плана. Одна формула на всех экранах:
   продажи сотрудника = salesForPeriod с employeeId (опт — по отгрузке ответственному за заказ, розница — по чеку продавцу, минус возвраты);
   план — месячный из db.plans; выполнение — факт с начала месяца к плану всего месяца; «по графику» — доля прошедших дней месяца.
   Импорт: import { planProgress } from '../../data/kpis'; */
import type { DB, ID, ISODate } from './types';
import { salesForPeriod } from './selectors';
import { diffDays, firstOfMonth, lastOfMonth } from './dates';

export interface PlanProgress {
  month: string; // 'YYYY-MM'
  from: ISODate;
  to: ISODate; // по сегодняшний день или конец месяца
  plan: number | null; // null — план не задан
  fact: number;
  pct: number | null; // fact / plan × 100
  expectedPct: number; // сколько должно быть по графику на сегодня, %
  onTrack: boolean | null; // идёт ли по графику
}

/** Выполнение плана за месяц, в который попадает `date` (по умолчанию — сегодня демо). employeeId = null — магазин целиком. */
export function planProgress(db: DB, employeeId: ID | null, date: ISODate = db.meta.today): PlanProgress {
  const from = firstOfMonth(date);
  const end = lastOfMonth(date);
  const to = date < end ? date : end;
  const month = from.slice(0, 7);
  const planRow = db.plans.find((p) => p.month === month && p.employeeId === employeeId);
  const fact = salesForPeriod(db, from, to, employeeId ? { employeeId } : {}).revenue;
  const daysInMonth = diffDays(from, end) + 1;
  const daysPassed = diffDays(from, to) + 1;
  const expectedPct = Math.round((daysPassed / daysInMonth) * 1000) / 10;
  const plan = planRow ? planRow.amount : null;
  const pct = plan ? Math.round((fact / plan) * 1000) / 10 : null;
  return { month, from, to, plan, fact, pct, expectedPct, onTrack: pct === null ? null : pct >= expectedPct * 0.95 };
}

/** Продажи сотрудника за период — та же формула, что в отчётах. */
export function employeeRevenue(db: DB, employeeId: ID, from: ISODate, to: ISODate): number {
  return salesForPeriod(db, from, to, { employeeId }).revenue;
}
