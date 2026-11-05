/* Окна раздела «Деньги»: расход, выплата поставщику, перемещение, возврат, опознание платежа. */
import { useMemo, useState } from 'react';
import { ArrowLeftRight, Banknote, Check, HandCoins, Receipt, Truck, Undo2 } from 'lucide-react';
import type { AccountKey, ID } from '../../data/types';
import { ACCOUNT_NAMES, EXPENSE_CATEGORIES } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { accountBalances, clientBalances, indexes, orderPayment, purchaseAccepted, supplierBalance, supplierBalances } from '../../data/selectors';
import { useScoped } from '../../roles/scope';
import {
  Button,
  Chip,
  EmptyState,
  Field,
  IconTile,
  Input,
  Modal,
  MoneyInput,
  Notice,
  Select,
  StatusChip,
  cx,
  fmt,
  overdueStatus,
  type MenuItem,
} from '../../ui';
import { AcceptPaymentModal } from './AcceptPaymentModal';
import { ReconciliationModal } from './Reconciliation';
import { PaymentDrawer } from './PaymentDrawer';
import { ACCOUNT_KEYS, autoSplit, clean, clientPayInfo, openOrdersOf, useMoneyPerms, useRun, weekEnd } from './lib';
export { useConfirmPayment, useMoneyPerms } from './lib';
import { AccountField, AllocationTable, ClientPicker, ClientSummary, MethodField, MiniStat, useMethodAccount } from './parts';

/* ---------- какое окно открыто ---------- */

export type MoneyModal =
  | { kind: 'accept'; clientId?: ID; orderId?: ID }
  | { kind: 'expense'; category?: string }
  | { kind: 'supplier'; supplierId?: ID }
  | { kind: 'transfer'; from?: AccountKey; to?: AccountKey }
  | { kind: 'refund'; clientId?: ID }
  | { kind: 'identify'; paymentId: ID }
  | { kind: 'act'; clientId: ID }
  | { kind: 'payment'; paymentId: ID }
  | null;

export type SetModal = (m: MoneyModal) => void;

export function MoneyModalHost({ modal, onClose, onOpen }: { modal: MoneyModal; onClose: () => void; onOpen: SetModal }) {
  if (!modal) return null;
  switch (modal.kind) {
    case 'accept':
      return <AcceptPaymentModal clientId={modal.clientId} orderId={modal.orderId} onClose={onClose} />;
    case 'expense':
      return <ExpenseModal category={modal.category} onClose={onClose} />;
    case 'supplier':
      return <SupplierPayModal supplierId={modal.supplierId} onClose={onClose} />;
    case 'transfer':
      return <TransferModal from={modal.from} to={modal.to} onClose={onClose} />;
    case 'refund':
      return <RefundModal clientId={modal.clientId} onClose={onClose} />;
    case 'identify':
      return <IdentifyModal paymentId={modal.paymentId} onClose={onClose} />;
    case 'act':
      return <ReconciliationModal clientId={modal.clientId} onClose={onClose} />;
    case 'payment':
      return <PaymentDrawer paymentId={modal.paymentId} onClose={onClose} onOpen={onOpen} />;
  }
}

/** Второстепенные действия для меню «⋯» в шапке. */
export function useMoneyMenu(open: SetModal, skip: NonNullable<MoneyModal>['kind'][] = []): MenuItem[] {
  const p = useMoneyPerms();
  const all: (MenuItem & { k: NonNullable<MoneyModal>['kind'] })[] = [
    { k: 'accept', label: 'Принять оплату', icon: <HandCoins />, onClick: () => open({ kind: 'accept' }), hidden: !p.accept },
    { k: 'expense', label: 'Записать расход', icon: <Receipt />, onClick: () => open({ kind: 'expense' }), hidden: !p.expense },
    { k: 'supplier', label: 'Выплата поставщику', icon: <Truck />, onClick: () => open({ kind: 'supplier' }), hidden: !p.supplier },
    { k: 'transfer', label: 'Перемещение денег', icon: <ArrowLeftRight />, onClick: () => open({ kind: 'transfer' }), hidden: !p.transfer },
    { k: 'refund', label: 'Возврат денег покупателю', icon: <Undo2 />, onClick: () => open({ kind: 'refund' }), hidden: !p.refund },
  ];
  return all.filter((i) => !skip.includes(i.k)).map(({ k, ...rest }) => rest);
}

/* ---------- расход ---------- */

