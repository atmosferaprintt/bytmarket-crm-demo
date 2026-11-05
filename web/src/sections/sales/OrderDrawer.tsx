import { useMemo, useState, type ReactNode } from 'react';
import {
  Ban,
  CircleCheck,
  ClipboardCheck,
  FileText,
  ListTodo,
  MessageCircle,
  PackageCheck,
  Pencil,
  Printer,
  Repeat,
  Send,
  Store,
  Truck,
  Undo2,
  Wallet,
} from 'lucide-react';
import type { ID, Order, OrderSource } from '../../data/types';
import { PAY_METHOD_NAMES } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { clientBalance, indexes, orderPayment, orderReturns, stockIndex } from './data';
import { useSession } from '../../roles/session';
import { useSalesOrders } from './salesScope';
import { EntityLink, useOpenEntity, type EntityDrawerProps } from '../../shell/entities';
import { TaskModal } from '../../shell/TaskModal';
import {
  Button,
  Card,
  Checkbox,
  ConfirmButton,
  DELIVERY_STATE,
  Drawer,
  EmptyState,
  Notice,
  PAYMENT_STATUS,
  PAY_STATE,
  PICK_STATE,
  StatList,
  StatRow,
  StatusChip,
  Steps,
  cx,
  fmt,
  toast,
  type MenuItem,
} from '../../ui';
import { AcceptPaymentModal } from '../money/AcceptPaymentModal';
import { AssignDeliveryModal } from '../delivery/AssignDeliveryModal';
import { OrderEditor } from './NewOrderDrawer';
import { ReturnModal } from './ReturnModal';
import { SendInvoiceModal } from './SendInvoiceModal';
import { PrintDoc, type PrintKind } from './PrintDocs';
import { TopMenu } from './TopMenu';
import { ConditionsStrip, Dash, OrderChips, PriceCell, PromoStateChip, deliveryFailed, shipStatus, shownOverdue } from './parts';
import { capitalize, fixNo, lineQtyLabel, orderProblems, orderSteps, productName, useIsPhone } from './lib';
import './sales.css';

const SOURCE_NAMES: Record<OrderSource, string> = {
  manager: 'менеджер',
  rep: 'заявка представителя',
  phone: 'по телефону',
  chat: 'из чата',
  repeat: 'повтор заказа',
};

/** Карточка «Заказ» в боковой панели. Открывается из любого раздела через ?open=…:id */
export default function EntityDrawer({ id, onClose }: EntityDrawerProps) {
  const db = useDB();
  useDBVersion();
  const { role } = useSession();
  const salesOrders = useSalesOrders();
  const o = indexes(db).orders.get(id) ?? db.orders.find((x) => x.id === id);
  if (!o)
    return (
      <Drawer title="Заказ не найден" onClose={onClose}>
        <Notice tone="warn">Заказа с таким номером нет — возможно, его удалили из демо при сбросе данных.</Notice>
      </Drawer>
    );
  if ((role === 'manager' || role === 'rep') && !salesOrders.some((x) => x.id === o.id))
    return (
      <Drawer title={`Заказ № ${o.number}`} onClose={onClose}>
        <Notice tone="warn" title="Это заказ другого сотрудника">
          Заказы чужих клиентов видят их ответственные и владелец.
        </Notice>
      </Drawer>
    );
  return <OrderCard o={o} onClose={onClose} />;
}

type Dialog = 'pay' | 'delivery' | 'return' | 'task' | 'repeat' | 'edit' | 'send' | null;

