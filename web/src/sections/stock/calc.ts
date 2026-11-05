/* Расчёты раздела «Склад»: строки остатков, продажи в день, «мало в магазине», сроки, без движения.
   Всё запоминается по версии базы: пока база не менялась, ничего не пересчитывается. */
import type { DB, ID, LocationKey, Pack, PackKey, Product, StockDocKind } from '../../data/types';
import { LOCATION_NAMES } from '../../data/types';
import { indexes, stockIndex, type StockInfo } from '../../data/selectors';
import { diffDays, plusDays } from '../../data/dates';
import { STOCK_LEVEL, fmt, type StatusDef } from '../../ui';
import { EXPIRY_SOON_DAYS, NO_MOVEMENT_DAYS, SALES_WINDOW_DAYS, isBelowMin } from '../../data/thresholds';

export { EXPIRY_SOON_DAYS, NO_MOVEMENT_DAYS };
const SALES_WINDOW = SALES_WINDOW_DAYS;

/* ---------- запоминание по версии базы ---------- */
const cache = new WeakMap<DB, { v: number; m: Map<string, unknown> }>();
export function memoDb<T>(db: DB, key: string, fn: () => T): T {
  let c = cache.get(db);
  if (!c || c.v !== db.meta.version) {
    c = { v: db.meta.version, m: new Map() };
    cache.set(db, c);
  }
  if (c.m.has(key)) return c.m.get(key) as T;
  const v = fn();
  c.m.set(key, v);
  return v;
}

/* ---------- продажи и движение ---------- */
export interface Flow {
  perDay: number; // всего продаётся в день (касса + опт)
  shopPerDay: number; // продаётся в день с магазина
  lastSale: string | null; // дата последней продажи или отгрузки
}

export function flows(db: DB): Map<ID, Flow> {
  return memoDb(db, 'flows', () => {
    const today = db.meta.today;
    const from = plusDays(today, -SALES_WINDOW);
    const span = Math.max(1, Math.min(SALES_WINDOW, diffDays(db.meta.startDate, today)));
    const sold = new Map<ID, { all: number; shop: number; last: string | null }>();
    for (const m of db.movements) {
      if (m.kind !== 'sale' && m.kind !== 'ship') continue;
      let x = sold.get(m.productId);
      if (!x) {
        x = { all: 0, shop: 0, last: null };
        sold.set(m.productId, x);
      }
      const day = m.at.slice(0, 10);
      if (m.dOnHand < 0 && (x.last === null || day > x.last)) x.last = day;
      if (day >= from && day <= today) {
        x.all -= m.dOnHand;
        if (m.location === 'shop') x.shop -= m.dOnHand;
      }
    }
    const out = new Map<ID, Flow>();
    for (const [pid, x] of sold) out.set(pid, { perDay: Math.max(0, x.all) / span, shopPerDay: Math.max(0, x.shop) / span, lastSale: x.last });
    return out;
  });
}

/* ---------- упаковки ---------- */
export function packOf(p: Product, key: PackKey): Pack {
  return p.packs.find((x) => x.key === key) ?? p.packs[0];
}
/** Единица перемещения в магазин: упаковка, иначе коробка, иначе штука. */
export function movePack(p: Product): Pack {
  return p.packs.find((x) => x.key === 'pack') ?? p.packs.find((x) => x.key === 'box') ?? p.packs[0];
}
export function boxPack(p: Product): Pack {
  return p.packs.find((x) => x.key === 'box') ?? p.packs.find((x) => x.key === 'pack') ?? p.packs[0];
}
export function packLabel(pk: Pack): string {
  if (pk.key === 'pcs') return 'шт';
  return pk.key === 'box' ? `кор. ${pk.qty} шт` : `уп. ${pk.qty} шт`;
}
/** «3 кор. по 12» / «36 шт» */
export function packQtyText(pk: Pack, packQty: number): string {
  if (pk.key === 'pcs' || pk.qty === 1) return fmt.qty(packQty);
  return `${fmt.num(packQty)} ${pk.key === 'box' ? 'кор.' : 'уп.'} по ${pk.qty}`;
}
/** Штуки словами упаковок: «2 кор. + 5 шт» */
export function inBoxes(p: Product, qty: number): string | null {
  const b = boxPack(p);
  if (b.qty <= 1 || qty < b.qty) return null;
  const n = Math.floor(qty / b.qty);
  const rest = qty - n * b.qty;
  return `${fmt.num(n)} ${b.key === 'box' ? 'кор.' : 'уп.'}${rest ? ` + ${fmt.num(rest)} шт` : ''}`;
}

