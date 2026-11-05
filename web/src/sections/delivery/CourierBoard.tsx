/* Телефон курьера: крупные карточки заявок по порядку маршрута. Без таблиц, всё по ширине экрана. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronUp, Clock as ClockIcon, HandCoins, ListOrdered, MessageSquare, Navigation, Package, Timer } from 'lucide-react';
import type { Delivery, ISODate } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { courierCash, indexes } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { useOpenEntity } from '../../shell/entities';
import { Button, EmptyState, cx, fmt } from '../../ui';
import { CallButton, DelayChip, LateChip, StateChip } from './parts';
import { byRoute, clockOf, dayLabel, deliveredAt, deliveredMoneyText, forDay, kgText, lastFail, mapUrl, onHandLabel, onHandSince, onHandSplit, placesText, routeUrl, type Clock } from './lib';
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

/** «Осталось 3 из 5 · Вручено 2», ниже — на руках: все несданные наличные и сколько из них с прошлых дней. */
export function CourierSummary({ day }: { day: ISODate }) {
  const db = useDB();
  const { me } = useSession();
  const { list, active, done, c } = useMyDay(day);
  const cash = courierCash(db, me.id);
  const since = onHandSince(db, me.id);
  const split = onHandSplit(db, me.id, c.today);
  return (
    <div className="card dl-sum is-courier">
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
      <div className="dl-sum-item is-hand">
        <span className="dl-sum-label">{onHandLabel(since, c.today)}</span>
        <span className="dl-sum-value">{fmt.money(cash.onHand)}</span>
        {split.older > 0 ? (
          <span className="dl-sum-split">
            сегодня {fmt.money(split.today)} · с прошлых дней {fmt.money(split.older)}
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Ссылка «Маршрут» по оставшимся точкам. */
export function RouteButton({ day }: { day: ISODate }) {
  const { active, list, c } = useMyDay(day);
  // сегодня всё закрыто — маршрут уже не нужен; на будущий день — по всем точкам
  const pts = active.length ? active : day > c.today ? list : [];
  if (!pts.length) return null;
  return (
    <a className="btn btn-secondary btn-lg" href={routeUrl(pts)} target="_blank" rel="noreferrer">
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
  const delayAct = today ? acts.all.find((a) => a.key === 'delay') : undefined;
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
        <DelayChip d={d} label="Задержка до" />
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
      </div>
      <div className={cx('dl-cc-tools', delayAct && 'is-two')}>
        <Button variant="secondary" size="lg" block icon={<ListOrdered />} onClick={() => flow.lines(d)}>
          Состав заказа
        </Button>
        {delayAct ? (
          <Button variant="secondary" size="lg" block icon={<Timer />} onClick={() => flow.act(delayAct, d)}>
            {delayAct.label}
          </Button>
        ) : null}
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
  const { me } = useSession();
  const nav = useNavigate();
  const { list, active, done, failed, c } = useMyDay(day);
  const flow = useDeliveryFlow();
  const open = useOpenEntity();
  const [showDone, setShowDone] = useState(false);
  const ix = indexes(db);
  const isToday = day <= c.today;
  const pos = new Map(list.map((d, i) => [d.id, i + 1]));
  const gotCash = done.reduce((z, d) => z + (d.collectedMethod === 'cash' ? d.collected : 0), 0);
  const gotBank = done.reduce((z, d) => z + (d.collectedMethod && d.collectedMethod !== 'cash' ? d.collected : 0), 0);
  const onHand = courierCash(db, me.id).onHand;

  return (
    <div className="dl-board">
      {active.map((d, i) => (
        <CourierCard key={d.id} d={d} pos={pos.get(d.id) ?? i + 1} primary={isToday && i === 0} c={c} flow={flow} today={isToday} />
      ))}
      {!active.length ? (
        <div className="card">
          <EmptyState title={list.length ? 'Все заявки закрыты' : `${dayLabel(day, c)} заявок нет`}>
            {list.length ? (onHand > 0 ? `Сдайте наличные в кассу магазина: ${fmt.money(onHand)}` : 'Наличные сданы — на сегодня всё') : 'Диспетчер назначит доставки — они появятся здесь'}
          </EmptyState>
          {list.length && onHand > 0 ? (
            <div className="dl-empty-act">
              <Button variant="primary" size="lg" block icon={<HandCoins />} onClick={() => nav('/delivery/cash')}>
                Сколько сдать
              </Button>
            </div>
          ) : null}
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
            <span className="grow col" style={{ gap: 2 }}>
              <span>Вручено · {done.length}</span>
              {gotCash || gotBank ? (
                <span className="dl-board-toggle-sub">
                  {[gotCash ? `наличными ${fmt.money(gotCash)}` : '', gotBank ? `картой и переводом ${fmt.money(gotBank)}` : ''].filter(Boolean).join(' · ')}
                </span>
              ) : null}
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

