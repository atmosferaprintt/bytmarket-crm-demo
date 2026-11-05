/* Печатная форма чека: отдельный блок, который виден только при печати (@media print в register.css). */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ID } from '../../data/types';
import { useDB } from '../../data/store';
import { indexes, shiftSummary } from '../../data/selectors';
import { fmt } from '../../ui';
import { cardNumber, packLabel } from './lib';

function PrintableReceipt({ id }: { id: ID }) {
  const db = useDB();
  const r = db.receipts.find((x) => x.id === id);
  if (!r) return null;
  const ix = indexes(db);
  const seller = ix.employees.get(r.sellerId);
  const client = r.clientId ? ix.clients.get(r.clientId) : undefined;
  const shift = db.shifts.find((s) => s.id === r.shiftId);
  const orig = r.refundOf ? db.receipts.find((x) => x.id === r.refundOf) : undefined;
  const gross = r.lines.reduce((s, l) => s + l.basePrice * l.qty, 0);
  const c = db.settings.company;
  const reasons = [...new Set(r.lines.filter((l) => l.discountPct > 0).map((l) => `${fmt.pct(l.discountPct)} · ${l.discountReason ?? ''}`))];
  return (
    <div className="reg-print" aria-hidden="true">
      <div className="reg-print-head">
        <div className="w-700 t-16">{c.name}</div>
        <div>{c.legalName}</div>
        {c.inn ? <div>ИНН {c.inn}</div> : null}
        <div>{c.address}</div>
        {c.phone ? <div>{fmt.phone(c.phone)}</div> : null}
      </div>
      <div className="reg-print-title">
        {r.kind === 'refund' ? `Возврат по чеку № ${orig?.number ?? ''}` : 'Товарный чек'} № {r.number}
      </div>
      <div className="reg-print-meta">
        <span>{fmt.dateShort(r.at, true)}, {fmt.time(r.at)}</span>
        <span>Смена № {shift?.number ?? '—'}</span>
      </div>
      <div className="reg-print-meta">
        <span>Продавец</span>
        <span>{seller?.name ?? '—'}</span>
      </div>
      <div className="reg-print-lines">
        {r.lines.map((l, i) => {
          const p = ix.products.get(l.productId);
          return (
            <div key={i} className="reg-print-line">
              <div>{p?.name ?? 'Товар'}</div>
              <div className="reg-print-row">
                <span>
                  {l.pack !== 'pcs' && p ? `${l.packQty} × ${packLabel(p, l.pack)} = ` : ''}
                  {fmt.num(l.qty)} шт × {fmt.price(l.price)}
                  {l.basePrice > l.price ? ` (было ${fmt.price(l.basePrice)})` : ''}
                </span>
                <span className="w-700">{fmt.money(l.qty * l.price)}</span>
              </div>
            </div>
          );
        })}
      </div>
      {gross > r.total ? (
        <>
          <div className="reg-print-row">
            <span>Без скидок</span>
            <span>{fmt.money(gross)}</span>
          </div>
          <div className="reg-print-row">
            <span>Скидки и акции</span>
            <span>−{fmt.money(gross - r.total)}</span>
          </div>
          {reasons.map((x) => (
            <div key={x} className="reg-print-row">
              <span>Скидка {x}</span>
              <span />
            </div>
          ))}
        </>
      ) : null}
      <div className="reg-print-row reg-print-total">
        <span>{r.kind === 'refund' ? 'Возвращено' : 'Итого'}</span>
        <span>{fmt.money(r.total)}</span>
      </div>
      {r.cash > 0 ? (
        <div className="reg-print-row">
          <span>{r.kind === 'refund' ? 'Наличными' : 'Наличными получено'}</span>
          <span>{fmt.money(r.cash)}</span>
        </div>
      ) : null}
      {r.card > 0 ? (
        <div className="reg-print-row">
          <span>{r.kind === 'refund' ? 'На карту' : 'Картой'}</span>
          <span>{fmt.money(r.card)}</span>
        </div>
      ) : null}
      {r.change > 0 ? (
        <div className="reg-print-row">
          <span>Сдача</span>
          <span>{fmt.money(r.change)}</span>
        </div>
      ) : null}
      {client ? (
        <div className="reg-print-row">
          <span>Карта покупателя</span>
          <span>{cardNumber(db, client)}</span>
        </div>
      ) : null}
      <div className="reg-print-foot">Спасибо за покупку!</div>
    </div>
  );
}

