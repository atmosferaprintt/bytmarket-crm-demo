/* Импорт товаров из таблицы: разбор текста (Excel, CSV), сопоставление колонок, проверка строк,
   план операций и пробный прогон на копии каталога — чтобы загрузка шла «всё или ничего». */
import type { Brand, Category, DB, ID, Product } from '../../../data/types';
import { isEan13 } from '../../../data/codes';
import { applyOp } from '../../../data/ops';

export type FieldKey = 'name' | 'brand' | 'category' | 'barcode' | 'box' | 'retail' | 'wholesale' | 'cost' | 'min';
export type Mode = 'new' | 'update';

export interface FieldDef {
  key: FieldKey;
  label: string;
  aliases: string[];
}

export const FIELDS: FieldDef[] = [
  { key: 'name', label: 'Название', aliases: ['название', 'наименование', 'товар', 'наименование товара', 'номенклатура', 'name'] },
  { key: 'brand', label: 'Бренд', aliases: ['бренд', 'марка', 'торговая марка', 'производитель', 'brand'] },
  { key: 'category', label: 'Категория', aliases: ['категория', 'группа', 'группа товаров', 'раздел', 'вид товара'] },
  { key: 'barcode', label: 'Штрихкод', aliases: ['штрихкод', 'штрих код', 'штрих-код', 'шк', 'ean', 'ean13', 'barcode'] },
  { key: 'box', label: 'Штук в коробке', aliases: ['штук в коробке', 'шт в коробке', 'в коробке', 'кратность', 'коробка', 'вложение', 'упаковка'] },
  { key: 'retail', label: 'Розница', aliases: ['розница', 'розничная цена', 'цена розница', 'цена розничная', 'цена', 'розн'] },
  { key: 'wholesale', label: 'Опт', aliases: ['опт', 'оптовая цена', 'цена опт', 'цена оптовая', 'оптовая'] },
  { key: 'cost', label: 'Себестоимость', aliases: ['себестоимость', 'закупка', 'закупочная цена', 'цена закупки', 'входная цена', 'вход'] },
  { key: 'min', label: 'Минимум', aliases: ['минимум', 'мин остаток', 'минимальный остаток', 'мин', 'неснижаемый остаток'] },
];

export const FIELD_LABEL = Object.fromEntries(FIELDS.map((f) => [f.key, f.label])) as Record<FieldKey, string>;
export const TEMPLATE_HEADER = FIELDS.map((f) => f.label);

/* ---------- текст таблицы ---------- */

function detectDelimiter(text: string): string {
  const head = text.split(/\r?\n/).slice(0, 5).join('\n');
  if (head.includes('\t')) return '\t';
  if (head.includes(';')) return ';';
  return ',';
}

/** Ячейки из текста: табуляция (вставка из Excel), «;» или «,»; кавычки по правилам CSV. Пустые строки убираются. */
export function parseTable(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  if (!src.trim()) return [];
  const d = detectDelimiter(src);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell.trim() === '') {
      quoted = true;
      cell = '';
    } else if (ch === d) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
}

