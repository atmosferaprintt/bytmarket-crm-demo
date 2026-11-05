/* Расчёты раздела «Закупки»: строки закупок, оплаты по закупке, долг и просрочка. */
import type { DB, ID, Payment, Purchase, Supplier } from '../../data/types';
import { indexes, purchaseAccepted, purchasePaid } from '../../data/selectors';
import { diffDays } from '../../data/dates';
import { memoDb } from '../stock/calc';

export interface PurchaseRow {
  id: ID;
  pu: Purchase;
  supplier: Supplier | undefined;
  supplierName: string;
  positions: number;
  boxes: number;
  qty: number;
  ordered: number; // сумма заказанного
  amount: number; // по принятому, если принимали, иначе по заказанному
  accepted: number;
  paid: number;
  debt: number;
  overdueDays: number; // просрочка оплаты
  lateDays: number; // поставка опаздывает
  rest: number; // ждём штук
  hasDiff: boolean;
  defect: number;
  search: string;
}

export function purchaseRows(db: DB): PurchaseRow[] {
  return memoDb(db, 'purchaseRows', () => {
    const ix = indexes(db);
    const today = db.meta.today;
    return db.purchases.map((pu) => {
      const s = ix.suppliers.get(pu.supplierId);
      const accepted = purchaseAccepted(db, pu.id);
      const paid = purchasePaid(db, pu.id);
      const owes = pu.state === 'partial' || pu.state === 'received';
      const debt = owes ? Math.max(0, accepted - paid) : 0;
      const open = pu.state === 'ordered' || pu.state === 'partial';
      const rest = open ? pu.lines.reduce((z, l) => z + Math.max(0, l.qty - (l.received ?? 0)), 0) : 0;
      return {
        id: pu.id,
        pu,
        supplier: s,
        supplierName: s?.name ?? 'Поставщик',
        positions: pu.lines.length,
        boxes: pu.lines.reduce((z, l) => z + l.boxes, 0),
        qty: pu.lines.reduce((z, l) => z + l.qty, 0),
        ordered: pu.lines.reduce((z, l) => z + l.qty * l.price, 0),
        amount: pu.total,
        accepted,
        paid,
        debt,
        overdueDays: debt > 0 && pu.dueDate && pu.dueDate < today ? diffDays(pu.dueDate, today) : 0,
        lateDays: open && pu.expectedAt < today ? diffDays(pu.expectedAt, today) : 0,
        rest,
        hasDiff: pu.lines.some((l) => l.received !== null && (l.received !== l.qty || l.defect > 0)),
        defect: pu.lines.reduce((z, l) => z + l.defect, 0),
        search: [`${pu.number}`, s?.name ?? '', pu.comment].join(' '),
      };
    });
  });
}

export function purchaseRowOf(db: DB, id: ID): PurchaseRow | undefined {
  return purchaseRows(db).find((r) => r.id === id);
}

/** Оплаты по каждой закупке. */
export function purchasePayments(db: DB): Map<ID, { pay: Payment; amount: number }[]> {
  return memoDb(db, 'purchasePayments', () => {
    const m = new Map<ID, { pay: Payment; amount: number }[]>();
    for (const p of db.payments) {
      if (p.kind !== 'supplier' || p.status !== 'posted') continue;
      for (const a of p.allocations) {
        if (!a.purchaseId) continue;
        const list = m.get(a.purchaseId) ?? [];
        list.push({ pay: p, amount: a.amount });
        m.set(a.purchaseId, list);
      }
    }
    return m;
  });
}

export const DIFF_REASONS = ['Недовоз поставщика', 'Пересорт', 'Бой при перевозке', 'Протечка', 'Истёк срок годности', 'Излишек от поставщика', 'Брак упаковки', 'Другое'];
