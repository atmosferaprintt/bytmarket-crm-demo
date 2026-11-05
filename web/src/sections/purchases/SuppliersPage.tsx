/* Закупки → Поставщики: срок поставки, отсрочка, долг, ближайший платёж. */
import { useMemo } from 'react';
import type { Supplier } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { supplierBalance, type SupplierBalance } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { DataTable, Kpi, StatusChip, fmt, overdueStatus, type Column } from '../../ui';
import { purchaseRows } from './calc';
import { usePurchaseCounts } from './counts';
import { useNarrow } from '../stock/useNarrow';

/** «Наталья Викторовна Гречко, менеджер» → «Наталья Гречко»: имя и фамилия, полностью — в подсказке. */
function shortPerson(contact: string): string {
  const name = contact.split(',')[0].trim();
  const parts = name.split(/\s+/);
  return parts.length === 3 ? `${parts[0]} ${parts[2]}` : name;
}

interface Row {
  id: string;
  s: Supplier;
  bal: SupplierBalance;
  purchases: number;
  inWay: number;
  last: string | null;
  turnover90: number;
}

export default function SuppliersPage() {
  const db = useDB();
  const version = useDBVersion();
  const { can } = useSession();
  const seeCost = can('seeCost');
  const open = useOpenEntity();
  const counts = usePurchaseCounts();
  const narrow = useNarrow();
  const today = db.meta.today;

  const rows = useMemo<Row[]>(() => {
    const pr = purchaseRows(db);
    return db.suppliers.map((s) => {
      const mine = pr.filter((r) => r.pu.supplierId === s.id && r.pu.state !== 'cancelled');
      return {
        id: s.id,
        s,
        bal: supplierBalance(db, s.id),
        purchases: mine.length,
        inWay: mine.filter((r) => r.pu.state === 'ordered' || r.pu.state === 'partial').length,
        last: mine.reduce<string | null>((m, r) => (m === null || r.pu.createdAt > m ? r.pu.createdAt : m), null),
        turnover90: mine.reduce((z, r) => z + (r.pu.state === 'draft' ? 0 : r.amount), 0),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version]);

  const totals = rows.reduce((a, r) => ({ debt: a.debt + r.bal.debt, overdue: a.overdue + r.bal.overdue }), { debt: 0, overdue: 0 });
  const next = rows
    .flatMap((r) => r.bal.upcoming.filter((u) => u.dueDate >= today).map((u) => ({ ...u, name: r.s.name })))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const week = rows.reduce((z, r) => z + r.bal.upcoming.filter((u) => u.dueDate >= today && u.dueDate <= fmt.addDays(today, 7)).reduce((x, u) => x + u.amount, 0), 0);

  const columns: Column<Row>[] = [
    {
      key: 'name',
      header: 'Поставщик',
      sort: (r) => r.s.name,
      csv: (r) => r.s.name,
      render: (r) => <div className="cell-title nowrap">{r.s.name}</div>,
    },
    {
      key: 'contact',
      header: 'Контакт',
      sort: (r) => r.s.contact,
      csv: (r) => `${r.s.contact} ${r.s.phone}`,
      render: (r) => (
        <div title={r.s.contact} className="pur-contact-cell">
          <div className="nowrap">{shortPerson(r.s.contact)}</div>
          <div className="cell-sub nowrap">{fmt.phone(r.s.phone)}</div>
        </div>
      ),
    },
    { key: 'lead', header: 'Срок поставки', align: 'right', sort: (r) => r.s.leadDays, csv: (r) => r.s.leadDays, render: (r) => fmt.count(r.s.leadDays, 'день', 'дня', 'дней') },
    { key: 'defer', header: <span title="Сколько дней поставщик ждёт нашу оплату после приёмки">Наша отсрочка</span>, align: 'right', sort: (r) => r.s.deferDays, csv: (r) => r.s.deferDays, render: (r) => (r.s.deferDays ? fmt.count(r.s.deferDays, 'день', 'дня', 'дней') : 'предоплата') },
    { key: 'min', header: 'Мин. заказ', align: 'right', hidden: !seeCost || narrow, sort: (r) => r.s.minOrder, csv: (r) => r.s.minOrder, render: (r) => (r.s.minOrder ? fmt.money(r.s.minOrder) : '—') },
    { key: 'purchases', header: 'Закупок', align: 'right', sort: (r) => r.purchases, csv: (r) => r.purchases, render: (r) => fmt.num(r.purchases), total: (rs) => fmt.num(rs.reduce((z, r) => z + r.purchases, 0)) },
    { key: 'inWay', header: 'В пути', align: 'right', sort: (r) => r.inWay, csv: (r) => r.inWay, render: (r) => (r.inWay ? <span className="w-700">{r.inWay}</span> : <span className="faint">0</span>), total: (rs) => fmt.num(rs.reduce((z, r) => z + r.inWay, 0)) },
    { key: 'last', header: 'Последняя', hidden: narrow, sort: (r) => r.last, csv: (r) => (r.last ? fmt.dateShort(r.last, true) : ''), render: (r) => <span className="nowrap">{r.last ? fmt.relDate(r.last, today) : '—'}</span> },
    {
      key: 'debt',
      header: 'Долг',
      align: 'right',
      hidden: !seeCost,
      sort: (r) => r.bal.debt,
      csv: (r) => r.bal.debt,
      render: (r) => (r.bal.debt ? <span className="w-700">{fmt.money(r.bal.debt)}</span> : <span className="faint">0 ₽</span>),
      total: (rs) => fmt.money(rs.reduce((z, r) => z + r.bal.debt, 0)),
    },
    {
      key: 'next',
      header: 'Ближайший платёж',
      hidden: !seeCost,
      sort: (r) => r.bal.upcoming[0]?.dueDate ?? null,
      csv: (r) => (r.bal.upcoming[0] ? `${r.bal.upcoming[0].amount} до ${r.bal.upcoming[0].dueDate}` : ''),
      render: (r) => {
        const u = r.bal.upcoming[0];
        if (!u) return <span className="faint">—</span>;
        const late = u.dueDate < today ? fmt.daysBetween(u.dueDate, today) : 0;
        return (
          <span className="row nowrap" style={{ gap: 8 }}>
            <span className="w-600">{fmt.money(u.amount)}</span>
            {late ? <StatusChip s={overdueStatus(late)} /> : <span className={u.dueDate <= fmt.addDays(today, 3) ? 'c-warn w-600' : 'muted'}>до {fmt.dateShort(u.dueDate)}</span>}
          </span>
        );
      },
    },
  ];

  return (
    <>
      <PageHeader section="purchases" counts={counts} />
      {seeCost ? (
        <div className="card stock-strip is-4">
          <Kpi label="Долг поставщикам" value={fmt.money(totals.debt)} />
          <Kpi label="Просрочено" value={<span className={totals.overdue ? 'c-bad' : undefined}>{fmt.money(totals.overdue)}</span>} />
          <Kpi label="Платежи на неделю" value={fmt.money(week)} />
          <Kpi label="Ближайший платёж" value={next ? <>{fmt.money(next.amount)} <small className="stock-kpi-unit">{fmt.relDate(next.dueDate, today)}</small></> : '—'} />
        </div>
      ) : null}
      <div className="stock-tight pur-tight">
      <DataTable
        id="purchases-suppliers"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        search={{ placeholder: 'Поставщик, контакт или ИНН', text: (r) => `${r.s.name} ${r.s.contact} ${r.s.inn} ${r.s.phone}` }}
        defaultSort={{ key: seeCost ? 'debt' : 'name', dir: seeCost ? 'desc' : 'asc' }}
        onRowClick={(r) => open('supplier', r.id)}
        exportName="Поставщики"
        totalLabel={(n) => `Итого ${fmt.count(n, 'поставщик', 'поставщика', 'поставщиков')}`}
      />
      </div>
    </>
  );
}
