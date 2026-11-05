/* Вкладка «Чаты»: WhatsApp магазина. Живая переписка, автосообщения о заказах, вложения,
   разбор заказа из сообщения клиента. Пример подключения: сообщения хранятся в программе и наружу не уходят. */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BellRing, Check, CheckCheck, FileSpreadsheet, FileText, ListPlus, MessageCircle, Paperclip, Plus, Send, Store, Zap } from 'lucide-react';
import type { Chat, ChatMessage, ID } from '../../data/types';
import { CLIENT_SEGMENT_NAMES } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { clientBalance, indexes, orderPayment } from './data';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { PageHeader } from '../../shell/PageHeader';
import { Avatar, Button, Card, Checkbox, Chip, EmptyState, MoreMenu, type MenuItem, Notice, SearchInput, Segmented, StatList, StatRow, Textarea, cx, fmt, overdueStatus, StatusChip, toast } from '../../ui';
import { NewOrderDrawer } from './NewOrderDrawer';
import { useSalesOrders } from './salesScope';
import { approvalTask, capitalize, fixNo, norm, useIsPhone } from './lib';
import { OrderBrief } from './parts';
import { FileChip, SendInvoiceModal, SendWhatsAppModal, type SendWhatsAppProps } from './SendInvoiceModal';
import { WA_AUTO_META, actFile, priceFile, textReminder, waReadState } from '../../data/whatsapp';
import { parseOrderText, type ParsedOrder } from '../../data/orderText';

const QUICK = ['Добрый день! Сейчас проверю остатки и отвечу.', 'Счёт отправлю сегодня до конца дня.', 'Привезём завтра с 10:00 до 14:00.', 'Спасибо, заказ принят!'];

type Filter = 'all' | 'unread' | 'waiting';

const lastOf = (c: Chat): ChatMessage | undefined => c.messages[c.messages.length - 1];

/** Подпись последнего сообщения в списке диалогов. */
function previewText(m: ChatMessage): string {
  if (m.auto) return fixNo(m.text); // значок молнии в списке уже говорит, что это автосообщение
  if (m.file) return m.text ? `${m.file.name} · ${fixNo(m.text)}` : m.file.name;
  return fixNo(m.text);
}

