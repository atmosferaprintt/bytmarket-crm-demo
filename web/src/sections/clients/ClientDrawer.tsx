import { useMemo, useState, type ReactNode } from 'react';
import { CalendarPlus, ExternalLink, FileText, ListPlus, MapPin, MessageCircle, Pencil, Phone, Plus, ShoppingCart, UserRound, Wallet } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import type { EntityDrawerProps } from '../../shell/entities';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { TaskModal } from '../../shell/TaskModal';
import { NewOrderDrawer } from '../sales/NewOrderDrawer';
import { AcceptPaymentModal } from '../money/AcceptPaymentModal';
import { ReconciliationModal } from '../money/Reconciliation';
import { SendWhatsAppModal } from '../sales/SendInvoiceModal';
import { TopMenu } from '../sales/TopMenu';
import { OrderBrief, orderStage, shownOverdue } from '../sales/parts';
import { approvalTask } from '../sales/lib';
import { actFile, textReminder } from '../../data/whatsapp';
import type { Client, Order, Payment, Task, Visit } from '../../data/types';
import { PAY_METHOD_NAMES } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { clientBalance, indexes, orderPayment } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import {
  Button,
  Chip,
  DataTable,
  Drawer,
  EmptyState,
  Notice,
  ORDER_STATE,
  PAY_STATE,
  PAYMENT_STATUS,
  StatList,
  StatRow,
  StatusChip,
  Tabs,
  VISIT_RESULT,
  VISIT_STATE,
  cx,
  fmt,
  overdueStatus,
  toast,
  type Column,
} from '../../ui';
import { ClientFormModal } from './ClientForm';
import { visitTimes } from './parts';
import { PlanVisitModal } from './PlanVisitModal';
import { clientRows, deliveriesById, kindName, mapUrl, ordersByClient, priceTypeName, segmentName, telUrl, useIsPhone, visitsByClient } from './lib';
import './clients.css';

type TabKey = 'overview' | 'orders' | 'payments' | 'points' | 'visits' | 'tasks' | 'history';