/* ---------- строка остатков ---------- */
/* Одна строка на товар — общая для «Склада» и «Товаров», чтобы «Доступно», «Ниже минимума»,
   «Без движения» и чип статуса совпадали на всех экранах.
   Доступно = магазин + склад − резерв. Для опта — склад − резерв. */
export type StockFlag = 'low' | 'out' | 'expiring' | 'reserved' | 'expected' | 'quarantine' | 'stale' | 'shopLow' | 'inactive';

export interface StockLine {
  id: ID;
  p: Product;
  brand: string;
  categoryId: ID;
  info: StockInfo;
  flow: Flow | undefined;
  /** доступно всего: магазин + склад − резерв */
  available: number;
  /** на складе для опта: склад − резерв */
  whAvailable: number;
  shopMin: number;
  cost: number | null;
  value: number | null; // факт × закупочная цена
  expDays: number | null;
  staleDays: number | null;
  flags: Set<StockFlag>;
  /** чип только для исключений; обычное «в наличии» — null */
  status: StatusDef | null;
  /** подсказка к чипу */
  statusTitle: string | undefined;
  search: string;
  /** сколько предлагаем переместить в магазин, если там мало */
  shopMove: { pack: Pack; packQty: number; qty: number } | null;
}

/** Сколько держим на полке магазина: два дня продаж с магазина, но не меньше 2 шт и 10 % общего минимума. */
export function shopMinOf(p: Product, f: Flow | undefined): number {
  return Math.max(2, Math.ceil((f?.shopPerDay ?? 0) * 2), Math.ceil(p.minStock * 0.1));
}

function shopMoveOf(p: Product, info: StockInfo, f: Flow | undefined, shopMin: number): StockLine['shopMove'] {
  const target = Math.max(shopMin * 2, Math.ceil((f?.shopPerDay ?? 0) * 7));
  const need = target - info.shop.available;
  const free = info.warehouse.available;
  if (need <= 0 || free <= 0) return null;
  const pk = movePack(p);
  if (pk.qty > 1) {
    let n = Math.ceil(need / pk.qty);
    if (n * pk.qty > free) n = Math.floor(free / pk.qty);
    if (n > 0) return { pack: pk, packQty: n, qty: n * pk.qty };
  }
  const q = Math.min(need, free);
  return { pack: p.packs[0], packQty: q, qty: q };
}

const days = (n: number) => fmt.count(n, 'день', 'дня', 'дней');

export function stockLines(db: DB): StockLine[] {
  return memoDb(db, 'stockLines', () => {
    const si = stockIndex(db);
    const fl = flows(db);
    const ix = indexes(db);
    const today = db.meta.today;
    const out: StockLine[] = [];
    for (const p of db.products) {
      const info = si.get(p.id)!;
      const f = fl.get(p.id);
      const shopMin = shopMinOf(p, f);
      const flags = new Set<StockFlag>();
      const t = info.total;
      const available = t.available;
      const whAvailable = info.warehouse.available;
      const expDays = info.nearestExpiry ? diffDays(today, info.nearestExpiry) : null;
      // без движения: с последней продажи или отгрузки; если их не было — с появления товара в учёте
      const since = f?.lastSale ?? (p.createdAt > db.meta.startDate ? p.createdAt : db.meta.startDate);
      const staleDays = p.active && t.onHand > 0 ? diffDays(since, today) : null;
      if (!p.active) flags.add('inactive');
      if (p.active && isBelowMin(available, p.minStock)) flags.add('low');
      if (p.active && available <= 0) flags.add('out');
      if (expDays !== null && expDays <= EXPIRY_SOON_DAYS && t.onHand > 0) flags.add('expiring');
      if (t.reserved > 0) flags.add('reserved');
      if (info.expected > 0) flags.add('expected');
      if (info.quarantine > 0) flags.add('quarantine');
      if (staleDays !== null && staleDays >= NO_MOVEMENT_DAYS) flags.add('stale');
      const shopLow = p.active && info.shop.available < shopMin && info.warehouse.available > 0;
      if (shopLow) flags.add('shopLow');
      let status: StatusDef | null = null;
      let statusTitle: string | undefined;
      if (!p.active) status = STOCK_LEVEL.inactive;
      else if (flags.has('out')) {
        status = STOCK_LEVEL.out;
        statusTitle = t.onHand > 0 ? `Всё в резерве под заказы: ${fmt.qty(t.reserved)}` : 'Нет ни в магазине, ни на складе';
      } else if (flags.has('expiring') && expDays !== null && expDays < 0) {
        status = { label: 'Срок истёк', tone: 'bad' };
        statusTitle = `Годен до ${fmt.date(info.nearestExpiry)}`;
      } else if (flags.has('low')) {
        status = STOCK_LEVEL.low;
        statusTitle = `Доступно ${fmt.qty(available)} при минимуме ${fmt.qty(p.minStock)}`;
      } else if (flags.has('expiring') && expDays !== null) {
        status = { label: `Срок до ${fmt.dateShort(info.nearestExpiry)}`, tone: 'warn' };
        statusTitle = `Ближайшая партия годна до ${fmt.date(info.nearestExpiry)}`;
      } else if (shopLow) {
        status = { label: 'Мало в магазине', tone: 'warn' };
        statusTitle = `В магазине ${fmt.qty(info.shop.available)}, держим от ${fmt.qty(shopMin)}. На складе есть`;
      } else if (flags.has('stale') && staleDays !== null) {
        status = { label: 'Без движения', tone: 'neutral' };
        statusTitle = `Нет продаж и отгрузок ${days(staleDays)}`;
      }
      const brand = ix.brands.get(p.brandId)?.name ?? '';
      out.push({
        id: p.id,
        p,
        brand,
        categoryId: p.categoryId,
        info,
        flow: f,
        available,
        whAvailable,
        shopMin,
        cost: p.cost,
        value: p.cost === null ? null : t.onHand * p.cost,
        expDays,
        staleDays,
        flags,
        status,
        statusTitle,
        search: [p.name, p.sku, brand, ...p.packs.map((x) => x.barcode)].join(' '),
        shopMove: shopLow ? shopMoveOf(p, info, f, shopMin) : null,
      });
    }
    return out;
  });
}