export function ExpenseModal({ category: initial, onClose }: { category?: string; onClose: () => void }) {
  const run = useRun();
  const [category, setCategory] = useState<string>(initial ?? '');
  const [amount, setAmount] = useState<number | ''>('');
  const ma = useMethodAccount('transfer');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (busy) return;
    if (!category) return setError('Выберите категорию расхода');
    if (!amount) return setError('Укажите сумму');
    setBusy(true);
    const r = run('payment.expense', { category, amount, method: ma.method, account: ma.account, comment: comment.trim() || undefined }, `Расход ${fmt.money(amount)} записан`);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onClose();
  };
  return (
    <Modal
      title="Записать расход"
      icon={<IconTile>
        <Receipt />
      </IconTile>}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!category || !amount}>
            {amount ? `Записать расход ${fmt.money(amount)}` : 'Записать расход'}
          </Button>
        </>
      }
    >
      <div className="grid-2">
        <Field label="Категория">
          <Select value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Выберите" options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))} />
        </Field>
        <Field label="Сумма">
          <MoneyInput value={amount} onChange={setAmount} autoFocus placeholder="0" />
        </Field>
      </div>
      <div className="grid-2">
        <MethodField value={ma.method} onChange={ma.setMethod} />
        <AccountField value={ma.account} onChange={ma.setAccount} label="Откуда" />
      </div>
      <Field label="Комментарий">
        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например, аренда склада за ноябрь" />
      </Field>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

/* ---------- выплата поставщику ---------- */

