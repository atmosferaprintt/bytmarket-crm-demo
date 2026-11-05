/* Короткие тексты для сообщений операций и истории: «12 400 ₽», «36 шт», «5 дней».
   Те же правила, что в ui/format: узкий пробел между разрядами, неразрывный перед ₽ и шт. */

const NB = ' ';
const THIN = ' ';

export function groupNum(v: number): string {
  const sign = v < 0 ? '−' : '';
  return sign + String(Math.abs(Math.round(v))).replace(/\B(?=(\d{3})+(?!\d))/g, THIN);
}

export const rub = (v: number): string => groupNum(v) + NB + '₽';
export const pcs = (v: number): string => groupNum(v) + NB + 'шт';
export const pct = (v: number): string => String(Math.round(v * 10) / 10).replace('.', ',') + NB + '%';

export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}

export const days = (n: number): string => `${n}${NB}${plural(n, 'день', 'дня', 'дней')}`;
