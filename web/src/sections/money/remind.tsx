/* Напоминание об оплате в WhatsApp: одно окно для «Долгов покупателей» и «Требует внимания».
   По сообщениям чата с purpose 'reminder' видно, когда напоминали в последний раз. */
import { useState } from 'react';
import type { DB, ID } from '../../data/types';
import { useDB } from '../../data/store';
import { clientBalances } from '../../data/selectors';
import { actFile, textReminder } from '../../data/whatsapp';
import { SendWhatsAppModal } from '../sales/SendInvoiceModal';
import { fmt } from '../../ui';

/** Когда последний раз отправили клиенту напоминание об оплате; null — не напоминали. */
export function lastReminderAt(db: DB, clientId: ID): string | null {
  return remindersIndex(db).get(clientId) ?? null;
}

const cache = new WeakMap<DB, { v: number; m: Map<ID, string> }>();

/** Последнее напоминание по каждому клиенту — один проход по чатам на версию базы. */
export function remindersIndex(db: DB): Map<ID, string> {
  const c = cache.get(db);
  if (c && c.v === db.meta.version) return c.m;
  const m = new Map<ID, string>();
  for (const chat of db.chats) {
    for (const msg of chat.messages) {
      if (msg.purpose !== 'reminder' || msg.from !== 'staff') continue;
      const prev = m.get(chat.clientId);
      if (!prev || msg.at > prev) m.set(chat.clientId, msg.at);
    }
  }
  cache.set(db, { v: db.meta.version, m });
  return m;
}

/** «сегодня в 18:30», «вчера в 11:05», «3 ноября в 10:20». */
export function reminderText(at: string, today: string): string {
  return `${fmt.relDate(at, today)} в ${fmt.time(at)}`;
}

/** Можно ли напомнить в WhatsApp: подключён и у клиента есть телефон. */
export function canRemind(db: DB, clientId: ID): boolean {
  const c = db.clients.find((x) => x.id === clientId);
  return !!db.settings.whatsapp.connected && !!(c?.contacts[0]?.phone ?? c?.phone);
}

/** Напоминание о долге: сумма, просрочка, акт сверки во вложении. Если уже напоминали — видно когда, прежде чем отправить ещё раз. */
export function RemindModal({ clientId, onClose }: { clientId: ID; onClose: () => void }) {
  const db = useDB();
  const c = db.clients.find((x) => x.id === clientId);
  const b = clientBalances(db).get(clientId);
  const [text] = useState(() => textReminder(db, clientId, c?.contacts[0]?.name.split(' ')[0] ?? ''));
  const [last] = useState(() => lastReminderAt(db, clientId));
  if (!c || !b) return null;
  return (
    <SendWhatsAppModal
      clientId={clientId}
      title={last ? 'Напомнить об оплате ещё раз' : 'Напомнить об оплате'}
      initialText={text}
      file={actFile(db.meta.today)}
      rows={[
        { label: 'Долг', value: fmt.money(b.debt) },
        { label: 'Просрочено', value: b.overdue > 0 ? <span className="c-bad">{fmt.money(b.overdue)}</span> : fmt.money(0) },
        ...(last ? [{ label: 'Уже напоминали', value: <span className="c-warn w-700">{reminderText(last, db.meta.today)}</span> }] : []),
      ]}
      okText="Напоминание отправлено клиенту в WhatsApp"
      purpose="reminder"
      onClose={onClose}
    />
  );
}
