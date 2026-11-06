/* Рабочий стол бухгалтера: что проверить и провести сегодня. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, ChevronRight, FileSearch, HandCoins, ListChecks } from 'lucide-react';
import type { Task } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { clientBalances, courierCash, indexes, shiftSummary } from '../../data/selectors';
import { plusDays } from '../../data/dates';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity, type EntityType } from '../../shell/entities';
import { useScoped } from '../../roles/scope';
import { useSession } from '../../roles/session';
import { Button, Card, Chip, EmptyState, Kpi, MoreMenu, StatusChip, cx, fmt, overdueStatus, toast } from '../../ui';
import { MoneyModalHost, useMoneyMenu, type MoneyModal } from './actions';
import { KpiLink, MoneyLi } from './parts';
import { clean, supplierWeekDues, useMoneyPerms } from './lib';
import { arrangeSignals, attentionCount, computeSignals, loadResolved, signalsForRole, trackAttention } from '../overview/signals';
import { nowAt } from '../overview/analytics';
import './money.css';

/** Рабочий стол: бухгалтер */
export default function Home() {
  const db = useDB();
  const v = useDBVersion();
  const perms = useMoneyPerms();
  const open = useOpenEntity();
  const { myTasks } = useScoped();
  const { me, role } = useSession();
  const nav = useNavigate();
  const [modal, setModal] = useState<MoneyModal>(null);
  const menu = useMoneyMenu(setModal, ['accept']);
  const today = db.meta.today;

  const d = useMemo(() => {
    const ix = indexes(db);
    const pending = db.payments.filter((p) => p.status === 'pending').sort((a, b) => a.at.localeCompare(b.at));
    const unidentified = db.payments.filter((p) => p.status === 'unidentified').sort((a, b) => a.at.localeCompare(b.at));
    const bal = clientBalances(db);
    const overdue = db.clients
      .map((c) => ({ c, b: bal.get(c.id)! }))
      .filter((x) => x.b && x.b.overdue > 0)
      .sort((a, b) => b.b.overdue - a.b.overdue);
    const purchases = new Map(db.purchases.map((p) => [p.id, p]));
    const week = supplierWeekDues(db);
    const supplierDues = week.items
      .map((u) => ({ s: ix.suppliers.get(u.supplierId)!, u, number: purchases.get(u.purchaseId)?.number ?? 0 }))
      .filter((x) => x.s);
    const shiftIssues = db.shifts
      .filter((s) => s.closedAt && s.openedAt.slice(0, 10) >= plusDays(today, -14))
      .map((s) => ({ s, sum: shiftSummary(db, s.id), seller: ix.employees.get(s.sellerId)?.short ?? '—' }))
      .filter((x) => (x.sum.difference ?? 0) !== 0)
      .sort((a, b) => b.s.openedAt.localeCompare(a.s.openedAt));
    const couriers = db.employees
      .filter((e) => e.roles.includes('courier'))
      .map((e) => ({ e, cc: courierCash(db, e.id) }))
      .filter((x) => x.cc.onHand > 0)
      .sort((a, b) => b.cc.onHand - a.cc.onHand);
    // поступления по дням за 7 дней
    const days: { date: string; clients: number; shifts: number }[] = [];
    for (let i = 6; i >= 0; i--) days.push({ date: plusDays(today, -i), clients: 0, shifts: 0 });
    const byDate = new Map(days.map((x) => [x.date, x]));
    for (const p of db.payments) {
      if (p.status !== 'posted' || p.direction !== 'in') continue;
      const x = byDate.get(p.at.slice(0, 10));
      if (!x) continue;
      if (p.kind === 'client') x.clients += p.amount;
      else if (p.kind === 'shift') x.shifts += p.amount;
    }
    // открытая смена: деньги по чекам ещё не проведены
    const openShift = db.shifts.find((s) => !s.closedAt);
    if (openShift) {
      const x = byDate.get(openShift.openedAt.slice(0, 10));
      const sum = shiftSummary(db, openShift.id);
      if (x) x.shifts += sum.cash + sum.card;
    }
    return { ix, pending, unidentified, overdue, supplierDues, suppliersSum: week.total, shiftIssues, couriers, days };
  }, [db, v, today]);

  // «Мои задачи на сегодня»: просроченные и на сегодня, срочные первыми
  const tasks = useMemo(
    () =>
      myTasks
        .filter((t) => t.state === 'open' && t.due <= today)
        .sort((a, b) => a.due.localeCompare(b.due) || (a.priority === 'high' ? -1 : 0) - (b.priority === 'high' ? -1 : 0) || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99')),
    [myTasks, today, v],
  );
  // число на вкладке «Требует внимания» и учёт «Разобрано сегодня»: принятые здесь деньги и подтверждённые переводы туда попадают
  const attention = useMemo(() => {
    const resolved = loadResolved();
    const all = signalsForRole(computeSignals(db, today), role);
    const active = all.filter((s) => !resolved[s.id]);
    trackAttention(role, today, nowAt().slice(11, 16), all, active, arrangeSignals(active).important);
    return attentionCount(all, resolved);
  }, [db, v, today, role]);
  const completeTask = (t: Task) => {
    const r = dispatch('task.complete', { taskId: t.id }, me.id);
    if (!r.ok) toast(r.error, 'error');
    else toast('Задача выполнена');
  };
  /** Документ задачи: платёж — сразу окно (подтвердить, опознать), остальное — карточка. */
  const openTask = (t: Task) => {
    const l = t.link;
    if (!l) return;
    if (l.type === 'payment') {
      const p = db.payments.find((x) => x.id === l.id);
      if (!p) return;
      setModal(p.status === 'pending' && perms.confirm ? { kind: 'confirm', paymentId: p.id } : p.status === 'unidentified' && perms.confirm ? { kind: 'identify', paymentId: p.id } : { kind: 'payment', paymentId: p.id });
      return;
    }
    open(l.type as EntityType, l.id);
  };
  const taskDoc = (t: Task): string | null => {
    const l = t.link;
    if (!l) return null;
    if (l.type === 'payment') {
      const p = db.payments.find((x) => x.id === l.id);
      return p ? `${p.status === 'unidentified' ? 'Поступление' : 'Платёж'} № ${p.number} на ${fmt.money(p.amount)}` : null;
    }
    if (l.type === 'supplier') return d.ix.suppliers.get(l.id)?.name ?? null;
    if (l.type === 'client') return d.ix.clients.get(l.id)?.name ?? null;
    if (l.type === 'order') return `Заказ № ${d.ix.orders.get(l.id)?.number ?? ''}`;
    if (l.type === 'purchase') return `Закупка № ${db.purchases.find((x) => x.id === l.id)?.number ?? ''}`;
    if (l.type === 'delivery') return `Доставка № ${db.deliveries.find((x) => x.id === l.id)?.number ?? ''}`;
    if (l.type === 'product') return d.ix.products.get(l.id)?.name ?? null;
    return null;
  };

  const sum = (a: { amount: number }[]) => a.reduce((s, x) => s + x.amount, 0);
  const overdueSum = d.overdue.reduce((s, x) => s + x.b.overdue, 0);
  const suppliersSum = d.suppliersSum;
  const max = Math.max(1, ...d.days.map((x) => x.clients + x.shifts));
  const weekTotal = d.days.reduce((s, x) => s + x.clients + x.shifts, 0);

  return (
    <>
      <PageHeader
        section="overview"
        counts={{ attention }}
        actions={
          <>
            <span data-hint="money.ops">
              <MoreMenu items={menu} />
            </span>
            {perms.accept ? (
              <Button variant="primary" icon={<HandCoins />} onClick={() => setModal({ kind: 'accept' })} data-hint="money.accept-btn">
                Принять оплату
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid-4" data-hint="money.home.kpis">
        <KpiLink label="Открыть журнал денег" onClick={() => nav('/money')}>
          <Kpi label={`Ждут подтверждения · ${d.pending.length}`} value={fmt.money(sum(d.pending))} />
        </KpiLink>
        <KpiLink label="Открыть журнал денег" onClick={() => nav('/money')}>
          <Kpi label={`Не опознаны · ${d.unidentified.length}`} value={<span className={d.unidentified.length ? 'c-bad' : undefined}>{fmt.money(sum(d.unidentified))}</span>} />
        </KpiLink>
        <KpiLink label="Открыть долги покупателей" onClick={() => nav('/money/debts')}>
          <Kpi label={`Просрочено покупателями · ${d.overdue.length}`} value={<span className={overdueSum ? 'c-bad' : undefined}>{fmt.money(overdueSum)}</span>} />
        </KpiLink>
        <KpiLink label="Открыть долги поставщикам" onClick={() => nav('/money/suppliers')}>
          <Kpi label="Поставщикам на этой неделе" value={fmt.money(suppliersSum)} />
        </KpiLink>
      </div>

      <div className="money-home">
        <div className="col-4">
          <Card
            hint="money.home.chart"
            title="Поступления за 7 дней"
            actions={
              <div className="money-legend">
                <span>
                  <i className="money-sw is-clients" />
                  От покупателей
                </span>
                <span>
                  <i className="money-sw is-shifts" />
                  Выручка смен
                </span>
                <span className="t-16 w-700 num" style={{ marginLeft: 8 }}>
                  {fmt.money(weekTotal)}
                </span>
              </div>
            }
          >
            <div className="money-chart" role="img" aria-label="Поступления по дням за неделю">
              {d.days.map((x) => {
                const t = x.clients + x.shifts;
                return (
                  <div key={x.date} className="money-chart-col" title={`${fmt.date(x.date)}: от покупателей ${fmt.money(x.clients)}, выручка смен ${fmt.money(x.shifts)}`}>
                    <span className="money-chart-val num">{t ? fmt.moneyShort(t) : '—'}</span>
                    <div className="money-chart-bar">
                      {x.shifts ? <span className="is-shifts" style={{ height: `${(x.shifts / max) * 100}%` }} /> : null}
                      {x.clients ? <span className="is-clients" style={{ height: `${(x.clients / max) * 100}%` }} /> : null}
                    </div>
                    <span className="money-chart-day">
                      {fmt.weekday(x.date, true)}, {+x.date.slice(8, 10)}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>
          <Card
            hint="money.home.tasks"
            title={
              <span className="row">
                Мои задачи на сегодня
                {tasks.length ? <Chip>{fmt.num(tasks.length)}</Chip> : null}
              </span>
            }
            flush
          >
            <div className="list money-home-list">
              {tasks.length ? (
                tasks.slice(0, 6).map((t) => {
                  const doc = taskDoc(t);
                  const late = t.due < today;
                  return (
                    <div key={t.id} className={cx('list-row money-li money-task', t.link && 'is-click')} onClick={() => openTask(t)} role={t.link ? 'button' : undefined} tabIndex={t.link ? 0 : undefined} onKeyDown={(e) => t.link && (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), openTask(t))}>
                      <input
                        type="checkbox"
                        className="task-check"
                        aria-label="Сделано"
                        checked={false}
                        onClick={(e) => e.stopPropagation()}
                        onChange={() => completeTask(t)}
                      />
                      <span className="money-li-main">
                        <span className="money-li-title" title={t.title}>
                          {t.title}
                        </span>
                        <span className="money-li-sub">
                          {late ? <StatusChip s={{ label: `Просрочена с ${fmt.date(t.due)}`, tone: 'bad' }} /> : <span>{t.dueTime ? `сегодня до ${t.dueTime}` : 'сегодня'}</span>}
                          {t.priority === 'high' ? <StatusChip s={{ label: 'Срочно', tone: 'warn' }} /> : null}
                          {doc ? <span className="money-task-doc">{doc}</span> : null}
                        </span>
                      </span>
                      {t.link ? <ChevronRight className="money-task-go" /> : null}
                    </div>
                  );
                })
              ) : (
                <EmptyState icon={<ListChecks />} title="На сегодня задач нет" />
              )}
              {tasks.length > 6 ? <div className="list-row t-12 muted money-more-note">Ещё {fmt.count(tasks.length - 6, 'задача', 'задачи', 'задач')} — в «Моих задачах» вверху справа</div> : null}
            </div>
          </Card>
          <Card hint="money.home.suppliers" title="Поставщикам на этой неделе" actions={<span className="t-16 w-700 num">{fmt.money(suppliersSum)}</span>} flush>
            <div className="list money-home-list">
              {d.supplierDues.length ? (
                d.supplierDues.slice(0, 6).map(({ s, u, number }) => (
                  <MoneyLi
                    key={u.purchaseId}
                    onClick={() => open('purchase', u.purchaseId)}
                    lead={<span className="money-sched-date nowrap">{fmt.date(u.dueDate)}</span>}
                    title={s.name}
                    sub={`Закупка № ${number}`}
                    amount={fmt.money(u.amount)}
                    badge={u.overdue ? <StatusChip s={overdueStatus(fmt.daysBetween(u.dueDate, today))} /> : null}
                    action={
                      perms.supplier ? (
                        <Button size="sm" onClick={() => setModal({ kind: 'supplier', supplierId: s.id })}>
                          Оплатить
                        </Button>
                      ) : null
                    }
                  />
                ))
              ) : (
                <EmptyState title="На этой неделе платежей нет" />
              )}
              {d.supplierDues.length > 6 ? <MoreLink onClick={() => nav('/money/suppliers')} text="Весь график платежей" /> : null}
            </div>
          </Card>
        </div>
        <div className="col-4">
          <Card hint="money.home.pending" title="Переводы ждут подтверждения" actions={<span className="t-16 w-700 num">{fmt.money(sum(d.pending))}</span>} flush>
            <div className="list money-home-list">
              {d.pending.length ? (
                d.pending.slice(0, 6).map((p) => {
                  const c = p.clientId ? d.ix.clients.get(p.clientId) : undefined;
                  return (
                    <MoneyLi
                      key={p.id}
                      onClick={() => c && open('client', c.id)}
                      title={c?.name ?? 'Покупатель'}
                      sub={`${fmt.relDate(p.at, today)}, ${fmt.time(p.at)}${p.allocations.length ? ' · заказ ' + p.allocations.map((a) => '№ ' + (a.orderId ? d.ix.orders.get(a.orderId)?.number ?? '' : '')).join(', ') : ''}`}
                      amount={fmt.money(p.amount)}
                      action={
                        perms.confirm ? (
                          <Button size="sm" icon={<BadgeCheck />} onClick={() => setModal({ kind: 'confirm', paymentId: p.id })} title="Сверить с выпиской банка и подтвердить">
                            Подтвердить
                          </Button>
                        ) : null
                      }
                    />
                  );
                })
              ) : (
                <EmptyState icon={<BadgeCheck />} title="Все переводы подтверждены" />
              )}
              {d.pending.length > 6 ? <MoreLink onClick={() => nav('/money')} text={`Ещё ${d.pending.length - 6} в журнале`} /> : null}
            </div>
          </Card>
          <Card hint="money.home.unknown" title="Неопознанные поступления" actions={<span className="t-16 w-700 num">{fmt.money(sum(d.unidentified))}</span>} flush>
            <div className="list money-home-list">
              {d.unidentified.length ? (
                d.unidentified.map((p) => (
                  <MoneyLi
                    key={p.id}
                    onClick={() => setModal({ kind: 'payment', paymentId: p.id })}
                    title={`Поступление № ${p.number}`}
                    sub={`${fmt.relDate(p.at, today)} · ${p.payer ? `${p.payer.name}, ИНН ${p.payer.inn}` : clean(p.comment) || 'без назначения платежа'}`}
                    amount={fmt.money(p.amount)}
                    action={
                      perms.confirm ? (
                        <Button size="sm" icon={<FileSearch />} onClick={() => setModal({ kind: 'identify', paymentId: p.id })}>
                          Опознать
                        </Button>
                      ) : null
                    }
                  />
                ))
              ) : (
                <EmptyState icon={<FileSearch />} title="Все поступления разнесены" />
              )}
            </div>
          </Card>
          <Card hint="money.home.couriers" title="Несданные деньги курьеров" actions={<span className="t-16 w-700 num">{fmt.money(d.couriers.reduce((s, x) => s + x.cc.onHand, 0))}</span>} flush>
            <div className="list money-home-list">
              {d.couriers.length ? (
                d.couriers.map(({ e, cc }) => (
                  <MoneyLi
                    key={e.id}
                    title={e.name}
                    sub={
                      <>
                        <StatusChip s={{ label: 'Не сдал', tone: 'warn' }} />
                        <span>{fmt.count(cc.deliveries, 'доставка', 'доставки', 'доставок')} с наличными</span>
                      </>
                    }
                    amount={fmt.money(cc.onHand)}
                    action={
                      <Button size="sm" icon={<HandCoins />} onClick={() => setModal({ kind: 'handin', courierId: e.id })} title="Пересчитать и принять в кассу магазина">
                        Принять
                      </Button>
                    }
                  />
                ))
              ) : (
                <EmptyState title="Курьеры сдали все деньги" />
              )}
            </div>
          </Card>
          <Card hint="money.home.overdue" title="Просроченные долги" actions={<span className="t-16 w-700 num c-bad">{fmt.money(overdueSum)}</span>} flush>
            <div className="list money-home-list">
              {d.overdue.length ? (
                d.overdue.slice(0, 5).map(({ c, b }) => (
                  <MoneyLi
                    key={c.id}
                    onClick={() => open('client', c.id)}
                    title={c.name}
                    sub={
                      <>
                        <span>{c.ownerId ? d.ix.employees.get(c.ownerId)?.short : 'Без ответственного'}</span>
                        <StatusChip s={overdueStatus(b.maxOverdueDays)} />
                      </>
                    }
                    amount={<span className="c-bad">{fmt.money(b.overdue)}</span>}
                  />
                ))
              ) : (
                <EmptyState title="Просрочек нет" />
              )}
              {d.overdue.length > 5 ? <MoreLink onClick={() => nav('/money/debts')} text={`Все должники · ${d.overdue.length}`} /> : null}
            </div>
          </Card>
          <Card hint="money.home.shifts" title="Расхождения смен кассы за две недели" flush>
            <div className="list money-home-list">
              {d.shiftIssues.length ? (
                d.shiftIssues.slice(0, 5).map(({ s, sum: ss, seller }) => (
                  <MoneyLi
                    key={s.id}
                    title={`Смена № ${s.number} · ${fmt.relDate(s.openedAt, today)}`}
                    sub={`${seller} · ожидалось ${fmt.money(ss.expectedCash)}, пересчитано ${fmt.money(ss.countedCash ?? 0)}`}
                    amount={
                      (ss.difference ?? 0) < 0 ? (
                        <StatusChip s={{ label: `Недостача ${fmt.money(-(ss.difference ?? 0))}`, tone: 'bad' }} />
                      ) : (
                        <StatusChip s={{ label: `Излишек ${fmt.money(ss.difference ?? 0)}`, tone: 'warn' }} />
                      )
                    }
                  />
                ))
              ) : (
                <EmptyState title="Все смены сошлись" />
              )}
            </div>
          </Card>
        </div>
      </div>
      <MoneyModalHost modal={modal} onClose={() => setModal(null)} onOpen={setModal} />
    </>
  );
}

function MoreLink({ text, onClick }: { text: string; onClick: () => void }) {
  return (
    <button type="button" className="list-row money-more" onClick={onClick}>
      <span className="grow">{text}</span>
      <ChevronRight />
    </button>
  );
}
