/* После симуляции: планы продаж, переписка WhatsApp и задачи сотрудников.
   Тексты собраны из настоящих документов базы: номера заказов, суммы долгов, товары. */
import type { ChatMessage, Client, TaskKind, DB, ID, ISODate, ISODateTime, Order, TaskLink } from '../types';
import type { Rng } from '../rng';
import { applyOp } from '../ops';
import { shortName } from '../opkit';
import { get } from '../idx';
import { clientBalance, courierCash, orderPayment, salesForPeriod, stockIndex, supplierBalance } from '../selectors';
import { atTime, dayNum, dayText, dow, lastOfMonth, plusDays } from '../dates';
import { plural, rub } from '../text';
import { actFile, ensureChat, invoiceFile, priceFile, textAway } from '../whatsapp';
import { findProduct } from '../orderText';
import { E, MANAGERS, REPS, SELLERS, KHALILOV_START } from './org';
import { FEMALE_FIRST } from './names';
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
      if (e === E.khalilov && m === '2026-08') continue;
      const f = e === E.khalilov && m === '2026-09' ? KHALILOV_START : from;
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
  void metas;
  const today = db.meta.today;
  // имя представителя в винительном падеже: «через Аминат», «через Ислама», «через Зарему», «через Шамиля».
  // Женские имена на согласный (Аминат, Патимат) не склоняются.
  const firstName = (id: ID): string => (get(db, 'employees', id)?.name ?? '').split(' ')[0];
  const isFem = (id: ID): boolean => {
    const n = firstName(id);
    return (FEMALE_FIRST as readonly string[]).includes(n) || /[ая]$/.test(n);
  };
  const empFirst = (id: ID): string => {
    const n = firstName(id);
    if (n.endsWith('а')) return n.slice(0, -1) + 'у';
    if (n.endsWith('я')) return n.slice(0, -1) + 'ю';
    if ((FEMALE_FIRST as readonly string[]).includes(n)) return n;
    if (n.endsWith('ь')) return n.slice(0, -1) + 'я';
    return n + 'а';
  };
  const recent = (o: Order): boolean => o.createdAt.slice(0, 10) >= plusDays(today, -12);
  const wholesale = db.clients.filter((c) => c.segment !== 'retail' && c.active && c.ownerId);
  const ordersOf = (cid: ID): Order[] => db.orders.filter((o) => o.clientId === cid && o.state !== 'cancelled');
  // клиенты, с которыми уже есть живой разговор (не только автосообщения), — по одному сюжету на клиента
  const used = new Set<ID>();
  // переписка ложится в диалог клиента: после подключения WhatsApp там уже есть автосообщения о заказах
  const mk = (c: Client, messages: ChatMessage[], unread: number): void => {
    used.add(c.id);
    const ch = ensureChat(db, c);
    ch.messages.push(...messages);
    ch.unread = unread;
  };
  const hasAuto = (cid: ID, ref: string): boolean => !!db.chats.find((x) => x.clientId === cid)?.messages.some((m) => m.ref === ref);
  const msg = (at: ISODateTime, from: 'client' | 'staff', text: string, authorId: ID | null = null, orderId: ID | null = null, extra: Partial<ChatMessage> = {}): ChatMessage => ({
    at,
    from,
    authorId,
    text,
    orderId,
    ...extra,
  });
  const t = (daysBack: number, minutes: number): ISODateTime => atTime(plusDays(today, -daysBack), minutes);
  const staffOf = (c: Client): ID => (c.ownerId && (MANAGERS as readonly string[]).includes(c.ownerId) ? c.ownerId : E.omarov);
  const lineText = (o: Order, k: number): string =>
    o.lines
      .slice(0, k)
      .map((l) => {
        const p = get(db, 'products', l.productId);
        const pk = l.pack === 'box' ? (l.packQty === 1 ? 'коробку' : `${l.packQty} коробки`) : l.pack === 'pack' ? `${l.packQty} упак.` : `${l.qty} шт`;
        return `${p ? shortName(p) : 'товар'} — ${pk}`;
      })
      .join(', ');

  // 1–3: заказ из переписки: клиент пишет список, менеджер оформляет, номер и сумму клиент получает автосообщением
  const chatOrders = db.orders.filter((o) => (o.source === 'chat' || o.source === 'phone') && recent(o) && o.state !== 'cancelled' && o.state !== 'request');
  let invoiceSent = false;
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
    ];
    if (!hasAuto(c.id, `confirmed:${o.id}`)) {
      msgs.push(msg(t(back, m0 + 2), 'staff', `${isFem(s) ? 'Оформила' : 'Оформил'} заказ № ${o.number} на ${rub(o.total)}${d ? `, доставка ${dayText(d.date)}, ${d.interval}` : ', можно забрать со склада после 15:00'}`, s, o.id));
    }
    if (!invoiceSent && c.deferDays > 0) {
      invoiceSent = true;
      msgs.push(msg(t(back, m0 + 5), 'staff', `Счёт по заказу № ${o.number} — во вложении`, s, o.id, { file: invoiceFile(o) }));
    }
    msgs.push(msg(t(back, m0 + 9), 'client', rng.pick(['Спасибо, ждём', 'Отлично, оплата как обычно', 'Принято, спасибо!'])));
    mk(c, msgs, 0);
  }

  // 4–5: напоминание об оплате с актом сверки (одна — непрочитанная)
  const debtors = wholesale.filter((c) => clientBalance(db, c.id).overdue > 0 && !used.has(c.id));
  debtors.slice(0, 2).forEach((c, i) => {
    const b = clientBalance(db, c.id);
    const o = ordersOf(c.id).find((x) => orderPayment(db, x).overdueDays > 0);
    const s = staffOf(c);
    const msgs = [
      msg(
        t(2 + i, 10 * 60 + 15),
        'staff',
        `${first(c)}, добрый день! Напоминаю про оплату${o ? ` по заказу № ${o.number}` : ''}: ${rub(b.overdue)}, срок оплаты прошёл ${b.maxOverdueDays} ${plural(b.maxOverdueDays, 'день', 'дня', 'дней')} назад. Акт сверки во вложении`,
        s,
        o?.id ?? null,
        i === 0 ? { file: actFile(plusDays(today, -(2 + i))), purpose: 'reminder' as const } : { purpose: 'reminder' as const },
      ),
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
        msg(t(1, 16 * 60 + 20), 'staff', `Добрый день! Заказ № ${get(db, 'orders', d.orderId)?.number ?? ''} привезём завтра, ${d.interval}`, staffOf(c)),
        msg(t(0, 12 * 60 + 47), 'client', 'Добрый! Во сколько примерно будете? Мне отъехать нужно'),
        msg(t(0, 12 * 60 + 48), 'client', 'Или можно оставить продавцу'),
      ],
      2,
    );
  }

  // 9: прайс файлом и акция
  const free2 = wholesale.filter((c) => !used.has(c.id));
  if (free2.length) {
    const c = rng.pick(free2);
    const s = staffOf(c);
    const promo = db.promos.find((p) => p.active && p.start <= today && p.end >= today);
    mk(
      c,
      [
        msg(t(4, 14 * 60 + 10), 'client', 'Пришлите, пожалуйста, актуальный прайс на порошки и гели'),
        msg(t(4, 14 * 60 + 32), 'staff', `Прайс во вложении.${promo ? ` Сейчас действует акция «${promo.name}» до ${dayText(promo.end)}` : ''}`, s, null, { file: priceFile(plusDays(today, -4)) }),
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
    const contactFem = (FEMALE_FIRST as readonly string[]).includes(first(c));
    mk(
      c,
      [
        msg(t(back, 10 * 60), 'client', `В последней поставке ${p ? shortName(p) : 'товар'} — ${ret.lines[0].qty} шт пришли с повреждением. Что делаем?`),
        msg(t(back, 10 * 60 + 25), 'staff', 'Пришлите фото, оформим возврат. Заберём со следующей доставкой', staffOf(c)),
        msg(t(back, 10 * 60 + 31), 'client', contactFem ? 'Фото отправила' : 'Фото отправил'),
        msg(t(back - 1, 15 * 60 + 5), 'staff', `Оформили возврат № ${ret.number} на ${rub(ret.amount)}`, staffOf(c)),
      ],
      0,
    );
  }

  // 11–12: представителям — новые заявки и точки
  for (const rep of [E.rasulova, E.abdullaev]) {
    const c = db.clients.find((x) => x.ownerId === rep && !used.has(x.id) && x.active);
    if (!c) continue;
    const lastOrder = ordersOf(c.id).slice(-1)[0];
    const msgs = [msg(t(0, 8 * 60 + 41), 'client', `${firstName(rep)}, добрый день! Заедете сегодня? Хочу добавить мешки 120 л и перчатки`)];
    if (lastOrder && rng.chance(0.5)) msgs.unshift(msg(t(6, 16 * 60), 'client', `Спасибо, заказ № ${lastOrder.number} получили`));
    mk(c, msgs, 1);
  }

  // как клиент пишет товар своими словами: «AOS Лимон 900 мл» — проверяем, что разбор находит именно этот товар
  const casual = (pid: ID): string | null => {
    const p = get(db, 'products', pid);
    if (!p) return null;
    const head = p.name.split(', ')[0];
    const vol = p.volume ?? '';
    for (const v of [`${head} ${vol}`, `${head.toLowerCase()} ${vol.replace(' ', '')}`, shortName(p)]) {
      const r = findProduct(db, v);
      if (r.product?.id === pid && r.matches === 1) return v.trim();
    }
    return null;
  };
  const boxed = (pid: ID, boxes: number): boolean => {
    const p = get(db, 'products', pid);
    const box = p?.packs.find((k) => k.key === 'box');
    return !!p && p.active && !!box && (si.get(pid)?.warehouse.available ?? 0) >= box.qty * boxes;
  };

  // 13: свежее сообщение — заказ списком, ещё не оформлен. В чате его разбирают в заказ одной кнопкой
  const listPool = wholesale.filter((c) => !used.has(c.id) && ordersOf(c.id).length >= 3 && clientBalance(db, c.id).overdue === 0);
  const listClient = listPool.find((c) => c.ownerId === E.omarov) ?? listPool.find((c) => (MANAGERS as readonly string[]).includes(c.ownerId ?? ''));
  if (listClient) {
    const bought = [...new Set(ordersOf(listClient.id).flatMap((o) => o.lines.map((l) => l.productId)))];
    const picks: { name: string; qty: string }[] = [];
    const qtys = ['3 коробки', '2 коробки', 'коробку'];
    for (const pid of rng.shuffle(bought)) {
      if (picks.length >= 3) break;
      if (!boxed(pid, 3)) continue;
      const nm = casual(pid);
      if (nm) picks.push({ name: nm, qty: qtys[picks.length] });
    }
    for (const p of rng.shuffle(hot)) {
      if (picks.length >= 3) break;
      if (!boxed(p.id, 3)) continue;
      const nm = casual(p.id);
      if (nm && !picks.some((x) => x.name === nm)) picks.push({ name: nm, qty: qtys[picks.length] });
    }
    const text = `Добрый день! На пятницу, пожалуйста:\n${picks.map((x) => `${x.name} — ${x.qty}`).join('\n')}\nИ посоветуйте что-нибудь от моли`;
    mk(listClient, [msg(t(0, 13 * 60 + 58), 'client', text)], 1);
  }

  // 14: клиент написал вечером — ответил автоответ, утром менеджер
  const lateClient = wholesale.find((c) => c.ownerId === E.magomedova && !used.has(c.id) && c.active);
  const lateProduct = hot.find((p) => boxed(p.id, 2) && casual(p.id));
  if (lateClient && lateProduct) {
    const wa = db.settings.whatsapp;
    const s = staffOf(lateClient);
    mk(
      lateClient,
      [
        msg(t(1, 21 * 60 + 37), 'client', `Добрый вечер! ${casual(lateProduct.id)} есть? Нужно 2 коробки`),
        msg(t(1, 21 * 60 + 37), 'staff', textAway(wa.hours.from, wa.hours.to), null, null, { auto: 'away', ref: `away:${lateClient.id}:${plusDays(today, -1)}` }),
        msg(t(0, 8 * 60 + 14), 'staff', `${first(lateClient)}, доброе утро! Есть. Привезём сегодня после обеда или завтра утром — как удобнее?`, s),
        msg(t(0, 8 * 60 + 40), 'client', 'Завтра утром, спасибо'),
      ],
      0,
    );
  }

  for (const ch of db.chats) ch.messages.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/* ---------- задачи ---------- */

interface TaskDraft {
  who: ID;
  title: string;
  link?: TaskLink;
  priority?: 'high';
  time?: string;
  /** вид — такие задачи закрываются сами, когда дело сделано */
  kind?: TaskKind;
  /** кто поставил (по умолчанию — владелец или руководитель) */
  author?: ID;
  /** когда поставили (по умолчанию — вчера вечером или сегодня утром) */
  at?: ISODateTime;
}

export function buildTasks(db: DB, rng: Rng, meta: ProdMeta[]): void {
  const today = db.meta.today;
  // плательщик в выписке у неопознанных поступлений — клиент, у которого на эту сумму есть неоплаченный долг
  // (без переводов на проверке): бухгалтер находит его по ИНН, и деньги гасят долг, а не уходят в аванс
  {
    const usedPayer = new Set<ID>();
    for (const pay of db.payments.filter((x) => x.status === 'unidentified')) {
      const cands = db.clients
        .filter((c) => c.active && c.inn && c.segment !== 'retail' && !usedPayer.has(c.id))
        .map((c) => {
          const b = clientBalance(db, c.id);
          const exact = db.orders.some((o) => o.clientId === c.id && Math.abs(orderPayment(db, o).due - orderPayment(db, o).pending - pay.amount) < 1);
          return { c, free: b.debt - b.pending, exact };
        })
        .filter((x) => x.free >= pay.amount && x.c.ownerId)
        .sort((a, b2) => Number(b2.exact) - Number(a.exact) || a.free - b2.free);
      const pick = cands[0];
      if (!pick) continue;
      usedPayer.add(pick.c.id);
      pay.payer = { name: pick.c.name.split(' · ')[0], inn: pick.c.inn! };
    }
  }
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
  const denis = courierCash(db, E.musaev);
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
  // заявка представителя клиенту с просрочкой: менеджер не может подтвердить сам и запросил согласие владельца
  let ask = requests.find((o) => clientBalance(db, o.clientId).overdue > 0);
  if (!ask) {
    // нет такой заявки — представитель сегодня в визите оформил заявку должнику
    const d = overdueClients.find((x) => x.c.active && x.c.ownerId && (REPS as readonly string[]).includes(x.c.ownerId) && x.c.ownerId !== E.khalilov);
    const last = d && db.orders.filter((o) => o.clientId === d.c.id && o.state !== 'cancelled').slice(-1)[0];
    if (d && last) {
      try {
        const r = applyOp(
          db,
          'order.create',
          { clientId: d.c.id, pointId: last.pointId, lines: last.lines.filter((l) => (si.get(l.productId)?.warehouse.available ?? 0) >= l.qty * 2).slice(0, 3).map((l) => ({ productId: l.productId, pack: l.pack, packQty: l.packQty })), state: 'request', source: 'rep', fulfillment: last.fulfillment, comment: 'Заявка из визита' },
          { actorId: d.c.ownerId!, at: (() => { const lastAt = db.orders.reduce((m, o) => (o.createdAt > m ? o.createdAt : m), ''); const lm = lastAt.startsWith(today) ? +lastAt.slice(11, 13) * 60 + +lastAt.slice(14, 16) : 11 * 60; return atTime(today, Math.min(13 * 60 + 40, lm + 3)); })() },
        );
        ask = r.id ? get(db, 'orders', r.id) : undefined;
        if (ask) requests.push(ask);
      } catch {
        /* не вышло — без этого примера */
      }
    }
  }
  if (ask) {
    const cl = get(db, 'clients', ask.clientId);
    const mgr = (MANAGERS as readonly string[]).includes(cl?.ownerId ?? '') ? cl!.ownerId! : E.omarov;
    const b = clientBalance(db, ask.clientId);
    add(todayTasks, {
      who: E.owner,
      author: mgr,
      title: `Согласовать заказ № ${ask.number} ${toClient(ask.clientId)}: просрочка ${rub(b.overdue)} — ${b.maxOverdueDays} ${plural(b.maxOverdueDays, 'день', 'дня', 'дней')}`,
      link: { type: 'order', id: ask.id },
      priority: 'high',
      kind: 'approve_order',
      // после того как заявку оформили: менеджер посмотрел и запросил согласие
      at: (() => { const m0 = ask.createdAt.slice(0, 10) === today ? +ask.createdAt.slice(11, 13) * 60 + +ask.createdAt.slice(14, 16) : 9 * 60; return atTime(today, Math.min(13 * 60 + 59, m0 + 12)); })(),
    });
    // «Отправлен владельцу на согласование» пишет в историю заказа сама задача вида approve_order
  }
  add(todayTasks, { who: E.owner, title: 'Посмотреть, как идёт акция «Осенняя стирка»: порошки к середине ноября', time: '16:00' });
  add(todayTasks, { who: E.owner, title: 'Подписать продление аренды склада на 2027 год', time: '12:00' });
  add(overdueTasks, { who: E.owner, title: 'Ответить «ЭкоХим Поволжье» по новым условиям отсрочки' });

  // продавцы
  const nearP = pick(near);
  add(todayTasks, { who: E.alieva, title: 'Поменять ценники на Fairy 450 мл по акции и выложить у кассы', priority: 'high' });
  add(todayTasks, nearP && { who: E.alieva, title: `Проверить сроки: ${shortName(nearP)} — до ${dayText(si.get(nearP.id)!.nearestExpiry!)}, вынести вперёд`, link: { type: 'product', id: nearP.id } });
  add(todayTasks, { who: E.alieva, title: 'Пересчитать размен перед вечерней инкассацией', time: '19:30' });
  add(overdueTasks, { who: E.alieva, title: 'Перезвонить покупательнице по возврату геля для душа' });
  add(todayTasks, { who: E.kurbanova, title: 'Принять пополнение магазина в пятницу утром и разложить мешки', time: '08:00' });
  add(todayTasks, { who: E.kurbanova, title: 'Выдать карты постоянного покупателя — осталось 12 штук, заказать ещё' });
  add(todayTasks, { who: E.kurbanova, title: 'Сфотографировать полку с освежителями для Glade' });
  add(overdueTasks, { who: E.kurbanova, title: 'Сдать отчёт по возвратам за октябрь Хадижат Сулеймановой' });

  // менеджеры
  MANAGERS.forEach((m, i) => {
    // менеджер работает со своими клиентами и клиентами представителей — задачи только по ним
    const sees = (cid: ID): boolean => {
      const own = get(db, 'clients', cid)?.ownerId ?? null;
      return own === m || own === null || (REPS as readonly string[]).includes(own);
    };
    const mine = overdueClients.filter((x) => sees(x.c.id));
    const oc = pick(mine, i);
    add(todayTasks, oc && { who: m, title: `Позвонить ${callTo(oc.c.id)} по долгу ${rub(oc.b.overdue)} — просрочка ${oc.b.maxOverdueDays} ${plural(oc.b.maxOverdueDays, 'день', 'дня', 'дней')}`, link: { type: 'client', id: oc.c.id }, priority: 'high', kind: 'call_debt' });
    add(todayTasks, requests.length > 0 && { who: m, title: 'Подтвердить заявки представителей до 15:00', time: '15:00', kind: 'confirm_requests' });
    const co = pick(confirmedToday.filter((o) => sees(o.clientId)), i);
    add(todayTasks, co && { who: m, title: `Отправить счёт ${toClient(co.clientId)} по заказу №${co.number}`, link: { type: 'order', id: co.id }, kind: 'send_invoice' });
    add(todayTasks, i === 0 && pending[0] && { who: m, title: `Проверить скриншот перевода на ${rub(pending[0].amount)} — передать Хадижат`, link: { type: 'payment', id: pending[0].id } });
    add(todayTasks, i === 1 && waiting[0] && { who: m, title: `Согласовать с клиентом ${shortClient(waiting[0].clientId)} время доставки №${waiting[0].number}`, link: { type: 'delivery', id: waiting[0].id } });
    const oc2 = pick(mine, i + 2);
    add(overdueTasks, oc2 && { who: m, title: `Отправить акт сверки ${toClient(oc2.c.id)}`, link: { type: 'client', id: oc2.c.id } });
  });

  // представители
  REPS.forEach((r, i) => {
    const c1 = repClient(r, 1);
    const c2 = repClient(r, 3);
    const c3 = repClient(r, 5);
    add(todayTasks, c1 && { who: r, title: `Привезти образцы Synergetic ${intoPlace(c1.id)}`, link: { type: 'client', id: c1.id } });
    const debtor = overdueClients.find((x) => x.c.ownerId === r);
    add(todayTasks, debtor && { who: r, title: `Напомнить ${toClient(debtor.c.id)} об оплате ${rub(debtor.b.overdue)}`, link: { type: 'client', id: debtor.c.id }, priority: 'high', kind: 'remind_debt' });
    add(todayTasks, c2 && { who: r, title: `Сфотографировать выкладку ${atPlace(c2.id)} — обещали место на кассе`, link: { type: 'client', id: c2.id } });
    add(todayTasks, i === 2 && { who: r, title: 'Познакомиться с новыми точками на Татищева: взять контакты закупщиков' });
    const c4 = repClient(r, 7) ?? repClient(r, 0);
    add(todayTasks, c4 && { who: r, title: `Собрать заказ у ${ofClient(c4.id)} — заканчивается порошок и мешки`, link: { type: 'client', id: c4.id } });
    add(overdueTasks, c3 && { who: r, title: `Уточнить у ${ofClient(c3.id)} адрес второй точки`, link: { type: 'client', id: c3.id } });
  });

  // бухгалтер
  const so = pick(supplierOverdue);
  add(todayTasks, so && { who: E.suleymanova, title: `Оплатить долг поставщику ${so.s.name}: просрочено ${rub(so.b.overdue)}`, priority: 'high', link: { type: 'supplier', id: so.s.id }, kind: 'pay_supplier' });
  const ss = pick(supplierSoon);
  add(todayTasks, ss?.u && { who: E.suleymanova, title: `Запланировать оплату поставщику ${ss.s.name} — ${rub(ss.u.amount)} до ${dayText(ss.u.dueDate)}`, link: { type: 'purchase', id: ss.u.purchaseId } });
  add(todayTasks, unidentified[0] && { who: E.suleymanova, title: `Разнести неопознанный платёж ${rub(unidentified[0].amount)} от ${dayText(unidentified[0].at.slice(0, 10))}`, link: { type: 'payment', id: unidentified[0].id }, kind: 'identify_payment' });
  const yug = db.suppliers.find((x) => x.name.includes('ЮгХимОпт'));
  add(todayTasks, { who: E.suleymanova, title: 'Сверка с «ЮгХимОпт» за октябрь', ...(yug ? { link: { type: 'supplier' as const, id: yug.id } } : {}) });
  add(todayTasks, { who: E.suleymanova, title: 'Подготовить платёжный календарь на следующую неделю', time: '17:00' });
  add(overdueTasks, unidentified[1] && { who: E.suleymanova, title: `Выяснить у банка плательщика на ${rub(unidentified[1].amount)}`, link: { type: 'payment', id: unidentified[1].id }, kind: 'identify_payment' });

  // склад
  const tr = pick(transit);
  add(todayTasks, tr && { who: E.ibragimov, title: `Подготовить место под поставку №${tr.number} — ждём ${dayText(tr.expectedAt)}`, link: { type: 'purchase', id: tr.id } });
  add(todayTasks, quarantine.length > 0 && { who: E.ibragimov, title: `Разобрать товар на проверке: ${quarantine.length} поз.`, priority: 'high' });
  add(todayTasks, partial && { who: E.ibragimov, title: `Дождаться остатка по закупке №${partial.number} и закрыть приёмку`, link: { type: 'purchase', id: partial.id } });
  add(overdueTasks, { who: E.ibragimov, title: 'Пересчитать стеллаж с мешками — расходится с учётом' });
  add(todayTasks, { who: E.ibragimov, title: 'Проверить сроки на гелях для душа в зоне хранения' });
  const co = pick(confirmedToday, 2);
  add(todayTasks, co && { who: E.ismailov, title: `Собрать заказ №${co.number} к 15:00`, link: { type: 'order', id: co.id }, time: '15:00', kind: 'pick_order' });
  const df = pick(deficit);
  add(todayTasks, df && { who: E.ismailov, title: `Проверить остаток: ${shortName(df)} — на полке почти нет`, link: { type: 'product', id: df.id } });
  add(todayTasks, { who: E.ismailov, title: 'Подготовить пополнение магазина на пятницу' });
  add(overdueTasks, { who: E.ismailov, title: 'Убрать паллеты из прохода у ворот' });

  // диспетчер
  add(todayTasks, failedToday && { who: E.abakarova, title: `Решить по неудачной доставке №${failedToday.number}: повтор или на склад`, link: { type: 'delivery', id: failedToday.id }, priority: 'high', kind: 'failed_delivery' });
  add(todayTasks, waiting.length > 0 && { who: E.abakarova, title: `Назначить курьеров на доставки без курьера: ${waiting.length}`, link: { type: 'delivery', id: waiting[0].id }, kind: 'assign_couriers' });
  add(todayTasks, denis.onHand > 0 && { who: E.abakarova, title: `Принять у Саида деньги за вчера — ${rub(denis.onHand)}`, kind: 'courier_cash' });
  add(overdueTasks, { who: E.abakarova, title: 'Собрать с курьеров чеки за бензин за неделю' });
  add(todayTasks, { who: E.abakarova, title: 'Составить маршруты на завтра до 17:00', time: '17:00' });

  // курьеры
  const courierTasks: [ID, string, TaskKind?][] = [
    [E.musaev, `Сдать в кассу ${rub(denis.onHand)} за вчера и сегодня`, 'courier_cash'],
    [E.musaev, 'Заехать на заправку, чек — диспетчеру'],
    [E.musaev, 'Отвезти закрывающие документы в гостиницу «Волжские зори»'],
    [E.ramazanov, 'Забрать возврат у клиента на Боевой'],
    [E.ramazanov, 'Проверить давление в шинах «Ларгуса»'],
    [E.ramazanov, 'Перезвонить клиенту по неудачной доставке'],
    [E.daudov, 'Забрать на складе коробки для «Каспий-Маркета»'],
    [E.daudov, 'Отдать путевой лист за неделю'],
    [E.daudov, 'Уточнить подъезд на Хибинской — шлагбаум'],
  ];
  for (const [who, title, kind] of courierTasks) add(todayTasks, { who, title, ...(kind ? { kind } : {}) });
  add(overdueTasks, { who: E.daudov, title: 'Сдать акт по возврату на склад' });
  add(overdueTasks, { who: E.ramazanov, title: 'Получить новую карту для бензина' });
  add(overdueTasks, { who: E.musaev, title: 'Отдать диспетчеру путевой лист за прошлую неделю' });

  // создаём задачи операциями
  const authorFor = (who: ID): ID => (who === E.owner ? E.owner : (MANAGERS as readonly string[]).includes(who) ? E.owner : who === E.suleymanova ? E.owner : rng.pick([E.owner, E.omarov, E.abakarova]));
  let i = 0;
  const create = (t: TaskDraft, due: ISODate, createdAt: ISODateTime): ID | undefined => {
    try {
      return applyOp(db, 'task.create', { title: t.title, assigneeId: t.who, due, dueTime: t.time ?? null, priority: t.priority ?? 'normal', link: t.link ?? null, ...(t.kind ? { kind: t.kind } : {}) }, { actorId: t.author ?? authorFor(t.who), at: createdAt }).id;
    } catch {
      return undefined;
    }
  };
  // выполненные за последние две недели
  const doneTitles: Record<string, string[]> = {
    [E.owner]: ['Согласовать акцию «Осенняя стирка»', 'Встреча с «ЮгХимОпт» по ценам'],
    [E.omarov]: ['Обзвонить кафе по акции Synergetic', 'Отправить акт сверки гостинице «Волжские зори»'],
    [E.magomedova]: ['Перезаключить договор с «Блеск-Сервисом»', 'Проверить лимиты у рынков'],
    [E.rasulova]: ['Отвезти прайс в магазины на Савушкина', 'Собрать заказы на Красной Набережной'],
    [E.abdullaev]: ['Объехать новые точки на Боевой', 'Получить подпись на акте сверки'],
    [E.khalilov]: ['Познакомиться с клиентами в Ленинском районе', 'Забрать возврат в магазине «Лотос»'],
    [E.suleymanova]: ['Оплатить аренду за ноябрь', 'Выгрузить выписку из банка за неделю'],
    [E.ibragimov]: ['Принять поставку от «Хозторга»', 'Списать протёкший Санфор'],
    [E.ismailov]: ['Пополнить магазин в среду', 'Разобрать паллет с бумагой'],
    [E.abakarova]: ['Составить маршруты на среду', 'Перенести доставку по просьбе клиента'],
    [E.alieva]: ['Принять пополнение магазина', 'Выставить новую партию освежителей'],
    [E.kurbanova]: ['Пересчитать гели для душа', 'Поменять ценники после повышения Persil'],
    [E.musaev]: ['Сдать деньги за понедельник'],
    [E.ramazanov]: ['Отвезти документы в кафе «Шафран»'],
    [E.daudov]: ['Забрать брак у «Каспий-Маркета»'],
  };
  for (const [who, titles] of Object.entries(doneTitles)) {
    titles.forEach((title, k) => {
      const due = plusDays(today, -rng.int(2, 13));
      const id = create({ who, title }, due, atTime(plusDays(due, -rng.int(0, 2)), 9 * 60 + rng.int(0, 120)));
      if (id) applyOp(db, 'task.complete', { taskId: id }, { actorId: who, at: atTime(due, 15 * 60 + rng.int(0, 180) + k) });
    });
  }
  for (const t of overdueTasks) create(t, plusDays(today, -rng.int(1, 3)), atTime(plusDays(today, -rng.int(4, 6)), 10 * 60 + i++));
  for (const t of todayTasks) {
    const when = rng.chance(0.5) ? atTime(yesterday, 17 * 60 + rng.int(0, 60)) : atTime(today, 8 * 60 + rng.int(0, 50));
    create(t, today, t.at ?? when);
  }
}
