/* Окна диспетчера: назначить курьера, перенести, вернуть на склад, назначить ожидающие, принять деньги. */
import { useMemo, useState } from 'react';
import { Check, MapPin, UserX } from 'lucide-react';
import type { Delivery, ID, ISODate } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { Avatar, Button, Chip, EmptyState, Field, Modal, MoneyInput, Notice, Segmented, Select, Textarea, cx, fmt, toast } from '../../ui';
import { DayChoice } from './parts';
import {
  INTERVALS,
  RESCHEDULE_REASONS,
  byRoute,
  clockOf,
  dayLabel,
  forDay,
  intervalFor,
  intervalPassed,
  nearestInterval,
  wishOf,
  type Clock,
  lastFail,
  loadText,
  loadsOf,
  notHandedIn,
  deliveredAt,
  placesText,
  kgText,
  shortDistrict,
  suggestCourier,
  type CourierLoad,
} from './lib';
import { useRun } from './run';

function useDelivery(id: ID): Delivery | undefined {
  const db = useDB();
  useDBVersion();
  return db.deliveries.find((d) => d.id === id);
}

function Missing({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Доставка не найдена" onClose={onClose}>
      <EmptyState title="Такой доставки нет">Возможно, её уже закрыли</EmptyState>
    </Modal>
  );
}

/** Кому из курьеров отдать: загрузка на день, районы, подсказка «по пути». */
export function CourierPicker({
  loads,
  value,
  onChange,
  district,
  exclude,
  allowNone,
}: {
  loads: CourierLoad[];
  value: ID | '';
  onChange: (id: ID) => void;
  district: string;
  exclude?: ID | null;
  allowNone?: boolean;
}) {
  const sd = shortDistrict(district);
  const max = Math.max(1, ...loads.map((l) => l.points));
  return (
    <div className="dl-pick-list" role="radiogroup" aria-label="Курьер">
      {loads.map((l) => {
        const same = l.districts.includes(sd);
        const current = exclude === l.courier.id;
        return (
          <button
            key={l.courier.id}
            type="button"
            role="radio"
            aria-checked={value === l.courier.id}
            className={cx('dl-pick', value === l.courier.id && 'is-active')}
            onClick={() => onChange(l.courier.id)}
          >
            <Avatar name={l.courier.name} />
            <span className="grow col" style={{ gap: 2 }}>
              <span className="row" style={{ gap: 8 }}>
                <span className="w-700 t-14">{l.courier.name}</span>
                {current ? <Chip tone="outline">Сейчас назначен</Chip> : same ? <Chip tone="green">По пути: {sd}</Chip> : null}
              </span>
              <span className="t-12 muted">{l.points ? `${loadText(l)} · ${l.districts.join(', ')}` : 'Свободен'}</span>
              <span className="dl-pick-bar" aria-hidden="true">
                <span style={{ width: `${(l.points / max) * 100}%` }} />
              </span>
            </span>
            <span className={cx('dl-pick-check', value === l.courier.id && 'is-on')}>{value === l.courier.id ? <Check /> : null}</span>
          </button>
        );
      })}
      {allowNone ? (
        <button type="button" role="radio" aria-checked={value === ''} className={cx('dl-pick', value === '' && 'is-active')} onClick={() => onChange('')}>
          <span className="dl-pick-none" aria-hidden="true">
            <UserX />
          </span>
          <span className="grow col" style={{ gap: 2 }}>
            <span className="w-700 t-14">Без курьера</span>
            <span className="t-12 muted">Ждёт назначения — назначите позже</span>
          </span>
          <span className={cx('dl-pick-check', value === '' && 'is-on')}>{value === '' ? <Check /> : null}</span>
        </button>
      ) : null}
      {!loads.length ? <EmptyState title="Курьеров нет">Добавьте курьера в «Команде и правах»</EmptyState> : null}
    </div>
  );
}

