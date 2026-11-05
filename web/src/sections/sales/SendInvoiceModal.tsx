/* Отправить клиенту счёт и реквизиты в его чат. Перед отправкой видно получателя и реквизиты. */
import { useMemo, useState } from 'react';
import { MessageCircle, Send } from 'lucide-react';
import type { Order } from '../../data/types';
import { dispatch, useDB } from '../../data/store';
import { indexes, orderPayment } from './data';
import { useSession } from '../../roles/session';
import { Button, Chip, Field, Modal, Notice, StatList, StatRow, Textarea, fmt, toast } from '../../ui';

export function SendInvoiceModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const db = useDB();
  const { me } = useSession();
  const idx = indexes(db);
  const client = idx.clients.get(order.clientId);
  const chat = db.chats.find((c) => c.clientId === order.clientId);
  const contact = client?.contacts[0];
  const company = db.settings.company;
  const pay = orderPayment(db, order);
  const toPay = Math.max(0, pay.amount - pay.paid);
  const initial = useMemo(
    () =>
      `Здравствуйте${contact ? ', ' + contact.name.split(' ')[0] : ''}! Счёт на оплату № ${order.number} по заказу № ${order.number} на сумму ${fmt.money(toPay)}.` +
      `\nПолучатель: ${company.legalName}, ИНН ${company.inn}` +
      `\nСчёт ${company.account} в ${company.bank}` +
      `\nНазначение: оплата по счёту № ${order.number}.` +
      (order.dueDate ? `\nОплатить до ${fmt.date(order.dueDate)}.` : ''),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [order.id],
  );
  const [text, setText] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    if (!chat) return;
    const r = dispatch('chat.send', { chatId: chat.id, text, orderId: order.id }, me.id);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast('Счёт отправлен в чат клиента');
    onClose();
  };

  return (
    <Modal
      title="Отправить счёт клиенту"
      sub="Проверьте получателя и реквизиты"
      onClose={onClose}
      footer={
      <>
        <Button variant="ghost" onClick={onClose}>
          Отмена
        </Button>
        <Button variant="primary" icon={<Send />} onClick={send} disabled={!chat || !text.trim()}>
          Отправить в чат клиента
        </Button>
      </>
      }
    >
        <StatList>
          <StatRow
            label="Кому"
            value={
              <span className="row" style={{ justifyContent: 'flex-end' }}>
                {client?.name}
              </span>
            }
          />
          <StatRow
            label="Куда"
            value={
              <span className="row" style={{ justifyContent: 'flex-end' }}>
                <Chip tone="green" icon={<MessageCircle />}>
                  WhatsApp
                </Chip>
                {contact ? `${contact.name}, ${fmt.phone(contact.phone)}` : fmt.phone(client?.phone)}
              </span>
            }
          />
          <StatRow label="Счёт" value={`№ ${order.number} на ${fmt.money(toPay)}`} />
          <StatRow label="Получатель платежа" value={company.legalName} />
          <StatRow label="ИНН" value={company.inn} />
          <StatRow label="Банк" value={company.bank} />
          <StatRow label="Расчётный счёт" value={company.account} />
        </StatList>
        {!chat ? <Notice tone="warn">У клиента нет переписки — распечатайте счёт и передайте его вместе с заказом.</Notice> : null}
        <Field label="Сообщение">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} />
        </Field>
        {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}
