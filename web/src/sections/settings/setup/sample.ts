/* «Вставить пример»: 10 строк из справочника этой базы. Две с ошибками (цена словами и штрихкод,
   который уже есть в каталоге) и одна с похожим названием — чтобы показать проверку. */
import type { Brand, Category, DB, Product } from '../../../data/types';
import { makeEan13 } from '../../../data/codes';
import { TEMPLATE_HEADER, buildCatalog, findSimilar, nameTokens, serializeTable } from './importer';

interface Spec {
  brand: string;
  cat: string[]; // ключевые слова категории, от точного к общему
  descr: string;
  retail: number;
  box: number;
  min: number;
}

const SPECS: Spec[] = [
  { brand: 'Ушастый нянь', cat: ['порош', 'стир'], descr: 'стиральный порошок для детского белья, 2,4 кг', retail: 819, box: 6, min: 12 },
  { brand: 'Fairy', cat: ['посуд'], descr: 'гель для мытья посуды Ледяная свежесть, 650 мл', retail: 279, box: 12, min: 24 },
  { brand: 'Domestos', cat: ['чистящие гели', 'сантех'], descr: 'чистящий гель для унитаза Ультра белый, 1 л', retail: 239, box: 12, min: 18 },
  { brand: 'Zewa', cat: ['туалетная бумага', 'бумаг'], descr: 'туалетная бумага трёхслойная Ромашка, 8 рулонов', retail: 359, box: 7, min: 14 },
  { brand: 'Paclan', cat: ['мешк', 'мусор', 'пакет'], descr: 'мешки для мусора с завязками, 60 л, 20 шт', retail: 189, box: 30, min: 20 },
  { brand: 'Glade', cat: ['аэрозол', 'освеж'], descr: 'освежитель воздуха Морской бриз, 300 мл', retail: 219, box: 12, min: 12 },
  { brand: 'Mr. Proper', cat: ['мытья пол', 'уборк'], descr: 'средство для мытья пола Лимон, 1,8 л', retail: 329, box: 6, min: 10 },
  { brand: 'Vileda', cat: ['губк', 'тряп', 'салфет'], descr: 'губки для посуды поролоновые, 5 шт', retail: 149, box: 24, min: 20 },
  { brand: 'Aura', cat: ['жидкое мыло', 'мыл'], descr: 'жидкое мыло Алоэ вера, 500 мл', retail: 159, box: 12, min: 18 },
  { brand: 'Sarma', cat: ['от жира', 'кух'], descr: 'спрей-антижир для плит и духовок, 500 мл', retail: 199, box: 12, min: 12 },
  { brand: 'Persil', cat: ['гели для стирки', 'стир'], descr: 'гель для стирки цветного белья, 1,3 л', retail: 689, box: 6, min: 8 },
  { brand: 'Comet', cat: ['чистящие порошки', 'сантех'], descr: 'чистящий порошок Лимон, 475 г', retail: 109, box: 24, min: 24 },
];

const key = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

function pickCategory(db: DB, words: string[], used: Set<string>, withProducts: Set<string>): Category | null {
  for (const w of words) {
    const hits = db.categories.filter((c) => key(c.name).includes(w) && withProducts.has(c.id));
    const best = hits.find((c) => c.parentId && !used.has(c.id)) ?? hits.find((c) => !used.has(c.id)) ?? hits[0];
    if (best) return best;
  }
  return null;
}

function pickBrand(db: DB, name: string, category: Category, byCat: Map<string, Map<string, number>>): Brand | null {
  const exact = db.brands.find((b) => key(b.name) === key(name));
  if (exact) return exact;
  const counts = byCat.get(category.id);
  if (!counts) return null;
  let best: string | null = null;
  let n = 0;
  for (const [bid, c] of counts) if (c > n) [best, n] = [bid, c];
  return db.brands.find((b) => b.id === best) ?? null;
}