/** Карточка «Клиент» в боковой панели. Открывается из любого раздела через ?open=client:id */
export default function EntityDrawer({ id, onClose }: EntityDrawerProps) {
  const db = useDB();
  const version = useDBVersion();
  const { me, role, can, sees } = useSession();
  const navigate = useNavigate();
  const scoped = useScoped();
  const phone = useIsPhone();
  const [tab, setTab] = useState<TabKey>('overview');
  const [modal, setModal] = useState<null | 'order' | 'pay' | 'task' | 'visit' | 'edit' | 'act' | 'remind'>(null);

  const visibleIds = useMemo(() => new Set(scoped.clients.map((c) => c.id)), [scoped.clients]);
  const data = useMemo(() => {
    const c = indexes(db).clients.get(id) ?? db.clients.find((x) => x.id === id);
    if (!c) return null;
    const row = clientRows(db).get(c.id);
    const orders = (ordersByClient(db).get(c.id) ?? []).filter((o) => o.state !== 'draft' || o.authorId === me.id);
    const payments = db.payments.filter((p) => p.clientId === c.id && (p.kind === 'client' || p.kind === 'refund')).sort((a, b) => b.at.localeCompare(a.at));
    const visits = visitsByClient(db).get(c.id) ?? [];
    const tasks = db.tasks.filter((t) => t.link?.type === 'client' && t.link.id === c.id).sort((a, b) => (a.state === b.state ? b.due.localeCompare(a.due) : a.state === 'open' ? -1 : 1));
    const history = db.audit.filter((a) => a.entity === 'client' && a.entityId === c.id).sort((a, b) => b.at.localeCompare(a.at));
    return { c, row, b: clientBalance(db, c.id), orders, payments, visits, tasks, history };
  }, [db, version, id, me.id]);

  if (!data) {
    return (
      <Drawer title="Клиент не найден" onClose={onClose}>
        <EmptyState title="Такого клиента нет">Возможно, ссылка устарела</EmptyState>
      </Drawer>
    );
  }

  const { c, b, row } = data;
  const emp = indexes(db).employees;
  const owner = c.ownerId ? emp.get(c.ownerId) : undefined;

  if (!visibleIds.has(c.id)) {
    return (
      <Drawer title={c.name} onClose={onClose}>
        <Notice tone="warn" title="Клиент закреплён за другим сотрудником">
          Ответственный — {owner?.name ?? 'не назначен'}. Заказы, долги и контакты видят ответственный, владелец и бухгалтер. Если клиент перешёл к вам, попросите владельца передать карточку.
        </Notice>
      </Drawer>
    );
  }

  const ownerIsRep = !!owner && owner.roles.includes('rep');
  const canOrder = can('createOrder') || can('createRequest');
  const orderLabel = role === 'rep' || !can('createOrder') ? 'Новая заявка' : 'Новый заказ';
  const canPay = can('acceptPayment');
  const canPlan = can('planVisits') && ownerIsRep && (role !== 'rep' || c.ownerId === me.id);
  const canEdit = can('editClients');
  const tel = telUrl(c.phone);
  // переписку открывают те, у кого есть вкладка «Чаты»: владелец, менеджер, представитель
  const canChat = db.settings.whatsapp.connected && !!c.phone && sees('chats');
  const hasChat = db.chats.some((x) => x.clientId === c.id);

  // деньги клиента: акт сверки и напоминание о долге — у владельца, менеджера и бухгалтера
  const moneyRole = role === 'owner' || role === 'manager' || role === 'accountant';
  const waPhone = c.contacts[0]?.phone ?? c.phone;
  const canRemind = moneyRole && db.settings.whatsapp.connected && !!waPhone && b.debt > 0;
  const buttons = [
    { key: 'act', label: 'Акт сверки', icon: <FileText />, onClick: () => setModal('act'), hidden: !moneyRole },
    { key: 'remind', label: 'Напомнить в WhatsApp', icon: <MessageCircle />, onClick: () => setModal('remind'), hidden: !canRemind },
    { key: 'pay', label: 'Принять оплату', icon: <Wallet />, onClick: () => setModal('pay'), hidden: !canPay || !canOrder },
  ].filter((x) => !x.hidden);
  const rest = [
    { key: 'task', label: 'Задача', icon: <ListPlus />, onClick: () => setModal('task'), hidden: false },
    { key: 'visit', label: 'Запланировать визит', icon: <CalendarPlus />, onClick: () => setModal('visit'), hidden: !canPlan },
    { key: 'edit', label: 'Изменить', icon: <Pencil />, onClick: () => setModal('edit'), hidden: !canEdit },
  ].filter((x) => !x.hidden);
  // кнопок мало (представитель) — всё кнопками; иначе редкое — в «⋯»
  const secondary = buttons.length ? buttons : rest;
  const menuItems = buttons.length ? rest : [];

  const primary = canOrder ? (
    <Button variant="primary" icon={<ShoppingCart />} onClick={() => setModal('order')} className="cl-foot-primary" data-hint="clients.card-order">
      {orderLabel}
    </Button>
  ) : canPay ? (
    <Button variant="primary" icon={<Wallet />} onClick={() => setModal('pay')} className="cl-foot-primary">
      Принять оплату
    </Button>
  ) : null;

  // «⋯» — меню раздела «Продажи», поднятое над боковой панелью
  const footer = (
    <div className="cl-drawer-foot">
      {menuItems.length ? <TopMenu items={menuItems} align="start" /> : null}
      {secondary.map((x) => (
        <Button key={x.key} icon={x.icon} onClick={x.onClick} data-hint={`clients.card-${x.key}`}>
          {x.label}
        </Button>
      ))}
      <span className="spacer" />
      {primary}
    </div>
  );

  const head = (
    <div className="col" style={{ gap: 10 }}>
      <div className="chips">
        <Chip>{kindName(c)}</Chip>
        <Chip>{segmentName(c)}</Chip>
        <Chip tone={c.priceType === 'wholesale' ? 'info' : 'neutral'}>Цены: {priceTypeName(c.priceType).toLowerCase()}</Chip>
        {!c.active ? <Chip tone="outline">Отключён</Chip> : null}
        {row?.missed ? (
          <span data-hint="clients.card-missed">
            <Chip tone="warn">Пропустил привычный заказ</Chip>
          </span>
        ) : null}
      </div>
      <div className="cl-head-meta">
        <span className="row" style={{ gap: 6 }}>
          <UserRound size={15} className="faint" />
          <span className="muted">Ответственный</span>
          <span className="w-600">{owner?.name ?? 'не назначен'}</span>
        </span>
        {tel ? (
          <a className="row cl-tel" href={tel} style={{ gap: 6 }}>
            <Phone size={15} />
            {fmt.phone(c.phone)}
          </a>
        ) : null}
        {canChat ? (
          <button type="button" className="row cl-tel cl-wa" style={{ gap: 6 }} onClick={() => navigate(`/chats?client=${c.id}`)} data-hint="clients.card-wa">
            <MessageCircle size={15} />
            {hasChat ? 'Переписка в WhatsApp' : 'Написать в WhatsApp'}
          </button>
        ) : null}
      </div>
    </div>
  );

  const counts: Record<TabKey, number | null> = {
    overview: null,
    orders: data.orders.length,
    payments: data.payments.length,
    points: c.points.length + c.contacts.length,
    visits: data.visits.length,
    tasks: data.tasks.filter((t) => t.state === 'open').length,
    history: data.history.length,
  };
  const tabs: { key: TabKey; label: string }[] = [
    { key: 'overview', label: 'Обзор' },
    { key: 'orders', label: 'Заказы' },
    { key: 'payments', label: 'Оплаты' },
    { key: 'points', label: 'Точки и контакты' },
    { key: 'visits', label: 'Визиты' },
    { key: 'tasks', label: 'Задачи' },
    { key: 'history', label: 'История' },
  ];

  return (
    <>
      <Drawer wide title={c.name} head={head} onClose={onClose} footer={footer}>
        <MoneyStrip c={c} debt={b.debt} overdue={b.overdue} overdueDays={b.maxOverdueDays} advance={b.advance} pending={b.pending} />
        <div className="cl-tabs-scroll" data-hint="clients.card-tabs">
          <Tabs items={tabs.map((t) => ({ key: t.key, label: t.label, count: counts[t.key] }))} value={tab} onChange={(k) => setTab(k as TabKey)} />
        </div>
        {tab === 'overview' ? <OverviewTab c={c} orders={data.orders} visits={data.visits} canPlan={canPlan} onPlan={() => setModal('visit')} /> : null}
        {tab === 'orders' ? <OrdersTab orders={data.orders} phone={phone} /> : null}
        {tab === 'payments' ? <PaymentsTab payments={data.payments} phone={phone} /> : null}
        {tab === 'points' ? <PointsTab c={c} /> : null}
        {tab === 'visits' ? <VisitsTab visits={data.visits} c={c} /> : null}
        {tab === 'tasks' ? <TasksTab tasks={data.tasks} onNew={() => setModal('task')} /> : null}
        {tab === 'history' ? <HistoryTab entries={data.history} /> : null}
      </Drawer>
      {modal === 'order' ? <NewOrderDrawer clientId={c.id} source={role === 'rep' ? 'rep' : 'manager'} onClose={() => setModal(null)} /> : null}
      {modal === 'pay' ? <AcceptPaymentModal clientId={c.id} onClose={() => setModal(null)} onDone={() => setModal(null)} /> : null}
      {modal === 'task' ? <TaskModal link={{ type: 'client', id: c.id }} assigneeId={c.ownerId ?? me.id} onClose={() => setModal(null)} /> : null}
      {modal === 'visit' ? <PlanVisitModal clientId={c.id} repId={c.ownerId ?? undefined} onClose={() => setModal(null)} /> : null}
      {modal === 'edit' ? <ClientFormModal client={c} onClose={() => setModal(null)} /> : null}
      {modal === 'act' ? <ReconciliationModal clientId={c.id} onClose={() => setModal(null)} /> : null}
      {modal === 'remind' ? (
        <SendWhatsAppModal
          clientId={c.id}
          title="Напомнить об оплате"
          initialText={textReminder(db, c.id, c.contacts[0]?.name.split(' ')[0] ?? '')}
          file={actFile(db.meta.today)}
          rows={[
            { label: 'Долг', value: fmt.money(b.debt) },
            { label: 'Просрочено', value: b.overdue > 0 ? <span className="c-bad">{fmt.money(b.overdue)}</span> : fmt.money(0) },
            ...(b.pending > 0 ? [{ label: 'Перевод ждёт подтверждения', value: fmt.money(b.pending) }] : []),
          ]}
          okText="Напоминание отправлено клиенту в WhatsApp"
          purpose="reminder"
          onClose={() => setModal(null)}
        />
      ) : null}
    </>
  );
}

