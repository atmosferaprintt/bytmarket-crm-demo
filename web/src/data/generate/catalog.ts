/* Каталог: категории, бренды, группы вариантов и около 1000 товаров с упаковками и штрихкодами. */
import type { Brand, Category, DB, Pack, Product, ProductGroup } from '../types';
import type { Rng } from '../rng';
import { makeEan13 } from '../codes';
import { BRANDS, CATEGORIES, EXPIRY_SUBS, LINES, MARKING_CATS } from './catalogData';
import type { LineRow } from './catalogData';

export interface ProdMeta {
  index: number;
  sub: string;
  parent: string;
  brand: string;
  supplierKey: string;
  pop: number; // относительная популярность (0 — не продаётся)
  sizeIdx: number;
  sizeCount: number;
  heavy: boolean;
  dead: boolean; // без движения весь период
  hot: boolean; // ходовой
  deficit: boolean; // ходовой, к сегодняшнему дню в дефиците
  nearExpiry: boolean; // партия со сроком в ближайшие 30 дней
  inactiveFromStart: boolean;
  noCost: boolean;
}

interface Cand {
  sub: string;
  parent: string;
  brand: (typeof BRANDS)[number];
  rowKey: string;
  line: string;
  variant: string;
  vIdx: number;
  size: { label: string; price: number };
  sizeIdx: number;
  sizeCount: number;
  kind: string;
  synthetic: boolean;
  scentSub: boolean;
}

function parseSizes(s: string): { label: string; price: number }[] {
  return s.split('|').map((x) => {
    const i = x.lastIndexOf(':');
    return { label: x.slice(0, i), price: Number(x.slice(i + 1)) };
  });
}

const num = (s: string): number => Number(s.replace(',', '.'));

/** Примерный вес единицы в граммах по подписи размера. */
function weightOf(label: string, sub: string): number {
  let m = label.match(/^(\d+) × (\d+(?:,\d+)?) (г|мл)$/);
  if (m) return Math.round(+m[1] * num(m[2]) * 1.05);
  m = label.match(/^(\d+(?:,\d+)?) (кг|л)$/);
  if (m) return Math.round(num(m[1]) * 1000 * (m[2] === 'л' ? 1.06 : 1.02));
  m = label.match(/^(\d+(?:,\d+)?) (г|мл)$/);
  if (m) return Math.round(num(m[1]) * (m[2] === 'мл' ? 1.05 : 1) + 25);
  m = label.match(/^(\d+) рулон/);
  if (m) return +m[1] * (sub === 'cat-paper-towels' ? 160 : 95);
  m = label.match(/^(\d+) л × (\d+) шт$/);
  if (m) return Math.round(+m[1] * +m[2] * 0.45 + 15);
  m = label.match(/× (\d+) шт$/);
  if (m) return Math.round(+m[1] * 3 + 20);
  m = label.match(/^(\d+) шт$/);
  if (m) {
    if (sub.startsWith('cat-laundry') || sub === 'cat-dishes-pmm') return +m[1] * 20 + 40;
    if (sub === 'cat-paper-napkins') return Math.round(+m[1] * 1.2);
    if (sub === 'cat-san-wc') return +m[1] * 45;
    return +m[1] * 12 + 10;
  }
  m = label.match(/^(\d+) м$/);
  if (m) return +m[1] * (sub === 'cat-kit-foil' ? 14 : sub === 'cat-kit-film' ? 5 : 9) + 30;
  m = label.match(/^(\d+) листов$/);
  if (m) return +m[1] * 4;
  if (label.startsWith('размер')) return 70;
  return 150;
}

/** Розница с окончанием на 0, 5 или 9. */
export function roundRetail(x: number): number {
  const t = Math.floor(x / 10) * 10;
  const cands = [t - 1, t, t + 5, t + 9, t + 10].filter((v) => v >= 15);
  let best = cands[0];
  for (const c of cands) if (Math.abs(c - x) < Math.abs(best - x)) best = c;
  return best;
}

