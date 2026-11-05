import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Printer, Undo2 } from 'lucide-react';
import type { EntityDrawerProps } from '../../shell/entities';
import { EntityLink } from '../../shell/entities';
import type { ID, ReturnReason } from '../../data/types';
import { RETURN_REASONS } from '../../data/types';
import { dispatch, getDB, useDB, useDBVersion } from '../../data/store';
import { indexes, shiftSummary } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { Button, Checkbox, Chip, Drawer, EmptyState, Field, Notice, QtyInput, Segmented, Select, StatList, StatRow, Textarea, cx, fmt, toast } from '../../ui';
import { PAY_KIND_NAMES, SHOP_RETURN_REASONS, cardNumber, fixNo, nbUnits, openShift, packLabel, payKind, refundedByProduct } from './lib';
import { usePrintReceipt } from './Print';
import { PromoStateChip } from '../sales/parts';
import './register.css';

/** Карточка «Чек» в боковой панели. Открывается из любого раздела через ?open=receipt:id; ?refund=1 — сразу возврат. */
export default function EntityDrawer({ id, onClose }: EntityDrawerProps) {
  const db = useDB();
  const version = useDBVersion();
  const { can, me } = useSession();
  const [params, setParams] = useSearchParams();
  const [print, printNode] = usePrintReceipt();
  const r = db.receipts.find((x) => x.id === id);
  const [refunding, setRefunding] = useState(false);

  // ?refund=1 — открыть сразу в режиме возврата
  useEffect(() => {
    if (params.get('refund') === '1') {
      setRefunding(true);
      const next = new URLSearchParams(params);
      next.delete('refund');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const info = useMemo(() => {
    if (!r) return null;
    const ix = indexes(db);
    const refunded = r.kind === 'sale' ? refundedByProduct(db, r.id) : new Map<ID, number>();
    const sold = new Map<ID, number>();
    for (const l of r.lines) sold.set(l.productId, (sold.get(l.productId) ?? 0) + l.qty);
    let left = 0;
    for (const [pid, q] of sold) left += q - (refunded.get(pid) ?? 0);
    const refunds = r.kind === 'sale' ? db.receipts.filter((x) => x.refundOf === r.id) : [];
    const orig = r.refundOf ? db.receipts.find((x) => x.id === r.refundOf) : undefined;
    const ret = r.kind === 'refund' ? db.returns.find((x) => x.receiptId === r.refundOf && x.at === r.at && x.amount === r.total) : undefined;
    const gross = r.lines.reduce((s, l) => s + l.basePrice * l.qty, 0);
    const promo = r.lines.reduce((s, l) => s + (l.promoId ? (l.basePrice - l.price) * l.qty : 0), 0);
    const manual = r.lines.reduce((s, l) => s + (!l.promoId && l.discountPct > 0 ? (l.basePrice - l.price) * l.qty : 0), 0);
    const reasons = [...new Set(r.lines.filter((l) => l.discountPct > 0 && l.discountReason).map((l) => `${fmt.pct(l.discountPct)} · ${l.discountReason}`))];
    const promoById = new Map(db.promos.map((p) => [p.id, p]));
    const promoNames = [...new Set(r.lines.map((l) => (l.promoId ? promoById.get(l.promoId)?.name : null)).filter(Boolean))] as string[];
    const profit = r.lines.every((l) => l.cost !== null) ? r.lines.reduce((s, l) => s + (l.price - (l.cost ?? 0)) * l.qty, 0) : null;
    return {
      seller: ix.employees.get(r.sellerId),
      client: r.clientId ? ix.clients.get(r.clientId) : undefined,
      shift: db.shifts.find((s) => s.id === r.shiftId),
      sold,
      refunded,
      left,
      refunds,
      orig,
      ret,
      gross,
      promo,
      manual,
      reasons,
      promoNames,
      promoById,
      profit,
    };
  }, [db, version, r]);

  if (!r || !info) {
    return (
      <Drawer title="Чек" onClose={onClose}>
        <EmptyState title="Чек не найден">Возможно, ссылка устарела</EmptyState>
      </Drawer>
    );
  }

  const canRefund = can('refundReceipt') && r.kind === 'sale' && info.left > 0;
  const ix = indexes(db);
  const title = r.kind === 'refund' ? `Возврат № ${r.number}` : `Чек № ${r.number}`;

  if (refunding && canRefund) {
    return (
      <>
        <RefundForm receiptId={r.id} onCancel={() => setRefunding(false)} onClose={onClose} meId={me.id} />
        {printNode}
      </>
    );
  }

  return (
    <Drawer
      title={title}
      sub={`${fmt.date(r.at)}, ${fmt.time(r.at)} · ${info.seller?.name ?? '—'} · смена № ${info.shift?.number ?? '—'}`}
      onClose={onClose}
      head={
        <div className="chips">
          {r.kind === 'refund' ? <Chip tone="warn">Возврат</Chip> : <Chip tone="ok">Продажа</Chip>}
          <Chip>{PAY_KIND_NAMES[payKind(r)]}</Chip>
          {info.refunds.length ? <Chip tone="warn">{info.left > 0 ? 'Возвращён частично' : 'Возвращён полностью'}</Chip> : null}
        </div>
      }
      footer={
        <>
          <Button icon={<Printer />} onClick={() => print(r.id)}>
            Печать
          </Button>
          <span className="spacer" />
          {canRefund ? (
            <Button variant="primary" icon={<Undo2 />} onClick={() => setRefunding(true)}>
              Вернуть по чеку
            </Button>
          ) : null}
        </>
      }
    >
      {info.orig ? (
        <Notice tone="info">
          Возврат по чеку{' '}
          <EntityLink type="receipt" id={info.orig.id}>
            № {info.orig.number}
          </EntityLink>{' '}
          от {fmt.date(info.orig.at)}
          {info.ret ? ` · причина: ${[...new Set(info.ret.lines.map((l) => RETURN_REASONS[l.reason]))].join(', ').toLowerCase()}` : ''}
          {info.ret?.comment && !info.ret.comment.startsWith('Возврат по чеку') ? ` · ${fixNo(info.ret.comment)}` : ''}
        </Notice>
      ) : null}

      <section className="card reg-dr-lines reg-noshrink">
        <table className="table table-dense">
          <thead>
            <tr>
              <th>Товар</th>
              <th className="num">Кол-во</th>
              <th className="num">Цена</th>
              <th className="num">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {r.lines.map((l, i) => {
              const p = ix.products.get(l.productId);
              const back = r.kind === 'sale' ? info.refunded.get(l.productId) ?? 0 : 0;
              const promo = l.promoId ? info.promoById.get(l.promoId) : undefined;
              return (
                <tr key={i}>
                  <td>
                    {p ? (
                      <EntityLink type="product" id={p.id}>
                        {nbUnits(p.name)}
                      </EntityLink>
                    ) : (
                      'Товар'
                    )}
                    <div className="cell-sub row" style={{ gap: 6, flexWrap: 'wrap' }}>
                      {p && l.pack !== 'pcs' ? <span>{l.packQty} × {packLabel(p, l.pack)}</span> : null}
                      {promo ? (
                        <>
                          <span>Акция «{promo.name}»</span>
                          <PromoStateChip promo={promo} today={db.meta.today} />
                        </>
                      ) : null}
                      {l.discountPct > 0 ? <Chip>−{fmt.pct(l.discountPct)}</Chip> : null}
                      {back > 0 ? <Chip tone="warn">Вернули {fmt.qty(back)}</Chip> : null}
                    </div>
                  </td>
                  <td className="num">{fmt.qty(l.qty)}</td>
                  <td className="num">
                    {l.basePrice > l.price ? <s className="reg-old">{fmt.price(l.basePrice)}</s> : null} {fmt.price(l.price)}
                  </td>
                  <td className="num w-600">{fmt.money(l.qty * l.price)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="grid-2 reg-noshrink">
        <section className="card card-pad">
          <div className="card-title" style={{ marginBottom: 8 }}>
            Сумма
          </div>
          <StatList>
            {info.gross > r.total ? <StatRow label="Без скидок" value={fmt.money(info.gross)} /> : null}
            {info.promo > 0 ? <StatRow label={info.promoNames.length === 1 ? `Акция «${info.promoNames[0]}»` : 'Акции'} value={`−${fmt.money(info.promo)}`} /> : null}
            {info.manual > 0 ? <StatRow label={info.reasons.length ? `Скидка ${info.reasons.join('; ')}` : 'Ручная скидка'} value={`−${fmt.money(info.manual)}`} /> : null}
            <StatRow total label={r.kind === 'refund' ? 'Возвращено' : 'Итого'} value={fmt.money(r.total)} />
            {info.profit !== null && can('seeProfit') && r.kind === 'sale' ? <StatRow label="Валовая прибыль" value={fmt.money(info.profit)} /> : null}
          </StatList>
        </section>
        <section className="card card-pad">
          <div className="card-title" style={{ marginBottom: 8 }}>
            {r.kind === 'refund' ? 'Деньги вернули' : 'Оплата'}
          </div>
          <StatList>
            {r.cash > 0 ? <StatRow label={r.kind === 'refund' ? 'Наличными' : 'Наличными получено'} value={fmt.money(r.cash)} /> : null}
            {r.card > 0 ? <StatRow label={r.kind === 'refund' ? 'На карту' : 'Картой'} value={fmt.money(r.card)} /> : null}
            {r.change > 0 ? <StatRow label="Сдача" value={fmt.money(r.change)} /> : null}
            <StatRow label="Продавец" value={info.seller?.name ?? '—'} />
            <StatRow label="Смена" value={info.shift ? `№ ${info.shift.number}, ${fmt.date(info.shift.openedAt)}` : '—'} />
            <StatRow
              label="Покупатель"
              value={
                info.client ? (
                  <span title={`Карта ${cardNumber(db, info.client)}`}>
                    <EntityLink type="client" id={info.client.id}>
                      {info.client.name}
                    </EntityLink>
                  </span>
                ) : (
                  'без карты'
                )
              }
            />
          </StatList>
        </section>
      </div>

      {info.refunds.length ? (
        <section className="card reg-noshrink">
          <div className="card-head">
            <h2 className="card-title">Возвраты по этому чеку</h2>
          </div>
          <div className="list">
            {info.refunds.map((x) => (
              <div key={x.id} className="list-row">
                <EntityLink type="receipt" id={x.id}>
                  Возврат № {x.number}
                </EntityLink>
                <span className="muted t-13">
                  {fmt.dateTime(x.at)} · {x.cash > 0 ? 'наличными' : 'на карту'}
                </span>
                <span className="spacer" />
                <span className="w-600 num">−{fmt.money(x.total)}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {printNode}
    </Drawer>
  );
}

/* ---------- возврат по чеку ---------- */

function RefundForm({ receiptId, onCancel, onClose, meId }: { receiptId: ID; onCancel: () => void; onClose: () => void; meId: ID }) {
  const db = useDB();
  const version = useDBVersion();
  const r = db.receipts.find((x) => x.id === receiptId)!;
  const ix = indexes(db);
  const shift = openShift(db);

  const rows = useMemo(() => {
    const refunded = refundedByProduct(db, r.id);
    const byProduct = new Map<ID, { productId: ID; qty: number; price: number }>();
    for (const l of r.lines) {
      const x = byProduct.get(l.productId);
      if (x) x.qty += l.qty;
      else byProduct.set(l.productId, { productId: l.productId, qty: l.qty, price: l.price });
    }
    return [...byProduct.values()].map((x) => ({ ...x, left: x.qty - (refunded.get(x.productId) ?? 0) }));
  }, [db, version, r]);

  const [sel, setSel] = useState<Record<ID, number>>(() => (rows.length === 1 && rows[0].left > 0 ? { [rows[0].productId]: rows[0].left } : {}));
  // причину выбирает продавец: по ней склад решает, что делать с товаром
  const [reason, setReason] = useState<ReturnReason | ''>('');
  const [tried, setTried] = useState(false);
  const [method, setMethod] = useState<'cash' | 'card'>(r.card >= r.total ? 'card' : 'cash');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const amount = rows.reduce((s, x) => s + (sel[x.productId] ?? 0) * x.price, 0);
  const count = Object.values(sel).filter((q) => q > 0).length;
  const cashInDrawer = shift ? shiftSummary(db, shift.id).expectedCash : 0;
  const cardLimit = r.card;
  const methodError =
    method === 'card' && r.card === 0
      ? 'Чек оплачен наличными — вернуть можно только наличными'
      : method === 'card' && amount > cardLimit
        ? `На карту можно вернуть не больше ${fmt.money(cardLimit)} — остальное наличными`
        : method === 'cash' && shift && amount > cashInDrawer
          ? `В кассе ${fmt.money(cashInDrawer)} наличными — не хватает для возврата`
          : null;

  const submit = () => {
    if (busy) return;
    if (!count) {
      setError('Отметьте товары, которые возвращает покупатель');
      return;
    }
    if (!reason) {
      setTried(true);
      setError(null);
      window.setTimeout(() => document.querySelector<HTMLSelectElement>('.reg-refund-reason select')?.focus(), 0);
      return;
    }
    setBusy(true);
    const res = dispatch(
      'receipt.refund',
      {
        receiptId: r.id,
        lines: rows.filter((x) => (sel[x.productId] ?? 0) > 0).map((x) => ({ productId: x.productId, qty: sel[x.productId], reason })),
        method,
        comment: comment.trim() || undefined,
      },
      meId,
    );
    setBusy(false);
    if (!res.ok) {
      setError(fixNo(res.error));
      return;
    }
    // номер возврата — номер чека возврата: тот же, что в карточке, в списке чеков и на печати
    const back = getDB().receipts.find((x) => x.id === res.id);
    toast(
      back
        ? `Возврат № ${back.number}: ${fmt.money(back.total)} ${back.card > 0 ? 'на карту' : 'наличными'}. Товар ушёл на проверку`
        : 'Возврат оформлен. Товар ушёл на проверку',
    );
    onCancel();
  };

  return (
    <Drawer
      title={`Возврат по чеку № ${r.number}`}
      sub={`${fmt.date(r.at)}, ${fmt.time(r.at)} · ${fmt.money(r.total)} · ${PAY_KIND_NAMES[payKind(r)].toLowerCase()}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Назад к чеку
          </Button>
          <span className="spacer" />
          <Button variant="primary" icon={<Undo2 />} onClick={submit} disabled={!shift || !count || !!methodError} loading={busy}>
            {amount > 0 ? `Вернуть ${fmt.money(amount)}` : 'Вернуть'}
          </Button>
        </>
      }
    >
      {!shift ? <Notice tone="warn">Откройте смену — деньги возвращаются из кассы</Notice> : null}

      <section className="card reg-dr-lines reg-noshrink">
        <table className="table table-dense">
          <thead>
            <tr>
              <th style={{ width: 36 }} />
              <th>Товар</th>
              <th className="num">Куплено</th>
              <th className="num">Вернуть</th>
              <th className="num">Сумма</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((x) => {
              const p = ix.products.get(x.productId);
              const q = sel[x.productId] ?? 0;
              const on = q > 0;
              return (
                <tr key={x.productId} className={cx(on && 'is-selected')}>
                  <td>
                    <Checkbox
                      checked={on}
                      disabled={x.left <= 0}
                      onChange={(v) => setSel((s) => ({ ...s, [x.productId]: v ? x.left : 0 }))}
                    />
                  </td>
                  <td>
                    <div className="w-600">{p ? nbUnits(p.name) : 'Товар'}</div>
                    <div className="cell-sub">
                      {fmt.price(x.price)} за шт{x.left < x.qty ? ` · уже вернули ${fmt.qty(x.qty - x.left)}` : ''}
                    </div>
                  </td>
                  <td className="num">{fmt.qty(x.qty)}</td>
                  <td className="num">
                    {x.left > 0 ? (
                      <QtyInput value={q} min={0} max={x.left} onChange={(v) => setSel((s) => ({ ...s, [x.productId]: v }))} ariaLabel={`Вернуть: ${p?.name ?? ''}`} />
                    ) : (
                      <Chip>Возвращено</Chip>
                    )}
                  </td>
                  <td className="num w-600">{on ? fmt.money(q * x.price) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="grid-2 reg-noshrink">
        <Field label="Причина" className="reg-refund-reason" error={tried && !reason ? 'Выберите причину возврата' : undefined}>
          <Select
            value={reason}
            placeholder="Выберите причину"
            onChange={(e) => setReason(e.target.value as ReturnReason | '')}
            options={SHOP_RETURN_REASONS.map((k) => ({ value: k, label: RETURN_REASONS[k] }))}
          />
        </Field>
        <Field label="Деньги вернуть" error={methodError ?? undefined}>
          <Segmented<'cash' | 'card'>
            value={method}
            onChange={setMethod}
            options={[
              { value: 'cash', label: 'Наличными' },
              ...(r.card > 0 ? [{ value: 'card' as const, label: 'На карту' }] : []),
            ]}
          />
        </Field>
      </div>
      <Field label="Комментарий" className="reg-noshrink">
        <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: протекла крышка" rows={2} />
      </Field>
      <div className="reg-refund-note">Возвращённый товар уходит на проверку в карантин и не попадёт в продажу, пока склад его не проверит.</div>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {amount > 0 ? (
        <div className="reg-change is-refund">
          <span className="reg-change-label">Вернуть покупателю {method === 'cash' ? 'наличными' : 'на карту'}</span>
          <span className="reg-change-value num">{fmt.money(amount)}</span>
        </div>
      ) : null}
    </Drawer>
  );
}
