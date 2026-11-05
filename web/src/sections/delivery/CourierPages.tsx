/* Курьер: раздел «Заявки» (тот же список карточками) и «Деньги» — только своё. */
import { useMemo } from 'react';
import { Banknote, CreditCard, Wallet } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { useDB, useDBVersion } from '../../data/store';
import { courierCash, indexes } from '../../data/selectors';
import { PAY_METHOD_NAMES } from '../../data/types';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { Chip, EmptyState, Notice, cx, fmt } from '../../ui';
import { CourierBoard, RouteButton } from './CourierBoard';
import { DayPicker, useDayParam } from './parts';
import { clockOf, dayLabel, deliveredAt, forDay, moneyOfDay, notHandedIn } from './lib';

export function CourierQueue() {
  const db = useDB();
  const version = useDBVersion();
  const scoped = useScoped();
  const c = clockOf(db);
  const [day, setDay] = useDayParam(c);
  const counts = useMemo(() => {
    const n = (dd: string) => forDay(scoped.deliveries, dd, c).filter((d) => d.state === 'assigned' || d.state === 'on_way').length;
    return { today: n(c.today), tomorrow: n(c.tomorrow) };
  }, [db, version, scoped]);
  return (
    <div className="dl-phone">
      <PageHeader section="delivery" actions={<RouteButton day={day} />} />
      <DayPicker day={day} onChange={setDay} c={c} counts={counts} compact />
      <CourierBoard day={day} />
    </div>
  );
}

export function CourierCash() {
  const db = useDB();
  const version = useDBVersion();
  const { me } = useSession();
  const open = useOpenEntity();
  const c = clockOf(db);
  const ix = indexes(db);
  const cash = courierCash(db, me.id);
  const today = useMemo(() => moneyOfDay(db, me.id, c.today, cash.onHand), [db, version, me.id]);
  const pending = useMemo(() => notHandedIn(db, me.id), [db, version, me.id]);

  return (
    <div className="dl-phone">
      <PageHeader section="delivery" />
      <div className="card dl-cash-hero">
        <span className="dl-sum-label">На руках</span>
        <span className="dl-cash-hero-value">{fmt.money(cash.onHand)}</span>
        {cash.onHand > 0 ? (
          <Notice tone="warn" title={`Сдать в кассу: ${fmt.money(cash.onHand)}`}>
            В конце дня отдайте наличные диспетчеру или продавцу магазина
          </Notice>
        ) : (
          <Notice tone="ok">Все наличные сданы</Notice>
        )}
      </div>

      <div className="card dl-sum">
        <div className="dl-sum-item">
          <span className="dl-sum-label">
            <Banknote /> Наличными
          </span>
          <span className="dl-sum-value">{fmt.money(today.cash)}</span>
        </div>
        <div className="dl-sum-item">
          <span className="dl-sum-label">
            <CreditCard /> Картой
          </span>
          <span className="dl-sum-value">{fmt.money(today.card)}</span>
        </div>
        <div className="dl-sum-item">
          <span className="dl-sum-label">
            <Wallet /> Сдано
          </span>
          <span className="dl-sum-value">{fmt.money(today.handedToday)}</span>
        </div>
      </div>

      <section className="col-3">
        <h2 className="dl-board-title">Не сдано · {pending.length}</h2>
        {pending.length ? (
          pending.map((d) => {
            const at = deliveredAt(d);
            return (
              <button key={d.id} type="button" className="card dl-cc-row" onClick={() => open('delivery', d.id)}>
                <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                  <span className="w-700 ellipsis">{ix.clients.get(d.clientId)?.name ?? d.contactName}</span>
                  <span className="t-12 muted ellipsis">
                    № {d.number} · {dayLabel(at?.slice(0, 10) ?? d.date, c).toLowerCase()}, {fmt.time(at)}
                  </span>
                </span>
                <span className="num w-700 t-16">{fmt.money(d.collected)}</span>
              </button>
            );
          })
        ) : (
          <div className="card">
            <EmptyState title="Всё сдано">Наличных на руках нет</EmptyState>
          </div>
        )}
      </section>

      <section className="col-3">
        <h2 className="dl-board-title">Получено сегодня · {today.list.length}</h2>
        {today.list.length ? (
          today.list.map((d) => (
            <button key={d.id} type="button" className="card dl-cc-row" onClick={() => open('delivery', d.id)}>
              <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                <span className="w-700 ellipsis">{ix.clients.get(d.clientId)?.name ?? d.contactName}</span>
                <span className="t-12 muted ellipsis">
                  {fmt.time(deliveredAt(d))} · {PAY_METHOD_NAMES[d.collectedMethod ?? 'cash']}
                </span>
              </span>
              <span className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
                <span className="num w-700">{fmt.money(d.collected)}</span>
                {d.collectedMethod === 'cash' ? (
                  <Chip tone={d.handedIn ? 'ok' : 'warn'}>{d.handedIn ? 'Сдано' : 'На руках'}</Chip>
                ) : (
                  <Chip tone="info">На счёт</Chip>
                )}
              </span>
            </button>
          ))
        ) : (
          <div className={cx('card')}>
            <EmptyState title="Сегодня денег ещё не получали" />
          </div>
        )}
      </section>
    </div>
  );
}
