import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarPlus, CheckCircle2, ListPlus, MapPin, Navigation, Phone, PhoneCall, PlayCircle, ShoppingCart, UserRound, Wifi, WifiOff, XCircle } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { TaskModal } from '../../shell/TaskModal';
import type { Client, ClientPoint, ID, Order, Task, Visit, VisitResult } from '../../data/types';
import { dispatch, nowDemo, useDB, useDBVersion } from '../../data/store';
import { clientBalances, indexes, orderPayment, type ClientBalance } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { Button, Card, Chip, EmptyState, MoreMenu, Notice, ProgressBar, StatusChip, VISIT_RESULT, VISIT_STATE, cx, fmt, overdueStatus, toast, type MenuItem } from '../../ui';
import { PlanVisitModal } from './PlanVisitModal';
import { VisitResultSheet } from './VisitResultSheet';
import { callPhone, deliveriesById, habitualProducts, lastPurchases, mapUrl, ordersByClient, pointOf, repStats, telUrl, useStored } from './lib';
import { PlanBar, planLabel, planTitle, visitTimes } from './parts';
import { NewOrderDrawer } from '../sales/NewOrderDrawer';
import { NOT_SENT, OrderBrief } from '../sales/parts';
import { productName } from '../sales/lib';
import { setOffline, useOffline } from '../sales/offline';
import { UndoToastHost, undoToast } from './UndoToast';
import './clients.css';

