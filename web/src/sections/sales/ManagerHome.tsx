import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarClock, CheckCircle2, ChevronRight, Phone, Plus, Repeat } from 'lucide-react';
import type { Client, ID, Order } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { clientBalance, indexes, salesForPeriod } from './data';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { PageHeader } from '../../shell/PageHeader';
import { TaskModal } from '../../shell/TaskModal';
import { Button, Card, Chip, EmptyState, Kpi, ProgressBar, StatusChip, cx, fmt, overdueStatus, toast } from '../../ui';
import { NewOrderDrawer } from './NewOrderDrawer';
import { useSalesOrders } from './salesScope';
import { APPROVAL_STATUS } from './parts';
import { WORK_STAGES, approvalTask, capitalize, fixNo, isFailedOrder, orderProblems, orderShortage } from './lib';
import { clientsWithOpenOrders, missedHabitualOrder } from '../clients/lib';
import './sales.css';

/** Рабочий стол менеджера: заявки, заказы в работе, долги, пропущенные заказы, план и задачи. */
export default function Home() {
  const db = useDB();
  const version = useDBVersion();
  const { me } = useSession();
  const scoped = useScoped();
  const salesOrders = useSalesOrders();
  const openEntity = useOpenEntity();
  const [creating, setCreating] = useState<{ repeatOf?: ID; clientId?: ID } | null>(null);
  const [taskFor, setTaskFor] = useState<Client | null>(null);
  const today = db.meta.today;

  const data = useMemo(() => {
    const idx = indexes(db);
    const orders = salesOrders;
    const requests = orders.filter((o) => o.state === 'request').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const dById = new Map(db.deliveries.map((d) => [d.id, d]));
    const dOf = (o: Order) => (o.deliveryId ? dById.get(o.deliveryId) : undefined);
    // недоставленный заказ снова в работе: диспетчер назначит повтор или вернёт товар на склад
    const work = orders.filter((o) => o.state === 'confirmed' || isFailedOrder(o, dOf(o)));
    // те же этапы и проверки, что у фильтра в списке заказов: строка ведёт в список с этим фильтром
    const stages = WORK_STAGES.map((st) => {
      const list = work.filter((o) => st.test(o, dOf(o)));
      return { key: st.key, label: st.label, n: list.length, sum: list.reduce((s, o) => s + o.total, 0) };
    });
    const requestInfo = new Map(
      requests.map((o) => {
        const c = idx.clients.get(o.clientId);
        return [
          o.id,
          {
            approval: !!approvalTask(db, o.id),
            problems: c ? orderProblems(db, c, o.total).map((p) => p.text) : [],
            short: orderShortage(db, o).length > 0,
            owner: c?.ownerId ? idx.employees.get(c.ownerId) : undefined,
          },
        ] as const;
      }),
    );

    const clients = scoped.clients.filter((c) => c.active);
    const debts = clients
      .map((c) => ({ c, b: clientBalance(db, c.id) }))
      .filter((x) => x.b.debt > 0)
      .sort((a, b) => b.b.overdue - a.b.overdue || b.b.debt - a.b.debt);
    const debtTotal = debts.reduce((s, x) => s + x.b.debt, 0);
    const overdueTotal = debts.reduce((s, x) => s + x.b.overdue, 0);

    const lastOrder = new Map<ID, Order>();
    for (const o of orders) {
      if (o.state === 'cancelled' || o.state === 'draft') continue;
      const prev = lastOrder.get(o.clientId);
      if (!prev || o.createdAt > prev.createdAt) lastOrder.set(o.clientId, o);
    }
    // одно правило с «Клиентами» и сигналами обзора (missedHabitualOrder): активный, не розница, нет заказа в работе,
    // с последней покупки прошло больше привычной частоты × MISSED_ORDER_FACTOR
    const open = clientsWithOpenOrders(db);
    const missed = clients
      .map((c) => {
        const lastAt = clientBalance(db, c.id).lastOrderAt;
        const since = lastAt ? fmt.daysBetween(lastAt.slice(0, 10), today) : null;
        return { c, last: lastOrder.get(c.id), lastAt, since, late: since === null ? 0 : since - (c.orderEveryDays ?? 0) };
      })
      .filter((x) => missedHabitualOrder(x.c, x.since, open.has(x.c.id)))
      .sort((a, b) => b.late - a.late)
      .slice(0, 6);

    const month = today.slice(0, 7);
    const plan = db.plans.find((p) => p.month === month && p.employeeId === me.id);
    const fact = salesForPeriod(db, month + '-01', today, { employeeId: me.id }).revenue;
    const tasks = scoped.myTasks.filter((t) => t.state === 'open' && t.due <= today).sort((a, b) => a.due.localeCompare(b.due) || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99'));
    const workSum = work.reduce((s, o) => s + o.total, 0);
    return { idx, requests, requestInfo, work, workSum, stages, debts, debtTotal, overdueTotal, missed, plan, fact, tasks };
  }, [db, version, scoped, salesOrders, me.id, today]);

  const daysInMonth = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 0).getDate();
  const dayOfMonth = Number(today.slice(8, 10));
  const planPct = data.plan && data.plan.amount > 0 ? (data.fact / data.plan.amount) * 100 : 0;
  const expectedPct = (dayOfMonth / daysInMonth) * 100;

  const doneTask = (id: ID) => {
    const r = dispatch('task.complete', { taskId: id }, me.id);
    if (!r.ok) toast(r.error, 'error');
    else toast('Задача выполнена');
  };

  return (
    <>
      <PageHeader
        section="overview"
        actions={
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating({})} data-hint="sales.home-new">
            Новый заказ
          </Button>
        }
      />

      <div className="grid-4">
        <Kpi label="Заявки ждут подтверждения" value={fmt.num(data.requests.length)} />
        <Kpi label={`Заказы в работе · ${fmt.num(data.work.length)}`} value={fmt.money(data.workSum)} />
        <Kpi label="Долг моих клиентов" value={fmt.money(data.debtTotal)} />
        <Kpi label="Из него просрочено" value={<span className={cx(data.overdueTotal > 0 && 'c-bad')}>{fmt.money(data.overdueTotal)}</span>} />
      </div>

      <div className="sales-home">
        <div className="col-4">
          <Card
            hint="sales.home-requests"
            title="Заявки ждут подтверждения"
            actions={
              data.requests.length ? (
                <Chip tone="violet">{fmt.count(data.requests.length, 'заявка', 'заявки', 'заявок')}</Chip>
              ) : undefined
            }
            flush
          >
            {data.requests.length ? (
              <div className="list">
                {data.requests.slice(0, 6).map((o) => {
                  const c = data.idx.clients.get(o.clientId);
                  const a = data.idx.employees.get(o.authorId);
                  const info = data.requestInfo.get(o.id);
                  const owner = info?.owner;
                  // чей клиент: ваш, представителя или без ответственного; автор — если это не ответственный
                  const whose = !owner ? 'Клиент без ответственного' : owner.id === me.id ? 'Ваш клиент' : `Клиент ${owner.short}`;
                  const by = o.authorId === me.id ? 'ваш заказ' : a && a.id !== owner?.id ? `заявка ${a.short}` : null;
                  const flags = info?.approval || info?.problems.length || info?.short;
                  return (
                    <button key={o.id} type="button" className="list-row sales-req-row" onClick={() => openEntity('order', o.id)}>
                      <div className="grow">
                        <div className="row" style={{ gap: 6 }}>
                          <span className="w-700 nowrap">№ {o.number}</span>
                          <span className="w-600 ellipsis">{c?.name}</span>
                        </div>
                        <div className="muted t-12 ellipsis">{[whose, by, fmt.dateTime(o.createdAt)].filter(Boolean).join(' · ')}</div>
                        {flags ? (
                          <span className="chips sales-req-chips" data-hint="sales.home-req-flags">
                            {info?.approval ? (
                              <StatusChip s={APPROVAL_STATUS} />
                            ) : info?.problems.length ? (
                              <Chip tone="bad" title={capitalize(info.problems.join('; '))}>
                                Нужно согласие владельца
                              </Chip>
                            ) : null}
                            {info?.short ? <Chip tone="warn">Не хватает товара</Chip> : null}
                          </span>
                        ) : null}
                      </div>
                      <span className="num w-700 nowrap">{fmt.money(o.total)}</span>
                      <ChevronRight size={16} className="faint" />
                    </button>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="Заявок нет — все подтверждены" />
            )}
          </Card>

          <Card hint="sales.home-stages" title="Мои заказы в работе" actions={<Link to="/sales" className="sales-more-link">Все заказы<ChevronRight size={14} /></Link>} flush>
            <div className="list">
              {data.stages
                .filter((s) => s.n > 0 || (s.key !== 'failed' && s.key !== 'nodelivery'))
                .map((s) => {
                  const tone = s.key === 'failed' ? 'bad' : s.key === 'nodelivery' ? 'warn' : null;
                  return (
                    <Link key={s.key} to={`/sales?stage=${s.key}`} className="list-row sales-stage-row">
                      <span className={cx('grow w-600', tone === 'bad' ? 'c-bad' : tone === 'warn' ? 'c-warn' : 'ink-2')}>{s.label}</span>
                      <span className="muted t-12 num">{s.n && s.key !== 'nodelivery' ? fmt.money(s.sum) : ''}</span>
                      <span className={cx('sales-count', s.n > 0 && (tone ? `is-${tone}` : 'is-on'))}>{s.n}</span>
                      <ChevronRight size={16} className="faint" />
                    </Link>
                  );
                })}
            </div>
          </Card>

          {data.missed.length ? (
            <Card hint="sales.home-missed" title="Пропустили привычный заказ" flush>
              <div className="list">
                {data.missed.map(({ c, last, lastAt, late }) => (
                  <div key={c.id} className="list-row">
                    <div className="grow">
                      <EntityLink type="client" id={c.id} className="entity-link">
                        {c.name}
                      </EntityLink>
                      <div className="muted t-12">
                        Заказывает раз в {fmt.count(c.orderEveryDays ?? 0, 'день', 'дня', 'дней')} · последняя покупка {lastAt ? fmt.date(lastAt) : '—'}
                      </div>
                    </div>
                    <Chip tone="warn">Позже на {fmt.count(late, 'день', 'дня', 'дней')}</Chip>
                    <Button size="sm" variant="ghost" iconOnly aria-label="Задача: позвонить" title="Поставить задачу: позвонить" onClick={() => setTaskFor(c)}>
                      <Phone />
                    </Button>
                    {last ? (
                      <Button size="sm" icon={<Repeat />} onClick={() => setCreating({ repeatOf: last.id })}>
                        Повторить
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            // пусто — одна строка вместо большой пустой карточки
            <div className="card sales-missed-none">
              <CheckCircle2 />
              <span>Привычный заказ никто не пропустил: постоянные клиенты заказывают вовремя</span>
            </div>
          )}
        </div>

        <div className="col-4">
          <Card hint="sales.home-plan" title={`План на ${fmt.monthName(today.slice(0, 7), false).toLowerCase()}`}>
            {data.plan ? (
              <div className="col-3">
                <div className="row" style={{ alignItems: 'baseline' }}>
                  <span className="t-24 w-700 num">{fmt.money(data.fact)}</span>
                  <span className="muted t-13 grow">из {fmt.money(data.plan.amount)}</span>
                  <span className={cx('t-16 w-700', planPct >= expectedPct ? 'c-ok' : 'c-warn')}>{fmt.pct(planPct, 0)}</span>
                </div>
                <div className="sales-plan-bar">
                  <ProgressBar value={data.fact} max={data.plan.amount} tone={planPct >= expectedPct ? 'ok' : 'warn'} />
                  <span className="sales-plan-mark" style={{ left: `${Math.min(100, expectedPct)}%` }} title={`По графику на сегодня — ${fmt.pct(expectedPct, 0)}`} />
                </div>
                <div className="row t-13">
                  <span className="muted grow">Осталось продать</span>
                  <span className="w-600 num">{fmt.money(Math.max(0, data.plan.amount - data.fact))}</span>
                </div>
                <div className="row t-13">
                  <span className="muted grow">Рабочих дней до конца месяца</span>
                  <span className="w-600 num">{workdaysLeft(today)}</span>
                </div>
              </div>
            ) : (
              <EmptyState title="План на месяц не задан">Владелец ставит план в настройках команды</EmptyState>
            )}
          </Card>

          <Card hint="sales.home-tasks" title="Задачи на сегодня" flush>
            {data.tasks.length ? (
              <div className="list">
                {data.tasks.slice(0, 7).map((t) => {
                  const overdue = t.due < today;
                  return (
                    <div key={t.id} className="list-row sales-task">
                      <input type="checkbox" className="task-check" onChange={() => doneTask(t.id)} aria-label="Выполнено" />
                      <span className="grow">
                        <span className="w-600" style={{ display: 'block' }}>
                          {fixNo(t.title)}
                        </span>
                        <span className={cx('t-12', overdue ? 'c-bad w-600' : 'muted')}>
                          {overdue ? `Просрочена с ${fmt.date(t.due)}` : t.dueTime ? `Сегодня до ${t.dueTime}` : 'Сегодня'}
                          {t.priority === 'high' ? ' · срочно' : ''}
                        </span>
                      </span>
                      {t.link && (t.link.type === 'order' || t.link.type === 'client') ? (
                        <EntityLink type={t.link.type} id={t.link.id} className="link-button t-12">
                          Открыть
                        </EntityLink>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState icon={<CalendarClock />} title="На сегодня всё сделано" />
            )}
          </Card>

          <Card hint="sales.home-debts" title="Долги и просрочка" actions={<Link to="/money/debts" className="sales-more-link">Все долги<ChevronRight size={14} /></Link>} flush>
            {data.debts.length ? (
              <div className="list">
                {data.debts.slice(0, 6).map(({ c, b }) => (
                  <button key={c.id} type="button" className="list-row" onClick={() => openEntity('client', c.id)}>
                    <span className="grow">
                      <span className="w-600 ellipsis" style={{ display: 'block' }}>
                        {c.name}
                      </span>
                      <span className="muted t-12">
                        Долг {fmt.money(b.debt)}
                        {b.overdue > 0 ? ` · просрочено ${fmt.money(b.overdue)}` : ''}
                      </span>
                    </span>
                    {b.maxOverdueDays > 0 ? <StatusChip s={overdueStatus(b.maxOverdueDays)} /> : <span className="t-12 muted">в срок</span>}
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState title="Долгов нет — все клиенты расплатились" />
            )}
          </Card>
        </div>
      </div>

      {creating ? <NewOrderDrawer repeatOf={creating.repeatOf} clientId={creating.clientId} onClose={() => setCreating(null)} /> : null}
      {taskFor ? <TaskModal link={{ type: 'client', id: taskFor.id }} defaultTitle={`Позвонить: ${taskFor.name} — пропустил привычный заказ`} onClose={() => setTaskFor(null)} /> : null}
    </>
  );
}

function workdaysLeft(today: string): number {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const last = new Date(y, m, 0).getDate();
  let n = 0;
  for (let d = Number(today.slice(8, 10)) + 1; d <= last; d++) if (new Date(y, m - 1, d).getDay() !== 0) n++;
  return n;
}
