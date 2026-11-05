import type { ReactNode } from 'react';
import { ArrowLeftRight, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Segmented } from '../../ui';
import type { ISODate } from '../../data/types';
import { canShift, compareText, hasCompare, periodTitle, PERIOD_KINDS, shiftPeriod, type PeriodState } from './period';

/** Строка периода: стрелки и название, вид периода, с чем сравниваем, справа — свободное место. */
export function PeriodBar({
  value,
  onChange,
  today,
  start,
  right,
  compare = true,
}: {
  value: PeriodState;
  onChange: (p: PeriodState) => void;
  today: ISODate;
  start: ISODate;
  right?: ReactNode;
  compare?: boolean;
}) {
  const back = canShift(value, -1, today, start);
  const fwd = canShift(value, 1, today, start);
  const cmp = hasCompare(value, today, start);
  return (
    <div className="ovp-bar">
      <div className="ovp-group" role="group" aria-label="Период">
        <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={!back} onClick={() => onChange(shiftPeriod(value, -1))} aria-label="Предыдущий период" title="Предыдущий период">
          <ChevronLeft />
        </button>
        <span className="ovp-title">
          <CalendarDays />
          {periodTitle(value, today)}
        </span>
        <button type="button" className="btn btn-ghost btn-icon btn-sm" disabled={!fwd} onClick={() => onChange(shiftPeriod(value, 1))} aria-label="Следующий период" title="Следующий период">
          <ChevronRight />
        </button>
      </div>
      <Segmented ariaLabel="Вид периода" value={value.kind} onChange={(kind) => onChange({ kind, anchor: today })} options={PERIOD_KINDS} />
      {compare ? (
        <span className="ovp-compare" title={cmp ? 'Изменения считаются к тому же отрезку прошлого периода' : 'История в базе начинается позже — сравнивать не с чем'}>
          <ArrowLeftRight />
          {cmp ? compareText(value, today) : 'Сравнивать не с чем'}
        </span>
      ) : null}
      {right ? <span className="ovp-right">{right}</span> : null}
    </div>
  );
}
