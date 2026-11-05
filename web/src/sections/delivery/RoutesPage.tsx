/* Маршруты курьеров: колонки по курьерам на день, точки по порядку, загрузка и деньги. */
import { useMemo } from 'react';
import { ChevronDown, ChevronUp, Navigation, Phone, UserPlus } from 'lucide-react';
import type { Delivery } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { courierCash, indexes } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { Avatar, Button, Chip, EmptyState, ProgressBar, cx, fmt, toast } from '../../ui';
import { DayPicker, LateChip, StateChip, useDayParam } from './parts';
import { byRoute, clockOf, forDay, kgText, loadsOf, placesText, routeUrl, shortDistrict, telUrl, type Clock, type CourierLoad } from './lib';
import { useDeliveryFlow } from './flow';

export function RoutesPage() {
  const db = useDB();
  const version = useDBVersion();
  const { can } = useSession();
  const c = clockOf(db);
  const [day, setDay] = useDayParam(c);
  const flow = useDeliveryFlow();
  const loads = useMemo(() => loadsOf(db, day, c), [db, version, day]);
  const waiting = useMemo(() => forDay(db.deliveries, day, c).filter((d) => d.state === 'waiting').sort(byRoute), [db, version, day]);
  const counts = useMemo(() => {
    const n = (dd: string) => forDay(db.deliveries, dd, c).filter((d) => d.state !== 'returned').length;
    return { today: n(c.today), tomorrow: n(c.tomorrow) };
  }, [db, version]);
  const canAssign = can('assignDelivery');

  return (
    <>
      <PageHeader
        section="delivery"
        actions={
          canAssign && waiting.length ? (
            <Button variant="primary" icon={<UserPlus />} onClick={() => flow.bulk(waiting.map((d) => d.id), day)}>
              Назначить ожидающие · {waiting.length}
            </Button>
          ) : null
        }
      />
      <div className="dl-toolbar">
        <DayPicker day={day} onChange={setDay} c={c} counts={counts} />
      </div>
      {waiting.length ? <WaitingStrip list={waiting} flow={flow} canAssign={canAssign} /> : null}
      <div className="dl-routes">
        {loads.map((l) => (
          <RouteColumn key={l.courier.id} load={l} c={c} canMove={canAssign} />
        ))}
        {!loads.length ? (
          <div className="card">
            <EmptyState title="Курьеров нет">Добавьте курьера в «Команде и правах»</EmptyState>
          </div>
        ) : null}
      </div>
      {flow.node}
    </>
  );
}

