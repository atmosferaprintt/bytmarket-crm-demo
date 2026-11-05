/* Единый словарь статусов: одно состояние — одно слово во всех разделах.
   Использование: <StatusChip s={ORDER_STATE[o.state]} /> */
import type { Tone } from './Chip';
import type { DeliveryState, OrderState, PickState, PurchaseState, QuarantineState, ShipState, VisitResult } from '../data/types';

export interface StatusDef {
  label: string;
  tone: Tone;
}

export const ORDER_STATE: Record<OrderState, StatusDef> = {
  draft: { label: 'Черновик', tone: 'neutral' },
  request: { label: 'Заявка', tone: 'violet' },
  confirmed: { label: 'Подтверждён', tone: 'info' },
  closed: { label: 'Подтверждён', tone: 'info' }, // товар отгружен; «завершён» не пишем — оплата и доставка видны отдельно (§16)
  cancelled: { label: 'Отменён', tone: 'outline' },
};

export const PICK_STATE: Record<PickState, StatusDef> = {
  none: { label: 'Не собран', tone: 'neutral' },
  picking: { label: 'Собирается', tone: 'warn' },
  picked: { label: 'Собран', tone: 'ok' },
};

export const SHIP_STATE: Record<ShipState, StatusDef> = {
  none: { label: 'Не отгружен', tone: 'neutral' },
  partial: { label: 'Отгружен частично', tone: 'warn' },
  shipped: { label: 'Отгружен', tone: 'ok' },
  delivered: { label: 'Доставлен', tone: 'ok' },
};

export type PayState = 'unpaid' | 'partial' | 'paid' | 'overpaid';
export const PAY_STATE: Record<PayState, StatusDef> = {
  unpaid: { label: 'Не оплачен', tone: 'neutral' },
  partial: { label: 'Оплачен частично', tone: 'warn' },
  paid: { label: 'Оплачен', tone: 'ok' },
  overpaid: { label: 'Переплата', tone: 'info' },
};

/** Просрочка оплаты: «Просрочка 6 дн.» */
export function overdueStatus(days: number): StatusDef {
  return { label: `Просрочка ${days} дн.`, tone: 'bad' };
}

export const DELIVERY_STATE: Record<DeliveryState, StatusDef> = {
  waiting: { label: 'Ожидает назначения', tone: 'warn' },
  assigned: { label: 'Назначена', tone: 'info' },
  on_way: { label: 'В пути', tone: 'violet' },
  delivered: { label: 'Доставлена', tone: 'ok' },
  failed: { label: 'Неудачная попытка', tone: 'bad' },
  returned: { label: 'Возвращена на склад', tone: 'outline' },
};

export const PURCHASE_STATE: Record<PurchaseState, StatusDef> = {
  draft: { label: 'Черновик', tone: 'neutral' },
  ordered: { label: 'Заказана', tone: 'info' },
  partial: { label: 'Принята частично', tone: 'warn' },
  received: { label: 'Принята', tone: 'ok' },
  cancelled: { label: 'Отменена', tone: 'outline' },
};

export const QUARANTINE_STATE: Record<QuarantineState, StatusDef> = {
  check: { label: 'На проверке', tone: 'warn' },
  released: { label: 'Возвращён в продажу', tone: 'ok' },
  written_off: { label: 'Списан', tone: 'outline' },
};

export const VISIT_RESULT: Record<VisitResult, StatusDef> = {
  order: { label: 'Заказ', tone: 'ok' },
  callback: { label: 'Перезвонить', tone: 'info' },
  refusal: { label: 'Отказ', tone: 'bad' },
};

export const VISIT_STATE: Record<'planned' | 'done' | 'missed', StatusDef> = {
  planned: { label: 'Запланирован', tone: 'neutral' },
  done: { label: 'Выполнен', tone: 'ok' },
  missed: { label: 'Пропущен', tone: 'bad' },
};

export const PAYMENT_STATUS: Record<'posted' | 'pending' | 'unidentified', StatusDef> = {
  posted: { label: 'Проведён', tone: 'ok' },
  pending: { label: 'Ждёт подтверждения', tone: 'warn' },
  unidentified: { label: 'Не опознан', tone: 'bad' },
};

/** Акции: одно слово на состояние во всех разделах. */
export const PROMO_STATE: Record<'active' | 'future' | 'ended' | 'off', StatusDef> = {
  active: { label: 'Действует', tone: 'ok' },
  future: { label: 'Скоро', tone: 'info' },
  ended: { label: 'Закончилась', tone: 'outline' },
  off: { label: 'Выключена', tone: 'outline' },
};

export const STOCK_LEVEL = {
  out: { label: 'Нет в наличии', tone: 'bad' } as StatusDef,
  low: { label: 'Ниже минимума', tone: 'warn' } as StatusDef,
  ok: { label: 'В наличии', tone: 'ok' } as StatusDef,
  inactive: { label: 'Не продаётся', tone: 'outline' } as StatusDef,
};
