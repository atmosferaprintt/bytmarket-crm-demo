/* Долги поставщикам: по поставщикам и график платежей на эту неделю, следующую и позже. */
import { useMemo, useState } from 'react';
import { CalendarClock, Truck } from 'lucide-react';
import type { ID, ISODate, Supplier } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { supplierBalances, type SupplierBalance } from '../../data/selectors';
import { plusDays } from '../../data/dates';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { Button, Card, DataTable, EmptyState, MoreMenu, StatusChip, fmt, overdueStatus, type Column } from '../../ui';
import { MoneyModalHost, useMoneyMenu, type MoneyModal } from './actions';
import { deferText, supplierWeekDues, useMoneyPerms, weekStart } from './lib';
import { useMoneyCounts } from './counts';
import { MoneyLi, useNarrow } from './parts';

interface SRow {
  s: Supplier;
  b: SupplierBalance;
  next: { dueDate: ISODate; amount: number } | null;
}

interface Due {
  purchaseId: ID;
  number: number;
  supplier: Supplier;
  dueDate: ISODate;
  amount: number;
}

export default function SupplierDebts() {
  const db = useDB();
  const v = useDBVersion();
  const perms = useMoneyPerms();
  const open = useOpenEntity();
  const counts = useMoneyCounts();
  const [modal, setModal] = useState<MoneyModal>(null);
  const menu = useMoneyMenu(setModal, ['supplier']);
  const today = db.meta.today;
  const narrow = useNarrow();

  const { rows, buckets } = useMemo(() => {
    const bal = supplierBalances(db);
    const purchases = new Map(db.purchases.map((p) => [p.id, p]));
    const rows: SRow[] = [];
    const dues: Due[] = [];
    for (const s of db.suppliers) {
      const b = bal.get(s.id) ?? { debt: 0, overdue: 0, advance: 0, upcoming: [] };
      rows.push({ s, b, next: b.upcoming[0] ? { dueDate: b.upcoming[0].dueDate, amount: b.upcoming[0].amount } : null });
      for (const u of b.upcoming) dues.push({ purchaseId: u.purchaseId, number: purchases.get(u.purchaseId)?.number ?? 0, supplier: s, dueDate: u.dueDate, amount: u.amount });
    }
    dues.sort((a, z) => a.dueDate.localeCompare(z.dueDate) || a.number - z.number);
    // «Эта неделя» — просроченные и к оплате до воскресенья: то же определение, что на рабочем столе и в обзоре владельца
    const week = supplierWeekDues(db);
    const inWeek = new Set(week.items.map((x) => x.purchaseId));
    const w1 = week.sunday;
    const w2 = plusDays(w1, 7);
    const buckets = [
      {
        key: 'this',
        title: 'Эта неделя',
        range: week.overdue > 0 ? `Просрочено и до ${fmt.date(w1)}` : `${fmt.date(weekStart(today))} — ${fmt.date(w1)}`,
        items: dues.filter((d) => inWeek.has(d.purchaseId)),
      },
      { key: 'next', title: 'Следующая неделя', range: `${fmt.date(plusDays(w1, 1))} — ${fmt.date(w2)}`, items: dues.filter((d) => d.dueDate > w1 && d.dueDate <= w2) },
      { key: 'later', title: 'Позже', range: `с ${fmt.date(plusDays(w2, 1))}`, items: dues.filter((d) => d.dueDate > w2) },
    ];
    return { rows, buckets };
  }, [db, v, today]);

  const columns: Column<SRow>[] = [
    {
      key: 'name',
      header: 'Поставщик',
      sort: (r) => r.s.name,
      csv: (r) => r.s.name,
      render: (r) => (
        <div className="money-party is-wide">
          <div className="cell-title ellipsis">{r.s.name}</div>
          <div className="cell-sub ellipsis">{r.s.contact}</div>
        </div>
      ),
    },
    { key: 'defer', header: 'Наша отсрочка', sort: (r) => r.s.deferDays, csv: (r) => r.s.deferDays, width: 110, render: (r) => deferText(r.s.deferDays) },
    {
      key: 'debt',
      header: 'Долг',
      align: 'right',
      sort: (r) => r.b.debt,
      csv: (r) => r.b.debt,
      width: 120,
      render: (r) => (r.b.debt ? <span className="w-700">{fmt.money(r.b.debt)}</span> : <span className="faint">—</span>),
      total: (rs) => fmt.money(rs.reduce((s, r) => s + r.b.debt, 0)),
    },
    {
      key: 'overdue',
      header: 'Просрочено',
      align: 'right',
      sort: (r) => r.b.overdue,
      csv: (r) => r.b.overdue,
      width: 120,
      render: (r) => (r.b.overdue ? <span className="w-700 c-bad">{fmt.money(r.b.overdue)}</span> : <span className="faint">—</span>),
      total: (rs) => fmt.money(rs.reduce((s, r) => s + r.b.overdue, 0)),
    },
    {
      key: 'next',
      header: 'Ближайший платёж',
      sort: (r) => r.next?.dueDate ?? null,
      csv: (r) => (r.next ? `${r.next.dueDate} ${r.next.amount}` : ''),
      width: narrow ? 180 : 240,
      render: (r) =>
        r.next ? (
          <span className={narrow ? 'money-next is-stack' : 'money-next'}>
            <span className="nowrap">{fmt.date(r.next.dueDate)}</span>
            <span className="w-600 num">{fmt.money(r.next.amount)}</span>
            {r.next.dueDate < today ? <StatusChip s={overdueStatus(fmt.daysBetween(r.next.dueDate, today))} /> : null}
          </span>
        ) : (
          <span className="faint">Нет</span>
        ),
    },
    {
      key: 'count',
      header: 'Закупок',
      align: 'right',
      sort: (r) => r.b.upcoming.length,
      csv: (r) => r.b.upcoming.length,
      width: 80,
      render: (r) => (r.b.upcoming.length ? r.b.upcoming.length : <span className="faint">—</span>),
    },
    {
      key: 'act',
      header: '',
      width: 1,
      render: (r) =>
        perms.supplier && r.b.debt > 0 ? (
          <div className="money-row-actions" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" onClick={() => setModal({ kind: 'supplier', supplierId: r.s.id })}>
              Оплатить
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        section="money"
        counts={counts}
        actions={
          <>
            <MoreMenu items={menu} />
            {perms.supplier ? (
              <Button variant="primary" icon={<Truck />} title="Выплата поставщику" onClick={() => setModal({ kind: 'supplier' })}>
                Оплатить
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid-3">
        {buckets.map((b) => {
          const total = b.items.reduce((s, x) => s + x.amount, 0);
          return (
            <Card
              key={b.key}
              title={b.title}
              sub={b.range}
              actions={<span className="t-20 w-700 num">{fmt.money(total)}</span>}
              flush
            >
              <div className="list money-sched">
                {b.items.length ? (
                  b.items.slice(0, 7).map((x) => (
                    <MoneyLi
                      key={x.purchaseId}
                      onClick={() => open('purchase', x.purchaseId)}
                      title={x.supplier.name}
                      sub={`${fmt.date(x.dueDate)} · закупка № ${x.number}`}
                      amount={fmt.money(x.amount)}
                      badge={x.dueDate < today ? <StatusChip s={overdueStatus(fmt.daysBetween(x.dueDate, today))} /> : null}
                    />
                  ))
                ) : (
                  <EmptyState icon={<CalendarClock />} title="Платежей нет">
                    {b.key === 'this' ? 'На этой неделе поставщикам платить не нужно' : 'Сроков оплаты на эти дни нет'}
                  </EmptyState>
                )}
                {b.items.length > 7 ? <div className="list-row t-12 muted">И ещё {fmt.count(b.items.length - 7, 'закупка', 'закупки', 'закупок')}</div> : null}
              </div>
            </Card>
          );
        })}
      </div>
      <div className="money-tight">
      <DataTable
        id="money-suppliers"
        title="По поставщикам"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.s.id}
        search={{ placeholder: 'Поставщик, ИНН, контакт', text: (r) => `${r.s.name} ${r.s.inn} ${r.s.contact}` }}
        filters={[
          {
            key: 'f',
            showCounts: true,
            options: [
              { value: 'all', label: 'Все' },
              { value: 'debt', label: 'Есть долг', test: (r) => r.b.debt > 0 },
              { value: 'overdue', label: 'Просрочка', test: (r) => r.b.overdue > 0 },
            ],
          },
        ]}
        defaultSort={{ key: 'debt', dir: 'desc' }}
        onRowClick={(r) => open('supplier', r.s.id)}
        exportName="Долги поставщикам"
        totalLabel={(n) => `Итого · ${fmt.count(n, 'поставщик', 'поставщика', 'поставщиков')}`}
      />
      </div>
      <MoneyModalHost modal={modal} onClose={() => setModal(null)} onOpen={setModal} />
    </>
  );
}
