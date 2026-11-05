/* WhatsApp магазина: тексты автосообщений и их отправка по событиям.
   Это пример подключения: сообщения сохраняются в переписке клиента внутри программы и наружу не уходят.
   Автосообщение отправляет applyOp после успешной операции (заказ подтверждён, курьер выехал, доставлен, оплата проведена).
   Одно событие — одно сообщение: ключ ref не даёт отправить его дважды. */
import type { Chat, ChatFile, Client, DB, Delivery, ID, Order, WaAutoKey } from './types';
import type { OpCtx } from './opkit';
import { nextId } from './opkit';
import { get } from './idx';
import { clientBalance, orderPayment } from './selectors';
import { dayText } from './dates';
import { plural, rub } from './text';

export const WA_AUTO_META: Record<WaAutoKey, { label: string; when: string }> = {
  confirmed: { label: 'Заказ принят', when: 'Заказ подтверждён, товар зарезервирован' },
  pickup_ready: { label: 'Заказ собран', when: 'Склад собрал заказ на самовывоз' },
  on_way: { label: 'Курьер выехал', when: 'Курьер отметил выезд' },
  delivered: { label: 'Заказ доставлен', when: 'Курьер отметил «Вручено»' },
  payment: { label: 'Оплата получена', when: 'Оплата проведена в деньгах' },
  away: { label: 'Ответ вне рабочего времени', when: 'Клиент пишет вечером или ночью' },
};

/** «+7 917 176-44-53» — номер в тексте сообщения. */
export function phoneText(p: string): string {
  const d = p.replace(/\D/g, '');
  if (d.length !== 11) return p;
  return `+7 ${d.slice(1, 4)} ${d.slice(4, 7)}-${d.slice(7, 9)}-${d.slice(9, 11)}`;
}

const firstName = (db: DB, id: ID | null): string => (id ? (get(db, 'employees', id)?.name ?? '').split(' ')[0] : '');

/* ---------- тексты ---------- */

export function textConfirmed(o: Pick<Order, 'number' | 'total' | 'fulfillment'>, d?: Pick<Delivery, 'date' | 'interval'> | null): string {
  const tail = d ? ` Доставка ${dayText(d.date)}, ${d.interval}.` : o.fulfillment === 'delivery' ? ' Напишем, когда курьер выедет.' : ' Напишем, когда соберём — можно будет забирать.';
  return `Здравствуйте! Заказ № ${o.number} на ${rub(o.total)} принят.${tail}`;
}

export function textPickupReady(o: Pick<Order, 'number'>, address: string, until: string, toPay: number): string {
  return `Заказ № ${o.number} собран, можно забирать: ${address}, склад. Работаем до ${until}.${toPay > 0 ? ` К оплате ${rub(toPay)}.` : ''}`;
}

export function textOnWay(o: Pick<Order, 'number'>, d: Pick<Delivery, 'interval' | 'collect'>, courier: string, courierPhone: string): string {
  return (
    `Курьер${courier ? ' ' + courier : ''} выехал к вам с заказом № ${o.number}, будет ${d.interval}.` +
    (courierPhone ? ` Телефон курьера ${phoneText(courierPhone)}.` : '') +
    (d.collect > 0 ? ` К оплате при получении ${rub(d.collect)}.` : '')
  );
}

export function textDelivered(o: Pick<Order, 'number'>, collected: number, rest: number, due: string | null): string {
  return `Заказ № ${o.number} доставлен.${collected > 0 ? ` Получили ${rub(collected)}, спасибо!` : ' Спасибо!'}${rest > 0 && due ? ` Оплата по счёту до ${dayText(due)}.` : ''}`;
}

export function textPayment(amount: number, debtAfter: number): string {
  return `Получили оплату ${rub(amount)}, спасибо!${debtAfter > 0 ? ` Остаток долга ${rub(debtAfter)}.` : ' Долгов нет.'}`;
}

export function textAway(from: string, to: string): string {
  return `Здравствуйте! Мы работаем с ${from} до ${to} и ответим утром. Заказ можно написать здесь — менеджер оформит его первым делом.`;
}

/** Счёт и напоминание об оплате — их отправляет сотрудник, перед отправкой текст можно поправить. */
export function textInvoice(db: DB, o: Order, contactFirst: string): string {
  const c = db.settings.company;
  const pay = orderPayment(db, o);
  const toPay = Math.max(0, pay.amount - pay.paid);
  return (
    `Здравствуйте${contactFirst ? ', ' + contactFirst : ''}! Счёт на оплату по заказу № ${o.number} на ${rub(toPay)} — во вложении.` +
    `\nПолучатель: ${c.legalName}, ИНН ${c.inn}` +
    `\nСчёт ${c.account} в ${c.bank}` +
    `\nНазначение: оплата по счёту № ${o.number}.` +
    (o.dueDate ? `\nОплатить до ${dayText(o.dueDate)}.` : '')
  );
}

export function textReminder(db: DB, clientId: ID, contactFirst: string): string {
  const b = clientBalance(db, clientId);
  const overdue = b.overdue > 0;
  return (
    `${contactFirst ? contactFirst + ', добрый' : 'Добрый'} день! Напоминаем об оплате: ${overdue ? `просрочено ${rub(b.overdue)}` : `к оплате ${rub(b.debt)}`}` +
    (overdue && b.maxOverdueDays > 0 ? `, срок оплаты прошёл ${b.maxOverdueDays} ${plural(b.maxOverdueDays, 'день', 'дня', 'дней')} назад` : '') +
    `. Акт сверки во вложении. Если уже оплатили — пришлите, пожалуйста, скриншот перевода.`
  );
}