/** Обратно в текст — с табуляцией, как при копировании из Excel. */
export function serializeTable(grid: string[][]): string {
  return grid.map((r) => r.map((c) => (/[\t\n"]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c)).join('\t')).join('\n');
}

const headKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.,:;()«»"'*№]/g, ' ')
    .replace(/[\s  ]+/g, ' ')
    .trim();

/** Угадать колонки по заголовкам. */
export function guessMapping(header: string[]): { mapping: (FieldKey | null)[]; matched: number } {
  const used = new Set<FieldKey>();
  let matched = 0;
  const mapping = header.map((h) => {
    const k = headKey(h);
    if (!k) return null;
    const f = FIELDS.find((x) => !used.has(x.key) && x.aliases.some((a) => a === k)) ?? FIELDS.find((x) => !used.has(x.key) && x.aliases.some((a) => a.length > 3 && k.startsWith(a)));
    if (!f) return null;
    used.add(f.key);
    matched++;
    return f.key;
  });
  return { mapping, matched };
}

/* ---------- числа ---------- */

export function parseNumber(raw: string): number | null | 'bad' {
  const s = raw
    .replace(/[\s  ]/g, '')
    .replace(/(руб\.?|р\.?|₽|шт\.?)$/i, '')
    .replace(',', '.');
  if (s === '') return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return 'bad';
  return Number(s);
}

/* ---------- названия: точный и похожий дубль ---------- */

const STOP = new Set(['для', 'и', 'с', 'в', 'на', 'по', 'от', 'из', 'без', 'со']);

export function nameTokens(name: string): { exact: string; words: Set<string>; nums: string } {
  const n = name
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/(\d)[,.](\d)/g, '$1d$2')
    .replace(/(\d)([a-zа-я])/g, '$1 $2')
    .replace(/([a-zа-я])(\d)/g, '$1 $2')
    .replace(/[^a-zа-я0-9]+/g, ' ')
    .trim();
  const all = n ? n.split(' ') : [];
  const words = new Set<string>();
  const nums: string[] = [];
  for (const t of all) {
    if (/^\d/.test(t)) nums.push(t);
    else if (!STOP.has(t)) words.add(t);
  }
  return { exact: all.join(' '), words, nums: nums.sort().join(' ') };
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Похожие названия: те же числа (объём, вес, штуки) и почти те же слова. */
export function similar(a: ReturnType<typeof nameTokens>, b: ReturnType<typeof nameTokens>): boolean {
  if (a.nums !== b.nums) return false;
  return jaccard(a.words, b.words) >= 0.75;
}

/* ---------- справочник для проверки ---------- */

export interface Catalog {
  brandByKey: Map<string, Brand>;
  catByKey: Map<string, Category>;
  byBarcode: Map<string, Product>;
  byExact: Map<string, Product>;
  tokens: ReturnType<typeof nameTokens>[];
  wordIndex: Map<string, number[]>;
  brandNames: string[];
  catNames: string[];
}

const dictKey = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s  ]+/g, ' ')
    .replace(/[«»"]/g, '')
    .trim();

export function buildCatalog(db: DB): Catalog {
  const brandByKey = new Map<string, Brand>();
  for (const b of db.brands) brandByKey.set(dictKey(b.name), b);
  const catByKey = new Map<string, Category>();
  // подкатегории важнее: «Гели для стирки» точнее, чем «Стирка»
  for (const c of db.categories) if (!c.parentId) catByKey.set(dictKey(c.name), c);
  for (const c of db.categories) if (c.parentId) catByKey.set(dictKey(c.name), c);
  const byBarcode = new Map<string, Product>();
  const byExact = new Map<string, Product>();
  const tokens: ReturnType<typeof nameTokens>[] = [];
  const wordIndex = new Map<string, number[]>();
  db.products.forEach((p, i) => {
    for (const pk of p.packs) byBarcode.set(pk.barcode, p);
    const t = nameTokens(p.name);
    tokens.push(t);
    if (!byExact.has(t.exact)) byExact.set(t.exact, p);
    for (const w of t.words) {
      let a = wordIndex.get(w);
      if (!a) wordIndex.set(w, (a = []));
      a.push(i);
    }
  });
  return {
    brandByKey,
    catByKey,
    byBarcode,
    byExact,
    tokens,
    wordIndex,
    brandNames: db.brands.map((b) => b.name).sort((a, b) => a.localeCompare(b, 'ru')),
    catNames: db.categories.map((c) => c.name).sort((a, b) => a.localeCompare(b, 'ru')),
  };
}

/** Самый похожий товар каталога или null. */
export function findSimilar(db: DB, cat: Catalog, t: ReturnType<typeof nameTokens>, exceptId?: ID): Product | null {
  const counts = new Map<number, number>();
  for (const w of t.words) for (const i of cat.wordIndex.get(w) ?? []) counts.set(i, (counts.get(i) ?? 0) + 1);
  const need = Math.max(1, Math.ceil(t.words.size * 0.6));
  let best: { i: number; s: number } | null = null;
  for (const [i, n] of counts) {
    if (n < need) continue;
    const pt = cat.tokens[i];
    if (!similar(t, pt)) continue;
    const s = jaccard(t.words, pt.words);
    if (db.products[i].id === exceptId) continue;
    if (!best || s > best.s) best = { i, s };
  }
  return best ? db.products[best.i] : null;
}

/* ---------- проверка строк ---------- */

export type IssueLevel = 'error' | 'dup' | 'note';
export interface Issue {
  level: IssueLevel;
  text: string;
  field?: FieldKey;
}

export type RowStatus = 'error' | 'dup' | 'create' | 'price' | 'same';

export interface PlanOp {
  type: 'product.create' | 'price.set';
  payload: Record<string, unknown>;
}

export interface PreviewRow {
  gridIndex: number;
  line: number; // номер строки в таблице (1 — первая строка вставки)
  raw: Partial<Record<FieldKey, string>>;
  name: string;
  brand: Brand | null;
  category: Category | null;
  barcode: string | null;
  box: number | null;
  retail: number | null;
  wholesale: number | null;
  cost: number | null;
  min: number | null;
  match: Product | null;
  issues: Issue[];
  status: RowStatus;
  op: PlanOp | null;
  change: string | null; // «розница с 189 ₽ на 199 ₽»
}

export interface Preview {
  rows: PreviewRow[];
  missing: string[]; // каких колонок не хватает
  counts: Record<RowStatus, number>;
  plan: { line: number; op: PlanOp }[];
}

const rub = (v: number) => `${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₽`;

export function buildPreview(db: DB, cat: Catalog, grid: string[][], mapping: (FieldKey | null)[], hasHeader: boolean, mode: Mode): Preview {
  const colOf: Partial<Record<FieldKey, number>> = {};
  mapping.forEach((f, i) => {
    if (f && colOf[f] === undefined) colOf[f] = i;
  });

  const missing: string[] = [];
  if (mode === 'new') {
    for (const f of ['name', 'brand', 'category', 'retail'] as FieldKey[]) if (colOf[f] === undefined) missing.push(FIELD_LABEL[f]);
  } else {
    if (colOf.name === undefined && colOf.barcode === undefined) missing.push('Название или Штрихкод');
    if (colOf.retail === undefined && colOf.wholesale === undefined) missing.push('Розница или Опт');
  }

  const counts: Record<RowStatus, number> = { error: 0, dup: 0, create: 0, price: 0, same: 0 };
  const rows: PreviewRow[] = [];
  const plan: { line: number; op: PlanOp }[] = [];
  if (!grid.length) return { rows, missing, counts, plan };

  const seenBarcode = new Map<string, number>();
  const seenExact = new Map<string, number>();
  const fileTokens: { line: number; t: ReturnType<typeof nameTokens> }[] = [];
  const minMargin = db.settings.minMarginPct;

  for (let gi = hasHeader ? 1 : 0; gi < grid.length; gi++) {
    const cells = grid[gi];
    const line = gi + 1;
    const issues: Issue[] = [];
    const err = (text: string, field?: FieldKey) => issues.push({ level: 'error', text, field });
    const dup = (text: string, field?: FieldKey) => issues.push({ level: 'dup', text, field });
    const note = (text: string, field?: FieldKey) => issues.push({ level: 'note', text, field });
    const raw: Partial<Record<FieldKey, string>> = {};
    for (const f of FIELDS) if (colOf[f.key] !== undefined) raw[f.key] = (cells[colOf[f.key]!] ?? '').trim();
    const v = (f: FieldKey) => raw[f] ?? '';

    const name = v('name').replace(/\s+/g, ' ');
    if (colOf.name !== undefined && !name) err('Пустое название', 'name');

    // штрихкод
    let barcode: string | null = null;
    const bRaw = v('barcode').replace(/[\s  ]/g, '');
    if (bRaw) {
      if (/e\+?\d+$/i.test(bRaw)) err('Штрихкод испорчен Excel (вид 4,6E+12): сделайте колонку текстовой и скопируйте заново', 'barcode');
      else if (!/^\d+$/.test(bRaw)) err('Штрихкод: только цифры', 'barcode');
      else if (bRaw.length !== 13 || !isEan13(bRaw)) err('Штрихкод: нужно 13 цифр с верной последней цифрой', 'barcode');
      else barcode = bRaw;
    }
    if (barcode) {
      const first = seenBarcode.get(barcode);
      if (first) err(`Штрихкод повторяется в таблице: строка ${first}`, 'barcode');
      else seenBarcode.set(barcode, line);
    }
    const t = name ? nameTokens(name) : null;
    const byCode = barcode ? (cat.byBarcode.get(barcode) ?? null) : null;
    const byName = t ? (cat.byExact.get(t.exact) ?? null) : null;
    const match = mode === 'update' ? (byCode ?? (colOf.barcode === undefined || !bRaw ? byName : null)) : null;
    if (mode === 'new' && byCode) err(`Штрихкод уже есть в каталоге: «${byCode.name}»`, 'barcode');

    // числа
    const numField = (f: FieldKey, label: string, kind: 'price' | 'qty', required: boolean): number | null => {
      const r = v(f);
      if (!r) {
        if (required) err(`${label}: не заполнено`, f);
        return null;
      }
      const n = parseNumber(r);
      if (n === null) return null;
      if (n === 'bad') {
        err(`${label}: «${r}» — не число`, f);
        return null;
      }
      if (kind === 'price') {
        if (n <= 0) {
          err(`${label}: нужна сумма больше нуля`, f);
          return null;
        }
        const k = Math.round(n);
        if (k !== n) note(`${label} округлена до ${rub(k)}`, f);
        return k;
      }
      if (!Number.isInteger(n)) {
        err(`${label}: нужно целое число`, f);
        return null;
      }
      return n;
    };

    let brand: Brand | null = null;
    let category: Category | null = null;
    let retail: number | null = null;
    let wholesale: number | null = null;
    let cost: number | null = null;
    let box: number | null = null;
    let min: number | null = null;
    let op: PlanOp | null = null;
    let change: string | null = null;
    let action: 'create' | 'price' | 'same' = 'create';

    if (match) {
      // найден в каталоге — обновляем только цены
      retail = numField('retail', 'Розница', 'price', false);
      wholesale = numField('wholesale', 'Опт', 'price', false);
      brand = cat.brandByKey.get(dictKey(v('brand'))) ?? null;
      category = cat.catByKey.get(dictKey(v('category'))) ?? null;
      if (!byCode && byName) note('Найден по названию');
      if (retail === null && wholesale === null && !issues.some((i) => i.level === 'error')) err('Для обновления нужна цена: розница или опт', 'retail');
      const nr = retail ?? match.retailPrice;
      const nw = wholesale ?? match.wholesalePrice;
      if (nw > nr) err('Опт дороже розницы', 'wholesale');
      if (nr === match.retailPrice && nw === match.wholesalePrice) {
        action = 'same';
        note('Цена не изменилась');
      } else {
        action = 'price';
        const parts: string[] = [];
        if (nr !== match.retailPrice) parts.push(`розница с ${rub(match.retailPrice)} на ${rub(nr)}`);
        if (nw !== match.wholesalePrice) parts.push(`опт с ${rub(match.wholesalePrice)} на ${rub(nw)}`);
        change = parts.join(', ');
        op = { type: 'price.set', payload: { productId: match.id, retailPrice: nr, wholesalePrice: nw } };
      }
    } else {
      if (mode === 'update') {
        const need = (['name', 'brand', 'category', 'retail'] as FieldKey[]).filter((f) => colOf[f] === undefined);
        if (need.length) err(`Товара нет в каталоге. Для нового нужны колонки: ${need.map((f) => FIELD_LABEL[f]).join(', ')}`);
      }
      const bName = v('brand');
      if (colOf.brand !== undefined) {
        if (!bName) err('Бренд: не заполнен', 'brand');
        else {
          brand = cat.brandByKey.get(dictKey(bName)) ?? null;
          if (!brand) err(`Бренда «${bName}» нет в справочнике`, 'brand');
        }
      }
      const cName = v('category');
      if (colOf.category !== undefined) {
        if (!cName) err('Категория: не заполнена', 'category');
        else {
          category = cat.catByKey.get(dictKey(cName)) ?? null;
          if (!category) err(`Категории «${cName}» нет в справочнике`, 'category');
        }
      }
      retail = numField('retail', 'Розница', 'price', colOf.retail !== undefined);
      wholesale = numField('wholesale', 'Опт', 'price', false);
      cost = numField('cost', 'Себестоимость', 'price', false);
      box = numField('box', 'Штук в коробке', 'qty', false);
      min = numField('min', 'Минимум', 'qty', false);
      if (box !== null && box < 1) err('Штук в коробке: нужно 1 или больше', 'box');
      if (retail !== null && wholesale !== null && wholesale > retail) err('Опт дороже розницы', 'wholesale');
      if (retail !== null && wholesale === null && colOf.wholesale !== undefined) note('Опт не указан — будет как розница', 'wholesale');
      if (cost === null && colOf.cost !== undefined && v('cost') === '') note('Себестоимость не указана — прибыль по товару будет неполной', 'cost');
      const sale = wholesale ?? retail;
      if (cost !== null && sale !== null && sale < Math.ceil((cost * (100 + minMargin)) / 100)) note(`Цена ниже минимальной наценки ${minMargin} %`, 'wholesale');

      // дубли по названию: в каталоге и в самой таблице
      if (t) {
        const sameLine = seenExact.get(t.exact);
        if (sameLine) dup(`Повторяет строку ${sameLine}`, 'name');
        else {
          seenExact.set(t.exact, line);
          if (byName && !byCode) dup(`Такое название уже есть: «${byName.name}»`, 'name');
          else if (!byCode) {
            const s = findSimilar(db, cat, t);
            if (s) dup(`Похоже на «${s.name}»`, 'name');
            else if (grid.length <= 400) {
              const f = fileTokens.find((x) => similar(x.t, t));
              if (f) dup(`Похоже на строку ${f.line}`, 'name');
            }
          }
          fileTokens.push({ line, t });
        }
      }

      if (brand && category && retail !== null && name) {
        const packs: Record<string, unknown>[] = [{ key: 'pcs', ...(barcode ? { barcode } : {}) }];
        if (box !== null && box > 1) packs.push({ key: 'box', qty: box });
        op = {
          type: 'product.create',
          payload: {
            name,
            brandId: brand.id,
            categoryId: category.id,
            retailPrice: retail,
            ...(wholesale !== null ? { wholesalePrice: wholesale } : {}),
            ...(cost !== null ? { cost } : {}),
            minStock: min ?? 0,
            packs,
          },
        };
      }
    }

    const hasErr = issues.some((i) => i.level === 'error');
    const hasDup = issues.some((i) => i.level === 'dup');
    const status: RowStatus = hasErr ? 'error' : hasDup ? 'dup' : action;
    if (hasErr) op = null;
    counts[status]++;
    if (op) plan.push({ line, op });
    rows.push({ gridIndex: gi, line, raw, name, brand, category, barcode, box, retail, wholesale, cost, min, match, issues, status, op, change });
  }
  return { rows, missing, counts, plan };
}

/** Пробный прогон на копии каталога: те же операции, что при загрузке, но база не меняется.
    Возвращает ошибки по номерам строк. */
export function dryRun(db: DB, plan: { line: number; op: PlanOp }[], actorId: ID, at: string): Map<number, string> {
  const errors = new Map<number, string>();
  if (!plan.length) return errors;
  const copy: DB = {
    ...db,
    meta: { ...db.meta },
    counters: { ...db.counters },
    products: db.products.map((p) => ({ ...p, packs: p.packs.map((k) => ({ ...k })) })),
    priceChanges: [...db.priceChanges],
    audit: [...db.audit],
  };
  for (const { line, op } of plan) {
    try {
      applyOp(copy, op.type, op.payload, { actorId, at });
    } catch (e) {
      errors.set(line, e instanceof Error ? e.message : String(e));
    }
  }
  return errors;
}
