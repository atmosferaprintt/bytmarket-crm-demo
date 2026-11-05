/* Деньги курьеров: получено за день, сдано, на руках; приём денег и сверка по доставкам. */
import { useMemo, useState } from 'react';
import { HandCoins } from 'lucide-react';
import type { Delivery, Employee, Payment } from '../../data/types';
import { PAY_METHOD_NAMES } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { courierCash, indexes } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { Avatar, Button, Card, Chip, DataTable, EmptyState, Kpi, Select, fmt, type Column } from '../../ui';
import { DayPicker, useDayParam } from './parts';
import { clockOf, couriersOf, dayLabel, deliveredAt, moneyOfDay, type CourierDay } from './lib';
import { useDeliveryFlow } from './flow';

interface CourierRow {
  e: Employee;
  day: CourierDay;
  count: number;
}

export function CashPage() {
  const db = useDB();
  const version = useDBVersion();
  const { can } = useSession();
  const c = clockOf(db);
  const [day, setDay] = useDayParam(c);
  const flow = useDeliveryFlow();
  const open = useOpenEntity();
  const ix = indexes(db);
  const [courierF, setCourierF] = useState('');
  const canTake = can('handInCash');

  const rows: CourierRow[] = useMemo(
    () =>
      couriersOf(db).map((e) => {
        const cash = courierCash(db, e.id);
        const m = moneyOfDay(db, e.id, day, cash.onHand);
        return { e, day: m, count: m.list.length };
      }),
    [db, version, day],
  );
  const totals = rows.reduce(
    (z, r) => ({ cash: z.cash + r.day.cash, card: z.card + r.day.card, handed: z.handed + r.day.handedToday, onHand: z.onHand + r.day.onHand }),
    { cash: 0, card: 0, handed: 0, onHand: 0 },
  );

  // доставки дня с деньгами: к получению или получено
  const money = useMemo(
    () =>
      db.deliveries
        .filter((d) => {
          if (!d.courierId) return false;
          if (courierF && d.courierId !== courierF) return false;
          if (d.state === 'delivered') return (deliveredAt(d) ?? '').slice(0, 10) === day && (d.collect > 0 || d.collected > 0);
          return d.date === day && d.collect > 0 && d.state !== 'returned' && d.state !== 'waiting';
        })
        .sort((a, b) => (deliveredAt(a) ?? 'z').localeCompare(deliveredAt(b) ?? 'z') || a.number - b.number),
    [db, version, day, courierF],
  );

  const handIns = useMemo(
    () =>
      db.payments
        .filter((p) => p.kind === 'transfer' && p.account === 'courier_cash' && p.at.slice(0, 10) === day)
        .sort((a, b) => b.at.localeCompare(a.at)),
    [db, version, day],
  );

  const courierCols: Column<CourierRow>[] = [
    {
      key: 'name',
      header: 'Курьер',
      render: (r) => (
        <span className="row" style={{ gap: 10 }}>
          <Avatar name={r.e.name} size="sm" />
          <span className="cell-title nowrap">{r.e.name}</span>
        </span>
      ),
      sort: (r) => r.e.name,
      csv: (r) => r.e.name,
    },
    { key: 'count', header: 'Доставок', align: 'right', render: (r) => fmt.num(r.count), sort: (r) => r.count, total: (rs) => fmt.num(rs.reduce((z, r) => z + r.count, 0)) },
    { key: 'cash', header: 'Наличными', align: 'right', render: (r) => fmt.money(r.day.cash), sort: (r) => r.day.cash, total: (rs) => fmt.money(rs.reduce((z, r) => z + r.day.cash, 0)) },
    { key: 'card', header: 'Картой', align: 'right', render: (r) => fmt.money(r.day.card), sort: (r) => r.day.card, total: (rs) => fmt.money(rs.reduce((z, r) => z + r.day.card, 0)) },
    { key: 'handed', header: 'Сдано', align: 'right', render: (r) => fmt.money(r.day.handedToday), sort: (r) => r.day.handedToday, total: (rs) => fmt.money(rs.reduce((z, r) => z + r.day.handedToday, 0)) },
    {
      key: 'onHand',
      header: 'На руках',
      align: 'right',
      render: (r) => <span className={r.day.onHand > 0 ? 'w-700 c-warn' : 'faint'}>{fmt.money(r.day.onHand)}</span>,
      sort: (r) => r.day.onHand,
      total: (rs) => fmt.money(rs.reduce((z, r) => z + r.day.onHand, 0)),
    },
    {
      key: 'act',
      header: '',
      hidden: !canTake,
      width: 120,
      render: (r) =>
        r.day.onHand > 0 ? (
          <span onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="secondary" icon={<HandCoins />} onClick={() => flow.handIn(r.e.id)}>
              Принять
            </Button>
          </span>
        ) : (
          <Chip tone="ok">Всё сдано</Chip>
        ),
    },
  ];

  const moneyCols: Column<Delivery>[] = [
    { key: 'number', header: '№', render: (d) => <span className="w-600 nowrap">№ {d.number}</span>, sort: (d) => d.number, width: 76 },
    { key: 'at', header: 'Вручено', render: (d) => (deliveredAt(d) ? fmt.time(deliveredAt(d)) : <span className="faint">—</span>), sort: (d) => deliveredAt(d), width: 90 },
    {
      key: 'courier',
      header: 'Курьер',
      render: (d) => ix.employees.get(d.courierId ?? '')?.short ?? '—',
      sort: (d) => ix.employees.get(d.courierId ?? '')?.name ?? '',
      width: 120,
    },
    {
      key: 'client',
      header: 'Клиент',
      render: (d) => (
        <div className="dl-cell-client">
          <div className="cell-title ellipsis">{ix.clients.get(d.clientId)?.name ?? d.contactName}</div>
          <div className="cell-sub ellipsis">{d.address}</div>
        </div>
      ),
      sort: (d) => ix.clients.get(d.clientId)?.name ?? '',
    },
    {
      key: 'order',
      header: 'Заказ',
      render: (d) => {
        const o = ix.orders.get(d.orderId);
        return o ? (
          <EntityLink type="order" id={o.id} className="entity-link nowrap">
            № {o.number}
          </EntityLink>
        ) : (
          '—'
        );
      },
      width: 84,
    },
    { key: 'collect', header: 'К получению', align: 'right', render: (d) => fmt.money(d.collect), sort: (d) => d.collect, total: (rs) => fmt.money(rs.reduce((z, d) => z + d.collect, 0)) },
    {
      key: 'collected',
      header: 'Получено',
      align: 'right',
      render: (d) => (d.state === 'delivered' ? <span className="w-600">{fmt.money(d.collected)}</span> : <span className="faint">—</span>),
      sort: (d) => d.collected,
      total: (rs) => fmt.money(rs.reduce((z, d) => z + d.collected, 0)),
    },
    {
      key: 'method',
      header: 'Способ',
      render: (d) => (d.collected > 0 && d.collectedMethod ? PAY_METHOD_NAMES[d.collectedMethod] : <span className="faint">—</span>),
      sort: (d) => d.collectedMethod ?? '',
      width: 100,
    },
    {
      key: 'check',
      header: 'Сверка',
      render: (d) => {
        if (d.state !== 'delivered') return <Chip tone="neutral">Ещё в пути</Chip>;
        if (d.collected < d.collect) return <Chip tone="bad">{`Меньше на ${fmt.money(d.collect - d.collected)}`}</Chip>;
        if (d.collectedMethod !== 'cash' || d.collected === 0) return <Chip tone="info">На счёт</Chip>;
        return d.handedIn ? <Chip tone="ok">Сдано</Chip> : <Chip tone="warn">На руках</Chip>;
      },
      sort: (d) => (d.state !== 'delivered' ? 0 : d.collected < d.collect ? 1 : d.handedIn ? 3 : 2),
      width: 150,
    },
  ];

  return (
    <>
      <PageHeader section="delivery" />
      <div className="dl-toolbar">
        <DayPicker day={day} onChange={setDay} c={c} />
      </div>
      <div className="grid-4">
        <Kpi label={`Наличными · ${dayLabel(day, c).toLowerCase()}`} value={fmt.money(totals.cash)} />
        <Kpi label="Картой и переводом" value={fmt.money(totals.card)} />
        <Kpi label="Сдано в кассу" value={fmt.money(totals.handed)} />
        <Kpi label="На руках у курьеров" value={<span className={totals.onHand > 0 ? 'c-warn' : undefined}>{fmt.money(totals.onHand)}</span>} />
      </div>

      <div className="dl-cash-grid dl-tight">
        <DataTable
          title="По курьерам"
          rows={rows}
          columns={courierCols}
          rowKey={(r) => r.e.id}
          onRowClick={(r) => setCourierF((v) => (v === r.e.id ? '' : r.e.id))}
          selectedKey={courierF || null}
          totalLabel={() => 'Итого'}
          exportName={`Деньги курьеров ${fmt.dateShort(day, true)}`}
          empty={<EmptyState title="Курьеров нет" />}
        />
        <HandIns list={handIns} />
      </div>

      <div className="dl-tight">
      <DataTable
        id="delivery-cash"
        title="Деньги по доставкам"
        rows={money}
        columns={moneyCols}
        rowKey={(d) => d.id}
        onRowClick={(d) => open('delivery', d.id)}
        toolbar={
          <Select
            size="sm"
            className="dl-filter"
            aria-label="Курьер"
            value={courierF}
            onChange={(e) => setCourierF(e.target.value)}
            options={[{ value: '', label: 'Все курьеры' }, ...rows.map((r) => ({ value: r.e.id, label: r.e.name }))]}
          />
        }
        totalLabel={() => 'Итого'}
        exportName={`Сверка курьеров ${fmt.dateShort(day, true)}`}
        empty={<EmptyState title={`${dayLabel(day, c)} денег по доставкам не было`} />}
      />
      </div>
      {flow.node}
    </>
  );
}

function HandIns({ list }: { list: Payment[] }) {
  const db = useDB();
  const ix = indexes(db);
  return (
    <Card title="Сдачи в кассу" flush>
      {list.length ? (
        <div className="list">
          {list.map((p) => {
            const d = p.deliveryId ? db.deliveries.find((x) => x.id === p.deliveryId) : undefined;
            const courier = d?.courierId ? ix.employees.get(d.courierId) : undefined;
            const author = ix.employees.get(p.authorId);
            return (
              <div key={p.id} className="list-row">
                <Avatar name={courier?.name ?? 'Курьер'} size="sm" />
                <span className="grow col" style={{ gap: 0, minWidth: 0 }}>
                  <span className="w-600 ellipsis">{courier?.name ?? 'Курьер'}</span>
                  <span className="t-12 muted ellipsis">
                    {fmt.time(p.at)} · принял {author?.short ?? '—'}
                  </span>
                </span>
                <span className="num w-700">{fmt.money(p.amount)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="Сдач в этот день не было" />
      )}
    </Card>
  );
}
