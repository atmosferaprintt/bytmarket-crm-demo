/* Очередь сборки: подтверждённые заказы, которые ещё не отгружены полностью. */
import type { Client, DB, Delivery, ID, Order, OrderLine, Product } from '../../data/types';
import { indexes } from '../../data/selectors';
import { get } from '../../data/idx';
import { memoDb } from './calc';

export interface PickLine {
  line: OrderLine;
  p: Product;
  rest: number; // осталось отгрузить, шт
}

export interface PickItem {
  id: ID;
  o: Order;
  client: Client | undefined;
  delivery: Delivery | undefined;
  lines: PickLine[];
  positions: number;
  qty: number;
  places: number;
  dueDay: string | null; // когда нужно: дата доставки
  forToday: boolean;
  late: boolean;
  search: string;
}

export function pickQueue(db: DB): PickItem[] {
  return memoDb(db, 'pickQueue', () => {
    const ix = indexes(db);
    const today = db.meta.today;
    const out: PickItem[] = [];
    for (const o of db.orders) {
      if (o.state !== 'confirmed') continue;
      const lines: PickLine[] = [];
      for (const l of o.lines) {
        const rest = l.qty - l.shipped;
        const p = ix.products.get(l.productId);
        if (rest > 0 && p) lines.push({ line: l, p, rest });
      }
      if (!lines.length) continue;
      const delivery = o.deliveryId ? get(db, 'deliveries', o.deliveryId) : undefined;
      const qty = lines.reduce((s, x) => s + x.rest, 0);
      const est = lines.reduce((s, x) => s + (x.line.pack === 'box' ? Math.ceil(x.rest / Math.max(1, x.line.packSize)) : Math.ceil(x.rest / 12)), 0);
      const dueDay = o.fulfillment === 'delivery' ? delivery?.date ?? null : null;
      const client = ix.clients.get(o.clientId);
      out.push({
        id: o.id,
        o,
        client,
        delivery,
        lines,
        positions: lines.length,
        qty,
        places: delivery?.places ?? Math.max(1, est),
        dueDay,
        forToday: dueDay !== null && dueDay <= today,
        late: dueDay !== null && dueDay < today,
        search: [`${o.number}`, client?.name ?? '', delivery?.address ?? ''].join(' '),
      });
    }
    out.sort((a, b) => Number(b.forToday) - Number(a.forToday) || (a.dueDay ?? '9999').localeCompare(b.dueDay ?? '9999') || a.o.createdAt.localeCompare(b.o.createdAt));
    return out;
  });
}

export function stockTabCounts(db: DB): { picking: number; quarantine: number } {
  return memoDb(db, 'stockTabCounts', () => ({
    picking: pickQueue(db).filter((x) => x.o.pick !== 'picked').length,
    quarantine: db.quarantine.filter((q) => q.state === 'check').length,
  }));
}