export function invoiceFile(o: Pick<Order, 'number' | 'lines'>): ChatFile {
  return { name: `Счёт № ${o.number}.pdf`, size: `${60 + (o.lines.length % 9) * 6} КБ`, kind: 'pdf' };
}
export function actFile(today: string): ChatFile {
  return { name: `Акт сверки на ${dayText(today)}.pdf`, size: '48 КБ', kind: 'pdf' };
}
export function priceFile(today: string): ChatFile {
  const months = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
  return { name: `Прайс БытМаркет, ${months[+today.slice(5, 7) - 1]}.xlsx`, size: '312 КБ', kind: 'xlsx' };
}

/* ---------- отправка ---------- */

export function chatOfClient(db: DB, clientId: ID): Chat | undefined {
  return db.chats.find((c) => c.clientId === clientId);
}

/** Диалог клиента: существующий или новый. */
export function ensureChat(db: DB, client: Client): Chat {
  const ex = chatOfClient(db, client.id);
  if (ex) return ex;
  const chat: Chat = { id: nextId(db, 'chat', 'ch-'), clientId: client.id, channel: 'whatsapp', messages: [], unread: 0, ownerId: client.ownerId };
  db.chats.push(chat);
  return chat;
}

/** Автосообщение клиенту. false — WhatsApp не подключён, шаблон выключен, у клиента нет телефона или уже отправлено. */
export function waNotify(db: DB, ctx: OpCtx, clientId: ID, key: WaAutoKey, text: string, orderId: ID | null, ref: string): boolean {
  const wa = db.settings.whatsapp;
  if (!wa || !wa.connected || !wa.auto[key]) return false;
  const client = get(db, 'clients', clientId);
  if (!client || !client.phone || !client.active) return false;
  const ex = chatOfClient(db, clientId);
  if (ex && ex.messages.some((m) => m.ref === ref)) return false;
  const chat = ex ?? ensureChat(db, client);
  chat.messages.push({ at: ctx.at, from: 'staff', authorId: null, text, orderId, auto: key, ref });
  return true;
}

const SENT = 'Клиенту ушло сообщение в WhatsApp';

/** Вызывается из applyOp после успешной операции. Возвращает пояснение для уведомления на экране. */
export function waAfterOp(db: DB, type: string, result: { id?: ID }, ctx: OpCtx): string | null {
  const wa = db.settings.whatsapp;
  if (!wa || !wa.connected || !result.id) return null;
  const id = result.id;
  switch (type) {
    case 'order.create':
    case 'order.confirm': {
      const o = get(db, 'orders', id);
      if (!o || o.state !== 'confirmed') return null;
      const d = o.deliveryId ? get(db, 'deliveries', o.deliveryId) : null;
      return waNotify(db, ctx, o.clientId, 'confirmed', textConfirmed(o, d), o.id, `confirmed:${o.id}`) ? SENT : null;
    }
    case 'order.pick': {
      const o = get(db, 'orders', id);
      if (!o || o.pick !== 'picked' || o.fulfillment !== 'pickup' || o.ship === 'shipped' || o.ship === 'delivered') return null;
      const pay = orderPayment(db, o);
      const client = get(db, 'clients', o.clientId);
      const toPay = client && client.deferDays > 0 ? 0 : Math.max(0, pay.amount - pay.paid);
      const addr = db.settings.company.address.replace(/^\d{6},\s*/, '');
      return waNotify(db, ctx, o.clientId, 'pickup_ready', textPickupReady(o, addr, wa.hours.to, toPay), o.id, `pickup_ready:${o.id}`) ? SENT : null;
    }
    case 'delivery.start': {
      const d = get(db, 'deliveries', id);
      const o = d ? get(db, 'orders', d.orderId) : undefined;
      if (!d || !o || d.state !== 'on_way') return null;
      const courier = d.courierId ? get(db, 'employees', d.courierId) : undefined;
      const text = textOnWay(o, d, firstName(db, d.courierId), courier?.phone ?? '');
      return waNotify(db, ctx, d.clientId, 'on_way', text, o.id, `on_way:${d.id}:${d.attempts.length}`) ? SENT : null;
    }
    case 'delivery.deliver': {
      const d = get(db, 'deliveries', id);
      const o = d ? get(db, 'orders', d.orderId) : undefined;
      if (!d || !o || d.state !== 'delivered') return null;
      const pay = orderPayment(db, o);
      const rest = Math.max(0, pay.amount - pay.paid - pay.pending);
      return waNotify(db, ctx, d.clientId, 'delivered', textDelivered(o, d.collected, rest, o.dueDate), o.id, `delivered:${d.id}`) ? SENT : null;
    }
    case 'payment.client':
    case 'payment.confirm': {
      const p = get(db, 'payments', id);
      if (!p || p.status !== 'posted' || !p.clientId || p.deliveryId) return null;
      const debt = clientBalance(db, p.clientId).debt;
      const orderId = p.allocations.length === 1 ? p.allocations[0].orderId ?? null : null;
      return waNotify(db, ctx, p.clientId, 'payment', textPayment(p.amount, debt), orderId, `payment:${p.id}`) ? SENT : null;
    }
    default:
      return null;
  }
}

/** Состояние сообщения магазина для галочек: прочитано, если клиент потом ответил или сообщение не сегодняшнее. */
export function waReadState(chat: Chat, index: number, today: string): 'read' | 'delivered' {
  const m = chat.messages[index];
  if (m.at.slice(0, 10) < today) return 'read';
  for (let i = index + 1; i < chat.messages.length; i++) if (chat.messages[i].from === 'client') return 'read';
  return 'delivered';
}
