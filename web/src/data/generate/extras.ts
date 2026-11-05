/* После симуляции: планы продаж, переписка WhatsApp и задачи сотрудников.
   Тексты собраны из настоящих документов базы: номера заказов, суммы долгов, товары. */
import type { Chat, ChatMessage, Client, DB, ID, ISODate, ISODateTime, Order, TaskLink } from '../types';
import type { Rng } from '../rng';
import { applyOp } from '../ops';
import { shortName } from '../opkit';
import { get } from '../idx';
import { clientBalance, courierCash, orderPayment, salesForPeriod, stockIndex, supplierBalance } from '../selectors';
import { atTime, dayNum, dayText, dow, lastOfMonth, plusDays } from '../dates';
import { rub } from '../text';
import { E, MANAGERS, REPS, SELLERS, TARASOV_START } from './org';
import type { ClientMeta } from './clients';
import type { ProdMeta } from './catalog';

/* ---------- планы ---------- */

export function buildPlans(db: DB, rng: Rng): void {
  const months = ['2026-08', '2026-09', '2026-10'];
  const people = [...MANAGERS, ...REPS];
  const range = (m: string): [ISODate, ISODate] => [m === '2026-08' ? db.meta.startDate : m + '-01', lastOfMonth(m + '-01')];
  const fieldDays = (m: string, from: ISODate): number => {
    let n = 0;
    for (let d = dayNum(from); d <= dayNum(lastOfMonth(m + '-01')); d++) {
      const w = dow(new Date(d * 86400000).toISOString().slice(0, 10));
      if (w >= 2 && w <= 4) n++;
    }
    return n;
  };
  // план считается так же, как факт в отчётах (kpis.planProgress): продажи сотрудника за месяц
  const plans = new Map<string, number>();
  for (const m of months) {
    const [from, to] = range(m);
    let sum = 0;
    for (const e of people) {
      if (e === E.tarasov && m === '2026-08') continue;
      const f = e === E.tarasov && m === '2026-09' ? TARASOV_START : from;
      const actual = salesForPeriod(db, f, to, { employeeId: e }).revenue;
      const plan = Math.max(50000, Math.round(actual / rng.float(0.72, 1.08) / 10000) * 10000);
      plans.set(e + m, plan);
      sum += plan;
      const isRep = (REPS as readonly string[]).includes(e);
      db.plans.push({ month: m, employeeId: e, amount: plan, visits: isRep ? fieldDays(m, f) * 7 : null });
    }
    // продавцы: розница по чекам смены
    for (const e of SELLERS) {
      const actual = salesForPeriod(db, from, to, { employeeId: e }).revenue;
      const plan = Math.round(actual / rng.float(0.9, 1.06) / 10000) * 10000;
      plans.set(e + m, plan);
      sum += plan;
      db.plans.push({ month: m, employeeId: e, amount: plan, visits: null });
    }
    db.plans.push({ month: m, employeeId: null, amount: sum, visits: null });
  }
  let sumNov = 0;
  for (const e of [...people, ...SELLERS]) {
    const plan = Math.round(((plans.get(e + '2026-10') ?? 0) * rng.float(1.03, 1.08)) / 10000) * 10000;
    sumNov += plan;
    const isRep = (REPS as readonly string[]).includes(e);
    db.plans.push({ month: '2026-11', employeeId: e, amount: plan, visits: isRep ? fieldDays('2026-11', '2026-11-01') * 7 : null });
  }
  db.plans.push({ month: '2026-11', employeeId: null, amount: sumNov, visits: null });
}

/* ---------- чаты ---------- */

const first = (c: Client): string => {
  const n = c.contacts[0]?.name ?? '';
  return n.split(' ')[0] || 'добрый день';
};