export function buildCatalog(db: DB, rng: Rng): ProdMeta[] {
  // категории
  for (const c of CATEGORIES) {
    db.categories.push({ id: c.id, name: c.name, parentId: null } satisfies Category);
    for (const s of c.subs) db.categories.push({ id: s.id, name: s.name, parentId: c.id });
  }
  // бренды
  const brandId = new Map<string, string>();
  BRANDS.forEach((b, i) => {
    const id = 'br-' + (i + 1);
    brandId.set(b.name, id);
    db.brands.push({ id, name: b.name } satisfies Brand);
  });
  const brandByName = new Map(BRANDS.map((b) => [b.name, b]));

  // кандидаты из линеек
  const subInfo = new Map<string, { parent: string; kind: string; pop: number; scent: boolean; extra: string[] }>();
  for (const c of CATEGORIES) for (const s of c.subs) subInfo.set(s.id, { parent: c.id, kind: s.kind, pop: s.pop, scent: s.scent, extra: s.extra });

  interface Row {
    key: string;
    sub: string;
    row: LineRow;
    variants: string[];
    sizes: { label: string; price: number }[];
    synthetic: Set<string>;
  }
  const rows: Row[] = [];
  for (const [sub, list] of Object.entries(LINES)) {
    list.forEach((row, i) => {
      if (!brandByName.has(row[0])) throw new Error('Неизвестный бренд в каталоге: ' + row[0]);
      rows.push({ key: `${sub}#${i}`, sub, row, variants: row[2].split('|'), sizes: parseSizes(row[3]), synthetic: new Set() });
    });
  }
  const countAll = (): number => rows.reduce((s, r) => s + r.variants.length * r.sizes.length, 0);

  // добираем до ~1000 позиций дополнительными ароматами в популярных линейках
  const TARGET = 1000;
  const extendable = rows
    .filter((r) => r.variants.length >= 2 && (subInfo.get(r.sub)?.extra.length ?? 0) > 0)
    .sort((a, b) => brandByName.get(b.row[0])!.pop * subInfo.get(b.sub)!.pop - brandByName.get(a.row[0])!.pop * subInfo.get(a.sub)!.pop);
  let guard = 0;
  while (countAll() < TARGET && guard++ < 50) {
    let added = false;
    for (const r of extendable) {
      if (countAll() >= TARGET) break;
      const pool = subInfo.get(r.sub)!.extra.filter((x) => !r.variants.includes(x));
      if (!pool.length || r.variants.length >= 9) continue;
      const v = pool[rng.int(0, pool.length - 1)];
      r.variants.push(v);
      r.synthetic.add(v);
      added = true;
    }
    if (!added) break;
  }

  const cands: Cand[] = [];
  for (const r of rows) {
    const info = subInfo.get(r.sub)!;
    const brand = brandByName.get(r.row[0])!;
    r.variants.forEach((v, vIdx) => {
      r.sizes.forEach((size, sizeIdx) => {
        cands.push({
          sub: r.sub,
          parent: info.parent,
          brand,
          rowKey: r.key,
          line: r.row[1],
          variant: v,
          vIdx,
          size,
          sizeIdx,
          sizeCount: r.sizes.length,
          kind: r.row[4] ?? info.kind,
          synthetic: r.synthetic.has(v),
          scentSub: info.scent,
        });
      });
    });
  }

  // группы: несколько размеров одного варианта, или несколько вариантов одного размера (до 4)
  const groupKey = new Map<Cand, string>();
  const byRow = new Map<string, Cand[]>();
  for (const c of cands) {
    const a = byRow.get(c.rowKey) ?? [];
    a.push(c);
    byRow.set(c.rowKey, a);
  }
  for (const [key, list] of byRow) {
    const sizeCount = list[0].sizeCount;
    if (sizeCount >= 2) {
      for (const c of list) groupKey.set(c, `${key}|${c.variant}`);
    } else {
      list.forEach((c, i) => groupKey.set(c, `${key}|chunk${Math.floor(i / 4)}`));
    }
  }
  const groupSize = new Map<string, number>();
  for (const k of groupKey.values()) groupSize.set(k, (groupSize.get(k) ?? 0) + 1);
  const groupIds = new Map<string, string>();

  const brandItem = new Map<string, number>();
  const meta: ProdMeta[] = [];
  let skuN = 100;
  for (const c of cands) {
    const n = ++skuN;
    const id = 'p-' + (n - 100);
    const info = subInfo.get(c.sub)!;
    const bId = brandId.get(c.brand.name)!;
    const gk = groupKey.get(c)!;
    let groupId: string | null = null;
    if ((groupSize.get(gk) ?? 0) >= 2) {
      groupId = groupIds.get(gk) ?? null;
      if (!groupId) {
        groupId = 'g-' + (groupIds.size + 1);
        groupIds.set(gk, groupId);
        const g: ProductGroup = {
          id: groupId,
          name: `${c.brand.name}${c.line ? ' ' + c.line : ''}${c.sizeCount >= 2 ? ' ' + c.variant : ''}, ${c.kind}`,
          brandId: bId,
          categoryId: c.sub,
        };
        db.groups.push(g);
      }
    }
    const isScent = c.scentSub && !/^(Без запаха|Универсал|Стандарт|Эконом|Классик|Профи|Белые|Белая|Чёрные|Color|Детск)/.test(c.variant);
    const variantWord = c.size.label.startsWith('размер') ? '' : c.variant;
    const nameMid = [c.brand.name, c.line, variantWord].filter(Boolean).join(' ');
    const name = `${nameMid}, ${c.kind}, ${c.size.label}`;
    const weight = weightOf(c.size.label, c.sub);
    const retail = roundRetail(c.size.price * rng.float(0.96, 1.05));
    const wholesale = Math.min(Math.floor(retail * 0.92), Math.max(Math.ceil(retail * 0.85), Math.round(retail * (1 - rng.float(0.08, 0.15)))));
    let cost = Math.round(retail * rng.float(0.55, 0.75));
    cost = Math.min(cost, Math.floor(wholesale / 1.125));
    const item = (brandItem.get(c.brand.name) ?? 0) + 1;
    brandItem.set(c.brand.name, item);
    const packs = packsFor(c, weight, rng, c.brand.code, item);
    const expiryTracked = EXPIRY_SUBS.has(c.sub) || c.brand.name === 'BioMio' || c.kind === 'влажные салфетки';
    const p: Product = {
      id,
      sku: `БМ-${String(n).padStart(5, '0')}`,
      name,
      groupId,
      variant: c.size.label.startsWith('размер') ? c.size.label : `${c.size.label} · ${c.variant}`,
      brandId: bId,
      categoryId: c.sub,
      volume: c.size.label,
      weightG: weight,
      scent: isScent ? c.variant : null,
      packs,
      retailPrice: retail,
      wholesalePrice: wholesale,
      cost,
      minStock: 0,
      active: true,
      supplierIds: [],
      expiryTracked,
      marking: MARKING_CATS.has(c.parent),
      createdAt: '2025-0' + rng.int(1, 9) + '-' + String(rng.int(1, 28)).padStart(2, '0'),
    };
    db.products.push(p);
    const sizeFactor = [1, 0.85, 0.55, 0.35][Math.min(3, c.sizeIdx)] * (c.sizeCount === 1 ? 0.9 : 1);
    const pop =
      c.brand.pop *
      info.pop *
      sizeFactor *
      (1 / (1 + 0.22 * c.vIdx)) *
      (c.synthetic ? 0.55 : 1) *
      Math.exp(rng.gauss(0, 0.55));
    meta.push({
      index: meta.length,
      sub: c.sub,
      parent: c.parent,
      brand: c.brand.name,
      supplierKey: c.brand.supplier,
      pop,
      sizeIdx: c.sizeIdx,
      sizeCount: c.sizeCount,
      heavy: weight > 3500,
      dead: false,
      hot: false,
      deficit: false,
      nearExpiry: false,
      inactiveFromStart: false,
      noCost: false,
    });
  }

  // роли товаров: ходовые, дефицитные, без движения, неактивные, без себестоимости, со скорым сроком
  const order = meta.slice().sort((a, b) => b.pop - a.pop);
  order.slice(0, 45).forEach((m) => (m.hot = true));
  const hotPool = order.slice(2, 70).filter((m) => !m.heavy);
  for (const m of rng.sample(hotPool, 27)) m.deficit = true;
  const low = order.slice(Math.floor(order.length * 0.7));
  const deadSet = rng.sample(low, 34);
  for (const m of deadSet) {
    m.dead = true;
    m.pop = 0;
  }
  // неактивные с начала: часть из «мёртвых», часть из слабых
  const inactive = [...deadSet.slice(0, 10), ...rng.sample(low.filter((m) => !m.dead), 22)];
  for (const m of inactive) m.inactiveFromStart = true;
  for (const m of inactive) db.products[m.index].active = false;
  // без себестоимости — около 5 %
  const costPool = order.slice(120).filter((m) => !m.inactiveFromStart && !m.deficit);
  for (const m of rng.sample(costPool, 50)) {
    m.noCost = true;
    db.products[m.index].cost = null;
  }
  // скорый срок годности — 15 медленных товаров со сроком
  const expPool = order
    .slice(150)
    .filter((m) => db.products[m.index].expiryTracked && !m.inactiveFromStart && !m.dead)
    .slice(0, 80);
  for (const m of rng.sample(expPool, 15)) m.nearExpiry = true;
  return meta;
}

