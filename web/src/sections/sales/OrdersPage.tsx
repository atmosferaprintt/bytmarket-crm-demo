/* Вкладка «Заказы»: таблица оптовых заказов, на телефоне представителя — карточки. */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Send, X } from 'lucide-react';
import type { Client, ClientPoint, Delivery, Employee, Order } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes, orderPayment, type OrderPayment } from './data';
import { useSession } from '../../roles/session';
import { useSalesOrders } from './salesScope';
import { useOpenEntity } from '../../shell/entities';
import { PageHeader } from '../../shell/PageHeader';
import {
  Button,
  Card,
  Chip,
  DataTable,
  EmptyState,
  ORDER_STATE,
  PAY_STATE,
  PICK_STATE,
  SearchInput,
  Segmented,
  StatusChip,
  cx,
  fmt,
  overdueStatus,
  type Column,
  type DataTableProps,
  type FilterDef,
} from '../../ui';
import { NewOrderDrawer } from './NewOrderDrawer';
import { APPROVAL_STATUS, Dash, NOT_SENT, OrderBrief, WAITS_MANAGER, deliveryFailed, shipStatus, shownOverdue } from './parts';
import { WORK_STAGES, norm, useIsPhone, useMedia } from './lib';
import { useOffline } from './offline';

const NONE: string[] = [];
import { useTabCounts } from './tabCounts';

export interface OrderRow {
  o: Order;
  client?: Client;
  point?: ClientPoint;
  owner?: Employee;
  pay: OrderPayment;
  delivery?: Delivery;
  /** доставка не удалась — заказ не закончен, просрочку не показываем */
  failed: boolean;
  overdue: number;
  /** ждёт решения владельца: открыта задача «согласовать заказ» */
  approval: boolean;
  text: string;
}

const live = (o: Order) => o.state === 'confirmed' || o.state === 'closed';

export function useOrderRows(): OrderRow[] {
  const db = useDB();
  const version = useDBVersion();
  const orders = useSalesOrders();
  return useMemo(() => {
    const idx = indexes(db);
    const dById = new Map(db.deliveries.map((d) => [d.id, d]));
    const approvals = new Set(db.tasks.filter((t) => t.kind === 'approve_order' && t.state === 'open' && t.link?.type === 'order').map((t) => t.link!.id));
    return orders
      .map((o) => {
        const client = idx.clients.get(o.clientId);
        const point = client?.points.find((p) => p.id === o.pointId) ?? client?.points[0];
        const owner = o.ownerId ? idx.employees.get(o.ownerId) : undefined;
        const pay = orderPayment(db, o);
        const delivery = o.deliveryId ? dById.get(o.deliveryId) : undefined;
        return {
          o,
          client,
          point,
          owner,
          pay,
          delivery,
          failed: deliveryFailed(o, delivery),
          overdue: shownOverdue(o, pay, delivery),
          approval: o.state === 'request' && approvals.has(o.id),
          text: [`№${o.number}`, `№ ${o.number}`, String(o.number), client?.name ?? '', client?.phone ?? '', point?.name ?? '', point?.address ?? '', owner?.name ?? ''].join(' '),
        };
      })
      .sort((a, b) => b.o.createdAt.localeCompare(a.o.createdAt) || b.o.number - a.o.number);
  }, [db, version, orders]);
}

const shippedAll = (r: OrderRow) => r.o.ship === 'shipped' || r.o.ship === 'delivered';

type StateKey = 'all' | 'draft' | 'request' | 'work' | 'wait' | 'overdue' | 'shipped' | 'cancelled';
/** «В работе» и «Отгружены» вместе — все подтверждённые заказы: недоставленный заказ снова в работе. */
const STATE_TESTS: Record<Exclude<StateKey, 'all'>, (r: OrderRow) => boolean> = {
  draft: (r) => r.o.state === 'draft',
  request: (r) => r.o.state === 'request',
  work: (r) => live(r.o) && (!shippedAll(r) || r.failed),
  wait: (r) => live(r.o) && r.pay.debt > 0,
  overdue: (r) => r.overdue > 0,
  shipped: (r) => live(r.o) && shippedAll(r) && !r.failed,
  cancelled: (r) => r.o.state === 'cancelled',
};

