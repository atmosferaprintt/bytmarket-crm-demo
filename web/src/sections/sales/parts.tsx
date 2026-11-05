/* Детали раздела «Продажи», которые нужны в нескольких экранах. */
import type { ReactNode } from 'react';
import type { Client, Order } from '../../data/types';
import type { ClientBalance, OrderPayment } from '../../data/selectors';
import { Chip, PAY_STATE, PICK_STATE, ORDER_STATE, SHIP_STATE, StatusChip, cx, fmt, overdueStatus } from '../../ui';

/** Полоса условий клиента: цены, отсрочка, лимит, долг, просрочка и срок оплаты. */
export function ConditionsStrip({ client, balance, dueLabel }: { client: Client; balance: ClientBalance; dueLabel: ReactNode }) {
  return (
    <div className="sales-cond">
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
    <div className="sales-limit">
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

/** Четыре раздельных состояния заказа. */
export function OrderChips({ o, pay, compact }: { o: Order; pay: OrderPayment; compact?: boolean }) {
  const live = o.state === 'confirmed' || o.state === 'closed';
  return (
    <span className={cx('chips', compact && 'sales-chips-compact')}>
      <StatusChip s={ORDER_STATE[o.state]} />
      {live ? <StatusChip s={PICK_STATE[o.pick]} /> : null}
      {live ? <StatusChip s={SHIP_STATE[o.ship]} /> : null}
      {live && pay.amount > 0 ? <StatusChip s={PAY_STATE[pay.state]} /> : null}
      {pay.overdueDays > 0 ? <StatusChip s={overdueStatus(pay.overdueDays)} /> : null}
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

/** Чип «Акция −5 %», «Скидка −3 %» */
export function DiscountChip({ promoPct, manualPct }: { promoPct: number; manualPct: number }) {
  if (manualPct > 0) return <Chip tone="info">Скидка −{fmt.pct(manualPct)}</Chip>;
  if (promoPct > 0) return <Chip tone="green">Акция −{fmt.pct(promoPct, 0)}</Chip>;
  return <Dash />;
}
