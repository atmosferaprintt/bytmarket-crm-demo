import { useEffect, useMemo, useRef, useState } from 'react';
import { Wallet } from 'lucide-react';
import type { ID, ISODate } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { useScoped } from '../../roles/scope';
import { Button, Checkbox, Field, IconTile, Input, Modal, MoneyInput, Notice, fmt } from '../../ui';
import { autoSplit, newIdemKey, openOrdersOf, useRun } from './lib';
import { AccountField, AllocationTable, ClientPicker, ClientSummary, DateField, MethodField, useMethodAccount } from './parts';
import './money.css';

export interface AcceptPaymentProps {
  /** клиент; если не задан — выбрать в окне */
  clientId?: ID;
  /** заказ, на который в первую очередь разнести оплату */
  orderId?: ID;
  onClose: () => void;
  onDone?: (paymentId: ID) => void;
}

/** Принять оплату от покупателя: сумма, способ, касса/счёт, распределение по заказам (самые старые долги первыми), аванс. Общий: Деньги, карточка заказа, карточка клиента. */
export function AcceptPaymentModal({ clientId: initialClient, orderId, onClose, onDone }: AcceptPaymentProps) {
  const db = useDB();
  const v = useDBVersion();
  const scoped = useScoped();
  const run = useRun();
  const today = db.meta.today;

  const [clientId, setClientId] = useState<ID | null>(initialClient ?? null);
  const [amount, setAmount] = useState<number | ''>('');
  const { method, setMethod, account, setAccount } = useMethodAccount('transfer');
  const [date, setDate] = useState<ISODate>(today);
  const [manual, setManual] = useState<Record<ID, number> | null>(null);
  const [pending, setPending] = useState(false);
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const key = useRef(newIdemKey('pay'));

  const rows = useMemo(() => (clientId ? openOrdersOf(db, clientId) : []), [db, v, clientId]);
  const freeDebt = rows.reduce((s, r) => s + r.debtFree, 0);
  const overdueFree = useMemo(
    () => rows.filter((r) => r.order.dueDate && r.order.dueDate < today).reduce((s, r) => s + r.debtFree, 0),
    [rows, today],
  );
  const preferred = orderId ? rows.find((r) => r.order.id === orderId) : undefined;

  // сумма по умолчанию: выбранный заказ, иначе пусто
  const filled = useRef(false);
  useEffect(() => {
    if (filled.current || !clientId) return;
    filled.current = true;
    if (preferred) setAmount(preferred.free);
  }, [clientId, preferred]);

  const sum = amount === '' ? 0 : amount;
  const split = manual ?? autoSplit(rows, sum, orderId);
  const allocated = rows.reduce((s, r) => s + (split[r.order.id] ?? 0), 0);
  const advance = sum - allocated;

  const pick = (id: ID) => {
    setClientId(id);
    setManual(null);
    setAmount('');
    setError(null);
    filled.current = false;
  };

  const submit = () => {
    if (busy) return;
    setError(null);
    if (!clientId) return setError('Выберите покупателя');
    if (!sum) return setError('Укажите сумму оплаты');
    if (advance < 0) return setError('Распределено больше суммы оплаты — уменьшите строки');
    setBusy(true);
    const allocations = rows.filter((r) => (split[r.order.id] ?? 0) > 0).map((r) => ({ orderId: r.order.id, amount: split[r.order.id] }));
    const note = [date !== today ? `Оплата от ${fmt.date(date)}` : '', comment.trim()].filter(Boolean).join('. ');
    const r = run(
      'payment.client',
      {
        clientId,
        amount: sum,
        method,
        account,
        allocations,
        status: pending ? 'pending' : 'posted',
        comment: note || undefined,
        idempotencyKey: key.current,
      },
      pending ? `Перевод ${fmt.money(sum)} записан` : `Оплата ${fmt.money(sum)} принята`,
    );
    setBusy(false);
    if (!r.ok) return setError(r.error);
    if (r.id) onDone?.(r.id);
    onClose();
  };

  const quick: { label: string; value: number }[] = [];
  if (preferred) quick.push({ label: `По заказу № ${preferred.order.number}`, value: preferred.free });
  if (overdueFree > 0 && overdueFree !== freeDebt) quick.push({ label: 'Просроченное', value: overdueFree });
  if (freeDebt > 0) quick.push({ label: 'Весь долг', value: freeDebt });

  return (
    <Modal
      title="Принять оплату"
      icon={<IconTile tone="ok">
        <Wallet />
      </IconTile>}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} loading={busy} disabled={!clientId || !sum || advance < 0}>
            {sum ? `Принять ${fmt.money(sum)}` : 'Принять оплату'}
          </Button>
        </>
      }
    >
      {!clientId ? (
        <ClientPicker clients={scoped.clients} onPick={pick} />
      ) : (
        <>
          <ClientSummary clientId={clientId} onChange={initialClient ? undefined : () => setClientId(null)} />
          <div className="money-form-grid">
            <Field label="Сумма">
              <MoneyInput size="lg" value={amount} autoFocus onChange={(x) => setAmount(x)} placeholder="0" />
            </Field>
            <MethodField
              value={method}
              onChange={(m) => {
                setMethod(m);
                if (m !== 'transfer') setPending(false);
              }}
            />
            <AccountField value={account} onChange={setAccount} showBalance={false} />
            <DateField value={date} onChange={setDate} min={db.meta.startDate} max={today} />
          </div>
          {quick.length ? (
            <div className="row" style={{ flexWrap: 'wrap', marginTop: -6 }}>
              {quick.map((q) => (
                <Button key={q.label} size="sm" variant={sum === q.value ? 'dark' : 'secondary'} onClick={() => setAmount(q.value)}>
                  {q.label} · {fmt.money(q.value)}
                </Button>
              ))}
            </div>
          ) : null}
          <AllocationTable
            rows={rows}
            values={split}
            amount={sum}
            today={today}
            manual={manual !== null}
            onReset={() => setManual(null)}
            onChange={(id, x) => setManual({ ...split, [id]: x })}
          />
          {method === 'transfer' ? (
            <div className="col" style={{ gap: 6 }}>
              <Checkbox checked={pending} onChange={setPending}>
                Клиент прислал скриншот перевода — ждём подтверждения банка
              </Checkbox>
              {pending ? <Notice tone="warn">Долг уменьшится, когда бухгалтер подтвердит перевод по выписке банка.</Notice> : null}
            </div>
          ) : null}
          <Field label="Комментарий">
            <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например, платёжное поручение № 245" />
          </Field>
        </>
      )}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}
