/* Телефон курьера: крупные карточки заявок по порядку маршрута. Без таблиц, всё по ширине экрана. */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Clock as ClockIcon, ListOrdered, MessageSquare, Navigation, Package } from 'lucide-react';
import type { Delivery, ISODate } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { courierCash, indexes } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { useOpenEntity } from '../../shell/entities';
import { Button, EmptyState, cx, fmt } from '../../ui';
import { CallButton, LateChip, StateChip } from './parts';
import { byRoute, clockOf, dayLabel, deliveredAt, deliveredMoneyText, forDay, kgText, lastFail, mapUrl, notHandedIn, onHandLabel, onHandSince, placesText, routeUrl, type Clock } from './lib';
import { actsFor, useDeliveryFlow } from './flow';

/** Мои доставки на день по маршруту. */
export function useMyDay(day: ISODate) {
  const db = useDB();
  const version = useDBVersion();
  const scoped = useScoped();
  const c = clockOf(db);
  return useMemo(() => {
    const list = forDay(scoped.deliveries, day, c)
      .filter((d) => d.state !== 'returned')
      .sort(byRoute);
    const active = list.filter((d) => d.state === 'assigned' || d.state === 'on_way');
    const done = list.filter((d) => d.state === 'delivered');
    const failed = list.filter((d) => d.state === 'failed');
    return { list, active, done, failed, c };
  }, [db, version, scoped, day]);
}

/** «Осталось 4 из 7 · Вручено 3 · На руках, с 4 ноября 8 450 ₽»: на руках — все несданные наличные, не только за сегодня. */
export function CourierSummary({ day }: { day: ISODate }) {
  const db = useDB();
  const { me } = useSession();
  const { list, active, done, c } = useMyDay(day);
  const cash = courierCash(db, me.id);
  const since = onHandSince(db, me.id);
  const todayCash = notHandedIn(db, me.id)
    .filter((d) => (deliveredAt(d) ?? d.date).slice(0, 10) >= c.today)
    .reduce((z, d) => z + d.collected, 0);
  const onHandTitle = since && since < c.today ? `За сегодня ${fmt.money(todayCash)}, с прошлых дней ${fmt.money(cash.onHand - todayCash)}` : undefined;
  return (
    <div className="card dl-sum is-cash-wide">
      <div className="dl-sum-item">
        <span className="dl-sum-label">Осталось</span>
        <span className="dl-sum-value">
          {active.length} <span className="dl-sum-of">из {list.length}</span>
        </span>
      </div>
      <div className="dl-sum-item">
        <span className="dl-sum-label">Вручено</span>
        <span className="dl-sum-value">{done.length}</span>
      </div>
      <div className="dl-sum-item" title={onHandTitle}>
        <span className="dl-sum-label">{onHandLabel(since, c.today)}</span>
        <span className="dl-sum-value">{fmt.money(cash.onHand)}</span>
      </div>
    </div>
  );
}

/** Ссылка «Маршрут» по оставшимся точкам. */
export function RouteButton({ day }: { day: ISODate }) {
  const { active, list } = useMyDay(day);
  const pts = active.length ? active : list;
  if (!pts.length) return null;
  return (
    <a className="btn btn-secondary" href={routeUrl(pts)} target="_blank" rel="noreferrer">
      <Navigation />
      Маршрут на карте
    </a>
  );
}

