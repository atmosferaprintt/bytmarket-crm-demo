/* Касса: общие расчёты раздела — поиск по каталогу, штрихкоды, цена чека, подписи. */
import type { LucideIcon } from 'lucide-react';
import {
  Bath,
  Brush,
  CookingPot,
  Package,
  Scroll,
  ShoppingBag,
  SoapDispenserDroplet,
  Sparkles,
  SprayCan,
  Utensils,
  WashingMachine,
  Wind,
} from 'lucide-react';
import type { Client, DB, ID, PackKey, Product, Promo, Receipt, Shift } from '../../data/types';
import { indexes, priceFor, stockOf } from '../../data/selectors';
import { fmt } from '../../ui';

export const PACK_SHORT: Record<PackKey, string> = { pcs: 'шт', pack: 'упак.', box: 'кор.' };

export const DISCOUNT_REASONS = ['Постоянный покупатель', 'Повреждённая упаковка', 'Мятая коробка', 'Последний товар с витрины'] as const;

/** Причины возврата, которые бывают у прилавка (без «Не доставлен» и «Привезли не то»). */
export const SHOP_RETURN_REASONS = ['defect', 'not_fit', 'expired', 'other'] as const;

export const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');

/* ---------- каталог для поиска ---------- */

export interface CatalogItem {
  p: Product;
  brand: string;
  category: string; // категория верхнего уровня: «Стирка»
  text: string; // нормализованная строка поиска
  nameNorm: string;
}

export interface Catalog {
  items: CatalogItem[];
  byId: Map<ID, CatalogItem>;
  byBarcode: Map<string, { productId: ID; pack: PackKey }>;
  bySku: Map<string, ID>;
  popularity: Map<ID, number>; // штук продано в магазине за 14 дней
}

export function buildCatalog(db: DB): Catalog {
  const ix = indexes(db);
  const items: CatalogItem[] = [];
  const byId = new Map<ID, CatalogItem>();
  const byBarcode = new Map<string, { productId: ID; pack: PackKey }>();
  const bySku = new Map<string, ID>();
  for (const p of db.products) {
    if (!p.active) continue;
    const brand = ix.brands.get(p.brandId)?.name ?? '';
    const sub = ix.categories.get(p.categoryId);
    const category = (sub?.parentId ? ix.categories.get(sub.parentId)?.name : sub?.name) ?? '';
    const codes = p.packs.map((k) => k.barcode).join(' ');
    const it: CatalogItem = {
      p,
      brand,
      category,
      nameNorm: norm(p.name),
      text: norm(`${p.name} ${brand} ${p.variant ?? ''} ${p.sku} ${codes}`),
    };
    items.push(it);
    byId.set(p.id, it);
    bySku.set(norm(p.sku), p.id);
    for (const k of p.packs) if (k.barcode) byBarcode.set(k.barcode, { productId: p.id, pack: k.key });
  }
  const popularity = new Map<ID, number>();
  const from = fmt.addDays(db.meta.today, -14);
  for (let i = db.receipts.length - 1; i >= 0; i--) {
    const r = db.receipts[i];
    if (r.at.slice(0, 10) < from) break;
    if (r.kind !== 'sale') continue;
    for (const l of r.lines) popularity.set(l.productId, (popularity.get(l.productId) ?? 0) + l.qty);
  }
  return { items, byId, byBarcode, bySku, popularity };
}

export function searchCatalog(cat: Catalog, query: string, limit = 8): { list: CatalogItem[]; total: number } {
  const q = norm(query.trim());
  if (!q) return { list: [], total: 0 };
  const tokens = q.split(/\s+/).filter(Boolean);
  const found: { it: CatalogItem; score: number }[] = [];
  for (const it of cat.items) {
    if (!tokens.every((t) => it.text.includes(t))) continue;
    let score = 0;
    if (it.nameNorm.startsWith(tokens[0])) score += 4;
    if (norm(it.brand).startsWith(tokens[0])) score += 3;
    if (tokens.every((t) => it.nameNorm.includes(t))) score += 2;
    score += Math.min(3, Math.log10(1 + (cat.popularity.get(it.p.id) ?? 0)));
    found.push({ it, score });
  }
  found.sort((a, b) => b.score - a.score || a.it.p.name.localeCompare(b.it.p.name, 'ru'));
  return { list: found.slice(0, limit).map((f) => f.it), total: found.length };
}

