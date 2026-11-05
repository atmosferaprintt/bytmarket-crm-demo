/* Расчёты раздела «Товары»: строки каталога, продажи и движения по товару, наценка.
   Всё запоминается по версии базы: пока база не менялась, повторно не считается. */
import { useEffect, useState } from 'react';
import type { DB, ID, ISODate, Movement, MovementKind, Pack, PriceType, Product, Promo, RoleKey } from '../../data/types';
import { indexes, priceFor, stockIndex, activePromos, promoApplies, type PriceInfo, type StockInfo } from '../../data/selectors';
import { get } from '../../data/idx';
import { fmt, PROMO_STATE as PROMO_STATE_UI, type StatusDef } from '../../ui';
import { EXPIRY_SOON_DAYS, NO_MOVEMENT_DAYS } from '../../data/thresholds';
import { stockLineOf, type StockLine } from '../stock/calc';

/* ---------- запоминание по версии базы ---------- */

const cache = new WeakMap<DB, { v: number; m: Map<string, unknown> }>();

export function memoDB<T>(db: DB, key: string, fn: () => T): T {
  let c = cache.get(db);
  if (!c || c.v !== db.meta.version) {
    c = { v: db.meta.version, m: new Map() };
    cache.set(db, c);
  }
  if (c.m.has(key)) return c.m.get(key) as T;
  const value = fn();
  c.m.set(key, value);
  return value;
}

/* ---------- пороги: общие для всех разделов ---------- */

/** «Истекает срок»: ближайшая партия истекает в эти дни или уже истекла. */
export const SOON_DAYS = EXPIRY_SOON_DAYS;
/** «Без движения»: товар лежит, а продаж и отгрузок нет столько дней. */
export const IDLE_DAYS = NO_MOVEMENT_DAYS;

/* ---------- кто как смотрит каталог ---------- */

/** Упрощённый вид: цена для покупателя, акция и доступно. */
export type CatalogMode = 'full' | 'seller' | 'sales';

export function catalogMode(role: RoleKey): CatalogMode {
  if (role === 'seller') return 'seller';
  if (role === 'manager' || role === 'rep') return 'sales';
  return 'full';
}

/* ---------- упаковки ---------- */

export const PACK_SHORT = (pk: Pack): string => (pk.key === 'pcs' ? 'шт' : pk.key === 'pack' ? `упак. ${pk.qty}` : `кор. ${pk.qty}`);
export const PACK_NAME: Record<Pack['key'], string> = { pcs: 'Штука', pack: 'Упаковка', box: 'Коробка' };

/** «шт · упак. 6 · кор. 24» */
export function packsText(p: Product): string {
  return p.packs.map(PACK_SHORT).join(' · ');
}

/** Без штуки, она есть всегда: «упак. 6 · кор. 24»; только штучно — «штучно». */
export function packsShort(p: Product): string {
  const big = p.packs.filter((x) => x.key !== 'pcs');
  return big.length ? big.map(PACK_SHORT).join(' · ') : 'штучно';
}

