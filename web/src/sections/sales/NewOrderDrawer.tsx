import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleCheck, Clock, History, Info, PackageCheck, ScanBarcode, Send, Store, Trash2, X } from 'lucide-react';
import type { Client, ID, ISODate, OrderSource, PackKey, Product } from '../../data/types';
import { dispatch, nowDemo, useDB, useDBVersion } from '../../data/store';
import { clientBalance, indexes, priceFor, repeatPreviewSafe, stockIndex } from './data';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import {
  Button,
  Checkbox,
  Chip,
  Drawer,
  EmptyState,
  Field,
  IconTile,
  Input,
  Notice,
  QtyInput,
  SearchInput,
  Segmented,
  Select,
  StatList,
  StatRow,
  StatusChip,
  ORDER_STATE,
  cx,
  fmt,
  overdueStatus,
  toast,
} from '../../ui';
import { ConditionsStrip, Dash, DiscountChip, LimitBar, PriceCell } from './parts';
import { INTERVALS, capitalize, newKey, nextWorkday, norm, orderProblems, productName, useIsPhone } from './lib';
import { DiscountModal, HistoryPicker, ProductSearch, RepeatChanges } from './OrderEditorParts';
import { TopMenu } from './TopMenu';
import './sales.css';

export interface NewOrderProps {
  /** клиент заранее выбран (из карточки клиента, визита, чата) */
  clientId?: ID;
  pointId?: ID | null;
  /** повторить этот заказ: строки подставляются с проверкой цен и наличия, показывается «было → стало» */
  repeatOf?: ID;
  /** откуда создаём: визит представителя, чат и т. п. */
  source?: OrderSource;
  visitId?: ID;
  chatId?: ID;
  onClose: () => void;
  onCreated?: (orderId: ID) => void;
}

/** Новый оптовый заказ (у представителя — заявка без резерва). Общий: используют Продажи, Клиенты, визиты, Чаты. */
export function NewOrderDrawer(props: NewOrderProps) {
  return <OrderEditor {...props} />;
}

export interface DraftLine {
  key: string;
  productId: ID;
  pack: PackKey;
  packQty: number;
  discountPct: number;
  discountReason: string | null;
}

interface DraftState {
  clientId: ID | null;
  pointId: ID | null;
  lines: DraftLine[];
  fulfillment: 'delivery' | 'pickup';
  date: ISODate;
  interval: string;
  comment: string;
}

interface StoredDraft extends DraftState {
  savedAt: string;
}

const DRAFT_PREFIX = 'bm-sales-draft-v1';

function loadDraft(key: string): StoredDraft | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as StoredDraft) : null;
  } catch {
    return null;
  }
}
function storeDraft(key: string, d: StoredDraft) {
  try {
    localStorage.setItem(key, JSON.stringify(d));
  } catch {
    /* хранилище недоступно — черновик живёт до закрытия окна */
  }
}
function dropDraft(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* ничего */
  }
}

/** Пакет по умолчанию: опту — коробка или упаковка, рознице — штука. */
export function defaultPack(p: Product, wholesale: boolean): PackKey {
  if (!wholesale) return 'pcs';
  return p.packs.find((x) => x.key === 'box')?.key ?? p.packs.find((x) => x.key === 'pack')?.key ?? 'pcs';
}

