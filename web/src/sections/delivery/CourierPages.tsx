/* Курьер: «Доставки» — любой день и вручённые по дням; «Мои деньги» — только своё.
   Маршрут на сегодня с кнопками «Выехал / Вручено» — на рабочем столе «Сегодня» (CourierHome). */
import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, Navigation } from 'lucide-react';
import type { Delivery, ISODate } from '../../data/types';
import { PAY_METHOD_NAMES } from '../../data/types';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { useDB, useDBVersion } from '../../data/store';
import { courierCash, indexes } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { Chip, EmptyState, Notice, Segmented, cx, fmt } from '../../ui';
import { RouteButton } from './CourierBoard';
import { DelayChip, LateChip, StateChip, useDayParam } from './parts';
import { byRoute, clockOf, dayLabel, deliveredAt, deliveredMoneyText, forDay, lastFail, moneyOfDay, notHandedIn, onHandSplit, transferPending, type Clock } from './lib';

/* ---------- «Доставки»: выбор дня и вручённые по дням ---------- */

interface DayStat {
  date: ISODate;
  n: number;
  collected: number;
}

export function CourierQueue() {
  const db = useDB();
  const version = useDBVersion();
  const scoped = useScoped();
  const open = useOpenEntity();
  const nav = useNavigate();
  const c = clockOf(db);
  const [day, setDay] = useDayParam(c);
  const yesterday = fmt.addDays(c.today, -1);

  const list = useMemo(() => forDay(scoped.deliveries, day, c).filter((d) => d.state !== 'returned').sort(byRoute), [db, version, scoped, day]);
  const counts = useMemo(() => {
    const n = (dd: ISODate) => forDay(scoped.deliveries, dd, c).filter((d) => d.state !== 'returned').length;
    return { yesterday: n(yesterday), today: n(c.today), tomorrow: n(c.tomorrow) };
  }, [db, version, scoped]);

  // вручено по дням: по дате вручения, последние две недели
  const history = useMemo(() => {
    const m = new Map<ISODate, DayStat>();
    const from = fmt.addDays(c.today, -13);
    for (const d of scoped.deliveries) {
      if (d.state !== 'delivered') continue;
      const at = (deliveredAt(d) ?? d.date).slice(0, 10);
      if (at < from || at > c.today) continue;
      const x = m.get(at) ?? { date: at, n: 0, collected: 0 };
      x.n++;
      x.collected += d.collected;
      m.set(at, x);
    }
    return [...m.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [db, version, scoped]);

  const done = list.filter((d) => d.state === 'delivered');
  const collected = done.reduce((z, d) => z + d.collected, 0);
  const toCollect = list.filter((d) => d.state === 'assigned' || d.state === 'on_way').reduce((z, d) => z + d.collect, 0);
  const past = day < c.today;
  const seg = day === yesterday ? 'yesterday' : day === c.today ? 'today' : day === c.tomorrow ? 'tomorrow' : '';
  const pos = new Map(list.map((d, i) => [d.id, i + 1]));

  return (
    <div className="dl-phone">
      <PageHeader section="delivery" actions={day > c.today ? <RouteButton day={day} /> : null} />

      <div className="dl-cday">
        <Segmented
          ariaLabel="День"
          value={seg}
          onChange={(v) => setDay(v === 'yesterday' ? yesterday : v === 'tomorrow' ? c.tomorrow : c.today)}
          options={[
            { value: 'yesterday', label: 'Вчера', count: counts.yesterday },
            { value: 'today', label: 'Сегодня', count: counts.today },
            { value: 'tomorrow', label: 'Завтра', count: counts.tomorrow },
          ]}
        />
        <input type="date" className={cx('input dl-cday-date', !seg && 'is-set')} value={day} aria-label="Другой день" onChange={(e) => e.target.value && setDay(e.target.value)} />
      </div>

      <div className="card dl-sum">
        <div className="dl-sum-item">
          <span className="dl-sum-label">Точек</span>
          <span className="dl-sum-value">{list.length}</span>
        </div>
        <div className="dl-sum-item">
          <span className="dl-sum-label">Вручено</span>
          <span className="dl-sum-value">{done.length}</span>
        </div>
        <div className="dl-sum-item">
          <span className="dl-sum-label">{past || !toCollect ? 'Получено' : 'К получению'}</span>
          <span className="dl-sum-value">{fmt.money(past || !toCollect ? collected : toCollect)}</span>
        </div>
      </div>

      <section className="col-3">
        <div className="dl-board-head">
          <h2 className="dl-board-title grow">
            {dayLabel(day, c)}
            {day !== c.today && day !== c.tomorrow && day !== yesterday ? `, ${fmt.weekday(day)}` : ''} · {fmt.count(list.length, 'точка', 'точки', 'точек')}
          </h2>
          {day === c.today && list.some((d) => d.state === 'assigned' || d.state === 'on_way') ? (
            <button type="button" className="link-button dl-board-link" onClick={() => nav('/overview')}>
              <Navigation />
              Маршрут на сегодня
            </button>
          ) : null}
        </div>
        {list.length ? (
          list.map((d) => <DayRow key={d.id} d={d} pos={pos.get(d.id) ?? 0} c={c} onOpen={() => open('delivery', d.id)} />)
        ) : (
          <div className="card">
            <EmptyState title={`${dayLabel(day, c)} доставок нет`}>{day >= c.today ? 'Диспетчер назначит доставки — они появятся здесь' : 'В этот день вы не возили заказы'}</EmptyState>
          </div>
        )}
      </section>

      <section className="col-3">
        <h2 className="dl-board-title">Вручено по дням</h2>
        {history.length ? (
          <div className="card dl-hist">
            {history.map((h) => (
              <button key={h.date} type="button" className={cx('dl-hist-row', h.date === day && 'is-active')} onClick={() => setDay(h.date)} aria-pressed={h.date === day}>
                <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                  <span className="w-700">{dayLabel(h.date, c)}</span>
                  <span className="t-12 muted">{h.date === c.today || h.date === yesterday ? fmt.date(h.date) : fmt.weekday(h.date)}</span>
                </span>
                <span className="col" style={{ gap: 2, alignItems: 'flex-end' }}>
                  <span className="w-700 t-14 nowrap">{fmt.count(h.n, 'доставка', 'доставки', 'доставок')}</span>
                  <span className="t-12 muted num nowrap">{h.collected ? fmt.money(h.collected) : 'без оплаты'}</span>
                </span>
                <ChevronRight className="dl-hist-arrow" />
              </button>
            ))}
          </div>
        ) : (
          <div className="card">
            <EmptyState title="За две недели вручённых нет" />
          </div>
        )}
      </section>
    </div>
  );
}

/** Строка дня: номер точки, адрес, клиент и интервал, статус и деньги. Действия — в карточке доставки. */
function DayRow({ d, pos, c, onOpen }: { d: Delivery; pos: number; c: Clock; onOpen: () => void }) {
  const db = useDB();
  const ix = indexes(db);
  const at = deliveredAt(d);
  const fail = d.state === 'failed' ? lastFail(d) : null;
  const sub =
    d.state === 'delivered'
      ? `${ix.clients.get(d.clientId)?.name ?? d.contactName} · вручено в ${fmt.time(at)}`
      : fail
        ? `Не удалось: ${fail.reason.toLowerCase()}`
        : `${ix.clients.get(d.clientId)?.name ?? d.contactName} · ${d.date < c.today ? fmt.dateShort(d.date) + ', ' : ''}${d.interval}`;
  const delivered = d.state === 'delivered';
  return (
    <button type="button" className="card dl-cc-row dl-day-row" onClick={onOpen}>
      <span className={cx('dl-cc-no is-small', delivered && 'is-done', d.state === 'failed' && 'is-bad')}>{pos}</span>
      <span className="grow col" style={{ gap: 4, minWidth: 0 }}>
        <span className="w-700 ellipsis">{d.address}</span>
        <span className="t-12 muted ellipsis">{sub}</span>
        {/* у вручённой — что получено, а не «к получению» */}
        {delivered ? <span className="t-13 ink-2 w-600">{deliveredMoneyText(d, ix.clients.get(d.clientId))}</span> : null}
        <span className="chips">
          <StateChip d={d} />
          <LateChip d={d} c={c} />
          <DelayChip d={d} label="Задержка до" />
        </span>
      </span>
      {delivered ? null : d.collect ? (
        <span className="col" style={{ gap: 2, alignItems: 'flex-end' }}>
          <span className="num w-700 nowrap">{fmt.money(d.collect)}</span>
          <span className="t-12 muted nowrap">к получению</span>
        </span>
      ) : (
        <span className="t-12 muted nowrap">Денег не брать</span>
      )}
    </button>
  );
}

/* ---------- «Мои деньги» ---------- */

export function CourierCash() {
  const db = useDB();
  const version = useDBVersion();
  const { me } = useSession();
  const open = useOpenEntity();
  const c = clockOf(db);
  const ix = indexes(db);
  const cash = courierCash(db, me.id);
  const today = useMemo(() => moneyOfDay(db, me.id, c.today, cash.onHand), [db, version, me.id]);
  // не сданные с прошлых дней; сегодняшние не сданные видны в «Получено сегодня» с отметкой «На руках»
  const older = useMemo(() => notHandedIn(db, me.id).filter((d) => (deliveredAt(d) ?? d.date).slice(0, 10) < c.today), [db, version, me.id]);
  const olderSum = older.reduce((z, d) => z + d.collected, 0);
  const split = onHandSplit(db, me.id, c.today);

  return (
    <div className="dl-phone">
      <PageHeader section="delivery" />
      <div className="card dl-cash-hero">
        <span className="dl-sum-label">На руках</span>
        <span className="dl-cash-hero-value">{fmt.money(cash.onHand)}</span>
        {split.older > 0 ? (
          <span className="dl-sum-split">
            сегодня {fmt.money(split.today)} · с прошлых дней {fmt.money(split.older)}
          </span>
        ) : null}
        {cash.onHand > 0 ? (
          <Notice tone="warn" title={`Сдать в кассу: ${fmt.money(cash.onHand)}`}>
            В конце дня отдайте наличные диспетчеру или продавцу магазина
          </Notice>
        ) : (
          <Notice tone="ok">Все наличные сданы</Notice>
        )}
      </div>

      <section className="col-3">
        <h2 className="dl-board-title">Получено сегодня · {today.list.length}</h2>
        <div className="card dl-sum is-wrap">
          <div className="dl-sum-item">
            <span className="dl-sum-label">Наличными</span>
            <span className="dl-sum-value">{fmt.money(today.cash)}</span>
          </div>
          <div className="dl-sum-item">
            <span className="dl-sum-label">Картой и переводом</span>
            <span className="dl-sum-value">{fmt.money(today.card)}</span>
          </div>
          <div className="dl-sum-item">
            <span className="dl-sum-label">Сдано в кассу</span>
            <span className="dl-sum-value">{fmt.money(today.handedToday)}</span>
          </div>
        </div>
        {today.list.length ? (
          today.list.map((d) => (
            <button key={d.id} type="button" className="card dl-cc-row" onClick={() => open('delivery', d.id)}>
              <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                <span className="w-700 ellipsis">{ix.clients.get(d.clientId)?.name ?? d.contactName}</span>
                <span className="t-12 muted ellipsis">
                  № {d.number} · {fmt.time(deliveredAt(d))} · {PAY_METHOD_NAMES[d.collectedMethod ?? 'cash'].toLowerCase()}
                </span>
              </span>
              <span className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
                <span className="num w-700 t-16">{fmt.money(d.collected)}</span>
                {d.collectedMethod === 'cash' ? (
                  <Chip tone={d.handedIn ? 'ok' : 'warn'}>{d.handedIn ? 'Сдано' : 'На руках'}</Chip>
                ) : transferPending(db, d) ? (
                  <Chip tone="warn">Ждёт банка</Chip>
                ) : (
                  <Chip tone="info">{d.collectedMethod === 'transfer' ? 'Переводом' : 'Картой'}</Chip>
                )}
              </span>
            </button>
          ))
        ) : (
          <div className="card">
            <EmptyState title="Сегодня денег ещё не получали" />
          </div>
        )}
      </section>

      {older.length ? (
        <section className="col-3">
          <h2 className="dl-board-title">
            Не сдано с прошлых дней · {older.length}
            <span className="muted w-600"> · {fmt.money(olderSum)}</span>
          </h2>
          {older.map((d) => {
            const at = deliveredAt(d);
            return (
              <button key={d.id} type="button" className="card dl-cc-row" onClick={() => open('delivery', d.id)}>
                <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                  <span className="w-700 ellipsis">{ix.clients.get(d.clientId)?.name ?? d.contactName}</span>
                  <span className="t-12 muted ellipsis">
                    № {d.number} · {dayLabel(at?.slice(0, 10) ?? d.date, c).toLowerCase()}, {fmt.time(at)}
                  </span>
                </span>
                <span className="col" style={{ gap: 4, alignItems: 'flex-end' }}>
                  <span className="num w-700 t-16">{fmt.money(d.collected)}</span>
                  <Chip tone="warn">На руках</Chip>
                </span>
              </button>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}