/** Ходовые товары магазина — показываем, пока поле поиска пустое. */
export function popularItems(cat: Catalog, db: DB, limit = 6): CatalogItem[] {
  return [...cat.popularity.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => cat.byId.get(id))
    .filter((x): x is CatalogItem => !!x && stockOf(db, x.p.id).shop.available > 0)
    .slice(0, limit);
}

/* ---------- иконка по категории ---------- */

const ICONS: [RegExp, LucideIcon][] = [
  [/стир|порош|кондицион|отбел|пятно/, WashingMachine],
  [/кухн|фольг|пленк|выпеч|запекан/, CookingPot],
  [/посуд/, Utensils],
  [/сантех|унитаз|труб/, Bath],
  [/мыл|гигиен|душ/, SoapDispenserDroplet],
  [/бумаг|салфет|полотен/, Scroll],
  [/мешк|пакет/, ShoppingBag],
  [/губк|тряп|перчат/, Brush],
  [/освеж|аэрозол/, Wind],
  [/уборк|чист|средств|стекол|пол/, SprayCan],
];

/** Иконка по категории верхнего уровня: «Стирка», «Посуда»… */
export function categoryIcon(category: string): LucideIcon {
  const c = norm(category);
  for (const [re, I] of ICONS) if (re.test(c)) return I;
  return c ? Sparkles : Package;
}

/* ---------- чек: строки и цена ---------- */

export interface CartLine {
  key: string;
  productId: ID;
  pack: PackKey;
  packQty: number;
}

export interface CartState {
  lines: CartLine[];
  clientId: ID | null;
  discountPct: number;
  discountReason: string;
}

export const EMPTY_CART: CartState = { lines: [], clientId: null, discountPct: 0, discountReason: '' };

export interface PricedLine extends CartLine {
  p: Product;
  packSize: number;
  qty: number; // штук
  base: number; // за штуку без скидок
  promoPrice: number; // за штуку с акцией
  promo: Promo | null;
  price: number; // итоговая за штуку
  discounted: boolean; // применена ручная скидка
  sum: number;
}

export interface PricedCart {
  lines: PricedLine[];
  gross: number; // без скидок
  promo: number; // сумма акций
  discount: number; // ручная скидка
  total: number;
  pieces: number;
  promoNames: string[];
  discountLines: number; // строк со скидкой
  discountEligible: number; // строк, где скидка возможна
}

/** Цена чека по тем же правилам, что и операция: акция или ручная скидка (не вместе), не ниже минимальной наценки —
    кроме владельца. */
export function priceCart(db: DB, cart: CartState, priceType: 'retail' | 'wholesale', allowBelowMargin = false): PricedCart {
  const date = db.meta.today;
  const pct = cart.discountPct > 0 ? cart.discountPct : 0;
  const minMargin = db.settings.minMarginPct;
  const lines: PricedLine[] = [];
  let gross = 0;
  let promo = 0;
  let discount = 0;
  let pieces = 0;
  let discountLines = 0;
  let discountEligible = 0;
  const promoNames = new Set<string>();
  for (const l of cart.lines) {
    const p = indexes(db).products.get(l.productId);
    if (!p) continue;
    const pk = p.packs.find((x) => x.key === l.pack) ?? p.packs[0];
    const qty = l.packQty * pk.qty;
    const pr = priceFor(db, p.id, { priceType, date });
    let price = pr.price;
    let discounted = false;
    if (!pr.promo) {
      discountEligible++;
      if (pct > 0) {
        const d = Math.round((pr.price * (100 - pct)) / 100);
        const minPrice = p.cost !== null && !allowBelowMargin ? Math.ceil((p.cost * (100 + minMargin)) / 100) : 0;
        if (d >= minPrice) {
          price = d;
          discounted = true;
          discountLines++;
        }
      }
    } else promoNames.add(pr.promo.name);
    gross += pr.base * qty;
    promo += (pr.base - pr.price) * qty;
    discount += (pr.price - price) * qty;
    pieces += qty;
    lines.push({ ...l, pack: pk.key, p, packSize: pk.qty, qty, base: pr.base, promoPrice: pr.price, promo: pr.promo, price, discounted, sum: price * qty });
  }
  return { lines, gross, promo, discount, total: gross - promo - discount, pieces, promoNames: [...promoNames], discountLines, discountEligible };
}

export function promoPct(base: number, price: number): number {
  return base > 0 ? Math.round(((base - price) / base) * 100) : 0;
}

/* ---------- карта постоянного покупателя ---------- */

