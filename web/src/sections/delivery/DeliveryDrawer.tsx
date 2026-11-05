import type { ReactNode } from 'react';
import { MapPin, MessageSquare, Phone, UserRound } from 'lucide-react';
import type { EntityDrawerProps } from '../../shell/entities';
import { EntityLink } from '../../shell/entities';
import { useDB, useDBVersion } from '../../data/store';
import { indexes, orderPayment } from '../../data/selectors';
import type { Delivery } from '../../data/types';
import { PAY_METHOD_NAMES } from '../../data/types';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { Button, Chip, Drawer, EmptyState, MoreMenu, Notice, Steps, cx, fmt } from '../../ui';
import { CallButton, DelayChip, LateChip, MapLink, PayChip, StateChip } from './parts';
import { clockOf, dayLabel, deliveredAt, kgText, lastFail, packText, placesText, telUrl, transferPending } from './lib';
import { actsFor, useDeliveryFlow } from './flow';
import './delivery.css';

function stepsOf(d: Delivery): { label: string; state: 'done' | 'current' | 'todo' }[] {
  const s = d.state;
  // пока курьера нет — первый шаг «Ждёт курьера», а не «Назначена»
  if (s === 'waiting') return [{ label: 'Ждёт курьера', state: 'current' }, { label: 'Назначена', state: 'todo' }, { label: 'В пути', state: 'todo' }, { label: 'Вручена', state: 'todo' }];
  const reached = s === 'assigned' ? 1 : s === 'on_way' ? 2 : s === 'delivered' ? 3 : 2;
  const labels = ['Назначена', 'В пути', 'Вручена'];
  return labels.map((label, i) => ({
    label,
    state: i < reached ? 'done' : i === reached && s !== 'failed' && s !== 'returned' ? 'current' : 'todo',
  }));
}

/** История: попытки курьера и заметки (перенос с причиной, задержка, пожелание клиента) — по времени, свежие сверху. */
type HistoryItem = { at: string; who: string; text: string | null; chip: { label: string; tone: 'ok' | 'bad' | 'warn' | 'info' | 'neutral' } };

function historyOf(d: Delivery, name: (id: string) => string): HistoryItem[] {
  const items: HistoryItem[] = d.attempts.map((a) => ({
    at: a.at,
    who: name(a.courierId),
    text: a.reason,
    chip: a.result === 'delivered' ? { label: 'Вручена', tone: 'ok' } : { label: 'Не удалось', tone: 'bad' },
  }));
  for (const n of d.notes ?? []) {
    const chip: HistoryItem['chip'] = n.text.startsWith('Задерживается')
      ? { label: 'Задержка', tone: 'warn' }
      : n.text.startsWith('Перенесена')
        ? { label: 'Перенос', tone: 'info' }
        : n.text.startsWith('Клиент просит')
          ? { label: 'Просьба клиента', tone: 'neutral' }
          : { label: 'Заметка', tone: 'neutral' };
    items.push({ at: n.at, who: name(n.actorId), text: n.text, chip });
  }
  // заметка с пожеланием пишется в ту же минуту, что и неудачная попытка, — она идёт сразу под ней
  return items.sort((a, b) => b.at.localeCompare(a.at) || (a.chip.label === 'Не удалось' ? 1 : 0) - (b.chip.label === 'Не удалось' ? 1 : 0));
}