function packsFor(c: Cand, weight: number, rng: Rng, brandCode: string, item: number): Pack[] {
  const code = (prefix: string): string => makeEan13(prefix + brandCode + String(item).padStart(5, '0'));
  const packs: Pack[] = [{ key: 'pcs', name: 'шт', qty: 1, barcode: code('460') }];
  let packQty = 0;
  let boxQty = 0;
  const rolls = c.size.label.match(/^(\d+) рулон/);
  if (rolls) boxQty = +rolls[1] <= 4 ? 12 : 6;
  else if (weight <= 200) {
    if (rng.chance(0.6)) packQty = rng.chance(0.5) ? 6 : 12;
    if (rng.chance(0.75) || packQty === 0) boxQty = 24;
  } else if (weight <= 700) {
    boxQty = rng.chance(0.5) ? 20 : 24;
    if (rng.chance(0.2)) packQty = 6;
  } else if (weight <= 1600) {
    boxQty = 12;
    if (rng.chance(0.15)) packQty = 6;
  } else boxQty = 6;
  if (packQty) packs.push({ key: 'pack', name: `упак. ${packQty} шт`, qty: packQty, barcode: code('461') });
  if (boxQty) packs.push({ key: 'box', name: `коробка ${boxQty} шт`, qty: boxQty, barcode: code('462') });
  return packs;
}
