import type { Visit } from '../../data/types';
import { Chip, cx, fmt } from '../../ui';
import { paceTone, type RepStats } from './lib';

/** Подпись плана — одна на всех экранах: «План ноября: 12 % · по графику 17 %». */
export function planLabel(s: RepStats): string {
  if (s.plan === null || s.planPct === null) return `План ${s.monthGen} не задан`;
  return `План ${s.monthGen}: ${fmt.pct(s.planPct, 0)} · по графику ${fmt.pct(s.expectedPct, 0)}`;
}

/** Пояснение к плану для подсказки: что входит в факт. */
export function planTitle(s: RepStats): string {
  if (s.plan === null) return 'План на месяц не задан';
  return (
    `Продано с 1 ${s.monthGen} по сегодня: ${fmt.money(s.fact)} из ${fmt.money(s.plan)}. ` +
    'Опт — по отгрузке клиентам представителя, розница — по чекам, минус возвраты. Заявки без отгрузки в план не входят. ' +
    `По графику к сегодняшнему дню — ${fmt.pct(s.expectedPct, 0)} плана. Так же считают «Отчёты → Сотрудники».`
  );
}

/** Чип темпа: идёт ли представитель по графику. */
export function PlanChip({ s }: { s: RepStats }) {
  if (s.plan === null) return <Chip tone="outline">План не задан</Chip>;
  const tone = paceTone(s.pace);
  return <Chip tone={tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : 'bad'}>{s.onTrack ? 'По графику' : 'Отстаёт'}</Chip>;
}

/** Полоса плана: факт и отметка «где должны быть сегодня». */
export function PlanBar({ s, thin }: { s: RepStats; thin?: boolean }) {
  const tone = paceTone(s.pace);
  const p = s.plan ? Math.min(100, (s.fact / s.plan) * 100) : 0;
  return (
    <div className={cx('cl-plan-bar', thin && 'is-thin')} title={planTitle(s)} role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
      <span className={cx('cl-plan-fill', `is-${tone}`)} style={{ width: `${p}%` }} />
      {s.plan ? <span className="cl-plan-mark" style={{ left: `${Math.min(100, s.expectedPct)}%` }} /> : null}
    </div>
  );
}

/** Время визита: плановое и когда представитель отметил результат. «по плану 10:30 · отметил 10:42» */
export function visitTimes(v: Visit): string {
  const plan = `по плану ${v.time}`;
  if (v.state === 'planned' || !v.doneAt) return plan;
  return `${plan} · отметил ${fmt.time(v.doneAt)}`;
}
