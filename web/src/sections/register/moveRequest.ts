/* Просьба складу перенести товар в магазин: задача вида move_to_shop. Закрывается сама, когда склад переносит товар. */
import type { DB, Employee, ID, Product, Task } from '../../data/types';
import { dispatch } from '../../data/store';
import { fmt } from '../../ui';
import { movePack, stockLineOf } from '../stock/calc';
import { cartName } from './lib';

export const MOVE_PREFIX = 'Перенести в магазин';

/** Кому поручить перенос: первый работающий сотрудник склада. */
export function warehouseWorker(db: DB): Employee | undefined {
  return db.employees.find((e) => e.active && e.roles.includes('warehouse'));
}

/** Открытая просьба по этому товару, если уже есть. */
export function openMoveTask(db: DB, productId: ID): Task | undefined {
  return db.tasks.find(
    (t) => t.state === 'open' && t.link?.type === 'product' && t.link.id === productId && (t.kind === 'move_to_shop' || t.title.startsWith(MOVE_PREFIX)),
  );
}

/** Товары, по которым склад уже попросили. */
export function requestedMoves(db: DB): Set<ID> {
  const s = new Set<ID>();
  for (const t of db.tasks)
    if (t.state === 'open' && t.link?.type === 'product' && (t.kind === 'move_to_shop' || t.title.startsWith(MOVE_PREFIX))) s.add(t.link.id);
  return s;
}

/** Сколько просить: то же, что предлагает склад, но не меньше нужного покупателю — целыми упаковками и не больше, чем есть на складе. */
export function moveQty(db: DB, p: Product, want = 0): number {
  const line = stockLineOf(db, p.id);
  const wh = line?.info.warehouse.available ?? 0;
  if (wh <= 0) return 0;
  let q = line?.shopMove?.qty ?? 0;
  if (want > q) {
    const step = movePack(p).qty;
    q = step > 1 ? Math.ceil(want / step) * step : want;
  }
  if (q <= 0) q = Math.max(1, movePack(p).qty);
  return Math.min(wh, q);
}

export type MoveResult = { ok: true; text: string; already?: boolean } | { ok: false; error: string };

export function requestMoveToShop(db: DB, actorId: ID, p: Product, qty: number): MoveResult {
  const ex = openMoveTask(db, p.id);
  if (ex) {
    const who = db.employees.find((e) => e.id === ex.assigneeId);
    return { ok: true, already: true, text: `Склад уже попросили${who ? `: ${who.name}` : ''} — ${cartName(p)}` };
  }
  const w = warehouseWorker(db);
  if (!w) return { ok: false, error: 'На складе сейчас никого нет — передайте просьбу владельцу' };
  if (qty <= 0) return { ok: false, error: `${cartName(p)}: на складе тоже нет` };
  const r = dispatch(
    'task.create',
    {
      title: `${MOVE_PREFIX}: ${p.name} — ${fmt.qty(qty)}`,
      assigneeId: w.id,
      due: db.meta.today,
      priority: 'high',
      link: { type: 'product', id: p.id },
      kind: 'move_to_shop',
    },
    actorId,
  );
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, text: `Попросили склад: ${w.name} перенесёт ${fmt.qty(qty)} — ${cartName(p)}` };
}
