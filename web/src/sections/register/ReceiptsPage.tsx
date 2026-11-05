/* Касса → Чеки: все чеки с поиском по номеру и составу, фильтрами, итогами и выгрузкой. */
import { useMemo } from 'react';
import { Printer, Undo2, ReceiptText } from 'lucide-react';
import type { Receipt } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes, shiftSummary } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { Chip, DataTable, MoreMenu, fmt, type Column } from '../../ui';
import { PAY_KIND_NAMES, openShift, payKind, receiptContents, receiptSearchText } from './lib';
import { ShiftBadge } from './ShiftParts';
import { useOpenRefund } from './ReturnLookup';
import { usePrintReceipt } from './Print';

interface Row {
  r: Receipt;
  seller: string;
  client: string;
  contents: string;
  text: string;
  positions: number;
  discount: number; // ручные скидки и акции, ₽
  signed: number; // сумма со знаком: возврат — минус
  profit: number | null;
}

export default function ReceiptsPage() {
  const db = useDB();
  const version = useDBVersion();
  const { role, can } = useSession();
  const { receipts } = useScoped();
  const openEntity = useOpenEntity();
  const openRefund = useOpenRefund();
  const [print, printNode] = usePrintReceipt();
  const shift = useMemo(() => openShift(db), [db, version]);
  const sum = shift ? shiftSummary(db, shift.id) : null;
  const seeProfit = can('seeProfit');

  const rows = useMemo<Row[]>(() => {
    const ix = indexes(db);
    const out: Row[] = [];
    for (let i = receipts.length - 1; i >= 0; i--) {
      const r = receipts[i];
      let discount = 0;
      let profit: number | null = 0;
      for (const l of r.lines) {
        discount += (l.basePrice - l.price) * l.qty;
        if (l.cost === null) profit = null;
        else if (profit !== null) profit += (l.price - l.cost) * l.qty;
      }
      const sign = r.kind === 'refund' ? -1 : 1;
      out.push({
        r,
        seller: ix.employees.get(r.sellerId)?.short ?? '—',
        client: r.clientId ? ix.clients.get(r.clientId)?.name ?? '' : '',
        contents: receiptContents(db, r),
        text: receiptSearchText(db, r),
        positions: r.lines.length,
        discount: discount * sign,
        signed: r.total * sign,
        profit: profit === null ? null : profit * sign,
      });
    }
    return out;
  }, [db, version, receipts]);

  const today = db.meta.today;
  const weekFrom = fmt.addDays(today, -6);
  const dayOf = (x: Row) => x.r.at.slice(0, 10);

  const columns: Column<Row>[] = [
    { key: 'number', header: 'Чек', render: (x) => <span className="cell-title nowrap">№ {x.r.number}</span>, sort: (x) => x.r.number },
    {
      key: 'at',
      header: 'Дата и время',
      render: (x) => (
        <span className="nowrap">
          {fmt.relDate(x.r.at, today)}, {fmt.time(x.r.at)}
        </span>
      ),
      sort: (x) => x.r.at,
      csv: (x) => `${fmt.dateShort(x.r.at, true)} ${fmt.time(x.r.at)}`,
    },
    { key: 'seller', header: 'Продавец', render: (x) => <span className="nowrap">{x.seller}</span>, sort: (x) => x.seller, hidden: role === 'seller' },
    {
      key: 'contents',
      header: 'Состав',
      render: (x) => (
        <span className="reg-td-contents ellipsis" style={{ display: 'block' }} title={x.contents}>
          {x.contents}
        </span>
      ),
      csv: (x) => x.contents,
    },
    { key: 'client', header: 'Покупатель', className: 'reg-col-client', render: (x) => (x.client ? <span className="ellipsis reg-td-client" style={{ display: 'block' }}>{x.client}</span> : <span className="faint">—</span>), sort: (x) => x.client || null, csv: (x) => x.client },
    {
      key: 'pay',
      header: 'Оплата',
      render: (x) => <Chip tone={x.r.kind === 'refund' ? 'warn' : 'neutral'}>{PAY_KIND_NAMES[payKind(x.r)]}</Chip>,
      sort: (x) => PAY_KIND_NAMES[payKind(x.r)],
      csv: (x) => PAY_KIND_NAMES[payKind(x.r)],
    },
    {
      key: 'discount',
      header: 'Скидки',
      align: 'right',
      render: (x) => (x.discount ? <span className="ink-2">{fmt.money(x.discount)}</span> : <span className="faint">—</span>),
      sort: (x) => x.discount,
      total: (rs) => fmt.money(rs.reduce((a, x) => a + x.discount, 0)),
    },
    {
      key: 'total',
      header: 'Сумма',
      align: 'right',
      render: (x) => <span className="w-600">{x.signed < 0 ? `−${fmt.money(-x.signed)}` : fmt.money(x.signed)}</span>,
      sort: (x) => x.signed,
      total: (rs) => fmt.money(rs.reduce((a, x) => a + x.signed, 0)),
    },
    {
      key: 'profit',
      header: 'Прибыль',
      align: 'right',
      hidden: !seeProfit,
      render: (x) => (x.profit === null ? <span className="faint" title="Себестоимость известна не по всем товарам">—</span> : fmt.money(x.profit)),
      sort: (x) => x.profit,
      total: (rs) => fmt.money(rs.reduce((a, x) => a + (x.profit ?? 0), 0)),
    },
    {
      key: 'menu',
      header: '',
      width: 44,
      render: (x) => (
        <span onClick={(e) => e.stopPropagation()}>
          <MoreMenu
            size="sm"
            items={[
              { label: 'Открыть чек', icon: <ReceiptText />, onClick: () => openEntity('receipt', x.r.id) },
              { label: 'Печать чека', icon: <Printer />, onClick: () => print(x.r.id) },
              { label: 'Возврат по чеку', icon: <Undo2 />, onClick: () => openRefund(x.r), hidden: x.r.kind !== 'sale' || !can('refundReceipt') },
            ]}
          />
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader section="register" counts={{ receipts: sum?.receipts ?? null }} actions={<ShiftBadge shift={shift} />} />
      <div className={seeProfit ? 'reg-receipts is-wide' : 'reg-receipts'}>
      <DataTable<Row>
        id="register-receipts"
        rows={rows}
        columns={columns}
        rowKey={(x) => x.r.id}
        search={{ placeholder: 'Номер чека или товар', text: (x) => x.text }}
        filters={[
          {
            key: 'period',
            label: 'Период',
            options: [
              { value: 'all', label: 'Все' },
              { value: 'today', label: 'Сегодня', test: (x) => dayOf(x) === today },
              { value: 'week', label: 'Неделя', test: (x) => dayOf(x) >= weekFrom },
            ],
          },
          {
            key: 'kind',
            label: 'Вид',
            showCounts: true,
            options: [
              { value: 'all', label: 'Все' },
              { value: 'sale', label: 'Продажи', test: (x) => x.r.kind === 'sale' },
              { value: 'refund', label: 'Возвраты', test: (x) => x.r.kind === 'refund' },
            ],
          },
        ]}
        presetViews={[
          { name: 'Сегодня', search: '', filters: { period: 'today', kind: 'all' }, sort: { key: 'at', dir: 'desc' } },
          { name: 'Возвраты за неделю', search: '', filters: { period: 'week', kind: 'refund' }, sort: { key: 'at', dir: 'desc' } },
        ]}
        defaultSort={{ key: 'at', dir: 'desc' }}
        onRowClick={(x) => openEntity('receipt', x.r.id)}
        exportName="Чеки"
        totalLabel={(n) => `Итого · ${fmt.count(n, 'чек', 'чека', 'чеков')}`}
      />
      </div>
      {printNode}
    </>
  );
}
