/* Проверка согласованности базы. Возвращает список нарушений по-русски; пустой список — всё сходится.
   Остатки = сумма движений; резерв = неотгруженное по подтверждённым заказам; ничего не в минусе;
   партии = факт; распределение платежа не больше суммы; номера документов растут по дате. */
import type { DB, ID } from './types';
import { accountBalances } from './selectors';

export function checkInvariants(db: DB, opts: { allowReserveOverOnHand?: boolean } = {}): string[] {
  const problems: string[] = [];
  const push = (s: string): void => {
    if (problems.length < 50) problems.push(s);
  };
  const key = (p: ID, l: string): string => p + '|' + l;

  // остатки = сумма движений
  const sum = new Map<string, { on: number; res: number }>();
  for (const m of db.movements) {
    const k = key(m.productId, m.location);
    const s = sum.get(k) ?? { on: 0, res: 0 };
    s.on += m.dOnHand;
    s.res += m.dReserved;
    sum.set(k, s);
  }
  const rows = new Set<string>();
  for (const r of db.stock) {
    const k = key(r.productId, r.location);
    rows.add(k);
    const s = sum.get(k) ?? { on: 0, res: 0 };
    if (s.on !== r.onHand) push(`Остаток ${k}: в строке ${r.onHand}, по движениям ${s.on}`);
    if (s.res !== r.reserved) push(`Резерв ${k}: в строке ${r.reserved}, по движениям ${s.res}`);
    if (r.onHand < 0) push(`Отрицательный остаток ${k}: ${r.onHand}`);
    if (r.reserved < 0) push(`Отрицательный резерв ${k}: ${r.reserved}`);
    if (!opts.allowReserveOverOnHand && r.reserved > r.onHand) push(`Резерв больше факта ${k}: ${r.reserved} > ${r.onHand}`);
  }
  for (const [k, s] of sum) if (!rows.has(k) && (s.on !== 0 || s.res !== 0)) push(`Движения без строки остатка: ${k}`);

  // резерв = неотгруженное по подтверждённым заказам
  const need = new Map<string, number>();
  for (const o of db.orders) {
    if (o.state !== 'confirmed') continue;
    for (const l of o.lines) {
      const rest = l.qty - l.shipped;
      if (rest > 0) need.set(key(l.productId, o.location), (need.get(key(l.productId, o.location)) ?? 0) + rest);
    }
  }
  for (const r of db.stock) {
    const n = need.get(key(r.productId, r.location)) ?? 0;
    if (n !== r.reserved) push(`Резерв ${key(r.productId, r.location)}: ${r.reserved}, а по заказам ${n}`);
  }
  for (const [k, n] of need) if (!rows.has(k) && n > 0) push(`Нет строки резерва для ${k}: по заказам ${n}`);

  // строки заказов и чеков
  for (const o of db.orders) {
    let total = 0;
    for (const l of o.lines) {
      if (l.qty !== l.packQty * l.packSize) push(`Заказ №${o.number}: ${l.packQty} × ${l.packSize} ≠ ${l.qty}`);
      if (l.shipped < 0 || l.shipped > l.qty) push(`Заказ №${o.number}: отгружено ${l.shipped} из ${l.qty}`);
      total += l.qty * l.price;
    }
    if (total !== o.total) push(`Заказ №${o.number}: сумма ${o.total}, по строкам ${total}`);
    if (o.state === 'closed' && o.ship === 'none') push(`Заказ №${o.number} закрыт без отгрузки`);
  }
  for (const r of db.receipts) {
    const total = r.lines.reduce((s, l) => s + l.qty * l.price, 0);
    if (total !== r.total) push(`Чек №${r.number}: сумма ${r.total}, по строкам ${total}`);
    if (r.kind === 'sale' && r.cash + r.card - r.change !== r.total) push(`Чек №${r.number}: оплата не сходится`);
  }

  // партии со сроком = факт
  const tracked = new Set(db.products.filter((p) => p.expiryTracked).map((p) => p.id));
  const bsum = new Map<string, number>();
  for (const b of db.batches) {
    if (b.qty < 0) push(`Отрицательная партия ${b.id}`);
    bsum.set(key(b.productId, b.location), (bsum.get(key(b.productId, b.location)) ?? 0) + b.qty);
  }
  for (const r of db.stock) {
    if (!tracked.has(r.productId)) continue;
    const b = bsum.get(key(r.productId, r.location)) ?? 0;
    if (b !== r.onHand) push(`Партии ${key(r.productId, r.location)}: ${b}, а факт ${r.onHand}`);
  }

  // деньги
  for (const p of db.payments) {
    const a = p.allocations.reduce((s, x) => s + x.amount, 0);
    if (p.amount <= 0) push(`Платёж №${p.number}: сумма ${p.amount}`);
    if (a > p.amount) push(`Платёж №${p.number}: распределено ${a} больше суммы ${p.amount}`);
    if (p.allocations.some((x) => x.amount <= 0)) push(`Платёж №${p.number}: пустое распределение`);
  }
  const bal = accountBalances(db);
  for (const [k, v] of Object.entries(bal)) if (v < 0) push(`Отрицательный остаток денег «${k}»: ${v}`);

  // номера документов растут по дате
  const seq = <T extends { number: number }>(name: string, list: T[], at: (x: T) => string): void => {
    const s = list.slice().sort((a, b) => a.number - b.number);
    for (let i = 1; i < s.length; i++) {
      if (at(s[i]) < at(s[i - 1])) {
        push(`${name}: №${s[i].number} раньше №${s[i - 1].number}`);
        break;
      }
    }
  };
  seq('Заказы', db.orders, (x) => x.createdAt);
  seq('Чеки', db.receipts, (x) => x.at);
  seq('Платежи', db.payments, (x) => x.at);
  seq('Закупки', db.purchases, (x) => x.createdAt);
  seq('Складские документы', db.stockDocs, (x) => x.at);
  seq('Возвраты', db.returns, (x) => x.at);
  seq('Смены', db.shifts, (x) => x.openedAt);
  return problems;
}
