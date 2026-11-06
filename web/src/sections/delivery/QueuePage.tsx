/* Доставки: очередь на день — счётчики состояний, таблица, назначение. */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronDown, Clock as ClockIcon, UserPlus } from 'lucide-react';
import type { Delivery, DeliveryState } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { PageHeader } from '../../shell/PageHeader';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { Avatar, Button, Card, DataTable, EmptyState, MoreMenu, PICK_STATE, SearchInput, Select, StatusChip, cx, fmt, type Column } from '../../ui';
import { DayPicker, DelayChip, LateChip, StateChip, StatePills, useDayParam, useNarrow, type StateFilter } from './parts';
import { byRoute, clockOf, couriersOf, dayLabel, delayOf, forDay, intervalStart, lateOf, placesText, shortDistrict, type Clock } from './lib';
import { actsFor, useDeliveryFlow } from './flow';

const STATE_RANK: Record<DeliveryState, number> = { failed: 0, waiting: 1, on_way: 2, assigned: 3, delivered: 4, returned: 5 };

export function QueuePage() {
  const db = useDB();
  const version = useDBVersion();
  const { role, can } = useSession();
  const scoped = useScoped();
  const c = clockOf(db);
  const [day, setDay] = useDayParam(c);
  const [params, setParams] = useSearchParams();
  const open = useOpenEntity();
  const flow = useDeliveryFlow();
  const ix = indexes(db);

  const stateF = (params.get('state') as StateFilter | null) ?? 'all';
  const courierF = params.get('courier') ?? '';
  const districtF = params.get('district') ?? '';
  const setParam = (k: string, v: string, empty = '') => {
    const next = new URLSearchParams(params);
    if (v === empty) next.delete(k);
    else next.set(k, v);
    setParams(next, { replace: true });
  };

  const couriers = useMemo(() => couriersOf(db), [db, version]);
  const dayList = useMemo(() => forDay(scoped.deliveries, day, c), [db, version, scoped, day]);
  const dayCounts = useMemo(() => {
    const n = (dd: string) => forDay(scoped.deliveries, dd, c).filter((d) => d.state !== 'returned').length;
    return { today: n(c.today), tomorrow: n(c.tomorrow) };
  }, [db, version, scoped]);
  const districts = useMemo(() => [...new Set(dayList.map((d) => d.district))].sort((a, b) => a.localeCompare(b, 'ru')), [dayList]);

  const base = useMemo(
    () =>
      dayList.filter(
        (d) => (!courierF || (courierF === 'none' ? !d.courierId : d.courierId === courierF)) && (!districtF || d.district === districtF),
      ),
    [dayList, courierF, districtF],
  );
  const counts = useMemo(() => {
    const res: Record<string, number> = { all: 0 };
    let late = 0;
    let returned = 0;
    for (const d of base) {
      if (d.state === 'returned') {
        returned++;
        continue;
      }
      res.all++;
      res[d.state] = (res[d.state] ?? 0) + 1;
      if (lateOf(d, c)) late++;
    }
    return { res, late, returned };
  }, [base, version]);

  const rows = useMemo(() => {
    const list = base.filter((d) =>
      stateF === 'all' ? d.state !== 'returned' : stateF === 'late' ? !!lateOf(d, c) : d.state === stateF,
    );
    return list.sort((a, b) => STATE_RANK[a.state] - STATE_RANK[b.state] || intervalStart(a.interval) - intervalStart(b.interval) || byRoute(a, b));
  }, [base, stateF, version]);

  const waiting = dayList.filter((d) => d.state === 'waiting');
  const canAssign = can('assignDelivery');
  const isWarehouse = role === 'warehouse';
  const narrow = useNarrow();
  const phone = useNarrow('(max-width: 760px)');
  const compact = narrow || isWarehouse;

  const columns: Column<Delivery>[] = [
    {
      key: 'number',
      header: '№',
      render: (d) => {
        const o = ix.orders.get(d.orderId);
        return (
          <div className="col" style={{ gap: 0 }}>
            <span className="w-600 nowrap">№ {d.number}</span>
            {o ? (
              <EntityLink type="order" id={o.id} className="entity-link dl-sublink">
                заказ № {o.number}
              </EntityLink>
            ) : null}
          </div>
        );
      },
      sort: (d) => d.number,
      csv: (d) => `${d.number} / заказ ${ix.orders.get(d.orderId)?.number ?? ''}`,
      width: 96,
    },
    {
      key: 'client',
      header: 'Клиент и адрес',
      render: (d) => (
        <div className="dl-cell-client" data-hint="delivery.row">
          <div className="cell-title ellipsis">{ix.clients.get(d.clientId)?.name ?? d.contactName}</div>
          <div className="cell-sub ellipsis">
            {d.address} · {shortDistrict(d.district)}
          </div>
        </div>
      ),
      sort: (d) => ix.clients.get(d.clientId)?.name ?? '',
      csv: (d) => `${ix.clients.get(d.clientId)?.name ?? ''}, ${d.address}, ${d.district}`,
    },
    {
      key: 'interval',
      header: 'Интервал',
      render: (d) => (
        <div className="col" style={{ gap: 0 }}>
          <span className="num w-600">{d.interval}</span>
          {d.date !== day ? <span className="cell-sub">{fmt.date(d.date)}</span> : null}
        </div>
      ),
      sort: (d) => d.date + String(intervalStart(d.interval)).padStart(4, '0'),
      csv: (d) => `${d.date} ${d.interval}`,
      width: 100,
    },
    {
      key: 'courier',
      header: 'Курьер',
      render: (d) => {
        const e = d.courierId ? ix.employees.get(d.courierId) : undefined;
        return e ? (
          <span className="nowrap">{e.short}</span>
        ) : (
          <span className="faint">—</span>
        );
      },
      sort: (d) => (d.courierId ? ix.employees.get(d.courierId)?.name ?? '' : null),
      csv: (d) => (d.courierId ? ix.employees.get(d.courierId)?.name ?? '' : ''),
      width: 96,
    },
    {
      key: 'places',
      header: 'Мест и вес',
      align: 'right',
      render: (d) => (
        <span className="nowrap">
          <span className="w-600">{fmt.num(d.places)}</span>
          <span className="muted"> · {fmt.num(Math.round(d.weightKg))} кг</span>
        </span>
      ),
      sort: (d) => d.places,
      csv: (d) => `${d.places} мест, ${d.weightKg} кг`,
      total: (rs) => `${fmt.num(rs.reduce((z, d) => z + d.places, 0))} · ${fmt.num(Math.round(rs.reduce((z, d) => z + d.weightKg, 0)))} кг`,
      width: 110,
    },
    {
      key: 'collect',
      header: 'К получению',
      hidden: isWarehouse,
      align: 'right',
      render: (d) => (d.collect > 0 ? <span className="w-600">{fmt.money(d.collect)}</span> : <span className="faint">—</span>),
      sort: (d) => d.collect,
      total: (rs) => fmt.money(rs.reduce((z, d) => z + d.collect, 0)),
      width: 112,
    },
    {
      key: 'state',
      header: 'Статус',
      render: (d) =>
        (compact && lateOf(d, c)) || delayOf(d) ? (
          <div className="col" style={{ gap: 4, alignItems: 'flex-start' }} data-hint={d.state === 'on_way' ? 'delivery.onway' : undefined}>
            <StateChip d={d} />
            {compact ? <LateChip d={d} c={c} /> : null}
            <DelayChip d={d} />
          </div>
        ) : (
          <span data-hint={d.state === 'on_way' ? 'delivery.onway' : undefined}>
            <StateChip d={d} />
          </span>
        ),
      sort: (d) => STATE_RANK[d.state],
      csv: (d) => d.state,
      width: 176,
    },
    {
      key: 'late',
      header: 'Опоздание',
      hidden: compact,
      render: (d) => <LateChip d={d} c={c} short />,
      sort: (d) => lateOf(d, c)?.minutes ?? null,
      csv: (d) => lateOf(d, c)?.label ?? '',
      width: 110,
    },
    {
      key: 'pick',
      header: 'Сборка',
      hidden: !isWarehouse,
      render: (d) => {
        const o = ix.orders.get(d.orderId);
        return o && d.state === 'assigned' ? <StatusChip s={PICK_STATE[o.pick]} /> : <span className="faint">—</span>;
      },
      width: 120,
    },
    {
      key: 'act',
      header: '',
      hidden: !canAssign && !isWarehouse,
      render: (d) => {
        const acts = actsFor(d, can, { courier: false, order: ix.orders.get(d.orderId) });
        if (!acts.all.length) return null;
        const showMain = acts.main && (acts.main.key === 'assign' || acts.main.key === 'retry' || acts.main.key === 'return');
        return (
          <span className="row dl-row-acts" onClick={(e) => e.stopPropagation()}>
            {showMain && acts.main ? (
              <Button size="sm" variant="secondary" data-hint="delivery.row-main" onClick={() => flow.act(acts.main!, d)}>
                {acts.main.key === 'retry' ? 'Повторить' : acts.main.label}
              </Button>
            ) : null}
            <MoreMenu size="sm" items={flow.menu(showMain ? acts.more : acts.all, d)} />
          </span>
        );
      },
      width: 1,
    },
  ];

  const titleDay = dayLabel(day, c);
  const emptyTitle =
    stateF === 'waiting'
      ? 'Ожидающих нет — все доставки назначены'
      : stateF === 'failed'
        ? 'Неудачных попыток нет'
        : stateF === 'late'
          ? 'Опаздывающих нет — все идут в интервал'
          : stateF === 'all'
            ? `${titleDay} доставок нет`
            : 'Таких доставок нет';

  return (
    <>
      <PageHeader
        section="delivery"
        actions={
          canAssign && waiting.length ? (
            <Button variant="primary" icon={<UserPlus />} data-hint="delivery.assign-all" onClick={() => flow.bulk(waiting.map((d) => d.id), day)}>
              Назначить ожидающие · {waiting.length}
            </Button>
          ) : null
        }
      />

      <div className={cx('dl-toolbar', phone && 'is-phone')}>
        <DayPicker day={day} onChange={setDay} c={c} counts={dayCounts} />
        <StatePills value={stateF} onChange={(v) => setParam('state', v, 'all')} counts={counts.res} late={counts.late} returned={counts.returned} />
      </div>

      {isWarehouse ? <HandoffCard list={dayList} /> : null}

      {phone ? (
        <PhoneQueue rows={rows} c={c} canAssign={canAssign} flow={flow} emptyTitle={emptyTitle} onOpen={(d) => open('delivery', d.id)} />
      ) : (
      <div className="dl-tight">
      <DataTable
        id={`delivery-queue-${role}`}
        rows={rows}
        columns={columns}
        rowKey={(d) => d.id}
        onRowClick={(d) => open('delivery', d.id)}
        search={{
          placeholder: 'Номер, клиент, адрес',
          text: (d) =>
            `${d.number} ${ix.orders.get(d.orderId)?.number ?? ''} ${ix.clients.get(d.clientId)?.name ?? ''} ${d.address} ${d.district} ${d.contactName} ${d.contactPhone} ${
              d.courierId ? ix.employees.get(d.courierId)?.name ?? '' : ''
            }`,
        }}
        toolbar={
          <>
            <Select
              size="sm"
              className="dl-filter"
              aria-label="Курьер"
              value={courierF}
              onChange={(e) => setParam('courier', e.target.value)}
              options={[{ value: '', label: 'Все курьеры' }, { value: 'none', label: 'Без курьера' }, ...couriers.map((e) => ({ value: e.id, label: e.name }))]}
            />
            <Select
              size="sm"
              className="dl-filter"
              aria-label="Район"
              value={districtF}
              onChange={(e) => setParam('district', e.target.value)}
              options={[{ value: '', label: 'Все районы' }, ...districts.map((d) => ({ value: d, label: d }))]}
            />
          </>
        }
        exportName={`Доставки ${fmt.dateShort(day, true)}`}
        totalLabel={() => 'Итого'}
        empty={
          <EmptyState title={emptyTitle}>
            {courierF || districtF ? 'Измените фильтр по курьеру или району' : stateF === 'all' ? 'Новые доставки появятся, когда менеджер оформит заказ с доставкой' : null}
          </EmptyState>
        }
      />
      </div>
      )}
      {flow.node}
    </>
  );
}

