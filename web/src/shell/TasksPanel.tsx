import { useMemo, useState } from 'react';
import { Plus, Link2, UserRound } from 'lucide-react';
import { dispatch, useDB } from '../data/store';
import type { Task } from '../data/types';
import { useSession } from '../roles/session';
import { useScoped } from '../roles/scope';
import { Button, Chip, Drawer, EmptyState, Segmented, StatusChip, cx, fmt, toast } from '../ui';
import { EntityLink, type EntityType } from './entities';
import { TaskModal } from './TaskModal';

type TaskFilter = 'today' | 'later' | 'done' | 'given';

/** Мои задачи: значок в шапке. «Поручил я» — что я поставил другим и как оно идёт. */
export function TasksPanel({ onClose }: { onClose: () => void }) {
  const db = useDB();
  const { me } = useSession();
  const { myTasks } = useScoped();
  const today = db.meta.today;
  const [filter, setFilter] = useState<TaskFilter>('today');
  const [creating, setCreating] = useState(false);

  const groups = useMemo(() => {
    const open = myTasks.filter((t) => t.state === 'open');
    return {
      today: open.filter((t) => t.due <= today).sort((a, b) => a.due.localeCompare(b.due) || (b.priority === 'high' ? 1 : 0) - (a.priority === 'high' ? 1 : 0)),
      later: open.filter((t) => t.due > today).sort((a, b) => a.due.localeCompare(b.due)),
      done: myTasks.filter((t) => t.state === 'done').sort((a, b) => (b.doneAt ?? '').localeCompare(a.doneAt ?? '')).slice(0, 30),
      // поручил другим: сначала открытые по сроку, потом сделанные — свежие первыми
      given: db.tasks
        .filter((t) => t.authorId === me.id && t.assigneeId !== me.id)
        .sort((a, b) => (a.state === b.state ? (a.state === 'open' ? a.due.localeCompare(b.due) : (b.doneAt ?? '').localeCompare(a.doneAt ?? '')) : a.state === 'open' ? -1 : 1))
        .slice(0, 40),
    };
  }, [myTasks, today, db.tasks, db.meta.version, me.id]);
  const givenOpen = groups.given.filter((t) => t.state === 'open').length;
  const names = useMemo(() => new Map(db.employees.map((e) => [e.id, e.short])), [db.employees]);

  const list = groups[filter];

  const toggle = (t: Task) => {
    const r = dispatch(t.state === 'open' ? 'task.complete' : 'task.reopen', { taskId: t.id }, me.id);
    if (!r.ok) toast(r.error, 'error');
  };

  return (
    <Drawer
      title="Мои задачи"
      sub={`${me.name}`}
      onClose={onClose}
      actions={
        <Button variant="primary" size="sm" icon={<Plus />} onClick={() => setCreating(true)}>
          Задача
        </Button>
      }
    >
      <Segmented
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'today', label: 'На сегодня', count: groups.today.length },
          { value: 'later', label: 'Позже', count: groups.later.length },
          { value: 'done', label: 'Сделано' },
          { value: 'given', label: 'Поручил я', count: givenOpen || null },
        ]}
      />
      {list.length === 0 ? (
        <EmptyState title={filter === 'done' ? 'Пока ничего не сделано' : filter === 'given' ? 'Вы никому не поручали' : 'Задач нет'}>
          {filter === 'today' ? 'На сегодня всё сделано' : filter === 'given' ? 'Задачи, которые вы поставите сотрудникам, будут здесь — с тем, сделали или нет' : null}
        </EmptyState>
      ) : filter === 'given' ? (
        <div className="card list">
          {list.map((t) => {
            const overdue = t.state === 'open' && t.due < today;
            return (
              <div key={t.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                <div className="grow">
                  <div className={cx('w-600', t.state === 'done' && 'ink-2')}>{t.title}</div>
                  <div className="row t-12 muted" style={{ marginTop: 4, flexWrap: 'wrap' }}>
                    <span className="row" style={{ gap: 4 }}>
                      <UserRound size={12} />
                      <span className="ink-2 w-600">{names.get(t.assigneeId) ?? '—'}</span>
                    </span>
                    {t.state === 'done' ? (
                      <StatusChip s={{ label: `Сделано ${fmt.relDate(t.doneAt, today)}${t.doneAt ? `, ${fmt.time(t.doneAt)}` : ''}`, tone: 'ok' }} />
                    ) : overdue ? (
                      <StatusChip s={{ label: `Просрочена с ${fmt.date(t.due)}`, tone: 'bad' }} />
                    ) : (
                      <StatusChip s={{ label: `В работе, срок ${fmt.relDate(t.due, today)}${t.dueTime ? ` ${t.dueTime}` : ''}`, tone: 'info' }} />
                    )}
                    <span>поручено {fmt.relDate(t.createdAt, today)}</span>
                    {t.link ? <TaskLinkView type={t.link.type} id={t.link.id} /> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="card list">
          {list.map((t) => {
            const overdue = t.state === 'open' && t.due < today;
            return (
              <div key={t.id} className="list-row" style={{ alignItems: 'flex-start' }}>
                <input type="checkbox" className="task-check" checked={t.state === 'done'} onChange={() => toggle(t)} aria-label="Сделано" />
                <div className="grow">
                  <div className={cx('w-600', t.state === 'done' && 'faint')} style={t.state === 'done' ? { textDecoration: 'line-through' } : undefined}>
                    {t.title}
                  </div>
                  <div className="row t-12 muted" style={{ marginTop: 4, flexWrap: 'wrap' }}>
                    {overdue ? <Chip tone="bad">Просрочена с {fmt.date(t.due)}</Chip> : <span>{fmt.relDate(t.due, today)}{t.dueTime ? `, ${t.dueTime}` : ''}</span>}
                    {t.priority === 'high' && t.state === 'open' ? <Chip tone="warn">Срочно</Chip> : null}
                    {t.link ? <TaskLinkView type={t.link.type} id={t.link.id} /> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {creating ? <TaskModal onClose={() => setCreating(false)} /> : null}
    </Drawer>
  );
}

function TaskLinkView({ type, id }: { type: string; id: string }) {
  const db = useDB();
  const map: Record<string, EntityType | undefined> = { client: 'client', order: 'order', delivery: 'delivery', product: 'product', purchase: 'purchase', supplier: 'supplier' };
  const et = map[type];
  let label = '';
  if (type === 'client') label = db.clients.find((c) => c.id === id)?.name ?? '';
  if (type === 'order') label = `Заказ № ${db.orders.find((o) => o.id === id)?.number ?? ''}`;
  if (type === 'delivery') label = `Доставка № ${db.deliveries.find((d) => d.id === id)?.number ?? ''}`;
  if (type === 'product') label = db.products.find((p) => p.id === id)?.name ?? '';
  if (type === 'purchase') label = `Закупка № ${db.purchases.find((p) => p.id === id)?.number ?? ''}`;
  if (type === 'supplier') label = db.suppliers.find((s) => s.id === id)?.name ?? '';
  if (type === 'payment') {
    const p = db.payments.find((x) => x.id === id);
    return p ? (
      <span className="row" style={{ gap: 4 }}>
        <Link2 size={12} />
        <span className="t-12 ink-2">Платёж № {p.number} на {fmt.money(p.amount)}</span>
      </span>
    ) : null;
  }
  if (!et || !label) return null;
  return (
    <span className="row" style={{ gap: 4 }}>
      <Link2 size={12} />
      <EntityLink type={et} id={id}>
        <span className="t-12">{label}</span>
      </EntityLink>
    </span>
  );
}
