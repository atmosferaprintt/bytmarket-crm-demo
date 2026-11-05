/* Акт сверки взаимных расчётов с покупателем: начальное сальдо, отгрузки, оплаты, конечное сальдо. Печать — window.print. */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { FileText, Printer } from 'lucide-react';
import type { DB, ID, ISODate } from '../../data/types';
import { PAY_METHOD_NAMES } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes, orderShippedValue } from '../../data/selectors';
import { Button, IconTile, Modal, fmt } from '../../ui';
import { DateField } from './parts';

interface ActLine {
  date: ISODate;
  doc: string;
  debit: number; // клиент должен нам: отгрузка, возврат денег
  credit: number; // уменьшает долг: оплата, возврат товара
}

export interface ActData {
  from: ISODate;
  to: ISODate;
  opening: number; // > 0 — клиент должен магазину
  lines: ActLine[];
  debit: number;
  credit: number;
  closing: number;
}

/** Все взаиморасчёты с клиентом по датам. */
export function reconciliation(db: DB, clientId: ID, from: ISODate, to: ISODate): ActData {
  const all: ActLine[] = [];
  const orders = db.orders.filter((o) => o.clientId === clientId && o.state !== 'draft');
  const orderIds = new Set(orders.map((o) => o.id));
  const priceOf = new Map<ID, Map<ID, number>>();
  for (const o of orders) {
    const m = new Map<ID, number>();
    for (const l of o.lines) if (!m.has(l.productId)) m.set(l.productId, l.price);
    priceOf.set(o.id, m);
  }
  // отгрузки — по движениям склада, по заказу и дню
  const ship = new Map<string, { date: ISODate; orderId: ID; value: number }>();
  const seen = new Map<ID, number>();
  for (const mv of db.movements) {
    if (mv.kind !== 'ship' || mv.docType !== 'order' || !orderIds.has(mv.docId)) continue;
    const date = mv.at.slice(0, 10);
    const k = `${mv.docId}|${date}`;
    const value = Math.round(-mv.dOnHand * (priceOf.get(mv.docId)?.get(mv.productId) ?? 0));
    const x = ship.get(k);
    if (x) x.value += value;
    else ship.set(k, { date, orderId: mv.docId, value });
    seen.set(mv.docId, (seen.get(mv.docId) ?? 0) + value);
  }
  const ix = indexes(db);
  for (const x of ship.values()) {
    const o = ix.orders.get(x.orderId);
    all.push({ date: x.date, doc: `Отгрузка по заказу № ${o?.number ?? ''}`, debit: x.value, credit: 0 });
  }
  // отгруженное без движений (старые данные) — по дате заказа
  for (const o of orders) {
    const total = orderShippedValue(o);
    const rest = total - (seen.get(o.id) ?? 0);
    if (rest > 0) all.push({ date: o.createdAt.slice(0, 10), doc: `Отгрузка по заказу № ${o.number}`, debit: rest, credit: 0 });
  }
  for (const r of db.returns) {
    if (r.source !== 'order' || !r.orderId || !orderIds.has(r.orderId)) continue;
    const o = ix.orders.get(r.orderId);
    all.push({ date: r.at.slice(0, 10), doc: `Возврат товара № ${r.number} по заказу № ${o?.number ?? ''}`, debit: 0, credit: r.amount });
  }
  for (const p of db.payments) {
    if (p.clientId !== clientId || p.status !== 'posted') continue;
    if (p.kind === 'client') all.push({ date: p.at.slice(0, 10), doc: `Оплата № ${p.number}, ${PAY_METHOD_NAMES[p.method].toLowerCase()}`, debit: 0, credit: p.amount });
    else if (p.kind === 'refund') all.push({ date: p.at.slice(0, 10), doc: `Возврат денег № ${p.number}`, debit: p.amount, credit: 0 });
  }
  all.sort((a, b) => a.date.localeCompare(b.date) || b.debit - a.debit);
  let opening = 0;
  const lines: ActLine[] = [];
  let debit = 0;
  let credit = 0;
  for (const l of all) {
    if (l.date < from) opening += l.debit - l.credit;
    else if (l.date <= to) {
      lines.push(l);
      debit += l.debit;
      credit += l.credit;
    }
  }
  return { from, to, opening, lines, debit, credit, closing: opening + debit - credit };
}

function Saldo({ v }: { v: number }) {
  return (
    <>
      <td className="num">{v >= 0 ? fmt.money(v) : ''}</td>
      <td className="num">{v < 0 ? fmt.money(-v) : ''}</td>
    </>
  );
}