/** Редактор заказа: новый, повтор, продолжение черновика или заявки (editId). */
export function OrderEditor({ clientId: clientProp, pointId: pointProp, repeatOf, source, chatId, onClose, onCreated, editId }: NewOrderProps & { editId?: ID }) {
  const db = useDB();
  const version = useDBVersion();
  const { me, role, can, discountLimit } = useSession();
  const scoped = useScoped();
  const openEntity = useOpenEntity();
  const phone = useIsPhone();
  const today = db.meta.today;

  const isOwner = role === 'owner';
  const confirmsSelf = can('createOrder'); // менеджер и владелец подтверждают сами
  const editing = editId ? db.orders.find((o) => o.id === editId) : undefined;

  const preview = useMemo(() => (repeatOf ? repeatPreviewSafe(db, repeatOf) : null), [repeatOf]); // считаем один раз при открытии
  const repeatSource = repeatOf ? db.orders.find((o) => o.id === repeatOf) : undefined;

  const draftKey = `${DRAFT_PREFIX}:${me.id}:${editId ? 'e' + editId : repeatOf ? 'r' + repeatOf : clientProp ?? 'new'}`;

  const [state, setState] = useState<DraftState>(() => {
    const base: DraftState = {
      clientId: clientProp ?? null,
      pointId: pointProp ?? null,
      lines: [],
      fulfillment: 'delivery',
      date: nextWorkday(today),
      interval: '10:00–14:00',
      comment: '',
    };
    if (editing) {
      return {
        ...base,
        clientId: editing.clientId,
        pointId: editing.pointId,
        fulfillment: editing.fulfillment,
        comment: editing.comment,
        lines: editing.lines.map((l) => ({ key: newKey('l'), productId: l.productId, pack: l.pack, packQty: l.packQty, discountPct: l.discountPct, discountReason: l.discountReason })),
      };
    }
    if (preview) {
      return {
        ...base,
        clientId: preview.clientId,
        pointId: repeatSource?.pointId ?? null,
        fulfillment: repeatSource?.fulfillment ?? 'delivery',
        lines: preview.payloadLines.map((l) => ({ key: newKey('l'), productId: l.productId, pack: l.pack, packQty: l.packQty, discountPct: 0, discountReason: null })),
      };
    }
    return base;
  });
  const [restored, setRestored] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [repeatAck, setRepeatAck] = useState(false);
  const [discountFor, setDiscountFor] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ikRef = useRef(newKey('ord-' + me.id));
  const touched = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);

  // восстановить черновик, если окно закрыли, не оформив
  useEffect(() => {
    if (editing || preview) return;
    const d = loadDraft(draftKey);
    if (d && d.lines.length) {
      setState({ clientId: clientProp ?? d.clientId, pointId: clientProp ? pointProp ?? null : d.pointId, lines: d.lines, fulfillment: d.fulfillment, date: d.date < today ? nextWorkday(today) : d.date, interval: d.interval, comment: d.comment });
      setRestored(d.savedAt);
      setSavedAt(d.savedAt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // автосохранение черновика
  useEffect(() => {
    if (!touched.current) return;
    const t = window.setTimeout(() => {
      const at = fmt.time(nowDemo());
      if (state.lines.length || state.clientId) storeDraft(draftKey, { ...state, savedAt: at });
      setSavedAt(at);
    }, 600);
    return () => window.clearTimeout(t);
  }, [state, draftKey]);

  useEffect(() => {
    if (!flash) return;
    const t = window.setTimeout(() => setFlash(null), 900);
    return () => window.clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);

  const update = (fn: (s: DraftState) => DraftState) => {
    touched.current = true;
    setError(null);
    setState(fn);
  };

  const idx = useMemo(() => indexes(db), [db, version]);
  const client: Client | undefined = state.clientId ? idx.clients.get(state.clientId) : undefined;
  const balance = useMemo(() => (client ? clientBalance(db, client.id) : null), [db, version, client?.id]);
  const wholesale = (client?.priceType ?? 'wholesale') === 'wholesale';
  const point = client ? client.points.find((p) => p.id === state.pointId) ?? client.points[0] : undefined;

  /* ---------- расчёт строк ---------- */
  const calc = useMemo(() => {
    const si = stockIndex(db);
    const priceType = client?.priceType ?? 'wholesale';
    const usedByProduct = new Map<ID, number>();
    for (const l of state.lines) {
      const p = idx.products.get(l.productId);
      const pk = p?.packs.find((x) => x.key === l.pack) ?? p?.packs[0];
      usedByProduct.set(l.productId, (usedByProduct.get(l.productId) ?? 0) + l.packQty * (pk?.qty ?? 1));
    }
    const rows = state.lines.map((l) => {
      const p = idx.products.get(l.productId);
      const pk = p?.packs.find((x) => x.key === l.pack) ?? p?.packs[0];
      const packSize = pk?.qty ?? 1;
      const qty = l.packQty * packSize;
      const pr = priceFor(db, l.productId, { priceType, date: today });
      const price = l.discountPct > 0 ? Math.round((pr.price * (100 - l.discountPct)) / 100) : pr.price;
      const available = si.get(l.productId)?.warehouse.available ?? 0;
      const need = usedByProduct.get(l.productId) ?? qty;
      const promoPct = pr.promo && pr.base > 0 ? Math.round(((pr.base - pr.price) / pr.base) * 100) : 0;
      return { l, p, pk, packSize, qty, base: pr.base, promoPrice: pr.price, price, promo: pr.promo, promoPct, available, short: need > available, sum: qty * price, gross: qty * pr.base };
    });
    const total = rows.reduce((s, r) => s + r.sum, 0);
    const gross = rows.reduce((s, r) => s + r.gross, 0);
    const pieces = rows.reduce((s, r) => s + r.qty, 0);
    return { rows, total, gross, pieces, discount: gross - total, shortRows: rows.filter((r) => r.short) };
  }, [db, version, state.lines, client?.priceType, idx, today]);

  const problems = useMemo(() => (client ? orderProblems(db, client, calc.total) : []), [db, version, client, calc.total]);
  const hardProblems = problems.filter((p) => p.key !== 'min');
  const minProblem = problems.find((p) => p.key === 'min');

  /* ---------- действия со строками ---------- */
  const addProduct = (productId: ID, pack?: PackKey, qty = 1) => {
    const p = idx.products.get(productId);
    if (!p) return;
    const pk = pack ?? defaultPack(p, wholesale);
    const same = state.lines.find((l) => l.productId === productId && l.pack === pk);
    if (same) {
      update((s) => ({ ...s, lines: s.lines.map((l) => (l.key === same.key ? { ...l, packQty: l.packQty + qty } : l)) }));
      setFlash(same.key);
      return;
    }
    const key = newKey('l');
    update((s) => ({ ...s, lines: [...s.lines, { key, productId, pack: pk, packQty: qty, discountPct: 0, discountReason: null }] }));
    setFlash(key);
  };
  const setLine = (key: string, patch: Partial<DraftLine>) => update((s) => ({ ...s, lines: s.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));
  const removeLine = (key: string) => update((s) => ({ ...s, lines: s.lines.filter((l) => l.key !== key) }));

  /* ---------- отправка ---------- */
  const linesPayload = () => state.lines.map((l) => ({ productId: l.productId, pack: l.pack, packQty: l.packQty, discountPct: l.discountPct, discountReason: l.discountReason ?? undefined }));
  const deliveryNote = state.fulfillment === 'delivery' ? `Доставка ${fmt.date(state.date)}, ${state.interval}` : 'Самовывоз';
  const orderSource: OrderSource | undefined = source ?? (chatId ? 'chat' : repeatOf ? 'repeat' : undefined);

  const finish = (orderId: ID, message: string, withDelivery: boolean) => {
    if (withDelivery && state.fulfillment === 'delivery') {
      const d = dispatch('delivery.create', { orderId, date: state.date, interval: state.interval, pointId: point?.id }, me.id);
      if (!d.ok) toast(`Заказ создан, доставку оформите отдельно: ${d.error}`, 'error');
    }
    if (chatId) {
      const o = getOrderNumber(orderId);
      dispatch('chat.send', { chatId, text: `Оформили ${confirmsSelf ? 'заказ' : 'заявку'} № ${o} на ${fmt.money(calc.total)}. ${deliveryNote}.`, orderId }, me.id);
    }
    dropDraft(draftKey);
    toast(message);
    if (onCreated) onCreated(orderId);
    else {
      onClose();
      openEntity('order', orderId);
    }
  };
  const getOrderNumber = (id: ID) => db.orders.find((o) => o.id === id)?.number ?? '';

  const fail = (msg: string) => {
    setError(msg);
    setBusy(false);
  };

  const submit = () => {
    if (busy) return;
    if (!client) return fail('Выберите клиента');
    if (!state.lines.length) return fail('Добавьте хотя бы один товар');
    setBusy(true);
    const comment = !confirmsSelf && state.fulfillment === 'delivery' ? [state.comment, `Желаемая доставка: ${fmt.date(state.date)}, ${state.interval}`].filter(Boolean).join('. ') : state.comment;

    if (editing) {
      const u = dispatch('order.update', { orderId: editing.id, lines: linesPayload(), comment, pointId: point?.id, fulfillment: state.fulfillment, ...(editing.state === 'draft' && !confirmsSelf ? { state: 'request' as const } : {}) }, me.id);
      if (!u.ok) return fail(u.error);
      if (!confirmsSelf) return finish(editing.id, `Заявка № ${editing.number} отправлена менеджеру`, false);
      const c = dispatch('order.confirm', { orderId: editing.id, override: isOwner && override }, me.id);
      if (!c.ok) return fail(`Изменения сохранены, но заказ не подтверждён: ${c.error}`);
      return finish(editing.id, `Заказ № ${editing.number} подтверждён, товар зарезервирован`, true);
    }

    // менеджер при просрочке или превышении лимита — на согласование владельцу
    if (confirmsSelf && !isOwner && hardProblems.length) {
      const r = dispatch('order.create', { clientId: client.id, pointId: point?.id, lines: linesPayload(), state: 'request', source: orderSource, fulfillment: state.fulfillment, comment: [state.comment, `Желаемая доставка: ${fmt.date(state.date)}, ${state.interval}`].filter(Boolean).join('. '), idempotencyKey: ikRef.current }, me.id);
      if (!r.ok || !r.id) return fail(r.ok ? 'Заказ не создан' : r.error);
      const owner = db.employees.find((e) => e.active && e.roles.includes('owner'));
      if (owner) {
        dispatch('task.create', { title: `Согласовать заказ № ${getOrderNumber(r.id)}: ${hardProblems.map((p) => p.text).join('; ')}`, assigneeId: owner.id, due: today, priority: 'high', link: { type: 'order', id: r.id } }, me.id);
      }
      return finish(r.id, `Заказ № ${getOrderNumber(r.id)} отправлен владельцу на согласование`, false);
    }

    const r = dispatch(
      'order.create',
      {
        clientId: client.id,
        pointId: point?.id,
        lines: linesPayload(),
        state: confirmsSelf ? 'confirmed' : 'request',
        source: orderSource,
        location: 'warehouse',
        fulfillment: state.fulfillment,
        comment,
        idempotencyKey: ikRef.current,
        override: isOwner && override,
      },
      me.id,
    );
    if (!r.ok || !r.id) return fail(r.ok ? 'Заказ не создан' : r.error);
    const n = getOrderNumber(r.id);
    finish(r.id, confirmsSelf ? `Заказ № ${n} подтверждён, товар зарезервирован` : `Заявка № ${n} отправлена менеджеру`, confirmsSelf);
  };

  const saveDraft = () => {
    if (busy) return;
    if (!client) return fail('Выберите клиента');
    if (!state.lines.length) return fail('Добавьте хотя бы один товар — пустой черновик не сохраняется');
    setBusy(true);
    if (editing) {
      const u = dispatch('order.update', { orderId: editing.id, lines: linesPayload(), comment: state.comment, pointId: point?.id, fulfillment: state.fulfillment }, me.id);
      if (!u.ok) return fail(u.error);
      dropDraft(draftKey);
      toast(`Изменения в заказе № ${editing.number} сохранены`);
      onClose();
      return;
    }
    const r = dispatch('order.create', { clientId: client.id, pointId: point?.id, lines: linesPayload(), state: 'draft', source: orderSource, fulfillment: state.fulfillment, comment: state.comment, idempotencyKey: ikRef.current + '-d' }, me.id);
    if (!r.ok || !r.id) return fail(r.ok ? 'Черновик не сохранён' : r.error);
    dropDraft(draftKey);
    toast(`Черновик № ${getOrderNumber(r.id)} сохранён — товар не зарезервирован`);
    onClose();
  };

  const resetDraft = () => {
    dropDraft(draftKey);
    setRestored(null);
    setSavedAt(null);
    touched.current = false;
    setState((s) => ({ ...s, lines: [], comment: '', clientId: clientProp ?? null }));
  };

  /* ---------- шапка ---------- */
  const nextNumber = (db.counters.order ?? db.orders.length) + 1;
  const docWord = confirmsSelf ? 'заказ' : 'заявка';
  const title = editing ? (
    <span className="row-3">
      {editing.state === 'request' ? 'Заявка' : 'Заказ'} № {editing.number}
      <StatusChip s={ORDER_STATE[editing.state]} />
    </span>
  ) : (
    <span className="row-3" style={{ flexWrap: 'wrap' }}>
      {confirmsSelf ? 'Новый заказ' : 'Новая заявка'} № {nextNumber}
      {repeatSource ? <Chip tone="info">Повтор заказа № {repeatSource.number}</Chip> : phone ? null : <Chip>Черновик</Chip>}
    </span>
  );

  const contact = client?.contacts[0];
  const head = client ? (
    <div className="sales-client-line">
      <IconTile tone="info">
        <Store />
      </IconTile>
      <div className="grow">
        <EntityLink type="client" id={client.id} className="sales-client-name entity-link">
          {client.name}
        </EntityLink>
        <div className="muted t-13 ellipsis">{[contact?.name, fmt.phone(contact?.phone ?? client.phone), point?.address].filter(Boolean).join(' · ')}</div>
      </div>
      {balance && balance.maxOverdueDays > 0 ? <StatusChip s={overdueStatus(balance.maxOverdueDays)} size="lg" /> : null}
      {!editing && !repeatOf ? (
        <Button variant="ghost" size="sm" onClick={() => update((s) => ({ ...s, clientId: null, pointId: null }))}>
          Сменить
        </Button>
      ) : null}
    </div>
  ) : undefined;

  const shipDate = state.fulfillment === 'delivery' ? state.date : today;
  const dueLabel = client && client.deferDays > 0 ? fmt.date(fmt.addDays(shipDate, client.deferDays)) : 'При получении';

  const dateOptions = useMemo(() => {
    const out: { value: string; label: string }[] = [];
    let d = today;
    for (let i = 0; i < 7; i++) {
      d = i === 0 ? today : nextWorkday(d);
      const rel = fmt.relDate(d, today);
      out.push({ value: d, label: rel === fmt.date(d) ? `${fmt.date(d)}, ${fmt.weekday(d, true)}` : `${capitalize(rel)}, ${fmt.date(d)}` });
    }
    return out;
  }, [today]);

  /* ---------- главная кнопка ---------- */
  const needsAck = !!preview && preview.changes.length > 0 && !repeatAck;
  const shortBlocks = confirmsSelf && calc.shortRows.length > 0;
  const toApproval = !editing && confirmsSelf && !isOwner && hardProblems.length > 0;
  const ownerNeedsOverride = confirmsSelf && isOwner && problems.length > 0 && !override;
  const minBlocks = confirmsSelf && !isOwner && !!minProblem && !toApproval;
  const editBlocked = !!editing && confirmsSelf && !isOwner && hardProblems.length > 0;
  const mainDisabled = !client || !state.lines.length || needsAck || shortBlocks || ownerNeedsOverride || minBlocks || editBlocked;
  const mainLabel = !confirmsSelf ? 'Отправить заявку' : toApproval ? 'Отправить на согласование' : 'Подтвердить и зарезервировать';
  const mainTitle = needsAck
    ? 'Сначала отметьте, что изменения проверены'
    : shortBlocks
      ? 'Не хватает товара на складе'
      : ownerNeedsOverride
        ? 'Отметьте подтверждение сверх условий'
        : minBlocks
          ? 'Сумма меньше минимального заказа'
          : editBlocked
            ? 'Подтвердить сверх условий может только владелец'
            : undefined;

  const discountLine = discountFor ? calc.rows.find((r) => r.l.key === discountFor) : undefined;

  return (
    <Drawer
      wide
      title={title}
      head={head}
      onClose={onClose}
      actions={
        client ? (
          <TopMenu
            items={[
              { label: 'Карточка клиента', icon: <Store />, onClick: () => openEntity('client', client.id) },
              { label: 'Очистить и начать заново', icon: <Trash2 />, danger: true, onClick: resetDraft, hidden: !!editing || !!repeatOf },
            ]}
          />
        ) : undefined
      }
      footer={
        <div className={cx('sales-editor-foot', phone && 'is-phone')}>
          {savedAt ? (
            <span className="sales-saved">
              <CircleCheck />
              Черновик сохранён в {savedAt}
            </span>
          ) : (
            <span className="sales-saved is-idle">
              <Clock />
              Черновик сохранится сам
            </span>
          )}
          <span className="spacer" />
          <Button onClick={saveDraft} disabled={!client || busy}>
            Сохранить черновик
          </Button>
          <Button variant="primary" icon={confirmsSelf && !toApproval ? <PackageCheck /> : <Send />} onClick={submit} disabled={mainDisabled} loading={busy} title={mainTitle} size={phone ? 'lg' : 'md'}>
            {mainLabel}
          </Button>
        </div>
      }
    >
      <div className={cx('sales-editor', phone && 'is-phone')}>
        {!client ? (
          <ClientPicker
            clients={scoped.clients}
            onPick={(c) => update((s) => ({ ...s, clientId: c.id, pointId: c.points[0]?.id ?? null }))}
          />
        ) : (
          <>
            {restored ? (
              <Notice
                tone="info"
                action={
                  <Button size="sm" variant="ghost" onClick={resetDraft}>
                    Начать заново
                  </Button>
                }
              >
                Восстановлен черновик от {restored}
              </Notice>
            ) : null}

            {preview && repeatSource ? <RepeatChanges preview={preview} source={repeatSource} ack={repeatAck} onAck={setRepeatAck} /> : null}

            {balance ? <ConditionsStrip client={client} balance={balance} dueLabel={dueLabel} /> : null}

            {problems.length ? (
              <Notice
                tone={hardProblems.length ? 'bad' : 'warn'}
                title={hardProblems.length ? 'Заказ сверх условий клиента' : 'Меньше минимального заказа'}
                action={
                  isOwner && confirmsSelf ? (
                    <Checkbox checked={override} onChange={setOverride}>
                      Подтверждаю сверх условий
                    </Checkbox>
                  ) : undefined
                }
              >
                {capitalize(problems.map((p) => p.text).join('; '))}.{' '}
                {!confirmsSelf
                  ? 'Заявку можно отправить — решение примет менеджер.'
                  : isOwner
                    ? 'Вы можете подтвердить заказ под свою ответственность.'
                    : hardProblems.length
                      ? 'Подтвердить сверх условий может только владелец — заказ уйдёт ему на согласование, резерв не создаётся.'
                      : `Добавьте товара ещё на ${fmt.money(client.minOrder - calc.total)}.`}
              </Notice>
            ) : null}

            {calc.shortRows.length ? (
              <Notice tone="warn" title="Не хватает товара на складе">
                {calc.shortRows.map((r) => `${productName(r.p)}: доступно ${fmt.qty(r.available)}, нужно ${fmt.qty(r.qty)}`).join('; ')}.{' '}
                {confirmsSelf ? 'Уменьшите количество или уберите строку — резерв на недостающее не создаётся.' : 'Менеджер увидит нехватку при подтверждении.'}
              </Notice>
            ) : null}

            {calc.rows.length ? (
              phone ? (
                <div className="sales-line-cards">
                  {calc.rows.map((r) => (
                    <div key={r.l.key} className={cx('sales-line-card', flash === r.l.key && 'sales-flash')}>
                      <div className="row" style={{ alignItems: 'flex-start' }}>
                        <div className="grow">
                          <div className="w-600 t-14">{productName(r.p)}</div>
                          <div className="muted t-12">{r.p?.sku}</div>
                        </div>
                        <Button variant="ghost" iconOnly size="sm" aria-label="Убрать строку" onClick={() => removeLine(r.l.key)}>
                          <X />
                        </Button>
                      </div>
                      <div className="row" style={{ gap: 10 }}>
                        <PackSelect product={r.p} value={r.l.pack} onChange={(pack) => setLine(r.l.key, { pack })} />
                        <QtyInput value={r.l.packQty} min={1} onChange={(v) => setLine(r.l.key, { packQty: v })} />
                      </div>
                      <div className="row t-13">
                        <span className="grow">
                          <span className="sales-eq">
                            = <b>{fmt.qty(r.qty)}</b>
                          </span>
                          <span className={cx(r.short ? 'c-bad w-600' : 'muted')}> · доступно {fmt.qty(r.available)}</span>
                        </span>
                        <DiscountChip promoPct={r.promoPct} manualPct={r.l.discountPct} />
                        <PriceCell price={r.price} base={r.base} />
                        <span className="w-700 num">{fmt.money(r.sum)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="sales-lines-wrap">
                  <table className="table sales-lines">
                    <thead>
                      <tr>
                        <th>Товар и упаковка</th>
                        <th>Упаковок</th>
                        <th>Штук</th>
                        <th className="num">Доступно</th>
                        <th className="num">Цена</th>
                        <th>Скидка</th>
                        <th className="num">Сумма</th>
                        <th aria-label="Убрать" />
                      </tr>
                    </thead>
                    <tbody>
                      {calc.rows.map((r) => (
                        <tr key={r.l.key} className={cx(flash === r.l.key && 'sales-flash')}>
                          <td>
                            <div className="cell-title sales-line-name" title={r.p?.name}>
                              {productName(r.p)}
                            </div>
                            <div className="cell-sub row" style={{ gap: 4 }}>
                              <span>{r.p?.sku}</span>
                              <span>·</span>
                              <PackSelect product={r.p} value={r.l.pack} onChange={(pack) => setLine(r.l.key, { pack })} inline />
                            </div>
                          </td>
                          <td>
                            <QtyInput value={r.l.packQty} min={1} onChange={(v) => setLine(r.l.key, { packQty: v })} ariaLabel="Сколько упаковок" />
                          </td>
                          <td className="sales-eq">
                            = <b>{fmt.qty(r.qty)}</b>
                          </td>
                          <td className="num">
                            {r.short ? (
                              <span className="sales-short">
                                <span className="c-bad w-700">{fmt.qty(r.available)}</span>
                                {confirmsSelf && r.available >= r.packSize ? (
                                  <button type="button" className="link-button t-12" onClick={() => setLine(r.l.key, { packQty: Math.floor(r.available / r.packSize) })}>
                                    взять {Math.floor(r.available / r.packSize)}
                                  </button>
                                ) : (
                                  <span className="t-12 c-bad">не хватает {fmt.num(r.qty - r.available)}</span>
                                )}
                              </span>
                            ) : (
                              <span className="muted">{fmt.qty(r.available)}</span>
                            )}
                          </td>
                          <td className="num">
                            <PriceCell price={r.price} base={r.base} />
                          </td>
                          <td>
                            {discountLimit > 0 ? (
                              <button type="button" className="sales-disc-btn" onClick={() => setDiscountFor(r.l.key)} title={r.l.discountReason ? `Основание: ${r.l.discountReason}` : 'Ручная скидка'}>
                                <DiscountChip promoPct={r.promoPct} manualPct={r.l.discountPct} />
                              </button>
                            ) : (
                              <DiscountChip promoPct={r.promoPct} manualPct={r.l.discountPct} />
                            )}
                          </td>
                          <td className="num w-700">{fmt.money(r.sum)}</td>
                          <td>
                            <Button variant="ghost" iconOnly size="sm" aria-label="Убрать строку" onClick={() => removeLine(r.l.key)}>
                              <X />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              <div className="sales-lines-empty">
                <EmptyState icon={<ScanBarcode />} title="Добавьте товары">
                  Отсканируйте штрихкод, найдите по названию или возьмите из прошлых заказов
                </EmptyState>
              </div>
            )}

            <div className={cx('sales-add-line', phone && 'is-phone')}>
              <ProductSearch priceType={client.priceType} onPick={(pid, pack) => addProduct(pid, pack)} autoFocus={!phone && !state.lines.length} />
              <Button icon={<History />} onClick={() => setHistoryOpen(true)} size={phone ? 'lg' : 'md'}>
                Из прошлых заказов
              </Button>
            </div>

            <div className={cx('sales-ord-bottom', phone && 'is-phone')}>
              <div className="sales-form-grid">
                <Field label="Получение">
                  <Segmented
                    value={state.fulfillment}
                    onChange={(v) => update((s) => ({ ...s, fulfillment: v }))}
                    options={[
                      { value: 'delivery', label: 'Доставка' },
                      { value: 'pickup', label: 'Самовывоз' },
                    ]}
                  />
                </Field>
                {client.points.length > 1 ? (
                  <Field label="Точка клиента">
                    <Select value={point?.id ?? ''} onChange={(e) => update((s) => ({ ...s, pointId: e.target.value }))} options={client.points.map((p) => ({ value: p.id, label: `${p.name}, ${p.address}` }))} />
                  </Field>
                ) : (
                  <Field label="Точка клиента">
                    <div className="sales-static ellipsis" title={point ? `${point.name}, ${point.address}` : undefined}>
                      {point ? `${point.name}, ${point.address}` : 'Адрес не указан'}
                    </div>
                  </Field>
                )}
                {state.fulfillment === 'delivery' ? (
                  <>
                    <Field label="Дата доставки">
                      <Select value={state.date} onChange={(e) => update((s) => ({ ...s, date: e.target.value }))} options={dateOptions} />
                    </Field>
                    <Field label="Интервал">
                      <Select value={state.interval} onChange={(e) => update((s) => ({ ...s, interval: e.target.value }))} options={INTERVALS.map((v) => ({ value: v, label: v }))} />
                    </Field>
                  </>
                ) : null}
                <Field label="Комментарий для склада" className="sales-span-2">
                  <Input value={state.comment} onChange={(e) => update((s) => ({ ...s, comment: e.target.value }))} placeholder="Например: коробки не кантовать, позвонить за час" />
                </Field>
              </div>
              <div className="sales-totals">
                <StatList>
                  <StatRow label="Позиций" value={`${fmt.num(calc.rows.length)} · ${fmt.qty(calc.pieces)}`} />
                  <StatRow label="Без скидок" value={fmt.money(calc.gross)} />
                  <StatRow label="Скидки" value={calc.discount > 0 ? `−${fmt.money(calc.discount)}` : fmt.money(0)} />
                  {client.minOrder > 0 ? <StatRow label="Минимальный заказ" value={<span className={cx(minProblem && 'c-warn')}>{fmt.money(client.minOrder)}</span>} /> : null}
                </StatList>
                <div className="sales-total-big">
                  <span>Итого</span>
                  <span className="num">{fmt.money(calc.total)}</span>
                </div>
                {client.creditLimit > 0 && balance ? <LimitBar limit={client.creditLimit} used={balance.debt + balance.openOrders} current={calc.total} /> : null}
              </div>
            </div>

            {!confirmsSelf ? (
              <div className="sales-rep-note">
                <Info />
                Товар закрепится, когда менеджер подтвердит заявку
              </div>
            ) : null}

            {error ? (
              <div ref={errorRef}>
                <Notice tone="bad" title={`Не получилось оформить ${docWord}`}>
                  {error}
                </Notice>
              </div>
            ) : null}
          </>
        )}
      </div>

      {discountLine ? (
        <DiscountModal
          productName={productName(discountLine.p)}
          base={discountLine.base}
          promoPrice={discountLine.promoPrice}
          limit={discountLimit}
          pct={discountLine.l.discountPct}
          reason={discountLine.l.discountReason}
          onClose={() => setDiscountFor(null)}
          onSave={(pct, reason) => {
            setLine(discountLine.l.key, { discountPct: pct, discountReason: pct > 0 ? reason : null });
            setDiscountFor(null);
          }}
        />
      ) : null}
      {historyOpen && client ? (
        <HistoryPicker
          clientId={client.id}
          priceType={client.priceType}
          onClose={() => setHistoryOpen(false)}
          onAdd={(items) => {
            for (const it of items) addProduct(it.productId, it.pack, it.packQty);
            setHistoryOpen(false);
            toast(`Добавлено строк: ${items.length}`);
          }}
        />
      ) : null}
    </Drawer>
  );
}

/** Выбор упаковки строки: «шт / упак. 6 шт / коробка 12 шт». */
function PackSelect({ product, value, onChange, inline }: { product: Product | undefined; value: PackKey; onChange: (v: PackKey) => void; inline?: boolean }) {
  if (!product) return null;
  if (product.packs.length < 2) return <span className="sales-pack-static">{product.packs[0]?.name ?? 'шт'}</span>;
  return (
    <select className={cx(inline ? 'sales-pack-inline' : 'select select-sm sales-pack-select')} value={value} onChange={(e) => onChange(e.target.value as PackKey)} aria-label="Упаковка" onClick={(e) => e.stopPropagation()}>
      {product.packs.map((pk) => (
        <option key={pk.key} value={pk.key}>
          {pk.name}
        </option>
      ))}
    </select>
  );
}

/** Выбор клиента среди своих. */
function ClientPicker({ clients, onPick }: { clients: Client[]; onPick: (c: Client) => void }) {
  const db = useDB();
  const version = useDBVersion();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const active = clients.filter((c) => c.active);
    const withBal = active.map((c) => ({ c, b: clientBalance(db, c.id) }));
    withBal.sort((a, b) => (b.b.lastOrderAt ?? '').localeCompare(a.b.lastOrderAt ?? ''));
    if (!q.trim()) return withBal.slice(0, 40);
    const tokens = norm(q.trim()).split(/\s+/);
    return withBal
      .filter(({ c }) => {
        const t = norm([c.name, c.phone, c.inn ?? '', ...c.points.map((p) => p.name + ' ' + p.address), ...c.contacts.map((x) => x.name + ' ' + x.phone)].join(' '));
        return tokens.every((tok) => t.includes(tok));
      })
      .slice(0, 40);
  }, [clients, q, db, version]);
  return (
    <div className="col-3">
      <div className="t-16 w-700">Для кого заказ</div>
      <SearchInput value={q} onChange={setQ} placeholder="Название, телефон, ИНН или адрес точки" autoFocus size="lg" />
      <div className="card sales-picker">
        {list.length ? (
          list.map(({ c, b }) => (
            <button key={c.id} type="button" className="list-row" onClick={() => onPick(c)}>
              <IconTile>
                <Store />
              </IconTile>
              <div className="grow">
                <div className="w-600 ellipsis">{c.name}</div>
                <div className="muted t-12 ellipsis">
                  {[c.points[0]?.address, c.priceType === 'wholesale' ? 'опт' : 'розница', b.lastOrderAt ? `последний заказ ${fmt.relDate(b.lastOrderAt, db.meta.today)}` : null].filter(Boolean).join(' · ')}
                </div>
              </div>
              {b.maxOverdueDays > 0 ? <StatusChip s={overdueStatus(b.maxOverdueDays)} /> : b.debt > 0 ? <span className="t-12 muted num">долг {fmt.money(b.debt)}</span> : <Dash />}
            </button>
          ))
        ) : (
          <EmptyState title="Клиент не найден">Проверьте название или телефон</EmptyState>
        )}
      </div>
    </div>
  );
}
