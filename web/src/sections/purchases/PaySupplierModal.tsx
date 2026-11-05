/* Оплата поставщику: сумма, способ, откуда платим. Без закупки — гасим самые ранние долги. */
import { useState } from 'react';
import type { AccountKey, ID, PayMethod } from '../../data/types';
import { ACCOUNT_NAMES } from '../../data/types';
import { useDB } from '../../data/store';
import { accountBalances, indexes, supplierBalance } from '../../data/selectors';
import { get } from '../../data/idx';
import { useSession } from '../../roles/session';
import { Button, Field, Input, Modal, MoneyInput, Notice, Segmented, StatList, StatRow, fmt, toast } from '../../ui';
import { act } from '../stock/act';
import { purchaseRowOf } from './calc';

const defaultAccount = (m: PayMethod): AccountKey => (m === 'cash' ? 'shop_cash' : 'bank');

export function PaySupplierModal({ supplierId, purchaseId, onClose }: { supplierId: ID; purchaseId?: ID; onClose: () => void }) {
  const db = useDB();
  const { me } = useSession();
  const s = indexes(db).suppliers.get(supplierId);
  const bal = supplierBalance(db, supplierId);
  const row = purchaseId ? purchaseRowOf(db, purchaseId) : undefined;
  const pu = purchaseId ? get(db, 'purchases', purchaseId) : undefined;
  const suggested = row ? row.debt : bal.overdue || bal.upcoming[0]?.amount || bal.debt;
  const [amount, setAmount] = useState<number | ''>(suggested || '');
  const [method, setMethod] = useState<PayMethod>('transfer');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const account = defaultAccount(method);
  const money = accountBalances(db)[account];
  const limit = row ? row.debt : bal.debt;

  const submit = () => {
    setError(null);
    if (!amount) return setError('Укажите сумму');
    if (row && amount > row.debt) return setError(`По закупке № ${pu?.number} к оплате ${fmt.money(row.debt)}`);
    const r = act(
      'payment.supplier',
      {
        supplierId,
        amount,
        method,
        account,
        ...(purchaseId ? { allocations: [{ purchaseId, amount }] } : {}),
        comment: comment.trim() || undefined,
      },
      me.id,
    );
    if (!r.ok) return setError(r.error);
    toast(`Оплачено ${fmt.money(amount)} — ${s?.name ?? 'поставщику'}`);
    onClose();
  };

  return (
    <Modal
      title={pu ? `Оплата по закупке № ${pu.number}` : 'Оплата поставщику'}
      sub={s?.name}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} disabled={!amount}>
            Оплатить {amount ? fmt.money(amount) : ''}
          </Button>
        </>
      }
    >
      <StatList>
        {row ? <StatRow label="По закупке к оплате" value={fmt.money(row.debt)} /> : null}
        <StatRow label="Долг поставщику всего" value={fmt.money(bal.debt)} />
        {bal.overdue ? <StatRow label="Из него просрочено" value={<span className="c-bad">{fmt.money(bal.overdue)}</span>} /> : null}
        {!row && bal.upcoming[0] ? <StatRow label="Ближайший платёж" value={`${fmt.money(bal.upcoming[0].amount)} до ${fmt.date(bal.upcoming[0].dueDate)}`} /> : null}
      </StatList>
      <div className="grid-2">
        <Field label="Сумма" error={amount && amount > limit ? `Больше долга на ${fmt.money(Number(amount) - limit)} — остаток уйдёт авансом` : undefined}>
          <MoneyInput value={amount} onChange={setAmount} autoFocus />
        </Field>
        <Field label="Способ">
          <Segmented
            value={method}
            onChange={setMethod}
            options={[
              { value: 'transfer', label: 'Перевод' },
              { value: 'cash', label: 'Наличные' },
              { value: 'card', label: 'Карта' },
            ]}
          />
        </Field>
      </div>
      <div className="t-13 ink-2">
        Списываем: <b>{ACCOUNT_NAMES[account]}</b>, сейчас {fmt.money(money)}
      </div>
      {!row ? <div className="t-13 muted">Сумма закроет закупки по порядку: сначала просроченные, потом ближайшие</div> : null}
      <Field label="Комментарий">
        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Платёжное поручение № 214" />
      </Field>
      {amount && amount > money ? <Notice tone="warn">{ACCOUNT_NAMES[account]}: {fmt.money(money)} — не хватает {fmt.money(Number(amount) - money)}</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}