export function buildChats(db: DB, rng: Rng, metas: ClientMeta[]): void {
  const today = db.meta.today;
  // имя представителя в винительном падеже: «через Елену», «через Руслана», «через Олега»
  const empFirst = (id: ID): string => {
    const n = (get(db, 'employees', id)?.name ?? '').split(' ')[0];
    return n.endsWith('а') ? n.slice(0, -1) + 'у' : n.endsWith('я') ? n.slice(0, -1) + 'ю' : n + 'а';
  };
  const recent = (o: Order): boolean => o.createdAt.slice(0, 10) >= plusDays(today, -12);
  const wholesale = db.clients.filter((c) => c.segment !== 'retail' && c.active && c.ownerId);
  const ordersOf = (cid: ID): Order[] => db.orders.filter((o) => o.clientId === cid && o.state !== 'cancelled');
  const used = new Set<ID>();
  let n = 0;
  const chats: Chat[] = [];
  const mk = (c: Client, messages: ChatMessage[], unread: number): void => {
    used.add(c.id);
    chats.push({ id: 'ch-' + ++n, clientId: c.id, channel: 'whatsapp', messages, unread, ownerId: c.ownerId });
  };
  const msg = (at: ISODateTime, from: 'client' | 'staff', text: string, authorId: ID | null = null, orderId: ID | null = null): ChatMessage => ({
    at,
    from,
    authorId,
    text,
    orderId,
  });
  const t = (daysBack: number, minutes: number): ISODateTime => atTime(plusDays(today, -daysBack), minutes);
  const staffOf = (c: Client): ID => (c.ownerId && (MANAGERS as readonly string[]).includes(c.ownerId) ? c.ownerId : E.sokolov);
  const lineText = (o: Order, k: number): string =>
    o.lines
      .slice(0, k)
      .map((l) => {
        const p = get(db, 'products', l.productId);
        const pk = l.pack === 'box' ? (l.packQty === 1 ? 'коробку' : `${l.packQty} коробки`) : l.pack === 'pack' ? `${l.packQty} упак.` : `${l.qty} шт`;
        return `${p ? shortName(p) : 'товар'} — ${pk}`;
      })
      .join(', ');

  // 1–3: заказ из переписки (со ссылкой на заказ)
  const chatOrders = db.orders.filter((o) => (o.source === 'chat' || o.source === 'phone') && recent(o) && o.state !== 'cancelled' && o.state !== 'request');
  for (const o of rng.shuffle(chatOrders).slice(0, 3)) {
    const c = get(db, 'clients', o.clientId);
    if (!c || used.has(c.id)) continue;
    const s = staffOf(c);
    const created = o.createdAt;
    const back = Math.max(0, dayNum(today) - dayNum(created));
    const m0 = +created.slice(11, 13) * 60 + +created.slice(14, 16);
    const d = o.deliveryId ? get(db, 'deliveries', o.deliveryId) : undefined;
    const msgs = [
      msg(t(back, m0 - 18), 'client', `Добрый день! Нам бы на завтра: ${lineText(o, 3)}${o.lines.length > 3 ? ' и как в прошлый раз остальное' : ''}`),
      msg(t(back, m0 - 6), 'staff', `${first(c)}, здравствуйте! Всё есть, сейчас оформлю`, s),
      msg(t(back, m0 + 2), 'staff', `Оформил заказ №${o.number} на ${rub(o.total)}${d ? `, доставка ${dayText(d.date)}, ${d.interval}` : ', можно забрать со склада после 15:00'}`, s, o.id),
      msg(t(back, m0 + 9), 'client', rng.pick(['Спасибо, ждём', 'Отлично, оплата как обычно', 'Принято, спасибо!'])),
    ];
    mk(c, msgs, 0);
  }

  // 4–5: напоминание об оплате (одна — непрочитанная)
  const debtors = wholesale.filter((c) => clientBalance(db, c.id).overdue > 0 && !used.has(c.id));
  debtors.slice(0, 2).forEach((c, i) => {
    const b = clientBalance(db, c.id);
    const o = ordersOf(c.id).find((x) => orderPayment(db, x).overdueDays > 0);
    const s = staffOf(c);
    const msgs = [
      msg(t(2 + i, 10 * 60 + 15), 'staff', `${first(c)}, добрый день! Напоминаю про оплату${o ? ` по заказу №${o.number}` : ''}: ${rub(b.overdue)}, срок прошёл ${b.maxOverdueDays} дн. назад`, s),
      msg(t(2 + i, 12 * 60 + 40), 'client', 'Добрый. Да, помню, на этой неделе закроем'),
    ];
    if (i === 0) msgs.push(msg(t(0, 11 * 60 + 5), 'client', 'Сегодня переведём половину, остальное в понедельник. Скриншот пришлю'));
    mk(c, msgs, i === 0 ? 1 : 0);
  });

  // 6–7: наличие и цена
  const si = stockIndex(db);
  const hot = db.products.filter((p) => p.active && (si.get(p.id)?.warehouse.available ?? 0) > 24);
  const scarce = db.products.filter((p) => p.active && (si.get(p.id)?.total.available ?? 0) < p.minStock && (si.get(p.id)?.expected ?? 0) > 0);
  const free = wholesale.filter((c) => !used.has(c.id));
  for (let i = 0; i < 2 && free.length; i++) {
    const c = free.splice(rng.int(0, free.length - 1), 1)[0];
    const s = staffOf(c);
    const p = i === 0 ? rng.pick(hot) : scarce.length ? rng.pick(scarce) : rng.pick(hot);
    const st = si.get(p.id);
    const msgs = [msg(t(i, 9 * 60 + 40 + i * 50), 'client', `Здравствуйте! ${shortName(p)} есть в наличии? Сколько стоит коробкой?`)];
    if (i === 0) {
      msgs.push(msg(t(i, 9 * 60 + 52), 'staff', `Есть, на складе ${st?.warehouse.available ?? 0} шт. Цена для вас ${rub(p.wholesalePrice)} за штуку`, s));
      msgs.push(msg(t(i, 10 * 60 + 5), 'client', 'Отложите две коробки, заберём в пятницу'));
      mk(c, msgs, 0);
    } else {
      msgs.push(msg(t(i, 11 * 60 + 2), 'staff', `Сейчас мало — ${st?.total.available ?? 0} шт, поставка ожидается через пару дней. Поставить вам в заказ с поставки?`, s));
      mk(c, msgs, 0);
    }
  }

  // 8: когда привезут (сегодня, без ответа)
  const todayDeliv = db.deliveries.filter((d) => d.date === today && (d.state === 'assigned' || d.state === 'on_way') && !used.has(d.clientId));
  if (todayDeliv.length) {
    const d = todayDeliv[0];
    const c = get(db, 'clients', d.clientId)!;
    mk(
      c,
      [
        msg(t(1, 16 * 60 + 20), 'staff', `Добрый день! Заказ №${get(db, 'orders', d.orderId)?.number ?? ''} привезём завтра, ${d.interval}`, staffOf(c)),
        msg(t(0, 12 * 60 + 47), 'client', 'Добрый! Во сколько примерно будете? Мне отъехать нужно'),
        msg(t(0, 12 * 60 + 48), 'client', 'Или можно оставить продавцу'),
      ],
      2,
    );
  }

  // 9: прайс и акция
  const free2 = wholesale.filter((c) => !used.has(c.id));
  if (free2.length) {
    const c = rng.pick(free2);
    const s = staffOf(c);
    const promo = db.promos.find((p) => p.active && p.start <= today && p.end >= today);
    mk(
      c,
      [
        msg(t(4, 14 * 60 + 10), 'client', 'Пришлите, пожалуйста, актуальный прайс на порошки и гели'),
        msg(t(4, 14 * 60 + 32), 'staff', `Отправил прайс файлом.${promo ? ` Сейчас действует акция «${promo.name}» до ${dayText(promo.end)}` : ''}`, s),
        msg(t(4, 15 * 60 + 1), 'client', c.ownerId && (REPS as readonly string[]).includes(c.ownerId) ? `Спасибо, посмотрю и закажу через ${empFirst(c.ownerId)}` : 'Спасибо, посмотрю и пришлю заказ'),
      ],
      0,
    );
  }

  // 10: брак в поставке
  const ret = db.returns.filter((r) => r.source === 'order' && r.clientId && !used.has(r.clientId)).slice(-1)[0];
  if (ret?.clientId) {
    const c = get(db, 'clients', ret.clientId)!;
    const p = get(db, 'products', ret.lines[0].productId);
    const back = Math.max(1, dayNum(today) - dayNum(ret.at) + 1);
    mk(
      c,
      [
        msg(t(back, 10 * 60), 'client', `В последней поставке ${p ? shortName(p) : 'товар'} — ${ret.lines[0].qty} шт пришли с повреждением. Что делаем?`),
        msg(t(back, 10 * 60 + 25), 'staff', 'Пришлите фото, оформим возврат. Заберём со следующей доставкой', staffOf(c)),
        msg(t(back, 10 * 60 + 31), 'client', 'Фото отправила'),
        msg(t(back - 1, 15 * 60 + 5), 'staff', `Оформили возврат №${ret.number} на ${rub(ret.amount)}`, staffOf(c)),
      ],
      0,
    );
  }

  // 11–12: представителям — новые заявки и точки
  for (const rep of [E.mironova, E.abdullaev]) {
    const c = db.clients.find((x) => x.ownerId === rep && !used.has(x.id) && x.active);
    if (!c) continue;
    const lastOrder = ordersOf(c.id).slice(-1)[0];
    const msgs = [
      msg(t(0, 8 * 60 + 41), 'client', `${rep === E.mironova ? 'Елена' : 'Руслан'}, добрый день! Заедете сегодня? Хочу добавить мешки 120 л и перчатки`),
    ];
    if (lastOrder && rng.chance(0.5)) msgs.unshift(msg(t(6, 16 * 60), 'client', `Спасибо, заказ №${lastOrder.number} получили`));
    mk(c, msgs, 1);
  }

  for (const ch of chats) ch.messages.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  db.chats.push(...chats);
  db.counters.chat = n;
}

