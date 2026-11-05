/* Генератор: детерминизм, согласованность, объёмы и время. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DB } from './types';
import { generate } from './generate';
import { checkInvariants } from './invariants';
import { isEan13, isInn } from './codes';
import { accountBalances, clientBalance, courierCash, orderPayment, salesForPeriod, shiftSummary, stockIndex, supplierBalance } from './selectors';
import { diffDays, dow, plusDays } from './dates';
import { MISSED_ORDER_FACTOR } from './thresholds';

let db: DB;
let genMs = 0;

beforeAll(() => {
  const t0 = performance.now();
  db = generate();
  genMs = performance.now() - t0;
  console.info(`Генерация базы демо: ${Math.round(genMs)} мс`);
});

const T = '2026-11-05';
const share = (n: number, d: number): number => (d ? n / d : 0);

describe('детерминизм', () => {
  it('два вызова generate() дают одинаковую базу', () => {
    const b = generate();
    const strip = (x: DB): string => JSON.stringify({ ...x, meta: { ...x.meta, version: 0 } });
    expect(strip(b)).toBe(strip(db));
  });

  it('другое зерно — другая база', () => {
    const b = generate(7);
    expect(b.orders.length === db.orders.length && b.receipts.length === db.receipts.length && b.movements.length === db.movements.length).toBe(false);
  });
});

describe('согласованность', () => {
  it('остатки = движения, резерв = подтверждённые заказы, ничего в минусе, партии = факт', () => {
    expect(checkInvariants(db)).toEqual([]);
  });

  it('движения идут по времени и у каждого есть документ и автор', () => {
    const emp = new Set(db.employees.map((e) => e.id));
    for (let i = 1; i < db.movements.length; i++) expect(db.movements[i].at >= db.movements[i - 1].at).toBe(true);
    for (const m of db.movements) {
      expect(m.docId).toBeTruthy();
      expect(emp.has(m.authorId)).toBe(true);
    }
  });

  it('у каждой доставки, кроме ожидающих назначения, ровно один курьер из трёх', () => {
    const couriers = new Set(['e-morozov', 'e-zaytsev', 'e-vlasov']);
    for (const d of db.deliveries) {
      if (d.state === 'waiting') expect(d.courierId).toBeNull();
      else expect(couriers.has(d.courierId ?? '')).toBe(true);
      for (const a of d.attempts) expect(couriers.has(a.courierId)).toBe(true);
    }
  });

  it('каждый оптовый клиент закреплён ровно за одним менеджером или представителем', () => {
    const roles = new Map(db.employees.map((e) => [e.id, e.roles]));
    for (const c of db.clients) {
      if (c.segment === 'retail') continue;
      expect(c.ownerId).toBeTruthy();
      expect(roles.get(c.ownerId!)?.some((r) => r === 'manager' || r === 'rep')).toBe(true);
    }
  });

  it('штрихкоды EAN-13 корректны и уникальны, ИНН с верной контрольной цифрой', () => {
    const seen = new Set<string>();
    for (const p of db.products) {
      expect(p.packs[0].key).toBe('pcs');
      for (const k of p.packs) {
        expect(isEan13(k.barcode)).toBe(true);
        expect(seen.has(k.barcode)).toBe(false);
        seen.add(k.barcode);
        if (k.key !== 'pcs') expect([6, 12, 20, 24]).toContain(k.qty);
      }
    }
    for (const c of db.clients) if (c.inn) expect(isInn(c.inn)).toBe(true);
    for (const s of db.suppliers) expect(isInn(s.inn)).toBe(true);
    expect(isInn(db.settings.company.inn)).toBe(true);
    expect(db.settings.company.inn.startsWith('30')).toBe(true);
  });

  it('деньги в кассах и на счёте не уходят в минус', () => {
    const b = accountBalances(db);
    expect(b.bank).toBeGreaterThan(0);
    expect(b.shop_cash).toBeGreaterThanOrEqual(0);
    expect(b.courier_cash).toBeGreaterThanOrEqual(0);
  });
});

describe('объёмы и правила задания', () => {
  it('время генерации до 1,5 с', () => {
    expect(genMs).toBeLessThan(1500);
  });

  it('каталог: ~1000 товаров, 10 категорий по 2–5 подкатегорий, 30–40 брендов, группы 2–4', () => {
    expect(db.products.length).toBeGreaterThanOrEqual(950);
    expect(db.products.length).toBeLessThanOrEqual(1050);
    const top = db.categories.filter((c) => c.parentId === null);
    expect(top.length).toBe(10);
    for (const c of top) {
      const n = db.categories.filter((x) => x.parentId === c.id).length;
      expect(n).toBeGreaterThanOrEqual(2);
      expect(n).toBeLessThanOrEqual(5);
    }
    expect(db.brands.length).toBeGreaterThanOrEqual(30);
    expect(db.brands.length).toBeLessThanOrEqual(40);
    const g = new Map<string, number>();
    for (const p of db.products) if (p.groupId) g.set(p.groupId, (g.get(p.groupId) ?? 0) + 1);
    for (const n of g.values()) expect(n >= 2 && n <= 4).toBe(true);
  });

  it('цены: розница на 0/5/9, опт ниже, себестоимость ~55–75 %, у ~5 % её нет', () => {
    const changed = new Set(db.priceChanges.map((c) => c.productId));
    for (const p of db.products) {
      expect(Number.isInteger(p.retailPrice)).toBe(true);
      expect([0, 5, 9]).toContain(p.retailPrice % 10);
      expect(p.wholesalePrice).toBeLessThan(p.retailPrice);
      if (!changed.has(p.id)) {
        const d = 1 - p.wholesalePrice / p.retailPrice;
        expect(d).toBeGreaterThanOrEqual(0.075);
        expect(d).toBeLessThanOrEqual(0.155);
      }
    }
    const noCost = db.products.filter((p) => p.cost === null).length;
    expect(share(noCost, db.products.length)).toBeGreaterThan(0.03);
    expect(share(noCost, db.products.length)).toBeLessThan(0.07);
  });

  it('остатки: ~5 % неактивных, 3–5 % с нулём, ~5 % ниже минимума, дефицит ходовых, залежалые, сроки', () => {
    const si = stockIndex(db);
    const n = db.products.length;
    const inactive = db.products.filter((p) => !p.active).length;
    expect(share(inactive, n)).toBeGreaterThan(0.03);
    expect(share(inactive, n)).toBeLessThan(0.07);
    const zero = db.products.filter((p) => si.get(p.id)!.total.onHand === 0).length;
    expect(share(zero, n)).toBeGreaterThanOrEqual(0.025);
    expect(share(zero, n)).toBeLessThanOrEqual(0.06);
    const below = db.products.filter((p) => p.active && si.get(p.id)!.total.available > 0 && si.get(p.id)!.total.available < p.minStock).length;
    expect(share(below, n)).toBeGreaterThanOrEqual(0.025);
    expect(share(below, n)).toBeLessThanOrEqual(0.08);
    // ходовые за 30 дней, у которых доступно меньше минимума
    const from = plusDays(T, -30);
    const sold = new Map<string, number>();
    for (const m of db.movements) if ((m.kind === 'sale' || m.kind === 'ship') && m.at.slice(0, 10) >= from) sold.set(m.productId, (sold.get(m.productId) ?? 0) - m.dOnHand);
    const top = [...sold.entries()].sort((a, b) => b[1] - a[1]).slice(0, 120);
    const deficit = top.filter(([id]) => si.get(id)!.total.available < db.products.find((p) => p.id === id)!.minStock);
    expect(deficit.length).toBeGreaterThanOrEqual(15);
    // без движения 45+ дней (только начальный остаток)
    const last = new Map<string, string>();
    for (const m of db.movements) if (m.kind !== 'initial') last.set(m.productId, m.at);
    const still = db.products.filter((p) => p.active && si.get(p.id)!.total.onHand > 0 && (last.get(p.id) ?? '0') < plusDays(T, -45));
    expect(still.length).toBeGreaterThanOrEqual(20);
    // сроки годности
    const tracked = db.products.filter((p) => p.expiryTracked).length;
    expect(share(tracked, n)).toBeGreaterThan(0.12);
    expect(share(tracked, n)).toBeLessThan(0.18);
    const near = db.products.filter((p) => {
      const e = si.get(p.id)!.nearestExpiry;
      return e !== null && e <= plusDays(T, 30);
    }).length;
    expect(near).toBeGreaterThanOrEqual(10);
    expect(near).toBeLessThanOrEqual(20);
  });

  it('сотрудники: без дублей и без «Демо», курьеры — Денис, Артём, Кирилл', () => {
    const names = db.employees.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.some((x) => /демо/i.test(x))).toBe(false);
    expect(names).toEqual(
      expect.arrayContaining([
        'Александр Волков', 'Анна Орлова', 'Виктория Ким', 'Михаил Соколов', 'Ирина Петрова', 'Елена Миронова', 'Руслан Абдуллаев', 'Олег Тарасов',
        'Ольга Белова', 'Сергей Крылов', 'Тимур Исмаилов', 'Марина Лебедева', 'Денис Морозов', 'Артём Зайцев', 'Кирилл Власов',
      ]),
    );
    expect(db.employees.find((e) => e.id === 'e-volkov')!.roles).toEqual(['owner', 'manager']);
    expect(db.employees.filter((e) => e.roles.includes('courier')).map((e) => e.name).sort()).toEqual(['Артём Зайцев', 'Денис Морозов', 'Кирилл Власов']);
  });

  it('поставщики и закупки: 6–8 поставщиков, 30–40 закупок, 2–3 в пути, одна частичная, расхождения, долги', () => {
    expect(db.suppliers.length).toBeGreaterThanOrEqual(6);
    expect(db.suppliers.length).toBeLessThanOrEqual(8);
    expect(db.purchases.length).toBeGreaterThanOrEqual(30);
    expect(db.purchases.length).toBeLessThanOrEqual(40);
    const transit = db.purchases.filter((p) => p.state === 'ordered');
    expect(transit.length).toBeGreaterThanOrEqual(2);
    expect(transit.length).toBeLessThanOrEqual(3);
    for (const p of transit) expect(p.expectedAt > T && p.expectedAt <= plusDays(T, 7)).toBe(true);
    expect(db.purchases.filter((p) => p.state === 'partial').length).toBe(1);
    expect(db.purchases.filter((p) => p.lines.some((l) => l.diffReason)).length).toBeGreaterThanOrEqual(5);
    expect(db.purchases.some((p) => p.lines.some((l) => l.defect > 0))).toBe(true);
    const sb = db.suppliers.map((s) => supplierBalance(db, s.id));
    expect(sb.some((b) => b.overdue > 0)).toBe(true);
    expect(sb.some((b) => b.upcoming.some((u) => u.dueDate >= T && u.dueDate <= plusDays(T, 6)))).toBe(true);
  });

  it('клиенты: 80–120, сегменты, точки у представителей 25–40, отсрочки, лимиты, долги и просрочка', () => {
    expect(db.clients.length).toBeGreaterThanOrEqual(80);
    expect(db.clients.length).toBeLessThanOrEqual(120);
    const seg = (s: string): number => db.clients.filter((c) => c.segment === s).length / db.clients.length;
    expect(seg('shop')).toBeGreaterThan(0.35);
    expect(seg('retail')).toBeGreaterThan(0.18);
    expect(seg('market')).toBeGreaterThan(0.08);
    expect(seg('horeca') + seg('cleaning')).toBeGreaterThan(0.1);
    for (const rep of ['e-mironova', 'e-abdullaev', 'e-tarasov']) {
      const pts = db.clients.filter((c) => c.ownerId === rep).reduce((s, c) => s + c.points.length, 0);
      expect(pts).toBeGreaterThanOrEqual(25);
      expect(pts).toBeLessThanOrEqual(40);
    }
    for (const c of db.clients) {
      expect([0, 7, 14, 21, 30]).toContain(c.deferDays);
      for (const pt of c.points) {
        expect(Math.abs(pt.lat - 46.35)).toBeLessThan(0.08);
        expect(Math.abs(pt.lng - 48.04)).toBeLessThan(0.1);
      }
    }
    const wholesale = db.clients.filter((c) => c.segment !== 'retail');
    const bal = wholesale.map((c) => ({ c, b: clientBalance(db, c.id) }));
    const overdue = bal.filter((x) => x.b.overdue > 0).length;
    expect(overdue).toBeGreaterThanOrEqual(8);
    expect(overdue).toBeLessThanOrEqual(12);
    const over = bal.filter((x) => x.c.creditLimit > 0 && x.b.debt > x.c.creditLimit).length;
    expect(over).toBeGreaterThanOrEqual(2);
    expect(over).toBeLessThanOrEqual(3);
    expect(bal.filter((x) => x.b.debt > 0).length).toBeGreaterThanOrEqual(wholesale.length * 0.2);
    expect(db.clients.filter((c) => c.segment === 'retail').every((c) => c.note.includes('Карта'))).toBe(true);
  });

  it('касса: смена каждый день, 25–40 чеков в будни, средний чек 450–1200 ₽, сегодня открыта смена Анны', () => {
    const days = new Set(db.shifts.map((s) => s.openedAt.slice(0, 10)));
    expect(days.size).toBe(93);
    const per = new Map<string, number>();
    for (const r of db.receipts) if (r.kind === 'sale') per.set(r.at.slice(0, 10), (per.get(r.at.slice(0, 10)) ?? 0) + 1);
    for (const [d, n] of per) {
      if (d === T) continue;
      const w = dow(d);
      if (w >= 1 && w <= 5) {
        expect(n).toBeGreaterThanOrEqual(25);
        expect(n).toBeLessThanOrEqual(40);
      }
    }
    const open = db.shifts.filter((s) => !s.closedAt);
    expect(open.length).toBe(1);
    expect(open[0].sellerId).toBe('e-orlova');
    expect(open[0].openedAt.startsWith(T)).toBe(true);
    const today = per.get(T) ?? 0;
    expect(today).toBeGreaterThanOrEqual(16);
    expect(today).toBeLessThanOrEqual(24);
    expect(db.receipts.every((r) => r.at <= T + 'T14:00')).toBe(true);
    const sales = db.receipts.filter((r) => r.kind === 'sale');
    const avg = sales.reduce((s, r) => s + r.total, 0) / sales.length;
    expect(avg).toBeGreaterThan(450);
    expect(avg).toBeLessThan(1200);
    expect(sales.some((r) => r.card > 0 && r.cash > 0)).toBe(true);
    expect(sales.some((r) => r.change > 0)).toBe(true);
    expect(sales.some((r) => r.lines.some((l) => l.discountPct > 0 && l.discountReason))).toBe(true);
    expect(db.receipts.some((r) => r.kind === 'refund')).toBe(true);
    // выручка смены — по записи на смену и способ, у открытой смены — нет
    const shiftPays = db.payments.filter((p) => p.kind === 'shift');
    expect(shiftPays.some((p) => p.shiftId === open[0].id)).toBe(false);
    const closed = db.shifts.find((s) => s.closedAt)!;
    expect(shiftPays.filter((p) => p.shiftId === closed.id).length).toBeLessThanOrEqual(2);
    expect(shiftSummary(db, open[0].id).receipts).toBe(today);
  });

  it('опт: 300–600 заказов, ~2 % отмен, частичные отгрузки, сегодня 5–8 заявок и 10–15 в работе', () => {
    expect(db.orders.length).toBeGreaterThanOrEqual(300);
    expect(db.orders.length).toBeLessThanOrEqual(600);
    const cancelled = db.orders.filter((o) => o.state === 'cancelled').length;
    expect(share(cancelled, db.orders.length)).toBeGreaterThan(0.005);
    expect(share(cancelled, db.orders.length)).toBeLessThan(0.04);
    const partial = db.orders.filter((o) => o.history.some((h) => h.text.startsWith('Отгружено частично'))).length;
    expect(partial).toBeGreaterThanOrEqual(3);
    expect(partial).toBeLessThanOrEqual(5);
    const requests = db.orders.filter((o) => o.state === 'request');
    expect(requests.length).toBeGreaterThanOrEqual(5);
    expect(requests.length).toBeLessThanOrEqual(8);
    const work = db.orders.filter((o) => o.state === 'confirmed');
    expect(work.length).toBeGreaterThanOrEqual(10);
    expect(work.length).toBeLessThanOrEqual(15);
    expect(work.some((o) => o.pick === 'picking')).toBe(true);
    expect(work.some((o) => o.pick === 'picked')).toBe(true);
    expect(db.orders.some((o) => o.source === 'repeat')).toBe(true);
    expect(db.orders.some((o) => o.history.some((h) => h.text.startsWith('Подтверждено владельцем сверх лимита')))).toBe(true);
    // номера растут по дате: первые заказы — старые
    const sorted = db.orders.slice().sort((a, b) => a.number - b.number);
    expect(sorted[0].createdAt.slice(0, 10)).toBe('2026-08-05');
  });

  it('деньги: способы оплаты, 2–3 ожидающих, 2 неопознанных, переплаты, инкассация, расходы помесячно', () => {
    const client = db.payments.filter((p) => p.kind === 'client');
    for (const m of ['cash', 'card', 'transfer'] as const) expect(client.some((p) => p.method === m)).toBe(true);
    const pending = client.filter((p) => p.status === 'pending').length;
    expect(pending).toBeGreaterThanOrEqual(2);
    expect(pending).toBeLessThanOrEqual(3);
    expect(client.filter((p) => p.status === 'unidentified').length).toBe(2);
    expect(client.some((p) => p.allocations.length > 1)).toBe(true);
    expect(client.some((p) => p.status === 'posted' && p.allocations.reduce((s, a) => s + a.amount, 0) < p.amount)).toBe(true);
    expect(db.payments.some((p) => p.kind === 'transfer' && p.account === 'shop_cash' && p.toAccount === 'bank')).toBe(true);
    expect(db.payments.some((p) => p.kind === 'transfer' && p.account === 'courier_cash' && p.toAccount === 'shop_cash')).toBe(true);
    const exp = db.payments.filter((p) => p.kind === 'expense');
    const byMonth = (cat: string, m: string): number => exp.filter((p) => p.expenseCategory === cat && p.at.startsWith(m)).reduce((s, p) => s + p.amount, 0);
    for (const m of ['2026-09', '2026-10']) {
      expect(byMonth('Аренда', m)).toBe(180000);
      expect(byMonth('Зарплата', m)).toBeGreaterThan(600000);
      expect(byMonth('Зарплата', m)).toBeLessThan(700000);
    }
    expect(db.payments.filter((p) => p.kind === 'supplier').length).toBeGreaterThan(10);
  });

  it('склад: начальные остатки, перемещения 2–3 раза в неделю, 2 пересчёта, 15–25 списаний по 4 причинам, 15–25 возвратов', () => {
    expect(db.stockDocs.filter((d) => d.kind === 'initial').length).toBe(2);
    expect(db.stockDocs.filter((d) => d.kind === 'transfer').length).toBeGreaterThanOrEqual(30);
    const counts = db.stockDocs.filter((d) => d.kind === 'count');
    expect(counts.length).toBe(2);
    for (const c of counts) expect(c.lines.some((l) => l.qty !== l.expected)).toBe(true);
    const wo = db.stockDocs.filter((d) => d.kind === 'writeoff');
    expect(wo.length).toBeGreaterThanOrEqual(15);
    expect(wo.length).toBeLessThanOrEqual(25);
    const reasons = new Set(wo.flatMap((d) => d.lines.map((l) => l.reason)));
    for (const r of ['leak', 'damage', 'expired', 'shortage']) expect(reasons.has(r as never)).toBe(true);
    expect(db.returns.length).toBeGreaterThanOrEqual(15);
    expect(db.returns.length).toBeLessThanOrEqual(25);
    expect(db.returns.some((r) => r.source === 'receipt')).toBe(true);
    expect(db.returns.some((r) => r.source === 'order')).toBe(true);
    expect(db.quarantine.some((q) => q.state === 'check')).toBe(true);
  });

  it('доставка: ~150, неудачные попытки, возвраты на склад, сегодня — все статусы, 1–2 курьера не сдали деньги', () => {
    expect(db.deliveries.length).toBeGreaterThanOrEqual(120);
    expect(db.deliveries.length).toBeLessThanOrEqual(200);
    const failed = db.deliveries.reduce((s, d) => s + d.attempts.filter((a) => a.result === 'failed').length, 0);
    expect(failed).toBeGreaterThanOrEqual(10);
    expect(failed).toBeLessThanOrEqual(16);
    const returned = db.deliveries.filter((d) => d.state === 'returned').length;
    expect(returned).toBeGreaterThanOrEqual(2);
    expect(returned).toBeLessThanOrEqual(3);
    expect(db.deliveries.some((d) => d.attempts.length >= 2 && d.state === 'delivered')).toBe(true);
    const today = db.deliveries.filter((d) => d.date === T);
    const st = (s: string): number => today.filter((d) => d.state === s).length;
    expect(st('waiting')).toBeGreaterThanOrEqual(2);
    expect(st('waiting')).toBeLessThanOrEqual(3);
    expect(st('on_way')).toBeGreaterThanOrEqual(2);
    expect(st('on_way')).toBeLessThanOrEqual(3);
    expect(st('delivered')).toBeGreaterThanOrEqual(3);
    expect(st('delivered')).toBeLessThanOrEqual(5);
    expect(st('failed')).toBeGreaterThanOrEqual(1);
    expect(st('failed')).toBeLessThanOrEqual(2);
    for (const c of ['e-morozov', 'e-zaytsev', 'e-vlasov']) {
      const mine = today.filter((d) => d.courierId === c);
      expect(mine.length).toBeGreaterThanOrEqual(4);
      expect(mine.length).toBeLessThanOrEqual(6);
      const orders = mine.map((d) => d.routeOrder).sort((a, b) => a - b);
      expect(new Set(orders).size).toBe(orders.length);
    }
    expect(db.deliveries.some((d) => d.date > T)).toBe(true);
    const notHanded = ['e-morozov', 'e-zaytsev', 'e-vlasov'].filter((c) => courierCash(db, c).onHand > 0).length;
    expect(notHanded).toBeGreaterThanOrEqual(1);
    expect(notHanded).toBeLessThanOrEqual(2);
    expect(db.deliveries.some((d) => d.collect > 0)).toBe(true);
  });

  it('визиты: 5–8 в рабочий день, ~55/25/20 %, сегодня по 6–8 и 2–3 сделаны', () => {
    const per = new Map<string, number>();
    for (const v of db.visits) per.set(v.repId + v.date, (per.get(v.repId + v.date) ?? 0) + 1);
    for (const n of per.values()) {
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(8);
    }
    const done = db.visits.filter((v) => v.state === 'done' && v.date < T);
    const r = (x: string): number => share(done.filter((v) => v.result === x).length, done.length);
    expect(r('order')).toBeGreaterThan(0.48);
    expect(r('order')).toBeLessThan(0.62);
    expect(r('callback')).toBeGreaterThan(0.18);
    expect(r('callback')).toBeLessThan(0.32);
    expect(r('refusal')).toBeGreaterThan(0.14);
    expect(r('refusal')).toBeLessThan(0.27);
    for (const v of db.visits) {
      if (v.result === 'refusal') expect(v.refusalReason).toBeTruthy();
      if (v.result === 'order') expect(v.orderId).toBeTruthy();
    }
    for (const rep of ['e-mironova', 'e-abdullaev', 'e-tarasov']) {
      const today = db.visits.filter((v) => v.repId === rep && v.date === T);
      expect(today.length).toBeGreaterThanOrEqual(6);
      expect(today.length).toBeLessThanOrEqual(8);
      const d = today.filter((v) => v.state === 'done').length;
      expect(d).toBeGreaterThanOrEqual(2);
      expect(d).toBeLessThanOrEqual(3);
    }
  });

  it('планы, акции, цены, чаты, задачи, журнал, настройки', () => {
    for (const m of ['2026-08', '2026-09', '2026-10', '2026-11']) expect(db.plans.some((p) => p.month === m && p.employeeId === null)).toBe(true);
    for (const m of ['2026-08', '2026-09', '2026-10', '2026-11'])
      for (const e of ['e-sokolov', 'e-petrova', 'e-mironova', 'e-abdullaev', 'e-orlova', 'e-kim']) expect(db.plans.some((p) => p.month === m && p.employeeId === e)).toBe(true);
    expect(db.plans.some((p) => p.month === '2026-11' && p.employeeId === 'e-tarasov')).toBe(true);
    for (const m of ['2026-09', '2026-10', '2026-11']) {
      const store = db.plans.find((p) => p.month === m && p.employeeId === null)!.amount;
      expect(db.plans.filter((p) => p.month === m && p.employeeId).reduce((s, p) => s + p.amount, 0)).toBe(store);
    }
    for (const p of db.plans.filter((x) => x.employeeId && x.month === '2026-10')) {
      const fact = salesForPeriod(db, '2026-10-01', '2026-10-31', { employeeId: p.employeeId! }).revenue;
      expect(fact / p.amount).toBeGreaterThan(0.65);
      expect(fact / p.amount).toBeLessThan(1.15);
    }
    expect(db.promos.length).toBeGreaterThanOrEqual(5);
    expect(db.promos.length).toBeLessThanOrEqual(8);
    expect(db.promos.some((p) => p.active && p.start <= T && p.end >= T)).toBe(true);
    expect(db.promos.some((p) => p.start > T)).toBe(true);
    expect(db.promos.some((p) => p.end < T)).toBe(true);
    expect(new Set(db.promos.map((p) => p.kind)).size).toBe(2);
    expect(new Set(db.promos.map((p) => p.target.type)).size).toBe(3);
    expect(db.priceChanges.length).toBeGreaterThanOrEqual(30);
    expect(db.priceChanges.length).toBeLessThanOrEqual(60);
    expect(db.chats.length).toBeGreaterThanOrEqual(10);
    expect(db.chats.length).toBeLessThanOrEqual(15);
    const linked = db.chats.filter((c) => c.messages.some((m) => m.orderId)).length;
    expect(linked).toBeGreaterThanOrEqual(2);
    expect(linked).toBeLessThanOrEqual(3);
    const unread = db.chats.filter((c) => c.unread > 0).length;
    expect(unread).toBeGreaterThanOrEqual(3);
    expect(unread).toBeLessThanOrEqual(4);
    for (const e of db.employees) {
      const n = db.tasks.filter((t) => t.assigneeId === e.id && t.due === T).length;
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(5);
    }
    const overdueTasks = db.tasks.filter((t) => t.state === 'open' && t.due < T);
    expect(overdueTasks.length).toBeGreaterThan(0);
    expect(db.tasks.some((t) => t.link !== null)).toBe(true);
    expect(db.audit.length).toBeGreaterThanOrEqual(100);
    for (const k of ['price', 'client', 'product', 'employee'] as const) expect(db.audit.some((a) => a.entity === k)).toBe(true);
    expect(db.settings.company.legalName).toBe('ООО «БытМаркет»');
    expect(db.settings.discountLimits).toMatchObject({ seller: 5, manager: 10, rep: 7, owner: 100, accountant: 0, warehouse: 0, dispatcher: 0, courier: 0 });
    expect(db.settings.minMarginPct).toBe(12);
  });
});

describe('замечания проверяющих', () => {
  const mins = (hhmm: string): number => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3, 5);

  it('брак, истёкший срок и брак при приёмке не возвращаются в продажу', () => {
    const released = db.quarantine.filter((q) => q.state === 'released');
    expect(released.length).toBeGreaterThan(0);
    for (const q of released) {
      expect(q.source === 'delivery_failed' || q.reason === 'Не подошёл' || q.reason === 'Привезли не то').toBe(true);
    }
    expect(db.quarantine.some((q) => q.reason === 'Брак' && q.state === 'written_off')).toBe(true);
  });

  it('сверка кассы: три смены с расхождением за две недели, 4 ноября у Анны −600 ₽', () => {
    const diffs = db.shifts.filter((s) => s.closedAt).map((s) => ({ s, d: shiftSummary(db, s.id).difference ?? 0 })).filter((x) => x.d !== 0);
    expect(diffs.map((x) => x.d).sort((a, b) => a - b)).toEqual([-600, -350, 200]);
    for (const x of diffs) expect(x.s.openedAt.slice(0, 10) >= plusDays(T, -14)).toBe(true);
    const nov4 = diffs.find((x) => x.d === -600)!.s;
    expect(nov4.openedAt.slice(0, 10)).toBe('2026-11-04');
    expect(nov4.sellerId).toBe('e-orlova');
  });

  it('визиты не позже 18:30, отметка — в пределах ±40 минут от плана', () => {
    for (const v of db.visits) {
      expect(v.time <= '18:30').toBe(true);
      if (v.doneAt) {
        expect(v.doneAt.slice(0, 10)).toBe(v.date);
        expect(Math.abs(mins(v.doneAt.slice(11, 16)) - mins(v.time))).toBeLessThanOrEqual(40);
      }
    }
  });

  it('маршрут курьера по началу интервала, вручение не раньше интервала', () => {
    const routes = new Map<string, typeof db.deliveries>();
    for (const d of db.deliveries) if (d.courierId && d.routeOrder > 0) routes.set(d.courierId + d.date, [...(routes.get(d.courierId + d.date) ?? []), d]);
    for (const list of routes.values()) {
      const s = list.slice().sort((a, b) => a.routeOrder - b.routeOrder);
      for (let i = 1; i < s.length; i++) expect(s[i].interval.slice(0, 5) >= s[i - 1].interval.slice(0, 5)).toBe(true);
    }
    let late = 0;
    let all = 0;
    for (const d of db.deliveries)
      for (const a of d.attempts) {
        if (a.result !== 'delivered') continue;
        all++;
        expect(a.at.slice(11, 16) >= d.interval.slice(0, 5)).toBe(true);
        if (a.at.slice(11, 16) > d.interval.slice(6, 11)) late++;
      }
    expect(late / all).toBeLessThan(0.1);
  });

  it('названия клиентов без нелепостей', () => {
    for (const c of db.clients) {
      expect(c.name).not.toMatch(/ООО «(ТСЖ|ИП|ООО)\b/);
      expect(c.name).not.toMatch(/Пятёрочка/);
    }
    expect(db.clients.some((c) => c.name === 'ТСЖ «Звёздный»' && c.kind === 'ooo')).toBe(true);
  });

  it('имена клиентов уникальны, у ИП фамилии не повторяются (Есенов и Есенова — одна фамилия)', () => {
    const names = db.clients.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    // фамилия в мужской форме: «Есенова» → «Есенов», «Тихонова» → «Тихонов»
    const root = (s: string): string => (/(ов|ев|ёв|ин|ын)а$/.test(s) ? s.slice(0, -1) : s.endsWith('ая') ? s.slice(0, -2) + 'ий' : s);
    const seen = new Map<string, string>();
    for (const c of db.clients.filter((x) => x.kind === 'ip')) {
      const m = /^ИП (\S+) · /.exec(c.name);
      expect(m, c.name).not.toBeNull();
      const r = root(m![1]);
      expect(seen.get(r), `${c.name} и ${seen.get(r)}`).toBeUndefined();
      seen.set(r, c.name);
    }
    expect(seen.size).toBeGreaterThanOrEqual(40);
  });

  it('в маршруте представителя на день каждый клиент один раз', () => {
    const route = new Map<string, Set<string>>();
    for (const v of db.visits) {
      const k = v.repId + ' ' + v.date;
      const s = route.get(k) ?? new Set<string>();
      expect(s.has(v.clientId), `${k}: ${v.clientId} дважды`).toBe(false);
      s.add(v.clientId);
      route.set(k, s);
    }
    expect(route.size).toBeGreaterThan(100);
  });

  it('пропустили привычный заказ: у Соколова 1–2 клиента, у Петровой хотя бы один', () => {
    // правило раздела «Клиенты»: активный, не розница, нет заказа в работе, с последней покупки больше частоты × MISSED_ORDER_FACTOR
    const open = new Set(db.orders.filter((o) => o.state === 'request' || o.state === 'confirmed' || o.state === 'draft').map((o) => o.clientId));
    const missed = (owner: string): string[] =>
      db.clients
        .filter((c) => c.ownerId === owner && c.active && c.orderEveryDays && c.segment !== 'retail' && !open.has(c.id))
        .filter((c) => {
          const last = clientBalance(db, c.id).lastOrderAt;
          return last !== null && diffDays(last.slice(0, 10), T) > c.orderEveryDays! * MISSED_ORDER_FACTOR;
        })
        .map((c) => c.name);
    expect(missed('e-sokolov').length).toBeGreaterThanOrEqual(1);
    expect(missed('e-sokolov').length).toBeLessThanOrEqual(2);
    expect(missed('e-petrova').length).toBeGreaterThanOrEqual(1);
  });

  it('задачи: имя клиента в кавычках не стоит сразу после глагола или предлога без слова «клиент»', () => {
    for (const t of db.tasks) expect(t.title).not.toMatch(/^(Напомнить|Позвонить|Отправить счёт|Отправить акт сверки|Решить по|Уточнить у|Собрать заказ у|Согласовать с) «/);
  });

  it('ручные скидки: 3–5 % чеков с основанием, в ноябре тоже', () => {
    const sales = db.receipts.filter((r) => r.kind === 'sale');
    const disc = sales.filter((r) => r.lines.some((l) => l.discountPct > 0));
    expect(disc.length / sales.length).toBeGreaterThanOrEqual(0.03);
    expect(disc.length / sales.length).toBeLessThanOrEqual(0.05);
    for (const r of disc) for (const l of r.lines) if (l.discountPct > 0) expect(['Постоянный покупатель', 'Повреждённая упаковка', 'Оптом в рознице']).toContain(l.discountReason);
    expect(disc.filter((r) => r.at >= '2026-11-01').length).toBeGreaterThanOrEqual(3);
    expect(new Set(disc.flatMap((r) => r.lines.map((l) => l.discountReason).filter(Boolean))).size).toBe(3);
  });

  it('новые клиенты в октябре и ноябре — с первыми заказами', () => {
    const fresh = db.clients.filter((c) => c.segment !== 'retail' && c.createdAt >= '2026-10-01');
    expect(fresh.length).toBeGreaterThanOrEqual(2);
    expect(fresh.some((c) => c.createdAt >= '2026-11-01')).toBe(true);
    for (const c of fresh) expect(db.orders.some((o) => o.clientId === c.id && o.state !== 'cancelled')).toBe(true);
  });

  it('у ходовых товаров на складе обычно не меньше двух коробок', () => {
    const si = stockIndex(db);
    const sold = new Map<string, number>();
    for (const m of db.movements) if ((m.kind === 'sale' || m.kind === 'ship') && m.at.slice(0, 10) >= plusDays(T, -30)) sold.set(m.productId, (sold.get(m.productId) ?? 0) - m.dOnHand);
    const box = (p: (typeof db.products)[number]): number => p.packs.find((x) => x.key === 'box')?.qty ?? p.packs.find((x) => x.key === 'pack')?.qty ?? 1;
    // ходовой — продаётся хотя бы коробка в месяц; намеренный дефицит и «ниже минимума» — исключения для сигналов
    const fast = db.products.filter((p) => p.active && p.cost !== null && (sold.get(p.id) ?? 0) >= box(p) && si.get(p.id)!.total.available >= p.minStock);
    const ok = fast.filter((p) => si.get(p.id)!.warehouse.available >= 2 * box(p));
    expect(fast.length).toBeGreaterThan(200);
    expect(ok.length / fast.length).toBeGreaterThan(0.85);
  });

  it('у должников есть и оплаченные заказы, и свежие без просрочки', () => {
    const debtors = db.clients.filter((c) => c.segment !== 'retail' && clientBalance(db, c.id).overdue > 0);
    let fresher = 0;
    for (const c of debtors) {
      const b = clientBalance(db, c.id);
      const orders = db.orders.filter((o) => o.clientId === c.id && o.state !== 'cancelled');
      expect(orders.some((o) => orderPayment(db, o).state === 'paid')).toBe(true);
      expect(salesForPeriod(db, plusDays(T, -90), T, { clientId: c.id }).revenue).toBeGreaterThan(b.debt);
      if (b.debt > b.overdue) fresher++;
    }
    expect(fresher / debtors.length).toBeGreaterThanOrEqual(0.6);
  });
});
