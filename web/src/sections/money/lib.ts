/* Деньги: общие расчёты и слова раздела. Только чтение базы; изменения — через dispatch. */
import { useCallback } from 'react';
import type { AccountKey, DB, ID, ISODate, Order, Payment, PaymentKind, PayMethod } from '../../data/types';
import { ACCOUNT_NAMES } from '../../data/types';
import { dispatch } from '../../data/store';
import type { OpPayload, OpType } from '../../data/ops';
import { orderPayment, type OrderPayment } from '../../data/selectors';
import { firstOfMonth, lastOfMonth, plusDays, plusMonths, dow } from '../../data/dates';
import { useSession } from '../../roles/session';
import type { Perm } from '../../roles/roles';
import { toast } from '../../ui';

/* ---------- слова ---------- */

export const KIND_LABEL: Record<PaymentKind, string> = {
  client: 'Поступление от покупателя',
  shift: 'Выручка смены',
  supplier: 'Выплата поставщику',
  refund: 'Возврат покупателю',
  expense: 'Расход',
  transfer: 'Перемещение',
};

/** Короткие подписи для фильтров-таблеток. */
export const KIND_SHORT: Record<PaymentKind, string> = {
  client: 'Покупатели',
  shift: 'Смены',
  supplier: 'Поставщикам',
  refund: 'Возвраты',
  expense: 'Расходы',
  transfer: 'Перемещения',
};

export function kindLabel(p: Payment): string {
  if (p.kind === 'transfer' && !p.toAccount) return 'Остаток на начало';
  return KIND_LABEL[p.kind];
}

export const ACC_FROM: Record<AccountKey, string> = {
  shop_cash: 'из кассы магазина',
  courier_cash: 'от курьеров',
  bank: 'с расчётного счёта',
};
export const ACC_TO: Record<AccountKey, string> = {
  shop_cash: 'в кассу магазина',
  courier_cash: 'курьерам',
  bank: 'на расчётный счёт',
};

export const ACCOUNT_KEYS: AccountKey[] = ['shop_cash', 'courier_cash', 'bank'];
export const METHOD_KEYS: PayMethod[] = ['cash', 'card', 'transfer'];

export function defaultAccount(m: PayMethod): AccountKey {
  return m === 'cash' ? 'shop_cash' : 'bank';
}

/** Текст из базы без стрелок: «Касса → Счёт» → «Касса — Счёт». */
export function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\s*(→|->)\s*/g, ' — ');
}

export function transferText(p: Payment): string {
  if (!p.toAccount) return `${ACCOUNT_NAMES[p.account]}: остаток на начало учёта`;
  const base = `${cap(ACC_FROM[p.account])} ${ACC_TO[p.toAccount]}`;
  return base;
}