/** Телефон: карточки вместо таблицы — номер, клиент, статус, сумма и главное действие. */
function PhoneQueue({
  rows,
  c,
  canAssign,
  flow,
  emptyTitle,
  onOpen,
}: {
  rows: Delivery[];
  c: Clock;
  canAssign: boolean;
  flow: ReturnType<typeof useDeliveryFlow>;
  emptyTitle: string;
  onOpen: (d: Delivery) => void;
}) {
  const db = useDB();
  const { can } = useSession();
  const ix = indexes(db);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(30);
  const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е');
  const tokens = norm(q.trim()).split(/\s+/).filter(Boolean);
  const list = tokens.length
    ? rows.filter((d) => {
        const t = norm(`${d.number} ${ix.orders.get(d.orderId)?.number ?? ''} ${ix.clients.get(d.clientId)?.name ?? ''} ${d.address} ${d.district} ${d.contactName} ${d.courierId ? ix.employees.get(d.courierId)?.name ?? '' : ''}`);
        return tokens.every((x) => t.includes(x));
      })
    : rows;
  return (
    <div className="col-3">
      <SearchInput value={q} onChange={setQ} placeholder="Номер, клиент, адрес" size="lg" />
      {list.length ? (
        list.slice(0, limit).map((d) => {
          const o = ix.orders.get(d.orderId);
          const courier = d.courierId ? ix.employees.get(d.courierId) : undefined;
          const acts = canAssign ? actsFor(d, can, { courier: false, order: o }) : null;
          const main = acts?.main && (acts.main.key === 'assign' || acts.main.key === 'retry' || acts.main.key === 'return') ? acts.main : null;
          const more = acts ? (main ? acts.more : acts.all) : [];
          return (
            <div key={d.id} role="button" tabIndex={0} className="card dl-pcard" data-hint="delivery.row" onClick={() => onOpen(d)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(d))}>
              <div className="dl-pcard-top">
                <span className="w-700 t-14 nowrap">№ {d.number}</span>
                {o ? <span className="t-12 muted nowrap">заказ № {o.number}</span> : null}
                <span className="spacer" />
                {d.collect > 0 ? <span className="w-700 t-16 num nowrap">{fmt.money(d.collect)}</span> : <span className="t-13 muted nowrap">Без оплаты</span>}
              </div>
              <div className="col" style={{ gap: 2, minWidth: 0 }}>
                <span className="w-600 t-14 ellipsis">{ix.clients.get(d.clientId)?.name ?? d.contactName}</span>
                <span className="t-12 muted ellipsis">
                  {d.address} · {shortDistrict(d.district)}
                </span>
              </div>
              <div className="dl-pcard-meta">
                <span className="row nowrap" style={{ gap: 4 }}>
                  <ClockIcon />
                  {d.date !== c.today ? `${fmt.dateShort(d.date)}, ` : ''}
                  {d.interval}
                </span>
                <span className={cx('nowrap', !courier && 'faint')}>{courier ? courier.short : 'Без курьера'}</span>
                <span className="nowrap muted">
                  {placesText(d.places)} · {fmt.num(Math.round(d.weightKg))} кг
                </span>
              </div>
              <div className="dl-pcard-chips">
                <span className="chips grow" data-hint={d.state === 'on_way' ? 'delivery.onway' : undefined}>
                  <StateChip d={d} />
                  <LateChip d={d} c={c} />
                  <DelayChip d={d} />
                </span>
                {more.length ? (
                  <span onClick={(e) => e.stopPropagation()}>
                    <MoreMenu size="sm" items={flow.menu(more, d)} />
                  </span>
                ) : null}
              </div>
              {main ? (
                <div onClick={(e) => e.stopPropagation()}>
                  <Button size="lg" block icon={main.icon} data-hint="delivery.row-main" onClick={() => flow.act(main, d)}>
                    {main.key === 'retry' ? 'Повторить доставку' : main.label}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })
      ) : (
        <Card>
          <EmptyState title={tokens.length ? 'Ничего не нашли' : emptyTitle}>{tokens.length ? 'Измените поиск' : null}</EmptyState>
        </Card>
      )}
      {list.length > limit ? (
        <Button size="lg" block variant="ghost" icon={<ChevronDown />} onClick={() => setLimit((n) => n + 30)}>
          Показать ещё · {list.length - limit}
        </Button>
      ) : null}
    </div>
  );
}

/** Склад: что передать курьерам — назначенные и ещё не выехавшие, по курьерам. */
function HandoffCard({ list }: { list: Delivery[] }) {
  const db = useDB();
  const ix = indexes(db);
  const groups = new Map<string, Delivery[]>();
  for (const d of list) {
    if (d.state !== 'assigned' || !d.courierId) continue;
    groups.set(d.courierId, [...(groups.get(d.courierId) ?? []), d]);
  }
  if (!groups.size) return null;
  return (
    <Card title="Передать курьерам" hint="delivery.handoff">
      <div className="dl-handoff">
        {[...groups.entries()].map(([cid, ds]) => {
          const e = ix.employees.get(cid);
          const picked = ds.filter((d) => ix.orders.get(d.orderId)?.pick === 'picked').length;
          return (
            <div key={cid} className="dl-handoff-item">
              <Avatar name={e?.name ?? 'Курьер'} />
              <span className="grow col" style={{ gap: 2 }}>
                <span className="w-700">{e?.name ?? 'Курьер'}</span>
                <span className="t-12 muted">
                  {fmt.count(ds.length, 'заказ', 'заказа', 'заказов')} · {placesText(ds.reduce((z, d) => z + d.places, 0))}
                </span>
              </span>
              <StatusChip s={picked === ds.length ? PICK_STATE.picked : { label: `Собрано ${picked} из ${ds.length}`, tone: 'warn' }} />
            </div>
          );
        })}
      </div>
    </Card>
  );
}
