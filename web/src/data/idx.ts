/* Внутренний «живой» индекс по id для операций. Массивы базы только дополняются,
   поэтому индекс досчитывает новые элементы с конца массива при промахе. Если массив
   заменили или укоротили — индекс по этой коллекции строится заново. */
import type { DB, ID, LocationKey, StockRow } from './types';

type Keyed = { id: ID };
export type EntityKey =
  | 'employees'
  | 'categories'
  | 'brands'
  | 'groups'
  | 'products'
  | 'clients'
  | 'promos'
  | 'orders'
  | 'shifts'
  | 'receipts'
  | 'payments'
  | 'suppliers'
  | 'purchases'
  | 'returns'
  | 'deliveries'
  | 'visits'
  | 'tasks'
  | 'chats'
  | 'quarantine'
  | 'stockDocs';

type EntityOf<K extends EntityKey> = DB[K] extends Array<infer T> ? T : never;

interface Part {
  arr: unknown[];
  map: Map<string, unknown>;
  n: number;
}

interface Index {
  parts: Map<string, Part>;
}

const indexes = new WeakMap<DB, Index>();

function idxOf(db: DB): Index {
  let i = indexes.get(db);
  if (!i) {
    i = { parts: new Map() };
    indexes.set(db, i);
  }
  return i;
}

function part(db: DB, name: string, arr: unknown[], keyOf: (x: unknown) => string): Part {
  const idx = idxOf(db);
  let p = idx.parts.get(name);
  if (!p || p.arr !== arr || p.n > arr.length) {
    p = { arr, map: new Map(), n: 0 };
    idx.parts.set(name, p);
  }
  while (p.n < arr.length) {
    const x = arr[p.n++];
    p.map.set(keyOf(x), x);
  }
  return p;
}

const byId = (x: unknown): string => (x as Keyed).id;

/** Сущность по id или undefined. */
export function get<K extends EntityKey>(db: DB, key: K, id: ID | null | undefined): EntityOf<K> | undefined {
  if (id === null || id === undefined) return undefined;
  const arr = db[key] as unknown[];
  const idx = idxOf(db);
  const p0 = idx.parts.get(key);
  if (p0 && p0.arr === arr && p0.n === arr.length) return p0.map.get(id) as EntityOf<K> | undefined;
  return part(db, key, arr, byId).map.get(id) as EntityOf<K> | undefined;
}

/** Убрать элемент из коллекции (редко: снятая доставка). Индекс коллекции сбрасывается. */
export function removeFrom<K extends EntityKey>(db: DB, key: K, item: EntityOf<K>): void {
  const arr = db[key] as unknown[];
  const i = arr.indexOf(item);
  if (i >= 0) arr.splice(i, 1);
  idxOf(db).parts.delete(key);
}

const stockKey = (productId: ID, location: LocationKey): string => productId + '|' + location;

/** Строка остатка «товар × место». create — создать пустую, если её нет. */
export function stockRow(db: DB, productId: ID, location: LocationKey, create: true): StockRow;
export function stockRow(db: DB, productId: ID, location: LocationKey, create?: false): StockRow | undefined;
export function stockRow(db: DB, productId: ID, location: LocationKey, create = false): StockRow | undefined {
  const p = part(db, '#stock', db.stock as unknown[], (x) => stockKey((x as StockRow).productId, (x as StockRow).location));
  let row = p.map.get(stockKey(productId, location)) as StockRow | undefined;
  if (!row && create) {
    row = { productId, location, onHand: 0, reserved: 0 };
    db.stock.push(row);
    p.map.set(stockKey(productId, location), row);
    p.n = db.stock.length;
  }
  return row;
}

/** Поиск по ключу повторной отправки. */
export function byIdempotencyKey(db: DB, key: 'orders' | 'payments' | 'receipts', ik: string): Keyed | undefined {
  const arr = db[key] as unknown[];
  const p = part(db, '#ik-' + key, arr, (x) => {
    const k = (x as { idempotencyKey: string | null }).idempotencyKey;
    return k ? 'k:' + k : 'id:' + (x as Keyed).id;
  });
  return p.map.get('k:' + ik) as Keyed | undefined;
}

/** Поверхностная копия корня базы с переносом индекса — для смены «версии» в React. */
export function cloneRoot(db: DB): DB {
  const copy: DB = { ...db, meta: { ...db.meta } };
  const i = indexes.get(db);
  if (i) indexes.set(copy, i);
  return copy;
}
