import { useMemo, useState, type KeyboardEvent } from 'react';
import { axisMoney, niceScale, useWidth } from './useWidth';

export interface ComboPoint {
  key: string;
  /** подпись на оси: «1 ноя» */
  axis: string;
  /** заголовок подсказки: «1 ноября, суббота» */
  title: string;
  /** столбец этого периода; null — день ещё не наступил */
  value: number | null;
  /** линия прошлого периода; null — нет данных */
  prev: number | null;
  /** подпись строки прошлого периода в подсказке: «1 октября» */
  prevTitle?: string;
}

export interface ComboChartProps {
  points: ComboPoint[];
  height?: number;
  valueName: string;
  prevName: string;
  format: (v: number) => string;
  axisFormat?: (v: number) => string;
  ariaLabel: string;
  /** выделить столбец (например, сегодня) */
  markKey?: string;
  /** растянуть по высоте контейнера (height — наименьшая высота) */
  fill?: boolean;
}

const PAD_T = 12;
const PAD_B = 26;
const PAD_R = 6;

/** Столбцы этого периода и линия прошлого на одной шкале. Подсказка на каждом столбце, клавиши ← → по дням. */
export function ComboChart({ points, height: minHeight = 260, valueName, prevName, format, axisFormat = axisMoney, ariaLabel, markKey, fill }: ComboChartProps) {
  const { ref, width, height: measured } = useWidth<HTMLDivElement>(640, minHeight);
  const height = fill ? Math.max(minHeight, measured) : minHeight;
  const [hover, setHover] = useState<number | null>(null);

  const geo = useMemo(() => {
    const n = Math.max(1, points.length);
    let top = 0;
    for (const p of points) top = Math.max(top, p.value ?? 0, p.prev ?? 0);
    const scale = niceScale(top * 1.04, 4);
    const ticks: number[] = [];
    for (let t = 0; t <= scale.max + 1e-6; t += scale.step) ticks.push(t);
    const longest = Math.max(...ticks.map((t) => axisFormat(t).length));
    const padL = Math.max(36, longest * 6.6 + 12);
    const cw = Math.max(40, width - padL - PAD_R);
    const ch = height - PAD_T - PAD_B;
    const slot = cw / n;
    const bw = Math.max(2, Math.min(24, slot * 0.62, slot - 2));
    const y = (v: number) => PAD_T + ch - (v / scale.max) * ch;
    const cx = (i: number) => padL + i * slot + slot / 2;
    // подписи оси X без наложения: шаг 1, 2, 3, 7, 14 …
    let step = 1;
    for (const s of [1, 2, 3, 7, 14, 21, 28]) {
      step = s;
      if (s * slot >= 46) break;
    }
    return { n, scale, ticks, padL, cw, ch, slot, bw, y, cx, step };
  }, [points, width, height, axisFormat]);

  const { scale, ticks, padL, slot, bw, y, cx, step } = geo;
  const base = y(0);

  const barPath = (i: number, v: number) => {
    const x = cx(i) - bw / 2;
    const t = y(Math.max(0, v));
    const h = base - t;
    if (h <= 0.5) return '';
    const r = Math.min(4, bw / 2, h);
    return `M${x},${base}V${t + r}Q${x},${t} ${x + r},${t}H${x + bw - r}Q${x + bw},${t} ${x + bw},${t + r}V${base}Z`;
  };

  const linePts = points
    .map((p, i) => (p.prev === null ? null : `${cx(i).toFixed(1)},${y(p.prev).toFixed(1)}`))
    .filter((s): s is string => s !== null);
  // разрывы линии там, где нет данных прошлого периода
  const segments: string[] = [];
  let cur: string[] = [];
  points.forEach((p, i) => {
    if (p.prev === null) {
      if (cur.length) segments.push(cur.join(' '));
      cur = [];
    } else cur.push(`${cx(i).toFixed(1)},${y(p.prev).toFixed(1)}`);
  });
  if (cur.length) segments.push(cur.join(' '));

  const hp = hover !== null ? points[hover] : null;
  const tipLeft = hover !== null ? Math.min(Math.max(cx(hover), 90), width - 90) : 0;
  const tipTop = hp ? Math.max(0, y(Math.max(hp.value ?? 0, hp.prev ?? 0))) : 0;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') setHover((h) => (h === null ? 0 : Math.min(points.length - 1, h + 1)));
    else if (e.key === 'ArrowLeft') setHover((h) => (h === null ? points.length - 1 : Math.max(0, h - 1)));
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  return (
    <div className={fill ? 'vz-chart is-fill' : 'vz-chart'} ref={ref} style={fill ? { minHeight } : { height }} onMouseLeave={() => setHover(null)}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'vz-base' : 'vz-grid'} x1={padL} x2={width - PAD_R} y1={y(t)} y2={y(t)} />
            <text className="vz-label" x={padL - 10} y={y(t) + 4} textAnchor="end">
              {axisFormat(t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          p.value !== null && p.value > 0 ? (
            <path key={p.key} className={'vz-bar' + (hover === i ? ' is-hover' : '') + (markKey === p.key ? ' is-mark' : '')} d={barPath(i, p.value)} />
          ) : null,
        )}
        {segments.map((s, k) => (
          <polyline key={k} className="vz-line" points={s} />
        ))}
        {linePts.length === 1 && hover === null
          ? points.map((p, i) => (p.prev !== null ? <circle key={p.key} className="vz-dot-prev" cx={cx(i)} cy={y(p.prev)} r={4} /> : null))
          : null}
        {hp && hp.prev !== null ? <circle className="vz-dot-prev" cx={cx(hover!)} cy={y(hp.prev)} r={4.5} /> : null}
        {points.map((p, i) =>
          i % step === 0 ? (
            <text key={p.key} className="vz-label" x={cx(i)} y={height - 7} textAnchor="middle">
              {p.axis}
            </text>
          ) : null,
        )}
        {points.map((p, i) => (
          <rect
            key={p.key}
            className="vz-hit"
            x={padL + i * slot}
            y={PAD_T}
            width={slot}
            height={height - PAD_T - PAD_B}
            onMouseEnter={() => setHover(i)}
            onMouseMove={() => hover !== i && setHover(i)}
          />
        ))}
      </svg>
      {hp ? (
        <div className="vz-tip" style={{ left: tipLeft, top: tipTop }} role="status">
          <div className="vz-tip-title">{hp.title}</div>
          <div className="vz-tip-row">
            <span className="vz-key is-bar" />
            <span className="vz-tip-name">{valueName}</span>
            <span className="vz-tip-val">{hp.value === null ? '—' : format(hp.value)}</span>
          </div>
          <div className="vz-tip-row">
            <span className="vz-key is-line" />
            <span className="vz-tip-name">{hp.prevTitle ?? prevName}</span>
            <span className="vz-tip-val">{hp.prev === null ? 'нет данных' : format(hp.prev)}</span>
          </div>
        </div>
      ) : null}
      <table className="vz-sr">
        <caption>{ariaLabel}</caption>
        <thead>
          <tr>
            <th>День</th>
            <th>{valueName}</th>
            <th>{prevName}</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p) => (
            <tr key={p.key}>
              <td>{p.title}</td>
              <td>{p.value === null ? '—' : format(p.value)}</td>
              <td>{p.prev === null ? '—' : format(p.prev)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {scale.max <= 1 && points.every((p) => !p.value && !p.prev) ? <div className="vz-empty">Продаж за период нет</div> : null}
    </div>
  );
}

/** Легенда: квадрат для столбцов, короткая линия для линии. */
export function ChartLegend({ items }: { items: { label: string; kind: 'bar' | 'line' | 'muted' }[] }) {
  return (
    <span className="vz-legend">
      {items.map((it) => (
        <span key={it.label} className="vz-legend-item">
          <span className={'vz-key ' + (it.kind === 'bar' ? 'is-bar' : it.kind === 'line' ? 'is-line' : 'is-muted')} />
          {it.label}
        </span>
      ))}
    </span>
  );
}