/** Карточка «Доставка» в боковой панели. Открывается из любого раздела через ?open=delivery:id */
export default function EntityDrawer({ id, onClose }: EntityDrawerProps) {
  const db = useDB();
  useDBVersion();
  const { role, can } = useSession();
  const flow = useDeliveryFlow();
  const scoped = useScoped();
  const d = db.deliveries.find((x) => x.id === id);
  if (d && !scoped.deliveries.includes(d))
    return (
      <Drawer title={`Доставка № ${d.number}`} onClose={onClose}>
        <EmptyState title={role === 'courier' ? 'Это доставка другого курьера' : 'Доставка не вашего клиента'}>Открыть её может диспетчер или владелец</EmptyState>
      </Drawer>
    );
  if (!d)
    return (
      <Drawer title="Доставка" onClose={onClose}>
        <EmptyState title="Доставка не найдена">Возможно, её номер изменился</EmptyState>
      </Drawer>
    );

  const c = clockOf(db);
  const ix = indexes(db);
  const order = ix.orders.get(d.orderId);
  const client = ix.clients.get(d.clientId);
  const courier = d.courierId ? ix.employees.get(d.courierId) : undefined;
  const pay = order ? orderPayment(db, order) : null;
  const isCourier = role === 'courier';
  const fail = d.state === 'failed' ? lastFail(d) : null;
  // «Позвонить курьеру» в карточке не нужен: телефон курьера — рядом с его именем
  const acts0 = actsFor(d, can, { prefer: isCourier ? 'courier' : 'dispatch', order });
  const allActs = acts0.all.filter((a) => a.key !== 'call');
  const acts = { main: allActs[0] ?? null, more: allActs.slice(1) };
  const secondary = acts.more.slice(0, 2);
  const rest = acts.more.slice(2);
  const at = deliveredAt(d);
  const showCost = can('assignDelivery') || can('seeCost');
  const nothingText = client && client.deferDays > 0 ? `Ничего — отсрочка ${client.deferDays} дн.` : pay && pay.due <= 0 ? 'Ничего — заказ оплачен' : 'Ничего';
  const name = (eid: string) => ix.employees.get(eid)?.short ?? 'Сотрудник';
  const history = historyOf(d, name);
  const footer = acts.main ? (
    isCourier ? (
      <div className={cx('dl-dfoot', secondary.length === 1 && 'is-one')}>
        <Button variant="primary" size="lg" block icon={acts.main.icon} onClick={() => flow.act(acts.main!, d)}>
          {acts.main.label}
        </Button>
        {secondary.map((a) => (
          <Button key={a.key} variant="secondary" size="lg" block icon={a.icon} onClick={() => flow.act(a, d)}>
            {a.label}
          </Button>
        ))}
      </div>
    ) : (
      <>
        {secondary.map((a) => (
          <Button key={a.key} variant={a.key === 'return' ? 'danger' : 'secondary'} icon={a.icon} onClick={() => flow.act(a, d)}>
            {a.label}
          </Button>
        ))}
        <span className="spacer" />
        <Button variant="primary" icon={acts.main.icon} onClick={() => flow.act(acts.main!, d)}>
          {acts.main.label}
        </Button>
      </>
    )
  ) : d.state === 'waiting' && !can('assignDelivery') ? (
    <span className="t-13 muted">Курьера назначит диспетчер</span>
  ) : undefined;

  return (
    <Drawer
      title={`Доставка № ${d.number}`}
      sub={
        <>
          {isCourier || !order ? `Заказ № ${order?.number ?? '—'}` : <EntityLink type="order" id={order.id}>Заказ № {order.number}</EntityLink>}
          {' · '}
          {dayLabel(d.date, c)}, {d.interval}
        </>
      }
      head={
        <div className="col-3 dl-dhead">
          <div className="chips">
            <StateChip d={d} size="lg" />
            <LateChip d={d} c={c} />
            <DelayChip d={d} />
            {order && order.state !== 'cancelled' ? (
              <span className="dl-paychip" title="Доставка и оплата — разные вещи: вручённый заказ может быть не оплачен">
                <span className="t-12 muted">Оплата заказа</span>
                <PayChip db={db} order={order} />
              </span>
            ) : null}
          </div>
          <Steps items={stepsOf(d)} />
        </div>
      }
      actions={rest.length ? <MoreMenu items={flow.menu(rest, d)} /> : undefined}
      onClose={onClose}
      footer={footer}
    >
      {fail ? (
        <Notice tone="bad" title={`Не удалось: ${fail.reason}`}>
          {fmt.dateTime(fail.at)}
          {can('assignDelivery') ? ' · Решите: повторить доставку или вернуть товар на склад' : ''}
        </Notice>
      ) : null}
      {d.state === 'returned' ? <Notice tone="neutral" title="Товар вернули на склад">Заказ отменён, товар на проверке в карантине</Notice> : null}

      <section className="dl-block">
        <div className="dl-block-icon">
          <MapPin />
        </div>
        <div className="grow col" style={{ gap: 4 }}>
          <span className="t-16 w-700">{d.address}</span>
          <span className="t-13 muted">{d.district}</span>
        </div>
        <MapLink d={d} className="btn btn-secondary btn-sm">
          <MapPin />
          Открыть в картах
        </MapLink>
      </section>

      <section className="dl-block">
        <div className="dl-block-icon">
          <UserRound />
        </div>
        <div className="grow col" style={{ gap: 4 }}>
          <span className="t-14 w-700">
            {isCourier || !client ? client?.name ?? d.contactName : <EntityLink type="client" id={client.id}>{client.name}</EntityLink>}
          </span>
          <span className="t-13 muted">
            {d.contactName} · {fmt.phone(d.contactPhone)}
          </span>
        </div>
        <CallButton phone={d.contactPhone} size="sm" />
      </section>

      <div className="dl-facts">
        <Fact label="Когда" value={`${dayLabel(d.date, c)}, ${d.interval}`} />
        <Fact
          label="Курьер"
          value={
            courier ? (
              <span className="row" style={{ gap: 6 }}>
                {courier.name}
                {!isCourier ? (
                  <a className="dl-icon-link" href={telUrl(courier.phone)} title={`Позвонить: ${fmt.phone(courier.phone)}`} aria-label="Позвонить курьеру">
                    <Phone />
                  </a>
                ) : null}
              </span>
            ) : (
              <Chip tone="warn">Не назначен</Chip>
            )
          }
        />
        <Fact label="Мест" value={placesText(d.places)} />
        <Fact label="Вес" value={kgText(d.weightKg)} />
        <Fact label="Доставка для клиента" value={d.fee ? fmt.money(d.fee) : 'Бесплатно'} />
        {showCost ? <Fact label="Расход магазина" value={fmt.money(d.cost)} /> : null}
        <Fact label="К получению" value={<span className={cx(d.collect > 0 && 'dl-strong')}>{d.collect > 0 ? fmt.money(d.collect) : nothingText}</span>} />
        {d.state === 'delivered' ? (
          <Fact
            label="Получено"
            value={d.collected > 0 ? `${fmt.money(d.collected)} · ${PAY_METHOD_NAMES[d.collectedMethod ?? 'cash'].toLowerCase()}` : 'Без денег'}
          />
        ) : null}
        {at ? <Fact label="Вручено" value={fmt.dateTime(at)} /> : null}
        {d.collectedMethod === 'cash' && d.collected > 0 ? (
          <Fact label="Деньги" value={d.handedIn ? <Chip tone="ok">Сданы в кассу</Chip> : <Chip tone="warn">На руках у курьера</Chip>} />
        ) : d.collectedMethod === 'transfer' && d.collected > 0 ? (
          <Fact label="Деньги" value={transferPending(db, d) ? <Chip tone="warn">Перевод ждёт банка</Chip> : <Chip tone="ok">Перевод пришёл</Chip>} />
        ) : null}
      </div>

      {pay && order && order.state !== 'cancelled' && !isCourier ? (
        <section className="col-3">
          <h3 className="dl-h3">Оплата заказа</h3>
          <div className="dl-facts is-3">
            <Fact label="Сумма заказа" value={fmt.money(pay.amount)} />
            <Fact label="Оплачено" value={fmt.money(pay.paid)} />
            <Fact label="Осталось" value={<span className={cx(pay.due > 0 && 'c-bad')}>{fmt.money(pay.due)}</span>} />
          </div>
          {d.state === 'delivered' && pay.due > 0 ? <Notice tone="warn">Заказ доставлен, но не оплачен полностью: {fmt.money(pay.due)} в долге клиента</Notice> : null}
        </section>
      ) : null}

      {order ? (
        <section className="col-3">
          <h3 className="dl-h3">
            Состав заказа <span className="muted w-600">· {fmt.count(order.lines.length, 'позиция', 'позиции', 'позиций')}</span>
          </h3>
          <div className="dl-lines">
            {order.lines.map((l, i) => {
              const p = ix.products.get(l.productId);
              return (
                <div key={`${l.productId}-${i}`} className="dl-lines-row">
                  <span className="grow col" style={{ gap: 0, minWidth: 0 }}>
                    <span className="w-600 dl-wrap">{p?.name ?? 'Товар'}</span>
                    <span className="t-12 muted">{p?.sku}</span>
                  </span>
                  <span className="num t-13 nowrap">{packText(l)}</span>
                  {!isCourier ? <span className="num w-600 dl-lines-sum">{fmt.money(l.qty * l.price)}</span> : null}
                </div>
              );
            })}
          </div>
        </section>
      ) : null}

      {d.comment ? (
        <section className="dl-comment">
          <MessageSquare />
          <span>{d.comment}</span>
        </section>
      ) : null}

      <section className="col-3">
        <h3 className="dl-h3">История</h3>
        {history.length ? (
          <div className="dl-attempts">
            {history.map((h, i) => (
              <div key={`${h.at}-${i}`} className="dl-attempt">
                <span className="num t-13 w-600 nowrap">{fmt.dateTime(h.at)}</span>
                <span className="grow t-13 dl-wrap">
                  {h.who}
                  {h.text ? <span className="muted"> · {h.text}</span> : null}
                </span>
                <Chip tone={h.chip.tone}>{h.chip.label}</Chip>
              </div>
            ))}
          </div>
        ) : (
          <div className="t-13 muted">Попыток ещё не было</div>
        )}
      </section>

      {flow.node}
    </Drawer>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="dl-fact">
      <span className="dl-fact-label">{label}</span>
      <span className="dl-fact-value">{value}</span>
    </div>
  );
}