export default function ChatsPage() {
  const db = useDB();
  const version = useDBVersion();
  const { me, can, role } = useSession();
  const { chats, isMine } = useScoped();
  const isManager = role === 'manager';
  const navigate = useNavigate();
  const phone = useIsPhone();
  const openEntity = useOpenEntity();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [f, setF] = useState<Filter>('all');
  // менеджер по умолчанию видит переписку своих клиентов; флажок можно снять. Открыли чужого клиента по ссылке — показываем всех
  const [onlyMine, setOnlyMine] = useState(() => isManager && !(params.get('client') && !isMine(params.get('client')!)));
  const [creating, setCreating] = useState<null | { lines?: { productId: ID; pack: 'pcs' | 'pack' | 'box'; packQty: number }[]; note?: { found: number; unsure: string[]; missed: string[] } }>(null);
  const [sendDialog, setSendDialog] = useState<null | Omit<SendWhatsAppProps, 'onClose'>>(null);
  const [invoiceFor, setInvoiceFor] = useState<ID | null>(null);
  const today = db.meta.today;
  const idx = indexes(db);
  const wa = db.settings.whatsapp;
  const canWrite = can('createOrder') || can('createRequest');

  const sorted = useMemo(() => [...chats].sort((a, b) => (lastOf(b)?.at ?? '').localeCompare(lastOf(a)?.at ?? '')), [chats, version]);

  // ?client=… — открыть переписку с клиентом (из карточки клиента). Диалога нет — откроется пустой, первое сообщение его создаст
  const wantClient = params.get('client');
  const [selClient, setSelClient] = useState<ID | null>(() => {
    if (wantClient) return wantClient;
    if (phone) return null;
    const pool = isManager ? sorted.filter((c) => isMine(c.clientId)) : sorted;
    const from = pool.length ? pool : sorted;
    return (from.find((c) => c.unread > 0) ?? from[0])?.clientId ?? null;
  });
  useEffect(() => {
    if (wantClient && wantClient !== selClient) setSelClient(wantClient);
  }, [wantClient]); // eslint-disable-line react-hooks/exhaustive-deps
  const sel = selClient ? sorted.find((c) => c.clientId === selClient) ?? null : null;
  const selClientRow = selClient ? idx.clients.get(selClient) : undefined;
  const pick = (clientId: ID | null) => {
    setSelClient(clientId);
    if (params.get('client')) {
      params.delete('client');
      setParams(params, { replace: true });
    }
  };

  const list = useMemo(() => {
    const t = norm(q.trim()).split(/\s+/).filter(Boolean);
    return sorted.filter((c) => {
      if (f === 'unread' && !c.unread) return false;
      if (f === 'waiting' && lastOf(c)?.from !== 'client') return false;
      if (onlyMine && !isMine(c.clientId)) return false;
      if (!t.length) return true;
      const cl = idx.clients.get(c.clientId);
      const s = norm(`${cl?.name ?? ''} ${cl?.phone ?? ''} ${lastOf(c)?.text ?? ''}`);
      return t.every((x) => s.includes(x));
    });
  }, [sorted, q, f, onlyMine, idx, isMine]);

  // сменили фильтр, а открытого диалога в списке нет — на компьютере открываем первый из списка
  useEffect(() => {
    if (phone || !list.length || list.some((c) => c.clientId === selClient)) return;
    setSelClient(list[0].clientId);
  }, [f, onlyMine]); // eslint-disable-line react-hooks/exhaustive-deps

  // открыли диалог — непрочитанные прочитаны
  useEffect(() => {
    if (sel && sel.unread > 0) dispatch('chat.read', { chatId: sel.id }, me.id);
  }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const base = onlyMine ? sorted.filter((c) => isMine(c.clientId)) : sorted;
  const unreadCount = base.filter((c) => c.unread > 0).length;
  const waitingCount = base.filter((c) => lastOf(c)?.from === 'client').length;
  const showList = !phone || !selClient;

  /* ---------- отправка документов из чата ---------- */
  const attachments = (clientId: ID) => {
    const c = idx.clients.get(clientId);
    if (!c) return [];
    const b = clientBalance(db, clientId);
    const contactFirst = c.contacts[0]?.name.split(' ')[0] ?? '';
    const unpaid = db.orders
      .filter((o) => o.clientId === clientId && (o.state === 'confirmed' || o.state === 'closed'))
      .map((o) => ({ o, pay: orderPayment(db, o) }))
      .filter(({ pay }) => pay.due > 0)
      .sort((a, b2) => b2.o.createdAt.localeCompare(a.o.createdAt))[0];
    const promo = db.promos.find((p) => p.active && p.start <= today && p.end >= today);
    return [
      { label: unpaid ? `Счёт по заказу № ${unpaid.o.number}` : 'Счёт — нет неоплаченных заказов', icon: <FileText />, disabled: !unpaid, onClick: () => unpaid && setInvoiceFor(unpaid.o.id) },
      {
        label: 'Напоминание об оплате',
        icon: <BellRing />,
        hidden: b.debt <= 0,
        onClick: () =>
          setSendDialog({
            clientId,
            title: 'Напомнить об оплате',
            initialText: textReminder(db, clientId, contactFirst),
            file: actFile(today),
            rows: [
              { label: 'Долг', value: fmt.money(b.debt) },
              { label: 'Просрочено', value: b.overdue > 0 ? <span className="c-bad">{fmt.money(b.overdue)}</span> : fmt.money(0) },
            ],
            okText: 'Напоминание отправлено в WhatsApp',
            purpose: 'reminder',
          }),
      },
      {
        label: 'Акт сверки',
        icon: <FileText />,
        onClick: () => setSendDialog({ clientId, title: 'Отправить акт сверки', initialText: `Акт сверки на ${fmt.date(today)} — во вложении. Проверьте, пожалуйста, и пришлите подписанный.`, file: actFile(today), okText: 'Акт сверки отправлен в WhatsApp', purpose: 'act' }),
      },
      {
        label: 'Прайс-лист',
        icon: <FileSpreadsheet />,
        onClick: () =>
          setSendDialog({
            clientId,
            title: 'Отправить прайс-лист',
            initialText: `Актуальный прайс — во вложении.${promo ? ` Сейчас действует акция «${promo.name}» до ${fmt.date(promo.end)}.` : ''}`,
            file: priceFile(today),
            okText: 'Прайс отправлен в WhatsApp',
            purpose: 'price',
          }),
      },
    ];
  };

  const parseInto = (parsed: ParsedOrder) => {
    setCreating({
      lines: parsed.items.filter((i) => i.productId).map((i) => ({ productId: i.productId!, pack: i.pack, packQty: i.packQty })),
      note: { found: parsed.items.length, unsure: parsed.items.filter((i) => i.matches > 1).map((i) => i.text), missed: parsed.missed },
    });
  };

  return (
    <>
      <PageHeader
        section="chats"
        actions={
          <>
            <Chip tone="green" icon={<MessageCircle />}>
              WhatsApp {fmt.phone(wa.phone)}
            </Chip>
            {role === 'owner' ? <Button onClick={() => navigate('/settings/integrations')}>Настройки WhatsApp</Button> : null}
          </>
        }
      />
      {!wa.connected ? (
        <Notice tone="warn" title="WhatsApp отключён">
          Новые сообщения не приходят, автосообщения клиентам не отправляются. Подключение — в настройках, раздел «Подключения».
        </Notice>
      ) : null}
      {!sorted.length && !selClient ? (
        <Card>
          <EmptyState icon={<MessageCircle />} title="Переписки пока нет">
            {role === 'rep' ? 'Здесь появятся переписки с вашими клиентами из WhatsApp магазина' : 'Когда клиент напишет в WhatsApp магазина, диалог появится здесь'}
          </EmptyState>
        </Card>
      ) : (
        <div className={cx('sales-chats', phone && 'is-phone')}>
          {showList ? (
            <section className="card sales-chat-list">
              <div className="sales-chat-list-head">
                <SearchInput value={q} onChange={setQ} placeholder="Клиент или текст" />
                <Segmented
                  value={f}
                  onChange={setF}
                  options={[
                    { value: 'all', label: 'Все', count: base.length },
                    { value: 'unread', label: 'Новые', count: unreadCount },
                    { value: 'waiting', label: 'Ждут ответа', count: waitingCount },
                  ]}
                />
                {isManager ? (
                  <Checkbox checked={onlyMine} onChange={setOnlyMine}>
                    Только мои клиенты
                  </Checkbox>
                ) : null}
              </div>
              <div className="sales-chat-items">
                {list.length ? (
                  list.map((c) => {
                    const cl = idx.clients.get(c.clientId);
                    const last = lastOf(c);
                    const staff = last?.from === 'staff';
                    return (
                      <button key={c.id} type="button" className={cx('sales-chat-item', c.clientId === selClient && 'is-active')} onClick={() => pick(c.clientId)}>
                        <Avatar name={cl?.name ?? '?'} />
                        <span className="grow">
                          <span className="row" style={{ gap: 6 }}>
                            <span className={cx('grow ellipsis', c.unread ? 'w-700' : 'w-600')}>{cl?.name ?? 'Клиент'}</span>
                            <span className={cx('t-11 nowrap', c.unread ? 'c-ok w-700' : 'muted')}>{last ? (last.at.slice(0, 10) === today ? fmt.time(last.at) : fmt.dateShort(last.at)) : ''}</span>
                          </span>
                          <span className="row" style={{ gap: 4 }}>
                            {staff ? (
                              last?.auto ? (
                                <Zap size={12} className="muted wa-list-icon" />
                              ) : (
                                <CheckCheck size={14} className={cx('wa-list-icon', waReadState(c, c.messages.length - 1, today) === 'read' ? 'wa-read' : 'muted')} />
                              )
                            ) : null}
                            <span className={cx('grow ellipsis t-12', c.unread ? 'ink-2' : 'muted')}>
                              {staff && !last?.auto ? (last?.authorId && last.authorId !== me.id ? `${idx.employees.get(last.authorId)?.short ?? 'Магазин'}: ` : 'Вы: ') : ''}
                              {last ? previewText(last) : ''}
                            </span>
                            {c.unread ? <span className="sales-unread">{c.unread}</span> : null}
                          </span>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <EmptyState title={q.trim() ? 'Не нашли' : f === 'unread' ? 'Всё прочитано' : f === 'waiting' ? 'Всем ответили' : onlyMine ? 'Ваши клиенты пока не писали' : 'Не нашли'}>
                    {q.trim() ? 'Измените поиск' : f === 'unread' ? 'Новых сообщений нет' : f === 'waiting' ? 'Последнее слово везде за магазином' : onlyMine ? 'Снимите «Только мои клиенты», чтобы увидеть остальных' : 'Измените поиск'}
                  </EmptyState>
                )}
              </div>
            </section>
          ) : null}

          {selClient && selClientRow ? (
            <Conversation
              chat={sel}
              clientId={selClient}
              canWrite={canWrite && wa.connected}
              attachments={attachments(selClient)}
              onParse={canWrite ? parseInto : undefined}
              onBack={phone ? () => pick(null) : undefined}
              headAction={
                phone && canWrite ? (
                  // на телефоне «Создать заявку» — в шапке диалога: не закрывает поле ввода и «Отправить»
                  <Button variant="primary" icon={<Plus />} onClick={() => setCreating({})} className="sales-conv-order" aria-label={can('createOrder') ? 'Создать заказ из чата' : 'Создать заявку из чата'}>
                    {can('createOrder') ? 'Заказ' : 'Заявка'}
                  </Button>
                ) : undefined
              }
            />
          ) : !phone ? (
            <Card>
              <EmptyState title="Выберите диалог" />
            </Card>
          ) : null}

          {selClient && selClientRow && !phone ? (
            <ClientSide
              clientId={selClient}
              canOrder={canWrite}
              orderLabel={can('createOrder') ? 'Создать заказ из чата' : 'Создать заявку из чата'}
              onOrder={() => setCreating({})}
              onClient={() => openEntity('client', selClient)}
            />
          ) : null}
        </div>
      )}
      {creating && selClient ? (
        <NewOrderDrawer
          clientId={selClient}
          chatId={sel?.id}
          source="chat"
          initialLines={creating.lines}
          fromMessage={creating.note}
          onClose={() => setCreating(null)}
          onCreated={(id) => {
            setCreating(null);
            openEntity('order', id);
          }}
        />
      ) : null}
      {sendDialog ? <SendWhatsAppModal {...sendDialog} onClose={() => setSendDialog(null)} /> : null}
      {invoiceFor ? (() => {
        const o = db.orders.find((x) => x.id === invoiceFor);
        return o ? <SendInvoiceModal order={o} onClose={() => setInvoiceFor(null)} /> : null;
      })() : null}
    </>
  );
}

function Ticks({ state }: { state: 'sent' | 'delivered' | 'read' }) {
  if (state === 'sent') return <Check size={14} className="wa-tick" aria-label="Отправлено" />;
  return <CheckCheck size={14} className={cx('wa-tick', state === 'read' && 'wa-read')} aria-label={state === 'read' ? 'Прочитано' : 'Доставлено'} />;
}

function Conversation({
  chat,
  clientId,
  canWrite,
  attachments,
  onParse,
  onBack,
  headAction,
}: {
  chat: Chat | null;
  clientId: ID;
  canWrite: boolean;
  attachments: MenuItem[];
  onParse?: (p: ParsedOrder) => void;
  onBack?: () => void;
  headAction?: ReactNode;
}) {
  const db = useDB();
  const version = useDBVersion();
  const { me } = useSession();
  const idx = indexes(db);
  const client = idx.clients.get(clientId);
  const contact = client?.contacts[0];
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [justSent, setJustSent] = useState<number | null>(null); // индекс только что отправленного: одна галочка, через секунду — две
  const scroller = useRef<HTMLDivElement>(null);
  const today = db.meta.today;
  const messages = chat?.messages ?? [];

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat?.id, clientId, messages.length]);
  useEffect(() => {
    setText('');
    setError(null);
  }, [clientId]);
  useEffect(() => {
    if (justSent === null) return;
    const t = window.setTimeout(() => setJustSent(null), 1200);
    return () => window.clearTimeout(t);
  }, [justSent]);

  // какие сообщения клиента похожи на заказ: после них ещё не было оформленного заказа
  const parsed = useMemo(() => {
    const m = new Map<number, ParsedOrder>();
    if (!onParse) return m;
    messages.forEach((msg, i) => {
      if (msg.from !== 'client' || !/\d/.test(msg.text)) return;
      if (messages.slice(i + 1).some((x) => x.orderId)) return;
      const p = parseOrderText(db, msg.text, clientId);
      if (p.items.length) m.set(i, p);
    });
    return m;
  }, [chat?.id, messages.length, version, clientId, !!onParse]); // eslint-disable-line react-hooks/exhaustive-deps

  const send = () => {
    const t = text.trim();
    if (!t) return;
    const r = dispatch('chat.send', chat ? { chatId: chat.id, text: t } : { clientId, text: t }, me.id);
    if (!r.ok) {
      setError(fixNo(r.error));
      toast(fixNo(r.error), 'error');
      return;
    }
    setText('');
    setError(null);
    setJustSent(messages.length);
  };

  let lastDay = '';
  return (
    <section className="card sales-conv">
      <div className="sales-conv-head">
        {onBack ? (
          <Button variant="ghost" iconOnly onClick={onBack} aria-label="К списку диалогов">
            <ArrowLeft />
          </Button>
        ) : null}
        <Avatar name={client?.name ?? '?'} />
        <div className="grow" style={{ minWidth: 0 }}>
          {client ? (
            <EntityLink type="client" id={client.id} className="entity-link t-14">
              {client.name}
            </EntityLink>
          ) : null}
          <div className="muted t-12 ellipsis">{contact ? `${contact.name}, ${contact.role.toLowerCase()} · ${fmt.phone(contact.phone)}` : fmt.phone(client?.phone)}</div>
        </div>
        {headAction ?? (
          <Chip tone="green" icon={<MessageCircle />}>
            WhatsApp
          </Chip>
        )}
      </div>
      <div className="sales-conv-body" ref={scroller}>
        {!messages.length ? <div className="sales-day-sep">Переписки ещё не было — напишите первым</div> : null}
        {messages.map((m, i) => {
          const day = m.at.slice(0, 10);
          const sep = day !== lastDay;
          lastDay = day;
          const o = m.orderId ? idx.orders.get(m.orderId) : undefined;
          const staff = m.from === 'staff';
          const p = parsed.get(i);
          return (
            <div key={i} className="col" style={{ gap: 0 }}>
              {sep ? <div className="sales-day-sep">{capitalize(fmt.relDate(day, today))}</div> : null}
              <div className={cx('sales-msg', staff ? 'is-staff' : 'is-client', m.auto && 'is-auto')}>
                {m.auto ? (
                  <div className="wa-auto-label">
                    <Zap size={12} />
                    Автосообщение · {WA_AUTO_META[m.auto].label}
                  </div>
                ) : null}
                {m.file ? <FileChip file={m.file} /> : null}
                {m.text ? <div className="sales-msg-text">{fixNo(m.text)}</div> : null}
                {o ? (
                  <EntityLink type="order" id={o.id} className="sales-msg-order">
                    Заказ № {o.number} · {fmt.money(o.total)}
                  </EntityLink>
                ) : null}
                {p && onParse ? (
                  <button type="button" className="wa-parse" onClick={() => onParse(p)}>
                    <ListPlus size={16} />
                    <span>
                      Разобрать в заказ · {fmt.count(p.items.length, 'товар', 'товара', 'товаров')}
                      {p.missed.length ? <span className="wa-parse-miss">, {p.missed.length} не нашли</span> : null}
                    </span>
                  </button>
                ) : null}
                <div className="sales-msg-meta">
                  {staff && m.authorId ? `${idx.employees.get(m.authorId)?.short ?? ''} · ` : ''}
                  {fmt.time(m.at)}
                  {staff ? <Ticks state={justSent === i ? 'sent' : chat ? waReadState(chat, i, today) : 'delivered'} /> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {canWrite ? (
        <div className="sales-composer">
          <div className="sales-quick">
            {QUICK.map((t) => (
              <button key={t} type="button" className="chip sales-chip-btn" onClick={() => setText(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="row sales-composer-row" style={{ alignItems: 'flex-end' }}>
            <MoreMenu items={attachments} icon={<Paperclip />} label="Отправить документ" align="start" />
            <Textarea
              className="sales-composer-input"
              value={text}
              rows={2}
              placeholder="Сообщение клиенту"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
            />
            <Button variant="dark" iconOnly onClick={send} disabled={!text.trim()} aria-label="Отправить" title="Отправить (Enter)">
              <Send />
            </Button>
          </div>
          {error ? <Notice tone="bad">{error}</Notice> : null}
        </div>
      ) : null}
    </section>
  );
}

function ClientSide({ clientId, canOrder, orderLabel, onOrder, onClient }: { clientId: ID; canOrder: boolean; orderLabel: string; onOrder: () => void; onClient?: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const idx = indexes(db);
  const client = idx.clients.get(clientId);
  const { me, role } = useSession();
  const visible = useSalesOrders();
  const data = useMemo(() => {
    const b = clientBalance(db, clientId);
    // менеджер видит переписки всех клиентов, а заказы — только те, что может открыть
    const pool = role === 'manager' || role === 'rep' ? visible : db.orders;
    const orders = pool
      .filter((o) => o.clientId === clientId && o.state !== 'draft')
      .sort((a, b2) => b2.createdAt.localeCompare(a.createdAt))
      .slice(0, 4)
      .map((o) => {
        const pay = orderPayment(db, o);
        const dl = o.deliveryId ? db.deliveries.find((x) => x.id === o.deliveryId) : undefined;
        return { o, pay, dl, approval: o.state === 'request' && !!approvalTask(db, o.id) };
      });
    return { b, orders };
  }, [db, version, clientId, visible, role]);
  if (!client) return null;
  const owner = client.ownerId ? idx.employees.get(client.ownerId) : undefined;
  const foreign = (role === 'manager' || role === 'rep') && client.ownerId !== me.id;
  return (
    <section className="card sales-chat-side">
      <div className="sales-chat-side-body">
        <div className="col" style={{ gap: 4 }}>
          <div className="row">
            <Store size={16} className="muted" />
            <span className="t-14 w-700 grow">{client.name}</span>
          </div>
          <div className="muted t-12">
            {CLIENT_SEGMENT_NAMES[client.segment]} · {client.priceType === 'wholesale' ? 'опт' : 'розница'}
            {owner ? ` · ведёт ${owner.short}` : ''}
          </div>
        </div>
        <StatList>
          <StatRow label="Долг" value={fmt.money(data.b.debt)} />
          <StatRow label="Просрочено" value={data.b.overdue > 0 ? <span className="c-bad">{fmt.money(data.b.overdue)}</span> : fmt.money(0)} />
          {client.creditLimit > 0 ? <StatRow label="Остаток лимита" value={fmt.money(data.b.creditLeft)} /> : null}
          <StatRow label="Отсрочка" value={client.deferDays ? fmt.count(client.deferDays, 'день', 'дня', 'дней') : 'Нет'} />
        </StatList>
        {data.b.maxOverdueDays > 0 ? <StatusChip s={overdueStatus(data.b.maxOverdueDays)} /> : null}
        <div className="col" style={{ gap: 6 }}>
          <div className="t-13 w-700">Последние заказы</div>
          {data.orders.length ? (
            data.orders.map(({ o, pay, dl, approval }) => (
              <EntityLink key={o.id} type="order" id={o.id} className="sales-side-order">
                <span className="row">
                  <span className="w-600">№ {o.number}</span>
                  <span className="muted t-12 grow">{fmt.date(o.createdAt)}</span>
                  <span className="num w-600">{fmt.money(o.total)}</span>
                </span>
                {/* главный этап заказа и оплата: «Доставлен · Не оплачен», а не «Подтверждён» */}
                <OrderBrief o={o} pay={pay} delivery={dl} rep={role === 'rep'} approval={approval} />
              </EntityLink>
            ))
          ) : (
            <span className="muted t-13">{foreign ? `Клиента ведёт ${owner?.short ?? 'другой сотрудник'} — его заказы видят он и владелец` : 'Заказов ещё не было'}</span>
          )}
        </div>
      </div>
      <div className="sales-chat-side-foot">
        {canOrder ? (
          <Button variant="primary" block icon={<Plus />} onClick={onOrder}>
            {orderLabel}
          </Button>
        ) : null}
        {onClient ? (
          <Button block onClick={onClient}>
            Карточка клиента
          </Button>
        ) : null}
      </div>
    </section>
  );
}

