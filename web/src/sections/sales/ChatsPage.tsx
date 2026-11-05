/* Вкладка «Чаты»: пример переписки WhatsApp с клиентами. Сообщения остаются внутри программы. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, MessageCircle, Plus, Send, Store } from 'lucide-react';
import type { Chat, ID } from '../../data/types';
import { CLIENT_SEGMENT_NAMES } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { clientBalance, indexes, orderPayment } from './data';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { PageHeader } from '../../shell/PageHeader';
import { Avatar, Button, Card, Chip, EmptyState, Notice, ORDER_STATE, PAY_STATE, SearchInput, Segmented, StatList, StatRow, Textarea, cx, fmt, overdueStatus, StatusChip, toast } from '../../ui';
import { NewOrderDrawer } from './NewOrderDrawer';
import { useSalesOrders } from './salesScope';
import { capitalize, fixNo, norm, useIsPhone } from './lib';
import { shownOverdue } from './parts';
import { useTabCounts } from './tabCounts';

const QUICK = ['Добрый день! Сейчас проверю остатки и отвечу.', 'Счёт отправлю сегодня до конца дня.', 'Привезём завтра с 10:00 до 14:00.', 'Спасибо, заказ принят!'];

export default function ChatsPage() {
  const db = useDB();
  const version = useDBVersion();
  const { me, can, role } = useSession();
  const { chats, isMine } = useScoped();
  const isManager = role === 'manager';
  const counts = useTabCounts();
  const phone = useIsPhone();
  const openEntity = useOpenEntity();
  const [q, setQ] = useState('');
  const [f, setF] = useState<'all' | 'unread' | 'mine'>('all');
  const [creating, setCreating] = useState(false);
  const today = db.meta.today;
  const idx = indexes(db);

  const sorted = useMemo(() => {
    const last = (c: Chat) => c.messages[c.messages.length - 1]?.at ?? '';
    return [...chats].sort((a, b) => last(b).localeCompare(last(a)));
  }, [chats, version]);
  const [selId, setSelId] = useState<ID | null>(() => (phone ? null : sorted[0]?.id ?? null));
  const sel = sorted.find((c) => c.id === selId) ?? null;

  const list = useMemo(() => {
    const t = norm(q.trim()).split(/\s+/).filter(Boolean);
    return sorted.filter((c) => {
      if (f === 'unread' && !c.unread) return false;
      if (f === 'mine' && !isMine(c.clientId)) return false;
      if (!t.length) return true;
      const cl = idx.clients.get(c.clientId);
      const s = norm(`${cl?.name ?? ''} ${cl?.phone ?? ''} ${c.messages[c.messages.length - 1]?.text ?? ''}`);
      return t.every((x) => s.includes(x));
    });
  }, [sorted, q, f, idx, isMine]);

  // сменили фильтр, а открытого диалога в списке нет — на компьютере открываем первый из списка
  useEffect(() => {
    if (phone || !list.length || list.some((c) => c.id === selId)) return;
    setSelId(list[0].id);
  }, [f]); // eslint-disable-line react-hooks/exhaustive-deps

  // открыли диалог — непрочитанные прочитаны
  useEffect(() => {
    if (sel && sel.unread > 0) dispatch('chat.read', { chatId: sel.id }, me.id);
  }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const unreadCount = sorted.filter((c) => c.unread > 0).length;
  const mineCount = isManager ? sorted.filter((c) => isMine(c.clientId)).length : 0;
  const showList = !phone || !sel;
  const showConv = !!sel;

  return (
    <>
      <PageHeader section="sales" counts={counts} />
      {!sorted.length ? (
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
                    { value: 'all', label: 'Все', count: sorted.length },
                    { value: 'unread', label: 'Новые', count: unreadCount },
                    ...(isManager ? [{ value: 'mine' as const, label: 'Мои', count: mineCount }] : []),
                  ]}
                />
              </div>
              <div className="sales-chat-items">
                {list.length ? (
                  list.map((c) => {
                    const cl = idx.clients.get(c.clientId);
                    const last = c.messages[c.messages.length - 1];
                    return (
                      <button key={c.id} type="button" className={cx('sales-chat-item', c.id === sel?.id && 'is-active')} onClick={() => setSelId(c.id)}>
                        <Avatar name={cl?.name ?? '?'} />
                        <span className="grow">
                          <span className="row" style={{ gap: 6 }}>
                            <span className={cx('grow ellipsis', c.unread ? 'w-700' : 'w-600')}>{cl?.name ?? 'Клиент'}</span>
                            <span className="t-11 muted nowrap">{last ? (last.at.slice(0, 10) === today ? fmt.time(last.at) : fmt.dateShort(last.at)) : ''}</span>
                          </span>
                          <span className="row" style={{ gap: 6 }}>
                            <span className={cx('grow ellipsis t-12', c.unread ? 'ink-2' : 'muted')}>
                              {last?.from === 'staff' ? (last.authorId && last.authorId !== me.id ? `${idx.employees.get(last.authorId)?.short ?? 'Магазин'}: ` : 'Вы: ') : ''}
                              {last ? fixNo(last.text) : ''}
                            </span>
                            {c.unread ? <span className="sales-unread">{c.unread}</span> : null}
                          </span>
                        </span>
                      </button>
                    );
                  })
                ) : (
                  <EmptyState title={q.trim() ? 'Не нашли' : f === 'unread' ? 'Всё прочитано' : f === 'mine' ? 'Ваши клиенты пока не писали' : 'Не нашли'}>
                    {q.trim() ? 'Измените поиск' : f === 'unread' ? 'Новых сообщений нет' : f === 'mine' ? 'Переписки с другими клиентами — во вкладке «Все»' : 'Измените поиск'}
                  </EmptyState>
                )}
              </div>
            </section>
          ) : null}

          {showConv && sel ? <Conversation chat={sel} onBack={phone ? () => setSelId(null) : undefined} /> : !phone ? (
            <Card>
              <EmptyState title="Выберите диалог" />
            </Card>
          ) : null}

          {sel && !phone ? (
            <ClientSide
              chat={sel}
              canOrder={can('createOrder') || can('createRequest')}
              orderLabel={can('createOrder') ? 'Создать заказ из чата' : 'Создать заявку из чата'}
              onOrder={() => setCreating(true)}
              onClient={() => openEntity('client', sel.clientId)}
            />
          ) : null}
        </div>
      )}
      {creating && sel ? (
        <NewOrderDrawer
          clientId={sel.clientId}
          chatId={sel.id}
          source="chat"
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            openEntity('order', id);
          }}
        />
      ) : null}
      {phone && sel && (can('createOrder') || can('createRequest')) ? (
        <div className="sales-phone-chat-action">
          <Button variant="primary" size="lg" block icon={<Plus />} onClick={() => setCreating(true)}>
            {can('createOrder') ? 'Создать заказ из чата' : 'Создать заявку из чата'}
          </Button>
        </div>
      ) : null}
    </>
  );
}

function Conversation({ chat, onBack }: { chat: Chat; onBack?: () => void }) {
  const db = useDB();
  const { me, can } = useSession();
  const idx = indexes(db);
  const client = idx.clients.get(chat.clientId);
  const contact = client?.contacts[0];
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const today = db.meta.today;
  const canWrite = can('createOrder') || can('createRequest');

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.id, chat.messages.length]);
  useEffect(() => {
    setText('');
    setError(null);
  }, [chat.id]);

  const send = () => {
    const t = text.trim();
    if (!t) return;
    const r = dispatch('chat.send', { chatId: chat.id, text: t }, me.id);
    if (!r.ok) {
      setError(fixNo(r.error));
      toast(fixNo(r.error), 'error');
      return;
    }
    setText('');
    setError(null);
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
        <div className="grow">
          {client ? (
            <EntityLink type="client" id={client.id} className="entity-link t-14">
              {client.name}
            </EntityLink>
          ) : null}
          <div className="muted t-12 ellipsis">{contact ? `${contact.name}, ${contact.role.toLowerCase()} · ${fmt.phone(contact.phone)}` : fmt.phone(client?.phone)}</div>
        </div>
        <Chip tone="green" icon={<MessageCircle />}>
          WhatsApp
        </Chip>
      </div>
      <div className="sales-conv-body" ref={scroller}>
        {chat.messages.map((m, i) => {
          const day = m.at.slice(0, 10);
          const sep = day !== lastDay;
          lastDay = day;
          const o = m.orderId ? idx.orders.get(m.orderId) : undefined;
          return (
            <div key={i} className="col" style={{ gap: 0 }}>
              {sep ? <div className="sales-day-sep">{capitalize(fmt.relDate(day, today))}</div> : null}
              <div className={cx('sales-msg', m.from === 'staff' ? 'is-staff' : 'is-client')}>
                <div className="sales-msg-text">{fixNo(m.text)}</div>
                {o ? (
                  <EntityLink type="order" id={o.id} className="sales-msg-order">
                    Заказ № {o.number} · {fmt.money(o.total)}
                  </EntityLink>
                ) : null}
                <div className="sales-msg-meta">
                  {m.from === 'staff' && m.authorId ? `${idx.employees.get(m.authorId)?.short ?? ''} · ` : ''}
                  {fmt.time(m.at)}
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
          <div className="row" style={{ alignItems: 'flex-end' }}>
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

function ClientSide({ chat, canOrder, orderLabel, onOrder, onClient }: { chat: Chat; canOrder: boolean; orderLabel: string; onOrder: () => void; onClient: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const idx = indexes(db);
  const client = idx.clients.get(chat.clientId);
  const { me, role } = useSession();
  const visible = useSalesOrders();
  const data = useMemo(() => {
    const b = clientBalance(db, chat.clientId);
    // менеджер видит переписки всех клиентов, а заказы — только те, что может открыть
    const pool = role === 'manager' || role === 'rep' ? visible : db.orders;
    const orders = pool
      .filter((o) => o.clientId === chat.clientId && o.state !== 'draft')
      .sort((a, b2) => b2.createdAt.localeCompare(a.createdAt))
      .slice(0, 4)
      .map((o) => {
        const pay = orderPayment(db, o);
        const dl = o.deliveryId ? db.deliveries.find((x) => x.id === o.deliveryId) : undefined;
        return { o, pay, overdue: shownOverdue(o, pay, dl) };
      });
    return { b, orders };
  }, [db, version, chat.clientId, visible, role]);
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
          data.orders.map(({ o, pay, overdue }) => (
            <EntityLink key={o.id} type="order" id={o.id} className="sales-side-order">
              <span className="row">
                <span className="w-600">№ {o.number}</span>
                <span className="muted t-12 grow">{fmt.date(o.createdAt)}</span>
                <span className="num w-600">{fmt.money(o.total)}</span>
              </span>
              <span className="chips sales-chips-compact">
                <StatusChip s={ORDER_STATE[o.state]} />
                {overdue > 0 ? <StatusChip s={overdueStatus(overdue)} /> : (o.state === 'confirmed' || o.state === 'closed') && pay.amount > 0 ? <StatusChip s={PAY_STATE[pay.state]} /> : null}
              </span>
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
      <Button block onClick={onClient}>
        Карточка клиента
      </Button>
      </div>
    </section>
  );
}
