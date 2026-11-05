/* Общие помощники раздела «Продажи»: проверки условий клиента, этапы заказа, подписи упаковок, сумма прописью. */
import { useEffect, useState } from 'react';
import type { Client, DB, Order, OrderLine, PackKey, Product } from '../../data/types';
import { clientBalance, type OrderPayment } from '../../data/selectors';
import { fmt } from '../../ui';

export function useMedia(q: string): boolean {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const h = () => setOn(m.matches);
    h();
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [q]);
  return on;
}

/** Узкий экран: телефон представителя. */
export const useIsPhone = (): boolean => useMedia('(max-width: 760px)');

/** Короткое имя товара: без вида товара в середине. «Persil Лаванда, стиральный порошок, 4,5 кг» → «Persil Лаванда, 4,5 кг». */
export function productName(p: Product | undefined): string {
  if (!p) return 'Товар удалён';
  const parts = p.name.split(', ');
  return parts.length >= 3 ? `${parts[0]}, ${parts[parts.length - 1]}` : p.name;
}

/** «шт», «упак. 6 шт», «коробка 12 шт» — по строке документа (упаковка на момент заказа). */
export function linePackLabel(pack: PackKey, packSize: number): string {
  if (pack === 'pcs') return 'шт';
  return pack === 'box' ? `коробка ${packSize} шт` : `упак. ${packSize} шт`;
}

/** «3 × коробка 12 шт» или «24 шт» */
export function lineQtyLabel(l: Pick<OrderLine, 'pack' | 'packSize' | 'packQty' | 'qty'>): string {
  if (l.pack === 'pcs') return fmt.qty(l.qty);
  return `${fmt.num(l.packQty)} × ${linePackLabel(l.pack, l.packSize)}`;
}

export interface Problem {
  key: 'overdue' | 'limit' | 'min';
  text: string;
}

/** Те же проверки, что делает подтверждение заказа: просрочка, кредитный лимит, минимальная сумма. */
export function orderProblems(db: DB, client: Client, total: number): Problem[] {
  const b = clientBalance(db, client.id);
  const out: Problem[] = [];
  if (b.overdue > 0) out.push({ key: 'overdue', text: `просрочка ${fmt.count(b.maxOverdueDays, 'день', 'дня', 'дней')} на ${fmt.money(b.overdue)}` });
  if (client.creditLimit > 0 && client.deferDays > 0) {
    const exposure = b.debt + b.openOrders + total;
    if (exposure > client.creditLimit) out.push({ key: 'limit', text: `кредитный лимит ${fmt.money(client.creditLimit)} превышен на ${fmt.money(exposure - client.creditLimit)}` });
  }
  if (client.minOrder > 0 && total > 0 && total < client.minOrder) out.push({ key: 'min', text: `сумма меньше минимального заказа ${fmt.money(client.minOrder)}` });
  return out;
}

/** Номер документа в тексте всегда «№ 3589»: с пробелом после знака. Тексты из журнала приходят как «№3589». */
export function fixNo(s: string): string {
  return s.replace(/№[\s\u00a0]*(?=\d)/g, '№ ');
}

export function capitalize(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export type StepState = 'done' | 'current' | 'todo';

/** Этапы заказа: Заказ → Сборка → Отгрузка или доставка → Оплата. */
export function orderSteps(o: Order, pay: OrderPayment): { label: string; state: StepState }[] {
  const confirmed = o.state === 'confirmed' || o.state === 'closed';
  const shippedAll = o.ship === 'shipped' || o.ship === 'delivered';
  const picked = o.pick === 'picked' || o.ship !== 'none';
  const paid = pay.amount > 0 && (pay.state === 'paid' || pay.state === 'overpaid');
  const s1: StepState = confirmed ? 'done' : 'current';
  const s2: StepState = !confirmed ? 'todo' : picked ? 'done' : 'current';
  const handed = o.fulfillment === 'pickup' ? shippedAll : o.ship === 'delivered';
  const s3: StepState = !confirmed || !picked ? 'todo' : handed ? 'done' : 'current';
  const s4: StepState = paid ? 'done' : shippedAll || o.ship === 'partial' ? 'current' : 'todo';
  return [
    { label: 'Заказ', state: s1 },
    { label: 'Сборка', state: s2 },
    { label: o.fulfillment === 'pickup' ? 'Самовывоз' : 'Доставка', state: s3 },
    { label: 'Оплата', state: s4 },
  ];
}

/** Ближайший рабочий день после даты (воскресенье пропускаем). */
export function nextWorkday(iso: string): string {
  let d = fmt.addDays(iso, 1);
  if (fmt.toDate(d).getDay() === 0) d = fmt.addDays(d, 1);
  return d;
}

export const INTERVALS = ['09:00–12:00', '10:00–14:00', '12:00–16:00', '14:00–18:00'];

export function newKey(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const norm = (s: string): string => s.toLowerCase().replace(/ё/g, 'е');

/* ---------- сумма прописью для счёта ---------- */

const ONES_M = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const ONES_F = ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'];
const TEENS = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
const TENS = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
const HUNDREDS = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];

function triad(n: number, female: boolean): string[] {
  const out: string[] = [];
  const h = Math.floor(n / 100);
  const t = Math.floor((n % 100) / 10);
  const o = n % 10;
  if (h) out.push(HUNDREDS[h]);
  if (t === 1) out.push(TEENS[o]);
  else {
    if (t) out.push(TENS[t]);
    if (o) out.push((female ? ONES_F : ONES_M)[o]);
  }
  return out;
}

/** 36832 → «Тридцать шесть тысяч восемьсот тридцать два рубля 00 копеек» */
export function rublesInWords(value: number): string {
  const n = Math.round(Math.max(0, value));
  if (n === 0) return 'Ноль рублей 00 копеек';
  const words: string[] = [];
  const mln = Math.floor(n / 1_000_000);
  const th = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  if (mln) words.push(...triad(mln, false), fmt.plural(mln, 'миллион', 'миллиона', 'миллионов'));
  if (th) words.push(...triad(th, true), fmt.plural(th, 'тысяча', 'тысячи', 'тысяч'));
  if (rest) words.push(...triad(rest, false));
  words.push(fmt.plural(n, 'рубль', 'рубля', 'рублей'));
  return capitalize(words.join(' ')) + ' 00 копеек';
}
