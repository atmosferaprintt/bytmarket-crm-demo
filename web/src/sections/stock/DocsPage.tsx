/* Склад → Документы: все документы склада и приёмки закупок. */
import { useMemo, useState } from 'react';
import { useDB, useDBVersion } from '../../data/store';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { Chip, DataTable, EmptyState, fmt, type Column, type FilterDef } from '../../ui';
import { plusDays } from '../../data/dates';
import { DOC_KIND_NAMES } from './calc';
import { docRows, placeText, type DocRow, type DocRowKind } from './docRows';
import { DocKind, Route } from './DocBits';
import { StockDocDrawer } from './StockDocDrawer';
import { stockTabCounts } from './picking';
import { StockDocButtons, useStockDocs } from './docActions';
import { shortWhen } from './useNarrow';

export default function DocsPage() {
  const db = useDB();
  const version = useDBVersion();
  const open = useOpenEntity();
  const docs = useStockDocs();
  const [doc, setDoc] = useState<string | null>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => docRows(db), [db, version]);
  const today = db.meta.today;

  const kinds: DocRowKind[] = ['income', 'receive', 'transfer', 'writeoff', 'count', 'initial'];
  const present = new Set(rows.map((r) => r.kind));
  const filters: FilterDef<DocRow>[] = useMemo(
    () => [
      {
        key: 'kind',
        label: 'Вид документа',
        showCounts: true,
        options: [{ value: 'all', label: 'Все' }, ...kinds.filter((k) => present.has(k)).map((k) => ({ value: k, label: DOC_KIND_NAMES[k], test: (r: DocRow) => r.kind === k }))],
      },
      {
        key: 'place',
        label: 'Место',
        options: [
          { value: 'all', label: 'Все места' },
          { value: 'warehouse', label: 'Склад', test: (r: DocRow) => r.from === 'warehouse' || r.to === 'warehouse' },
          { value: 'shop', label: 'Магазин', test: (r: DocRow) => r.from === 'shop' || r.to === 'shop' },
        ],
      },
      {
        key: 'period',
        label: 'Период',
        options: [
          { value: 'all', label: 'Всё время' },
          { value: '30', label: '30 дней', test: (r: DocRow) => r.at.slice(0, 10) > plusDays(today, -30) },
          { value: '7', label: 'Неделя', test: (r: DocRow) => r.at.slice(0, 10) > plusDays(today, -7) },
          { value: '1', label: 'Сегодня', test: (r: DocRow) => r.at.slice(0, 10) === today },
        ],
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, today],
  );

  const columns: Column<DocRow>[] = [
    { key: 'number', header: 'Номер', sort: (r) => r.number, csv: (r) => r.number, render: (r) => <span className="w-700">№ {r.number}</span>, width: 90 },
    { key: 'kind', header: 'Вид', sort: (r) => DOC_KIND_NAMES[r.kind], csv: (r) => DOC_KIND_NAMES[r.kind], render: (r) => <DocKind kind={r.kind} /> },
    { key: 'at', header: 'Дата', sort: (r) => r.at + String(r.number).padStart(7, '0'), csv: (r) => fmt.dateTime(r.at), render: (r) => <span className="nowrap">{shortWhen(r.at, today)}</span> },
    { key: 'place', header: 'Место', sort: (r) => placeText(r), csv: (r) => placeText(r), render: (r) => <Route kind={r.kind} from={r.from} to={r.to} /> },
    { key: 'lines', header: 'Строк', align: 'right', sort: (r) => r.lines, csv: (r) => r.lines, render: (r) => fmt.num(r.lines), total: (rs) => fmt.num(rs.reduce((s, r) => s + r.lines, 0)) },
    { key: 'qty', header: 'Штук', align: 'right', sort: (r) => r.qty, csv: (r) => r.qty, render: (r) => <span className="w-600">{fmt.num(r.qty)}</span>, total: (rs) => fmt.num(rs.reduce((s, r) => s + r.qty, 0)) },
    { key: 'author', header: 'Провёл', sort: (r) => r.author, csv: (r) => r.author, render: (r) => <span className="nowrap" title={r.author}>{r.authorShort}</span> },
    {
      key: 'basis',
      header: 'Основание',
      sort: (r) => r.basis,
      csv: (r) => r.basis,
      render: (r) => (
        <span className="row" style={{ gap: 8 }}>
          <span className="stock-basis" title={r.basis}>
            {r.basis || '—'}
          </span>
          {r.diff && (r.kind === 'count' || r.kind === 'receive') ? (
            <span data-hint="stock.docs-diff">
              <Chip tone="warn" title="Строк с расхождением">Расхождение {r.diff}</Chip>
            </span>
          ) : null}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader section="stock" counts={stockTabCounts(db)} actions={<StockDocButtons open={docs.open} />} />
      <div className="stock-tight">
      <DataTable
        id="stock-docs"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.key}
        filters={filters}
        search={{ placeholder: 'Номер, автор или основание', text: (r) => `${r.number} ${DOC_KIND_NAMES[r.kind]} ${r.author} ${r.basis}` }}
        defaultSort={{ key: 'at', dir: 'desc' }}
        onRowClick={(r) => (r.docId ? setDoc(r.docId) : r.purchaseId ? open('purchase', r.purchaseId) : undefined)}
        exportName="Документы склада"
        totalLabel={(n) => `Итого ${fmt.count(n, 'документ', 'документа', 'документов')}`}
        empty={<EmptyState title="Документов нет">Измените отбор или период</EmptyState>}
      />
      </div>
      {doc ? <StockDocDrawer id={doc} onClose={() => setDoc(null)} /> : null}
      {docs.element}
    </>
  );
}
