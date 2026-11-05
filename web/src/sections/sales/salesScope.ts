/* Какие заказы видит раздел «Продажи».
   Основа — useScoped(). Менеджеру дополнительно видна общая очередь заявок представителей
   (их подтверждает менеджер, а клиенты закреплены за представителем) и заказы, по которым он сам что-то делал. */
import { useMemo } from 'react';
import type { Order } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { useScoped } from '../../roles/scope';
import { useSession } from '../../roles/session';

export function useSalesOrders(): Order[] {
  const db = useDB();
  const version = useDBVersion();
  const { role, me } = useSession();
  const { orders } = useScoped();
  return useMemo(() => {
    if (role !== 'manager') return orders;
    const have = new Set(orders.map((o) => o.id));
    const reps = new Set(db.employees.filter((e) => e.roles.includes('rep') && !e.roles.includes('manager') && !e.roles.includes('owner')).map((e) => e.id));
    const extra = db.orders.filter((o) => !have.has(o.id) && ((o.state === 'request' && reps.has(o.authorId)) || o.history.some((h) => h.actorId === me.id)));
    return extra.length ? [...orders, ...extra] : orders;
  }, [db, version, role, me.id, orders]);
}
