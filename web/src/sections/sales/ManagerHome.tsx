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
import { deliveryFailed } from './parts';
import { fixNo } from './lib';
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
    // недоставленный заказ снова в работе: диспетчер назначит повтор или вернёт товар на склад
    const isFailed = (o: Order) => (o.state === 'confirmed' || o.state === 'closed') && deliveryFailed(o, o.deliveryId ? dById.get(o.deliveryId) : undefined);
    const work = orders.filter((o) => o.state === 'confirmed' || isFailed(o));
    const group = (test: (o: Order) => boolean) => {
      const list = work.filter(test);
      return { n: list.length, sum: list.reduce((s, o) => s + o.total, 0) };
    };
    const onWay = (o: Order) => {
      const d = o.deliveryId ? dById.get(o.deliveryId) : undefined;
      return !!d && d.state === 'on_way';
    };
    const stages = [
      { key: 'wait', label: 'Ждут сборки', ...group((o) => o.pick === 'none' && o.ship === 'none') },
      { key: 'picking', label: 'Собираются', ...group((o) => o.pick === 'picking') },
      { key: 'picked', label: 'Собраны, ждут отгрузки', ...group((o) => o.pick === 'picked' && o.ship === 'none' && !onWay(o)) },
      { key: 'way', label: 'У курьера в пути', ...group((o) => onWay(o)) },
      { key: 'partial', label: 'Отгружены частично', ...group((o) => o.ship === 'partial') },
    ];
    const failed = group(isFailed);
    const noDelivery = work.filter((o) => o.fulfillment === 'delivery' && !o.deliveryId && o.ship === 'none').length;

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
    return { idx, requests, work, workSum, stages, failed, noDelivery, debts, debtTotal, overdueTotal, missed, plan, fact, tasks };
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
          <Button variant="primary" icon={<Plus />} onClick={() => setCreating({})}>
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
                  const b = clientBalance(db, o.clientId);
                  return (
                    <div key={o.id} className="list-row">
                      <div className="grow">
                        <div className="row" style={{ gap: 6 }}>
                          <span className="w-700">№ {o.number}</span>
                          <span className="w-600 ellipsis">{c?.name}</span>
                        </div>
                        <div className="muted t-12">
                          {o.authorId === me.id ? 'Ваш заказ сверх условий' : a?.short} · {fmt.dateTime(o.createdAt)} · {fmt.count(o.lines.length, 'позиция', 'позиции', 'позиций')}
                        </div>
                      </div>
                      {o.authorId === me.id ? <Chip tone="warn">У владельца</Chip> : b.maxOverdueDays > 0 ? <StatusChip s={overdueStatus(b.maxOverdueDays)} /> : null}
                      <span className="num w-700">{fmt.money(o.total)}</span>
                      <Button size="sm" onClick={() => openEntity('order', o.id)}>
                        Открыть
                      </Button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="Заявок нет — все подтверждены" />
            )}
          </Card>

          <Card title="Мои заказы в работе" actions={<Link to="/sales" className="sales-more-link">Все заказы<ChevronRight size={14} /></Link>} flush>
            <div className="list">
              {data.stages.map((s) => (
                <div key={s.key} className="list-row">
                  <span className="grow ink-2 w-600">{s.label}</span>
                  <span className="muted t-12 num">{s.n ? fmt.money(s.sum) : ''}</span>
                  <span className={cx('sales-count', s.n > 0 && 'is-on')}>{s.n}</span>
                </div>
              ))}
              {data.failed.n ? (
                <div className="list-row">
                  <span className="grow c-bad w-600">Не доставлены</span>
                  <span className="muted t-12 num">{fmt.money(data.failed.sum)}</span>
                  <span className="sales-count is-bad">{data.failed.n}</span>
                </div>
              ) : null}
              {data.noDelivery ? (
                <div className="list-row">
                  <span className="grow c-warn w-600">Доставка не оформлена</span>
                  <span className="sales-count is-warn">{data.noDelivery}</span>
                </div>
              ) : null}
            </div>
          </Card>

          {data.missed.length ? (
            <Card title="Пропустили привычный заказ" flush>
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
          <Card title={`План на ${fmt.monthName(today.slice(0, 7), false).toLowerCase()}`}>
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

          <Card title="Задачи на сегодня" flush>
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

          <Card title="Долги и просрочка" actions={<Link to="/money/debts" className="sales-more-link">Все долги<ChevronRight size={14} /></Link>} flush>
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