export function buildSample(db: DB): string {
  const cat = buildCatalog(db);
  const withProducts = new Set(db.products.map((p) => p.categoryId));
  const byCat = new Map<string, Map<string, number>>();
  for (const p of db.products) {
    let m = byCat.get(p.categoryId);
    if (!m) byCat.set(p.categoryId, (m = new Map()));
    m.set(p.brandId, (m.get(p.brandId) ?? 0) + 1);
  }
  const catName = (id: string) => db.categories.find((c) => c.id === id)?.name ?? '';
  const brandName = (id: string) => db.brands.find((b) => b.id === id)?.name ?? '';

  // новые штрихкоды: настоящий EAN-13, которого нет в каталоге
  const usedCodes = new Set(cat.byBarcode.keys());
  let seq = 31_270_400;
  const newCode = () => {
    for (;;) {
      const code = makeEan13('4607' + String(seq++).padStart(8, '0'));
      if (!usedCodes.has(code)) {
        usedCodes.add(code);
        return code;
      }
    }
  };

  // восемь новых товаров: бренд и категория из справочника, название не похоже на уже существующие
  const fresh: string[][] = [];
  const usedCats = new Set<string>();
  for (const s of SPECS) {
    if (fresh.length >= 8) break;
    const c = pickCategory(db, s.cat, usedCats, withProducts) ?? db.categories.find((x) => withProducts.has(x.id)) ?? null;
    if (!c) continue;
    const b = pickBrand(db, s.brand, c, byCat);
    if (!b) continue;
    const name = `${b.name}, ${s.descr}`;
    const t = nameTokens(name);
    if (cat.byExact.has(t.exact) || findSimilar(db, cat, t)) continue;
    usedCats.add(c.id);
    const wholesale = Math.round(s.retail * 0.88);
    const cost = Math.round(s.retail * 0.64);
    fresh.push([name, b.name, c.name, newCode(), String(s.box), String(s.retail), String(wholesale), String(cost), String(s.min)]);
  }

  // похожее название: тот же товар каталога, но слова в другом порядке и без запятых
  const active = db.products.filter((p) => p.active && p.cost !== null && p.name.includes(','));
  const twin: Product | undefined = active[Math.floor(active.length * 0.37)] ?? db.products[0];
  // уже есть в каталоге: тот же штрихкод и новая цена — ошибка для «только новые», обновление для второго режима
  const known: Product | undefined = active.find((p, i) => i > active.length * 0.6 && p.id !== twin?.id) ?? db.products[1];

  const rows: string[][] = [];
  const take = (i: number) => fresh[i] ?? fresh[fresh.length - 1];
  rows.push(take(0), take(1), take(2));
  // цена словами — ошибка «не число»
  const bad = [...take(3)];
  bad[5] = 'договорная';
  rows.push(bad);
  rows.push(take(4));
  if (twin) {
    const parts = twin.name.split(', ');
    const swapped = [parts[1] ?? '', parts[0], ...parts.slice(2)].filter(Boolean).join(' ');
    const nm = swapped.charAt(0).toUpperCase() + swapped.slice(1);
    rows.push([
      nm,
      brandName(twin.brandId),
      catName(twin.categoryId),
      newCode(),
      String(twin.packs.find((p) => p.key === 'box')?.qty ?? 12),
      String(twin.retailPrice),
      String(twin.wholesalePrice),
      String(twin.cost ?? ''),
      String(twin.minStock),
    ]);
  }
  rows.push(take(5));
  if (known) {
    const r = Math.round(known.retailPrice * 1.06);
    const w = Math.min(r, Math.round(known.wholesalePrice * 1.06));
    rows.push([
      known.name,
      brandName(known.brandId),
      catName(known.categoryId),
      known.packs[0].barcode,
      String(known.packs.find((p) => p.key === 'box')?.qty ?? ''),
      String(r),
      String(w),
      String(known.cost ?? ''),
      String(known.minStock),
    ]);
  }
  rows.push(take(6));
  // без себестоимости — загрузится, но с пометкой
  const noCost = [...take(7)];
  noCost[7] = '';
  rows.push(noCost);

  return serializeTable([TEMPLATE_HEADER, ...rows]);
}
