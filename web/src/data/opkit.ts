/* Общие детали операций: ошибка, роли, номера документов, журнал,
   единственная функция изменения остатков и расчёт цены строки. */
import type {
  AuditEntry,
  DB,
  Employee,
  ID,
  ISODate,
  ISODateTime,
  LocationKey,
  Movement,
  MovementKind,
  PackKey,
  PriceType,
  Product,
  RoleKey,
} from './types';
import { get, stockRow } from './idx';
import { priceFor } from './selectors';
import { dateOf, plusDays } from './dates';
import { pct, pcs, rub } from './text';

/* ---------- ошибка и контекст ---------- */

export class OpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpError';
  }
}

export interface OpCtx {
  actorId: ID;
  at: ISODateTime;
}

export interface OpResult {
  id?: ID;
  info?: string;
}

export function fail(message: string): never {
  throw new OpError(message);
}

/* ---------- проверки ввода ---------- */

export function obj(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('Неверные данные операции');
  return payload as Record<string, unknown>;
}

export function posInt(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v <= 0) fail(`${label}: нужно целое число больше нуля`);
  return v;
}

export function nonNegInt(v: unknown, label: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) fail(`${label}: нужно целое число не меньше нуля`);
  return v;
}

export function text(v: unknown, label: string, required = true): string {
  if (v === undefined || v === null) {
    if (required) fail(`Заполните поле «${label}»`);
    return '';
  }
  if (typeof v !== 'string') fail(`Поле «${label}» заполнено неверно`);
  const s = v.trim();
  if (required && !s) fail(`Заполните поле «${label}»`);
  if (s.length > 2000) fail(`Поле «${label}» слишком длинное`);
  return s;
}

export function isoDate(v: unknown, label: string): ISODate {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) fail(`${label}: укажите дату`);
  return v;
}

export function oneOf<T extends string>(v: unknown, allowed: readonly T[], label: string): T {
  if (typeof v !== 'string' || !allowed.includes(v as T)) fail(`${label}: неверное значение`);
  return v as T;
}

export function arr(v: unknown, label: string, min = 1, max = 500): unknown[] {
  if (!Array.isArray(v)) fail(`${label}: нужен список`);
  if (v.length < min) fail(min === 1 ? `Добавьте хотя бы одну строку: ${label.toLowerCase()}` : `${label}: слишком мало строк`);
  if (v.length > max) fail(`${label}: не больше ${max} строк`);
  return v;
}

export const LOCATIONS: readonly LocationKey[] = ['shop', 'warehouse'];
export const locIn = (l: LocationKey): string => (l === 'shop' ? 'в магазине' : 'на складе');
export const locFrom = (l: LocationKey): string => (l === 'shop' ? 'из магазина' : 'со склада');

/* ---------- роли ---------- */

export const ROLE_NAMES: Record<RoleKey, string> = {
  owner: 'Владелец',
  seller: 'Продавец',
  manager: 'Менеджер',
  rep: 'Представитель',
  accountant: 'Бухгалтер',
  warehouse: 'Склад',
  dispatcher: 'Диспетчер',
  courier: 'Курьер',
};

export function actor(db: DB, ctx: OpCtx): Employee {
  const e = get(db, 'employees', ctx.actorId);
  if (!e) fail('Сотрудник не найден');
  if (!e.active) fail(`${e.name} не работает в магазине — действие недоступно`);
  return e;
}

export function hasRole(db: DB, employeeId: ID | null | undefined, ...roles: RoleKey[]): boolean {
  const e = get(db, 'employees', employeeId);
  return !!e && e.roles.some((r) => roles.includes(r));
}

/** Владелец может всё. Остальным — по списку ролей. */
export function requireRole(db: DB, ctx: OpCtx, roles: RoleKey[], what: string): Employee {
  const e = actor(db, ctx);
  if (e.roles.includes('owner') || e.roles.some((r) => roles.includes(r))) return e;
  fail(`Действие «${what}» недоступно для роли «${ROLE_NAMES[e.roles[0]]}»`);
}

export function discountLimit(db: DB, employeeId: ID): number {
  const e = get(db, 'employees', employeeId);
  if (!e) return 0;
  let m = 0;
  for (const r of e.roles) m = Math.max(m, db.settings.discountLimits[r] ?? 0);
  return m;
}

/* ---------- номера, id, журнал ---------- */

export function nextNo(db: DB, key: string): number {
  const n = (db.counters[key] ?? 0) + 1;
  db.counters[key] = n;
  return n;
}

export function nextId(db: DB, key: string, prefix: string): ID {
  return prefix + nextNo(db, key);
}

export function audit(db: DB, ctx: OpCtx, entity: AuditEntry['entity'], entityId: ID, txt: string): void {
  db.audit.push({ id: nextId(db, 'audit', 'a-'), at: ctx.at, actorId: ctx.actorId, entity, entityId, text: txt });
}

export const dayOf = (ctx: OpCtx): ISODate => dateOf(ctx.at);

/* ---------- товары ---------- */