/* ---------- полоса денег ---------- */

function MoneyStrip({ c, debt, overdue, overdueDays, advance, pending }: { c: Client; debt: number; overdue: number; overdueDays: number; advance: number; pending: number }) {
  const limit = c.creditLimit;
  const left = limit - debt;
  const over = limit > 0 && debt > limit;
  const base = Math.max(limit, debt, 1);
  const overduePart = (Math.min(overdue, debt) / base) * 100;
  const debtPart = (Math.max(0, debt - overdue) / base) * 100;
  return (
    <div className="cl-money" data-hint="clients.card-money">
      <div className="cl-money-cells">
        <Cell label="Долг" value={fmt.money(debt)} />
        <Cell label="Просрочено" value={overdue > 0 ? fmt.money(overdue) : '—'} tone={overdue > 0 ? 'bad' : undefined} title={overdue > 0 ? `Самая старая просрочка — ${overdueDays} дн.` : undefined} />
        <Cell label="Кредитный лимит" value={limit > 0 ? fmt.money(limit) : 'Без кредита'} />
        <Cell label="Остаток лимита" value={limit > 0 ? fmt.money(left) : '—'} tone={over ? 'bad' : undefined} />
        <Cell label="Аванс" value={advance > 0 ? fmt.money(advance) : '—'} tone={advance > 0 ? 'ok' : undefined} />
      </div>
      {limit > 0 ? (
        <div className="cl-limit">
          <div className="cl-limit-bar" role="img" aria-label={`Долг ${fmt.money(debt)} из лимита ${fmt.money(limit)}`}>
            {overduePart > 0 ? <span className="is-overdue" style={{ width: `${overduePart}%` }} /> : null}
            {debtPart > 0 ? <span className="is-debt" style={{ width: `${debtPart}%` }} /> : null}
          </div>
          <div className="cl-limit-legend">
            {overdue > 0 ? (
              <span className="row" style={{ gap: 6 }}>
                <i className="cl-dot is-overdue" />
                Просрочено
              </span>
            ) : null}
            {debt > overdue ? (
              <span className="row" style={{ gap: 6 }}>
                <i className="cl-dot is-debt" />
                Долг
              </span>
            ) : null}
            <span className="row" style={{ gap: 6 }}>
              <i className="cl-dot is-free" />
              Свободно {fmt.money(Math.max(0, left))}
            </span>
            {over ? <Chip tone="bad">Сверх лимита на {fmt.money(debt - limit)}</Chip> : null}
            {overdueDays > 0 ? <StatusChip s={overdueStatus(overdueDays)} /> : null}
          </div>
        </div>
      ) : overdueDays > 0 ? (
        <div className="cl-limit-legend">
          <StatusChip s={overdueStatus(overdueDays)} />
        </div>
      ) : null}
      {pending > 0 ? (
        // клиент уже перевёл — не звонить за этими деньгами
        <div className="cl-money-pending">Перевод {fmt.money(pending)} ждёт подтверждения банка</div>
      ) : null}
    </div>
  );
}

