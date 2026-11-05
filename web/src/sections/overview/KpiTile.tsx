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

/** Показатель: подпись, сумма, изменение под суммой, строка подробностей. Клик — к подробностям. */
export function KpiTile({ label, value, d, good = 'up', onClick, extra, title }: { label: ReactNode; value: string; d?: Delta; good?: 'up' | 'down'; onClick?: () => void; extra?: ReactNode; title?: string }) {
  const tone = !d || d.dir === 'flat' ? 'flat' : d.dir === good ? 'up' : 'down';
  const body = (
    <>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {d ? (
        <span className={cx('kpi-delta', `is-${tone}`)} title="К тому же отрезку прошлого периода">
          {d.dir === 'up' ? <ArrowUpRight size={14} /> : d.dir === 'down' ? <ArrowDownRight size={14} /> : null}
          {d.text}
        </span>
      ) : null}
      {extra}
    </>
  );
  if (onClick)
    return (
      <button type="button" className="kpi card ov-kpi is-click" onClick={onClick} title={title}>
        {body}
      </button>
    );
  return (
    <div className="kpi card ov-kpi" title={title}>
      {body}
    </div>
  );
}