function CourierCard({ d, pos, primary, c, flow, today }: { d: Delivery; pos: number; primary: boolean; c: Clock; flow: ReturnType<typeof useDeliveryFlow>; today: boolean }) {
  const db = useDB();
  const { can } = useSession();
  const open = useOpenEntity();
  const ix = indexes(db);
  const client = ix.clients.get(d.clientId);
  const acts = actsFor(d, can, { prefer: 'courier', order: ix.orders.get(d.orderId) });
  const main = today ? acts.all.find((a) => a.key === 'start' || a.key === 'deliver') : undefined;
  const failAct = today && d.state === 'on_way' ? acts.all.find((a) => a.key === 'fail') : undefined;
  return (
    <article className={cx('card dl-cc', primary && 'is-next')}>
      <div className="dl-cc-top">
        <span className="dl-cc-no" aria-label={`Точка ${pos}`}>
          {pos}
        </span>
        <span className="dl-cc-time">
          <ClockIcon />
          {d.date !== c.today && d.date < c.today ? `${fmt.dateShort(d.date)}, ` : ''}
          {d.interval}
        </span>
        <span className="spacer" />
        <LateChip d={d} c={c} />
        {d.state === 'on_way' ? <StateChip d={d} /> : null}
      </div>

      <a className="dl-cc-addr" href={mapUrl(d)} target="_blank" rel="noreferrer">
        <span className="grow col" style={{ gap: 2 }}>
          <span className="dl-cc-street">{d.address}</span>
          <span className="dl-cc-district">{d.district}</span>
        </span>
        <span className="dl-cc-map" aria-hidden="true">
          <Navigation />
        </span>
      </a>

      <div className="dl-cc-client">
        <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
          <span className="w-700 t-14">{client?.name ?? d.contactName}</span>
          <span className="t-13 muted ellipsis">{d.contactName}</span>
          <span className="t-13 muted nowrap">{fmt.phone(d.contactPhone)}</span>
        </span>
        <CallButton phone={d.contactPhone} size="lg" />
      </div>

      <div className="dl-cc-meta">
        <span className="row" style={{ gap: 6 }}>
          <Package />
          {placesText(d.places)} · {kgText(d.weightKg)}
        </span>
        <button type="button" className="link-button row" style={{ gap: 4 }} onClick={() => open('delivery', d.id)}>
          <ListOrdered />
          Состав заказа
        </button>
      </div>
      {d.comment ? (
        <div className="dl-cc-comment">
          <MessageSquare />
          <span>{d.comment}</span>
        </div>
      ) : null}

      <div className={cx('dl-cc-money', d.collect === 0 && 'is-zero')}>
        <span className="dl-cc-money-label">К получению</span>
        <span className="dl-cc-money-value">{d.collect > 0 ? fmt.money(d.collect) : 'Денег не брать'}</span>
      </div>

      {main ? (
        <div className={cx('dl-cc-actions', failAct && 'is-two')}>
          <Button variant={primary ? 'primary' : 'secondary'} size="lg" block icon={main.icon} onClick={() => flow.act(main, d)}>
            {main.label}
          </Button>
          {failAct ? (
            <Button variant="secondary" size="lg" block icon={failAct.icon} onClick={() => flow.act(failAct, d)}>
              {failAct.label}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

/** Список заявок курьера на день: карточки, затем «Не удалось» и свёрнутые «Вручено». */
export function CourierBoard({ day }: { day: ISODate }) {
  const db = useDB();
  const { list, active, done, failed, c } = useMyDay(day);
  const flow = useDeliveryFlow();
  const open = useOpenEntity();
  const [showDone, setShowDone] = useState(false);
  const ix = indexes(db);
  const isToday = day <= c.today;
  const pos = new Map(list.map((d, i) => [d.id, i + 1]));
  const collected = done.reduce((z, d) => z + d.collected, 0);

  return (
    <div className="dl-board">
      {active.map((d, i) => (
        <CourierCard key={d.id} d={d} pos={pos.get(d.id) ?? i + 1} primary={isToday && i === 0} c={c} flow={flow} today={isToday} />
      ))}
      {!active.length ? (
        <div className="card">
          <EmptyState title={list.length ? 'Все заявки закрыты' : `${dayLabel(day, c)} заявок нет`}>
            {list.length ? 'Сдайте наличные в кассу магазина' : 'Диспетчер назначит доставки — они появятся здесь'}
          </EmptyState>
        </div>
      ) : null}

      {failed.length ? (
        <section className="col-3">
          <h2 className="dl-board-title">Не удалось · {failed.length}</h2>
          {failed.map((d) => {
            const f = lastFail(d);
            return (
              <button key={d.id} type="button" className="card dl-cc-row" onClick={() => open('delivery', d.id)}>
                <span className="dl-cc-no is-small">{pos.get(d.id)}</span>
                <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                  <span className="w-700 ellipsis">{d.address}</span>
                  <span className="t-12 muted ellipsis">{f?.reason ?? 'Причина не указана'}</span>
                </span>
                <span className="t-13 muted nowrap">{f ? fmt.time(f.at) : ''}</span>
              </button>
            );
          })}
        </section>
      ) : null}

      {done.length ? (
        <section className="col-3">
          <button type="button" className="dl-board-toggle" onClick={() => setShowDone((v) => !v)} aria-expanded={showDone}>
            <span className="grow">
              Вручено · {done.length}
              {collected ? <span className="muted w-600"> · получено {fmt.money(collected)}</span> : null}
            </span>
            {showDone ? <ChevronUp /> : <ChevronDown />}
          </button>
          {showDone
            ? done.map((d) => {
                const at = deliveredAt(d);
                return (
                  <button key={d.id} type="button" className="card dl-cc-row" onClick={() => open('delivery', d.id)}>
                    <span className="dl-cc-no is-small is-done">{pos.get(d.id)}</span>
                    <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                      <span className="w-700 ellipsis">{d.address}</span>
                      <span className="t-12 muted ellipsis">
                        {ix.clients.get(d.clientId)?.name ?? d.contactName} · вручено в {fmt.time(at)}
                      </span>
                      <span className="t-13 ink-2 w-600">{deliveredMoneyText(d, ix.clients.get(d.clientId))}</span>
                    </span>
                  </button>
                );
              })
            : null}
        </section>
      ) : null}
      {flow.node}
    </div>
  );

}