/** Сам акт: одинаковый на экране и на бумаге. */
export function ActSheet({ db, clientId, act }: { db: DB; clientId: ID; act: ActData }) {
  const c = indexes(db).clients.get(clientId);
  const co = db.settings.company;
  if (!c) return null;
  const year = act.to.slice(0, 4);
  const inFavor = act.closing > 0 ? co.legalName : act.closing < 0 ? c.name : null;
  return (
    <div className="money-act">
      <div className="money-act-title">Акт сверки взаимных расчётов</div>
      <div className="money-act-sub">
        за период с {fmt.date(act.from)} по {fmt.date(act.to)} {year} г.
        <br />
        между {co.legalName} и {c.name}
      </div>
      <div className="money-act-req">
        <div>
          <div className="w-700">{co.legalName}</div>
          <div>ИНН {co.inn}</div>
          <div>{co.address}</div>
          <div>{co.bank}</div>
          <div>р/с {co.account}</div>
          <div>{fmt.phone(co.phone)}</div>
        </div>
        <div>
          <div className="w-700">{c.name}</div>
          {c.inn ? <div>ИНН {c.inn}</div> : null}
          {c.points[0] ? <div>{c.points[0].address}</div> : null}
          <div>{fmt.phone(c.phone)}</div>
        </div>
      </div>
      <table className="money-act-table">
        <thead>
          <tr>
            <th style={{ width: 90 }}>Дата</th>
            <th>Документ</th>
            <th className="num" style={{ width: 120 }}>
              Дебет
            </th>
            <th className="num" style={{ width: 120 }}>
              Кредит
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="is-total">
            <td colSpan={2}>Сальдо на {fmt.date(act.from)}</td>
            <Saldo v={act.opening} />
          </tr>
          {act.lines.map((l, i) => (
            <tr key={i}>
              <td>{fmt.dateShort(l.date, true)}</td>
              <td>{l.doc}</td>
              <td className="num">{l.debit ? fmt.money(l.debit) : ''}</td>
              <td className="num">{l.credit ? fmt.money(l.credit) : ''}</td>
            </tr>
          ))}
          {!act.lines.length ? (
            <tr>
              <td colSpan={4} className="muted">
                За период движений нет
              </td>
            </tr>
          ) : null}
          <tr className="is-total">
            <td colSpan={2}>Обороты за период</td>
            <td className="num">{fmt.money(act.debit)}</td>
            <td className="num">{fmt.money(act.credit)}</td>
          </tr>
          <tr className="is-total">
            <td colSpan={2}>Сальдо на {fmt.date(act.to)}</td>
            <Saldo v={act.closing} />
          </tr>
        </tbody>
      </table>
      <p className="money-act-result">
        По данным {co.legalName} на {fmt.date(act.to)} {year} г.{' '}
        {inFavor ? (
          <>
            задолженность в пользу {inFavor} составляет <b>{fmt.money(Math.abs(act.closing))}</b>.
          </>
        ) : (
          <>задолженности нет.</>
        )}
      </p>
      <div className="money-act-sign">
        <div>
          <div>От {co.legalName}</div>
          <div className="money-act-line">Главный бухгалтер</div>
        </div>
        <div>
          <div>От {c.name}</div>
          <div className="money-act-line">Подпись, расшифровка</div>
        </div>
      </div>
    </div>
  );
}

export function ReconciliationModal({ clientId, onClose }: { clientId: ID; onClose: () => void }) {
  const db = useDB();
  const v = useDBVersion();
  const today = db.meta.today;
  const [from, setFrom] = useState<ISODate>(db.meta.startDate);
  const [to, setTo] = useState<ISODate>(today);
  const act = useMemo(() => reconciliation(db, clientId, from, to), [db, v, clientId, from, to]);
  const c = indexes(db).clients.get(clientId);

  useEffect(() => {
    document.body.classList.add('money-printing');
    return () => document.body.classList.remove('money-printing');
  }, []);

  return (
    <>
      <Modal
        title="Акт сверки"
        sub={c?.name}
        icon={<IconTile>
          <FileText />
        </IconTile>}
        onClose={onClose}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={onClose}>
              Закрыть
            </Button>
            <Button variant="primary" icon={<Printer />} onClick={() => window.print()}>
              Печать
            </Button>
          </>
        }
      >
        <div className="row-3">
          <DateField label="С" value={from} onChange={setFrom} min={db.meta.startDate} max={to} />
          <DateField label="По" value={to} onChange={setTo} min={from} max={today} />
        </div>
        <div className="money-act-frame">
          <ActSheet db={db} clientId={clientId} act={act} />
        </div>
      </Modal>
      {createPortal(
        <div className="money-print-sheet">
          <ActSheet db={db} clientId={clientId} act={act} />
        </div>,
        document.body,
      )}
    </>
  );
}
