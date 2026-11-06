/* Вкладка «Возвраты»: по заказам и по чекам. Товар — на проверке, пока склад не решит. */
import { useMemo, useState } from 'react';
import { Undo2 } from 'lucide-react';
import type { Client, Employee, Order, QuarantineState, Receipt, Return, ReturnReason } from '../../data/types';
import { RETURN_REASONS } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes, orderPayment } from './data';
import { useSession } from '../../roles/session';
import { useSalesOrders } from './salesScope';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { PageHeader } from '../../shell/PageHeader';
import { Button, Chip, DataTable, EmptyState, Modal, QUARANTINE_STATE, SearchInput, StatusChip, fmt, type Column, type FilterDef } from '../../ui';
import { ReturnModal } from './ReturnModal';
import { Dash, shipStatus } from './parts';
import { norm } from './lib';
import { returnGoods, useScopedReturns, useTabCounts } from './tabCounts';

interface ReturnRow {
  r: Return;
  no: number; // номер, под которым возврат знают: у кассового — номер чека возврата
  order?: Order;
  receipt?: Receipt;
  client?: Client;
  author?: Employee;
  reasons: ReturnReason[];
  qty: number;
  goods: QuarantineState[];
  refunded: 'money' | 'register' | 'advance' | 'debt';
  text: string;
}

