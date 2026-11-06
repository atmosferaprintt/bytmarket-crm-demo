import { useMemo, useRef, useState } from 'react';
import type { ID, PayMethod, ReturnReason } from '../../data/types';
import { PAY_METHOD_NAMES, RETURN_REASONS } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { indexes, orderPayment, orderReturns } from './data';
import { useSession } from '../../roles/session';
import { Button, Field, Input, Modal, Notice, QtyInput, Segmented, Select, StatList, StatRow, cx, fmt, toast } from '../../ui';
import { fixNo, productName } from './lib';
import './sales.css';

export interface ReturnModalProps {
  orderId: ID;
  onClose: () => void;
  onDone?: (returnId: ID) => void;
}

interface Row {
  productId: ID;
  shipped: number;
  returned: number;
  max: number;
  price: number;
}

const REASON_OPTIONS = (Object.keys(RETURN_REASONS) as ReturnReason[]).filter((k) => k !== 'delivery_failed').map((k) => ({ value: k, label: RETURN_REASONS[k] }));

/** Возврат по оптовому заказу: строки, причины из списка, товар в карантин, деньги — вернуть или оставить переплатой. */
export function ReturnModal({ orderId, onClose, onDone }: ReturnModalProps) {
  const db = useDB();
  const version = useDBVersion();
  const { me } = useSession();
  const idx = indexes(db);
  const o = idx.orders.get(orderId) ?? db.orders.find((x) => x.id === orderId);

  const rows = useMemo<Row[]>(() => {
    if (!o) return [];
    const back = orderReturns(db).get(o.id)?.byProduct ?? new Map<ID, number>();
    const m = new Map<ID, Row>();
    for (const l of o.lines) {
      const r = m.get(l.productId);
      if (r) r.shipped += l.shipped;
      else m.set(l.productId, { productId: l.productId, shipped: l.shipped, returned: 0, max: 0, price: l.price });
    }
    for (const r of m.values()) {
      r.returned = back.get(r.productId) ?? 0;
      r.max = Math.max(0, r.shipped - r.returned);
    }
    return [...m.values()].filter((r) => r.shipped > 0);
  }, [db, version, o?.id]);

  const [qty, setQty] = useState<Record<ID, number>>({});
  const [reason, setReason] = useState<Record<ID, ReturnReason>>({});
  const [money, setMoney] = useState<'refund' | 'keep'>('keep');
  const [method, setMethod] = useState<PayMethod>('transfer');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sent = useRef(false);

  if (!o)
    return (
      <Modal title="Возврат по заказу" onClose={onClose}>
        <Notice tone="warn">Заказ не найден</Notice>
      </Modal>
    );

  const picked = rows.filter((r) => (qty[r.productId] ?? 0) > 0);
  const anyReturned = rows.some((r) => r.returned > 0);
  const amount = picked.reduce((s, r) => s + (qty[r.productId] ?? 0) * r.price, 0);
  const pieces = picked.reduce((s, r) => s + (qty[r.productId] ?? 0), 0);
  const pay = orderPayment(db, o);
  // сколько окажется переплачено после возврата: оплачено больше, чем останется к оплате
  const overAfter = Math.max(0, pay.paid - Math.max(0, pay.amount - amount));
  const refundable = Math.min(amount, overAfter);
  const client = idx.clients.get(o.clientId);

  const submit = () => {
    if (busy || sent.current) return;
    if (!picked.length) {
      setError('Укажите, сколько штук возвращают');
      return;
    }
    setBusy(true);
    const r = dispatch(
      'return.create',
      {
        orderId: o.id,
        lines: picked.map((x) => ({ productId: x.productId, qty: qty[x.productId] ?? 0, reason: reason[x.productId] ?? 'not_fit' })),
        refund: refundable > 0 && money === 'refund',
        method,
        comment: comment.trim() || undefined,
      },
      me.id,
    );
    setBusy(false);
    if (!r.ok) {
      setError(fixNo(r.error));
      return;
    }
    sent.current = true;
    toast(r.info ? fixNo(r.info) : 'Возврат оформлен, товар на проверке');
    if (r.id) onDone?.(r.id);
    onClose();
  };

  return (
    <Modal
      wide
      title={`Возврат по заказу № ${o.number}`}
      sub={client?.name}
      onClose={onClose}
      footer={
        <>
          <span className="t-13 muted grow">{picked.length ? `${fmt.count(pieces, 'штука', 'штуки', 'штук')} на ${fmt.money(amount)}` : 'Ничего не выбрано'}</span>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} disabled={!picked.length} loading={busy}>
            Оформить возврат
          </Button>
        </>
      }
    >
      {rows.length ? (
        <div className="sales-modal-table">
          <table className="table table-dense sales-return-table" data-hint="sales.ret-lines">
            <thead>
              <tr>
                <th>Товар</th>
                <th className="num">Отгружено</th>
                {anyReturned ? <th className="num">Уже вернули</th> : null}
                <th>Возвращают, шт</th>
                <th>Причина</th>
                <th className="num">Сумма</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const q = qty[r.productId] ?? 0;
                return (
                  <tr key={r.productId} className={cx(q > 0 && 'is-selected', r.max === 0 && 'sales-row-off')}>
                    <td>
                      <div className="cell-title sales-line-name">{productName(idx.products.get(r.productId))}</div>
                      <div className="cell-sub">{fmt.price(r.price)} за шт</div>
                    </td>
                    <td className="num">{fmt.qty(r.shipped)}</td>
                    {anyReturned ? <td className="num muted">{r.returned ? fmt.qty(r.returned) : '—'}</td> : null}
                    <td>
                      {r.max > 0 ? (
                        <span className="row nowrap" style={{ gap: 6 }}>
                          <QtyInput value={q} min={0} max={r.max} onChange={(v) => { setError(null); setQty((s) => ({ ...s, [r.productId]: v })); }} ariaLabel="Сколько возвращают" />
                          <button type="button" className="link-button t-12" onClick={() => setQty((s) => ({ ...s, [r.productId]: r.max }))}>
                            все {r.max}
                          </button>
                        </span>
                      ) : (
                        <span className="muted t-12">всё вернули</span>
                      )}
                    </td>
                    <td>
                      {r.max > 0 && q > 0 ? (
                        <Select size="sm" value={reason[r.productId] ?? 'not_fit'} onChange={(e) => setReason((s) => ({ ...s, [r.productId]: e.target.value as ReturnReason }))} options={REASON_OPTIONS} aria-label="Причина возврата" />
                      ) : (
                        <span className="faint">—</span>
                      )}
                    </td>
                    <td className="num w-700">{q ? fmt.money(q * r.price) : <span className="faint">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Notice tone="warn">По заказу ещё ничего не отгружено — возвращать нечего. Если клиент передумал, отмените заказ.</Notice>
      )}

      {picked.length ? (
        <>
          <Notice tone="warn" title="Товар уйдёт на проверку">
            Он не попадёт в продажу, пока склад не решит: вернуть на полку или списать.
          </Notice>
          {refundable > 0 ? (
            <div className="col-3" data-hint="sales.ret-money">
              <Field label={`Клиент уже заплатил — переплата после возврата ${fmt.money(refundable)}`}>
                <Segmented
                  value={money}
                  onChange={setMoney}
                  options={[
                    { value: 'refund', label: 'Вернуть деньги' },
                    { value: 'keep', label: 'Оставить переплатой' },
                  ]}
                />
              </Field>
              {money === 'refund' ? (
                <Field label="Как вернуть">
                  <Segmented value={method} onChange={setMethod} options={(['transfer', 'cash', 'card'] as PayMethod[]).map((m) => ({ value: m, label: PAY_METHOD_NAMES[m] }))} />
                </Field>
              ) : null}
            </div>
          ) : null}
          <StatList>
            <StatRow label="Сумма возврата" value={fmt.money(amount)} />
            {refundable > 0 && money === 'refund' ? <StatRow label={`Вернём клиенту (${PAY_METHOD_NAMES[method].toLowerCase()})`} value={fmt.money(refundable)} /> : null}
            {refundable > 0 && money === 'keep' ? <StatRow label="Останется авансом клиента" value={fmt.money(refundable)} /> : null}
            {amount - refundable > 0 ? <StatRow label="Долг клиента уменьшится на" value={fmt.money(amount - refundable)} /> : null}
          </StatList>
        </>
      ) : null}

      <Field label="Комментарий">
        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: коробка помята при доставке" />
      </Field>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}