function WaitingStrip({ list, flow, canAssign }: { list: Delivery[]; flow: ReturnType<typeof useDeliveryFlow>; canAssign: boolean }) {
  const db = useDB();
  const open = useOpenEntity();
  const ix = indexes(db);
  return (
    <section className="card dl-waiting">
      <div className="dl-route-head">
        <span className="dl-route-icon">
          <UserPlus />
        </span>
        <span className="t-16 w-700">Без курьера</span>
        <Chip tone="warn">{list.length}</Chip>
      </div>
      <div className="dl-waiting-list">
        {list.map((d) => (
          <div key={d.id} className="dl-waiting-item" role="button" tabIndex={0} onClick={() => open('delivery', d.id)} onKeyDown={(e) => e.key === 'Enter' && open('delivery', d.id)}>
            <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
              <span className="row" style={{ gap: 6 }}>
                <span className="num w-700">{d.interval}</span>
                <span className="t-12 muted">№ {d.number}</span>
              </span>
              <span className="w-600 ellipsis">{d.address}</span>
              <span className="t-12 muted ellipsis">
                {shortDistrict(d.district)} · {ix.clients.get(d.clientId)?.name ?? d.contactName}
              </span>
              <span className="t-12 ink-2">
                {placesText(d.places)} · {kgText(d.weightKg)}
                {d.collect > 0 ? ` · ${fmt.money(d.collect)}` : ''}
              </span>
            </span>
            {canAssign ? (
              <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); flow.act('assign', d); }}>
                Назначить
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function RouteColumn({ load, c, canMove }: { load: CourierLoad; c: Clock; canMove: boolean }) {
  const db = useDB();
  const { me } = useSession();
  const open = useOpenEntity();
  const ix = indexes(db);
  const cash = courierCash(db, load.courier.id);
  const remaining = load.list.filter((d) => d.state === 'assigned' || d.state === 'on_way');
  const routePts = remaining.length ? remaining : load.list;
  const movable = load.list.filter((d) => d.state === 'assigned');

  const move = (d: Delivery, dir: -1 | 1) => {
    const i = movable.indexOf(d);
    const other = movable[i + dir];
    if (!other) return;
    let a = other.routeOrder;
    let b = d.routeOrder;
    if (a === b) {
      a = dir < 0 ? Math.max(1, b - 1) : b + 1;
      if (a === b) b = a + 1;
    }
    const r1 = dispatch('delivery.assign' as never, { deliveryId: d.id, courierId: load.courier.id, routeOrder: a } as never, me.id) as { ok: boolean; error?: string };
    if (!r1.ok) {
      toast(r1.error ?? 'Не получилось', 'error');
      return;
    }
    const r2 = dispatch('delivery.assign' as never, { deliveryId: other.id, courierId: load.courier.id, routeOrder: b } as never, me.id) as { ok: boolean; error?: string };
    if (!r2.ok) toast(r2.error ?? 'Не получилось', 'error');
    else toast(`Маршрут ${load.courier.short}: точка № ${d.number} ${dir < 0 ? 'раньше' : 'позже'}`);
  };

  return (
    <section className="card dl-route">
      <div className="dl-route-head">
        <Avatar name={load.courier.name} />
        <span className="grow col" style={{ gap: 0, minWidth: 0 }}>
          <span className="t-16 w-700 ellipsis">{load.courier.name}</span>
          <span className="t-12 muted">{fmt.phone(load.courier.phone)}</span>
        </span>
        <a className="btn btn-ghost btn-icon btn-sm" href={telUrl(load.courier.phone)} title="Позвонить курьеру" aria-label="Позвонить курьеру">
          <Phone />
        </a>
      </div>

      <div className="dl-route-stats">
        <div>
          <span className="dl-fact-label">Точек</span>
          <span className="dl-route-n">{load.points}</span>
        </div>
        <div>
          <span className="dl-fact-label">Мест</span>
          <span className="dl-route-n">{load.places}</span>
        </div>
        <div>
          <span className="dl-fact-label">Вес</span>
          <span className="dl-route-n">{fmt.num(load.kg)} кг</span>
        </div>
      </div>

      <div className="dl-route-progress">
        <div className="row">
          <span className="grow t-13">
            Вручено <span className="w-700">{load.done}</span> из {load.points}
            {load.failed ? <span className="c-bad w-600"> · не удалось {load.failed}</span> : null}
          </span>
        </div>
        <ProgressBar value={load.done} max={Math.max(1, load.points)} />
        <div className="row t-13">
          <span className="grow muted">На руках</span>
          <span className="num w-700">{fmt.money(cash.onHand)}</span>
        </div>
        {load.collect > 0 ? (
          <div className="row t-13">
            <span className="grow muted">Ещё получить</span>
            <span className="num w-700">{fmt.money(load.collect)}</span>
          </div>
        ) : null}
      </div>

      {routePts.length ? (
        <a className="dl-route-map" href={routeUrl(routePts)} target="_blank" rel="noreferrer">
          <Navigation />
          Маршрут на карте
        </a>
      ) : null}

      <div className="dl-stops">
        {load.list.map((d, i) => {
          const mi = movable.indexOf(d);
          return (
            <div
              key={d.id}
              className={cx('dl-stop', d.state === 'delivered' && 'is-done')}
              role="button"
              tabIndex={0}
              onClick={() => open('delivery', d.id)}
              onKeyDown={(e) => e.key === 'Enter' && open('delivery', d.id)}
            >
              <span className={cx('dl-stop-no', d.state === 'delivered' && 'is-done', d.state === 'failed' && 'is-bad')}>{i + 1}</span>
              <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  <span className="num w-700">{d.interval}</span>
                  <StateChip d={d} />
                  <LateChip d={d} c={c} />
                </span>
                <span className="w-600 ellipsis">{d.address}</span>
                <span className="t-12 muted ellipsis">
                  {shortDistrict(d.district)} · {ix.clients.get(d.clientId)?.name ?? d.contactName}
                </span>
                <span className="t-12 ink-2">
                  {placesText(d.places)}
                  {d.collect > 0 ? ` · к получению ${fmt.money(d.collect)}` : ''}
                </span>
              </span>
              {canMove && mi >= 0 && movable.length > 1 ? (
                <span className="dl-stop-move" onClick={(e) => e.stopPropagation()}>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Раньше" title="Раньше" disabled={mi === 0} onClick={() => move(d, -1)}>
                    <ChevronUp />
                  </button>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Позже" title="Позже" disabled={mi === movable.length - 1} onClick={() => move(d, 1)}>
                    <ChevronDown />
                  </button>
                </span>
              ) : null}
            </div>
          );
        })}
        {!load.list.length ? <div className="dl-route-empty">Точек на этот день нет</div> : null}
      </div>
      {load.districts.length ? (
        <div className="dl-route-foot chips">
          {load.districts.map((x) => (
            <Chip key={x} tone="outline">
              {x}
            </Chip>
          ))}
        </div>
      ) : null}
    </section>
  );
}