export function product(db: DB, id: unknown): Product {
  const p = typeof id === 'string' ? get(db, 'products', id) : undefined;
  if (!p) fail('Товар не найден');
  return p;
}

/** Короткое имя для сообщений: без описания вида товара. */
/** «Fairy Лимон, средство для посуды, 450 мл» → «Fairy Лимон, 450 мл». Делим по «, » с пробелом, чтобы не резать «1,3 л». */
export function shortName(p: Product): string {
  const parts = p.name.split(', ');
  if (parts.length >= 3) return `${parts[0]}, ${parts[parts.length - 1]}`;
  return p.name;
}

export function available(db: DB, productId: ID, location: LocationKey): number {
  const r = stockRow(db, productId, location);
  return r ? r.onHand - r.reserved : 0;
}

/* ---------- изменение остатков: единственная точка ---------- */

export interface StockDelta {
  productId: ID;
  location: LocationKey;
  dOnHand: number;
  dReserved: number;
  kind: MovementKind;
  docType: Movement['docType'];
  docId: ID;
  expiry?: ISODate; // для прихода товара со сроком годности
}

/** Проверить и провести изменения остатков одним блоком. Не даёт факту и резерву уйти в минус
    и резерву превысить факт (кроме пересчёта: allowReserveOverOnHand). Каждое изменение — движение. */
export function commitStock(db: DB, deltas: StockDelta[], ctx: OpCtx, opts: { allowReserveOverOnHand?: boolean } = {}): void {
  const agg = new Map<string, { productId: ID; location: LocationKey; on: number; res: number }>();
  for (const d of deltas) {
    if (!Number.isInteger(d.dOnHand) || !Number.isInteger(d.dReserved)) fail('Количество должно быть целым');
    const k = d.productId + '|' + d.location;
    const a = agg.get(k) ?? { productId: d.productId, location: d.location, on: 0, res: 0 };
    a.on += d.dOnHand;
    a.res += d.dReserved;
    agg.set(k, a);
  }
  for (const a of agg.values()) {
    const p = product(db, a.productId);
    const row = stockRow(db, a.productId, a.location);
    const on0 = row?.onHand ?? 0;
    const res0 = row?.reserved ?? 0;
    const on1 = on0 + a.on;
    const res1 = res0 + a.res;
    if (on1 < 0) fail(`${shortName(p)}: ${locIn(a.location)} ${pcs(on0)}, а нужно ${pcs(-a.on)}`);
    if (res1 < 0) fail(`${shortName(p)}: в резерве ${pcs(res0)}, а снять нужно ${pcs(-a.res)}`);
    if (!opts.allowReserveOverOnHand && res1 - on1 > Math.max(0, res0 - on0)) {
      fail(`${shortName(p)}: ${locIn(a.location)} доступно ${pcs(on0 - res0)}, а нужно ${pcs(a.res - a.on)}`);
    }
  }
  const moved = new Map<string, { expiry: ISODate; qty: number }[]>();
  for (const d of deltas) {
    if (d.dOnHand === 0 && d.dReserved === 0) continue;
    const row = stockRow(db, d.productId, d.location, true);
    row.onHand += d.dOnHand;
    row.reserved += d.dReserved;
    db.movements.push({
      id: nextId(db, 'movement', 'm-'),
      at: ctx.at,
      productId: d.productId,
      location: d.location,
      dOnHand: d.dOnHand,
      dReserved: d.dReserved,
      kind: d.kind,
      docType: d.docType,
      docId: d.docId,
      authorId: ctx.actorId,
    });
    if (d.dOnHand !== 0) {
      const p = get(db, 'products', d.productId);
      if (p?.expiryTracked) moveBatches(db, d, ctx, moved);
    }
  }
}

/** Партии со сроком годности: расход — с ближайшего срока, приход — новой партией,
    перемещение — те же сроки на новом месте. Сумма партий равна факту. */
function moveBatches(db: DB, d: StockDelta, ctx: OpCtx, moved: Map<string, { expiry: ISODate; qty: number }[]>): void {
  const mine = db.batches.filter((b) => b.productId === d.productId && b.location === d.location);
  if (d.dOnHand < 0) {
    let left = -d.dOnHand;
    mine.sort((a, b) => (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0));
    const parts: { expiry: ISODate; qty: number }[] = [];
    for (const b of mine) {
      if (left <= 0) break;
      const take = Math.min(b.qty, left);
      b.qty -= take;
      left -= take;
      parts.push({ expiry: b.expiry, qty: take });
    }
    if (d.kind === 'transfer_out') moved.set(d.productId, parts);
    for (let i = db.batches.length - 1; i >= 0; i--) if (db.batches[i].qty <= 0) db.batches.splice(i, 1);
    return;
  }
  const addTo = (expiry: ISODate, qty: number): void => {
    const same = mine.find((b) => b.expiry === expiry);
    if (same) same.qty += qty;
    else {
      const b = { id: nextId(db, 'batch', 'b-'), productId: d.productId, location: d.location, qty, expiry, receivedAt: dayOf(ctx) };
      db.batches.push(b);
      mine.push(b);
    }
  };
  if (d.expiry) return addTo(d.expiry, d.dOnHand);
  const parts = d.kind === 'transfer_in' ? moved.get(d.productId) : undefined;
  if (parts && parts.length) {
    let left = d.dOnHand;
    for (const part of parts) {
      const q = Math.min(part.qty, left);
      if (q > 0) addTo(part.expiry, q);
      left -= q;
    }
    if (left > 0) addTo(latestExpiry(db, d.productId) ?? plusDays(dayOf(ctx), 365), left);
    return;
  }
  const last = mine.reduce<ISODate | null>((m, b) => (m === null || b.expiry > m ? b.expiry : m), null);
  addTo(last ?? latestExpiry(db, d.productId) ?? plusDays(dayOf(ctx), 365), d.dOnHand);
}