export function cap(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/* ---------- действия ---------- */

export type RunResult = { ok: true; id?: ID; info?: string } | { ok: false; error: string };

type AnyDispatch = (type: string, payload: unknown, actorId: ID) => { ok: boolean; id?: ID; info?: string; error?: string };

/** Выполнить операцию от имени текущего сотрудника. При успехе — короткое сообщение. */
export function useRun() {
  const { me } = useSession();
  return useCallback(
    <T extends OpType>(type: T, payload: OpPayload<T>, okText?: string): RunResult => {
      let r: ReturnType<AnyDispatch>;
      try {
        r = (dispatch as unknown as AnyDispatch)(type, payload, me.id);
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Не получилось — попробуйте ещё раз' };
      }
      if (!r.ok) return { ok: false, error: r.error ?? 'Не получилось — попробуйте ещё раз' };
      if (okText) toast(r.info ? `${okText}. ${r.info}` : okText);
      return { ok: true, id: r.id, info: r.info };
    },
    [me.id],
  );
}

/** Ключ защиты от повторной отправки: один на открытие окна. */
export function newIdemKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/* ---------- заказы клиента к оплате ---------- */

export interface OpenOrder {
  order: Order;
  op: OrderPayment;
  /** свободно к оплате за отгруженное (долг без ожидающих подтверждения) */
  debtFree: number;
  /** свободно к оплате как предоплата неотгруженного */
  restFree: number;
  free: number;
}

/** Заказы клиента, по которым ещё можно разнести оплату. Порядок: самые старые долги первыми. */
export function openOrdersOf(db: DB, clientId: ID): OpenOrder[] {
  const out: OpenOrder[] = [];
  for (const o of db.orders) {
    if (o.clientId !== clientId) continue;
    if (o.state === 'cancelled' || o.state === 'draft' || o.state === 'request') continue;
    const op = orderPayment(db, o);
    const free = Math.max(0, op.due - op.pending);
    if (free <= 0) continue;
    const debtFree = Math.max(0, Math.min(free, op.debt - op.pending));
    out.push({ order: o, op, debtFree, restFree: free - debtFree, free });
  }
  out.sort((a, b) => {
    const ad = a.debtFree > 0 ? 0 : 1;
    const bd = b.debtFree > 0 ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return (a.order.dueDate ?? '9999').localeCompare(b.order.dueDate ?? '9999') || a.order.number - b.order.number;
  });
  return out;
}

/** Распределение как в операции: сначала выбранный заказ, затем долги по сроку, затем предоплата. */
export function autoSplit(list: OpenOrder[], amount: number, preferId?: ID | null): Record<ID, number> {
  const out: Record<ID, number> = {};
  let left = Math.max(0, Math.floor(amount));
  const rest = new Map(list.map((x) => [x.order.id, { debt: x.debtFree, pre: x.restFree }]));
  const take = (id: ID, v: number) => {
    const q = Math.min(v, left);
    if (q <= 0) return;
    out[id] = (out[id] ?? 0) + q;
    left -= q;
  };
  if (preferId) {
    const r = rest.get(preferId);
    if (r) {
      take(preferId, r.debt + r.pre);
      r.debt = 0;
      r.pre = 0;
    }
  }
  const byDue = list
    .filter((x) => (rest.get(x.order.id)?.debt ?? 0) > 0)
    .sort((a, b) => (a.order.dueDate ?? '9999').localeCompare(b.order.dueDate ?? '9999') || a.order.number - b.order.number);
  for (const x of byDue) take(x.order.id, rest.get(x.order.id)!.debt);
  const byNum = list.filter((x) => (rest.get(x.order.id)?.pre ?? 0) > 0).sort((a, b) => a.order.number - b.order.number);
  for (const x of byNum) take(x.order.id, rest.get(x.order.id)!.pre);
  return out;
}

/* ---------- клиенты: последняя оплата и аванс без заказа ---------- */

export interface ClientPayInfo {
  lastAt: string | null;
  lastAmount: number;
  unallocated: number;
}

export function clientPayInfo(db: DB): Map<ID, ClientPayInfo> {
  const m = new Map<ID, ClientPayInfo>();
  const get = (id: ID) => {
    let x = m.get(id);
    if (!x) {
      x = { lastAt: null, lastAmount: 0, unallocated: 0 };
      m.set(id, x);
    }
    return x;
  };
  for (const p of db.payments) {
    if (!p.clientId || p.status !== 'posted') continue;
    if (p.kind === 'client') {
      const x = get(p.clientId);
      if (!x.lastAt || p.at > x.lastAt) {
        x.lastAt = p.at;
        x.lastAmount = p.amount;
      }
      x.unallocated += p.amount - p.allocations.reduce((s, a) => s + (a.orderId ? a.amount : 0), 0);
    } else if (p.kind === 'refund') {
      const x = get(p.clientId);
      x.unallocated -= p.amount - p.allocations.reduce((s, a) => s + (a.orderId ? a.amount : 0), 0);
    }
  }
  for (const x of m.values()) x.unallocated = Math.max(0, x.unallocated);
  return m;
}

/* ---------- периоды ---------- */

export type PeriodKey = 'today' | 'week' | 'month' | 'prev_month' | 'd30' | 'all';
export const PERIOD_OPTIONS: { value: PeriodKey; label: string }[] = [
  { value: 'today', label: 'Сегодня' },
  { value: 'week', label: 'Эта неделя' },
  { value: 'd30', label: 'Последние 30 дней' },
  { value: 'month', label: 'Этот месяц' },
  { value: 'prev_month', label: 'Прошлый месяц' },
  { value: 'all', label: 'Всё время' },
];

export function periodBounds(key: PeriodKey, today: ISODate, start: ISODate): { from: ISODate; to: ISODate } {
  switch (key) {
    case 'today':
      return { from: today, to: today };
    case 'week':
      return { from: weekStart(today), to: today };
    case 'd30':
      return { from: plusDays(today, -29), to: today };
    case 'month':
      return { from: firstOfMonth(today), to: today };
    case 'prev_month': {
      const p = plusMonths(firstOfMonth(today), -1);
      return { from: p, to: lastOfMonth(p) };
    }
    default:
      return { from: start, to: today };
  }
}

/** Понедельник недели. */
export function weekStart(iso: ISODate): ISODate {
  return plusDays(iso, -((dow(iso) + 6) % 7));
}

export function weekEnd(iso: ISODate): ISODate {
  return plusDays(weekStart(iso), 6);
}

export function deferText(days: number): string {
  return days > 0 ? `${days} дн.` : 'Сразу';
}


/** Права раздела одним местом. */
export function useMoneyPerms() {
  const { can, role } = useSession();
  const c = (p: Perm) => can(p);
  return {
    accept: c('acceptPayment'),
    confirm: c('confirmPayment'),
    expense: c('expenses'),
    supplier: c('paySupplier'),
    refund: c('refundMoney'),
    transfer: role === 'owner' || role === 'accountant',
    export: c('export'),
  };
}


/* ---------- подтверждение перевода ---------- */

export function useConfirmPayment() {
  const run = useRun();
  return (paymentId: ID) => run('payment.confirm', { paymentId }, 'Перевод подтверждён по выписке');
}

