import type { ReactNode } from 'react';
import { ArrowDownRight, ArrowUpRight, Info, AlertTriangle, CheckCircle2, XCircle, Inbox } from 'lucide-react';
import { cx } from './cx';

/** Белая карточка с заголовком, действиями справа и подвалом. */
export function Card({
  title,
  sub,
  actions,
  children,
  foot,
  flush,
  className,
  pad,
  hint,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  foot?: ReactNode;
  flush?: boolean;
  pad?: boolean;
  className?: string;
  /** метка для подсказок режима обучения: data-hint */
  hint?: string;
}) {
  return (
    <section className={cx('card', flush && 'is-flush', className)} data-hint={hint}>
      {title || actions ? (
        <div className="card-head">
          <div className="grow">
            {title ? <h2 className="card-title">{title}</h2> : null}
            {sub ? <div className="card-sub">{sub}</div> : null}
          </div>
          {actions ? <div className="row">{actions}</div> : null}
        </div>
      ) : null}
      {children !== undefined ? <div className={cx(flush ? undefined : 'card-body', pad === false && 'p-0')}>{children}</div> : null}
      {foot ? <div className="card-foot">{foot}</div> : null}
    </section>
  );
}

/** Показатель: подпись, значение, изменение. Без серых пояснений под числом. */
export function Kpi({
  label,
  value,
  delta,
  deltaGood = 'up',
  big,
  onClick,
  extra,
  icon,
  hint,
}: {
  label: ReactNode;
  value: ReactNode;
  delta?: { text: string; dir: 'up' | 'down' | 'flat' } | null;
  deltaGood?: 'up' | 'down';
  big?: boolean;
  onClick?: () => void;
  extra?: ReactNode;
  icon?: ReactNode;
  /** метка для подсказок режима обучения: data-hint */
  hint?: string;
}) {
  const good = delta ? (delta.dir === 'flat' ? 'flat' : delta.dir === deltaGood ? 'up' : 'down') : 'flat';
  const body = (
    <>
      <div className="kpi-label">
        {icon}
        <span className="grow">{label}</span>
        {delta ? (
          <span className={cx('kpi-delta', `is-${good}`)}>
            {delta.dir === 'up' ? <ArrowUpRight size={14} /> : delta.dir === 'down' ? <ArrowDownRight size={14} /> : null}
            {delta.text}
          </span>
        ) : null}
      </div>
      <div className={cx('kpi-value', big && 'is-big')}>{value}</div>
      {extra}
    </>
  );
  if (onClick)
    return (
      <button type="button" className="kpi card" onClick={onClick} data-hint={hint}>
        {body}
      </button>
    );
  return <div className="kpi card" data-hint={hint}>{body}</div>;
}

/** Строки «подпись — значение». */
export function StatList({ children }: { children: ReactNode }) {
  return <div className="stat-list">{children}</div>;
}
export function StatRow({ label, value, total, onClick }: { label: ReactNode; value: ReactNode; total?: boolean; onClick?: () => void }) {
  return (
    <div className={cx('stat-row', total && 'is-total')} onClick={onClick} style={onClick ? { cursor: 'pointer' } : undefined}>
      <span className="stat-label">{label}</span>
      <span className="stat-value num">{value}</span>
    </div>
  );
}

export function EmptyState({ title, children, icon, action }: { title: ReactNode; children?: ReactNode; icon?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      {icon ?? <Inbox />}
      <div className="empty-title">{title}</div>
      {children ? <div>{children}</div> : null}
      {action}
    </div>
  );
}

export function Notice({ tone = 'neutral', children, title, action }: { tone?: 'neutral' | 'info' | 'warn' | 'bad' | 'ok'; children?: ReactNode; title?: ReactNode; action?: ReactNode }) {
  const Icon = tone === 'bad' ? XCircle : tone === 'warn' ? AlertTriangle : tone === 'ok' ? CheckCircle2 : Info;
  return (
    <div className={cx('notice', tone !== 'neutral' && `is-${tone}`)}>
      <Icon />
      <div className="grow">
        {title ? <div className="w-700">{title}</div> : null}
        {children}
      </div>
      {action}
    </div>
  );
}

/** Полоса выполнения: факт/план. */
export function ProgressBar({ value, max, tone = 'ok', thin }: { value: number; max: number; tone?: 'ok' | 'warn' | 'bad' | 'info'; thin?: boolean }) {
  const p = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const color = tone === 'warn' ? 'var(--chart-4)' : tone === 'bad' ? 'var(--bad)' : tone === 'info' ? 'var(--chart-2)' : 'var(--chart-1)';
  return (
    <div className={cx('bar', thin && 'is-thin')} role="progressbar" aria-valuenow={Math.round(p)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${p}%`, background: color }} />
    </div>
  );
}

/** Этапы: заказ → сборка → отгрузка → оплата */
export function Steps({ items }: { items: { label: string; state: 'done' | 'current' | 'todo' }[] }) {
  return (
    <div className="steps">
      {items.map((s, i) => (
        <span key={s.label} className="row" style={{ gap: 6 }}>
          {i > 0 ? <span className="step-line" /> : null}
          <span className={cx('step', s.state === 'done' && 'is-done', s.state === 'current' && 'is-current')}>
            <span className="step-dot">{s.state === 'done' ? <CheckIcon /> : i + 1}</span>
            {s.label}
          </span>
        </span>
      ))}
    </div>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function Avatar({ name, size = 'md', navy }: { name: string; size?: 'sm' | 'md' | 'lg'; navy?: boolean }) {
  const words = name.replace(/[«»"]/g, '').split(/[\s·]+/).filter(Boolean);
  const ini = (words[0]?.[0] ?? '') + (words[1]?.[0] ?? '');
  return <span className={cx('avatar', size === 'sm' && 'is-sm', size === 'lg' && 'is-lg', navy && 'is-navy')}>{ini.toUpperCase()}</span>;
}

export function IconTile({ children, tone }: { children: ReactNode; tone?: 'bad' | 'warn' | 'ok' | 'info' }) {
  return <span className={cx('icon-tile', tone && `is-${tone}`)}>{children}</span>;
}
