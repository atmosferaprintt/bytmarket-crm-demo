/* Поиск товара — один для кассы, склада, заказа, каталога и строки поиска в шапке.
   Понимает русские названия брендов («фейри», «доместос», «тайд»), объём в любой записи («5л», «5 л», «1,3»),
   штрихкод (от 8 цифр — короче цифры считаются объёмом или количеством, а не штрихкодом), артикул.
   Точное совпадение короткого названия поднимается выше: «fairy лимон 1,35» — это Fairy Лимон, а не «Апельсин и лимонник». */
import type { DB, ID, Pack, PackKey, Product } from './types';
import { normTokens } from './orderText';

/** Как бренды пишут по-русски (и русские бренды латиницей). */
export const BRAND_ALIASES: Record<string, string[]> = {
  Fairy: ['фейри', 'фэйри', 'ферри'],
  AOS: ['аос'],
  Sorti: ['сорти'],
  Tide: ['тайд', 'тид'],
  Ariel: ['ариэль', 'ариель', 'ариал'],
  Persil: ['персил', 'персиль'],
  Losk: ['лоск'],
  Ласка: ['laska'],
  Lenor: ['ленор'],
  Vernel: ['вернель', 'вернел'],
  'Ушастый нянь': ['ushastyy'],
  Frosch: ['фрош'],
  Synergetic: ['синергетик', 'синергетика'],
  BioMio: ['биомио'],
  Grass: ['грасс', 'грас'],
  Finish: ['финиш'],
  Vanish: ['ваниш'],
  Domestos: ['доместос', 'доместас'],
  'Cillit Bang': ['силит', 'силлит', 'бэнг'],
  'Mr. Proper': ['мистер', 'пропер', 'мр'],
  Clin: ['клин'],
  Cif: ['сиф'],
  Comet: ['комет', 'комет'],
  Пемолюкс: ['pemolux'],
  Санфор: ['sanfor'],
  Tiret: ['тирет'],
  Palmolive: ['палмолив', 'пальмолив'],
  Dove: ['дав', 'дов'],
  Duru: ['дуру'],
  'Невская косметика': ['nevskaya'],
  Zewa: ['зева'],
  Papia: ['папия'],
  'Мягкий знак': ['myagkiy'],
  Paclan: ['паклан'],
  Avikomp: ['авиком', 'авикомп'],
  'Фрекен Бок': ['freken', 'bok'],
  Vileda: ['виледа'],
  York: ['йорк'],
  Glade: ['глейд', 'глэйд'],
  'Air Wick': ['эйрвик', 'аирвик', 'эйр', 'вик'],
};

export interface ProductHay {
  p: Product;
  brand: string;
  words: string[]; // все слова для поиска: название, бренд и его написания, вариант, артикул
  head: string[]; // короткое название: бренд, линейка, объём — для точности совпадения
  first: string; // первое слово названия
  barcodes: string[];
  sku: string;
}

const hayCache = new WeakMap<DB, { n: number; v: number; list: ProductHay[]; byId: Map<ID, ProductHay> }>();

/** Поисковые строки по всем товарам базы (с памятью до изменения каталога). */
export function productHays(db: DB): ProductHay[] {
  const c = hayCache.get(db);
  if (c && c.n === db.products.length && c.v === db.meta.version) return c.list;
  const brands = new Map(db.brands.map((b) => [b.id, b.name]));
  const list = db.products.map((p) => {
    const brand = brands.get(p.brandId) ?? '';
    const parts = p.name.split(', ');
    const short = parts.length >= 3 ? `${parts[0]}, ${parts[parts.length - 1]}` : p.name;
    const head = [...new Set(normTokens(`${brand} ${short}`))];
    const skuNo = p.sku.replace(/\D/g, '').replace(/^0+/, '');
    const words = [...new Set([...normTokens(`${brand} ${p.name} ${p.variant ?? ''}`), ...(BRAND_ALIASES[brand] ?? []), p.sku.toLowerCase(), p.sku.replace(/\D/g, ''), `#${skuNo}`])];
    return { p, brand, words, head, first: normTokens(p.name)[0] ?? '', barcodes: p.packs.map((k) => k.barcode).filter(Boolean), sku: p.sku.toLowerCase() };
  });
  hayCache.set(db, { n: db.products.length, v: db.meta.version, list, byId: new Map(list.map((h) => [h.p.id, h])) });
  return list;
}