export default function ReturnsPage() {
  const db = useDB();
  const version = useDBVersion();
  const { can, role } = useSession();
  const openEntity = useOpenEntity();
  const returns = useScopedReturns();
  const counts = useTabCounts();
  const [picking, setPicking] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const today = db.meta.today;

  const rows = useMemo<ReturnRow[]>(() => {
    const idx = indexes(db);
    const rById = new Map(db.receipts.map((x) => [x.id, x]));
    const q = returnGoods(db);
    return returns
      .map((r) => {
        const order = r.orderId ? idx.orders.get(r.orderId) : undefined;
        const receipt = r.receiptId ? rById.get(r.receiptId) : undefined;
        // возврат на кассе называем номером чека возврата — так же, как на кассе и в чеке
        const refundReceipt = r.source === 'receipt' ? db.receipts.find((x) => x.kind === 'refund' && x.refundOf === r.receiptId && x.at === r.at) : undefined;
        const no = refundReceipt ? refundReceipt.number : r.number;
        const client = r.clientId ? idx.clients.get(r.clientId) : undefined;
        const author = idx.employees.get(r.authorId);
        const reasons = [...new Set(r.lines.map((l) => l.reason))];
        const refunded: ReturnRow['refunded'] =
          r.source === 'receipt' ? 'register' : r.refundPaymentId ? 'money' : order && orderPayment(db, order).advance > 0 ? 'advance' : 'debt';
        return {
          r,
          no,
          order,
          receipt,
          client,
          author,
          reasons,
          qty: r.lines.reduce((s, l) => s + l.qty, 0),
          goods: q.get(r.id) ?? [],
          refunded,
          text: [String(no), order ? `заказ ${order.number}` : '', receipt ? `чек ${receipt.number}` : '', client?.name ?? '', author?.name ?? '', ...reasons.map((x) => RETURN_REASONS[x])].join(' '),
        };
      })
      .sort((a, b) => b.r.at.localeCompare(a.r.at));
  }, [db, version, returns]);

  const onlyOrders = role === 'manager' || role === 'rep';
  const filters = useMemo<FilterDef<ReturnRow>[]>(() => {
    const all: FilterDef<ReturnRow>[] = [
      {
        key: 'source',
        showCounts: true,
        label: 'Документ',
        options: [
          { value: 'all', label: 'Все' },
          { value: 'order', label: 'По заказам', test: (x) => x.r.source === 'order' },
          { value: 'receipt', label: 'По чекам', test: (x) => x.r.source === 'receipt' },
        ],
      },
      {
        key: 'goods',
        showCounts: true,
        label: 'Товар',
        options: [
          { value: 'all', label: 'Любой товар' },
          { value: 'check', label: 'На проверке', test: (x) => x.goods.includes('check') },
          { value: 'done', label: 'Проверен', test: (x) => x.goods.length > 0 && !x.goods.includes('check') },
        ],
      },
      {
        key: 'period',
        label: 'Период',
        options: [
          { value: 'all', label: 'За всё время' },
          { value: 'week', label: '7 дней', test: (x) => x.r.at.slice(0, 10) >= fmt.addDays(today, -6) },
          { value: 'month', label: 'Этот месяц', test: (x) => x.r.at.slice(0, 10) >= today.slice(0, 7) + '-01' },
        ],
      },
    ];
    return all.filter((f) => !(onlyOrders && f.key === 'source'));
  }, [today, onlyOrders]);

  const columns = useMemo<Column<ReturnRow>[]>(
    () => [
      {
        key: 'at',
        header: '№ и дата',
        sort: (x) => x.r.at,
        csv: (x) => `№ ${x.no} от ${x.r.at.replace('T', ' ')}`,
        render: (x) => (
          <>
            <div className="cell-title nowrap">№ {x.no}</div>
            <div className="cell-sub nowrap">
              {fmt.dateShort(x.r.at)}, {fmt.time(x.r.at)}
            </div>
          </>
        ),
      },
      {
        key: 'doc',
        header: 'Основание',
        sort: (x) => (x.order ? x.order.number : x.receipt ? -x.receipt.number : 0),
        csv: (x) => (x.order ? `Заказ № ${x.order.number}` : x.receipt ? `Чек № ${x.receipt.number}` : ''),
        render: (x) =>
          x.order ? (
            <span data-hint="sales.returns-doc">
              <EntityLink type="order" id={x.order.id} className="entity-link nowrap">
                Заказ № {x.order.number}
              </EntityLink>
            </span>
          ) : x.receipt ? (
            <span data-hint="sales.returns-doc">
              <EntityLink type="receipt" id={x.receipt.id} className="entity-link nowrap">
                Чек № {x.receipt.number}
              </EntityLink>
            </span>
          ) : (
            <Dash />
          ),
      },
      {
        key: 'client',
        header: 'Клиент',
        sort: (x) => x.client?.name ?? '',
        csv: (x) => x.client?.name ?? 'Покупатель без карточки',
        className: 'sales-col-client',
        render: (x) => <div className="ellipsis" title={x.client?.name}>{x.client?.name ?? <span className="muted">Покупатель без карточки</span>}</div>,
      },
      {
        key: 'amount',
        header: 'Сумма',
        align: 'right',
        sort: (x) => x.r.amount,
        csv: (x) => x.r.amount,
        render: (x) => (
          <span className="sales-debt">
            <span className="w-600">{fmt.money(x.r.amount)}</span>
            <span className="cell-sub">{fmt.qty(x.qty)}</span>
          </span>
        ),
        total: (rs) => fmt.money(rs.reduce((s, x) => s + x.r.amount, 0)),
      },
      {
        key: 'reasons',
        header: 'Причины',
        csv: (x) => x.reasons.map((k) => RETURN_REASONS[k]).join(', '),
        render: (x) => <span className="ink-2">{x.reasons.map((k) => RETURN_REASONS[k]).join(', ')}</span>,
      },
      {
        key: 'money',
        header: 'Деньги',
        sort: (x) => x.refunded,
        csv: (x) => moneyText(x.refunded),
        render: (x) => (
          <span data-hint="sales.returns-money">
            <Chip tone={x.refunded === 'debt' ? 'neutral' : x.refunded === 'advance' ? 'info' : 'ok'}>{moneyText(x.refunded)}</Chip>
          </span>
        ),
      },
      { key: 'author', header: 'Оформил', sort: (x) => x.author?.name ?? '', csv: (x) => x.author?.name ?? '', render: (x) => <span className="nowrap ink-2">{x.author?.short ?? '—'}</span> },
      {
        key: 'goods',
        header: 'Товар',
        sort: (x) => (x.goods.includes('check') ? 0 : 1),
        csv: (x) => x.goods.map((g) => QUARANTINE_STATE[g].label).join(', '),
        render: (x) => (x.goods.length ? <span className="chips" data-hint="sales.returns-goods">{x.goods.map((g) => <StatusChip key={g} s={QUARANTINE_STATE[g]} />)}</span> : <Dash />),
      },
    ],
    [],
  );

  const search = useMemo(() => ({ placeholder: 'Номер возврата, заказа или чека, клиент', text: (x: ReturnRow) => x.text }), []);
  const canNew = can('createOrder');

  return (
    <>
      <PageHeader
        section="sales"
        counts={counts}
        actions={
          canNew ? (
            <Button variant="primary" icon={<Undo2 />} onClick={() => setPicking(true)} data-hint="sales.returns-new">
              Возврат по заказу
            </Button>
          ) : null
        }
      />
      <div className="sales-orders">
      <DataTable
        id="sales-returns"
        rows={rows}
        columns={columns}
        rowKey={(x) => x.r.id}
        search={search}
        filters={filters}
        defaultSort={{ key: 'at', dir: 'desc' }}
        onRowClick={(x) => (x.order ? openEntity('order', x.order.id) : x.receipt ? openEntity('receipt', x.receipt.id) : undefined)}
        exportName="Возвраты"
        totalLabel={(n) => `Итого · ${fmt.num(n)}`}
        empty={<EmptyState title="Возвратов нет">За выбранный период клиенты ничего не возвращали</EmptyState>}
      />
      </div>
      {picking ? (
        <PickOrderModal
          onClose={() => setPicking(false)}
          onPick={(id) => {
            setPicking(false);
            setOrderId(id);
          }}
        />
      ) : null}
      {orderId ? <ReturnModal orderId={orderId} onClose={() => setOrderId(null)} /> : null}
    </>
  );
}

