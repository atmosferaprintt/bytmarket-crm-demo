import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive, Banknote, Calculator, CalendarX2, Check, ChevronDown, HandCoins, Landmark, PackageMinus, Percent, Timer, Undo2, UserRound } from 'lucide-react';
import { Button, IconTile, cx } from '../../ui';
import { useDB } from '../../data/store';
import { useSession } from '../../roles/session';
import { useOpenEntity } from '../../shell/entities';
import { TaskModal } from '../../shell/TaskModal';
import { tabsFor } from '../../shell/nav';
import type { SectionKey } from '../../roles/roles';
import type { RoleKey, TaskLink } from '../../data/types';
import type { Signal, SignalAction, SignalKind } from './signals';

export const SIGNAL_ICON: Record<SignalKind, ReactNode> = {
  overdue: <HandCoins />,
  payment: <Landmark />,
  reconcile: <Calculator />,
  order_delay: <Timer />,
  stock_low: <PackageMinus />,
  missed_order: <CalendarX2 />,
  margin_drop: <Percent />,
  dead_stock: <Archive />,
  supplier: <Banknote />,
};

const TONE: Record<Signal['severity'], 'bad' | 'warn' | 'info'> = { high: 'bad', medium: 'warn', low: 'info' };

/** Видна ли роли страница: раздел и вкладка. */
function canVisit(path: string, role: RoleKey, sees: (s: SectionKey) => boolean): boolean {
  const pathname = path.split('?')[0];
  const section = pathname.split('/')[1] as SectionKey;
  if (!section || !sees(section)) return false;
  const tabs = tabsFor(section, role);
  return tabs.some((t) => t.path === pathname) || pathname === '/' + section;
}

/** Действие сигнала с учётом роли: если раздел роли не виден — запасной вариант. */
export function resolveAction(a: SignalAction, role: RoleKey, sees: (s: SectionKey) => boolean): Exclude<SignalAction, { type: 'go' }> | { type: 'go'; to: string; label: string } {
  if (a.type === 'go') return canVisit(a.to, role, sees) ? { type: 'go', to: a.to, label: a.label } : resolveAction(a.fallback, role, sees);
  return a;
}

/** Кнопка действия и окно задачи. */
export function useSignalActions() {
  const { role, sees } = useSession();
  const navigate = useNavigate();
  const open = useOpenEntity();
  const [task, setTask] = useState<{ link: TaskLink | null; title: string; assigneeId: string | null } | null>(null);
  const run = (s: Signal) => {
    const a = resolveAction(s.action, role, sees);
    if (a.type === 'go') navigate(a.to);
    else if (a.type === 'open') open(a.entity, a.id);
    else setTask({ link: a.link, title: a.title, assigneeId: a.assigneeId });
  };
  const label = (s: Signal) => resolveAction(s.action, role, sees).label;
  const modal = task ? <TaskModal link={task.link} assigneeId={task.assigneeId ?? undefined} defaultTitle={task.title} onClose={() => setTask(null)} /> : null;
  return { run, label, modal };
}

export function Responsible({ id }: { id: string | null }) {
  const db = useDB();
  const e = id ? db.employees.find((x) => x.id === id) : undefined;
  if (!e) return null;
  return (
    <span className="ov-who" title="Ответственный">
      <UserRound />
      {e.name}
    </span>
  );
}

/** Строка сигнала в обзоре: значок, что случилось, две цифры и ответственный, одна кнопка. */
export function SignalLine({ s, onAction, actionLabel }: { s: Signal; onAction: () => void; actionLabel: string }) {
  return (
    <div className="list-row ov-sig">
      <IconTile tone={TONE[s.severity]}>{SIGNAL_ICON[s.kind]}</IconTile>
      <div className="grow">
        <div className="ov-sig-title" title={s.title}>
          {s.title}
        </div>
        <div className="ov-sig-meta">
          {s.facts.slice(0, 2).map((f) => (
            <span key={f.label} className="nowrap">
              {f.label.toLowerCase()} <b>{f.value}</b>
            </span>
          ))}
          <Responsible id={s.responsibleId} />
        </div>
      </div>
      <Button size="sm" onClick={onAction}>
        {actionLabel}
      </Button>
    </div>
  );
}

/** Карточка сигнала на вкладке «Требует внимания»: причина, цифры, ответственный, действие, «Разобрано». */
export function SignalCard({
  s,
  onAction,
  actionLabel,
  resolved,
  onToggleResolved,
  compact,
  open,
  children,
}: {
  s: Signal;
  onAction: () => void;
  actionLabel: string;
  resolved: boolean;
  onToggleResolved: () => void;
  compact?: boolean;
  /** для группы: раскрыта ли и что внутри */
  open?: boolean;
  children?: ReactNode;
}) {
  const resolveBtn = (
    <Button size="sm" variant="ghost" icon={resolved ? <Undo2 /> : <Check />} onClick={onToggleResolved} title={resolved ? 'Вернуть в список' : 'Убрать из списка: уже разобрались'}>
      {resolved ? 'Вернуть' : 'Разобрано'}
    </Button>
  );
  if (compact) {
    const group = !!s.members;
    return (
      <>
        <div className={cx('att-line', resolved && 'is-resolved', group && 'is-group')}>
          <span className="att-line-icon">{SIGNAL_ICON[s.kind]}</span>
          <span className="att-line-title" title={s.reason || s.title}>
            {s.title}
          </span>
          <span className="att-line-fact">{(s.facts.find((f) => f.tone) ?? s.facts.find((f) => f.value.includes('₽')) ?? s.facts[0])?.value ?? null}</span>
          <span className="att-line-who">
            <Responsible id={s.responsibleId} />
          </span>
          <span className="att-line-act">
            {group ? (
              <Button size="sm" variant="secondary" icon={<ChevronDown className={cx('att-chev', open && 'is-open')} />} onClick={onAction} aria-expanded={open}>
                {open ? 'Свернуть' : 'Показать'}
              </Button>
            ) : (
              <Button size="sm" onClick={onAction}>
                {actionLabel}
              </Button>
            )}
            {resolveBtn}
          </span>
        </div>
        {group && open ? <div className="att-members">{children}</div> : null}
      </>
    );
  }
  return (
    <div className={cx('att-card', resolved && 'is-resolved')}>
      <IconTile tone={TONE[s.severity]}>{SIGNAL_ICON[s.kind]}</IconTile>
      <div className="grow att-main">
        <div className="att-title">{s.title}</div>
        {s.reason ? <div className="att-reason">{s.reason}</div> : null}
        <div className="att-facts">
          {s.facts.map((f) => (
            <span key={f.label} className="att-fact">
              <span className="att-fact-label">{f.label}</span>
              <span className={cx('att-fact-value', f.tone === 'bad' && 'c-bad', f.tone === 'warn' && 'c-warn')}>{f.value}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="att-side">
        <Responsible id={s.responsibleId} />
        <div className="row">
          {resolveBtn}
          <Button size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
