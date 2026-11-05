/* Общие расчёты: периоды, цены с акциями, деньги, продажи, сверка отчёта с документами. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DB } from './types';
import { generate } from './generate';
import {
  accountBalances,
  activePromos,
  clientBalance,
  dailySeries,
  indexes,
  orderPayment,
  periodRange,
  previousRange,
  priceFor,
  salesForPeriod,
  shiftSummary,
  stockOf,
  supplierBalance,
} from './selectors';

let db: DB;
beforeAll(() => {
  db = generate();
});
const T = '2026-11-05';

describe('периоды', () => {
  it('periodRange и previousRange', () => {
    expect(periodRange('today', T)).toEqual({ kind: 'today', from: T, to: T });
    expect(periodRange('week', T)).toEqual({ kind: 'week', from: '2026-11-02', to: T });
    expect(periodRange('month', T)).toEqual({ kind: 'month', from: '2026-11-01', to: T });
    expect(periodRange('quarter', T)).toEqual({ kind: 'quarter', from: '2026-10-01', to: T });
    expect(previousRange(periodRange('today', T))).toMatchObject({ from: '2026-10-29', to: '2026-10-29' });
    expect(previousRange(periodRange('week', T))).toMatchObject({ from: '2026-10-26', to: '2026-10-29' });
    expect(previousRange(periodRange('month', T))).toMatchObject({ from: '2026-10-01', to: '2026-10-05' });
    expect(previousRange(periodRange('quarter', T))).toMatchObject({ from: '2026-07-01', to: '2026-08-05' });
    expect(previousRange({ from: '2026-10-10', to: '2026-10-19' })).toEqual({ from: '2026-09-30', to: '2026-10-09' });
    expect(previousRange({ kind: 'month', from: '2026-10-01', to: '2026-10-31' })).toMatchObject({ from: '2026-09-01', to: '2026-09-30' });
  });
});

describe('цены и акции', () => {
  it('берётся меньшая из цены клиента и акции; акция для розницы не действует на опт', () => {
    const fairy = db.products.find((p) => p.name.startsWith('Fairy') && p.volume === '450 мл' && p.active)!;
    const retail = priceFor(db, fairy.id, { priceType: 'retail', date: T });
    expect(retail.promo?.name).toBe('Fairy по спеццене');
    expect(retail.price).toBe(169);
    const wholesale = priceFor(db, fairy.id, { priceType: 'wholesale', date: T });
    expect(wholesale.promo).toBeNull();
    expect(wholesale.price).toBe(fairy.wholesalePrice);
    const before = priceFor(db, fairy.id, { priceType: 'retail', date: '2026-10-01' });
    expect(before.promo).toBeNull();
    expect(activePromos(db, T).every((p) => p.start <= T && p.end >= T && p.active)).toBe(true);
    const powder = db.products.find((p) => p.categoryId === 'cat-laundry-powder' && p.active)!;
    const pp = priceFor(db, powder.id, { priceType: 'wholesale', date: T });
    expect(pp.price).toBe(Math.round(powder.wholesalePrice * 0.9));
  });
});

describe('остатки', () => {
  it('stockOf: магазин, склад, всего, ожидается, карантин, ближайший срок', () => {
    const p = db.purchases.find((x) => x.state === 'ordered')!.lines[0].productId;
    const s = stockOf(db, p);
    expect(s.total.onHand).toBe(s.shop.onHand + s.warehouse.onHand);
    expect(s.total.available).toBe(s.total.onHand - s.total.reserved);
    expect(s.expected).toBeGreaterThan(0);
    expect(stockOf(db, 'нет-такого').total.onHand).toBe(0);
    expect(indexes(db).products.get(p)?.id).toBe(p);
  });
});

describe('деньги', () => {
  it('долг клиента = отгруженное − оплаченное; просрочка по сроку оплаты', () => {
    for (const c of db.clients.slice(0, 60)) {
      const b = clientBalance(db, c.id);
      let debt = 0;
      let overdue = 0;
      for (const o of db.orders.filter((x) => x.clientId === c.id)) {
        const p = orderPayment(db, o);
        debt += p.debt;
        if (p.overdueDays > 0) overdue += p.debt;
      }
      expect(b.debt).toBe(debt);
      expect(b.overdue).toBe(overdue);
      expect(b.creditLeft).toBe(c.creditLimit > 0 ? c.creditLimit - debt : 0);
    }
  });

  it('долги поставщикам, остатки касс, смена', () => {
    const s = db.suppliers.map((x) => supplierBalance(db, x.id));
    expect(s.reduce((a, b) => a + b.debt, 0)).toBeGreaterThan(0);
    for (const b of s) for (let i = 1; i < b.upcoming.length; i++) expect(b.upcoming[i].dueDate >= b.upcoming[i - 1].dueDate).toBe(true);
    const bal = accountBalances(db);
    expect(Object.keys(bal).sort()).toEqual(['bank', 'courier_cash', 'shop_cash']);
    const closed = db.shifts.find((x) => x.closedAt)!;
    const sum = shiftSummary(db, closed.id);
    expect(sum.receipts).toBeGreaterThan(20);
    expect(sum.expectedCash).toBe(closed.openingCash + sum.cash);
    expect(sum.difference).toBe(closed.countedCash! - sum.expectedCash);
  });
});

describe('продажи', () => {
  it('итог отчёта сверяется с документами: чеки по дате, опт по отгрузке, минус возвраты', () => {
    const from = '2026-10-01';
    const to = '2026-10-31';
    const s = salesForPeriod(db, from, to);
    let retail = 0;
    for (const r of db.receipts) {
      const d = r.at.slice(0, 10);
      if (d >= from && d <= to) retail += r.kind === 'sale' ? r.total : -r.total;
    }
    expect(s.retail).toBe(retail);
    let wholesale = 0;
    for (const m of db.movements) {
      const d = m.at.slice(0, 10);
      if (m.kind !== 'ship' || d < from || d > to) continue;
      const o = db.orders.find((x) => x.id === m.docId)!;
      wholesale += -m.dOnHand * o.lines.find((l) => l.productId === m.productId)!.price;
    }
    for (const r of db.returns) if (r.source === 'order' && r.at.slice(0, 10) >= from && r.at.slice(0, 10) <= to) wholesale -= r.amount;
    expect(s.wholesale).toBe(wholesale);
    expect(s.revenue).toBe(s.retail + s.wholesale);
    expect(s.marginPct).toBeGreaterThan(15);
    expect(s.marginPct).toBeLessThan(40);
    expect(s.costKnownShare).toBeGreaterThan(0.9);
    expect(s.costKnownShare).toBeLessThan(1);
    const series = dailySeries(db, from, to);
    expect(series).toHaveLength(31);
    expect(series.reduce((a, d) => a + d.revenue, 0)).toBe(s.revenue);
    expect(series.reduce((a, d) => a + d.receiptsCount, 0)).toBe(s.receiptsCount);
    // фильтры по сотруднику не считают дважды: сумма по ответственным = опт целиком
    const owners = [...new Set(db.orders.map((o) => o.ownerId).filter(Boolean))] as string[];
    const byOwner = owners.reduce((a, e) => a + salesForPeriod(db, from, to, { employeeId: e }).wholesale, 0);
    expect(byOwner).toBe(s.wholesale);
    const cat = salesForPeriod(db, from, to, { categoryId: 'cat-laundry' });
    expect(cat.revenue).toBeGreaterThan(0);
    expect(cat.revenue).toBeLessThan(s.revenue);
  });
});