/* ---------- задачи ---------- */

interface TaskDraft {
  who: ID;
  title: string;
  link?: TaskLink;
  priority?: 'high';
  time?: string;
}

export function buildTasks(db: DB, rng: Rng, meta: ProdMeta[]): void {
  const today = db.meta.today;
  const yesterday = plusDays(today, -1);
  const si = stockIndex(db);
  const clients = db.clients;
  const overdueClients = clients
    .map((c) => ({ c, b: clientBalance(db, c.id) }))
    .filter((x) => x.b.overdue > 0)
    .sort((a, b) => b.b.overdue - a.b.overdue);
  const requests = db.orders.filter((o) => o.state === 'request');
  const draftPurchase = db.purchases.find((p) => p.state === 'draft');
  const transit = db.purchases.filter((p) => p.state === 'ordered');
  const partial = db.purchases.find((p) => p.state === 'partial');
  const failedToday = db.deliveries.find((d) => d.state === 'failed');
  const waiting = db.deliveries.filter((d) => d.state === 'waiting' && d.date === today);
  const unidentified = db.payments.filter((p) => p.status === 'unidentified');
  const pending = db.payments.filter((p) => p.status === 'pending');
  const quarantine = db.quarantine.filter((q) => q.state === 'check');
  const near = db.products.filter((p) => {
    const e = si.get(p.id)?.nearestExpiry;
    return e && e <= plusDays(today, 30);
  });
  const deficit = meta.filter((m) => m.deficit).map((m) => db.products[m.index]);
  const confirmedToday = db.orders.filter((o) => o.state === 'confirmed' && o.pick !== 'picked');
  const supplierOverdue = db.suppliers.map((s) => ({ s, b: supplierBalance(db, s.id) })).filter((x) => x.b.overdue > 0);
  const supplierSoon = db.suppliers
    .map((s) => ({ s, u: supplierBalance(db, s.id).upcoming.find((u) => u.dueDate >= today && u.dueDate <= plusDays(today, 6)) }))
    .filter((x) => x.u);
  const denis = courierCash(db, E.morozov);
  const nm = (id: ID | null | undefined): string => get(db, 'clients', id)?.name ?? '';
  // имя клиента в кавычках не склоняется — склоняем слово рядом: «клиенту «Семейный»», «в магазине «Семейный»»
  const shortClient = (id: ID | null | undefined): string => {
    const n = nm(id);
    const m = n.match(/«([^»]+)»/);
    return m ? `«${m[1]}»` : n.split(' · ')[0];
  };
  const quoted = (id: ID | null | undefined): boolean => /«/.test(nm(id));
  const toClient = (id: ID | null | undefined): string => `клиенту ${shortClient(id)}`; // кому
  const ofClient = (id: ID | null | undefined): string => `клиента ${shortClient(id)}`; // у кого, по кому
  const callTo = (id: ID | null | undefined): string => (quoted(id) ? `в ${shortClient(id)}` : toClient(id)); // «Позвонить в «Семейный»»
  const isShop = (id: ID | null | undefined): boolean => get(db, 'clients', id)?.segment === 'shop';
  const intoPlace = (id: ID | null | undefined): string => (isShop(id) ? `в магазин ${shortClient(id)}` : toClient(id)); // куда
  const atPlace = (id: ID | null | undefined): string => (isShop(id) ? `в магазине ${shortClient(id)}` : `у ${ofClient(id)}`); // где
  const repClient = (rep: ID, k: number): Client | undefined => clients.filter((c) => c.ownerId === rep && c.active)[k];
  const pick = <T,>(a: T[], i = 0): T | undefined => a[Math.min(i, a.length - 1)];

  const todayTasks: TaskDraft[] = [];
  const overdueTasks: TaskDraft[] = [];
  const add = (list: TaskDraft[], t: TaskDraft | false | undefined | null): void => {
    if (t) list.push(t);
  };

  // владелец
  add(todayTasks, draftPurchase && { who: E.owner, title: `Согласовать закупку №${draftPurchase.number} у «Бумажного мира» на ${rub(draftPurchase.total)}`, link: { type: 'purchase', id: draftPurchase.id }, priority: 'high' });
  const over0 = overdueClients[0];
  add(todayTasks, over0 && { who: E.owner, title: `Решить по ${toClient(over0.c.id)}: просрочка ${rub(over0.b.overdue)}, отгружать ли дальше`, link: { type: 'client', id: over0.c.id } });
  add(todayTasks, { who: E.owner, title: 'Посмотреть, как идёт акция «Осенняя стирка»: порошки к середине ноября', time: '16:00' });
  add(todayTasks, { who: E.owner, title: 'Подписать продление аренды склада на 2027 год', time: '12:00' });
  add(overdueTasks, { who: E.owner, title: 'Ответить «ЭкоХим Поволжье» по новым условиям отсрочки' });

  // продавцы
  const nearP = pick(near);
  add(todayTasks, { who: E.orlova, title: 'Поменять ценники на Fairy 450 мл по акции и выложить у кассы', priority: 'high' });
  add(todayTasks, nearP && { who: E.orlova, title: `Проверить сроки: ${shortName(nearP)} — до ${dayText(si.get(nearP.id)!.nearestExpiry!)}, вынести вперёд`, link: { type: 'product', id: nearP.id } });
  add(todayTasks, { who: E.orlova, title: 'Пересчитать размен перед вечерней инкассацией', time: '19:30' });
  add(overdueTasks, { who: E.orlova, title: 'Перезвонить покупательнице по возврату геля для душа' });
  add(todayTasks, { who: E.kim, title: 'Принять пополнение магазина в пятницу утром и разложить мешки', time: '08:00' });
  add(todayTasks, { who: E.kim, title: 'Выдать карты постоянного покупателя — осталось 12 штук, заказать ещё' });
  add(todayTasks, { who: E.kim, title: 'Сфотографировать полку с освежителями для Glade' });
  add(overdueTasks, { who: E.kim, title: 'Сдать отчёт по возвратам за октябрь Ольге Беловой' });

  // менеджеры
  MANAGERS.forEach((m, i) => {
    const oc = pick(overdueClients, i * 2 + 1);
    add(todayTasks, oc && { who: m, title: `Позвонить ${callTo(oc.c.id)} по долгу ${rub(oc.b.overdue)} — просрочка ${oc.b.maxOverdueDays} дн.`, link: { type: 'client', id: oc.c.id }, priority: 'high' });
    add(todayTasks, requests.length > 0 && { who: m, title: `Подтвердить заявки представителей до 15:00 — ждут ${requests.length}`, time: '15:00' });
    const co = pick(confirmedToday, i);
    add(todayTasks, co && { who: m, title: `Отправить счёт ${toClient(co.clientId)} по заказу №${co.number}`, link: { type: 'order', id: co.id } });
    add(todayTasks, i === 0 && pending[0] && { who: m, title: `Проверить скриншот перевода на ${rub(pending[0].amount)} — передать Ольге`, link: { type: 'payment', id: pending[0].id } });
    add(todayTasks, i === 1 && waiting[0] && { who: m, title: `Согласовать с клиентом ${shortClient(waiting[0].clientId)} время доставки №${waiting[0].number}`, link: { type: 'delivery', id: waiting[0].id } });
    const oc2 = pick(overdueClients, i * 2 + 2);
    add(overdueTasks, oc2 && { who: m, title: `Отправить акт сверки ${toClient(oc2.c.id)}`, link: { type: 'client', id: oc2.c.id } });
  });

  // представители
  REPS.forEach((r, i) => {
    const c1 = repClient(r, 1);
    const c2 = repClient(r, 3);
    const c3 = repClient(r, 5);
    add(todayTasks, c1 && { who: r, title: `Привезти образцы Synergetic ${intoPlace(c1.id)}`, link: { type: 'client', id: c1.id } });
    const debtor = overdueClients.find((x) => x.c.ownerId === r);
    add(todayTasks, debtor && { who: r, title: `Напомнить ${toClient(debtor.c.id)} об оплате ${rub(debtor.b.overdue)}`, link: { type: 'client', id: debtor.c.id }, priority: 'high' });
    add(todayTasks, c2 && { who: r, title: `Сфотографировать выкладку ${atPlace(c2.id)} — обещали место на кассе`, link: { type: 'client', id: c2.id } });
    add(todayTasks, i === 2 && { who: r, title: 'Познакомиться с новыми точками на Татищева: взять контакты закупщиков' });
    const c4 = repClient(r, 7) ?? repClient(r, 0);
    add(todayTasks, c4 && { who: r, title: `Собрать заказ у ${ofClient(c4.id)} — заканчивается порошок и мешки`, link: { type: 'client', id: c4.id } });
    add(overdueTasks, c3 && { who: r, title: `Уточнить у ${ofClient(c3.id)} адрес второй точки`, link: { type: 'client', id: c3.id } });
  });

  // бухгалтер
  const so = pick(supplierOverdue);
  add(todayTasks, so && { who: E.belova, title: `Оплатить долг поставщику ${so.s.name}: просрочено ${rub(so.b.overdue)}`, priority: 'high' });
  const ss = pick(supplierSoon);
  add(todayTasks, ss?.u && { who: E.belova, title: `Запланировать оплату поставщику ${ss.s.name} — ${rub(ss.u.amount)} до ${dayText(ss.u.dueDate)}`, link: { type: 'purchase', id: ss.u.purchaseId } });
  add(todayTasks, unidentified[0] && { who: E.belova, title: `Разнести неопознанный платёж ${rub(unidentified[0].amount)} от ${dayText(unidentified[0].at.slice(0, 10))}`, link: { type: 'payment', id: unidentified[0].id } });
  add(todayTasks, { who: E.belova, title: 'Сверка с «ЮгХимОпт» за октябрь' });
  add(todayTasks, { who: E.belova, title: 'Подготовить платёжный календарь на следующую неделю', time: '17:00' });
  add(overdueTasks, unidentified[1] && { who: E.belova, title: `Выяснить у банка плательщика на ${rub(unidentified[1].amount)}`, link: { type: 'payment', id: unidentified[1].id } });

  // склад
  const tr = pick(transit);
  add(todayTasks, tr && { who: E.krylov, title: `Подготовить место под поставку №${tr.number} — ждём ${dayText(tr.expectedAt)}`, link: { type: 'purchase', id: tr.id } });
  add(todayTasks, quarantine.length > 0 && { who: E.krylov, title: `Разобрать товар на проверке: ${quarantine.length} поз.`, priority: 'high' });
  add(todayTasks, partial && { who: E.krylov, title: `Дождаться остатка по закупке №${partial.number} и закрыть приёмку`, link: { type: 'purchase', id: partial.id } });
  add(overdueTasks, { who: E.krylov, title: 'Пересчитать стеллаж с мешками — расходится с учётом' });
  add(todayTasks, { who: E.krylov, title: 'Проверить сроки на гелях для душа в зоне хранения' });
  const co = pick(confirmedToday, 2);
  add(todayTasks, co && { who: E.ismailov, title: `Собрать заказ №${co.number} к 15:00`, link: { type: 'order', id: co.id }, time: '15:00' });
  const df = pick(deficit);
  add(todayTasks, df && { who: E.ismailov, title: `Проверить остаток: ${shortName(df)} — на полке почти нет`, link: { type: 'product', id: df.id } });
  add(todayTasks, { who: E.ismailov, title: 'Подготовить пополнение магазина на пятницу' });
  add(overdueTasks, { who: E.ismailov, title: 'Убрать паллеты из прохода у ворот' });

  // диспетчер
  add(todayTasks, failedToday && { who: E.lebedeva, title: `Решить по неудачной доставке №${failedToday.number}: повтор или на склад`, link: { type: 'delivery', id: failedToday.id }, priority: 'high' });
  add(todayTasks, waiting.length > 0 && { who: E.lebedeva, title: `Назначить курьеров на ${waiting.length} доставки без курьера`, link: { type: 'delivery', id: waiting[0].id } });
  add(todayTasks, denis.onHand > 0 && { who: E.lebedeva, title: `Проверить, сдал ли Денис деньги за вчера — ${rub(denis.onHand)}` });
  add(overdueTasks, { who: E.lebedeva, title: 'Собрать с курьеров чеки за бензин за неделю' });
  add(todayTasks, { who: E.lebedeva, title: 'Составить маршруты на завтра до 17:00', time: '17:00' });

  // курьеры
  const courierTasks: [ID, string][] = [
    [E.morozov, `Сдать в кассу ${rub(denis.onHand)} за вчера и сегодня`],
    [E.morozov, 'Заехать на заправку, чек — диспетчеру'],
    [E.morozov, 'Отвезти закрывающие документы в гостиницу «Волжские зори»'],
    [E.zaytsev, 'Забрать возврат у клиента на Боевой'],
    [E.zaytsev, 'Проверить давление в шинах «Ларгуса»'],
    [E.zaytsev, 'Перезвонить клиенту по неудачной доставке'],
    [E.vlasov, 'Забрать на складе коробки для «Каспий-Маркета»'],
    [E.vlasov, 'Отдать путевой лист за неделю'],
    [E.vlasov, 'Уточнить подъезд на Хибинской — шлагбаум'],
  ];
  for (const [who, title] of courierTasks) add(todayTasks, { who, title });
  add(overdueTasks, { who: E.vlasov, title: 'Сдать акт по возврату на склад' });
  add(overdueTasks, { who: E.zaytsev, title: 'Получить новую карту для бензина' });
  add(overdueTasks, { who: E.morozov, title: 'Отдать диспетчеру путевой лист за прошлую неделю' });

  // создаём задачи операциями
  const authorFor = (who: ID): ID => (who === E.owner ? E.owner : (MANAGERS as readonly string[]).includes(who) ? E.owner : who === E.belova ? E.owner : rng.pick([E.owner, E.sokolov, E.lebedeva]));
  let i = 0;
  const create = (t: TaskDraft, due: ISODate, createdAt: ISODateTime): ID | undefined => {
    try {
      return applyOp(db, 'task.create', { title: t.title, assigneeId: t.who, due, dueTime: t.time ?? null, priority: t.priority ?? 'normal', link: t.link ?? null }, { actorId: authorFor(t.who), at: createdAt }).id;
    } catch {
      return undefined;
    }
  };
  // выполненные за последние две недели
  const doneTitles: Record<string, string[]> = {
    [E.owner]: ['Согласовать акцию «Осенняя стирка»', 'Встреча с «ЮгХимОпт» по ценам'],
    [E.sokolov]: ['Обзвонить кафе по акции Synergetic', 'Отправить акт сверки гостинице «Волжские зори»'],
    [E.petrova]: ['Перезаключить договор с «Блеск-Сервисом»', 'Проверить лимиты у рынков'],
    [E.mironova]: ['Отвезти прайс в магазины на Савушкина', 'Собрать заказы на Красной Набережной'],
    [E.abdullaev]: ['Объехать новые точки на Боевой', 'Получить подпись на акте сверки'],
    [E.tarasov]: ['Познакомиться с клиентами в Ленинском районе', 'Забрать возврат в магазине «Лотос»'],
    [E.belova]: ['Оплатить аренду за ноябрь', 'Выгрузить выписку из банка за неделю'],
    [E.krylov]: ['Принять поставку от «Хозторга»', 'Списать протёкший Санфор'],
    [E.ismailov]: ['Пополнить магазин в среду', 'Разобрать паллет с бумагой'],
    [E.lebedeva]: ['Составить маршруты на среду', 'Перенести доставку по просьбе клиента'],
    [E.orlova]: ['Принять пополнение магазина', 'Выставить новую партию освежителей'],
    [E.kim]: ['Пересчитать гели для душа', 'Поменять ценники после повышения Persil'],
    [E.morozov]: ['Сдать деньги за понедельник'],
    [E.zaytsev]: ['Отвезти документы в кафе «Шафран»'],
    [E.vlasov]: ['Забрать брак у «Каспий-Маркета»'],
  };
  for (const [who, titles] of Object.entries(doneTitles)) {
    titles.forEach((title, k) => {
      const due = plusDays(today, -rng.int(2, 13));
      const id = create({ who, title }, due, atTime(plusDays(due, -rng.int(0, 2)), 9 * 60 + rng.int(0, 120)));
      if (id) applyOp(db, 'task.complete', { taskId: id }, { actorId: who, at: atTime(due, 15 * 60 + rng.int(0, 180) + k) });
    });
  }
  for (const t of overdueTasks) create(t, plusDays(today, -rng.int(1, 3)), atTime(plusDays(today, -rng.int(4, 6)), 10 * 60 + i++));
  for (const t of todayTasks) create(t, today, rng.chance(0.5) ? atTime(yesterday, 17 * 60 + rng.int(0, 60)) : atTime(today, 8 * 60 + rng.int(0, 50)));
}