/** Сколько сдать и сколько оставить на размен после пересчёта: размен на начало остаётся в кассе, остальное — выручка. */
export function handOver(counted: number, openingCash: number): { handIn: number; keep: number } {
  const keep = Math.min(counted, openingCash);
  return { handIn: counted - keep, keep };
}

/** Отчёт смены (Z-отчёт без фискальника): продажи, возвраты, наличные, карта, пересчёт, что сдать. */
function PrintableShift({ id }: { id: ID }) {
  const db = useDB();
  const s = db.shifts.find((x) => x.id === id);
  if (!s) return null;
  const sum = shiftSummary(db, s.id);
  const seller = indexes(db).employees.get(s.sellerId);
  const c = db.settings.company;
  const net = sum.total - sum.refunds;
  const row = (label: string, value: string, strong?: boolean) => (
    <div className={strong ? 'reg-print-row reg-print-total' : 'reg-print-row'}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
  const ho = sum.countedCash === null ? null : handOver(sum.countedCash, s.openingCash);
  return (
    <div className="reg-print" aria-hidden="true">
      <div className="reg-print-head">
        <div className="w-700 t-16">{c.name}</div>
        <div>{c.legalName}</div>
        <div>{c.address}</div>
      </div>
      <div className="reg-print-title">Отчёт смены № {s.number}</div>
      <div className="reg-print-meta">
        <span>{fmt.dateShort(s.openedAt, true)}</span>
        <span>
          {fmt.time(s.openedAt)}–{s.closedAt ? fmt.time(s.closedAt) : 'сейчас'}
        </span>
      </div>
      <div className="reg-print-meta">
        <span>Продавец</span>
        <span>{seller?.name ?? '—'}</span>
      </div>
      <div className="reg-print-lines">
        {row('Чеков продажи', fmt.num(sum.receipts))}
        {row('Продажи', fmt.money(sum.total))}
        {row(`Возвраты${sum.refundsCount ? `, ${fmt.count(sum.refundsCount, 'чек', 'чека', 'чеков')}` : ''}`, sum.refunds ? `−${fmt.money(sum.refunds)}` : '0 ₽')}
        {row('Выручка', fmt.money(net), true)}
        {row('Наличными', fmt.money(sum.cash))}
        {row('Картой', fmt.money(sum.card))}
      </div>
      {row('Размен на начало', fmt.money(s.openingCash))}
      {row('Ожидалось в кассе', fmt.money(sum.expectedCash))}
      {row('Пересчитано', sum.countedCash === null ? 'смена открыта' : fmt.money(sum.countedCash))}
      {sum.difference !== null ? row('Расхождение', sum.difference === 0 ? '0 ₽' : `${sum.difference > 0 ? '+' : '−'}${fmt.money(Math.abs(sum.difference))}`) : null}
      {ho ? (
        <div className="reg-print-lines">
          {row('Сдать выручку', fmt.money(ho.handIn), true)}
          {row('Оставить на размен', fmt.money(ho.keep))}
        </div>
      ) : null}
      <div className="reg-print-sign">
        <span>Сдал</span>
        <span>____________</span>
      </div>
      <div className="reg-print-sign">
        <span>Принял</span>
        <span>____________</span>
      </div>
      <div className="reg-print-foot">{s.closedAt ? `Смена закрыта ${fmt.dateShort(s.closedAt, true)} в ${fmt.time(s.closedAt)}` : 'Смена открыта'}</div>
    </div>
  );
}

/** Печать формы: выводит блок в body, вызывает печать и убирает блок. */
function usePrintNode(render: (id: ID) => ReactNode): [(id: ID) => void, ReactNode] {
  const [id, setId] = useState<ID | null>(null);
  useEffect(() => {
    if (!id) return;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      setId(null);
    };
    window.addEventListener('afterprint', finish, { once: true });
    const t1 = window.setTimeout(() => {
      window.print();
    }, 40);
    // если браузер не сообщил об окончании печати — убираем форму сами
    const t2 = window.setTimeout(finish, 4000);
    return () => {
      window.removeEventListener('afterprint', finish);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [id]);
  const print = useCallback((x: ID) => setId(x), []);
  const node = id ? createPortal(render(id), document.body) : null;
  return [print, node];
}

/** Печать чека: const [print, printNode] = usePrintReceipt(); print(id); {printNode} — в разметке. */
export function usePrintReceipt(): [(id: ID) => void, ReactNode] {
  return usePrintNode((id) => <PrintableReceipt id={id} />);
}

/** Печать отчёта смены: const [printShift, node] = usePrintShift(); printShift(shiftId). */
export function usePrintShift(): [(id: ID) => void, ReactNode] {
  return usePrintNode((id) => <PrintableShift id={id} />);
}