function moneyText(k: ReturnRow['refunded']): string {
  return { money: 'Деньги вернули', register: 'Вернули на кассе', advance: 'Осталось авансом', debt: 'Зачли в долг' }[k];
}

/** Выбор отгруженного заказа для возврата. */
function PickOrderModal({ onClose, onPick }: { onClose: () => void; onPick: (orderId: string) => void }) {
  const db = useDB();
  const version = useDBVersion();
  const orders = useSalesOrders();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const idx = indexes(db);
    const dById = new Map(db.deliveries.map((d) => [d.id, d]));
    // только заказы, товар по которым у клиента: доставлен или выдан самовывозом. В пути и недоставленные — не возвращают
    const atClient = (o: Order): boolean => {
      if (o.state === 'cancelled' || !o.lines.some((l) => l.shipped > 0)) return false;
      if (o.ship === 'delivered') return true;
      if (o.ship !== 'shipped' && o.ship !== 'partial') return false;
      if (o.fulfillment === 'pickup') return true;
      const d = o.deliveryId ? dById.get(o.deliveryId) : undefined;
      return !d || d.state === 'delivered';
    };
    const shipped = orders.filter(atClient).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const t = norm(q.trim()).split(/\s+/).filter(Boolean);
    return shipped
      .map((o) => ({ o, c: idx.clients.get(o.clientId), d: o.deliveryId ? dById.get(o.deliveryId) : undefined }))
      .filter(({ o, c }) => !t.length || t.every((x) => norm(`${o.number} ${c?.name ?? ''}`).includes(x)))
      .slice(0, 30);
  }, [db, version, orders, q]);
  return (
    <Modal title="Возврат по заказу" sub="Найдите заказ, который клиент получил: доставлен или выдан" onClose={onClose}>
      <SearchInput value={q} onChange={setQ} placeholder="Номер заказа или клиент" autoFocus />
      <div className="sales-picker card" data-hint="sales.pick-order">
        {list.length ? (
          list.map(({ o, c, d }) => (
            <button key={o.id} type="button" className="list-row" onClick={() => onPick(o.id)}>
              <span className="w-600 nowrap">№ {o.number}</span>
              <span className="grow ellipsis">{c?.name}</span>
              <StatusChip s={shipStatus(o, d)} />
              <span className="muted t-12 nowrap">{fmt.date(o.createdAt)}</span>
              <span className="num w-600">{fmt.money(o.total)}</span>
            </button>
          ))
        ) : (
          <EmptyState title="Не нашли">Возврат оформляют только по заказу, который клиент получил: доставлен или выдан самовывозом</EmptyState>
        )}
      </div>
    </Modal>
  );
}
