/* Отправка клиенту в WhatsApp: счёт, напоминание об оплате, акт сверки, прайс.
   Перед отправкой видно, кому и на какой номер уходит сообщение, и что приложено; текст можно поправить. */
import { useMemo, useState, type ReactNode } from 'react';
import { FileSpreadsheet, FileText, MessageCircle, Send } from 'lucide-react';
import type { ChatFile, ID, Order } from '../../data/types';
import { dispatch, useDB } from '../../data/store';
import { indexes, orderPayment } from './data';
import { useSession } from '../../roles/session';
import { Button, Chip, Field, Modal, Notice, StatList, StatRow, Textarea, fmt, toast } from '../../ui';
import { fixNo } from './lib';
import { invoiceFile, textInvoice } from '../../data/whatsapp';

export function FileChip({ file }: { file: ChatFile }) {
  return (
    <span className="wa-file">
      <span className="wa-file-icon">{file.kind === 'xlsx' ? <FileSpreadsheet /> : <FileText />}</span>
      <span className="col" style={{ gap: 0, minWidth: 0 }}>
        <span className="w-600 ellipsis">{file.name}</span>
        <span className="t-11 muted">{file.kind === 'xlsx' ? 'Таблица Excel' : 'PDF'} · {file.size}</span>
      </span>
    </span>
  );
}

export interface SendWhatsAppProps {
  clientId: ID;
  title: string;
  initialText: string;
  file?: ChatFile;
  orderId?: ID | null;
  /** что показать в сводке над текстом (сумма счёта, долг) */
  rows?: { label: string; value: ReactNode }[];
  okText: string;
  onClose: () => void;
  onSent?: () => void;
}

/** Окно отправки в WhatsApp клиента. Диалога нет — он появится с первым сообщением. */
export function SendWhatsAppModal({ clientId, title, initialText, file, orderId, rows, okText, onClose, onSent }: SendWhatsAppProps) {
  const db = useDB();
  const { me } = useSession();
  const idx = indexes(db);
  const client = idx.clients.get(clientId);
  const contact = client?.contacts[0];
  const wa = db.settings.whatsapp;
  const [text, setText] = useState(initialText);
  const [error, setError] = useState<string | null>(null);
  const phone = contact?.phone ?? client?.phone ?? '';
  const blocked = !wa.connected ? 'WhatsApp не подключён — включите его в настройках, раздел «Подключения».' : !phone ? 'У клиента нет телефона — добавьте его в карточке клиента.' : null;

  const send = () => {
    const r = dispatch('chat.send', { clientId, text, orderId: orderId ?? null, ...(file ? { file } : {}) }, me.id);
    if (!r.ok) {
      setError(fixNo(r.error));
      return;
    }
    toast(okText);
    onSent?.();
    onClose();
  };

  return (
    <Modal
      title={title}
      sub="Проверьте получателя и текст"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" icon={<Send />} onClick={send} disabled={!!blocked || (!text.trim() && !file)}>
            Отправить в WhatsApp
          </Button>
        </>
      }
    >
      <StatList>
        <StatRow label="Кому" value={client?.name ?? '—'} />
        <StatRow
          label="Куда"
          value={
            <span className="row" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <Chip tone="green" icon={<MessageCircle />}>
                WhatsApp
              </Chip>
              {contact ? `${contact.name}, ${fmt.phone(contact.phone)}` : fmt.phone(client?.phone)}
            </span>
          }
        />
        {rows?.map((r) => <StatRow key={r.label} label={r.label} value={r.value} />)}
      </StatList>
      {file ? (
        <Field label="Вложение">
          <FileChip file={file} />
        </Field>
      ) : null}
      <Field label="Сообщение">
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={7} />
      </Field>
      {blocked ? <Notice tone="warn">{blocked}</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

/** Счёт по заказу: реквизиты магазина и сумма к оплате, PDF во вложении. */
export function SendInvoiceModal({ order, onClose }: { order: Order; onClose: () => void }) {
  const db = useDB();
  const idx = indexes(db);
  const client = idx.clients.get(order.clientId);
  const contactFirst = client?.contacts[0]?.name.split(' ')[0] ?? '';
  const pay = orderPayment(db, order);
  const toPay = Math.max(0, pay.amount - pay.paid);
  const company = db.settings.company;
  // текст считаем один раз при открытии, дальше его правит сотрудник
  const initial = useMemo(() => textInvoice(db, order, contactFirst), [order.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SendWhatsAppModal
      clientId={order.clientId}
      title="Отправить счёт клиенту"
      initialText={initial}
      file={invoiceFile(order)}
      orderId={order.id}
      rows={[
        { label: 'Счёт', value: `№ ${order.number} на ${fmt.money(toPay)}` },
        { label: 'Получатель платежа', value: `${company.legalName}, ИНН ${company.inn}` },
        { label: 'Расчётный счёт', value: company.account },
      ]}
      okText="Счёт отправлен клиенту в WhatsApp"
      onClose={onClose}
    />
  );
}