export default function OrdersPage() {
  const db = useDB();
  const { role, can, me } = useSession();
  const phone = useIsPhone();
  const openEntity = useOpenEntity();
  const rows = useOrderRows();
  const [creating, setCreating] = useState(false);
  const today = db.meta.today;
  const isRep = role === 'rep';
  const canNew = can('createOrder') || can('createRequest');
  const newLabel = can('createOrder') ? 'Новый заказ' : 'Новая заявка';
  const hasDrafts = rows.some((r) => r.o.state === 'draft');
  const narrow = useMedia('(max-width: 1360px)');
  const showOwner = role === 'owner' || role === 'accountant';
  const ownerColumn = showOwner && !narrow;
  const ownerInSub = showOwner && narrow;
  const allLabel = role === 'manager' || role === 'rep' ? 'Все мои' : 'Все';
  const offline = useOffline();
  const queued = isRep ? offline.queued : NONE;
  // заявка у владельца — «На согласовании у владельца», у представителя своя заявка — «Ждёт менеджера»
  const stateDef = (r: OrderRow) => (r.o.state === 'request' && r.approval ? APPROVAL_STATUS : r.o.state === 'request' && isRep ? WAITS_MANAGER : ORDER_STATE[r.o.state]);

  // ?stage=… — пришли с рабочего стола по строке «Мои заказы в работе»
  const [params, setParams] = useSearchParams();
  const stageKey = params.get('stage');
  const stage = WORK_STAGES.find((x) => x.key === stageKey);
  const shownRows = useMemo(() => (stage ? rows.filter((r) => stage.test(r.o, r.delivery)) : rows), [rows, stage]);
  const clearStage = () => {
    params.delete('stage');
    setParams(params, { replace: true });
  };
  const stageChip = stage ? (
    <span className="sales-stage-filter" data-hint="sales.orders-stage">
      <Chip tone="info">
        {stage.label} · {fmt.num(shownRows.length)}
      </Chip>
      <Button size="sm" variant="ghost" icon={<X />} onClick={clearStage}>
        Показать все
      </Button>
    </span>
  ) : null;

  const filters = useMemo<FilterDef<OrderRow>[]>(() => {
    const opts: FilterDef<OrderRow>['options'] = [{ value: 'all', label: allLabel }];
    if (hasDrafts) opts.push({ value: 'draft', label: 'Черновики', test: STATE_TESTS.draft });
    opts.push(
      { value: 'request', label: 'Заявки', test: STATE_TESTS.request },
      { value: 'work', label: 'В работе', test: STATE_TESTS.work },
      { value: 'wait', label: 'Ждут оплаты', test: STATE_TESTS.wait },
      { value: 'overdue', label: 'Просрочены', test: STATE_TESTS.overdue },
      { value: 'shipped', label: 'Отгружены', test: STATE_TESTS.shipped },
      { value: 'cancelled', label: 'Отменены', test: STATE_TESTS.cancelled },
    );
    const week = fmt.addDays(today, -6);
    const month = today.slice(0, 7) + '-01';
    const d30 = fmt.addDays(today, -29);
    return [
      { key: 'state', label: 'Состояние', showCounts: true, options: opts },
      {
        key: 'period',
        label: 'Период',
        options: [
          { value: 'all', label: 'За всё время' },
          { value: 'today', label: 'Сегодня', test: (r) => r.o.createdAt.slice(0, 10) === today },
          { value: 'week', label: '7 дней', test: (r) => r.o.createdAt.slice(0, 10) >= week },
          { value: 'month', label: 'Этот месяц', test: (r) => r.o.createdAt.slice(0, 10) >= month },
          { value: '30', label: '30 дней', test: (r) => r.o.createdAt.slice(0, 10) >= d30 },
        ],
      },
    ];
  }, [hasDrafts, today, allLabel]);

  const columns = useMemo<Column<OrderRow>[]>(
    () => [
      {
        key: 'number',
        header: '№ и дата',
        sort: (r) => r.o.number,
        csv: (r) => r.o.number,
        render: (r) => (
          <>
            <div className="cell-title nowrap">№ {r.o.number}</div>
            <div className="cell-sub nowrap">
              {fmt.dateShort(r.o.createdAt)}
              <span className="sales-order-time">, {fmt.time(r.o.createdAt)}</span>
            </div>
          </>
        ),
      },
      {
        key: 'client',
        header: 'Клиент',
        sort: (r) => r.client?.name ?? '',
        csv: (r) => r.client?.name ?? '',
        className: 'sales-col-client',
        render: (r) => (
          <>
            <div className="cell-title ellipsis" title={r.client?.name}>
              {r.client?.name ?? '—'}
            </div>
            <div className="cell-sub ellipsis">{[ownerInSub || (role === 'manager' && r.owner && r.owner.id !== me.id) ? r.owner?.short : null, r.point?.address].filter(Boolean).join(' · ') || '—'}</div>
          </>
        ),
      },
      {
        key: 'owner',
        header: 'Ответственный',
        hidden: !ownerColumn,
        sort: (r) => r.owner?.name ?? '',
        csv: (r) => r.owner?.name ?? '',
        render: (r) => <span className="nowrap ink-2">{r.owner?.short ?? '—'}</span>,
      },
      {
        key: 'total',
        header: 'Сумма',
        align: 'right',
        sort: (r) => r.o.total,
        csv: (r) => r.o.total,
        render: (r) => <span className={cx('w-600', r.o.state === 'cancelled' && 'faint')}>{fmt.money(r.o.total)}</span>,
        total: (rs) => fmt.money(rs.reduce((s, r) => s + (r.o.state === 'cancelled' ? 0 : r.o.total), 0)),
      },
      {
        key: 'state',
        header: 'Заказ',
        sort: (r) => ['draft', 'request', 'confirmed', 'closed', 'cancelled'].indexOf(r.o.state),
        csv: (r) => stateDef(r).label,
        render: (r) => (
          <span className="chips" data-hint={r.approval ? 'sales.orders-approval' : 'sales.orders-stages'}>
            <StatusChip s={stateDef(r)} />
            {queued.includes(r.o.id) ? <StatusChip s={NOT_SENT} /> : null}
          </span>
        ),
      },
      {
        key: 'pick',
        header: 'Сборка',
        sort: (r) => (live(r.o) ? ['none', 'picking', 'picked'].indexOf(r.o.pick) : -1),
        csv: (r) => (live(r.o) ? PICK_STATE[r.o.pick].label : ''),
        render: (r) => (live(r.o) ? <StatusChip s={PICK_STATE[r.o.pick]} /> : <Dash />),
      },
      {
        key: 'ship',
        header: 'Отгрузка',
        sort: (r) => (!live(r.o) ? -1 : r.failed ? 0.5 : ['none', 'partial', 'shipped', 'delivered'].indexOf(r.o.ship)),
        csv: (r) => (live(r.o) ? shipStatus(r.o, r.delivery).label : ''),
        render: (r) => (live(r.o) ? <StatusChip s={shipStatus(r.o, r.delivery)} /> : <Dash />),
      },
      {
        key: 'pay',
        header: 'Оплата',
        sort: (r) => (live(r.o) && r.pay.amount > 0 ? ['unpaid', 'partial', 'paid', 'overpaid'].indexOf(r.pay.state) : -1),
        csv: (r) => (live(r.o) && r.pay.amount > 0 ? PAY_STATE[r.pay.state].label : ''),
        render: (r) => (live(r.o) && r.pay.amount > 0 ? <StatusChip s={PAY_STATE[r.pay.state]} /> : <Dash />),
      },
      {
        key: 'debt',
        header: 'Долг',
        align: 'right',
        sort: (r) => r.pay.debt,
        csv: (r) => r.pay.debt,
        render: (r) =>
          r.pay.debt > 0 ? (
            <span className="sales-debt" data-hint="sales.orders-debt">
              <span className={cx('w-600', r.overdue > 0 && 'c-bad')}>{fmt.money(r.pay.debt)}</span>
              {r.overdue > 0 ? <StatusChip s={overdueStatus(r.overdue)} /> : r.o.dueDate && !r.failed ? <span className="cell-sub">до {fmt.dateShort(r.o.dueDate)}</span> : null}
            </span>
          ) : (
            <Dash />
          ),
        total: (rs) => fmt.money(rs.reduce((s, r) => s + r.pay.debt, 0)),
      },
    ],
    [ownerColumn, ownerInSub, today, role, me.id, queued, isRep],
  );

  const search = useMemo(() => ({ placeholder: 'Номер, клиент, телефон или адрес', text: (r: OrderRow) => r.text }), []);
  const presetViews = useMemo<NonNullable<DataTableProps<OrderRow>['presetViews']>>(
    () => [
      { name: 'Заявки на подтверждение', search: '', filters: { state: 'request', period: 'all' }, sort: { key: 'number', dir: 'asc' } },
      { name: 'Просрочка — по сумме долга', search: '', filters: { state: 'overdue', period: 'all' }, sort: { key: 'debt', dir: 'desc' } },
      { name: 'Сегодняшние заказы', search: '', filters: { state: 'all', period: 'today' }, sort: { key: 'number', dir: 'desc' } },
    ],
    [],
  );

  const actions = canNew ? (
    <Button variant="primary" icon={isRep ? <Send /> : <Plus />} onClick={() => setCreating(true)} size={phone ? 'lg' : 'md'} data-hint="sales.orders-new">
      {newLabel}
    </Button>
  ) : null;

  const counts = useTabCounts();

  return (
    <>
      <PageHeader section="sales" actions={actions} counts={counts} />
      {phone ? (
        <PhoneOrders rows={rows} queued={queued} onOpen={(r) => openEntity('order', r.o.id)} />
      ) : (
        <div className="sales-orders">
        <DataTable
          key={stageKey ?? 'all'}
          id={`sales-orders-${role}`}
          rows={shownRows}
          toolbar={stageChip}
          columns={columns}
          rowKey={(r) => r.o.id}
          search={search}
          filters={filters}
          defaultSort={{ key: 'number', dir: 'desc' }}
          onRowClick={(r) => openEntity('order', r.o.id)}
          exportName={isRep ? 'Мои заказы' : 'Заказы'}
          presetViews={presetViews}
          totalLabel={(n) => `Итого · ${fmt.count(n, 'заказ', 'заказа', 'заказов')}`}
          rowClassName={(r) => (r.o.state === 'cancelled' ? 'sales-row-off' : undefined)}
          empty={<EmptyState title="Заказов нет">Измените поиск или фильтры</EmptyState>}
        />
        </div>
      )}
      {creating ? <NewOrderDrawer onClose={() => setCreating(false)} /> : null}
    </>
  );
}

