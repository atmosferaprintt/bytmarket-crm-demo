/* Окна курьера: «Вручено» (сумма, способ, что не взяли), «Не удалось» (причина, когда привезти),
   «Задерживаюсь» (причина и время), «Состав заказа». Крупно, под палец. Диспетчер открывает те же окна,
   когда отмечает за курьера. */
import { useMemo, useState } from 'react';
import { ArrowLeftRight, Banknote, Check, ChevronDown, ChevronUp, CreditCard, Hourglass, PackageMinus } from 'lucide-react';
import type { ID, ISODate, PayMethod } from '../../data/types';
import { DELIVERY_FAIL_REASONS } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes, orderReturns } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { Button, EmptyState, Field, Input, MoneyInput, Notice, QtyInput, Select, Textarea, cx, fmt } from '../../ui';
import { Sheet } from './Sheet';
import { CallButton, DayChoice } from './parts';
import { DELAY_REASONS, INTERVALS, LESS_REASONS, clockOf, dispatcherOf, intervalEnd, intervalFor, intervalPassed, kgText, minutesOf, packText, placesText, shortDistrict, timeAfter } from './lib';
import { useRun } from './run';
import { useOpenEntity } from '../../shell/entities';

type Method = 'cash' | 'card' | 'transfer' | 'none';

function useDelivery(id: ID) {
  const db = useDB();
  useDBVersion();
  return db.deliveries.find((x) => x.id === id);
}

/* ---------- Вручено ---------- */

interface NotTakenLine {
  productId: ID;
  name: string;
  sku: string;
  price: number;
  max: number; // отгружено и ещё не возвращено, шт
}

