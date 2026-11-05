/* Печатные формы заказа: счёт на оплату и расходная накладная. Печать через window.print. */
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { Order } from '../../data/types';
import { useDB } from '../../data/store';
import { indexes, orderPayment, orderReturns } from './data';
import { fmt } from '../../ui';
import { linePackLabel, productName, rublesInWords } from './lib';

export type PrintKind = 'invoice' | 'waybill';

/** Рисует документ в скрытом слое и открывает печать. На экране слой не виден. */
export function PrintDoc({ kind, order, onDone }: { kind: PrintKind; order: Order; onDone: () => void }) {
  useEffect(() => {
    document.body.classList.add('sales-printing');
    const after = () => onDone();
    window.addEventListener('afterprint', after);
    const t = window.setTimeout(() => window.print(), 80);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('afterprint', after);
      document.body.classList.remove('sales-printing');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, order.id]);
  return createPortal(
    <div className="sales-print" aria-hidden="true">
      {kind === 'invoice' ? <Invoice order={order} /> : <Waybill order={order} />}
    </div>,
    document.body,
  );
}

function useDocData(order: Order) {
  const db = useDB();
  const idx = indexes(db);
  const client = idx.clients.get(order.clientId);
  const point = client?.points.find((p) => p.id === order.pointId) ?? client?.points[0];
  const returned = orderReturns(db).get(order.id)?.byProduct ?? new Map<string, number>();
  const company = db.settings.company;
  return { db, idx, client, point, returned, company, today: db.meta.today };
}

function Invoice({ order }: { order: Order }) {
  const { db, idx, client, point, returned, company, today } = useDocData(order);
  const left = new Map(returned);
  const rows = order.lines
    .map((l) => {
      const r = Math.min(left.get(l.productId) ?? 0, l.qty);
      left.set(l.productId, (left.get(l.productId) ?? 0) - r);
      const qty = l.qty - r;
      return { l, qty, sum: qty * l.price };
    })
    .filter((x) => x.qty > 0);
  const total = rows.reduce((s, r) => s + r.sum, 0);
  const pay = orderPayment(db, order);
  return (
    <div className="sales-doc">
      <table className="sales-doc-bank">
        <tbody>
          <tr>
            <td colSpan={2}>
              <div className="sales-doc-small">Банк получателя</div>
              {company.bank}
            </td>
          </tr>
          <tr>
            <td>
              <div className="sales-doc-small">ИНН</div>
              {company.inn}
            </td>
            <td>
              <div className="sales-doc-small">Расчётный счёт</div>
              {company.account}
            </td>
          </tr>
          <tr>
            <td colSpan={2}>
              <div className="sales-doc-small">Получатель</div>
              {company.legalName}
            </td>
          </tr>
        </tbody>
      </table>
      <h1 className="sales-doc-title">
        Счёт на оплату № {order.number} от {fmt.date(today, { year: true })}
      </h1>
      <div className="sales-doc-parties">
        <div>
          <span className="sales-doc-small">Поставщик</span>
          <b>{company.legalName}</b>, ИНН {company.inn}, {company.address}, тел. {fmt.phone(company.phone)}
        </div>
        <div>
          <span className="sales-doc-small">Покупатель</span>
          <b>{client?.name}</b>
          {client?.inn ? `, ИНН ${client.inn}` : ''}
          {point ? `, ${point.address}` : ''}
        </div>
        <div>
          <span className="sales-doc-small">Основание</span>
          Заказ № {order.number} от {fmt.date(order.createdAt, { year: true })}
        </div>
      </div>
      <table className="sales-doc-lines">
        <thead>
          <tr>
            <th>№</th>
            <th>Товар</th>
            <th>Кол-во</th>
            <th>Ед.</th>
            <th>Цена</th>
            <th>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.l.productId + i}>
              <td>{i + 1}</td>
              <td>{idx.products.get(r.l.productId)?.name ?? 'Товар'}</td>
              <td className="num">{fmt.num(r.qty)}</td>
              <td>шт</td>
              <td className="num">{fmt.price(r.l.price)}</td>
              <td className="num">{fmt.money(r.sum)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={5}>Итого</td>
            <td className="num">{fmt.money(total)}</td>
          </tr>
          {pay.paid > 0 ? (
            <tr>
              <td colSpan={5}>Уже оплачено</td>
              <td className="num">{fmt.money(pay.paid)}</td>
            </tr>
          ) : null}
          <tr>
            <td colSpan={5}>К оплате</td>
            <td className="num">{fmt.money(Math.max(0, total - pay.paid))}</td>
          </tr>
        </tfoot>
      </table>
      <p>
        Всего наименований {rows.length}, на сумму {fmt.money(total)}
        <br />
        <b>{rublesInWords(total)}</b>
      </p>
      {order.dueDate ? <p>Оплатить до {fmt.date(order.dueDate, { year: true })}.</p> : null}
      <div className="sales-doc-sign">
        <span>Руководитель ____________________</span>
        <span>Бухгалтер ____________________</span>
      </div>
    </div>
  );
}

