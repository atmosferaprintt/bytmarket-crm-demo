/* Разбор заказа из текста сообщения клиента: «Fairy Лимон 900 мл — 3 коробки, Domestos 1 л — 12 шт».
   Строка — это название и количество с единицей (шт, упаковка, коробка). Название ищется по каталогу:
   каждое слово клиента должно найтись в названии товара (бренд, вкус, вид, объём). Что не нашли — возвращаем как есть. */
import type { DB, ID, PackKey, Product } from './types';

export interface ParsedItem {
  text: string; // как написал клиент
  productId: ID | null;
  pack: PackKey;
  packQty: number;
  /** сколько товаров подошло одинаково хорошо — больше 1: стоит проверить */
  matches: number;
}

export interface ParsedOrder {
  items: ParsedItem[];
  /** куски текста, которые не похожи на товар или товар не нашёлся */
  missed: string[];
}

const UNIT = String.raw`(?:шт|штук[аи]?|кор(?:обк[аиу]|обок|\.)?|короб(?:ов|а)?|уп(?:ак(?:овк[аиу]|овок|\.)?|\.)?|пач(?:к[аиу]|ек)?)`;
const WORD_QTY: Record<string, [number, PackKey]> = { коробку: [1, 'box'], коробка: [1, 'box'], упаковку: [1, 'pack'], упаковка: [1, 'pack'], пачку: [1, 'pack'], пачка: [1, 'pack'] };
// количество после тире: «— 3 коробки», «- 12 шт», «— коробку»
const QTY_DASH = new RegExp(String.raw`\s[—–-]\s*(?:(\d{1,4})\s*(${UNIT})?\.?|(коробк[уа]|упаковк[уа]|пачк[уа]))(?=$|[\s,;.!)])`, 'giu');
// количество в конце строки без тире: «Domestos 1 л 12 шт», «х5»
const QTY_END = new RegExp(String.raw`^(.*?)[\s,]+(?:[xх×]\s*(\d{1,4})|(\d{1,4})\s*(${UNIT})\.?)\s*$`, 'iu');

function unitPack(u: string | undefined): PackKey {
  if (!u) return 'pcs';
  const x = u.toLowerCase();
  if (x.startsWith('кор')) return 'box';
  if (x.startsWith('уп') || x.startsWith('пач')) return 'pack';
  return 'pcs';
}