export function DeliverSheet({ id, onClose }: { id: ID; onClose: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const { role } = useSession();
  const isCourier = role === 'courier';
  const d = db.deliveries.find((x) => x.id === id);
  const ix = indexes(db);
  const client = d ? ix.clients.get(d.clientId) : undefined;
  const order = d ? ix.orders.get(d.orderId) : undefined;
  const [method, setMethod] = useState<Method>(d && d.collect > 0 ? 'cash' : 'none');
  const [amount, setAmount] = useState<number | ''>(d?.collect ?? 0);
  const [touched, setTouched] = useState(false);
  const [reason, setReason] = useState('');
  const [showNt, setShowNt] = useState(false);
  const [nt, setNt] = useState<Record<ID, number>>({});
  const [error, setError] = useState<string | null>(null);
  const run = useRun();

  // что можно не взять: отгружено курьеру и ещё не возвращено — по товарам
  const lines: NotTakenLine[] = useMemo(() => {
    if (!order) return [];
    const back = orderReturns(db).get(order.id)?.byProduct ?? new Map<ID, number>();
    const m = new Map<ID, NotTakenLine>();
    for (const l of order.lines) {
      const p = ix.products.get(l.productId);
      const x = m.get(l.productId) ?? { productId: l.productId, name: p?.name ?? 'Товар', sku: p?.sku ?? '', price: l.price, max: 0 };
      x.max += l.shipped;
      m.set(l.productId, x);
    }
    return [...m.values()].map((x) => ({ ...x, max: Math.max(0, x.max - (back.get(x.productId) ?? 0)) })).filter((x) => x.max > 0);
  }, [db, version, order?.id]);

  if (!d)
    return (
      <Sheet title="Вручено" onClose={onClose}>
        <EmptyState title="Доставка не найдена" />
      </Sheet>
    );

  const ntAmount = lines.reduce((z, l) => z + (nt[l.productId] ?? 0) * l.price, 0);
  const ntCount = lines.reduce((z, l) => z + (nt[l.productId] ?? 0), 0);
  const toCollect = Math.max(0, d.collect - Math.round(ntAmount));
  const got = method === 'none' ? 0 : amount === '' ? 0 : amount;
  const less = method !== 'none' && toCollect > 0 && got < toCollect;
  const more = method !== 'none' && got > toCollect;

  const setLine = (pid: ID, q: number) => {
    const next = { ...nt, [pid]: q };
    setNt(next);
    setError(null);
    if (!touched) {
      const amt = lines.reduce((z, l) => z + (next[l.productId] ?? 0) * l.price, 0);
      setAmount(Math.max(0, d.collect - Math.round(amt)));
    }
  };

  const submit = () => {
    if (method !== 'none' && got <= 0 && toCollect > 0) {
      setError('Введите сумму или выберите «Денег нет»');
      return;
    }
    if (less && !reason) {
      setError('Выберите, почему получили меньше');
      return;
    }
    const note =
      method === 'none' && toCollect > 0 ? 'Денег нет, оплата по отсрочке' : less ? `Получено ${fmt.money(got)} из ${fmt.money(toCollect)}: ${reason}` : '';
    const returned = lines.filter((l) => (nt[l.productId] ?? 0) > 0).map((l) => ({ productId: l.productId, qty: nt[l.productId] }));
    const payload: { deliveryId: ID; collected: number; method: PayMethod; comment?: string; returned?: { productId: ID; qty: number }[] } = {
      deliveryId: d.id,
      collected: got,
      method: method === 'none' ? 'cash' : method,
    };
    if (note) payload.comment = d.comment ? `${d.comment}. ${note}` : note;
    if (returned.length) payload.returned = returned;
    // курьеру — коротко и по делу; диспетчеру — номер доставки и итог операции
    const parts = ['Отмечено: вручено'];
    if (method === 'transfer' && got > 0) parts.push('Перевод ждёт подтверждения банка');
    if (returned.length) parts.push(`Долг клиента уменьшен на ${fmt.money(ntAmount)}, товар везите обратно`);
    if (less || (method === 'none' && toCollect > 0)) parts.push(`${fmt.money(toCollect - got)} — в долге клиента`);
    const okText = isCourier ? parts.join('. ') : `Доставка № ${d.number}: вручено${got ? `, получено ${fmt.money(got)}` : ''}`;
    // курьеру — без хвоста про WhatsApp: сообщение и так длинное
    const r = run('delivery.deliver', payload, okText, isCourier ? { info: 'none' } : {});
    if (r.ok) onClose();
    else setError(r.error ?? null);
  };

  const choices: { key: Method; label: string; sub?: string; icon: JSX.Element }[] = [
    { key: 'cash', label: 'Наличные', icon: <Banknote /> },
    { key: 'card', label: 'Карта', icon: <CreditCard /> },
    { key: 'transfer', label: 'Перевод', sub: 'ждёт подтверждения банка', icon: <ArrowLeftRight /> },
    { key: 'none', label: toCollect > 0 ? 'Денег нет — по отсрочке' : 'Без оплаты', icon: <Hourglass /> },
  ];
  const btnText = !isCourier
    ? 'Отметить: вручено'
    : got
      ? method === 'transfer'
        ? `Вручено, перевод ${fmt.money(got)}`
        : `Вручено, получил ${fmt.money(got)}`
      : 'Вручено без оплаты';

  return (
    <Sheet
      title="Вручено"
      sub={`№ ${d.number} · ${client?.name ?? d.contactName} · ${d.address}, ${shortDistrict(d.district)}`}
      onClose={onClose}
      footer={
        <Button variant="primary" size="lg" block onClick={submit} icon={<Check />}>
          {btnText}
        </Button>
      }
    >
      <div className="dl-collect">
        <span className="dl-collect-label">К получению</span>
        <span className="dl-collect-value">{fmt.money(toCollect)}</span>
      </div>
      {d.collect === 0 ? <Notice tone="ok">Заказ оплачен заранее или по отсрочке — деньги брать не нужно</Notice> : null}

      <div className="dl-choices" role="radiogroup" aria-label="Способ оплаты">
        {choices.map((ch) => (
          <button
            key={ch.key}
            type="button"
            role="radio"
            aria-checked={method === ch.key}
            className={cx('dl-choice', method === ch.key && 'is-active')}
            onClick={() => {
              setMethod(ch.key);
              setError(null);
              if (ch.key !== 'none' && (amount === '' || amount === 0)) setAmount(toCollect);
            }}
          >
            {ch.icon}
            <span className="grow col" style={{ gap: 0 }}>
              <span>{ch.label}</span>
              {ch.sub ? <span className="dl-choice-sub">{ch.sub}</span> : null}
            </span>
            {method === ch.key ? <Check className="dl-choice-check" /> : null}
          </button>
        ))}
      </div>

      {method !== 'none' ? (
        <Field label={method === 'transfer' ? 'Перевёл' : 'Получил'}>
          <MoneyInput
            size="lg"
            value={amount}
            onChange={(v) => {
              setAmount(v);
              setTouched(true);
              setError(null);
            }}
          />
        </Field>
      ) : null}
      {method === 'transfer' && got > 0 ? <Notice tone="info">Долг клиента закроется, когда банк подтвердит перевод</Notice> : null}

      {lines.length ? (
        <div className="col-3">
          <button type="button" className={cx('dl-choice dl-nt-toggle', ntCount > 0 && 'has-value')} aria-expanded={showNt} onClick={() => setShowNt((v) => !v)}>
            <PackageMinus />
            <span className="grow col" style={{ gap: 0 }}>
              <span>Часть товара не взяли</span>
              {ntCount > 0 ? <span className="dl-choice-sub">{`${fmt.qty(ntCount)} на ${fmt.money(ntAmount)}`}</span> : null}
            </span>
            {showNt ? <ChevronUp /> : <ChevronDown />}
          </button>
          {showNt ? (
            <div className="dl-nt">
              {lines.map((l) => (
                <div key={l.productId} className="dl-nt-row">
                  <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                    <span className="dl-nt-name">{l.name}</span>
                    <span className="t-12 muted">
                      {l.sku} · везёте {fmt.qty(l.max)}
                    </span>
                  </span>
                  <QtyInput value={nt[l.productId] ?? 0} min={0} max={l.max} onChange={(q) => setLine(l.productId, q)} ariaLabel={`Не взяли: ${l.name}`} />
                </div>
              ))}
            </div>
          ) : null}
          {ntCount > 0 ? (
            <Notice tone="warn" title={`Не взяли на ${fmt.money(ntAmount)}`}>
              Долг клиента уменьшится на эту сумму. Товар везите обратно на склад
            </Notice>
          ) : null}
        </div>
      ) : null}

      {less ? (
        <div className="col-3">
          <span className="field-label">Получил меньше — почему</span>
          <div className="dl-reasons is-small">
            {LESS_REASONS.map((r) => (
              <button key={r} type="button" className={cx('dl-reason', reason === r && 'is-active')} onClick={() => { setReason(r); setError(null); }}>
                <span className="grow">{r}</span>
                {reason === r ? <Check /> : null}
              </button>
            ))}
          </div>
          <Notice tone="warn">Остаток {fmt.money(toCollect - got)} останется долгом клиента</Notice>
        </div>
      ) : null}
      {more ? <Notice tone="info">Больше, чем к получению: {fmt.money(got - toCollect)} уйдёт в счёт долга клиента</Notice> : null}
      {method === 'none' && toCollect > 0 ? <Notice tone="warn">Сумма {fmt.money(toCollect)} останется долгом клиента</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Sheet>
  );
}

/* ---------- Не удалось ---------- */

const OTHER = 'Другое';
const ASKED = 'Перенос по просьбе клиента';

export function FailSheet({ id, onClose }: { id: ID; onClose: () => void }) {
  const db = useDB();
  const d = useDelivery(id);
  const { role } = useSession();
  const isCourier = role === 'courier';
  const c = clockOf(db);
  const client = d ? indexes(db).clients.get(d.clientId) : undefined;
  const dispatcher = dispatcherOf(db);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [wishDate, setWishDate] = useState<ISODate>(c.tomorrow);
  const [wishIv, setWishIv] = useState(d?.interval ?? INTERVALS[2]);
  const [error, setError] = useState<string | null>(null);
  const run = useRun();
  if (!d)
    return (
      <Sheet title="Не удалось" onClose={onClose}>
        <EmptyState title="Доставка не найдена" />
      </Sheet>
    );
  const intervals = INTERVALS.includes(d.interval) ? INTERVALS : [d.interval, ...INTERVALS];
  const pickDate = (v: ISODate) => {
    setWishDate(v);
    setWishIv((iv) => intervalFor(iv, v, c));
  };

  const submit = () => {
    if (!reason) {
      setError('Выберите причину');
      return;
    }
    const text = comment.trim();
    if (reason === OTHER && !text) {
      setError('Напишите, что случилось');
      return;
    }
    if (reason === ASKED && intervalPassed(wishIv, wishDate, c)) {
      setError('Этот интервал сегодня уже прошёл — выберите другой');
      return;
    }
    const payload: { deliveryId: ID; reason: string; comment?: string; wish?: { date: ISODate; interval: string } } = {
      deliveryId: d.id,
      reason: reason === OTHER ? text.charAt(0).toUpperCase() + text.slice(1) : reason,
    };
    if (reason !== OTHER && text) payload.comment = text;
    if (reason === ASKED) payload.wish = { date: wishDate, interval: wishIv };
    const okText = isCourier ? 'Отмечено: не удалось. Диспетчер решит, когда привезти снова' : `Доставка № ${d.number}: не удалось — ${payload.reason.toLowerCase()}`;
    const r = run('delivery.fail', payload, okText, { info: 'none' });
    if (r.ok) onClose();
    else setError(r.error ?? null);
  };

  return (
    <Sheet
      title="Не удалось вручить"
      sub={`№ ${d.number} · ${client?.name ?? d.contactName} · ${d.address}`}
      onClose={onClose}
      footer={
        <Button variant="primary" size="lg" block onClick={submit} disabled={!reason}>
          {reason ? 'Отметить: не удалось' : 'Выберите причину'}
        </Button>
      }
    >
      <span className="field-label">Причина</span>
      <div className="dl-reasons" role="radiogroup" aria-label="Причина">
        {[...DELIVERY_FAIL_REASONS, OTHER].map((r) => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} className={cx('dl-reason', reason === r && 'is-active')} onClick={() => { setReason(r); setError(null); }}>
            <span className="grow">{r}</span>
            {reason === r ? <Check /> : null}
          </button>
        ))}
      </div>

      {reason === ASKED ? (
        <div className="dl-wish col-3">
          <span className="field-label">Когда привезти</span>
          <DayChoice value={wishDate} onChange={pickDate} c={c} />
          <Select
            value={wishIv}
            aria-label="Интервал"
            onChange={(e) => setWishIv(e.target.value)}
            options={intervals.map((v) => ({ value: v, label: intervalPassed(v, wishDate, c) ? `${v} — уже прошёл` : v, disabled: intervalPassed(v, wishDate, c) }))}
          />
        </div>
      ) : null}

      {reason ? (
        <Field label={reason === OTHER ? 'Что случилось' : 'Комментарий для диспетчера'}>
          <Textarea
            rows={2}
            value={comment}
            placeholder={reason === OTHER ? 'Например: охрана не пустила на склад' : 'Если нужно — что сказал клиент'}
            onChange={(e) => {
              setComment(e.target.value);
              setError(null);
            }}
          />
        </Field>
      ) : null}

      <Notice tone="info">
        {d.state === 'on_way' ? 'Товар остаётся у вас. ' : ''}Диспетчер решит: повторить доставку или вернуть товар на склад.
      </Notice>
      {isCourier && dispatcher ? <CallButton phone={dispatcher.phone} label="Позвонить диспетчеру" size="lg" block /> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Sheet>
  );
}

/* ---------- Задерживаюсь ---------- */

const SOON = [30, 60, 90, 120];

export function DelaySheet({ id, onClose }: { id: ID; onClose: () => void }) {
  const db = useDB();
  const d = useDelivery(id);
  const { role } = useSession();
  const isCourier = role === 'courier';
  const c = clockOf(db);
  const client = d ? indexes(db).clients.get(d.clientId) : undefined;
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [until, setUntil] = useState(timeAfter(c, 30));
  const [error, setError] = useState<string | null>(null);
  const run = useRun();
  if (!d)
    return (
      <Sheet title="Задерживаюсь" onClose={onClose}>
        <EmptyState title="Доставка не найдена" />
      </Sheet>
    );
  const afterInterval = d.date === c.today && minutesOf(until) > intervalEnd(d.interval);

  const submit = () => {
    if (!reason) {
      setError('Выберите причину');
      return;
    }
    const text = comment.trim();
    if (reason === OTHER && !text) {
      setError('Напишите, что случилось');
      return;
    }
    if (!/^\d{2}:\d{2}$/.test(until)) {
      setError('Укажите, во сколько приедете');
      return;
    }
    if (d.date === c.today && minutesOf(until) <= c.nowMin) {
      setError('Это время уже прошло — укажите, во сколько приедете');
      return;
    }
    const why = reason === OTHER ? text : text ? `${reason}, ${text}` : reason;
    const okText = isCourier ? `Отмечено: задерживаюсь до ${until}. Диспетчер увидит` : `Доставка № ${d.number}: задерживается до ${until}`;
    const r = run('delivery.delay', { deliveryId: d.id, until, reason: why }, okText, { info: 'none' });
    if (r.ok) onClose();
    else setError(r.error ?? null);
  };

  return (
    <Sheet
      title="Задерживаюсь"
      sub={`№ ${d.number} · ${client?.name ?? d.contactName} · ${d.interval}`}
      onClose={onClose}
      footer={
        <Button variant="primary" size="lg" block onClick={submit} disabled={!reason}>
          {reason ? `Буду в ${until}` : 'Выберите причину'}
        </Button>
      }
    >
      <span className="field-label">Почему</span>
      <div className="dl-reasons is-small" role="radiogroup" aria-label="Причина задержки">
        {DELAY_REASONS.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} className={cx('dl-reason', reason === r && 'is-active')} onClick={() => { setReason(r); setError(null); }}>
            <span className="grow">{r}</span>
            {reason === r ? <Check /> : null}
          </button>
        ))}
      </div>
      {reason === OTHER ? (
        <Field label="Что случилось">
          <Textarea rows={2} value={comment} placeholder="Например: перекрыли мост" onChange={(e) => { setComment(e.target.value); setError(null); }} />
        </Field>
      ) : null}

      <span className="field-label">Когда приеду</span>
      <div className="dl-soon" role="radiogroup" aria-label="Когда приеду">
        {SOON.map((m) => {
          const t = timeAfter(c, m);
          return (
            <button key={m} type="button" role="radio" aria-checked={until === t} className={cx('dl-soon-item', until === t && 'is-active')} onClick={() => { setUntil(t); setError(null); }}>
              <span className="dl-soon-time">{t}</span>
              <span className="dl-soon-sub">{m < 60 ? `через ${m} мин` : m % 60 ? `через ${Math.floor(m / 60)},5 ч` : `через ${m / 60} ч`}</span>
            </button>
          );
        })}
      </div>
      <Field label="Другое время">
        <Input size="lg" type="time" value={until} onChange={(e) => { setUntil(e.target.value); setError(null); }} />
      </Field>
      {afterInterval ? (
        <>
          <Notice tone="warn">Позже интервала клиента ({d.interval}) — предупредите клиента</Notice>
          {isCourier ? <CallButton phone={d.contactPhone} label="Позвонить клиенту" size="lg" block /> : null}
        </>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Sheet>
  );
}

