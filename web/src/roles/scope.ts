/* Чьи данные видно роли. Одно правило «чей клиент»: Client.ownerId.
   Использование: const clients = useScoped().clients; */
import { useMemo } from 'react';
import type { Client, DB, Delivery, Order, Visit, Chat, Receipt, Task } from '../data/types';
import { useDB, useDBVersion } from '../data/store';
import { useSession, type Session } from './session';

export interface Scoped {
  clients: Client[];
  orders: Order[];
  deliveries: Delivery[];
  visits: Visit[];
  chats: Chat[];
  receipts: Receipt[];
  myTasks: Task[];
  /** свой ли клиент (для подсказок «чужой клиент») */
  isMine: (clientId: string) => boolean;
}

export function scopeFor(db: DB, s: Pick<Session, 'me' | 'role' | 'can'>): Scoped {
  const meId = s.me.id;
  const own = s.role === 'manager' || s.role === 'rep';
  const ownClientIds = new Set(db.clients.filter((c) => c.ownerId === meId).map((c) => c.id));

  let clients = db.clients;
  if (own) clients = db.clients.filter((c) => ownClientIds.has(c.id));
  else if (s.role === 'seller') clients = db.clients.filter((c) => c.segment === 'retail');
  else if (s.role === 'courier' || s.role === 'dispatcher' || s.role === 'warehouse') {
    clients = db.clients; // видят только через доставки/заказы; разделы «Клиенты» им закрыты
  }

  let orders = db.orders;
  if (s.role === 'rep') orders = db.orders.filter((o) => o.ownerId === meId || ownClientIds.has(o.clientId));
  else if (s.role === 'manager') {
    // менеджер подтверждает заявки представителей, поэтому видит их все, плюс свои заказы и оформленные им
    const repIds = new Set(db.employees.filter((e) => e.roles[0] === 'rep').map((e) => e.id));
    orders = db.orders.filter(
      (o) => o.ownerId === meId || o.authorId === meId || ownClientIds.has(o.clientId) || (o.state === 'request' && (repIds.has(o.authorId) || (o.ownerId !== null && repIds.has(o.ownerId)))),
    );
  }

  let deliveries = db.deliveries;
  if (s.role === 'courier') deliveries = db.deliveries.filter((d) => d.courierId === meId);
  else if (own) {
    const ids = new Set(orders.map((o) => o.id));
    deliveries = db.deliveries.filter((d) => ids.has(d.orderId));
  }

  let visits = db.visits;
  if (s.role === 'rep') visits = db.visits.filter((v) => v.repId === meId);

  let chats = db.chats;
  if (own) chats = db.chats.filter((c) => ownClientIds.has(c.clientId) || c.ownerId === meId);

  let receipts = db.receipts;
  if (s.role === 'seller') receipts = db.receipts.filter((r) => r.sellerId === meId);

  const myTasks = db.tasks.filter((t) => t.assigneeId === meId);

  return {
    clients,
    orders,
    deliveries,
    visits,
    chats,
    receipts,
    myTasks,
    isMine: (clientId) => !own || ownClientIds.has(clientId),
  };
}

/** Данные в границах роли текущего сотрудника. */
export function useScoped(): Scoped {
  const db = useDB();
  const version = useDBVersion();
  const s = useSession();
  return useMemo(() => scopeFor(db, s), [db, version, s.me.id, s.role]);
}
