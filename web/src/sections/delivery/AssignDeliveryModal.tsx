import { useMemo, useState } from 'react';
import { Truck } from 'lucide-react';
import type { ID, ISODate } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes, orderPayment } from '../../data/selectors';
import { Button, Field, Modal, MoneyInput, Notice, QtyInput, Select, Textarea, fmt } from '../../ui';
import { DayChoice } from './parts';
import { INTERVALS, clockOf, dayLabel, loadText, loadsOf, placesText, kgText, shortDistrict, suggestCourier } from './lib';
import { useRun } from './run';
import './delivery.css';

export interface AssignDeliveryProps {
  /** заказ, для которого оформляем доставку */
  orderId: ID;
  /** если доставка уже есть — переназначить */
  deliveryId?: ID;
  onClose: () => void;
  onDone?: (deliveryId: ID) => void;
}

/** Оформить или переназначить доставку: точка/адрес, дата, интервал, курьер, места, сумма к получению. Общий: карточка заказа, Доставка. */
export function AssignDeliveryModal({ orderId, deliveryId, onClose, onDone }: AssignDeliveryProps) {
  const db = useDB();
  const version = useDBVersion();
  const run = useRun();
  const c = clockOf(db);
  const ix = indexes(db);
  const order = ix.orders.get(orderId);
  const client = order ? ix.clients.get(order.clientId) : undefined;
  const existing = deliveryId ? db.deliveries.find((d) => d.id === deliveryId) : order?.deliveryId ? db.deliveries.find((d) => d.id === order.deliveryId && d.state !== 'delivered' && d.state !== 'returned') : undefined;
  const editing = !!existing;

  // оценка мест и веса — так же считает операция оформления
  const estimate = useMemo(() => {
    let kg = 0;
    let places = 0;
    for (const l of order?.lines ?? []) {
      const p = ix.products.get(l.productId);
      kg += (l.qty * (p?.weightG ?? 300)) / 1000;
      places += l.pack === 'box' ? l.packQty : Math.ceil(l.qty / 12);
    }
    return { kg: Math.round(kg * 10) / 10, places: Math.max(1, places) };
  }, [order, version]);

  const pay = order ? orderPayment(db, order) : null;
  const defaultFee = order && order.total >= db.settings.freeDeliveryFrom ? 0 : db.settings.deliveryFee;
  const debt = pay ? Math.max(0, pay.due - pay.pending) : 0;

  const [pointId, setPointId] = useState<ID>(existing?.pointId ?? order?.pointId ?? client?.points[0]?.id ?? '');
  const [date, setDate] = useState<ISODate>(existing ? (existing.date < c.today ? c.today : existing.date) : c.nowMin >= 15 * 60 ? c.tomorrow : c.today);
  const [interval, setIntervalV] = useState(existing?.interval ?? INTERVALS[2]);
  const point = client?.points.find((p) => p.id === pointId);
  const loads = useMemo(() => loadsOf(db, date, c), [db, version, date]);
  const [courierId, setCourierId] = useState<ID | ''>(existing ? existing.courierId ?? '' : '');
  const [places, setPlaces] = useState(existing?.places ?? estimate.places);
  const [fee, setFee] = useState<number | ''>(existing?.fee ?? defaultFee);
  const [collect, setCollect] = useState<number | ''>(existing?.collect ?? (client && client.deferDays === 0 ? debt + defaultFee : 0));
  const [comment, setComment] = useState(existing?.comment ?? '');
  const [error, setError] = useState<string | null>(null);

  if (!order || !client) {
    return (
      <Modal title="Доставка заказа" onClose={onClose}>
        <Notice tone="bad">Заказ не найден</Notice>
      </Modal>
    );
  }

  const suggested = point ? suggestCourier(loads, point.district) : null;
  const courierOptions = [
    { value: '', label: 'Не назначать — ожидает назначения' },
    ...loads.map((l) => ({ value: l.courier.id, label: `${l.courier.short} · ${l.points ? loadText(l) : 'свободен'}${l.courier.id === suggested ? ' · по пути' : ''}` })),
  ];
  const intervals = INTERVALS.includes(interval) ? INTERVALS : [interval, ...INTERVALS];
  const feeNum = fee === '' ? 0 : fee;

  const submit = () => {
    setError(null);
    if (editing && existing) {
      if (existing.state === 'on_way') {
        setError('Курьер уже в пути — менять доставку нельзя');
        return;
      }
      const dateChanged = date !== existing.date || interval !== existing.interval;
      if (!dateChanged && courierId === (existing.courierId ?? '')) {
        onClose();
        return;
      }
      let r: { ok: boolean; error?: string };
      if (dateChanged || !courierId) {
        const payload: { deliveryId: ID; date: ISODate; interval: string; courierId?: ID } = { deliveryId: existing.id, date, interval };
        if (courierId) payload.courierId = courierId;
        r = run('delivery.reschedule', payload, `Доставка № ${existing.number}: ${dayLabel(date, c).toLowerCase()}, ${interval}`);
      } else if (courierId !== existing.courierId) {
        r = run('delivery.assign', { deliveryId: existing.id, courierId, date }, `Доставка № ${existing.number}: курьер ${ix.employees.get(courierId)?.short ?? ''}`);
      } else {
        onClose();
        return;
      }
      if (r.ok) {
        onDone?.(existing.id);
        onClose();
      } else setError(r.error ?? null);
      return;
    }
    if (!pointId) {
      setError('Выберите адрес доставки');
      return;
    }
    const payload: Record<string, unknown> = {
      orderId: order.id,
      pointId,
      date,
      interval,
      places,
      fee: feeNum,
      collect: collect === '' ? 0 : collect,
      comment: comment.trim(),
    };
    if (courierId) payload.courierId = courierId;
    const r = run('delivery.create', payload, courierId ? `Доставка оформлена: ${ix.employees.get(courierId)?.short ?? 'курьер'}, ${dayLabel(date, c).toLowerCase()}` : 'Доставка оформлена, ждёт назначения курьера');
    if (r.ok) {
      if (r.id) onDone?.(r.id);
      onClose();
    } else setError(r.error ?? null);
  };

  return (
    <Modal
      icon={
        <span className="icon-tile">
          <Truck />
        </span>
      }
      title={editing ? `Доставка № ${existing?.number}` : 'Оформить доставку'}
      sub={`Заказ № ${order.number} · ${client.name}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} disabled={!client.points.length}>
            {editing ? 'Сохранить' : courierId ? 'Оформить и назначить' : 'Оформить доставку'}
          </Button>
        </>
      }
    >
      {!client.points.length ? (
        <Notice tone="warn" title="У клиента нет адреса доставки">
          Добавьте точку в карточке клиента — адрес, район и контакт
        </Notice>
      ) : (
        <Field label="Куда">
          <Select
            value={pointId}
            disabled={editing}
            onChange={(e) => setPointId(e.target.value)}
            options={client.points.map((p) => ({ value: p.id, label: `${p.name} — ${p.address}, ${shortDistrict(p.district)}` }))}
          />
        </Field>
      )}

      <Field label="День">
        <DayChoice value={date} onChange={setDate} c={c} />
      </Field>
      <div className="grid-2">
        <Field label="Интервал">
          <Select value={interval} onChange={(e) => setIntervalV(e.target.value)} options={intervals.map((v) => ({ value: v, label: v }))} />
        </Field>
        <Field label="Курьер">
          <Select value={courierId} onChange={(e) => setCourierId(e.target.value)} options={courierOptions} />
        </Field>
      </div>

      {editing && existing ? (
        <div className="dl-facts is-3">
          <div className="dl-fact">
            <span className="dl-fact-label">Мест</span>
            <span className="dl-fact-value">{placesText(existing.places)}</span>
          </div>
          <div className="dl-fact">
            <span className="dl-fact-label">Вес</span>
            <span className="dl-fact-value">{kgText(existing.weightKg)}</span>
          </div>
          <div className="dl-fact">
            <span className="dl-fact-label">К получению</span>
            <span className="dl-fact-value">{fmt.money(existing.collect)}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="grid-2">
            <Field label={`Мест · около ${kgText(estimate.kg)}`}>
              <QtyInput value={places} min={1} onChange={setPlaces} ariaLabel="Мест" />
            </Field>
            <Field label="Доставка для клиента">
              <MoneyInput value={fee} onChange={(v) => { setFee(v); }} placeholder="0 — бесплатно" />
            </Field>
          </div>
          <Field label="К получению при вручении">
            <MoneyInput value={collect} onChange={setCollect} />
          </Field>
          <div className="chips">
            <button type="button" className="dl-quick" onClick={() => setCollect(debt + feeNum)}>
              Долг по заказу и доставка · {fmt.money(debt + feeNum)}
            </button>
            <button type="button" className="dl-quick" onClick={() => setCollect(0)}>
              Ничего — {client.deferDays ? `отсрочка ${client.deferDays} дн.` : 'оплачено'}
            </button>
          </div>
          <Field label="Комментарий для курьера">
            <Textarea rows={2} value={comment} placeholder="Например: позвонить за час, въезд со двора" onChange={(e) => setComment(e.target.value)} />
          </Field>
        </>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

export default AssignDeliveryModal;
