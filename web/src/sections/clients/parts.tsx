import { cx, fmt } from '../../ui';
import { paceTone, type RepStats } from './lib';

/** Полоса плана: факт и отметка «где должны быть сегодня». */
export function PlanBar({ s, thin }: { s: RepStats; thin?: boolean }) {
  const tone = paceTone(s.pace);
  const p = s.plan > 0 ? Math.min(100, (s.fact / s.plan) * 100) : 0;
  const title =
    s.plan > 0
      ? `Заказы и заявки за месяц: ${fmt.money(s.fact)} из ${fmt.money(s.plan)}. К сегодняшнему дню по графику — ${fmt.pct(s.expectedPct, 0)} плана.`
      : 'План на месяц не задан';
  return (
    <div className={cx('cl-plan-bar', thin && 'is-thin')} title={title} role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
      <span className={cx('cl-plan-fill', `is-${tone}`)} style={{ width: `${p}%` }} />
      {s.plan > 0 ? <span className="cl-plan-mark" style={{ left: `${Math.min(100, s.expectedPct)}%` }} /> : null}
    </div>
  );
}
