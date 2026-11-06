import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight } from 'lucide-react';
import { cx, fmt } from '../../ui';
import { change } from './period';

export type Delta = { text: string; dir: 'up' | 'down' | 'flat' } | null;

/** Изменение в процентах к прошлому периоду; null — сравнивать не с чем. */
export function deltaOf(cur: number, prev: number | null | undefined): Delta {
  const c = change(cur, prev ?? null);
  if (c === null) return null;
  return { text: fmt.delta(c), dir: c > 0.05 ? 'up' : c < -0.05 ? 'down' : 'flat' };
}

/** Изменение в процентных пунктах: для маржи. */
export function ppDelta(cur: number, prev: number | null | undefined): Delta {
  if (prev === null || prev === undefined) return null;
  const v = cur - prev;
  if (Math.abs(v) < 0.05) return { text: '0 п. п.', dir: 'flat' };
  return { text: `${v > 0 ? '+' : '−'}${fmt.num(Math.abs(v), 1)} п. п.`, dir: v > 0 ? 'up' : 'down' };
}

/** Показатель: подпись, сумма, изменение под суммой, строка подробностей. Клик — к подробностям.
    asOf — для остатков «на сегодня» (долги): «на 5 ноября» в строке изменения; dTitle — с чем сравнили. */
export function KpiTile({
  label,
  value,
  d,
  good = 'up',
  onClick,
  extra,
  title,
  asOf,
  dTitle = 'К тому же отрезку прошлого периода',
  hint,
}: {
  label: ReactNode;
  value: string;
  d?: Delta;
  good?: 'up' | 'down';
  onClick?: () => void;
  extra?: ReactNode;
  title?: string;
  asOf?: string;
  dTitle?: string;
  /** метка для подсказок режима обучения: data-hint */
  hint?: string;
}) {
  const tone = !d || d.dir === 'flat' ? 'flat' : d.dir === good ? 'up' : 'down';
  const deltaEl = d ? (
    <span className={cx('kpi-delta', `is-${tone}`)} title={dTitle}>
      {d.dir === 'up' ? <ArrowUpRight size={14} /> : d.dir === 'down' ? <ArrowDownRight size={14} /> : null}
      {d.text}
    </span>
  ) : null;
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {asOf ? (
        <span className="ov-kpi-asof">
          <span>{asOf}</span>
          {deltaEl}
        </span>
      ) : (
        deltaEl
      )}
      {extra}
    </>
  );
  if (onClick)
    return (
      <button type="button" className="kpi card ov-kpi is-click" onClick={onClick} title={title} data-hint={hint}>
        {body}
      </button>
    );
  return (
    <div className="kpi card ov-kpi" title={title} data-hint={hint}>
      {body}
    </div>
  );
}
