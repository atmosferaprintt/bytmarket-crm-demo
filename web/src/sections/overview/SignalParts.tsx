import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  Banknote,
  Calculator,
  CalendarX2,
  Check,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  HandCoins,
  Landmark,
  ListChecks,
  MessageCircle,
  PackageMinus,
  PackageX,
  Percent,
  Timer,
  Undo2,
  UserRound,
} from 'lucide-react';
import { Button, Chip, IconTile, cx, fmt } from '../../ui';
import { useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { useOpenEntity } from '../../shell/entities';
import { TaskModal } from '../../shell/TaskModal';
import { tabsFor } from '../../shell/nav';
import type { Perm, SectionKey } from '../../roles/roles';
import type { DB, ID, RoleKey, Task, TaskKind, TaskLink } from '../../data/types';
import type { Signal, SignalAction, SignalKind, SignalModal } from './signals';
import { MoneyModalHost, type MoneyModal } from '../money/actions';
import { RemindModal, canRemind, lastReminderAt, reminderText } from '../money/remind';

export const SIGNAL_ICON: Record<SignalKind, ReactNode> = {
  approve: <ClipboardCheck />,
  overdue: <HandCoins />,
  payment: <Landmark />,
  unknown_payment: <CircleHelp />,
  reconcile: <Calculator />,
  receiving: <PackageX />,
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

/** Право, без которого окно сигнала не открыть. */
const MODAL_PERM: Record<SignalModal['kind'], Perm | null> = { identify: 'confirmPayment', confirm: 'confirmPayment', supplier: 'paySupplier', handin: null };

type Resolved = Exclude<SignalAction, { type: 'go' } | { type: 'modal' }> | { type: 'go'; to: string; label: string } | { type: 'modal'; modal: SignalModal; label: string };

/** Действие сигнала с учётом роли: если раздел или окно роли недоступны — запасной вариант. */
export function resolveAction(a: SignalAction, role: RoleKey, sees: (s: SectionKey) => boolean, can: (p: Perm) => boolean = () => true): Resolved {
  if (a.type === 'go') return canVisit(a.to, role, sees) ? { type: 'go', to: a.to, label: a.label } : resolveAction(a.fallback, role, sees, can);
  if (a.type === 'modal') {
    const perm = MODAL_PERM[a.modal.kind];
    const ok = (!a.roles || a.roles.includes(role)) && (!perm || can(perm));
    return ok ? { type: 'modal', modal: a.modal, label: a.label } : resolveAction(a.fallback, role, sees, can);
  }
  return a;
}

function toMoneyModal(m: SignalModal): MoneyModal {
  if (m.kind === 'supplier') return { kind: 'supplier', supplierId: m.supplierId, amount: m.amount };
  if (m.kind === 'handin') return { kind: 'handin', courierId: m.courierId };
  return { kind: m.kind, paymentId: m.paymentId };
}

interface TaskDraft {
  link: TaskLink | null;
  title: string;
  assigneeId: ID | null;
  kind?: TaskKind;
}

/** Кнопки сигнала и окна: открыть запись, перейти, поручить задачу, сразу сделать дело (разнести, оплатить, принять), напомнить в WhatsApp. */
export function useSignalActions() {
  const { role, sees, can } = useSession();
  const navigate = useNavigate();
  const open = useOpenEntity();
  const [task, setTask] = useState<TaskDraft | null>(null);
  const [money, setMoney] = useState<MoneyModal>(null);
  const [remind, setRemind] = useState<ID | null>(null);
  const run = (s: Signal) => {
    const a = resolveAction(s.action, role, sees, can);
    if (a.type === 'go') navigate(a.to);
    else if (a.type === 'open') open(a.entity, a.id);
    else if (a.type === 'modal') setMoney(toMoneyModal(a.modal));
    else setTask({ link: a.link, title: a.title, assigneeId: a.assigneeId, kind: a.kind });
  };
  const label = (s: Signal) => resolveAction(s.action, role, sees, can).label;
  const modal = (
    <>
      {task ? <TaskModal title="Поручить" link={task.link} assigneeId={task.assigneeId} defaultTitle={task.title} kind={task.kind} onClose={() => setTask(null)} /> : null}
      <MoneyModalHost modal={money} onClose={() => setMoney(null)} onOpen={setMoney} />
      {remind ? <RemindModal clientId={remind} onClose={() => setRemind(null)} /> : null}
    </>
  );
  return { run, label, modal, remind: setRemind };
}

/** Открытые задачи по записям: «Поручено: Аминат Р., сегодня» на сигнале. Ключ — «тип:id». */
export function useTaskMarks(): Map<string, Task> {
  const db = useDB();
  const v = useDBVersion();
  return useMemo(() => {
    const m = new Map<string, Task>();
    for (const t of db.tasks) {
      if (t.state !== 'open' || !t.link || t.kind === 'approve_order') continue;
      const k = `${t.link.type}:${t.link.id}`;
      const prev = m.get(k);
      if (!prev || t.createdAt > prev.createdAt) m.set(k, t);
    }
    return m;
  }, [db, v]);
}

export function taskOf(marks: Map<string, Task>, s: Signal): Task | undefined {
  return s.taskLink ? marks.get(`${s.taskLink.type}:${s.taskLink.id}`) : undefined;
}

/** «Поручено: Аминат Р., сегодня» — кому поручена задача по этой записи. */
export function AssignedMark({ task, meId, db, short }: { task: Task; meId: ID; db: DB; short?: boolean }) {
  const e = db.employees.find((x) => x.id === task.assigneeId);
  const when = fmt.relDate(task.createdAt, db.meta.today);
  const mine = task.assigneeId === meId;
  // в узкой строке — без даты, она в подсказке
  const text = mine ? (short ? 'Ваша задача' : `Ваша задача, ${when}`) : short ? `Поручено: ${e?.short ?? '—'}` : `Поручено: ${e?.short ?? '—'}, ${when}`;
  return (
    <span className="att-assigned" data-hint="attention.assigned" title={`${mine ? 'Ваша задача' : `Поручено ${e?.name ?? ''}`} ${when}: ${task.title}`}>
      <ListChecks />
      {text}
    </span>
  );
}

/** «Напомнили сегодня в 14:05» — последнее напоминание клиенту в WhatsApp. */
export function RemindedMark({ at, today }: { at: string; today: string }) {
  return (
    <span className="att-assigned is-reminded" data-hint="attention.reminded" title="Последнее напоминание об оплате в WhatsApp">
      <MessageCircle />
      Напомнили {reminderText(at, today)}
    </span>
  );
}

/** Отметки сигнала: кому поручено и когда напоминали клиенту. В узкой строке — одна, главная. */
export function SignalMarks({ s, marks, meId, db, short }: { s: Signal; marks: Map<string, Task>; meId: ID; db: DB; short?: boolean }) {
  const t = taskOf(marks, s);
  const at = s.remindClientId ? lastReminderAt(db, s.remindClientId) : null;
  if (!t && !at) return null;
  if (short) return t ? <AssignedMark task={t} meId={meId} db={db} short /> : <RemindedMark at={at!} today={db.meta.today} />;
  return (
    <>
      {t ? <AssignedMark task={t} meId={meId} db={db} /> : null}
      {at ? <RemindedMark at={at} today={db.meta.today} /> : null}
    </>
  );
}

/** Кнопка «Напомнить в WhatsApp» у просрочки: если уже напоминали — видно когда. */
export function RemindButton({ clientId, onClick, compact }: { clientId: ID; onClick: () => void; compact?: boolean }) {
  const db = useDB();
  if (!canRemind(db, clientId)) return null;
  const last = lastReminderAt(db, clientId);
  const title = last ? `Напомнить в WhatsApp. Уже напоминали ${reminderText(last, db.meta.today)}` : 'Напомнить клиенту об оплате в WhatsApp: текст и акт сверки';
  return compact ? (
    <Button size="sm" variant="ghost" icon={<MessageCircle />} iconOnly onClick={onClick} title={title} aria-label="Напомнить в WhatsApp" data-hint="attention.remind" />
  ) : (
    <Button size="sm" variant="ghost" icon={<MessageCircle />} onClick={onClick} title={title} data-hint="attention.remind">
      Напомнить в WhatsApp
    </Button>
  );
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
export function SignalLine({ s, onAction, actionLabel, assigned }: { s: Signal; onAction: () => void; actionLabel: string; assigned?: ReactNode }) {
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
          {assigned ?? <Responsible id={s.responsibleId} />}
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
  assigned,
  raised,
  onRemind,
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
  /** «Поручено: Аминат Р., сегодня» */
  assigned?: ReactNode;
  /** строка поднялась на место разобранной */
  raised?: boolean;
  /** напомнить клиенту в WhatsApp */
  onRemind?: () => void;
}) {
  const raisedChip = raised ? (
    <Chip tone="info" title="Поднялась на место разобранного сигнала">
      Поднялось
    </Chip>
  ) : null;
  const resolveBtn = (
    <Button size="sm" variant="ghost" icon={resolved ? <Undo2 /> : <Check />} onClick={onToggleResolved} title={resolved ? 'Вернуть в список' : 'Убрать из списка: уже разобрались'} data-hint={resolved ? undefined : 'attention.resolve'}>
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
          <span className="att-line-who">{assigned ?? <Responsible id={s.responsibleId} />}</span>
          <span className="att-line-act">
            {group ? (
              <Button size="sm" variant="secondary" icon={<ChevronDown className={cx('att-chev', open && 'is-open')} />} onClick={onAction} aria-expanded={open} data-hint="attention.group">
                {open ? 'Свернуть' : 'Показать'}
              </Button>
            ) : (
              <>
                {onRemind && s.remindClientId ? <RemindButton clientId={s.remindClientId} onClick={onRemind} compact /> : null}
                <Button size="sm" onClick={onAction} data-hint="attention.act">
                  {actionLabel}
                </Button>
              </>
            )}
            {resolveBtn}
          </span>
        </div>
        {group && open ? <div className="att-members">{children}</div> : null}
      </>
    );
  }
  return (
    <div className={cx('att-card', resolved && 'is-resolved')} data-hint="attention.card">
      <IconTile tone={TONE[s.severity]}>{SIGNAL_ICON[s.kind]}</IconTile>
      <div className="grow att-main">
        <div className="att-title">
          {s.title}
          {raisedChip}
        </div>
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
        <div className="att-who-col">
          <Responsible id={s.responsibleId} />
          {assigned}
        </div>
        <div className="att-btns">
          {resolveBtn}
          {onRemind && s.remindClientId ? <RemindButton clientId={s.remindClientId} onClick={onRemind} /> : null}
          <Button size="sm" onClick={onAction} data-hint="attention.act">
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
