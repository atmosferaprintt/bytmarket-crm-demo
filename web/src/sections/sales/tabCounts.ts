/* Счётчики у вкладок раздела: непрочитанные чаты и возвраты, товар по которым ещё на проверке. */
import { useMemo } from 'react';
import type { DB, ID, QuarantineState, Return } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { useScoped } from '../../roles/scope';
import { useSession } from '../../roles/session';
import { useSalesOrders } from './salesScope';

/** Состояние возвращённого товара по каждому возврату: на проверке, в продаже, списан.
    Возврат после неудачной доставки проверяется по записи карантина этой доставки. */
export function returnGoods(db: DB): Map<ID, QuarantineState[]> {
  const byReturn = new Map<ID, QuarantineState[]>();
  const byOrder = new Map<ID, QuarantineState[]>();
  const dOrder = new Map(db.deliveries.map((d) => [d.id, d.orderId]));
  const add = (m: Map<ID, QuarantineState[]>, k: ID, s: QuarantineState) => {
    const a = m.get(k) ?? [];
    if (!a.includes(s)) a.push(s);
    m.set(k, a);
  };
  for (const q of db.quarantine) {
    if (q.source === 'return') add(byReturn, q.sourceId, q.state);
    else if (q.source === 'delivery_failed') {
      const oid = dOrder.get(q.sourceId);
      if (oid) add(byOrder, oid, q.state);
    }
  }
  const out = new Map<ID, QuarantineState[]>();
  for (const r of db.returns) {
    const own = byReturn.get(r.id);
    if (own) out.set(r.id, own);
    else if (r.orderId && r.lines.every((l) => l.reason === 'delivery_failed')) out.set(r.id, byOrder.get(r.orderId) ?? []);
  }
  return out;
}

/** Возвраты, которые видит роль: менеджер — только по своим заказам, владелец и бухгалтер — все. */
export function useScopedReturns(): Return[] {
  const db = useDB();
  const version = useDBVersion();
  const { role } = useSession();
  const orders = useSalesOrders();
  return useMemo(() => {
    if (role !== 'manager' && role !== 'rep') return db.returns;
    const mine = new Set(orders.map((o) => o.id));
    return db.returns.filter((r) => r.source === 'order' && !!r.orderId && mine.has(r.orderId));
  }, [db, version, role, orders]);
}

export function useTabCounts(): Record<string, number | null> {
  const db = useDB();
  const version = useDBVersion();
  const { chats } = useScoped();
  const returns = useScopedReturns();
  return useMemo(() => {
    const unread = chats.reduce((s, c) => s + (c.unread > 0 ? 1 : 0), 0);
    const goods = returnGoods(db);
    const onCheck = returns.filter((r) => goods.get(r.id)?.includes('check')).length;
    return { chats: unread || null, returns: onCheck || null };
  }, [db, version, chats, returns]);
}