/** Штрихкод упаковки → товар и упаковка. */
export function findByBarcode(db: DB, code: string): { p: Product; pack: Pack } | null {
  const c = code.trim();
  if (!/^\d{8,14}$/.test(c)) return null;
  for (const h of productHays(db)) {
    const pk = h.p.packs.find((k) => k.barcode === c);
    if (pk) return { p: h.p, pack: pk };
  }
  return null;
}

const isNum = (w: string): boolean => /^\d/.test(w);

function wordMatch(q: string, w: string): boolean {
  if (isNum(q)) {
    if (w === q) return true;
    // «5» к «5л», «1.3» к «1.3л», но не «1» к «1.3л» и не «12» к «120г»
    return w.startsWith(q) && !/[\d.]/.test(w.charAt(q.length));
  }
  return w.startsWith(q);
}

/** Оценка совпадения запроса с товаром; null — не подходит. */
export function scoreProduct(h: ProductHay, tokens: string[]): number | null {
  if (!tokens.length) return null;
  for (const t of tokens) {
    if (/^\d{8,}$/.test(t)) {
      if (!h.barcodes.some((b) => b.includes(t))) return null;
      continue;
    }
    // номер артикула без нулей: «238» → БМ-00238
    if (/^\d{2,6}$/.test(t) && h.words.includes(`#${t}`)) continue;
    if (!h.words.some((w) => wordMatch(t, w))) {
      // кусок слова внутри названия — только для длинных запросов («лимонн» в «лимонник»)
      if (t.length < 4 || !h.words.some((w) => w.includes(t))) return null;
    }
  }
  let score = 0;
  const covered = h.head.filter((hw) => tokens.some((t) => wordMatch(t, hw))).length;
  score += (covered / h.head.length) * 6; // насколько полно названо короткое название
  if (covered === h.head.length) score += 3; // названо целиком
  if (wordMatch(tokens[0], h.first)) score += 2;
  const brandWords = normTokens(h.brand);
  if (brandWords.some((b) => wordMatch(tokens[0], b)) || (BRAND_ALIASES[h.brand] ?? []).some((a) => a.startsWith(tokens[0]))) score += 2;
  return score;
}

export interface SearchHit {
  p: Product;
  pack?: PackKey; // если нашли по штрихкоду упаковки
  score: number;
}

/** Найти товары. boost — добавка к оценке (наличие, популярность); filter — какие товары вообще показывать. */
export function searchProducts(
  db: DB,
  query: string,
  opts: { limit?: number; boost?: (p: Product) => number; filter?: (p: Product) => boolean } = {},
): { list: SearchHit[]; total: number } {
  const raw = query.trim();
  if (!raw) return { list: [], total: 0 };
  const filter = opts.filter ?? ((p: Product) => p.active);
  const code = findByBarcode(db, raw);
  if (code && filter(code.p)) return { list: [{ p: code.p, pack: code.pack.key, score: 100 }], total: 1 };
  const tokens = normTokens(raw).filter((t) => t !== '—' && t !== '-');
  const found: SearchHit[] = [];
  for (const h of productHays(db)) {
    if (!filter(h.p)) continue;
    const s = scoreProduct(h, tokens);
    if (s === null) continue;
    found.push({ p: h.p, score: s + (opts.boost ? opts.boost(h.p) : 0) });
  }
  found.sort((a, b) => b.score - a.score || a.p.name.localeCompare(b.p.name, 'ru'));
  return { list: found.slice(0, opts.limit ?? 8), total: found.length };
}

/** Телефон для поиска: только цифры, 8 в начале — как 7. */
export function phoneDigits(s: string): string {
  const d = s.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('8') ? '7' + d.slice(1) : d;
}