function DeliveryLine({ d }: { d: Delivery }) {
  const db = useDB();
  const client = indexes(db).clients.get(d.clientId);
  return (
    <div className="dl-line">
      <span className="dl-line-no">№ {d.number}</span>
      <span className="grow col" style={{ gap: 2 }}>
        <span className="w-700 t-14 ellipsis">{client?.name ?? d.contactName}</span>
        <span className="t-12 muted ellipsis">
          {d.address}, {shortDistrict(d.district)} · {d.interval} · {placesText(d.places)} · {kgText(d.weightKg)}
        </span>
      </span>
      {d.collect > 0 ? <span className="w-700 num">{fmt.money(d.collect)}</span> : null}
    </div>
  );
}

/* ---------- интервал: прошедшие сегодня — недоступны ---------- */

function IntervalSelect({ value, onChange, day, c, current }: { value: string; onChange: (v: string) => void; day: ISODate; c: Clock; current?: string }) {
  const list = INTERVALS.includes(value) ? INTERVALS : [value, ...INTERVALS];
  const all = current && !list.includes(current) ? [current, ...list] : list;
  return (
    <Select
      value={value}
      aria-label="Интервал"
      onChange={(e) => onChange(e.target.value)}
      options={all.map((v) => {
        const past = intervalPassed(v, day, c);
        return { value: v, label: past ? `${v} — уже прошёл` : v, disabled: past };
      })}
    />
  );
}

/* ---------- назначить / переназначить ---------- */