function Cell({ label, value, tone, title }: { label: string; value: ReactNode; tone?: 'bad' | 'ok'; title?: string }) {
  return (
    <div className="cl-money-cell" title={title}>
      <div className="cl-money-label">{label}</div>
      <div className={cx('cl-money-value', tone === 'bad' && 'c-bad', tone === 'ok' && 'c-ok')}>{value}</div>
    </div>
  );
}

/* ---------- вкладки ---------- */

function OverviewTab({ c, orders, visits, canPlan, onPlan }: { c: Client; orders: Order[]; visits: Visit[]; canPlan: boolean; onPlan: () => void }) {
  const db = useDB();
  const today = db.meta.today;
  const idx = indexes(db);
  const real = orders.filter((o) => o.state !== 'cancelled' && o.state !== 'draft');
  const habitual = useMemo(() => {
    const m = new Map<string, { productId: string; orders: number; qty: number }>();
    for (const o of real) {
      const seen = new Set<string>();
      for (const l of o.lines) {
        let x = m.get(l.productId);
        if (!x) m.set(l.productId, (x = { productId: l.productId, orders: 0, qty: 0 }));
        x.qty += l.qty;
        if (!seen.has(l.productId)) {
          x.orders++;
          seen.add(l.productId);
        }
      }
    }
    return [...m.values()].filter((x) => x.orders >= 2 || real.length < 3).sort((a, b) => b.orders - a.orders || b.qty - a.qty).slice(0, 6);
  }, [real]);
  const next = visits.filter((v) => v.state === 'planned' && v.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const nextPoint = next ? c.points.find((p) => p.id === next.pointId) ?? c.points[0] : null;
  const rep = next ? idx.employees.get(next.repId) : undefined;

  return (
    <div className="cl-overview">
      <section className="cl-block" data-hint="clients.card-terms">
        <h3 className="cl-block-title">Условия</h3>
        <StatList>
          <StatRow label="Тип цены" value={priceTypeName(c.priceType)} />
          <StatRow label="Отсрочка" value={c.deferDays ? fmt.count(c.deferDays, 'день', 'дня', 'дней') : 'Оплата сразу'} />
          <StatRow label="Кредитный лимит" value={c.creditLimit ? fmt.money(c.creditLimit) : 'Без кредита'} />
          <StatRow label="Минимальный заказ" value={c.minOrder ? fmt.money(c.minOrder) : 'Нет'} />
          <StatRow label="Обычно заказывает" value={c.orderEveryDays ? `раз в ${fmt.count(c.orderEveryDays, 'день', 'дня', 'дней')}` : '—'} />
          <StatRow label="ИНН" value={c.inn ?? '—'} />
          <StatRow label="Клиент с" value={fmt.date(c.createdAt, { year: true })} />
        </StatList>
        {c.note ? <Notice>{c.note}</Notice> : null}
      </section>

      <section className="cl-block">
        <h3 className="cl-block-title">Следующий визит</h3>
        {next ? (
          <div className="cl-next-visit">
            <div className="cl-next-when">
              {fmt.relDate(next.date, today)}, {next.time}
            </div>
            <div className="ink-2">
              {nextPoint ? `${nextPoint.name} · ${nextPoint.address}` : 'Без точки'}
            </div>
            <div className="muted t-12">{rep?.name}</div>
          </div>
        ) : (
          <div className="row cl-next-empty">
            <span className="muted grow">Визит не запланирован</span>
            {canPlan ? (
              <Button size="sm" icon={<CalendarPlus />} onClick={onPlan}>
                Запланировать
              </Button>
            ) : null}
          </div>
        )}

        <h3 className="cl-block-title" style={{ marginTop: 20 }}>
          Привычные товары
        </h3>
        {habitual.length ? (
          <div className="cl-habit">
            {habitual.map((h) => {
              const p = idx.products.get(h.productId);
              return (
                <div key={h.productId} className="cl-habit-row">
                  <EntityLink type="product" id={h.productId} className="entity-link cl-habit-name">
                    {p?.name ?? 'Товар'}
                  </EntityLink>
                  <span className="muted t-12 nowrap">
                    в {h.orders} из {real.length}
                  </span>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="muted">Пока мало заказов, чтобы понять привычки</div>
        )}
      </section>

      <section className="cl-block cl-span-all">
        <h3 className="cl-block-title">Последние заказы</h3>
        {orders.length ? <OrderList orders={orders.slice(0, 5)} /> : <div className="muted">Заказов ещё не было</div>}
      </section>
    </div>
  );
}

function OrderList({ orders }: { orders: Order[] }) {
  const db = useDB();
  const open = useOpenEntity();
  const { role } = useSession();
  const deliveries = deliveriesById(db);
  return (
    <div className="cl-list">
      {orders.map((o) => {
        const pay = orderPayment(db, o);
        const dl = o.deliveryId ? deliveries.get(o.deliveryId) : undefined;
        return (
          <button key={o.id} type="button" className="cl-list-row" onClick={() => open('order', o.id)}>
            <span className="cl-list-main">
              <span className="w-600">№ {o.number}</span>
              <span className="muted t-12">{fmt.dateShort(o.createdAt)}</span>
            </span>
            {/* главный этап и оплата: «Доставлен · Не оплачен», «Собирается», «Заявка» */}
            <span className="cl-list-chips">
              <OrderBrief o={o} pay={pay} delivery={dl} rep={role === 'rep'} approval={o.state === 'request' && !!approvalTask(db, o.id)} />
            </span>
            <span className="num w-600 cl-list-sum">{fmt.money(o.total)}</span>
          </button>
        );
      })}
    </div>
  );
}

function OrdersTab({ orders, phone }: { orders: Order[]; phone: boolean }) {
  const db = useDB();
  const open = useOpenEntity();
  const { role } = useSession();
  const rows = useMemo(() => {
    const dl = deliveriesById(db);
    return orders.map((o) => {
      const p = orderPayment(db, o);
      const d = o.deliveryId ? dl.get(o.deliveryId) : undefined;
      return { o, p, stage: orderStage(o, d, { rep: role === 'rep', approval: o.state === 'request' && !!approvalTask(db, o.id) }), overdue: shownOverdue(o, p, d) };
    });
  }, [orders, db, role]);
  if (!orders.length) return <EmptyState title="Заказов нет">Новый заказ — кнопкой внизу</EmptyState>;
  if (phone) return <OrderList orders={orders} />;
  type R = (typeof rows)[number];
  const columns: Column<R>[] = [
    { key: 'number', header: 'Заказ', render: (r) => <span className="w-600">№ {r.o.number}</span>, sort: (r) => r.o.number, csv: (r) => r.o.number },
    { key: 'date', header: 'Дата', render: (r) => fmt.dateShort(r.o.createdAt), sort: (r) => r.o.createdAt, csv: (r) => r.o.createdAt.slice(0, 10) },
    { key: 'state', header: 'Этап', render: (r) => <StatusChip s={r.stage} />, sort: (r) => r.stage.label, csv: (r) => r.stage.label },
    {
      key: 'pay',
      header: 'Оплата',
      render: (r) =>
        r.o.state !== 'confirmed' && r.o.state !== 'closed' ? <span className="faint">—</span> : r.overdue > 0 ? <StatusChip s={overdueStatus(r.overdue)} /> : r.p.amount > 0 ? <StatusChip s={PAY_STATE[r.p.state]} /> : <span className="faint">—</span>,
      sort: (r) => r.overdue,
    },
    { key: 'total', header: 'Сумма', align: 'right', render: (r) => fmt.money(r.o.total), sort: (r) => r.o.total, total: (rs) => fmt.money(rs.reduce((s, r) => s + (r.o.state === 'cancelled' ? 0 : r.o.total), 0)) },
    { key: 'debt', header: 'Долг', align: 'right', render: (r) => (r.p.debt > 0 ? <span className={cx(r.p.overdueDays > 0 && 'c-bad')}>{fmt.money(r.p.debt)}</span> : <span className="faint">—</span>), sort: (r) => r.p.debt, total: (rs) => fmt.money(rs.reduce((s, r) => s + r.p.debt, 0)) },
  ];
  return (
    <div className="cl-inner-table">
      <DataTable
        card={false}
        dense
        rows={rows}
        rowKey={(r) => r.o.id}
        columns={columns}
        defaultSort={{ key: 'date', dir: 'desc' }}
        onRowClick={(r) => open('order', r.o.id)}
        search={{ placeholder: 'Номер заказа', text: (r) => String(r.o.number) }}
        filters={[
          {
            key: 's',
            showCounts: true,
            options: [
              { value: 'all', label: 'Все' },
              { value: 'open', label: 'В работе', test: (r) => r.o.state === 'request' || r.o.state === 'confirmed' },
              { value: 'debt', label: 'С долгом', test: (r) => r.p.debt > 0 },
            ],
          },
        ]}
        totalLabel={(n) => `Итого · ${fmt.count(n, 'заказ', 'заказа', 'заказов')}`}
        pageSize={20}
      />
    </div>
  );
}

function paymentOrders(p: Payment, numbers: Map<string, number>): string {
  const a = p.allocations.filter((x) => x.orderId).map((x) => `№ ${numbers.get(x.orderId!) ?? '?'}`);
  return a.length ? a.join(', ') : 'Аванс';
}

function PaymentsTab({ payments, phone }: { payments: Payment[]; phone: boolean }) {
  const db = useDB();
  const numbers = useMemo(() => new Map(db.orders.map((o) => [o.id, o.number])), [db, payments]);
  if (!payments.length) return <EmptyState title="Оплат нет">Когда клиент заплатит, оплата появится здесь</EmptyState>;
  const signed = (p: Payment) => (p.kind === 'refund' ? -p.amount : p.amount);
  if (phone)
    return (
      <div className="cl-list">
        {payments.map((p) => (
          <div key={p.id} className="cl-list-row">
            <span className="cl-list-main">
              <span className="w-600">{p.kind === 'refund' ? 'Возврат денег' : PAY_METHOD_NAMES[p.method]}</span>
              <span className="muted t-12">
                {fmt.dateShort(p.at)} · {paymentOrders(p, numbers)}
              </span>
            </span>
            <span className="chips cl-list-chips">{p.status !== 'posted' ? <StatusChip s={PAYMENT_STATUS[p.status]} /> : null}</span>
            <span className={cx('num w-600 cl-list-sum', p.kind === 'refund' && 'c-bad')}>{fmt.money(signed(p))}</span>
          </div>
        ))}
      </div>
    );
  const columns: Column<Payment>[] = [
    { key: 'date', header: 'Дата', render: (p) => fmt.dateTime(p.at), sort: (p) => p.at, csv: (p) => p.at },
    { key: 'number', header: 'Платёж', render: (p) => `№ ${p.number}`, sort: (p) => p.number },
    { key: 'method', header: 'Способ', render: (p) => (p.kind === 'refund' ? 'Возврат денег' : PAY_METHOD_NAMES[p.method]), sort: (p) => p.method },
    { key: 'orders', header: 'По заказам', render: (p) => <span className="ink-2">{paymentOrders(p, numbers)}</span> },
    { key: 'status', header: 'Статус', render: (p) => <StatusChip s={PAYMENT_STATUS[p.status]} />, sort: (p) => p.status },
    {
      key: 'amount',
      header: 'Сумма',
      align: 'right',
      render: (p) => <span className={cx('w-600', p.kind === 'refund' && 'c-bad')}>{fmt.money(signed(p))}</span>,
      sort: signed,
      total: (rs) => fmt.money(rs.filter((p) => p.status === 'posted').reduce((s, p) => s + signed(p), 0)),
    },
  ];
  return (
    <div className="cl-inner-table">
      <DataTable
        card={false}
        dense
        rows={payments}
        rowKey={(p) => p.id}
        columns={columns}
        defaultSort={{ key: 'date', dir: 'desc' }}
        filters={[
          {
            key: 'm',
            showCounts: true,
            options: [
              { value: 'all', label: 'Все' },
              { value: 'pending', label: 'Ждут подтверждения', test: (p) => p.status !== 'posted' },
              { value: 'refund', label: 'Возвраты', test: (p) => p.kind === 'refund' },
            ],
          },
        ]}
        totalLabel={(n) => `Проведено · ${fmt.count(n, 'платёж', 'платежа', 'платежей')}`}
        pageSize={20}
      />
    </div>
  );
}

function PointsTab({ c }: { c: Client }) {
  return (
    <div className="col-4">
      <section className="cl-block">
        <h3 className="cl-block-title">Торговые точки</h3>
        {c.points.length ? (
          <div className="cl-list">
            {c.points.map((p) => (
              <div key={p.id} className="cl-list-row">
                <span className="icon-tile">
                  <MapPin />
                </span>
                <span className="cl-list-main">
                  <span className="w-600">{p.name}</span>
                  <span className="muted t-12">
                    {p.address}
                    {p.district ? ` · ${p.district}` : ''}
                  </span>
                </span>
                <a className="btn btn-secondary btn-sm" href={mapUrl(p)} target="_blank" rel="noreferrer">
                  <ExternalLink />
                  На карте
                </a>
              </div>
            ))}
          </div>
        ) : (
          <div className="muted">Точек нет</div>
        )}
      </section>
      <section className="cl-block">
        <h3 className="cl-block-title">Контакты</h3>
        {c.contacts.length ? (
          <div className="cl-list">
            {c.contacts.map((x) => {
              const tel = telUrl(x.phone);
              return (
                <div key={x.id} className="cl-list-row">
                  <span className="icon-tile">
                    <UserRound />
                  </span>
                  <span className="cl-list-main">
                    <span className="w-600">{x.name}</span>
                    <span className="muted t-12">{x.role || 'Контакт'}</span>
                  </span>
                  {tel ? (
                    <a className="btn btn-secondary btn-sm" href={tel}>
                      <Phone />
                      {fmt.phone(x.phone)}
                    </a>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <div className="muted">Контактов нет</div>
        )}
      </section>
    </div>
  );
}

function visitStatus(v: Visit) {
  if (v.state === 'done' && v.result) return VISIT_RESULT[v.result];
  return VISIT_STATE[v.state];
}

function VisitsTab({ visits, c }: { visits: Visit[]; c: Client }) {
  const db = useDB();
  const idx = indexes(db);
  const today = db.meta.today;
  if (!visits.length) return <EmptyState title="Визитов не было">Клиента пока не посещали</EmptyState>;
  return (
    <div className="cl-list">
      {visits.slice(0, 60).map((v) => {
        const pt = c.points.find((p) => p.id === v.pointId);
        const order = v.orderId ? idx.orders.get(v.orderId) : undefined;
        return (
          <div key={v.id} className="cl-list-row is-top">
            <span className="cl-visit-date">
              <span className="w-600">{fmt.relDate(v.date, today)}</span>
            </span>
            <span className="cl-list-main">
              <span className="w-600">{pt?.name ?? c.name}</span>
              <span className="t-12 ink-2 w-600">{visitTimes(v)}</span>
              <span className="muted t-12">
                {idx.employees.get(v.repId)?.short}
                {v.refusalReason ? ` · ${v.refusalReason}` : ''}
                {v.comment ? ` · ${v.comment}` : ''}
              </span>
            </span>
            <span className="chips cl-list-chips">
              <StatusChip s={visitStatus(v)} />
              {order ? (
                <EntityLink type="order" id={order.id}>
                  № {order.number}
                </EntityLink>
              ) : null}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TasksTab({ tasks, onNew }: { tasks: Task[]; onNew: () => void }) {
  const db = useDB();
  const { me } = useSession();
  const idx = indexes(db);
  const today = db.meta.today;
  const toggle = (t: Task) => {
    const r = dispatch(t.state === 'open' ? 'task.complete' : 'task.reopen', { taskId: t.id }, me.id);
    if (!r.ok) toast(r.error, 'error');
    else toast(t.state === 'open' ? 'Задача выполнена' : 'Задача снова открыта');
  };
  return (
    <div className="col-3">
      <div className="row">
        <span className="spacer" />
        <Button size="sm" icon={<Plus />} onClick={onNew}>
          Новая задача
        </Button>
      </div>
      {tasks.length ? (
        <div className="cl-list">
          {tasks.map((t) => {
            const overdue = t.state === 'open' && t.due < today;
            return (
              <label key={t.id} className="cl-list-row is-top cl-task">
                <input type="checkbox" className="task-check" checked={t.state === 'done'} onChange={() => toggle(t)} aria-label="Сделано" />
                <span className="cl-list-main">
                  <span className={cx('w-600', t.state === 'done' && 'cl-done')}>{t.title}</span>
                  <span className="muted t-12">
                    {idx.employees.get(t.assigneeId)?.short} · {fmt.relDate(t.due, today)}
                    {t.dueTime ? `, ${t.dueTime}` : ''}
                  </span>
                </span>
                <span className="chips cl-list-chips">
                  {overdue ? <Chip tone="bad">Просрочена</Chip> : null}
                  {t.priority === 'high' && t.state === 'open' ? <Chip tone="warn">Срочно</Chip> : null}
                  {t.state === 'done' ? <Chip tone="ok">Сделано</Chip> : null}
                </span>
              </label>
            );
          })}
        </div>
      ) : (
        <EmptyState title="Задач нет">Поставьте задачу: позвонить, привезти образцы, сверить долг</EmptyState>
      )}
    </div>
  );
}

function HistoryTab({ entries }: { entries: { id: string; at: string; actorId: string; text: string }[] }) {
  const db = useDB();
  const idx = indexes(db);
  if (!entries.length) return <EmptyState title="Изменений не было">Здесь появятся правки карточки: кто и что поменял</EmptyState>;
  return (
    <div className="cl-list">
      {entries.map((a) => (
        <div key={a.id} className="cl-list-row is-top">
          <span className="cl-visit-date">
            <span className="w-600">{fmt.dateShort(a.at)}</span>
            <span className="muted t-12">{fmt.time(a.at)}</span>
          </span>
          <span className="cl-list-main">
            <span>{a.text}</span>
            <span className="muted t-12">{idx.employees.get(a.actorId)?.name ?? 'Сотрудник'}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
