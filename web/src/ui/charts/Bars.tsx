import type { ReactNode } from 'react';

export type ChartSlot = 1 | 2 | 3 | 4 | 5 | 6;

export interface HBarRow {
  key: string;
  label: ReactNode;
  value: number;
  /** что напечатать справа; по умолчанию format(value) */
  display?: ReactNode;
  onClick?: () => void;
  title?: string;
}

/** Горизонтальные полосы одной серии: причины, категории, доли. Значение — текстом справа, полоса только помогает. */
export function HBarList({ rows, format, max, slot = 1, empty }: { rows: HBarRow[]; format?: (v: number) => string; max?: number; slot?: ChartSlot; empty?: ReactNode }) {
  const top = max ?? Math.max(0, ...rows.map((r) => r.value));
  if (!rows.length) return <div className="vz-hbar-empty">{empty ?? 'Нет данных за период'}</div>;
  return (
    <div className="vz-hbars">
      {rows.map((r) => {
        const w = top > 0 ? Math.max(r.value > 0 ? 1.5 : 0, (r.value / top) * 100) : 0;
        const inner = (
          <>
            <span className="vz-hbar-label">{r.label}</span>
            <span className="vz-hbar-val">{r.display ?? (format ? format(r.value) : r.value)}</span>
            <span className="vz-hbar-track">
              <span className="vz-hbar-fill" style={{ width: `${w}%`, background: `var(--chart-${slot})` }} />
            </span>
          </>
        );
        return r.onClick ? (
          <button key={r.key} type="button" className="vz-hbar is-click" onClick={r.onClick} title={r.title}>
            {inner}
          </button>
        ) : (
          <div key={r.key} className="vz-hbar" title={r.title}>
            {inner}
          </div>
        );
      })}
    </div>
  );
}

export interface SegmentPart {
  key: string;
  label: string;
  value: number;
  slot: ChartSlot | 'bad' | 'warn';
  display?: string;
}

/** Целое из частей: тонкая полоса и легенда с числами под ней. */
export function SegmentBar({ parts, format, ariaLabel }: { parts: SegmentPart[]; format?: (v: number) => string; ariaLabel: string }) {
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  const color = (p: SegmentPart) => (p.slot === 'bad' ? 'var(--bad)' : p.slot === 'warn' ? 'var(--chart-4)' : `var(--chart-${p.slot})`);
  const label = parts.map((p) => `${p.label}: ${p.display ?? (format ? format(p.value) : p.value)}`).join(', ');
  return (
    <div className="vz-seg">
      <div className="vz-seg-bar" role="img" aria-label={`${ariaLabel}. ${label}`}>
        {parts.map((p) =>
          p.value > 0 && total > 0 ? (
            <span
              key={p.key}
              style={{ flexGrow: p.value, background: color(p) }}
              title={`${p.label}: ${p.display ?? (format ? format(p.value) : p.value)} · ${Math.round((p.value / total) * 100)} %`}
            />
          ) : null,
        )}
        {total === 0 ? <span style={{ flexGrow: 1, background: 'var(--chart-track)' }} /> : null}
      </div>
      <div className="vz-seg-legend">
        {parts.map((p) => (
          <span key={p.key} className="vz-legend-item">
            <span className="vz-key is-bar" style={{ background: color(p) }} />
            {p.label}
            <b>{p.display ?? (format ? format(p.value) : p.value)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Выполнение плана: полоса и процент. Сверх плана — полная полоса.
    expectedPct — сколько должно быть по графику на сегодня: риска на полосе, цвет — идёт ли по графику. */
export function PlanMeter({ value, plan, title, expectedPct }: { value: number; plan: number; title?: string; expectedPct?: number }) {
  const p = plan > 0 ? value / plan : 0;
  const w = Math.max(0, Math.min(1, p)) * 100;
  const ok = expectedPct !== undefined ? p * 100 >= expectedPct * 0.95 : p >= 0.9;
  const mark = expectedPct !== undefined && expectedPct > 0 && expectedPct < 100 ? expectedPct : null;
  return (
    <span className="vz-plan" title={title}>
      <span className="vz-plan-track">
        <span className="vz-plan-fill" style={{ width: `${w}%`, background: ok ? 'var(--chart-1)' : 'var(--chart-4)' }} />
        {mark !== null ? <span className="vz-plan-mark" style={{ left: `${mark}%` }} /> : null}
      </span>
      <span className="vz-plan-pct">{plan > 0 ? `${Math.round(p * 100)} %` : '—'}</span>
    </span>
  );
}

/** Маленькие столбики тренда без осей: последние N значений. */
export function Spark({ values, width = 96, height = 28, ariaLabel }: { values: number[]; width?: number; height?: number; ariaLabel: string }) {
  const max = Math.max(1, ...values);
  const n = Math.max(1, values.length);
  const slot = width / n;
  const bw = Math.max(2, slot - 2);
  return (
    <svg className="vz-spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      {values.map((v, i) => {
        const h = v > 0 ? Math.max(2, (v / max) * (height - 2)) : 0;
        return h ? <rect key={i} x={i * slot + (slot - bw) / 2} y={height - h} width={bw} height={h} rx={1.5} className={i === n - 1 ? 'is-last' : undefined} /> : null;
      })}
    </svg>
  );
}