/** Строка остатков по id товара. */
export function stockLineOf(db: DB, id: ID): StockLine | undefined {
  return memoDb(db, 'stockLineIndex', () => {
    const m = new Map<ID, StockLine>();
    for (const l of stockLines(db)) m.set(l.id, l);
    return m;
  }).get(id);
}

/** Сколько товаров ниже минимума — то же число, что в меню и в «Товарах». */
export function belowMinCount(db: DB): number {
  return memoDb(db, 'belowMinCount', () => stockLines(db).filter((l) => l.flags.has('low')).length);
}

/* ---------- штрихкоды и поиск товара ---------- */
export function barcodeIndex(db: DB): Map<string, { p: Product; pack: Pack }> {
  return memoDb(db, 'barcodes', () => {
    const m = new Map<string, { p: Product; pack: Pack }>();
    for (const p of db.products) for (const pk of p.packs) if (pk.barcode) m.set(pk.barcode, { p, pack: pk });
    return m;
  });
}

export function productSearchIndex(db: DB): { p: Product; text: string }[] {
  return memoDb(db, 'productSearch', () => {
    const ix = indexes(db);
    return db.products.map((p) => ({ p, text: norm([p.name, p.sku, ix.brands.get(p.brandId)?.name ?? '', ...p.packs.map((x) => x.barcode)].join(' ')) }));
  });
}

export const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');

/* ---------- категории ---------- */
export function categoryOptions(db: DB): { value: string; label: string }[] {
  return memoDb(db, 'catOptions', () => {
    const top = db.categories.filter((c) => c.parentId === null);
    const res: { value: string; label: string }[] = [];
    for (const c of top) {
      res.push({ value: c.id, label: c.name });
      for (const s of db.categories) if (s.parentId === c.id) res.push({ value: s.id, label: `${c.name} · ${s.name.charAt(0).toLowerCase()}${s.name.slice(1)}` });
    }
    return res;
  });
}

/* ---------- документы ---------- */
export const DOC_KIND_NAMES: Record<StockDocKind | 'receive', string> = {
  initial: 'Начальные остатки',
  income: 'Приход',
  transfer: 'Перемещение',
  writeoff: 'Списание',
  count: 'Пересчёт',
  receive: 'Приёмка',
};

export const placeName = (l: LocationKey | null | undefined): string => (l ? LOCATION_NAMES[l] : '—');
export const LOCATION_OPTIONS = [
  { value: 'warehouse', label: 'Склад' },
  { value: 'shop', label: 'Магазин' },
];

/** Короткое имя товара для подсказок: «Fairy Лимон, 450 мл» */
export function shortName(p: Product): string {
  const i = p.name.indexOf(',');
  const j = p.name.lastIndexOf(',');
  if (i > 0 && j > i) return p.name.slice(0, i) + p.name.slice(j);
  return p.name;
}

/** Первая буква заглавная. */
export const cap = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
