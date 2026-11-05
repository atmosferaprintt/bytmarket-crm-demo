/* Штрихкоды EAN-13 и ИНН с контрольными цифрами. */

export function ean13CheckDigit(d12: string): number {
  let s = 0;
  for (let i = 0; i < 12; i++) s += (d12.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  return (10 - (s % 10)) % 10;
}

/** Полный EAN-13 из 12 цифр. */
export function makeEan13(d12: string): string {
  if (!/^\d{12}$/.test(d12)) throw new Error('Для EAN-13 нужно 12 цифр');
  return d12 + ean13CheckDigit(d12);
}

export function isEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === code.charCodeAt(12) - 48;
}

const K10 = [2, 4, 10, 3, 5, 9, 4, 6, 8];
const K11 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
const K12 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];

function ctrl(digits: string, k: number[]): number {
  let s = 0;
  for (let i = 0; i < k.length; i++) s += (digits.charCodeAt(i) - 48) * k[i];
  return (s % 11) % 10;
}

/** ИНН организации (10 цифр) из первых 9. */
export function makeInn10(d9: string): string {
  return d9 + ctrl(d9, K10);
}

/** ИНН ИП или физлица (12 цифр) из первых 10. */
export function makeInn12(d10: string): string {
  const d11 = d10 + ctrl(d10, K11);
  return d11 + ctrl(d11, K12);
}

export function isInn(code: string): boolean {
  if (/^\d{10}$/.test(code)) return ctrl(code, K10) === code.charCodeAt(9) - 48;
  if (/^\d{12}$/.test(code)) return ctrl(code, K11) === code.charCodeAt(10) - 48 && ctrl(code, K12) === code.charCodeAt(11) - 48;
  return false;
}
