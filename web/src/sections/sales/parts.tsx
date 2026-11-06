/* Детали раздела «Продажи», которые нужны в нескольких экранах. */
import type { ReactNode } from 'react';
import type { Client, Delivery, Order, Promo } from '../../data/types';
import type { ClientBalance, OrderPayment } from '../../data/selectors';
import { Chip, DELIVERY_STATE, PAY_STATE, PICK_STATE, PROMO_STATE, ORDER_STATE, SHIP_STATE, StatusChip, cx, fmt, overdueStatus, type StatusDef } from '../../ui';

/** Полоса условий клиента: цены, отсрочка, лимит, долг, просрочка и срок оплаты. */
export function ConditionsStrip({ client, balance, dueLabel }: { client: Client; balance: ClientBalance; dueLabel: ReactNode }) {
  return (
    <div className="sales-cond" data-hint="sales.conditions">
      <div>
        <span className="sales-cond-label">Цены</span>
        <span className="sales-cond-value">{client.priceType === 'wholesale' ? 'Опт' : 'Розница'}</span>
      </div>
      <div>
        <span className="sales-cond-label">Отсрочка</span>
        <span className="sales-cond-value">{client.deferDays > 0 ? fmt.count(client.deferDays, 'день', 'дня', 'дней') : 'Нет'}</span>
      </div>
      <div>
        <span className="sales-cond-label">Кредитный лимит</span>
        <span className="sales-cond-value">{client.creditLimit > 0 ? fmt.money(client.creditLimit) : 'Без кредита'}</span>
      </div>
      <div>
        <span className="sales-cond-label">Долг</span>
        <span className="sales-cond-value">{fmt.money(balance.debt)}</span>
      </div>
      <div>
        <span className="sales-cond-label">Просрочено</span>
        <span className={cx('sales-cond-value', balance.overdue > 0 && 'c-bad')}>{fmt.money(balance.overdue)}</span>
      </div>
      <div>
        <span className="sales-cond-label">Оплата заказа до</span>
        <span className="sales-cond-value">{dueLabel}</span>
      </div>
    </div>
  );
}

/** Остаток кредитного лимита полосой: долг и открытые заказы, этот заказ, свободно. */
export function LimitBar({ limit, used, current, label = 'Остаток лимита после заказа' }: { limit: number; used: number; current: number; label?: string }) {
  const left = limit - used - current;
  const pUsed = Math.min(100, (used / limit) * 100);
  const pCur = Math.max(0, Math.min(100 - pUsed, (current / limit) * 100));
  return (
    <div className="sales-limit" data-hint="sales.limit">
      <div className="row">
        <span className="t-13 w-600 ink-2 grow">{label}</span>
        <span className={cx('t-13 w-700 num', left < 0 && 'c-bad')}>{fmt.money(left)}</span>
      </div>
      <div className="sales-limit-bar" role="img" aria-label={`Лимит ${fmt.money(limit)}: занято ${fmt.money(used)}, этот заказ ${fmt.money(current)}`}>
        {pUsed > 0 ? <span className="is-used" style={{ width: `${pUsed}%` }} /> : null}
        {pCur > 0 ? <span className="is-current" style={{ width: `${pCur}%` }} /> : null}
      </div>
      <div className="sales-limit-legend">
        <span>
          <i className="is-used" />
          Долг и заказы
        </span>
        <span>
          <i className="is-current" />
          Этот заказ
        </span>
        <span>
          <i />
          Свободно
        </span>
      </div>
    </div>
  );
}

/** Доставка не удалась, товар ещё не вернули на склад: заказ не закончен. */
export function deliveryFailed(o: Order, d: Delivery | undefined): boolean {
  return o.fulfillment === 'delivery' && !!d && d.state === 'failed' && o.ship !== 'delivered';
}

/** «Не доставлен» в колонке «Отгрузка»: товар уехал с курьером, но клиент его не получил. */
export const SHIP_FAILED: StatusDef = { label: 'Не доставлен', tone: 'bad' };

/** Отгрузка заказа одним словом с учётом неудачной доставки. */
export function shipStatus(o: Order, d: Delivery | undefined): StatusDef {
  return deliveryFailed(o, d) ? SHIP_FAILED : SHIP_STATE[o.ship];
}

/** Дни просрочки, которые показываем. По недоставленному заказу просрочку не рисуем: клиент товар не получил. */
export function shownOverdue(o: Order, pay: OrderPayment, d: Delivery | undefined): number {
  return deliveryFailed(o, d) ? 0 : pay.overdueDays;
}

/** Заказ ждёт решения владельца: открыта задача «согласовать заказ». */
export const APPROVAL_STATUS: StatusDef = { label: 'На согласовании у владельца', tone: 'warn' };
/** Заявка представителя, которую ещё не подтвердил менеджер, — так её видит сам представитель. */
export const WAITS_MANAGER: StatusDef = { label: 'Ждёт менеджера', tone: 'violet' };
/** Заявка оформлена без связи и ещё не ушла с телефона. */
export const NOT_SENT: StatusDef = { label: 'Не отправлена', tone: 'warn' };

