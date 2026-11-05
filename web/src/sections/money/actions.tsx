/* Окна раздела «Деньги»: расход, выплата поставщику, перемещение, возврат, опознание платежа. */
import { useMemo, useState } from 'react';
import { ArrowLeftRight, BadgeCheck, Banknote, Check, HandCoins, Lightbulb, Receipt, Truck, Undo2, Wallet } from 'lucide-react';
import type { AccountKey, ID, ISODate } from '../../data/types';
import { ACCOUNT_NAMES, EXPENSE_CATEGORIES } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { accountBalances, clientBalances, courierCash, indexes, orderPayment, purchaseAccepted, supplierBalance, supplierBalances } from '../../data/selectors';
import { plusDays } from '../../data/dates';
import { EntityLink } from '../../shell/entities';
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
  StatList,
  StatRow,
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
import { AccountField, AllocationTable, ClientPicker, ClientSummary, DateField, MethodField, MiniStat, useMethodAccount } from './parts';

/** Откуда платят поставщику и расходы: касса магазина или счёт. Деньги у курьеров так не тратят — их сдают в кассу. */
const PAY_FROM: AccountKey[] = ['shop_cash', 'bank'];

/* ---------- какое окно открыто ---------- */

export type MoneyModal =
  | { kind: 'accept'; clientId?: ID; orderId?: ID }
  | { kind: 'expense'; category?: string }
  | { kind: 'supplier'; supplierId?: ID; amount?: number }
  | { kind: 'transfer'; from?: AccountKey; to?: AccountKey }
  | { kind: 'refund'; clientId?: ID }
  | { kind: 'identify'; paymentId: ID }
  | { kind: 'act'; clientId: ID }
  | { kind: 'payment'; paymentId: ID }
  | { kind: 'confirm'; paymentId: ID }
  | { kind: 'handin'; courierId: ID }
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
      return <SupplierPayModal supplierId={modal.supplierId} amount={modal.amount} onClose={onClose} />;
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
    case 'confirm':
      return <ConfirmTransferModal paymentId={modal.paymentId} onClose={onClose} />;
    case 'handin':
      return <CourierHandInModal courierId={modal.courierId} onClose={onClose} />;
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
  const db = useDB();
  const run = useRun();
  const today = db.meta.today;
  const [category, setCategory] = useState<string>(initial ?? '');
  const [amount, setAmount] = useState<number | ''>('');
  const [date, setDate] = useState<ISODate>(today);
  const ma = useMethodAccount('transfer');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = () => {
    if (busy) return;
    if (!category) return setError('Выберите категорию расхода');
    if (!amount) return setError('Укажите сумму');
    setBusy(true);
    const r = run(
      'payment.expense',
      { category, amount, method: ma.method, account: ma.account, comment: comment.trim() || undefined, date },
      date === today ? `Расход ${fmt.money(amount)} записан` : `Расход ${fmt.money(amount)} записан датой ${fmt.date(date)}`,
    );
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
        <AccountField value={ma.account} onChange={ma.setAccount} label="Откуда" only={PAY_FROM} />
      </div>
      <div className="grid-2">
        <DateField value={date} onChange={setDate} min={plusDays(today, -62)} max={today} />
        <span />
      </div>
      <Field label="Комментарий">
        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например, аренда склада за ноябрь" />
      </Field>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

/* ---------- выплата поставщику ---------- */

export function SupplierPayModal({ supplierId: initial, amount: initialAmount, onClose }: { supplierId?: ID; amount?: number; onClose: () => void }) {
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
    if (initialAmount) return initialAmount;
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
        <AccountField value={ma.account} onChange={ma.setAccount} label="Откуда" only={PAY_FROM} />
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
    setError(null);
    if (a === to) setTo(ACCOUNT_KEYS.find((x) => x !== a)!);
  };
  const over = !!amount && amount > bal[from];
  const submit = () => {
    if (busy) return;
    if (!amount) return setError('Укажите сумму');
    if (over) return;
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
          <Button variant="primary" onClick={submit} loading={busy} disabled={!amount || over}>
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
        <MoneyInput
          size="lg"
          value={amount}
          onChange={(x) => {
            setAmount(x);
            setError(null);
          }}
          autoFocus
          placeholder="0"
        />
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
      {/* одна причина — одно сообщение: нехватку видно сразу, ошибку операции — только если она другая */}
      {over ? (
        <Notice tone="bad">
          {ACCOUNT_NAMES[from]}: {fmt.money(bal[from])} — переместить {fmt.money(amount || 0)} нельзя, уменьшите сумму
        </Notice>
      ) : error ? (
        <Notice tone="bad">{error}</Notice>
      ) : null}
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

const innOf = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '');

interface Hint {
  key: string;
  clientId: ID;
  orderId: ID | null;
  title: string;
  why: string;
  amount: number;
}

/** Подсказки, чей платёж: сначала клиент с тем же ИНН, что в выписке, затем заказы, долг по которым ровно равен сумме. */
function identifyHints(db: ReturnType<typeof useDB>, payer: { name: string; inn: string } | null | undefined, amount: number, allowed: Set<ID>): Hint[] {
  const ix = indexes(db);
  const out: Hint[] = [];
  const inn = innOf(payer?.inn);
  const bal = clientBalances(db);
  if (inn) {
    for (const c of db.clients) {
      if (!allowed.has(c.id) || innOf(c.inn) !== inn) continue;
      out.push({ key: 'inn:' + c.id, clientId: c.id, orderId: null, title: c.name, why: `Тот же ИНН ${inn}`, amount: bal.get(c.id)?.debt ?? 0 });
    }
  }
  const seen = new Set(out.map((h) => h.clientId));
  const exact: Hint[] = [];
  for (const o of db.orders) {
    if (o.state === 'cancelled' || o.state === 'draft' || o.state === 'request' || !allowed.has(o.clientId)) continue;
    const op = orderPayment(db, o);
    const free = Math.max(0, op.due - op.pending);
    if (free !== amount) continue;
    const c = ix.clients.get(o.clientId);
    if (!c) continue;
    exact.push({ key: 'order:' + o.id, clientId: c.id, orderId: o.id, title: c.name, why: `Заказ № ${o.number}: к оплате ровно ${fmt.money(free)}`, amount: free });
  }
  exact.sort((a, b) => Number(seen.has(b.clientId)) - Number(seen.has(a.clientId)));
  return [...out, ...exact].slice(0, 5);
}

export function IdentifyModal({ paymentId, onClose }: { paymentId: ID; onClose: () => void }) {
  const db = useDB();
  const v = useDBVersion();
  const run = useRun();
  const scoped = useScoped();
  const pay = useMemo(() => db.payments.find((p) => p.id === paymentId), [db, v, paymentId]);
  const [clientId, setClientId] = useState<ID | null>(null);
  const [preferOrder, setPreferOrder] = useState<ID | null>(null);
  const [manual, setManual] = useState<Record<ID, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (clientId ? openOrdersOf(db, clientId) : []), [db, v, clientId]);
  const hints = useMemo(() => (pay ? identifyHints(db, pay.payer, pay.amount, new Set(scoped.clients.map((c) => c.id))) : []), [db, v, pay, scoped.clients]);
  if (!pay) return null;
  const split = manual ?? autoSplit(rows, pay.amount, preferOrder);
  const allocated = rows.reduce((s, r) => s + (split[r.order.id] ?? 0), 0);
  const pick = (id: ID, orderId: ID | null = null) => {
    setClientId(id);
    setPreferOrder(orderId);
    setManual(null);
    setError(null);
  };
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
        <div className="grow money-payer">
          <span className="t-12 muted">Плательщик по выписке банка</span>
          {pay.payer ? (
            <span className="t-14 w-700">
              {pay.payer.name}
              <span className="money-payer-inn">ИНН {pay.payer.inn}</span>
            </span>
          ) : (
            <span className="t-14 w-600 muted">Не указан</span>
          )}
          <span className="t-12 ink-2">Назначение: {clean(pay.comment) || 'нет'}</span>
        </div>
      </div>
      {!clientId ? (
        <>
          {hints.length ? (
            <div className="money-hints">
              <span className="money-hints-head">
                <Lightbulb />
                Похоже, это
              </span>
              {hints.map((h) => (
                <button key={h.key} type="button" className="list-row money-pick-row money-hint" onClick={() => pick(h.clientId, h.orderId)}>
                  <span className="grow">
                    <span className="w-600 ellipsis" style={{ display: 'block' }}>
                      {h.title}
                    </span>
                    <span className="t-12 ink-2">{h.why}</span>
                  </span>
                  <span className="num w-600 nowrap" title={h.orderId ? 'К оплате по заказу' : 'Долг клиента'}>
                    {h.amount ? fmt.money(h.amount) : <span className="faint">Без долга</span>}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          <ClientPicker clients={scoped.clients} onPick={(id) => pick(id)} autoFocus={!hints.length} placeholder="Чей платёж: название, ИНН из выписки, телефон" />
        </>
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

/* ---------- подтвердить перевод по выписке ---------- */

/** Перед подтверждением видно, что именно сверить с выпиской: дату, сумму, плательщика и заказы, к которым относится перевод. */
export function ConfirmTransferModal({ paymentId, onClose }: { paymentId: ID; onClose: () => void }) {
  const db = useDB();
  const v = useDBVersion();
  const run = useRun();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const data = useMemo(() => {
    const p = db.payments.find((x) => x.id === paymentId);
    if (!p) return null;
    const ix = indexes(db);
    const lines = p.allocations
      .filter((a) => a.orderId)
      .map((a) => {
        const o = ix.orders.get(a.orderId!);
        return { id: a.orderId!, number: o?.number ?? 0, amount: a.amount, due: o?.dueDate ?? null };
      });
    const allocated = lines.reduce((z, x) => z + x.amount, 0);
    return { p, client: p.clientId ? ix.clients.get(p.clientId) : undefined, author: ix.employees.get(p.authorId), lines, advance: p.amount - allocated };
  }, [db, v, paymentId]);
  if (!data) return null;
  const { p, client, author, lines, advance } = data;
  const submit = () => {
    if (busy) return;
    setBusy(true);
    const r = run('payment.confirm', { paymentId }, `Перевод ${fmt.money(p.amount)} подтверждён по выписке`);
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onClose();
  };
  return (
    <Modal
      title="Подтвердить перевод"
      sub="Сверьте с выпиской банка: дату, сумму и плательщика"
      icon={<IconTile tone="ok">
        <BadgeCheck />
      </IconTile>}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" icon={<BadgeCheck />} onClick={submit} loading={busy} disabled={p.status !== 'pending'}>
            Подтвердить {fmt.money(p.amount)}
          </Button>
        </>
      }
    >
      <StatList>
        <StatRow label="Дата перевода" value={fmt.dateTime(p.at)} />
        <StatRow label="Сумма" value={<span className="t-16 w-700">{fmt.money(p.amount)}</span>} />
        <StatRow
          label="Плательщик"
          value={
            client ? (
              <EntityLink type="client" id={client.id}>
                {client.name}
              </EntityLink>
            ) : (
              '—'
            )
          }
        />
        {client?.inn ? <StatRow label="ИНН" value={client.inn} /> : null}
        <StatRow label="На счёт" value={ACCOUNT_NAMES[p.account]} />
        <StatRow label="Записал" value={author?.name ?? '—'} />
        {clean(p.comment) ? <StatRow label="Комментарий" value={<span className="money-wrap">{clean(p.comment)}</span>} /> : null}
      </StatList>
      <div className="col" style={{ gap: 8 }}>
        <span className="t-14 w-700">К чему относится</span>
        <StatList>
          {lines.map((l) => (
            <StatRow
              key={l.id}
              label={
                <span className="row" style={{ gap: 6 }}>
                  <EntityLink type="order" id={l.id}>
                    Заказ № {l.number}
                  </EntityLink>
                  {l.due ? <span className="t-12 muted">срок {fmt.date(l.due)}</span> : null}
                </span>
              }
              value={fmt.money(l.amount)}
            />
          ))}
          {advance > 0 ? <StatRow label={lines.length ? 'Сверх заказов — аванс' : 'Аванс без заказа'} value={fmt.money(advance)} /> : null}
          <StatRow label="Долг клиента уменьшится на" value={fmt.money(p.amount)} total />
        </StatList>
      </div>
      {p.status !== 'pending' ? <Notice tone="info">Перевод уже подтверждён</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

/* ---------- принять деньги у курьера ---------- */

/** Сдача наличных курьером: пересчитали меньше — недостача записывается на курьера с объяснением. */
export function CourierHandInModal({ courierId, onClose }: { courierId: ID; onClose: () => void }) {
  const db = useDB();
  const v = useDBVersion();
  const run = useRun();
  const today = db.meta.today;
  const data = useMemo(() => {
    const ix = indexes(db);
    const list = db.deliveries
      .filter((d) => d.courierId === courierId && d.collectedMethod === 'cash' && d.collected > 0 && !d.handedIn)
      .sort((a, b) => a.date.localeCompare(b.date) || a.number - b.number)
      .map((d) => ({ d, client: ix.clients.get(d.clientId)?.name ?? '—', order: ix.orders.get(d.orderId)?.number ?? 0 }));
    return { courier: ix.employees.get(courierId), list, onHand: courierCash(db, courierId).onHand };
  }, [db, v, courierId]);
  const sum = data.list.reduce((z, x) => z + x.d.collected, 0);
  const [counted, setCounted] = useState<number | ''>(sum);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const c = counted === '' ? 0 : counted;
  const shortage = sum - c;
  const name = data.courier?.name ?? 'Курьер';
  const submit = () => {
    if (busy) return;
    if (c > sum) return setError(`Пересчитано больше, чем курьер получил по доставкам (${fmt.money(sum)}). Проверьте сумму`);
    if (shortage > 0 && !comment.trim()) return setError('Недостача: напишите, что сказал курьер');
    setBusy(true);
    const r = run(
      'courier.handIn',
      { courierId, counted: c, comment: comment.trim() || undefined },
      // подробности — сумма и недостача — добавит сама операция
      `Деньги у курьера ${data.courier?.short ?? name}`,
    );
    setBusy(false);
    if (!r.ok) return setError(r.error);
    onClose();
  };
  return (
    <Modal
      title="Принять деньги у курьера"
      sub={name}
      icon={<IconTile>
        <Wallet />
      </IconTile>}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" icon={<HandCoins />} onClick={submit} loading={busy} disabled={!sum || c > sum}>
            {`Принять ${fmt.money(c)}`}
          </Button>
        </>
      }
    >
      {data.list.length ? (
        <>
          <div className="money-client">
            <MiniStat label="По доставкам" value={fmt.money(sum)} />
            <MiniStat label="Доставок" value={fmt.num(data.list.length)} />
            <MiniStat label="На руках с" value={fmt.relDate(data.list[0].d.date, today)} />
          </div>
          <StatList>
            {data.list.slice(0, 6).map(({ d, client, order }) => (
              <StatRow
                key={d.id}
                label={
                  <span className="row" style={{ gap: 6, minWidth: 0 }}>
                    <span className="nowrap muted">{fmt.relDate(d.date, today)}</span>
                    <EntityLink type="order" id={d.orderId}>
                      № {order}
                    </EntityLink>
                    <span className="ellipsis">{client}</span>
                  </span>
                }
                value={fmt.money(d.collected)}
              />
            ))}
            {data.list.length > 6 ? <StatRow label={`Ещё ${fmt.count(data.list.length - 6, 'доставка', 'доставки', 'доставок')}`} value={fmt.money(data.list.slice(6).reduce((z, x) => z + x.d.collected, 0))} /> : null}
          </StatList>
          <div className="grid-2">
            <Field label="Пересчитано">
              <MoneyInput
                size="lg"
                value={counted}
                onChange={(x) => {
                  setCounted(x);
                  setError(null);
                }}
                autoFocus
                placeholder="0"
              />
            </Field>
            <Field label="Недостача">
              <div className={cx('money-shortage t-16 w-700 num', shortage > 0 && 'c-bad')}>{shortage > 0 ? fmt.money(shortage) : 'Нет'}</div>
            </Field>
          </div>
          {shortage > 0 ? (
            <Field label="Что сказал курьер">
              <Input value={comment} onChange={(e) => { setComment(e.target.value); setError(null); }} placeholder="Например, клиент недоплатил 200 ₽, обещал доплатить" />
            </Field>
          ) : null}
          {shortage > 0 ? <Notice tone="warn">Недостача {fmt.money(shortage)} запишется расходом «Недостача» на курьера</Notice> : null}
        </>
      ) : (
        <EmptyState title="Курьеру нечего сдавать">Все наличные по доставкам уже в кассе</EmptyState>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}