function latestExpiry(db: DB, productId: ID): ISODate | null {
  let m: ISODate | null = null;
  for (const b of db.batches) if (b.productId === productId && (m === null || b.expiry > m)) m = b.expiry;
  return m;
}

/* ---------- цена строки ---------- */

export interface LineInput {
  productId: ID;
  pack: PackKey;
  packQty: number;
  discountPct: number;
  discountReason: string | null;
}

export interface PricedLine {
  productId: ID;
  pack: PackKey;
  packSize: number;
  packQty: number;
  qty: number;
  basePrice: number;
  price: number;
  promoId: ID | null;
  discountPct: number;
  discountReason: string | null;
  cost: number | null;
}

export function parseLines(raw: unknown, label: string): LineInput[] {
  return arr(raw, label, 1, 300).map((x) => {
    const l = obj(x);
    const pack = (l.pack ?? 'pcs') as PackKey;
    if (pack !== 'pcs' && pack !== 'pack' && pack !== 'box') fail('Неизвестная упаковка');
    const d = l.discountPct ?? 0;
    if (typeof d !== 'number' || !Number.isFinite(d) || d < 0 || d > 100) fail('Скидка: от 0 до 100 %');
    return {
      productId: String(l.productId ?? ''),
      pack,
      packQty: posInt(l.packQty, 'Количество'),
      discountPct: Math.round(d * 10) / 10,
      discountReason: typeof l.discountReason === 'string' && l.discountReason.trim() ? l.discountReason.trim() : null,
    };
  });
}

/** Цена строки: меньшая из цены клиента и акции, затем ручная скидка в пределах роли и наценки. */
export function priceLines(db: DB, inputs: LineInput[], priceType: PriceType, ctx: OpCtx): { lines: PricedLine[]; info: string[] } {
  const limit = discountLimit(db, ctx.actorId);
  const isOwner = hasRole(db, ctx.actorId, 'owner');
  const roleName = ROLE_NAMES[get(db, 'employees', ctx.actorId)?.roles[0] ?? 'seller'];
  const minMargin = db.settings.minMarginPct;
  const info: string[] = [];
  const lines = inputs.map((l) => {
    const p = product(db, l.productId);
    if (!p.active) fail(`${shortName(p)} снят с продажи`);
    const pk = p.packs.find((x) => x.key === l.pack);
    if (!pk) fail(`${shortName(p)}: нет упаковки «${l.pack === 'box' ? 'коробка' : l.pack === 'pack' ? 'упаковка' : 'штука'}»`);
    const pr = priceFor(db, p.id, { priceType, date: dayOf(ctx) });
    let price = pr.price;
    if (l.discountPct > 0) {
      if (!l.discountReason) fail(`Укажите основание скидки: ${shortName(p)}`);
      if (l.discountPct > limit) fail(`Скидка ${pct(l.discountPct)} больше лимита роли «${roleName}» — ${pct(limit)}`);
      price = Math.round((pr.price * (100 - l.discountPct)) / 100);
      const floor = Math.round((pr.base * (100 - limit)) / 100);
      if (price < floor) {
        const total = ((pr.base - price) / pr.base) * 100;
        fail(`${shortName(p)}: скидка вместе с акцией ${pct(total)} — больше лимита роли «${roleName}» ${pct(limit)}`);
      }
      if (p.cost !== null) {
        const minPrice = Math.ceil((p.cost * (100 + minMargin)) / 100);
        if (price < minPrice) {
          if (!isOwner) fail(`Цена ниже минимальной наценки: ${shortName(p)} — ${rub(price)}, минимум ${rub(minPrice)}`);
          info.push(`Цена ниже минимальной наценки — разрешено владельцем: ${shortName(p)}`);
        }
      }
    }
    return {
      productId: p.id,
      pack: l.pack,
      packSize: pk.qty,
      packQty: l.packQty,
      qty: l.packQty * pk.qty,
      basePrice: pr.base,
      price,
      promoId: pr.promo?.id ?? null,
      discountPct: l.discountPct,
      discountReason: l.discountPct > 0 ? l.discountReason : null,
      cost: p.cost,
    };
  });
  return { lines, info };
}

/** Сумма штук по товарам. */
export function qtyByProduct<T extends { productId: ID; qty: number }>(lines: T[]): Map<ID, number> {
  const m = new Map<ID, number>();
  for (const l of lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
  return m;
}