export function SupplierPayModal({ supplierId: initial, onClose }: { supplierId?: ID; onClose: () => void }) {
  const db = useDB();
  const v = useDBVersion();
  const run = useRun();
  const today = db.meta.today;
  const suppliers = useMemo(() => {
    const b = supplierBalances(db);
    return [...db.suppliers].sort((x, y) => (b.get(y.id)?.debt ?? 0) - (b.get(x.id)?.debt ?? 0));
  }, [db, v]);
  const [supplierId, setSupplierId] = useState<ID>(initial ?? suppliers[0]?.id ?? '');
  const bal = useMemo(() => supplierBalance(db, supplierId), [db, v, supplierId]);
  const purchases = useMemo(() => {
    const ix = new Map(db.purchases.map((p) => [p.id, p]));
    return bal.upcoming.map((u) => ({ ...u, p: ix.get(u.purchaseId)!, accepted: purchaseAccepted(db, u.purchaseId) })).filter((x) => x.p);
  }, [db, v, bal]);
  const thisWeek = purchases.filter((x) => x.dueDate <= weekEnd(today)).reduce((s, x) => s + x.amount, 0);
  const [amount, setAmount] = useState<number | ''>(() => {
    const b = supplierBalance(db, initial ?? suppliers[0]?.id ?? '');
    const w = b.upcoming.filter((u) => u.dueDate <= weekEnd(today)).reduce((s, u) => s + u.amount, 0);
    return w || b.debt || '';
  });
  const ma = useMethodAccount('transfer');
  const [manual, setManual] = useState<Record<ID, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sum = amount === '' ? 0 : amount;

  const split = useMemo(() => {
    if (manual) return manual;
    const out: Record<ID, number> = {};
    let left = sum;
    for (const x of purchases) {
      if (left <= 0) break;
      const q = Math.min(left, x.amount);
      out[x.purchaseId] = q;
      left -= q;
    }
    return out;
  }, [manual, purchases, sum]);
  const allocated = purchases.reduce((s, x) => s + (split[x.purchaseId] ?? 0), 0);
  const balances = useMemo(() => accountBalances(db), [db, v]);

  const changeSupplier = (id: ID) => {
    setSupplierId(id);
    setManual(null);
    const b = supplierBalance(db, id);
    const w = b.upcoming.filter((u) => u.dueDate <= weekEnd(today)).reduce((s, u) => s + u.amount, 0);
    setAmount(w || b.debt || '');
  };

  const submit = () => {
    if (busy) return;
    if (!supplierId) return setError('Выберите поставщика');
    if (!sum) return setError('Укажите сумму');
    if (allocated > sum) return setError('Распределено больше суммы платежа');
    setBusy(true);
    const allocations = purchases.filter((x) => (split[x.purchaseId] ?? 0) > 0).map((x) => ({ purchaseId: x.purchaseId, amount: split[x.purchaseId] }));
    const s = db.suppliers.find((x) => x.id === supplierId);
    const r = run('payment.supplier', { supplierId, amount: sum, method: ma.method, account: ma.account, allocations }, `Оплачено ${s?.name ?? 'поставщику'}: ${fmt.money(sum)}`);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onClose();
  };

  return (
    <Modal
      title="Выплата поставщику"
      icon={<IconTile>
        <Truck />
      </IconTile>}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!sum || allocated > sum}>
            {sum ? `Оплатить ${fmt.money(sum)}` : 'Оплатить'}
          </Button>
        </>
      }
    >
      <div className="money-client">
        <Field label="Поставщик" className="grow">
          <Select
            value={supplierId}
            onChange={(e) => changeSupplier(e.target.value)}
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
        </Field>
        <MiniStat label="Долг" value={fmt.money(bal.debt)} />
        <MiniStat label="Просрочено" value={<span className={bal.overdue > 0 ? 'c-bad' : undefined}>{fmt.money(bal.overdue)}</span>} />
        <MiniStat label="До конца недели" value={fmt.money(thisWeek)} />
      </div>
      <div className="money-form-grid is-3">
        <Field label="Сумма">
          <MoneyInput size="lg" value={amount} onChange={(x) => setAmount(x)} placeholder="0" />
        </Field>
        <MethodField value={ma.method} onChange={ma.setMethod} />
        <AccountField value={ma.account} onChange={ma.setAccount} label="Откуда" />
      </div>
      {sum > balances[ma.account] ? (
        <Notice tone="warn">
          {ACCOUNT_NAMES[ma.account]}: {fmt.money(balances[ma.account])} — не хватает {fmt.money(sum - balances[ma.account])}
        </Notice>
      ) : null}
      <div className="money-alloc">
        <div className="row" style={{ marginBottom: 8 }}>
          <span className="t-14 w-700 grow">Закупки к оплате</span>
          {manual ? (
            <button type="button" className="link-button t-12" onClick={() => setManual(null)}>
              Распределить по сроку оплаты
            </button>
          ) : purchases.length ? (
            <span className="t-12 muted">Ранние сроки первыми · можно поправить</span>
          ) : null}
        </div>
        <div className="money-alloc-box">
          {purchases.length ? (
            <table className="table table-dense">
              <thead>
                <tr>
                  <th>Закупка</th>
                  <th>Срок оплаты</th>
                  <th className="num">Принято</th>
                  <th className="num">Осталось</th>
                  <th className="num" style={{ width: 150 }}>
                    Оплатить
                  </th>
                </tr>
              </thead>
              <tbody>
                {purchases.map((x) => {
                  const val = split[x.purchaseId] ?? 0;
                  const od = x.dueDate < today ? fmt.daysBetween(x.dueDate, today) : 0;
                  return (
                    <tr key={x.purchaseId} className={cx(val > 0 && 'money-alloc-on')}>
                      <td>
                        <span className="w-600">№ {x.p.number}</span>
                        <span className="muted t-12"> · {x.p.receivedAt ? `принята ${fmt.date(x.p.receivedAt)}` : `от ${fmt.date(x.p.createdAt)}`}</span>
                      </td>
                      <td>
                        <span className="row" style={{ gap: 6 }}>
                          {fmt.date(x.dueDate)}
                          {od > 0 ? <StatusChip s={overdueStatus(od)} /> : null}
                        </span>
                      </td>
                      <td className="num">{fmt.money(x.accepted)}</td>
                      <td className="num">{fmt.money(x.amount)}</td>
                      <td className="num">
                        <div className="money-alloc-input">
                          <MoneyInput size="sm" value={val || ''} placeholder="0" onChange={(n) => setManual({ ...split, [x.purchaseId]: Math.min(Number(n || 0), x.amount) })} />
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon btn-sm"
                            title="Оплатить полностью"
                            aria-label={`Оплатить закупку № ${x.p.number} полностью`}
                            onClick={() => setManual({ ...split, [x.purchaseId]: val >= x.amount ? 0 : x.amount })}
                          >
                            <Check />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3}>Итого</td>
                  <td className="num">{fmt.money(bal.debt)}</td>
                  <td className="num">{fmt.money(allocated)}</td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <EmptyState title="Долгов перед поставщиком нет">Платёж запишется авансом поставщику</EmptyState>
          )}
        </div>
        {sum > allocated && purchases.length ? (
          <div className="money-alloc-left">
            <Chip tone="info">Аванс {fmt.money(sum - allocated)}</Chip>
            <span className="t-13 ink-2">Сверх закупок — аванс поставщику</span>
          </div>
        ) : null}
      </div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

/* ---------- перемещение денег ---------- */

export function TransferModal({ from: f, to: t, onClose }: { from?: AccountKey; to?: AccountKey; onClose: () => void }) {
  const db = useDB();
  const v = useDBVersion();
  const run = useRun();
  const [from, setFrom] = useState<AccountKey>(f ?? 'shop_cash');
  const [to, setTo] = useState<AccountKey>(t ?? (f === 'bank' ? 'shop_cash' : 'bank'));
  const bal = useMemo(() => accountBalances(db), [db, v]);
  const [amount, setAmount] = useState<number | ''>('');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const isCollection = from === 'shop_cash' && to === 'bank';
  const changeFrom = (a: AccountKey) => {
    setFrom(a);
    if (a === to) setTo(ACCOUNT_KEYS.find((x) => x !== a)!);
  };
  const submit = () => {
    if (busy) return;
    if (!amount) return setError('Укажите сумму');
    setBusy(true);
    const r = run(
      'payment.transfer',
      { from, to, amount, comment: comment.trim() || (isCollection ? 'Инкассация' : undefined) },
      isCollection ? `Инкассация ${fmt.money(amount)} записана` : `Перемещено ${fmt.money(amount)}`,
    );
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onClose();
  };
  return (
    <Modal
      title="Перемещение денег"
      sub="Инкассация из кассы на счёт, выдача размена, сдача денег"
      icon={<IconTile>
        <ArrowLeftRight />
      </IconTile>}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!amount}>
            {amount ? `Переместить ${fmt.money(amount)}` : 'Переместить'}
          </Button>
        </>
      }
    >
      <div className="grid-2">
        <AccountField value={from} onChange={changeFrom} label="Откуда" />
        <AccountField value={to} onChange={setTo} label="Куда" exclude={from} />
      </div>
      <Field label="Сумма">
        <MoneyInput size="lg" value={amount} onChange={setAmount} autoFocus placeholder="0" />
      </Field>
      {bal[from] > 0 ? (
        <div className="row" style={{ marginTop: -6 }}>
          <Button size="sm" variant={amount === bal[from] ? 'dark' : 'secondary'} onClick={() => setAmount(bal[from])}>
            Всё · {fmt.money(bal[from])}
          </Button>
          {from === 'shop_cash' && bal[from] > 5000 ? (
            <Button size="sm" variant={amount === bal[from] - 5000 ? 'dark' : 'secondary'} onClick={() => setAmount(bal[from] - 5000)}>
              Оставить размен 5 000 ₽ · {fmt.money(bal[from] - 5000)}
            </Button>
          ) : null}
        </div>
      ) : null}
      <Field label="Комментарий">
        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={isCollection ? 'Инкассация' : 'Например, размен в кассу'} />
      </Field>
      {amount && amount > bal[from] ? (
        <Notice tone="warn">
          {ACCOUNT_NAMES[from]}: {fmt.money(bal[from])} — столько переместить нельзя
        </Notice>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

/* ---------- возврат денег покупателю ---------- */

export function RefundModal({ clientId: initial, onClose }: { clientId?: ID; onClose: () => void }) {
  const db = useDB();
  const v = useDBVersion();
  const run = useRun();
  const scoped = useScoped();
  const [clientId, setClientId] = useState<ID | null>(initial ?? null);
  const candidates = useMemo(() => {
    const info = clientPayInfo(db);
    const bal = clientBalances(db);
    const withOver = new Set<ID>();
    for (const o of db.orders) {
      const op = orderPayment(db, o);
      if (op.paid > op.amount) withOver.add(o.clientId);
    }
    return scoped.clients.filter((c) => ((info.get(c.id)?.unallocated ?? 0) > 0 && (bal.get(c.id)?.advance ?? 0) > 0) || withOver.has(c.id));
  }, [db, v, scoped.clients]);
  const sources = useMemo(() => {
    if (!clientId) return [];
    const out: { value: string; label: string; max: number; orderId?: ID }[] = [];
    const adv = Math.min(clientPayInfo(db).get(clientId)?.unallocated ?? 0, clientBalances(db).get(clientId)?.advance ?? 0);
    if (adv > 0) out.push({ value: 'advance', label: `Аванс без заказа · ${fmt.money(adv)}`, max: adv });
    for (const o of db.orders) {
      if (o.clientId !== clientId) continue;
      const op = orderPayment(db, o);
      const over = op.paid - op.amount;
      if (over > 0) out.push({ value: o.id, label: `Переплата по заказу № ${o.number} · ${fmt.money(over)}`, max: over, orderId: o.id });
    }
    return out;
  }, [db, v, clientId]);
  const [source, setSource] = useState<string>('');
  const src = sources.find((s) => s.value === source) ?? sources[0];
  const [amount, setAmount] = useState<number | ''>('');
  const ma = useMethodAccount('cash');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sum = amount === '' ? (src?.max ?? 0) : amount;

  const submit = () => {
    if (busy || !clientId || !src) return;
    if (!sum) return setError('Укажите сумму');
    if (sum > src.max) return setError(`Вернуть можно не больше ${fmt.money(src.max)}`);
    setBusy(true);
    const r = run(
      'payment.refund',
      { clientId, amount: sum, method: ma.method, account: ma.account, orderId: src.orderId, comment: comment.trim() || undefined },
      `Возврат ${fmt.money(sum)} записан`,
    );
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onClose();
  };

  return (
    <Modal
      title="Возврат денег покупателю"
      icon={<IconTile>
        <Undo2 />
      </IconTile>}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!clientId || !src || !sum}>
            {clientId && src && sum ? `Вернуть ${fmt.money(sum)}` : 'Вернуть деньги'}
          </Button>
        </>
      }
    >
      {!clientId ? (
        candidates.length ? (
          <ClientPicker clients={candidates} onPick={(id) => { setClientId(id); setSource(''); setAmount(''); }} placeholder="Покупатель с авансом или переплатой" />
        ) : (
          <EmptyState title="Возвращать нечего">Ни у кого из покупателей нет аванса или переплаты</EmptyState>
        )
      ) : (
        <>
          <ClientSummary clientId={clientId} onChange={initial ? undefined : () => setClientId(null)} />
          {sources.length ? (
            <>
              <Field label="Что возвращаем">
                <Select value={src?.value ?? ''} onChange={(e) => { setSource(e.target.value); setAmount(''); }} options={sources.map((s) => ({ value: s.value, label: s.label }))} />
              </Field>
              <div className="grid-3">
                <Field label="Сумма">
                  <MoneyInput value={amount === '' ? src?.max ?? '' : amount} onChange={setAmount} />
                </Field>
                <MethodField value={ma.method} onChange={ma.setMethod} />
                <AccountField value={ma.account} onChange={ma.setAccount} label="Откуда" />
              </div>
              <Field label="Комментарий">
                <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например, по заявлению клиента" />
              </Field>
            </>
          ) : (
            <EmptyState title="Возвращать нечего">У покупателя нет аванса или переплаты</EmptyState>
          )}
        </>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

/* ---------- опознать неопознанное поступление ---------- */

export function IdentifyModal({ paymentId, onClose }: { paymentId: ID; onClose: () => void }) {
  const db = useDB();
  const v = useDBVersion();
  const run = useRun();
  const scoped = useScoped();
  const pay = useMemo(() => db.payments.find((p) => p.id === paymentId), [db, v, paymentId]);
  const [clientId, setClientId] = useState<ID | null>(null);
  const [manual, setManual] = useState<Record<ID, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (clientId ? openOrdersOf(db, clientId) : []), [db, v, clientId]);
  if (!pay) return null;
  const split = manual ?? autoSplit(rows, pay.amount);
  const allocated = rows.reduce((s, r) => s + (split[r.order.id] ?? 0), 0);
  const submit = () => {
    if (busy || !clientId) return;
    if (allocated > pay.amount) return setError('Распределено больше суммы платежа');
    setBusy(true);
    const allocations = rows.filter((r) => (split[r.order.id] ?? 0) > 0).map((r) => ({ orderId: r.order.id, amount: split[r.order.id] }));
    const c = indexes(db).clients.get(clientId);
    const r = run('payment.identify', { paymentId, clientId, allocations }, `Поступление разнесено: ${c?.name ?? 'покупатель'}`);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onClose();
  };
  return (
    <Modal
      title={`Опознать поступление № ${pay.number}`}
      icon={<IconTile tone="bad">
        <Banknote />
      </IconTile>}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!clientId || allocated > pay.amount}>
            Разнести {fmt.money(pay.amount)}
          </Button>
        </>
      }
    >
      <div className="money-client">
        <MiniStat label="Сумма" value={fmt.money(pay.amount)} />
        <MiniStat label="Пришло" value={fmt.dateTime(pay.at)} />
        <MiniStat label="Куда" value={ACCOUNT_NAMES[pay.account]} />
        <div className="grow" style={{ minWidth: 0 }}>
          <span className="t-12 muted">Назначение платежа из банка</span>
          <div className="t-13 w-600">{clean(pay.comment) || '—'}</div>
        </div>
      </div>
      {!clientId ? (
        <ClientPicker clients={scoped.clients} onPick={(id) => { setClientId(id); setManual(null); }} placeholder="Чей платёж: название, ИНН из назначения, телефон" />
      ) : (
        <>
          <ClientSummary clientId={clientId} onChange={() => setClientId(null)} />
          <AllocationTable
            rows={rows}
            values={split}
            amount={pay.amount}
            today={db.meta.today}
            manual={manual !== null}
            onReset={() => setManual(null)}
            onChange={(id, x) => setManual({ ...split, [id]: x })}
          />
        </>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