/** Наценка с одним знаком после запятой во всех строках: «30,0 %», «44,8 %». */
export function pct1(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${fmt.num(v, 1)}\u00a0%`;
}

/* ---------- наценка ---------- */

/** Наценка над себестоимостью, %. */
export function markupPct(price: number, cost: number | null): number | null {
  if (cost === null || cost <= 0) return null;
  return ((price - cost) / cost) * 100;
}

/** Самая низкая допустимая цена: себестоимость плюс минимальная наценка. */
export function minAllowedPrice(cost: number | null, minMarginPct: number): number | null {
  if (cost === null) return null;
  return Math.ceil((cost * (100 + minMarginPct)) / 100);
}

/** Цена со скидкой акции от базовой цены. */
export function promoPrice(promo: Pick<Promo, 'kind' | 'value'>, base: number): number {
  const v = promo.kind === 'percent' ? Math.round((base * (100 - promo.value)) / 100) : promo.value;
  return Math.min(base, v);
}

export function promoValueText(promo: Pick<Promo, 'kind' | 'value'>): string {
  return promo.kind === 'percent' ? `−${promo.value} %` : `цена ${promo.value} ₽`;
}

/* ---------- строки каталога ---------- */

export interface CatalogRow {
  p: Product;
  brand: string;
  category: string; // верхняя категория: «Посуда»
  subcategory: string; // «Средства для мытья посуды»
  topCategoryId: ID;
  packs: string;
  stock: StockInfo;
  /** та же строка, что в «Складе»: доступно, флаги, чип статуса */
  line: StockLine;
  /** доступно всего: магазин + склад − резерв */
  available: number;
  /** на складе для опта: склад − резерв */
  whAvailable: number;
  retail: PriceInfo;
  wholesale: PriceInfo;
  promo: Promo | null; // акция для любой цены (розница или опт)
  status: StatusDef | null; // только исключения
  belowMin: boolean;
  out: boolean;
  expirySoon: boolean;
  lastSale: ISODate | null;
  idle: boolean;
  search: string;
}

export function catalogRows(db: DB): CatalogRow[] {
  return memoDB(db, 'catalogRows', () => {
    const ix = indexes(db);
    const si = stockIndex(db);
    const today = db.meta.today;
    const rows: CatalogRow[] = [];
    for (const p of db.products) {
      const cat = ix.categories.get(p.categoryId);
      const top = cat?.parentId ? ix.categories.get(cat.parentId) : cat;
      const brand = ix.brands.get(p.brandId)?.name ?? '';
      const stock = si.get(p.id)!;
      const line = stockLineOf(db, p.id)!;
      const retail = priceFor(db, p.id, { priceType: 'retail', date: today });
      const wholesale = priceFor(db, p.id, { priceType: 'wholesale', date: today });
      rows.push({
        p,
        brand,
        category: top?.name ?? '',
        subcategory: cat?.name ?? '',
        topCategoryId: top?.id ?? p.categoryId,
        packs: packsShort(p),
        stock,
        line,
        available: line.available,
        whAvailable: line.whAvailable,
        retail,
        wholesale,
        promo: retail.promo ?? wholesale.promo,
        status: line.status,
        belowMin: line.flags.has('low'),
        out: line.flags.has('out'),
        expirySoon: line.flags.has('expiring'),
        lastSale: line.flow?.lastSale ?? null,
        idle: line.flags.has('stale'),
        search: [p.name, p.sku, p.variant ?? '', brand, ...p.packs.map((x) => x.barcode)].join(' '),
      });
    }
    return rows;
  });
}

/** Сколько товаров видит роль в каталоге: владелец и склад — все, включая снятые с продажи; остальные — только в продаже.
    Одно число на вкладке «Каталог» и на соседних вкладках. */
export function catalogCount(db: DB, mode: CatalogMode): number {
  return memoDB(db, `catalogCount-${mode}`, () => (mode === 'full' ? db.products.length : db.products.filter((p) => p.active).length));
}

/** Строка каталога по id товара. */
export function catalogRow(db: DB, id: ID): CatalogRow | undefined {
  return memoDB(db, 'catalogRowIndex', () => {
    const m = new Map<ID, CatalogRow>();
    for (const r of catalogRows(db)) m.set(r.p.id, r);
    return m;
  }).get(id);
}

/* ---------- продажи по товару ---------- */

export interface SaleEvt {
  date: ISODate;
  qty: number; // со знаком: возврат — минус
  sum: number;
  clientId: ID | null;
  kind: 'retail' | 'wholesale';
}

export function salesByProduct(db: DB): Map<ID, SaleEvt[]> {
  return memoDB(db, 'salesByProduct', () => {
    const m = new Map<ID, SaleEvt[]>();
    const push = (pid: ID, e: SaleEvt) => {
      let a = m.get(pid);
      if (!a) {
        a = [];
        m.set(pid, a);
      }
      a.push(e);
    };
    for (const r of db.receipts) {
      const sign = r.kind === 'sale' ? 1 : -1;
      const date = r.at.slice(0, 10);
      for (const l of r.lines) push(l.productId, { date, qty: sign * l.qty, sum: sign * l.qty * l.price, clientId: r.clientId, kind: 'retail' });
    }
    const orders = indexes(db).orders;
    for (const mv of db.movements) {
      if (mv.kind !== 'ship') continue;
      const o = orders.get(mv.docId);
      if (!o) continue;
      const l = o.lines.find((x) => x.productId === mv.productId);
      const qty = -mv.dOnHand;
      push(mv.productId, { date: mv.at.slice(0, 10), qty, sum: qty * (l?.price ?? 0), clientId: o.clientId, kind: 'wholesale' });
    }
    for (const r of db.returns) {
      if (r.source !== 'order') continue;
      const date = r.at.slice(0, 10);
      for (const l of r.lines) push(l.productId, { date, qty: -l.qty, sum: -l.qty * l.price, clientId: r.clientId, kind: 'wholesale' });
    }
    return m;
  });
}

/** Дата последней продажи (касса или отгрузка). */
export function lastSaleIndex(db: DB): Map<ID, ISODate> {
  return memoDB(db, 'lastSale', () => {
    const m = new Map<ID, ISODate>();
    for (const [pid, evts] of salesByProduct(db)) {
      let last: ISODate | null = null;
      for (const e of evts) if (e.qty > 0 && (last === null || e.date > last)) last = e.date;
      if (last) m.set(pid, last);
    }
    return m;
  });
}

/* ---------- движения по товару ---------- */

export function movesByProduct(db: DB): Map<ID, Movement[]> {
  return memoDB(db, 'movesByProduct', () => {
    const m = new Map<ID, Movement[]>();
    for (const mv of db.movements) {
      let a = m.get(mv.productId);
      if (!a) {
        a = [];
        m.set(mv.productId, a);
      }
      a.push(mv);
    }
    return m;
  });
}

export const MOVE_KIND: Record<MovementKind, string> = {
  initial: 'Начальный остаток',
  income: 'Приход от поставщика',
  sale: 'Продажа на кассе',
  ship: 'Отгрузка по заказу',
  transfer_out: 'Перемещение, ушло',
  transfer_in: 'Перемещение, пришло',
  writeoff: 'Списание',
  count: 'Пересчёт',
  return_in: 'Возврат в продажу',
  reserve: 'Резерв под заказ',
  unreserve: 'Снят резерв',
};

/** Документ движения: подпись и ссылка на карточку, если она есть. */
export function moveDoc(db: DB, mv: Movement): { label: string; entity?: { type: 'order' | 'receipt' | 'purchase' | 'delivery'; id: ID } } {
  switch (mv.docType) {
    case 'receipt': {
      const r = get(db, 'receipts', mv.docId);
      return { label: r ? `Чек № ${r.number}` : 'Чек', entity: r ? { type: 'receipt', id: r.id } : undefined };
    }
    case 'order': {
      const o = get(db, 'orders', mv.docId);
      return { label: o ? `Заказ № ${o.number}` : 'Заказ', entity: o ? { type: 'order', id: o.id } : undefined };
    }
    case 'purchase': {
      const pu = get(db, 'purchases', mv.docId);
      return { label: pu ? `Закупка № ${pu.number}` : 'Закупка', entity: pu ? { type: 'purchase', id: pu.id } : undefined };
    }
    case 'delivery': {
      const d = get(db, 'deliveries', mv.docId);
      return { label: d ? `Доставка № ${d.number}` : 'Доставка', entity: d ? { type: 'delivery', id: d.id } : undefined };
    }
    case 'return': {
      const r = get(db, 'returns', mv.docId);
      return { label: r ? `Возврат № ${r.number}` : 'Возврат' };
    }
    default: {
      const d = get(db, 'stockDocs', mv.docId);
      const kind = d ? { initial: 'Ввод остатков', income: 'Приход', transfer: 'Перемещение', writeoff: 'Списание', count: 'Пересчёт' }[d.kind] : 'Документ';
      return { label: d ? `${kind} № ${d.number}` : kind };
    }
  }
}

/* ---------- акции ---------- */

export type PromoState = 'active' | 'future' | 'ended' | 'off';

export function promoState(pr: Promo, today: ISODate): PromoState {
  if (!pr.active) return 'off';
  if (pr.start > today) return 'future';
  if (pr.end < today) return 'ended';
  return 'active';
}

/** Слова состояний акции — из общего словаря ui/statuses. */
export const PROMO_STATE: Record<PromoState, StatusDef> = PROMO_STATE_UI;

export const AUDIENCE: Record<Promo['audience'], string> = { all: 'Все покупатели', retail: 'Розница', wholesale: 'Опт' };

/** Товары, на которые действует акция (без учёта дат). */
export function promoProducts(db: DB, target: Promo['target'], audience: Promo['audience']): Product[] {
  const fake = { target, audience } as Promo;
  const types: PriceType[] = audience === 'all' ? ['retail', 'wholesale'] : [audience];
  return db.products.filter((p) => types.some((t) => promoApplies(db, fake, p, t)));
}

export function promoTargetText(db: DB, pr: Pick<Promo, 'target'>): string {
  const t = pr.target;
  if (t.type === 'brand') return `Бренд ${indexes(db).brands.get(t.id)?.name ?? ''}`;
  if (t.type === 'category') return `Категория «${indexes(db).categories.get(t.id)?.name ?? ''}»`;
  if (t.ids.length === 1) return indexes(db).products.get(t.ids[0])?.name ?? '1 товар';
  return fmt.count(t.ids.length, 'товар', 'товара', 'товаров');
}

/** Сегодняшние действующие акции. */
export function promosToday(db: DB): Promo[] {
  return activePromos(db, db.meta.today);
}

/* ---------- справочники для форм ---------- */

export interface CategoryOption {
  value: string;
  label: string;
}

/** Категории деревом: «Стирка», «Стирка · Гели для стирки». */
export function categoryOptions(db: DB, onlyLeaves = false): CategoryOption[] {
  const tops = db.categories.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const out: CategoryOption[] = [];
  for (const t of tops) {
    const subs = db.categories.filter((c) => c.parentId === t.id).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    if (!onlyLeaves || !subs.length) out.push({ value: t.id, label: t.name });
    for (const s of subs) out.push({ value: s.id, label: onlyLeaves ? `${t.name} · ${s.name}` : ` ${s.name}` });
  }
  return out;
}

/** Все штрихкоды базы: штрихкод → товар. */
export function barcodeIndex(db: DB): Map<string, Product> {
  return memoDB(db, 'barcodes', () => {
    const m = new Map<string, Product>();
    for (const p of db.products) for (const pk of p.packs) m.set(pk.barcode, p);
    return m;
  });
}

/* ---------- телефон ---------- */

export function useIsPhone(): boolean {
  const q = '(max-width: 760px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const h = () => setPhone(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return phone;
}

/* ---------- проверка наценки по акции ---------- */

export interface MarginIssue {
  product: Product;
  priceType: PriceType;
  price: number; // цена со скидкой
  min: number; // наименьшая допустимая
  belowCost: boolean;
}

/** Товары, у которых цена со скидкой ниже себестоимости плюс минимальная наценка. */
export function promoMarginIssues(db: DB, products: Product[], promo: Pick<Promo, 'kind' | 'value' | 'audience'>): MarginIssue[] {
  const out: MarginIssue[] = [];
  const types: PriceType[] = promo.audience === 'all' ? ['retail', 'wholesale'] : [promo.audience];
  for (const p of products) {
    const min = minAllowedPrice(p.cost, db.settings.minMarginPct);
    if (min === null || p.cost === null) continue;
    for (const t of types) {
      const base = t === 'retail' ? p.retailPrice : p.wholesalePrice;
      const price = promoPrice(promo, base);
      if (price < min) {
        out.push({ product: p, priceType: t, price, min, belowCost: price < p.cost });
        break;
      }
    }
  }
  return out;
}

/** Продано по акции: штуки и сумма по строкам чеков и заказов. */
export function promoSales(db: DB): Map<ID, { qty: number; sum: number }> {
  return memoDB(db, 'promoSales', () => {
    const m = new Map<ID, { qty: number; sum: number }>();
    const add = (id: ID, qty: number, sum: number) => {
      const x = m.get(id) ?? { qty: 0, sum: 0 };
      x.qty += qty;
      x.sum += sum;
      m.set(id, x);
    };
    for (const r of db.receipts) {
      const sign = r.kind === 'sale' ? 1 : -1;
      for (const l of r.lines) if (l.promoId) add(l.promoId, sign * l.qty, sign * l.qty * l.price);
    }
    for (const o of db.orders) {
      if (o.state === 'cancelled' || o.state === 'draft') continue;
      for (const l of o.lines) if (l.promoId) add(l.promoId, l.qty, l.qty * l.price);
    }
    return m;
  });
}