/* ---------- Состав заказа ---------- */

export function LinesSheet({ id, onClose }: { id: ID; onClose: () => void }) {
  const db = useDB();
  const d = useDelivery(id);
  const ix = indexes(db);
  const order = d ? ix.orders.get(d.orderId) : undefined;
  const client = d ? ix.clients.get(d.clientId) : undefined;
  const open = useOpenEntity();
  if (!d || !order)
    return (
      <Sheet title="Состав заказа" onClose={onClose}>
        <EmptyState title="Заказ не найден" />
      </Sheet>
    );
  return (
    <Sheet
      title="Состав заказа"
      sub={`Заказ № ${order.number} · ${client?.name ?? d.contactName} · ${placesText(d.places)} · ${kgText(d.weightKg)}`}
      onClose={onClose}
      footer={
        <Button
          variant="secondary"
          size="lg"
          block
          onClick={() => {
            onClose();
            open('delivery', d.id);
          }}
        >
          Вся карточка доставки
        </Button>
      }
    >
      <div className="dl-lines is-phone">
        {order.lines.map((l, i) => {
          const p = ix.products.get(l.productId);
          return (
            <div key={`${l.productId}-${i}`} className="dl-lines-row">
              <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                <span className="dl-nt-name">{p?.name ?? 'Товар'}</span>
                <span className="t-12 muted">{p?.sku}</span>
              </span>
              <span className="num w-700 t-16 nowrap">{packText(l)}</span>
            </div>
          );
        })}
      </div>
      <div className="dl-ret-row is-total">
        <span className="grow">{fmt.count(order.lines.length, 'позиция', 'позиции', 'позиций')}</span>
        <span className="num w-700 t-16">{fmt.qty(order.lines.reduce((z, l) => z + l.qty, 0))}</span>
      </div>
    </Sheet>
  );
}