/** Главный этап заказа одним словом: Заявка → Подтверждён → Собирается → Собран → В пути → Доставлен / Отгружен. */
export function orderStage(o: Order, d: Delivery | undefined, opts: { rep?: boolean; approval?: boolean } = {}): StatusDef {
  if (o.state === 'draft') return ORDER_STATE.draft;
  if (o.state === 'cancelled') return ORDER_STATE.cancelled;
  if (o.state === 'request') return opts.approval ? APPROVAL_STATUS : opts.rep ? WAITS_MANAGER : ORDER_STATE.request;
  if (deliveryFailed(o, d)) return SHIP_FAILED;
  if (o.ship === 'delivered') return SHIP_STATE.delivered;
  if (o.ship === 'shipped') return o.fulfillment === 'delivery' && d && d.state === 'on_way' ? DELIVERY_STATE.on_way : SHIP_STATE.shipped;
  if (o.ship === 'partial') return SHIP_STATE.partial;
  if (o.pick === 'picking') return PICK_STATE.picking;
  if (o.pick === 'picked') return PICK_STATE.picked;
  return ORDER_STATE.confirmed;
}

/** Коротко о заказе в два чипа: главный этап и оплата (или просрочка). Для списков «Последние заказы» и телефона. */
export function OrderBrief({ o, pay, delivery, rep, approval, extra }: { o: Order; pay: OrderPayment; delivery?: Delivery; rep?: boolean; approval?: boolean; extra?: ReactNode }) {
  const live = o.state === 'confirmed' || o.state === 'closed';
  const overdue = shownOverdue(o, pay, delivery);
  return (
    <span className="chips sales-chips-compact">
      <StatusChip s={orderStage(o, delivery, { rep, approval })} />
      {overdue > 0 ? <StatusChip s={overdueStatus(overdue)} /> : live && pay.amount > 0 ? <StatusChip s={PAY_STATE[pay.state]} /> : null}
      {extra}
    </span>
  );
}

/** Четыре раздельных состояния заказа. */
export function OrderChips({ o, pay, delivery, compact, approval, rep }: { o: Order; pay: OrderPayment; delivery?: Delivery; compact?: boolean; approval?: boolean; rep?: boolean }) {
  const live = o.state === 'confirmed' || o.state === 'closed';
  const overdue = shownOverdue(o, pay, delivery);
  return (
    <span className={cx('chips', compact && 'sales-chips-compact')}>
      <StatusChip s={o.state === 'request' && approval ? APPROVAL_STATUS : o.state === 'request' && rep ? WAITS_MANAGER : ORDER_STATE[o.state]} />
      {live ? <StatusChip s={PICK_STATE[o.pick]} /> : null}
      {live ? <StatusChip s={shipStatus(o, delivery)} /> : null}
      {live && pay.amount > 0 ? <StatusChip s={PAY_STATE[pay.state]} /> : null}
      {overdue > 0 ? <StatusChip s={overdueStatus(overdue)} /> : null}
    </span>
  );
}

/** Цена за штуку: итоговая, ниже зачёркнутая старая, если была скидка или акция. */
export function PriceCell({ price, base }: { price: number; base: number }) {
  return (
    <span className="sales-price">
      <span>{fmt.price(price)}</span>
      {price < base ? <s className="faint t-12">{fmt.price(base)}</s> : null}
    </span>
  );
}

export function Dash() {
  return <span className="faint">—</span>;
}

export type PromoState = keyof typeof PROMO_STATE;

/** Состояние акции на дату: те же слова, что в разделе «Товары». */
export function promoStateOf(pr: Promo, today: string): PromoState {
  if (!pr.active) return 'off';
  if (pr.start > today) return 'future';
  if (pr.end < today) return 'ended';
  return 'active';
}

/** Подсказка к цене по акции: «Осенняя стирка · действует до 15 ноября». */
export function promoTitle(pr: Promo, today: string): string {
  const st = promoStateOf(pr, today);
  const when = st === 'future' ? `с ${fmt.date(pr.start)}` : st === 'active' ? `до ${fmt.date(pr.end)}` : `${fmt.date(pr.start)} — ${fmt.date(pr.end)}`;
  return `${pr.name} · ${PROMO_STATE[st].label.toLowerCase()} ${when}`;
}

/** Чип цены по акции «Акция −10 %»: цвет — по состоянию акции, название и срок — в подсказке. */
export function PromoChip({ promo, pct, today, short }: { promo: Promo | null | undefined; pct?: number; today?: string; short?: boolean }) {
  const text = pct ? (short ? `−${fmt.pct(pct, 0)}` : `Акция −${fmt.pct(pct, 0)}`) : 'Акция';
  if (!promo || !today) return <Chip tone={PROMO_STATE.active.tone}>{text}</Chip>;
  return (
    <Chip tone={PROMO_STATE[promoStateOf(promo, today)].tone} title={promoTitle(promo, today)}>
      {text}
    </Chip>
  );
}

/** Состояние акции чипом: «Действует», «Закончилась»… */
export function PromoStateChip({ promo, today }: { promo: Promo; today: string }) {
  return <StatusChip s={PROMO_STATE[promoStateOf(promo, today)]} />;
}

/** Чип «Акция −5 %», «Скидка −3 %» */
export function DiscountChip({ promoPct, manualPct, promo, today }: { promoPct: number; manualPct: number; promo?: Promo | null; today?: string }) {
  if (manualPct > 0) return <Chip tone="info">Скидка −{fmt.pct(manualPct)}</Chip>;
  if (promoPct > 0) return <PromoChip promo={promo} pct={promoPct} today={today} />;
  return <Dash />;
}