export function AssignCourierModal({ id, mode, onClose }: { id: ID; mode: 'assign' | 'reassign'; onClose: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const d = useDelivery(id);
  const c = clockOf(db);
  const [date, setDate] = useState<ISODate>(() => (!d || d.date < c.today ? c.today : d.date));
  const [interval, setIv] = useState(() => (d ? intervalFor(d.interval, !d || d.date < c.today ? c.today : d.date, c) : INTERVALS[2]));
  const loads = useMemo(() => loadsOf(db, date, c), [db, version, date]);
  const [courierId, setCourierId] = useState<ID | ''>(() => {
    if (!d) return '';
    return suggestCourier(loads.filter((l) => l.courier.id !== d.courierId), d.district) ?? '';
  });
  const [error, setError] = useState<string | null>(null);
  const run = useRun();
  if (!d) return <Missing onClose={onClose} />;

  const pickDate = (v: ISODate) => {
    setDate(v);
    setIv((iv) => intervalFor(iv, v, c));
  };
  const moved = interval !== d.interval;

  const submit = () => {
    if (!courierId) {
      setError('Выберите курьера');
      return;
    }
    if (intervalPassed(interval, date, c)) {
      setError('Этот интервал сегодня уже прошёл — выберите другой');
      return;
    }
    const courier = loads.find((l) => l.courier.id === courierId)?.courier;
    const r = run('delivery.assign', { deliveryId: d.id, courierId, date, interval }, `Доставка № ${d.number}: ${courier?.short ?? 'курьер'}, ${dayLabel(date, c).toLowerCase()}, ${interval}`);
    if (r.ok) onClose();
    else setError(r.error ?? null);
  };

  return (
    <Modal
      title={mode === 'assign' ? 'Назначить курьера' : 'Переназначить курьера'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} disabled={!courierId}>
            {mode === 'reassign' ? 'Переназначить' : 'Назначить'}
          </Button>
        </>
      }
    >
      <DeliveryLine d={d} />
      <div className="dl-when">
        <Field label="День">
          <DayChoice value={date} onChange={pickDate} c={c} />
        </Field>
        <Field label="Интервал">
          <IntervalSelect value={interval} onChange={setIv} day={date} c={c} current={d.interval} />
        </Field>
      </div>
      {moved && intervalPassed(d.interval, date, c) ? <Notice tone="info">{`Интервал ${d.interval} сегодня уже прошёл — предложили ближайший`}</Notice> : null}
      <Field label={`Курьер на ${dayLabel(date, c).toLowerCase()}`}>
        <CourierPicker loads={loads} value={courierId} onChange={setCourierId} district={d.district} exclude={mode === 'reassign' ? d.courierId : null} />
      </Field>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

/* ---------- перенести / повторить после неудачи — одно окно ---------- */

const ASKED_FAIL = 'Перенос по просьбе клиента';

export function RescheduleModal({ id, onClose }: { id: ID; onClose: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const d = useDelivery(id);
  const c = clockOf(db);
  const fail = d && d.state === 'failed' ? lastFail(d) : null;
  const wish = d ? wishOf(d, c.today) : null;
  const usableWish = wish && wish.date >= c.today && !intervalPassed(wish.interval, wish.date, c) ? wish : null;
  const initialDate: ISODate = !d
    ? c.tomorrow
    : usableWish
      ? usableWish.date
      : fail
        ? fail.reason === ASKED_FAIL || !nearestInterval(c) || c.nowMin >= 17 * 60
          ? c.tomorrow
          : c.today
        : d.date > c.today
          ? d.date
          : c.tomorrow;
  const [date, setDate] = useState<ISODate>(initialDate);
  const [interval, setIv] = useState(() => (usableWish ? usableWish.interval : d ? intervalFor(d.interval, initialDate, c) : INTERVALS[2]));
  const loads = useMemo(() => loadsOf(db, date, c), [db, version, date]);
  const [courierId, setCourierId] = useState<ID | ''>(() => {
    if (!d) return '';
    if (d.courierId && loads.some((l) => l.courier.id === d.courierId)) return d.courierId;
    return d.state === 'failed' ? suggestCourier(loads, d.district) ?? '' : '';
  });
  const [reason, setReason] = useState<string>(() =>
    wish || fail?.reason === ASKED_FAIL ? 'Клиент попросил' : fail?.reason === 'Не успели в интервал' ? 'Не успели' : '',
  );
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useRun();
  if (!d) return <Missing onClose={onClose} />;
  const retry = d.state === 'failed';

  const pickDate = (v: ISODate) => {
    setDate(v);
    setIv((iv) => intervalFor(iv, v, c));
  };

  const submit = () => {
    const text = comment.trim();
    if (!reason && !retry) {
      setError('Выберите причину переноса');
      return;
    }
    if (reason === 'Другое' && !text) {
      setError('Напишите причину');
      return;
    }
    if (intervalPassed(interval, date, c)) {
      setError('Этот интервал сегодня уже прошёл — выберите другой');
      return;
    }
    const why = !reason
      ? `Повторная доставка: ${(fail?.reason ?? 'не удалось').toLowerCase()}`
      : reason === 'Другое'
        ? text
        : text
          ? `${reason}: ${text}`
          : reason;
    const payload: { deliveryId: ID; date: ISODate; interval: string; courierId?: ID; reason: string } = { deliveryId: d.id, date, interval, reason: why };
    if (courierId) payload.courierId = courierId;
    const courier = courierId ? loads.find((l) => l.courier.id === courierId)?.courier : undefined;
    const r = run(
      'delivery.reschedule',
      payload,
      `Доставка № ${d.number}: ${dayLabel(date, c).toLowerCase()}, ${interval}${courier ? `, ${courier.short}` : ', ждёт назначения курьера'}`,
    );
    if (r.ok) onClose();
    else setError(r.error ?? null);
  };

  return (
    <Modal
      title={retry ? 'Повторить доставку' : 'Перенести доставку'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit}>
            {retry ? (courierId ? 'Назначить повторно' : 'Перенести без курьера') : 'Перенести'}
          </Button>
        </>
      }
    >
      <DeliveryLine d={d} />
      {fail ? (
        <Notice tone="warn" title={`Не удалось ${fmt.dateTime(fail.at)}: ${fail.reason}`}>
          {wish ? `Клиент просит ${fmt.date(wish.date)}, ${wish.interval}` : null}
        </Notice>
      ) : wish ? (
        <Notice tone="info">{`Клиент просит ${fmt.date(wish.date)}, ${wish.interval}`}</Notice>
      ) : null}
      <div className="dl-when">
        <Field label={retry ? 'День' : 'Новый день'}>
          <DayChoice value={date} onChange={pickDate} c={c} />
        </Field>
        <Field label="Интервал">
          <IntervalSelect value={interval} onChange={setIv} day={date} c={c} current={d.interval} />
        </Field>
      </div>
      {wish && (wish.date !== date || wish.interval !== interval) && usableWish ? (
        <div className="chips">
          <button
            type="button"
            className="dl-quick"
            onClick={() => {
              setDate(usableWish.date);
              setIv(usableWish.interval);
            }}
          >
            Как просит клиент · {dayLabel(usableWish.date, c).toLowerCase()}, {usableWish.interval}
          </button>
        </div>
      ) : null}
      <Field label={`Курьер на ${dayLabel(date, c).toLowerCase()}`}>
        <CourierPicker loads={loads} value={courierId} onChange={setCourierId} district={d.district} allowNone />
      </Field>
      <Field label={retry ? 'Причина' : 'Причина переноса'}>
        <Segmented
          ariaLabel="Причина"
          value={reason}
          onChange={(v) => {
            setReason(v);
            setError(null);
          }}
          options={RESCHEDULE_REASONS.map((r) => ({ value: r, label: r }))}
        />
      </Field>
      {reason ? (
        <Field label={reason === 'Другое' ? 'Что случилось' : 'Комментарий'}>
          <Textarea rows={2} value={comment} placeholder={reason === 'Другое' ? 'Попадёт в историю заказа' : 'Если нужно'} onChange={(e) => { setComment(e.target.value); setError(null); }} />
        </Field>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

/* ---------- вернуть на склад ---------- */

export function ReturnModal({ id, onClose }: { id: ID; onClose: () => void }) {
  const db = useDB();
  useDBVersion();
  const d = useDelivery(id);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useRun();
  if (!d) return <Missing onClose={onClose} />;
  const ix = indexes(db);
  const order = ix.orders.get(d.orderId);
  const lines = order ? order.lines.filter((l) => l.shipped > 0) : [];
  const pcs = lines.reduce((z, l) => z + l.shipped, 0);
  const fail = lastFail(d);

  const submit = () => {
    const r = run('delivery.returnToStock', { deliveryId: d.id, comment: comment.trim() || undefined }, `Доставка № ${d.number}: товар возвращён на склад`);
    if (r.ok) onClose();
    else setError(r.error ?? null);
  };

  return (
    <Modal
      title="Вернуть товар на склад"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} disabled={!lines.length}>
            Вернуть на склад
          </Button>
        </>
      }
    >
      <DeliveryLine d={d} />
      {fail ? (
        <Notice tone="warn" title="Последняя попытка">
          {fmt.dateTime(fail.at)} · {fail.reason}
        </Notice>
      ) : null}
      <Notice tone="info">
        Заказ {order ? `№ ${order.number}` : ''} отменится. {fmt.count(lines.length, 'позиция', 'позиции', 'позиций')}, {fmt.qty(pcs)} уйдут на проверку в карантин склада.
      </Notice>
      <div className="dl-ret-list">
        {lines.slice(0, 8).map((l) => (
          <div key={l.productId} className="dl-ret-row">
            <span className="grow ellipsis">{ix.products.get(l.productId)?.name ?? 'Товар'}</span>
            <span className="num w-600">{fmt.qty(l.shipped)}</span>
          </div>
        ))}
        {lines.length > 8 ? <div className="t-12 muted">и ещё {fmt.count(lines.length - 8, 'позиция', 'позиции', 'позиций')}</div> : null}
      </div>
      <Field label="Комментарий">
        <Textarea rows={2} value={comment} placeholder={fail ? `Не доставлен: ${fail.reason}` : 'Почему возвращаем'} onChange={(e) => setComment(e.target.value)} />
      </Field>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

/* ---------- назначить ожидающие ---------- */

export function BulkAssignModal({ ids, day, onClose }: { ids: ID[]; day: ISODate; onClose: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const { me } = useSession();
  const c = clockOf(db);
  const list = useMemo(
    () => db.deliveries.filter((d) => ids.includes(d.id) && d.state === 'waiting').sort((a, b) => a.district.localeCompare(b.district, 'ru') || a.interval.localeCompare(b.interval)),
    [db, version, ids.join('|')],
  );
  const target = day < c.today ? c.today : day;
  const baseLoads = useMemo(() => loadsOf(db, target, c), [db, version, target]);
  const ix = indexes(db);

  // предложения по районам с учётом уже выбранного в этом окне
  const [picks, setPicks] = useState<Record<ID, ID | ''>>(() => {
    const res: Record<ID, ID | ''> = {};
    const extra = new Map<ID, Delivery[]>();
    for (const d of list) {
      const loads = baseLoads.map((l) => {
        const add = extra.get(l.courier.id) ?? [];
        return { ...l, points: l.points + add.length, districts: [...new Set([...l.districts, ...add.map((x) => shortDistrict(x.district))])], list: [...l.list, ...add] };
      });
      const s = suggestCourier(loads, d.district);
      res[d.id] = s ?? '';
      if (s) extra.set(s, [...(extra.get(s) ?? []), d]);
    }
    return res;
  });
  // интервал по каждой доставке: если сегодня он уже прошёл — ближайший будущий
  const [ivs, setIvs] = useState<Record<ID, string>>(() => Object.fromEntries(list.map((d) => [d.id, intervalFor(d.interval, target, c)])));
  const [busy, setBusy] = useState(false);
  const movedN = list.filter((d) => (ivs[d.id] ?? d.interval) !== d.interval).length;

  const loadsNow = baseLoads.map((l) => {
    const added = list.filter((d) => picks[d.id] === l.courier.id);
    return { ...l, points: l.points + added.length, places: l.places + added.reduce((z, d) => z + d.places, 0), kg: l.kg + added.reduce((z, d) => z + Math.round(d.weightKg), 0) };
  });
  const chosen = list.filter((d) => picks[d.id]);

  const submit = () => {
    setBusy(true);
    let ok = 0;
    const errors: string[] = [];
    for (const d of chosen) {
      const interval = ivs[d.id] ?? d.interval;
      if (intervalPassed(interval, target, c)) {
        errors.push(`№ ${d.number}: интервал ${interval} уже прошёл`);
        continue;
      }
      const r = dispatch('delivery.assign' as never, { deliveryId: d.id, courierId: picks[d.id], date: target, interval } as never, me.id) as { ok: boolean; error?: string };
      if (r.ok) ok++;
      else errors.push(`№ ${d.number}: ${r.error}`);
    }
    setBusy(false);
    if (ok) toast(`Назначено ${fmt.count(ok, 'доставка', 'доставки', 'доставок')}`);
    if (errors.length) toast(errors.join('; '), 'error');
    else onClose();
  };

  return (
    <Modal
      wide
      title="Назначить ожидающие"
      sub={`${dayLabel(target, c)} · ${fmt.count(list.length, 'доставка', 'доставки', 'доставок')} без курьера`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} disabled={!chosen.length} loading={busy}>
            {chosen.length ? `Назначить ${fmt.count(chosen.length, 'доставку', 'доставки', 'доставок')}` : 'Назначить'}
          </Button>
        </>
      }
    >
      <div className="dl-bulk-loads">
        {loadsNow.map((l) => (
          <div key={l.courier.id} className="dl-bulk-load">
            <Avatar name={l.courier.name} size="sm" />
            <span className="grow col" style={{ gap: 0 }}>
              <span className="w-700">{l.courier.short}</span>
              <span className="t-12 muted">{loadText(l)}</span>
            </span>
          </div>
        ))}
      </div>
      {movedN ? <Notice tone="info">{`У ${fmt.count(movedN, 'доставки', 'доставок', 'доставок')} интервал сегодня уже прошёл — предложили ближайший`}</Notice> : null}
      {list.length ? (
        <div className="dl-bulk">
          {list.map((d) => {
            const client = ix.clients.get(d.clientId);
            return (
              <div key={d.id} className="dl-bulk-row">
                <span className="dl-line-no">№ {d.number}</span>
                <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                  <span className="w-700 ellipsis">{client?.name ?? d.contactName}</span>
                  <span className="t-12 muted ellipsis">
                    <MapPin size={12} style={{ verticalAlign: -2 }} /> {d.address}, {shortDistrict(d.district)} · {placesText(d.places)}
                    {d.collect > 0 ? ` · ${fmt.money(d.collect)}` : ''}
                  </span>
                </span>
                <span className="dl-bulk-iv">
                  <IntervalSelect value={ivs[d.id] ?? d.interval} onChange={(v) => setIvs((x) => ({ ...x, [d.id]: v }))} day={target} c={c} current={d.interval} />
                </span>
                <Select
                  size="sm"
                  className="dl-bulk-select"
                  aria-label={`Курьер для доставки № ${d.number}`}
                  value={picks[d.id] ?? ''}
                  onChange={(e) => setPicks((p) => ({ ...p, [d.id]: e.target.value }))}
                  options={[{ value: '', label: 'Не назначать' }, ...baseLoads.map((l) => ({ value: l.courier.id, label: l.courier.short }))]}
                />
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState title="Ожидающих нет">Все доставки уже назначены</EmptyState>
      )}
    </Modal>
  );
}

/* ---------- принять деньги от курьера ---------- */

export function HandInModal({ courierId, onClose }: { courierId: ID; onClose: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const courier = indexes(db).employees.get(courierId);
  const list = useMemo(() => notHandedIn(db, courierId), [db, version, courierId]);
  const ix = indexes(db);
  const sum = list.reduce((z, d) => z + d.collected, 0);
  const [counted, setCounted] = useState<number | ''>(sum);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useRun();
  const got = counted === '' ? 0 : counted;
  const short = Math.max(0, sum - got);
  const over = got > sum;

  const submit = () => {
    if (over) {
      setError(`Пересчитано больше, чем курьер получил по доставкам (${fmt.money(sum)}). Проверьте сумму`);
      return;
    }
    if (short > 0 && !comment.trim()) {
      setError('Недостача: напишите, что сказал курьер');
      return;
    }
    const payload: { courierId: ID; counted: number; comment?: string } = { courierId, counted: got };
    if (comment.trim()) payload.comment = comment.trim();
    const who = courier?.short ?? 'Курьер';
    const r = run('courier.handIn', payload, short > 0 ? `${who} сдал ${fmt.money(got)}, недостача ${fmt.money(short)} записана на курьера` : `${who} сдал ${fmt.money(got)} в кассу магазина`, { info: 'none' });
    if (r.ok) onClose();
    else setError(r.error ?? null);
  };
  return (
    <Modal
      title="Принять деньги от курьера"
      sub={courier?.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} disabled={!sum || over || (short > 0 && !comment.trim())}>
            {sum ? `Принять ${fmt.money(got)}` : 'Принять'}
          </Button>
        </>
      }
    >
      {list.length ? (
        <>
          <div className="dl-ret-list">
            {list.map((d) => (
              <div key={d.id} className="dl-ret-row">
                <span className="dl-line-no">№ {d.number}</span>
                <span className="grow ellipsis">{ix.clients.get(d.clientId)?.name ?? d.contactName}</span>
                <span className="t-12 muted nowrap">{fmt.relDate(deliveredAt(d), db.meta.today)}, {fmt.time(deliveredAt(d))}</span>
                <span className="num w-700">{fmt.money(d.collected)}</span>
              </div>
            ))}
            <div className="dl-ret-row is-total">
              <span className="grow">Получено наличными по доставкам</span>
              <span className="num w-700 t-16">{fmt.money(sum)}</span>
            </div>
          </div>
          <Field label="Пересчитано">
            <MoneyInput
              size="lg"
              value={counted}
              ariaLabel="Пересчитано"
              onChange={(v) => {
                setCounted(v);
                setError(null);
              }}
            />
          </Field>
          {short > 0 ? (
            <>
              <Notice tone="warn" title={`Недостача ${fmt.money(short)} запишется на курьера`}>
                В кассу примем {fmt.money(got)}, разница уйдёт в расходы «Недостача»
              </Notice>
              <Field label="Что сказал курьер">
                <Textarea rows={2} value={comment} placeholder="Например: дал сдачу больше, обещал вернуть завтра" onChange={(e) => { setComment(e.target.value); setError(null); }} />
              </Field>
            </>
          ) : over ? (
            <Notice tone="bad">Больше, чем курьер получил по доставкам — пересчитайте ещё раз</Notice>
          ) : (
            <Notice tone="info">Пересчитайте деньги. После приёма сумма перейдёт в кассу магазина.</Notice>
          )}
        </>
      ) : (
        <EmptyState title="Сдавать нечего">Все наличные от этого курьера уже приняты</EmptyState>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

/** Ожидающие назначения на день (вместе с хвостами прошлых дней на сегодня). */
export function waitingFor(list: Delivery[], day: ISODate, c: ReturnType<typeof clockOf>): Delivery[] {
  return forDay(list, day, c).filter((d) => d.state === 'waiting').sort(byRoute);
}
