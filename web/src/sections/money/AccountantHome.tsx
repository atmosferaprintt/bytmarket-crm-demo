/* Рабочий стол бухгалтера: что проверить и провести сегодня. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BadgeCheck, ChevronRight, FileSearch, HandCoins } from 'lucide-react';
import { useDB, useDBVersion } from '../../data/store';
import { clientBalances, courierCash, indexes, shiftSummary } from '../../data/selectors';
import { plusDays } from '../../data/dates';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { Button, Card, EmptyState, Kpi, MoreMenu, StatusChip, fmt, overdueStatus } from '../../ui';
import { MoneyModalHost, useMoneyMenu, type MoneyModal } from './actions';
import { KpiLink, MoneyLi } from './parts';
import { clean, supplierWeekDues, useConfirmPayment, useMoneyPerms } from './lib';
import './money.css';

/** Рабочий стол: бухгалтер */
export default function Home() {
  const db = useDB();
  const v = useDBVersion();
  const perms = useMoneyPerms();
  const confirm = useConfirmPayment();
  const open = useOpenEntity();
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

  const sum = (a: { amount: number }[]) => a.reduce((s, x) => s + x.amount, 0);
  const overdueSum = d.overdue.reduce((s, x) => s + x.b.overdue, 0);
  const suppliersSum = d.suppliersSum;
  const max = Math.max(1, ...d.days.map((x) => x.clients + x.shifts));
  const weekTotal = d.days.reduce((s, x) => s + x.clients + x.shifts, 0);

  return (
    <>
      <PageHeader
        section="overview"
        actions={
          <>
            <MoreMenu items={menu} />
            {perms.accept ? (
              <Button variant="primary" icon={<HandCoins />} onClick={() => setModal({ kind: 'accept' })}>
                Принять оплату
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid-4">
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

      <div className="money-home-a">
        <Card
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
        <div className="col-4">
          <Card title="Переводы ждут подтверждения" actions={<span className="t-16 w-700 num">{fmt.money(sum(d.pending))}</span>} flush>
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
                          <Button size="sm" icon={<BadgeCheck />} onClick={() => confirm(p.id)} title="Подтвердить по выписке банка">
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
          <Card title="Неопознанные поступления" actions={<span className="t-16 w-700 num">{fmt.money(sum(d.unidentified))}</span>} flush>
            <div className="list money-home-list">
              {d.unidentified.length ? (
                d.unidentified.map((p) => (
                  <MoneyLi
                    key={p.id}
                    onClick={() => setModal({ kind: 'payment', paymentId: p.id })}
                    title={`Поступление № ${p.number}`}
                    sub={`${fmt.relDate(p.at, today)} · ${clean(p.comment) || 'без назначения платежа'}`}
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
        </div>
      </div>

      <div className="money-home-b">
        <Card title="Просроченные долги" actions={<span className="t-16 w-700 num c-bad">{fmt.money(overdueSum)}</span>} flush>
          <div className="list money-home-list">
            {d.overdue.length ? (
              d.overdue.slice(0, 6).map(({ c, b }) => (
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
            {d.overdue.length > 6 ? <MoreLink onClick={() => nav('/money/debts')} text={`Все должники · ${d.overdue.length}`} /> : null}
          </div>
        </Card>
        <div className="col-4">
          <Card title="Поставщикам на этой неделе" actions={<span className="t-16 w-700 num">{fmt.money(suppliersSum)}</span>} flush>
            <div className="list money-home-list">
              {d.supplierDues.length ? (
                d.supplierDues.slice(0, 6).map(({ s, u, number }) => (
                  <MoneyLi
                    key={u.purchaseId}
                    onClick={() => open('purchase', u.purchaseId)}
                    lead={<span className="money-sched-date nowrap">{fmt.dateShort(u.dueDate)}</span>}
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
          <Card title="Несданные деньги курьеров" actions={<span className="t-16 w-700 num">{fmt.money(d.couriers.reduce((s, x) => s + x.cc.onHand, 0))}</span>} flush>
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
                  />
                ))
              ) : (
                <EmptyState title="Курьеры сдали все деньги" />
              )}
              {d.couriers.length ? <MoreLink onClick={() => nav('/money/accounts')} text="Принять деньги в кассе и счетах" /> : null}
            </div>
          </Card>
          <Card title="Расхождения смен кассы за две недели" flush>
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
