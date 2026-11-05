/* Закупки → Заказы поставщикам. */
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { useDB, useDBVersion } from '../../data/store';
import { supplierBalances } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { Button, Chip, DataTable, EmptyState, Kpi, Segmented, Select, StatusChip, PURCHASE_STATE, fmt, overdueStatus, type Column } from '../../ui';
import { purchaseRows, type PurchaseRow } from './calc';
import { NewPurchaseModal } from './NewPurchaseModal';
import { usePurchaseCounts } from './counts';

type F = 'all' | 'draft' | 'ordered' | 'late' | 'partial' | 'received' | 'diff' | 'debt' | 'cancelled';

export default function PurchasesPage() {
  const db = useDB();
  const version = useDBVersion();
  const { can } = useSession();
  const seeCost = can('seeCost');
  const open = useOpenEntity();
  const counts = usePurchaseCounts();
  const [creating, setCreating] = useState(false);
  const [sid, setSid] = useState('');
  const [flt, setFlt] = useState<F>('all');
  const today = db.meta.today;

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => purchaseRows(db), [db, version]);
  const bySupplier = useMemo(() => (sid ? all.filter((r) => r.pu.supplierId === sid) : all), [all, sid]);

  const tests: Record<F, (r: PurchaseRow) => boolean> = {
    all: () => true,
    draft: (r) => r.pu.state === 'draft',
    ordered: (r) => r.pu.state === 'ordered' || r.pu.state === 'partial',
    late: (r) => r.lateDays > 0,
    partial: (r) => r.pu.state === 'partial',
    received: (r) => r.pu.state === 'received',
    diff: (r) => r.hasDiff,
    debt: (r) => r.debt > 0,
    cancelled: (r) => r.pu.state === 'cancelled',
  };
  const options: { key: F; label: string }[] = [
    { key: 'all', label: 'Все' },
    { key: 'draft', label: 'Черновики' },
    { key: 'ordered', label: 'В пути' },
    { key: 'late', label: 'Опаздывают' },
    { key: 'partial', label: 'Приняты частично' },
    { key: 'received', label: 'Приняты' },
    { key: 'diff', label: 'С расхождением' },
    ...(seeCost ? [{ key: 'debt' as F, label: 'С долгом' }] : []),
    { key: 'cancelled', label: 'Отменены' },
  ];
  const rows = useMemo(() => bySupplier.filter(tests[flt]), [bySupplier, flt]); // eslint-disable-line react-hooks/exhaustive-deps

  const kpi = useMemo(() => {
    const inWay = all.filter(tests.ordered);
    let debt = 0;
    let overdue = 0;
    for (const b of supplierBalances(db).values()) {
      debt += b.debt;
      overdue += b.overdue;
    }
    return {
      inWay: inWay.length,
      inWaySum: inWay.reduce((s, r) => s + r.pu.lines.reduce((z, l) => z + Math.max(0, l.qty - (l.received ?? 0)) * l.price, 0), 0),
      drafts: all.filter(tests.draft).length,
      late: all.filter(tests.late).length,
      partial: all.filter(tests.partial).length,
      debt,
      overdue,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, version]);

  const columns: Column<PurchaseRow>[] = [
    { key: 'number', header: 'Номер', sort: (r) => r.pu.number, csv: (r) => r.pu.number, render: (r) => <span className="w-700 nowrap">№ {r.pu.number}</span>, width: 90 },
    { key: 'supplier', header: 'Поставщик', sort: (r) => r.supplierName, csv: (r) => r.supplierName, render: (r) => <span className="cell-title pur-sup-cell">{r.supplierName}</span> },
    { key: 'date', header: 'Дата', sort: (r) => r.pu.createdAt, csv: (r) => fmt.dateShort(r.pu.createdAt, true), render: (r) => <span className="nowrap">{fmt.relDate(r.pu.createdAt, today)}</span> },
    {
      key: 'expected',
      header: 'Ожидается',
      sort: (r) => r.pu.expectedAt,
      csv: (r) => fmt.dateShort(r.pu.expectedAt, true),
      render: (r) =>
        r.pu.state === 'received' || r.pu.state === 'cancelled' ? (
          <span className="faint nowrap">{r.pu.receivedAt ? `принята ${fmt.dateShort(r.pu.receivedAt)}` : '—'}</span>
        ) : (
          <span className="row nowrap" style={{ gap: 6 }}>
            <span className={r.lateDays ? 'c-bad w-700' : r.pu.expectedAt === today ? 'w-700' : undefined}>{fmt.relDate(r.pu.expectedAt, today)}</span>
          </span>
        ),
    },
    { key: 'positions', header: 'Позиций', align: 'right', sort: (r) => r.positions, csv: (r) => r.positions, render: (r) => fmt.num(r.positions), total: (rs) => fmt.num(rs.reduce((s, r) => s + r.positions, 0)) },
    {
      key: 'qty',
      header: 'Коробок',
      align: 'right',
      sort: (r) => r.boxes,
      csv: (r) => r.boxes,
      render: (r) => fmt.num(r.boxes),
      total: (rs) => fmt.num(rs.reduce((s, r) => s + r.boxes, 0)),
    },
    {
      key: 'sum',
      header: 'Сумма',
      align: 'right',
      hidden: !seeCost,
      sort: (r) => r.amount,
      csv: (r) => r.amount,
      render: (r) => <span className="w-600">{fmt.money(r.amount)}</span>,
      total: (rs) => fmt.money(rs.reduce((s, r) => s + (r.pu.state === 'cancelled' ? 0 : r.amount), 0)),
    },
    {
      key: 'state',
      header: 'Состояние',
      sort: (r) => r.pu.state,
      csv: (r) => PURCHASE_STATE[r.pu.state].label,
      render: (r) => (
        <span className="chips pur-state-chips">
          <StatusChip s={PURCHASE_STATE[r.pu.state]} />
          {r.lateDays ? <Chip tone="bad">Опаздывает</Chip> : null}
          {r.hasDiff ? <Chip tone="warn">Расхождение</Chip> : null}
          {seeCost && r.overdueDays ? <StatusChip s={overdueStatus(r.overdueDays)} /> : null}
        </span>
      ),
    },
    {
      key: 'debt',
      header: 'Долг',
      align: 'right',
      hidden: !seeCost,
      sort: (r) => r.debt,
      csv: (r) => r.debt,
      render: (r) =>
        r.debt > 0 ? (
          <span className={r.overdueDays ? 'w-700 c-bad' : 'w-700'}>{fmt.money(r.debt)}</span>
        ) : r.pu.state === 'received' && r.accepted > 0 ? (
          <span className="c-ok w-600 nowrap">оплачена</span>
        ) : (
          <span className="faint">—</span>
        ),
      total: (rs) => fmt.money(rs.reduce((s, r) => s + r.debt, 0)),
    },
  ];

  const unit = (n: number, a: string, b: string, c: string) => <small className="stock-kpi-unit">{fmt.plural(n, a, b, c)}</small>;

  return (
    <>
      <PageHeader
        section="purchases"
        counts={counts}
        actions={
          can('createPurchase') ? (
            <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)}>
              Новая закупка
            </Button>
          ) : null
        }
      />
      <div className="card stock-strip is-4">
        <Kpi label="В пути" value={<>{fmt.num(kpi.inWay)} {seeCost ? <small className="stock-kpi-unit">на {fmt.money(kpi.inWaySum)}</small> : unit(kpi.inWay, 'закупка', 'закупки', 'закупок')}</>} onClick={() => setFlt('ordered')} />
        {seeCost ? (
          <>
            <Kpi label="Ждут подтверждения" value={<>{fmt.num(kpi.drafts)} {unit(kpi.drafts, 'закупка', 'закупки', 'закупок')}</>} onClick={() => setFlt('draft')} />
            <Kpi label="Долг поставщикам" value={fmt.money(kpi.debt)} onClick={() => setFlt('debt')} />
            <Kpi label="Просрочено" value={<span className={kpi.overdue ? 'c-bad' : undefined}>{fmt.money(kpi.overdue)}</span>} onClick={() => setFlt('debt')} />
          </>
        ) : (
          <>
            <Kpi label="Опаздывают" value={<>{fmt.num(kpi.late)} {unit(kpi.late, 'закупка', 'закупки', 'закупок')}</>} onClick={() => setFlt('late')} />
            <Kpi label="Приняты частично" value={<>{fmt.num(kpi.partial)} {unit(kpi.partial, 'закупка', 'закупки', 'закупок')}</>} onClick={() => setFlt('partial')} />
            <Kpi label="Ждут подтверждения" value={<>{fmt.num(kpi.drafts)} {unit(kpi.drafts, 'закупка', 'закупки', 'закупок')}</>} onClick={() => setFlt('draft')} />
          </>
        )}
      </div>
      <div className="stock-tight">
      <DataTable
        id="purchases-list"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.id}
        search={{ placeholder: 'Номер или поставщик', text: (r) => r.search }}
        defaultSort={{ key: 'date', dir: 'desc' }}
        onRowClick={(r) => open('purchase', r.id)}
        exportName="Закупки"
        totalLabel={(n) => `Итого ${fmt.count(n, 'закупка', 'закупки', 'закупок')}`}
        toolbar={
          <>
            <Select className="stock-select is-wide" value={sid} onChange={(e) => setSid(e.target.value)} aria-label="Поставщик" options={[{ value: '', label: 'Все поставщики' }, ...db.suppliers.map((s) => ({ value: s.id, label: s.name }))]} />
            <div className="stock-pills">
              <Segmented ariaLabel="Отбор" value={flt} onChange={(v) => setFlt(v as F)} options={options.map((o) => ({ value: o.key, label: o.label, count: bySupplier.filter(tests[o.key]).length }))} />
            </div>
          </>
        }
        empty={<EmptyState title="Закупок нет">Снимите отбор или выберите другого поставщика</EmptyState>}
      />
      </div>
      {creating ? <NewPurchaseModal onClose={() => setCreating(false)} /> : null}
    </>
  );
}