/** Нормализация для сравнения: строчные, ё → е, «1,3 л» → «1.3л», без кавычек и знаков. */
export function normTokens(s: string): string[] {
  const t = s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/[«»"“”„()!?:;]/g, ' ')
    .replace(/(\d+(?:\.\d+)?)\s*(мл|л|кг|г|м|см|шт|рул[а-я]*)(?![a-zа-я])/giu, (_m, n: string, u: string) => `${n}${u.startsWith('рул') ? 'рул' : u}`)
    .replace(/[,—–]/g, ' ');
  return t.split(/\s+/).map((w) => w.replace(/^[-.]+|[-.]+$/g, '')).filter((w) => w.length > 0);
}

const STOP = new Set(['и', 'а', 'еще', 'нам', 'мне', 'бы', 'на', 'пожалуйста', 'нужно', 'надо', 'привезите', 'добавьте', 'возьмем', 'возьму', 'тоже', 'там', 'по']);

const isNum = (w: string): boolean => /^\d/.test(w);

function tokenMatch(q: string, p: string): boolean {
  if (isNum(q)) {
    if (p === q) return true;
    // «1.3» к «1.3л», но не «1» к «1.3л» и не «12» к «120г»
    return p.startsWith(q) && !/[\d.]/.test(p.charAt(q.length));
  }
  if (q.length < 3) return p === q;
  return p.startsWith(q) || (q.length >= 5 && p.startsWith(q.slice(0, -1))); // «мешки» к «мешков», «гель» к «гель»
}

interface IndexedProduct {
  p: Product;
  tokens: string[]; // всё название с брендом и видом товара
  head: string[]; // короткое название: бренд, линейка и вкус, объём — по нему решаем, насколько точно совпало
}

const indexCache = new WeakMap<DB, { n: number; list: IndexedProduct[] }>();

function productIndex(db: DB): IndexedProduct[] {
  const c = indexCache.get(db);
  if (c && c.n === db.products.length) return c.list;
  const brands = new Map(db.brands.map((b) => [b.id, b.name]));
  const list = db.products
    .filter((p) => p.active)
    .map((p) => {
      const parts = p.name.split(', ');
      const short = parts.length >= 3 ? `${parts[0]}, ${parts[parts.length - 1]}` : p.name;
      return { p, tokens: normTokens(`${brands.get(p.brandId) ?? ''} ${p.name}`), head: [...new Set(normTokens(`${brands.get(p.brandId) ?? ''} ${short}`))] };
    });
  indexCache.set(db, { n: db.products.length, list });
  return list;
}

/** Лучший товар по названию. matches > 1 — несколько одинаково подходящих; из них — тот, что клиент брал (prefer). */
export function findProduct(db: DB, name: string, prefer?: ReadonlyMap<ID, number>): { product: Product | null; matches: number } {
  const q = normTokens(name).filter((w) => !STOP.has(w));
  if (!q.length || !q.some((w) => !isNum(w) && w.length >= 3)) return { product: null, matches: 0 };
  let best: IndexedProduct[] = [];
  let bestCover = -1;
  for (const ip of productIndex(db)) {
    let ok = true;
    for (const w of q) {
      if (!ip.tokens.some((t) => tokenMatch(w, t))) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    // точнее тот, у кого больше слов короткого названия названо клиентом; одинаковые короткие названия — неоднозначность
    const cover = ip.head.filter((h) => q.some((w) => tokenMatch(w, h))).length / ip.head.length;
    if (cover > bestCover + 1e-9) {
      best = [ip];
      bestCover = cover;
    } else if (Math.abs(cover - bestCover) < 1e-9) best.push(ip);
  }
  if (!best.length) return { product: null, matches: 0 };
  let pick = best[0];
  if (prefer) for (const x of best) if ((prefer.get(x.p.id) ?? 0) > (prefer.get(pick.p.id) ?? 0)) pick = x;
  return { product: pick.p, matches: best.length };
}

/** Упаковка, которая есть у товара: просили коробку, а коробок нет — упаковка, потом штуки. */
function fitPack(p: Product, want: PackKey): PackKey {
  if (p.packs.some((k) => k.key === want)) return want;
  if (want === 'box' && p.packs.some((k) => k.key === 'pack')) return 'pack';
  return 'pcs';
}

const clean = (s: string): string => s.replace(/^[\s,;.:—–-]+|[\s,;.:—–-]+$/g, '').replace(/^и\s+/i, '').trim();

/** Сколько раз клиент заказывал каждый товар: при одинаковых названиях выбираем привычный. */
export function boughtBy(db: DB, clientId: ID | null | undefined): Map<ID, number> {
  const m = new Map<ID, number>();
  if (!clientId) return m;
  for (const o of db.orders) if (o.clientId === clientId && o.state !== 'cancelled') for (const l of o.lines) m.set(l.productId, (m.get(l.productId) ?? 0) + 1);
  return m;
}

/** Разобрать текст сообщения в строки заказа. clientId — чтобы из похожих товаров выбрать привычный клиенту. */
export function parseOrderText(db: DB, raw: string, clientId?: ID | null): ParsedOrder {
  const items: ParsedItem[] = [];
  const missed: string[] = [];
  const prefer = boughtBy(db, clientId);
  const push = (name: string, qty: number, pack: PackKey): void => {
    const nm = clean(name);
    if (!nm) return;
    const { product, matches } = findProduct(db, nm, prefer);
    if (!product) {
      missed.push(nm);
      return;
    }
    items.push({ text: nm, productId: product.id, pack: fitPack(product, pack), packQty: Math.max(1, qty), matches });
  };
  const rest = (t: string): void => {
    const x = clean(t);
    if (x.length < 3 || /^(спасибо|заранее спасибо)[.!]*$/i.test(x)) return;
    // «Добрый день! Нам бы на завтра» — приветствие без товара
    if (!/\d/.test(x) && /(добр|здравств|привет|спасибо)/i.test(x) && x.split(/\s+/).length <= 8) return;
    missed.push(x);
  };

  // приветствие до двоеточия отрезаем: «Добрый день! На пятницу, пожалуйста:»
  let body = raw.replace(/\r/g, '');
  const colon = body.indexOf(':');
  if (colon >= 0 && colon < 90 && !/\d/.test(body.slice(0, colon))) body = body.slice(colon + 1);

  for (const lineRaw of body.split(/\n+/)) {
    const line = lineRaw.replace(/^\s*[-—–•*\d]+[.)]\s+/, '').replace(/^\s*[-—–•*]\s*/, '');
    if (!line.trim()) continue;
    QTY_DASH.lastIndex = 0;
    let last = 0;
    let found = false;
    let m: RegExpExecArray | null;
    while ((m = QTY_DASH.exec(line))) {
      found = true;
      const name = line.slice(last, m.index);
      if (m[3]) {
        const [n, pk] = WORD_QTY[m[3].toLowerCase()] ?? [1, 'box'];
        push(name, n, pk);
      } else push(name, +m[1], unitPack(m[2]));
      last = m.index + m[0].length;
    }
    if (found) {
      rest(line.slice(last));
      continue;
    }
    // без тире — по запятым, количество в конце каждой части; если ни одна часть не товар — вся строка в «не нашли»
    const parts = line.split(/[;,](?!\d)/).map((x) => ({ x, e: QTY_END.exec(x.trim()) }));
    const hits = parts.filter(({ e }) => e && e[1] && findProduct(db, e[1]).product);
    if (!hits.length) {
      rest(line);
      continue;
    }
    for (const { x, e } of parts) {
      if (e && hits.some((h) => h.e === e)) push(e[1], +(e[2] ?? e[3]), e[2] ? 'pcs' : unitPack(e[4]));
      else rest(x);
    }
  }
  return { items, missed };
}