function clockNow(): string {
  const n: unknown = nowDemo();
  if (typeof n === 'string' && n.length >= 16) return n.slice(11, 16);
  const d = n instanceof Date ? n : new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Рабочий стол: представитель, мой день. Сначала телефон 390 px, на компьютере — две колонки. */
export default function Home() {
  const db = useDB();
  const version = useDBVersion();
  const { me, can } = useSession();
  const scoped = useScoped();
  const open = useOpenEntity();
  const today = db.meta.today;

  // «нет связи» — общее хранилище с окном заявки и списком заказов
  const offline = useOffline();
  const [started, setStarted] = useStored<Record<ID, string>>('bm-rep-started', {});
  const [sheet, setSheet] = useState<{ id: ID; preset?: VisitResult; noOrder?: boolean } | null>(null);
  const [orderFor, setOrderFor] = useState<Visit | null>(null);
  const [planning, setPlanning] = useState(false);
  const [taskFor, setTaskFor] = useState<ID | null>(null);

  const day = useMemo(() => {
    const idx = indexes(db);
    const bal = clientBalances(db);
    const last = lastPurchases(db);
    const todays = scoped.visits.filter((v) => v.date === today).sort((a, b) => a.routeOrder - b.routeOrder || a.time.localeCompare(b.time));
    const planned = todays.filter((v) => v.state === 'planned');
    const done = todays.filter((v) => v.state !== 'planned').sort((a, b) => (b.doneAt ?? b.time).localeCompare(a.doneAt ?? a.time));
    const stats = repStats(db, me);
    const tasks = scoped.myTasks
      .filter((t) => (t.state === 'open' && t.due <= today) || (t.state === 'done' && (t.doneAt ?? '').startsWith(today)))
      .sort((a, b) => (a.state === b.state ? a.due.localeCompare(b.due) || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99') : a.state === 'open' ? -1 : 1));
    const debtors = scoped.clients
      .map((c) => ({ c, b: bal.get(c.id)! }))
      .filter((x) => x.b && x.b.debt > 0)
      .sort((a, b) => b.b.maxOverdueDays - a.b.maxOverdueDays || b.b.debt - a.b.debt);
    const debtTotal = debtors.reduce((s, x) => s + x.b.debt, 0);
    return { idx, bal, last, todays, planned, done, stats, tasks, debtors, debtTotal };
  }, [db, version, scoped, today, me]);

  const activeId = day.planned.find((v) => started[v.id])?.id ?? day.planned[0]?.id ?? null;
  const sheetVisit = sheet ? day.todays.find((v) => v.id === sheet.id) ?? null : null;
  const forget = (visitId: ID) =>
    setStarted((st) => {
      const next = { ...st };
      delete next[visitId];
      return next;
    });
  const queued = offline.queued.filter((id) => db.orders.some((o) => o.id === id));

  const start = (v: Visit) => {
    setStarted((s) => ({ ...s, [v.id]: clockNow() }));
  };

  const skip = (v: Visit) => {
    const r = dispatch('visit.complete', { visitId: v.id, missed: true }, me.id);
    if (!r.ok) toast(r.error, 'error');
    else toast('Визит отмечен как несостоявшийся');
  };

  const toggleOffline = () => {
    if (offline.on) {
      const n = queued.length;
      setOffline({ on: false, queued: [] });
      toast(n ? `Связь есть: ${fmt.count(n, 'заявка отправлена', 'заявки отправлены', 'заявок отправлено')}, цены и наличие проверены` : 'Связь есть');
    } else {
      setOffline({ on: true, queued: [] });
      toast('Работаем без связи: заявки сохранятся в телефоне');
    }
  };

  const menu: MenuItem[] = [
    { label: 'Запланировать визит', icon: <CalendarPlus />, onClick: () => setPlanning(true), hidden: !can('planVisits') },
    { label: 'Новая задача', icon: <ListPlus />, onClick: () => setTaskFor('') },
    { label: 'sep', separator: true },
    { label: offline.on ? 'Связь появилась' : 'Нет связи', icon: offline.on ? <Wifi /> : <WifiOff />, onClick: toggleOffline },
  ];

  const s = day.stats;
  const missedToday = day.done.filter((v) => v.state === 'missed').length;
  const wd = fmt.weekday(today);

  return (
    <>
      <PageHeader
        section="overview"
        title={
          <>
            Мой день <span className="cl-title-date">{`${wd[0].toUpperCase()}${wd.slice(1)}, ${fmt.date(today)}`}</span>
          </>
        }
        actions={
          <span className="cl-head-actions" data-hint="rep.more">
            <MoreMenu items={menu} label="Ещё" />
          </span>
        }
      />

      <div className="cl-day-stats" data-hint="rep.day-stats">
        <div className="card cl-day-stat" title={missedToday ? `Выполнено ${s.todayDone}, пропущено ${missedToday}, всего на сегодня ${s.todayTotal}` : undefined}>
          <div className="cl-day-label">Визиты сегодня</div>
          <div className="cl-day-value">
            {s.todayDone} <span className="muted">из {s.todayTotal}</span>
          </div>
          <ProgressBar value={s.todayDone} max={s.todayTotal || 1} thin tone="info" />
        </div>
        <div
          className="card cl-day-stat"
          title={s.ordersToday ? `Оформлено сегодня: ${fmt.count(s.ordersToday, 'заказ', 'заказа', 'заказов')}${s.ordersTodayWaiting ? `, ждут подтверждения — ${s.ordersTodayWaiting}` : ''}. В план входят после отгрузки.` : 'Сегодня заказов ещё нет'}
        >
          <div className="cl-day-label">Заказы сегодня</div>
          <div className="cl-day-value">{s.ordersTodaySum ? (s.ordersTodaySum >= 100_000 ? fmt.moneyShort(s.ordersTodaySum) : fmt.money(s.ordersTodaySum)) : '—'}</div>
        </div>
        <div className="card cl-day-stat is-plan" title={planTitle(s)}>
          <div className="cl-day-label">{planLabel(s)}</div>
          <div className="cl-day-value">
            {s.plan ? (
              <>
                {fmt.money(s.fact)} <span className="muted cl-day-of">из {fmt.money(s.plan)}</span>
              </>
            ) : (
              '—'
            )}
          </div>
          <PlanBar s={s} thin />
        </div>
      </div>

      {offline.on ? (
        <div data-hint="rep.offline">
        <Notice
          tone="warn"
          title="Нет связи"
          action={
            <Button size="sm" icon={<Wifi />} onClick={toggleOffline}>
              Связь есть
            </Button>
          }
        >
          {queued.length
            ? `${fmt.count(queued.length, 'заявка отправится', 'заявки отправятся', 'заявок отправятся')}, когда связь появится. Цены и наличие проверим заново.`
            : 'Заявки сохранятся в телефоне и отправятся, когда связь появится. Цены и наличие проверим заново.'}
        </Notice>
        </div>
      ) : null}

      <div className="cl-rep-layout">
        <div className="col-4">
          <div className="row">
            <h2 className="t-16 w-700 grow">Маршрут на сегодня</h2>
            <span className="muted t-13">
              {day.planned.length ? `осталось ${fmt.count(day.planned.length, 'точка', 'точки', 'точек')}` : 'все точки пройдены'}
            </span>
          </div>
          {day.planned.length ? (
            day.planned.map((v) => {
              const c = day.idx.clients.get(v.clientId);
              if (!c) return null;
              return (
                <RouteCard
                  key={v.id}
                  v={v}
                  n={day.todays.indexOf(v) + 1}
                  c={c}
                  point={pointOf(c, v.pointId)}
                  b={day.bal.get(c.id)}
                  last={day.last.get(c.id)}
                  today={today}
                  primary={v.id === activeId}
                  startedAt={started[v.id] ?? null}
                  onStart={() => start(v)}
                  onOrder={() => setOrderFor(v)}
                  onResult={(preset, noOrder) => setSheet({ id: v.id, preset, noOrder })}
                  onOpen={() => open('client', c.id)}
                  onSkip={() => skip(v)}
                  onTask={() => setTaskFor(c.id)}
                />
              );
            })
          ) : (
            <Card>
              <EmptyState icon={<CheckCircle2 />} title={day.todays.length ? 'Маршрут пройден' : 'На сегодня визитов нет'}>
                {day.todays.length ? 'Все визиты отмечены. Загляните в долги клиентов ниже.' : 'Запланируйте визит через меню «Ещё»'}
              </EmptyState>
            </Card>
          )}

          {day.done.length ? (
            <Card
              hint="rep.done"
              title="Сделано сегодня"
              actions={
                <span className="muted t-13">
                  {missedToday ? `выполнено ${day.done.length - missedToday} · пропущено ${missedToday}` : fmt.count(day.done.length, 'визит', 'визита', 'визитов')}
                </span>
              }
              flush
            >
              <div className="cl-list is-flush">
                {day.done.map((v) => {
                  const c = day.idx.clients.get(v.clientId);
                  const o = v.orderId ? day.idx.orders.get(v.orderId) : undefined;
                  const st = v.state === 'done' && v.result ? VISIT_RESULT[v.result] : VISIT_STATE[v.state];
                  return (
                    <div key={v.id} className="cl-list-row is-top">
                      <span className="cl-list-main">
                        <EntityLink type="client" id={v.clientId}>
                          {c?.name ?? 'Клиент'}
                        </EntityLink>
                        <span className="t-12 ink-2 w-600">{visitTimes(v)}</span>
                        <span className="muted t-12">{[v.refusalReason, v.comment].filter(Boolean).join(' · ') || pointOf(c, v.pointId)?.address}</span>
                      </span>
                      <span className="chips cl-list-chips">
                        <StatusChip s={st} />
                        {o ? (
                          <EntityLink type="order" id={o.id}>
                            № {o.number} · {fmt.money(o.total)}
                          </EntityLink>
                        ) : null}
                        {o && queued.includes(o.id) ? <StatusChip s={NOT_SENT} /> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}
        </div>

        <div className="col-4">
          <TasksCard tasks={day.tasks} today={today} />
          <Card
            hint="rep.debts"
            title="Долги моих клиентов"
            actions={day.debtTotal ? <span className="w-700 num">{fmt.money(day.debtTotal)}</span> : null}
            flush
            foot={
              day.debtors.length > 8 ? (
                <Link to="/clients" className="link-button t-13">
                  Все клиенты: {day.debtors.length} с долгом
                </Link>
              ) : undefined
            }
          >
            {day.debtors.length ? (
              <div className="cl-list is-flush">
                {day.debtors.slice(0, 8).map(({ c, b }) => (
                  <button key={c.id} type="button" className="cl-list-row" onClick={() => open('client', c.id)}>
                    <span className="cl-list-main">
                      <span className="w-600 ellipsis">{c.name}</span>
                      {b.pending > 0 ? <PendingLine amount={b.pending} /> : null}
                      {b.maxOverdueDays > 0 || (c.creditLimit > 0 && b.debt > c.creditLimit) ? (
                        <span className="chips">
                          {b.maxOverdueDays > 0 ? <StatusChip s={overdueStatus(b.maxOverdueDays)} /> : null}
                          {c.creditLimit > 0 && b.debt > c.creditLimit ? <Chip tone="bad">Сверх лимита</Chip> : null}
                        </span>
                      ) : null}
                    </span>
                    <span className={cx('num w-700 cl-list-sum', b.maxOverdueDays > 0 && 'c-bad')}>{fmt.money(b.debt)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState icon={<CheckCircle2 />} title="Долгов нет">Все клиенты рассчитались</EmptyState>
            )}
          </Card>
        </div>
      </div>

      {sheetVisit && sheet ? (
        <VisitResultSheet
          visit={sheetVisit}
          offline={offline.on}
          initialResult={sheet.preset}
          noOrder={sheet.noOrder}
          onClose={() => setSheet(null)}
          onDone={() => {
            // заявку без связи окно заказа само ставит в очередь
            setSheet(null);
            forget(sheetVisit.id);
          }}
        />
      ) : null}
      {orderFor ? (
        // заявка из визита: клиент и точка уже выбраны, после отправки визит закрывается с результатом «Заказ»
        <NewOrderDrawer
          clientId={orderFor.clientId}
          pointId={orderFor.pointId}
          visitId={orderFor.id}
          source="rep"
          onClose={() => setOrderFor(null)}
          onCreated={() => {
            forget(orderFor.id);
            setOrderFor(null);
          }}
        />
      ) : null}
      <UndoToastHost />
      {planning ? <PlanVisitModal repId={me.id} onClose={() => setPlanning(false)} /> : null}
      {taskFor !== null ? <TaskModal link={taskFor ? { type: 'client', id: taskFor } : null} onClose={() => setTaskFor(null)} /> : null}
    </>
  );
}

/* ---------- карточка точки маршрута ---------- */

function RouteCard({
  v,
  n,
  c,
  point,
  b,
  last,
  today,
  primary,
  startedAt,
  onStart,
  onOrder,
  onResult,
  onOpen,
  onSkip,
  onTask,
}: {
  v: Visit;
  n: number;
  c: Client;
  point: ClientPoint | null;
  b: ClientBalance | undefined;
  last: { at: string; total: number } | undefined;
  today: string;
  primary: boolean;
  startedAt: string | null;
  onStart: () => void;
  onOrder: () => void;
  onResult: (preset?: VisitResult, noOrder?: boolean) => void;
  onOpen: () => void;
  onSkip: () => void;
  onTask: () => void;
}) {
  const tel = telUrl(callPhone(c));
  const over = !!b && c.creditLimit > 0 && b.debt > c.creditLimit;
  const pending = b?.pending ?? 0;
  return (
    <article className={cx('card cl-route-card', primary && 'is-next')} data-hint="rep.route">
      <div className="cl-route-top">
        <span className="cl-route-num">{n}</span>
        <span className="cl-route-time" title="Время по плану">
          {v.time}
        </span>
        {startedAt ? (
          <Chip tone="info" icon={<PlayCircle />}>
            Идёт с {startedAt}
          </Chip>
        ) : null}
        <span className="spacer" />
        <MoreMenu
          items={[
            { label: 'Карточка клиента', icon: <UserRound />, onClick: onOpen },
            { label: 'Задача по клиенту', icon: <ListPlus />, onClick: onTask },
            { label: 'sep', separator: true },
            { label: 'Визит не состоялся', icon: <XCircle />, onClick: onSkip, danger: true },
          ]}
        />
      </div>

      <button type="button" className="cl-route-name" onClick={onOpen}>
        {c.name}
      </button>
      {point ? (
        <div className="cl-route-addr">
          <MapPin />
          <span>
            {point.name !== c.name ? <span className="ink-2 w-600">{point.name} · </span> : null}
            {point.address}
            {point.district ? `, ${point.district.replace(' район', ' р-н')}` : ''}
          </span>
        </div>
      ) : null}

      {b && (b.debt > 0 || over) ? (
        <div className="chips">
          {b.debt > 0 ? <Chip tone={b.maxOverdueDays > 0 ? 'bad' : 'warn'}>Долг {fmt.money(b.debt)}</Chip> : null}
          {b.maxOverdueDays > 0 ? <StatusChip s={overdueStatus(b.maxOverdueDays)} /> : null}
          {over ? <Chip tone="bad">Сверх лимита</Chip> : null}
        </div>
      ) : (
        <div className="chips">
          <Chip tone="ok">Без долга</Chip>
        </div>
      )}
      {pending > 0 ? <PendingLine amount={pending} /> : null}

      {startedAt ? (
        <VisitContext c={c} />
      ) : (
        <div className="cl-route-last">
          <span className="muted">Последняя покупка</span>
          <span className="w-600">{last ? `${fmt.relDate(last.at, today)} · ${fmt.money(last.total)}` : 'Ещё не покупал'}</span>
        </div>
      )}
      {v.comment ? <div className="cl-route-note">{v.comment}</div> : null}

      <div className="cl-route-actions" data-hint="rep.call">
        {tel ? (
          <a className="btn btn-secondary btn-lg" href={tel}>
            <Phone />
            Позвонить
          </a>
        ) : (
          <Button size="lg" icon={<Phone />} disabled>
            Нет телефона
          </Button>
        )}
        {point ? (
          <a className="btn btn-secondary btn-lg" href={mapUrl(point)} target="_blank" rel="noreferrer">
            <Navigation />
            Карта
          </a>
        ) : null}
      </div>
      {startedAt ? (
        <>
          {/* визит идёт: главное — заявка; отказ, перезвонить и «без заказа» — второстепенные */}
          <Button variant="primary" size="lg" block icon={<ShoppingCart />} onClick={onOrder} data-hint="rep.order">
            Оформить заявку
          </Button>
          <div className="cl-route-results" data-hint="rep.results">
            <Button size="lg" icon={<XCircle />} onClick={() => onResult('refusal')}>
              Отказ
            </Button>
            <Button size="lg" icon={<PhoneCall />} onClick={() => onResult('callback')}>
              Перезвонить
            </Button>
            <Button size="lg" onClick={() => onResult(undefined, true)}>
              Без заказа
            </Button>
          </div>
        </>
      ) : (
        <Button variant={primary ? 'primary' : 'secondary'} size="lg" block icon={<PlayCircle />} onClick={onStart} data-hint="rep.start">
          Начать визит
        </Button>
      )}
    </article>
  );
}

/** Перевод на подтверждении банка: клиент уже заплатил — за этими деньгами не звонить. */
function PendingLine({ amount }: { amount: number }) {
  return <div className="cl-pending">Перевод {fmt.money(amount)} ждёт подтверждения</div>;
}

/** Идёт визит: последние заказы и привычные товары клиента — под рукой, пока говоришь с закупщиком. */
function VisitContext({ c }: { c: Client }) {
  const db = useDB();
  const version = useDBVersion();
  const { me } = useSession();
  const data = useMemo(() => {
    const dl = deliveriesById(db);
    const orders: Order[] = (ordersByClient(db).get(c.id) ?? []).filter((o) => o.state !== 'cancelled' && (o.state !== 'draft' || o.authorId === me.id)).slice(0, 3);
    const products = indexes(db).products;
    const habit = habitualProducts(db, c.id, 4).map((h) => ({ ...h, name: productName(products.get(h.productId)) }));
    return { orders: orders.map((o) => ({ o, pay: orderPayment(db, o), d: o.deliveryId ? dl.get(o.deliveryId) : undefined })), habit };
  }, [db, version, c.id, me.id]);
  return (
    <div className="cl-visit-ctx" data-hint="rep.visit-ctx">
      <div className="cl-visit-ctx-block">
        <div className="cl-visit-ctx-title">Последние заказы</div>
        {data.orders.length ? (
          data.orders.map(({ o, pay, d }) => (
            <EntityLink key={o.id} type="order" id={o.id} className="cl-visit-order">
              <span className="row" style={{ gap: 8 }}>
                <span className="w-600">№ {o.number}</span>
                <span className="muted t-12 grow">{fmt.date(o.createdAt)}</span>
                <span className="num w-600">{fmt.money(o.total)}</span>
              </span>
              <OrderBrief o={o} pay={pay} delivery={d} rep />
            </EntityLink>
          ))
        ) : (
          <div className="muted t-13">Заказов ещё не было</div>
        )}
      </div>
      <div className="cl-visit-ctx-block">
        <div className="cl-visit-ctx-title">Привычные товары</div>
        {data.habit.length ? (
          data.habit.map((h) => (
            <div key={h.productId} className="cl-visit-habit">
              <span className="grow">{h.name}</span>
              <span className="muted t-12 nowrap">
                в {h.orders} из {h.total}
              </span>
            </div>
          ))
        ) : (
          <div className="muted t-13">Пока мало заказов, чтобы понять привычки</div>
        )}
      </div>
    </div>
  );
}

/* ---------- задачи на сегодня ---------- */

function TasksCard({ tasks, today }: { tasks: Task[]; today: string }) {
  const { me } = useSession();
  const db = useDB();
  const open = useOpenEntity();
  const idx = indexes(db);
  const toggle = (t: Task) => {
    const wasOpen = t.state === 'open';
    const r = dispatch(wasOpen ? 'task.complete' : 'task.reopen', { taskId: t.id }, me.id);
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    if (wasOpen)
      undoToast('Задача выполнена', () => {
        const back = dispatch('task.reopen', { taskId: t.id }, me.id);
        if (!back.ok) toast(back.error, 'error');
      });
  };
  // нажатие на текст открывает то, о чём задача: клиента или заказ
  const openLink = (t: Task) => {
    if (t.link && (t.link.type === 'client' || t.link.type === 'order' || t.link.type === 'delivery' || t.link.type === 'product')) open(t.link.type, t.link.id);
  };
  const openCount = tasks.filter((t) => t.state === 'open').length;
  return (
    <Card hint="rep.tasks" title="Мои задачи на сегодня" actions={<span className="muted t-13">{openCount ? `осталось ${openCount}` : 'всё сделано'}</span>} flush>
      {tasks.length ? (
        <div className="cl-list is-flush">
          {tasks.map((t) => {
            const overdue = t.state === 'open' && t.due < today;
            const client = t.link?.type === 'client' ? idx.clients.get(t.link.id) : undefined;
            const linked = !!t.link && t.link.type !== 'payment' && t.link.type !== 'purchase' && t.link.type !== 'supplier';
            return (
              <div key={t.id} className="cl-list-row is-top cl-task-row">
                {/* отметить выполненной — только квадратом (зона нажатия 44 px) */}
                <label className="cl-task-hit" title={t.state === 'done' ? 'Вернуть в работу' : 'Отметить выполненной'}>
                  <input type="checkbox" className="task-check" checked={t.state === 'done'} onChange={() => toggle(t)} aria-label={t.state === 'done' ? 'Вернуть в работу' : 'Сделано'} />
                </label>
                <button type="button" className="cl-list-main cl-task-text" onClick={() => openLink(t)} disabled={!linked} aria-label={linked ? `${t.title} — открыть` : t.title}>
                  <span className={cx('w-600', t.state === 'done' && 'cl-done')}>{t.title}</span>
                  <span className="muted t-12">
                    {t.dueTime ? `${t.dueTime} · ` : ''}
                    {client ? client.name : fmt.relDate(t.due, today)}
                  </span>
                </button>
                <span className="chips cl-list-chips">
                  {overdue ? <Chip tone="bad">Просрочена</Chip> : null}
                  {t.priority === 'high' && t.state === 'open' && !overdue ? <Chip tone="warn">Срочно</Chip> : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={<CheckCircle2 />} title="Задач на сегодня нет">Новая задача — в меню «Ещё»</EmptyState>
      )}
    </Card>
  );
}
