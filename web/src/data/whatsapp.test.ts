/* WhatsApp: автосообщения по событиям, отправка сотрудником, настройки, разбор заказа из сообщения. */
import { beforeAll, describe, expect, it } from 'vitest';
import type { DB, ID } from './types';
import { WA_AUTO_KEYS } from './types';
import { generate } from './generate';
import { OpError, applyOp } from './ops';
import type { OpType } from './ops';
import { parseOrderText } from './orderText';

let base: DB;
beforeAll(() => {
  base = generate();
});

const T = '2026-11-05';
const OWNER = 'e-gadzhiev';
const MANAGER = 'e-omarov';
const DISPATCHER = 'e-abakarova';

function fresh(): { db: DB; op: (type: OpType, payload: unknown, actor: ID) => { id?: ID; info?: string } } {
  const db = structuredClone(base);
  let minute = 14 * 60 + 5;
  const op = (type: OpType, payload: unknown, actor: ID) => {
    const m = minute++;
    const at = `${T}T${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
    return applyOp(db, type, payload, { actorId: actor, at });
  };
  return { db, op };
}

describe('история WhatsApp', () => {
  it('автосообщения всех видов, только после подключения, одно событие — одно сообщение', () => {
    const since = base.settings.whatsapp.since!;
    const kinds = new Set<string>();
    for (const ch of base.chats) {
      const refs = new Set<string>();
      for (const m of ch.messages) {
        if (m.orderId) expect(base.orders.find((o) => o.id === m.orderId)?.clientId).toBe(ch.clientId);
        if (!m.auto) continue;
        kinds.add(m.auto);
        expect(m.from).toBe('staff');
        expect(m.authorId).toBeNull();
        expect(m.at.slice(0, 10) >= since).toBe(true);
        expect(m.ref).toBeTruthy();
        expect(refs.has(m.ref!)).toBe(false);
        refs.add(m.ref!);
      }
      for (let i = 1; i < ch.messages.length; i++) expect(ch.messages[i - 1].at <= ch.messages[i].at).toBe(true);
    }
    expect([...kinds].sort()).toEqual([...WA_AUTO_KEYS].sort());
  });

  it('вложения: счёт, акт сверки и прайс', () => {
    const files = base.chats.flatMap((c) => c.messages.filter((m) => m.file).map((m) => m.file!.name));
    expect(files.some((f) => f.startsWith('Счёт №'))).toBe(true);
    expect(files.some((f) => f.startsWith('Акт сверки'))).toBe(true);
    expect(files.some((f) => f.startsWith('Прайс'))).toBe(true);
  });

  it('свежий заказ списком разбирается в строки заказа, непонятное — отдельно', () => {
    const m = base.chats.flatMap((c) => c.messages).find((x) => x.from === 'client' && x.text.startsWith('Добрый день! На пятницу'));
    expect(m).toBeTruthy();
    const r = parseOrderText(base, m!.text);
    expect(r.items.length).toBe(3);
    for (const it of r.items) {
      expect(it.productId).toBeTruthy();
      expect(it.matches).toBe(1);
      expect(it.pack).toBe('box');
    }
    expect(r.items.map((x) => x.packQty)).toEqual([3, 2, 1]);
    expect(r.missed).toEqual(['посоветуйте что-нибудь от моли']);
  });

  it('заказы из переписки: разбор находит те же товары и упаковки, что в оформленном заказе', () => {
    let checked = 0;
    for (const ch of base.chats) {
      for (const m of ch.messages) {
        if (m.from !== 'client' || !m.text.startsWith('Добрый день! Нам бы на завтра')) continue;
        const r = parseOrderText(base, m.text, ch.clientId);
        // неоднозначные названия (matches > 1) помечены для проверки — их сверяем только по упаковке
        const o = base.orders
          .filter((x) => x.clientId === ch.clientId && (x.source === 'chat' || x.source === 'phone') && x.createdAt.slice(0, 10) === m.at.slice(0, 10))
          .find((x) => r.items.every((it, i) => it.matches > 1 || x.lines[i]?.productId === it.productId));
        expect(o).toBeTruthy();
        r.items.forEach((it, i) => {
          expect(it.pack).toBe(o!.lines[i].pack);
          expect(it.packQty).toBe(o!.lines[i].packQty);
        });
        checked++;
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  });
});

describe('разбор текста', () => {
  it('разные способы записи', () => {
    const r = parseOrderText(base, 'fairy лимон 900мл 3 кор\nDomestos Ультра белый, 1 л — 12 шт');
    expect(r.items.length).toBe(2);
    expect(base.products.find((p) => p.id === r.items[0].productId)?.name).toMatch(/^Fairy Лимон, .*900 мл$/);
    expect(r.items[0].pack).toBe('box');
    expect(base.products.find((p) => p.id === r.items[1].productId)?.name).toMatch(/^Domestos Ультра белый, .*1 л$/);
    expect(r.items[1]).toMatchObject({ pack: 'pcs', packQty: 12 });
  });
  it('неоднозначное название помечается', () => {
    const r = parseOrderText(base, 'Domestos 1 л — 6 шт');
    expect(r.items[0].matches).toBeGreaterThan(1);
  });
  it('текст без товаров ничего не добавляет', () => {
    const r = parseOrderText(base, 'Добрый день! Во сколько привезёте?');
    expect(r.items).toEqual([]);
  });
});

describe('операции WhatsApp', () => {
  it('курьер выехал и вручил — клиент получает два автосообщения, повтор не дублирует', () => {
    const { db, op } = fresh();
    const d = db.deliveries.find((x) => x.date === T && x.state === 'assigned')!;
    expect(d).toBeTruthy();
    const before = db.chats.find((c) => c.clientId === d.clientId)?.messages.length ?? 0;
    const r1 = op('delivery.start', { deliveryId: d.id }, d.courierId!);
    expect(r1.info).toMatch(/WhatsApp/);
    op('delivery.deliver', { deliveryId: d.id, collected: d.collect, method: 'cash' }, d.courierId!);
    const chat = db.chats.find((c) => c.clientId === d.clientId)!;
    const added = chat.messages.slice(before);
    expect(added.map((m) => m.auto)).toEqual(['on_way', 'delivered']);
    expect(added[0].text).toMatch(/выехал/);
  });

  it('выключенный шаблон не отправляется, включение и выключение — только владелец и пишется в журнал', () => {
    const { db, op } = fresh();
    expect(() => op('settings.whatsapp', { auto: { on_way: false } }, MANAGER)).toThrow(OpError);
    op('settings.whatsapp', { auto: { on_way: false } }, OWNER);
    expect(db.audit[db.audit.length - 1].text).toMatch(/Курьер выехал.*выключено/);
    const d = db.deliveries.find((x) => x.date === T && x.state === 'assigned')!;
    const before = db.chats.find((c) => c.clientId === d.clientId)?.messages.length ?? 0;
    const r = op('delivery.start', { deliveryId: d.id }, d.courierId!);
    expect(r.info ?? '').not.toMatch(/WhatsApp/);
    expect(db.chats.find((c) => c.clientId === d.clientId)?.messages.length ?? 0).toBe(before);
  });

  it('сообщение клиенту без диалога создаёт диалог; вложение без текста можно', () => {
    const { db, op } = fresh();
    const c = db.clients.find((x) => x.active && x.phone && x.segment !== 'retail' && !db.chats.some((ch) => ch.clientId === x.id))!;
    expect(c).toBeTruthy();
    const r = op('chat.send', { clientId: c.id, text: '', file: { name: 'Прайс.xlsx', size: '300 КБ', kind: 'xlsx' } }, MANAGER);
    const chat = db.chats.find((x) => x.id === r.id)!;
    expect(chat.clientId).toBe(c.id);
    expect(chat.messages[0].file?.name).toBe('Прайс.xlsx');
    expect(() => op('chat.send', { clientId: c.id, text: 'Добрый день' }, DISPATCHER)).toThrow(OpError);
  });

  it('WhatsApp отключён — написать нельзя и автосообщений нет', () => {
    const { db, op } = fresh();
    op('settings.whatsapp', { connected: false }, OWNER);
    const ch = db.chats[0];
    expect(() => op('chat.send', { chatId: ch.id, text: 'Тест' }, MANAGER)).toThrow(/не подключён/);
  });
});