function Waybill({ order }: { order: Order }) {
  const { db, idx, client, point, company, today } = useDocData(order);
  const anyShipped = order.lines.some((l) => l.shipped > 0);
  const rows = order.lines.map((l) => {
    const qty = anyShipped ? l.shipped : l.qty;
    return { l, qty, sum: qty * l.price };
  }).filter((r) => r.qty > 0);
  const total = rows.reduce((s, r) => s + r.sum, 0);
  const delivery = order.deliveryId ? db.deliveries.find((d) => d.id === order.deliveryId) : undefined;
  return (
    <div className="sales-doc">
      <h1 className="sales-doc-title">
        Расходная накладная № {order.number} от {fmt.date(today, { year: true })}
      </h1>
      <div className="sales-doc-parties">
        <div>
          <span className="sales-doc-small">Поставщик</span>
          <b>{company.legalName}</b>, ИНН {company.inn}, {company.address}
        </div>
        <div>
          <span className="sales-doc-small">Покупатель</span>
          <b>{client?.name}</b>
          {client?.inn ? `, ИНН ${client.inn}` : ''}
        </div>
        <div>
          <span className="sales-doc-small">Адрес</span>
          {order.fulfillment === 'pickup' ? 'Самовывоз со склада' : point ? `${point.name}, ${point.address}` : '—'}
        </div>
        <div>
          <span className="sales-doc-small">Основание</span>
          Заказ № {order.number} от {fmt.date(order.createdAt, { year: true })}
          {delivery ? `, доставка № ${delivery.number}, мест ${delivery.places}` : ''}
        </div>
      </div>
      <table className="sales-doc-lines">
        <thead>
          <tr>
            <th>№</th>
            <th>Товар</th>
            <th>Артикул</th>
            <th>Упаковка</th>
            <th>Кол-во, шт</th>
            <th>Цена</th>
            <th>Сумма</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const p = idx.products.get(r.l.productId);
            return (
              <tr key={r.l.productId + i}>
                <td>{i + 1}</td>
                <td>{p?.name ?? productName(p)}</td>
                <td>{p?.sku}</td>
                <td>{r.l.pack === 'pcs' ? 'шт' : `${fmt.num(Math.round(r.qty / r.l.packSize))} × ${linePackLabel(r.l.pack, r.l.packSize)}`}</td>
                <td className="num">{fmt.num(r.qty)}</td>
                <td className="num">{fmt.price(r.l.price)}</td>
                <td className="num">{fmt.money(r.sum)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={4}>Итого</td>
            <td className="num">{fmt.num(rows.reduce((s, r) => s + r.qty, 0))}</td>
            <td />
            <td className="num">{fmt.money(total)}</td>
          </tr>
        </tfoot>
      </table>
      <p>
        Всего наименований {rows.length}, на сумму {fmt.money(total)}
        <br />
        <b>{rublesInWords(total)}</b>
      </p>
      <div className="sales-doc-sign">
        <span>Отпустил ____________________</span>
        <span>Получил ____________________</span>
      </div>
    </div>
  );
}