function ean(d12: string): string {
  let s = 0;
  for (let i = 0; i < 12; i++) s += (d12.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  return d12 + ((10 - (s % 10)) % 10);
}

/** Номер карты постоянного покупателя: внутренний штрихкод магазина, начинается с 27. */
export function cardNumber(db: DB, client: Client): string {
  const digits = client.id.replace(/\D/g, '');
  const n = digits ? Number(digits) : db.clients.indexOf(client) + 1;
  return ean('27' + String(n).padStart(10, '0'));
}

export function clientByCard(db: DB, code: string): Client | undefined {
  if (!/^27\d{11}$/.test(code)) return undefined;
  return db.clients.find((c) => cardNumber(db, c) === code);
}

/* ---------- подписи ---------- */

export type PayKind = 'cash' | 'card' | 'mixed' | 'refund';
export const PAY_KIND_NAMES: Record<PayKind, string> = { cash: 'Наличные', card: 'Карта', mixed: 'Смешанная', refund: 'Возврат' };

export function payKind(r: Receipt): PayKind {
  if (r.kind === 'refund') return 'refund';
  if (r.card > 0 && r.cash > 0) return 'mixed';
  return r.card > 0 ? 'card' : 'cash';
}

/** Короткое имя товара для списков: «Fairy 450 мл». */
export function shortTitle(db: DB, p: Product): string {
  const brand = indexes(db).brands.get(p.brandId)?.name ?? '';
  const vol = p.volume ? ` ${p.volume}` : '';
  if (brand && p.name.toLowerCase().startsWith(brand.toLowerCase())) {
    const firstPart = p.name.split(',')[0];
    return firstPart.length <= 28 ? firstPart + vol : brand + vol;
  }
  return (brand || p.name.split(',')[0]) + vol;
}

/** Состав чека одной строкой: «Persil 1,3 л, Lenor 1 л и ещё 3». */
export function receiptContents(db: DB, r: Receipt): string {
  const ix = indexes(db);
  const names: string[] = [];
  for (const l of r.lines) {
    const p = ix.products.get(l.productId);
    if (p) names.push(shortTitle(db, p));
  }
  if (names.length <= 2) return names.join(', ');
  return `${names[0]}, ${names[1]} и ещё ${names.length - 2}`;
}

/** Строка поиска по чеку: номер и названия товаров. */
export function receiptSearchText(db: DB, r: Receipt): string {
  const ix = indexes(db);
  const parts = [`№${r.number}`, `№ ${r.number}`, String(r.number)];
  for (const l of r.lines) {
    const p = ix.products.get(l.productId);
    if (p) parts.push(p.name, p.sku);
  }
  return parts.join(' ');
}

export function openShift(db: DB): Shift | undefined {
  for (let i = db.shifts.length - 1; i >= 0; i--) if (!db.shifts[i].closedAt) return db.shifts[i];
  return undefined;
}

/** Чеки смены, новые сверху. */
export function receiptsOfShift(db: DB, shiftId: ID): Receipt[] {
  const out: Receipt[] = [];
  for (let i = db.receipts.length - 1; i >= 0; i--) if (db.receipts[i].shiftId === shiftId) out.push(db.receipts[i]);
  return out;
}

/** Сколько штук уже вернули по чеку продажи, по товарам. */
export function refundedByProduct(db: DB, receiptId: ID): Map<ID, number> {
  const m = new Map<ID, number>();
  for (const r of db.receipts) if (r.refundOf === receiptId) for (const l of r.lines) m.set(l.productId, (m.get(l.productId) ?? 0) + l.qty);
  return m;
}

/** Имя для чека и коротких списков без вида товара: «Fairy Сочный лимон, 450 мл». Запятая в «1,3 л» не мешает. */
export function cartName(p: Product): string {
  const parts = p.name.split(', ');
  return parts.length >= 3 ? `${parts[0]}, ${parts[parts.length - 1]}` : p.name;
}

/** Неразрывный пробел между числом и единицей: «180 г» не разрывается по строкам. Длина строки не меняется. */
export function nbUnits(s: string): string {
  return s.replace(/(\d) (мл|л|г|кг|шт|рулон|рулона|рулонов|м|см)(?=$|[\s,.])/g, '$1\u00a0$2');
}

export function packLabel(p: Product, pack: PackKey): string {
  const pk = p.packs.find((x) => x.key === pack);
  if (!pk || pack === 'pcs') return 'шт';
  return `${PACK_SHORT[pack]} ${pk.qty} шт`;
}

/** Номер документа в тексте всегда «№ 502»: с пробелом после знака. Тексты операций приходят как «№502». */
export function fixNo(s: string): string {
  return s.replace(/№[\s\u00a0]*(?=\d)/g, '№ ');
}

export function newKey(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