function OrderCard({ o, onClose }: { o: Order; onClose: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const { me, role, can } = useSession();
  const openEntity = useOpenEntity();
  const phone = useIsPhone();
  const [dialog, setDialog] = useState<Dialog>(null);
  const [printing, setPrinting] = useState<PrintKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState(false);

  const idx = indexes(db);
  const client = idx.clients.get(o.clientId);
  const point = client?.points.find((p) => p.id === o.pointId) ?? client?.points[0];
  const today = db.meta.today;

  const d = useMemo(() => {
    const pay = orderPayment(db, o);
    const balance = clientBalance(db, o.clientId);
    const ret = orderReturns(db).get(o.id);
    const si = stockIndex(db);
    const payments = db.payments
      .filter((p) => (p.kind === 'client' || p.kind === 'refund') && p.allocations.some((a) => a.orderId === o.id))
      .map((p) => ({ p, amount: p.allocations.filter((a) => a.orderId === o.id).reduce((s, a) => s + a.amount, 0) }))
      .sort((a, b) => a.p.at.localeCompare(b.p.at));
    const returns = db.returns.filter((r) => r.orderId === o.id).sort((a, b) => a.at.localeCompare(b.at));
    const deliveries = db.deliveries.filter((x) => x.orderId === o.id).sort((a, b) => a.number - b.number);
    const delivery = o.deliveryId ? deliveries.find((x) => x.id === o.deliveryId) : deliveries[deliveries.length - 1];
    const shippedQty = o.lines.reduce((s, l) => s + l.shipped, 0);
    const returnedQty = ret ? [...ret.byProduct.values()].reduce((s, v) => s + v, 0) : 0;
    const promoById = new Map(db.promos.map((x) => [x.id, x]));
    const lines = o.lines.map((l) => ({
      l,
      p: idx.products.get(l.productId),
      available: si.get(l.productId)?.[o.location].available ?? 0,
      promo: l.promoId ? promoById.get(l.promoId) : undefined,
    }));
    const gross = o.lines.reduce((s, l) => s + l.qty * l.basePrice, 0);
    const known = o.lines.filter((l) => l.cost !== null);
    const profit = known.reduce((s, l) => s + (l.price - (l.cost ?? 0)) * l.qty, 0);
    const knownSum = known.reduce((s, l) => s + l.price * l.qty, 0);
    return { pay, balance, ret, payments, returns, deliveries, delivery, shippedQty, returnedQty, lines, gross, profit, knownSum, costKnown: known.length === o.lines.length };
  }, [db, version, o.id]);

  const { pay, balance } = d;
  const failed = deliveryFailed(o, d.delivery);
  const overdue = shownOverdue(o, pay, d.delivery);
  const lastFail = failed ? d.delivery?.attempts.filter((a) => a.result === 'failed').pop() : undefined;
  const isRequest = o.state === 'request' || o.state === 'draft';
  const live = o.state === 'confirmed' || o.state === 'closed';
  const repOnly = role === 'rep';
  const problems = client && isRequest ? orderProblems(db, client, o.total) : [];
  const shortLines = isRequest ? d.lines.filter((x) => x.available < x.l.qty) : [];
  const author = idx.employees.get(o.authorId);
  const owner = o.ownerId ? idx.employees.get(o.ownerId) : undefined;

  const run = (act: () => ReturnType<typeof dispatch>, ok: string) => {
    setError(null);
    const r = act();
    if (!r.ok) {
      setError(fixNo(r.error));
      return false;
    }
    toast(r.info ? `${ok}. ${fixNo(r.info)}` : ok);
    return true;
  };

  /* ---------- права ---------- */
  const canConfirm = can('confirmOrder');
  const canCreate = can('createOrder') || can('createRequest');
  const canReturn = (can('createOrder') || can('inspectQuarantine')) && d.shippedQty - d.returnedQty > 0 && o.state !== 'cancelled';
  const canShip = can('shipOrder');
  const canPay = can('acceptPayment') && live && pay.due - pay.pending > 0;
  const canDeliver = (can('assignDelivery') || can('confirmOrder')) && live && o.fulfillment === 'delivery' && o.ship !== 'shipped' && o.ship !== 'delivered' && (!d.delivery || d.delivery.state === 'returned');
  const deliveryBusy = d.delivery && (d.delivery.state === 'on_way' || d.delivery.state === 'failed');
  const canCancel =
    o.state !== 'cancelled' &&
    o.state !== 'closed' &&
    o.ship !== 'shipped' &&
    o.ship !== 'delivered' &&
    !deliveryBusy &&
    (can('cancelOrder') || (repOnly && isRequest && o.authorId === me.id));
  const canEdit = isRequest && (canConfirm || (repOnly && o.authorId === me.id));
  const hasChat = db.chats.some((c) => c.clientId === o.clientId);
  const pickPending = o.state === 'confirmed' && o.pick !== 'picked' && o.ship === 'none';

  const confirm = () => run(() => dispatch('order.confirm', { orderId: o.id, override: role === 'owner' && override }, me.id), `Заказ № ${o.number} подтверждён, товар зарезервирован`);
  const pick = () => run(() => dispatch('order.pick', { orderId: o.id }, me.id), o.pick === 'none' ? 'Сборка начата' : 'Заказ собран');
  const ship = () => run(() => dispatch('order.ship', { orderId: o.id }, me.id), `Заказ № ${o.number} выдан самовывозом`);
  const sendRequest = () => run(() => dispatch('order.update', { orderId: o.id, state: 'request' }, me.id), `Заявка № ${o.number} отправлена менеджеру`);
  const askOwner = () => {
    const ownerEmp = db.employees.find((e) => e.active && e.roles.includes('owner'));
    if (!ownerEmp) return;
    run(
      () => dispatch('task.create', { title: `Согласовать заказ № ${o.number}: ${problems.map((p) => p.text).join('; ')}`, assigneeId: ownerEmp.id, due: today, priority: 'high', link: { type: 'order', id: o.id } }, me.id),
      `Владелец получит задачу согласовать заказ № ${o.number}`,
    );
  };

  /* ---------- главное действие: следующий шаг ---------- */
  type Next = 'confirm' | 'ask' | 'send' | 'delivery' | 'pick' | 'ship' | 'pay' | null;
  let next: Next = null;
  if (isRequest && canConfirm) next = problems.length > 0 && role !== 'owner' ? 'ask' : 'confirm';
  else if (o.state === 'draft' && repOnly && o.authorId === me.id) next = 'send';
  else if (canDeliver) next = 'delivery';
  else if (o.state === 'confirmed' && o.fulfillment === 'pickup' && canShip) next = o.pick === 'picked' || o.ship === 'partial' ? 'ship' : 'pick';
  else if (canPay) next = 'pay';

  const blocked = problems.length > 0 && !override;
  let primary: ReactNode = null;
  if (next === 'confirm')
    primary = (
      <Button
        variant="primary"
        icon={<PackageCheck />}
        disabled={blocked || shortLines.length > 0}
        title={shortLines.length ? 'Не хватает товара на складе' : blocked ? 'Отметьте подтверждение сверх условий' : undefined}
        onClick={confirm}
      >
        {problems.length ? 'Подтвердить сверх условий' : 'Подтвердить и зарезервировать'}
      </Button>
    );
  else if (next === 'ask')
    primary = (
      <Button variant="primary" icon={<ListTodo />} onClick={askOwner}>
        Запросить согласие владельца
      </Button>
    );
  else if (next === 'send')
    primary = (
      <Button variant="primary" icon={<Send />} onClick={sendRequest}>
        Отправить заявку
      </Button>
    );
  else if (next === 'delivery')
    primary = (
      <Button variant="primary" icon={<Truck />} onClick={() => setDialog('delivery')}>
        Оформить доставку
      </Button>
    );
  else if (next === 'pick')
    primary = (
      <Button variant="primary" icon={<ClipboardCheck />} onClick={pick}>
        {o.pick === 'none' ? 'Начать сборку' : 'Отметить: собран'}
      </Button>
    );
  else if (next === 'ship')
    primary = (
      <Button variant="primary" icon={<PackageCheck />} onClick={ship}>
        Выдать самовывозом
      </Button>
    );
  else if (next === 'pay')
    primary = (
      <Button variant="primary" icon={<Wallet />} onClick={() => setDialog('pay')}>
        Принять оплату
      </Button>
    );

  const secondaryKind: 'pay' | 'edit' | null = canPay && next !== 'pay' ? 'pay' : canEdit ? 'edit' : null;
  const secondary =
    secondaryKind === 'pay' ? (
      <Button icon={<Wallet />} onClick={() => setDialog('pay')}>
        Принять оплату
      </Button>
    ) : secondaryKind === 'edit' ? (
      <Button icon={<Pencil />} onClick={() => setDialog('edit')}>
        Изменить
      </Button>
    ) : null;

  const menu: MenuItem[] = [
    { label: 'Повторить заказ', icon: <Repeat />, onClick: () => setDialog('repeat'), hidden: !canCreate || o.state === 'draft' || !o.lines.length },
    { label: 'Оформить возврат', icon: <Undo2 />, onClick: () => setDialog('return'), hidden: !canReturn },
    {
      label: 'Доставить вместо самовывоза',
      icon: <Truck />,
      onClick: () => setDialog('delivery'),
      hidden: !((can('assignDelivery') || can('confirmOrder')) && live && o.state === 'confirmed' && o.fulfillment === 'pickup' && o.ship === 'none'),
    },
    { label: 'Отправить счёт клиенту', icon: <MessageCircle />, onClick: () => setDialog('send'), hidden: !canCreate || !hasChat || !live || pay.due <= 0 },
    { label: 'Счёт на оплату', icon: <Printer />, onClick: () => setPrinting('invoice'), hidden: o.state === 'cancelled' || o.state === 'draft' },
    { label: 'Накладная', icon: <FileText />, onClick: () => setPrinting('waybill'), hidden: !live },
    { label: o.pick === 'none' ? 'Начать сборку' : 'Отметить: собран', icon: <ClipboardCheck />, onClick: pick, hidden: !canShip || !pickPending || next === 'pick' },
    { label: 'Изменить заявку', icon: <Pencil />, onClick: () => setDialog('edit'), hidden: !canEdit || secondaryKind === 'edit' },
    { label: 'sep', separator: true },
    { label: 'Поставить задачу', icon: <ListTodo />, onClick: () => setDialog('task') },
    { label: 'Карточка клиента', icon: <Store />, onClick: () => openEntity('client', o.clientId) },
    { label: `Доставка № ${d.delivery?.number ?? ''}`, icon: <Truck />, onClick: () => d.delivery && openEntity('delivery', d.delivery.id), hidden: !d.delivery },
  ];

  /* ---------- шапка ---------- */
  const title = (
    <span className="row-3" style={{ flexWrap: 'wrap' }}>
      Заказ № {o.number}
      <OrderChips o={o} pay={pay} delivery={d.delivery} />
    </span>
  );
  const head = (
    <div className="col-3">
      <div className="sales-client-line">
        <div className="grow">
          {client ? (
            <EntityLink type="client" id={client.id} className="sales-client-name entity-link">
              {client.name}
            </EntityLink>
          ) : (
            <span className="sales-client-name">Клиент удалён</span>
          )}
          <div className="muted t-13 ellipsis">
            {[point?.address ?? null, fmt.dateTime(o.createdAt), `${capitalize(SOURCE_NAMES[o.source])}${author ? `: ${author.short}` : ''}`, owner && owner.id !== author?.id ? `ведёт ${owner.short}` : null]
              .filter(Boolean)
              .join(' · ')}
          </div>
        </div>
      </div>
      {o.state !== 'cancelled' ? <Steps items={orderSteps(o, pay)} /> : null}
    </div>
  );

  const dueLabel = o.dueDate ? (
    fmt.date(o.dueDate)
  ) : client && client.deferDays > 0 && o.state !== 'cancelled' ? (
    <span title="Срок считается от дня отгрузки">≈ {fmt.date(fmt.addDays(d.delivery?.date && d.delivery.date > today ? d.delivery.date : today, client.deferDays))}</span>
  ) : client && client.deferDays > 0 ? (
    '—'
  ) : (
    'При получении'
  );
  const lastEvent = o.history[o.history.length - 1];

  return (
    <Drawer
      wide
      title={title}
      head={head}
      onClose={onClose}
      footer={
        <div className="sales-card-foot">
          {canCancel ? (
            <ConfirmButton variant="ghost" icon={<Ban />} confirmText={o.ship === 'partial' ? 'Отменить остаток?' : 'Отменить заказ?'} onConfirm={() => run(() => dispatch('order.cancel', { orderId: o.id }, me.id), o.ship === 'partial' ? `Остаток заказа № ${o.number} отменён` : `Заказ № ${o.number} отменён`)}>
              {o.ship === 'partial' ? 'Отменить остаток' : 'Отменить'}
            </ConfirmButton>
          ) : null}
          <TopMenu items={menu} align="start" />
          <span className="spacer" />
          {secondary}
          {primary}
        </div>
      }
    >
      <div className="sales-order-body">
      {o.state === 'cancelled' ? (
        <Notice title="Заказ отменён">{lastEvent ? `${capitalize(fixNo(lastEvent.text))}, ${fmt.dateTime(lastEvent.at)}` : null}</Notice>
      ) : null}
      {isRequest ? (
        <Notice tone="info" title={o.state === 'draft' ? 'Черновик — товар не зарезервирован' : 'Заявка ждёт подтверждения — товар не зарезервирован'}>
          {o.state === 'draft'
            ? 'Черновик видят только вы и менеджер. Отправьте его, когда состав будет готов.'
            : canConfirm
              ? 'Проверьте наличие и условия клиента и подтвердите — товар закрепится за клиентом.'
              : 'Товар закрепится, когда менеджер подтвердит заявку.'}
        </Notice>
      ) : null}
      {problems.length ? (
        <Notice
          tone="bad"
          title="Заказ сверх условий клиента"
          action={
            role === 'owner' && canConfirm ? (
              <Checkbox checked={override} onChange={setOverride}>
                Подтверждаю сверх условий
              </Checkbox>
            ) : undefined
          }
        >
          {capitalize(problems.map((p) => p.text).join('; '))}. {role === 'owner' ? 'Вы можете подтвердить под свою ответственность.' : 'Подтвердить сверх условий может только владелец.'}
        </Notice>
      ) : null}
      {shortLines.length ? (
        <Notice tone="warn" title="Не хватает товара на складе">
          {shortLines.map((x) => `${productName(x.p)}: доступно ${fmt.qty(x.available)}, в заявке ${fmt.qty(x.l.qty)}`).join('; ')}. Измените заявку перед подтверждением.
        </Notice>
      ) : null}
      {failed ? (
        <Notice tone="bad" title="Не доставлен">
          {lastFail ? `${fmt.dateTime(lastFail.at)}: ${lastFail.reason}. ` : ''}Диспетчер назначит повторную доставку или вернёт товар на склад.
        </Notice>
      ) : null}
      {overdue > 0 ? (
        <Notice tone="bad" title={`Просрочка оплаты ${fmt.count(overdue, 'день', 'дня', 'дней')}`}>
          Долг по заказу {fmt.money(pay.debt)}, срок оплаты был {fmt.date(o.dueDate)}.
        </Notice>
      ) : null}
      {error ? (
        <Notice tone="bad" title="Не получилось">
          {error}
        </Notice>
      ) : null}

      {client ? <ConditionsStrip client={client} balance={balance} dueLabel={dueLabel} /> : null}

      <section className="sales-block">
        <div className="sales-block-head">
          <h3 className="t-16 w-700">Товары</h3>
          <span className="muted t-13">
            {fmt.count(o.lines.length, 'позиция', 'позиции', 'позиций')} · {fmt.qty(o.lines.reduce((s, l) => s + l.qty, 0))}
          </span>
        </div>
        {phone ? (
          <div className="sales-mini-list is-flat">
            {d.lines.map(({ l, p, available, promo }, i) => (
              <div key={l.productId + i} className="sales-mini-row sales-phone-line">
                <span className="grow">
                  <span className="w-600" style={{ display: 'block' }}>
                    {productName(p)}
                  </span>
                  <span className="t-12 muted">
                    {l.pack === 'pcs' ? fmt.qty(l.qty) : `${lineQtyLabel(l)} = ${fmt.qty(l.qty)}`}
                    {isRequest ? <span className={cx(available < l.qty && 'c-bad w-600')}> · доступно {fmt.qty(available)}</span> : l.shipped ? ` · отгружено ${fmt.qty(l.shipped)}` : ''}
                  </span>
                  {promo ? (
                    <span className="sales-line-promo t-12 muted">
                      <span className="ellipsis">Акция «{promo.name}»</span>
                      <PromoStateChip promo={promo} today={today} />
                    </span>
                  ) : null}
                </span>
                <PriceCell price={l.price} base={l.basePrice} />
                <span className="num w-700">{fmt.money(l.qty * l.price)}</span>
              </div>
            ))}
          </div>
        ) : (
        <div className="sales-lines-wrap">
          <table className="table table-dense sales-lines">
            <thead>
              <tr>
                <th>Товар</th>
                <th>Упаковка</th>
                <th className="num">Заказано</th>
                {isRequest ? <th className="num">Доступно</th> : <th className="num">Отгружено</th>}
                {d.returnedQty ? <th className="num">Возврат</th> : null}
                <th className="num">Цена</th>
                <th className="num">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {d.lines.map(({ l, p, available, promo }, i) => {
                const back = d.ret?.byProduct.get(l.productId) ?? 0;
                return (
                  <tr key={l.productId + i}>
                    <td>
                      <EntityLink type="product" id={l.productId} className="entity-link sales-line-name">
                        {productName(p)}
                      </EntityLink>
                      <div className="cell-sub">
                        {p?.sku}
                        {l.discountReason ? ` · скидка ${fmt.pct(l.discountPct)}: ${l.discountReason}` : ''}
                      </div>
                      {promo ? (
                        <div className="cell-sub sales-line-promo">
                          <span className="ellipsis">Акция «{promo.name}»</span>
                          <PromoStateChip promo={promo} today={today} />
                        </div>
                      ) : null}
                    </td>
                    <td className="nowrap ink-2">{lineQtyLabel(l)}</td>
                    <td className="num w-600">{fmt.qty(l.qty)}</td>
                    {isRequest ? (
                      <td className={cx('num', available < l.qty ? 'c-bad w-700' : 'muted')}>{fmt.qty(available)}</td>
                    ) : (
                      <td className={cx('num', l.shipped === l.qty ? 'c-ok' : l.shipped > 0 ? 'c-warn' : 'muted')}>{l.shipped ? fmt.qty(l.shipped) : <Dash />}</td>
                    )}
                    {d.returnedQty ? <td className="num">{back ? fmt.qty(back) : <Dash />}</td> : null}
                    <td className="num">
                      <PriceCell price={l.price} base={l.basePrice} />
                    </td>
                    <td className="num w-700">{fmt.money(l.qty * l.price)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        )}
        <div className="sales-card-totals">
          <StatList>
            {d.gross > o.total ? <StatRow label="Без скидок" value={fmt.money(d.gross)} /> : null}
            {d.gross > o.total ? <StatRow label="Скидки и акции" value={`−${fmt.money(d.gross - o.total)}`} /> : null}
            {d.ret ? <StatRow label="Возвращено" value={`−${fmt.money(d.ret.amount)}`} /> : null}
            {can('seeProfit') && d.knownSum > 0 ? (
              <StatRow
                label={d.costKnown ? 'Валовая прибыль' : 'Валовая прибыль по известной себестоимости'}
                value={`${fmt.money(d.profit)} · ${fmt.pct((d.profit / d.knownSum) * 100)}`}
              />
            ) : null}
            <StatRow total label="Сумма заказа" value={fmt.money(Math.max(0, o.total - (d.ret?.amount ?? 0)))} />
          </StatList>
        </div>
      </section>

      <div className="sales-card-grid">
        <Card title="Оплата" actions={live && pay.amount > 0 ? <StatusChip s={PAY_STATE[pay.state]} /> : undefined}>
          <StatList>
            <StatRow label="К оплате" value={fmt.money(pay.amount)} />
            <StatRow label="Оплачено" value={<span className={cx(pay.paid > 0 && 'c-ok')}>{fmt.money(pay.paid)}</span>} />
            {pay.pending > 0 ? <StatRow label="Ждёт подтверждения банка" value={fmt.money(pay.pending)} /> : null}
            <StatRow label={pay.advance > 0 && pay.due === 0 ? 'Переплата' : 'Осталось'} value={<span className={cx(overdue > 0 && 'c-bad')}>{fmt.money(pay.advance > 0 && pay.due === 0 ? pay.advance : pay.due)}</span>} />
          </StatList>
          {d.payments.length ? (
            <div className="sales-mini-list">
              {d.payments.map(({ p, amount }) => (
                <div key={p.id} className="sales-mini-row">
                  <span className="grow">
                    <span className="w-600">{p.kind === 'refund' ? 'Возврат денег' : `Платёж № ${p.number}`}</span>
                    <span className="muted t-12">
                      {' '}
                      · {fmt.date(p.at)} · {PAY_METHOD_NAMES[p.method]}
                    </span>
                  </span>
                  {p.status !== 'posted' ? <StatusChip s={PAYMENT_STATUS[p.status]} /> : null}
                  <span className={cx('num w-700', p.kind === 'refund' ? 'c-bad' : undefined)}>
                    {p.kind === 'refund' ? '−' : '+'}
                    {fmt.money(amount)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted t-13 sales-mini-empty">Оплат по заказу ещё не было</div>
          )}
        </Card>

        <Card title={o.fulfillment === 'pickup' ? 'Самовывоз' : 'Доставка'} actions={d.delivery ? <StatusChip s={DELIVERY_STATE[d.delivery.state]} /> : undefined}>
          {o.fulfillment === 'pickup' ? (
            <StatList>
              <StatRow label="Откуда" value="Склад" />
              <StatRow label="Сборка" value={<StatusChip s={PICK_STATE[o.pick]} />} />
              <StatRow label="Выдача" value={<StatusChip s={shipStatus(o, d.delivery)} />} />
            </StatList>
          ) : d.delivery ? (
            <>
              <StatList>
                <StatRow
                  label="Доставка"
                  value={
                    <EntityLink type="delivery" id={d.delivery.id}>
                      № {d.delivery.number}
                    </EntityLink>
                  }
                />
                <StatRow label="Когда" value={`${fmt.date(d.delivery.date)}, ${d.delivery.interval}`} />
                <StatRow label="Адрес" value={<span className="sales-wrap-value">{d.delivery.address}</span>} />
                <StatRow label="Курьер" value={d.delivery.courierId ? idx.employees.get(d.delivery.courierId)?.name ?? '—' : 'Не назначен'} />
                <StatRow label="Мест" value={fmt.num(d.delivery.places)} />
                {d.delivery.collect > 0 ? <StatRow label="К получению" value={fmt.money(d.delivery.collect)} /> : null}
              </StatList>
              {d.delivery.attempts.filter((a) => a.result === 'failed').map((a, i) => (
                <div key={i} className="t-12 c-bad" style={{ marginTop: 6 }}>
                  {fmt.dateTime(a.at)}: не доставлен — {a.reason}
                </div>
              ))}
            </>
          ) : (
            <EmptyState icon={<Truck />} title="Доставка не оформлена">
              {live ? 'Назначьте дату и интервал — заказ попадёт в очередь доставки' : 'Оформим после подтверждения заказа'}
            </EmptyState>
          )}
        </Card>
      </div>

      {d.returns.length ? (
        <Card title="Возвраты по заказу">
          <div className="sales-mini-list is-flat">
            {d.returns.map((r) => (
              <div key={r.id} className="sales-mini-row">
                <span className="grow">
                  <span className="w-600">Возврат № {r.number}</span>
                  <span className="muted t-12">
                    {' '}
                    · {fmt.date(r.at)} · {fmt.count(r.lines.reduce((s, l) => s + l.qty, 0), 'штука', 'штуки', 'штук')} · {idx.employees.get(r.authorId)?.short}
                  </span>
                </span>
                <span className="t-12 muted">{r.refundPaymentId ? 'деньги вернули' : 'зачтено в долг'}</span>
                <span className="num w-700">{fmt.money(r.amount)}</span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {o.comment ? (
        <Card title="Комментарий для склада">
          <div className="ink-2">{o.comment}</div>
        </Card>
      ) : null}

      <Card title="История">
        <div className="sales-history">
          {[...o.history].reverse().map((e, i) => (
            <div key={i} className="sales-history-row">
              <span className="sales-history-dot">{i === 0 ? <CircleCheck /> : null}</span>
              <span className="grow">{capitalize(fixNo(e.text))}</span>
              <span className="muted t-12 nowrap">
                {idx.employees.get(e.actorId)?.short ?? '—'} · {fmt.dateTime(e.at)}
              </span>
            </div>
          ))}
        </div>
      </Card>

      {dialog === 'pay' ? <AcceptPaymentModal clientId={o.clientId} orderId={o.id} onClose={() => setDialog(null)} onDone={() => setDialog(null)} /> : null}
      {dialog === 'delivery' ? <AssignDeliveryModal orderId={o.id} onClose={() => setDialog(null)} onDone={() => setDialog(null)} /> : null}
      {dialog === 'return' ? <ReturnModal orderId={o.id} onClose={() => setDialog(null)} onDone={() => setDialog(null)} /> : null}
      {dialog === 'task' ? <TaskModal link={{ type: 'order', id: o.id }} onClose={() => setDialog(null)} defaultTitle={`Заказ № ${o.number}: `} /> : null}
      {dialog === 'send' ? <SendInvoiceModal order={o} onClose={() => setDialog(null)} /> : null}
      {dialog === 'repeat' ? (
        <OrderEditor
          repeatOf={o.id}
          onClose={() => setDialog(null)}
          onCreated={(newId: ID) => {
            setDialog(null);
            openEntity('order', newId);
          }}
        />
      ) : null}
      {dialog === 'edit' ? <OrderEditor editId={o.id} onClose={() => setDialog(null)} onCreated={() => setDialog(null)} /> : null}
      </div>
      {printing ? <PrintDoc kind={printing} order={o} onDone={() => setPrinting(null)} /> : null}
    </Drawer>
  );
}