/* ---------- телефон представителя: карточки ---------- */

function PhoneOrders({ rows, queued, onOpen }: { rows: OrderRow[]; queued: string[]; onOpen: (r: OrderRow) => void }) {
  const [q, setQ] = useState('');
  const { role } = useSession();
  const [f, setF] = useState<'all' | 'request' | 'work' | 'wait' | 'shipped'>('all');
  const searched = useMemo(() => {
    if (!q.trim()) return rows;
    const t = norm(q.trim()).split(/\s+/);
    return rows.filter((r) => {
      const s = norm(r.text);
      return t.every((x) => s.includes(x));
    });
  }, [rows, q]);
  const counts = {
    all: searched.length,
    request: searched.filter(STATE_TESTS.request).length,
    work: searched.filter(STATE_TESTS.work).length,
    wait: searched.filter(STATE_TESTS.wait).length,
    shipped: searched.filter(STATE_TESTS.shipped).length,
  };
  const shown = (f === 'all' ? searched : searched.filter(STATE_TESTS[f])).slice(0, 40);
  return (
    <div className="col-3">
      <SearchInput value={q} onChange={setQ} placeholder="Номер или клиент" size="lg" />
      <div className="sales-phone-seg" data-hint="sales.phone-orders-filter">
        <Segmented
          value={f}
          onChange={setF}
          options={[
            { value: 'all', label: role === 'manager' || role === 'rep' ? 'Все мои' : 'Все', count: counts.all },
            { value: 'request', label: 'Заявки', count: counts.request },
            { value: 'work', label: 'В работе', count: counts.work },
            { value: 'wait', label: 'Ждут оплаты', count: counts.wait },
            { value: 'shipped', label: 'Отгружены', count: counts.shipped },
          ]}
        />
      </div>
      {shown.length ? (
        shown.map((r) => (
          <button key={r.o.id} type="button" className="card sales-order-card" onClick={() => onOpen(r)} data-hint="sales.phone-order-card">
            <div className="row">
              <span className="w-700 t-14">№ {r.o.number}</span>
              <span className="muted t-12">{fmt.dateTime(r.o.createdAt)}</span>
              <span className="spacer" />
              <span className="w-700 t-16 num">{fmt.money(r.o.total)}</span>
            </div>
            <div className="w-600 t-14 ellipsis">{r.client?.name}</div>
            <div className="muted t-12 ellipsis">{r.point?.address ?? ''}</div>
            {/* не больше трёх чипов: этап, оплата или просрочка, «Не отправлена» */}
            <OrderBrief o={r.o} pay={r.pay} delivery={r.delivery} rep={role === 'rep'} approval={r.approval} extra={queued.includes(r.o.id) ? <StatusChip s={NOT_SENT} /> : null} />
            {r.pay.debt > 0 ? (
              <div className={cx('t-13 w-600', r.overdue > 0 ? 'c-bad' : 'ink-2')}>
                Долг {fmt.money(r.pay.debt)}
                {r.o.dueDate && r.overdue === 0 && !r.failed ? ` · оплата до ${fmt.date(r.o.dueDate)}` : ''}
              </div>
            ) : null}
          </button>
        ))
      ) : (
        <Card>
          <EmptyState title={f === 'request' ? 'Заявок нет — все подтверждены' : 'Ничего не нашли'}>{f === 'request' ? null : 'Измените поиск или фильтр'}</EmptyState>
        </Card>
      )}
    </div>
  );
}
