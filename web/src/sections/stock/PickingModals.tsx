/* Окна сборки: «Собрано» при неотмеченных строках, выдача самовывоза (сумма, оплата, долг клиента)
   и расходная накладная для печати. */
import { useState } from 'react';
import { PackageCheck } from 'lucide-react';
import { useDB } from '../../data/store';
import { clientBalance, orderPayment } from '../../data/selectors';
import { plusDays } from '../../data/dates';
import { Button, Checkbox, Modal, Notice, StatList, StatRow, StatusChip, PAY_STATE, fmt } from '../../ui';
import type { PickItem, PickLine } from './picking';

/** Строки, которые кладовщик не отметил. */
export function uncheckedLines(x: PickItem): PickLine[] {
  const done = new Set(x.o.pickChecked ?? []);
  return x.lines.filter((l) => !done.has(l.line.productId));
}

export function UnpickedModal({ x, onConfirm, onClose }: { x: PickItem; onConfirm: () => void; onClose: () => void }) {
  const rest = uncheckedLines(x);
  return (
    <Modal
      title={`Не отмечено ${fmt.count(rest.length, 'строка', 'строки', 'строк')}`}
      sub={`Заказ № ${x.o.number} · ${x.client?.name ?? 'Клиент'}`}
      onClose={onClose}
      footer={
        <>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Вернуться к сборке
          </Button>
          <Button variant="primary" icon={<PackageCheck />} onClick={onConfirm} data-hint="stock.unpicked-go">
            Собрать всё равно
          </Button>
        </>
      }
    >
      <div className="stock-unpicked" data-hint="stock.unpicked">
        {rest.map((l) => (
          <div key={l.line.productId} className="stock-unpicked-row">
            <span className="grow">
              <span className="w-600">{l.p.name}</span>
              <span className="stock-pick-sku">{l.p.sku}</span>
            </span>
            <b className="nowrap">{fmt.qty(l.rest)}</b>
          </div>
        ))}
      </div>
      <div className="t-13 ink-2">Собрать всё равно? Если какого-то товара нет на месте, не ставьте «Собрано» — скажите менеджеру, он уменьшит заказ.</div>
    </Modal>
  );
}

/** Сумма к выдаче — по строкам, которые ещё не отгружены. */
export function restSum(x: PickItem): number {
  return x.lines.reduce((s, l) => s + l.rest * l.line.price, 0);
}

export function HandOverModal({ x, onDone, onClose }: { x: PickItem; onDone: (print: boolean) => string | null; onClose: () => void }) {
  const db = useDB();
  const today = db.meta.today;
  const [print, setPrint] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pay = orderPayment(db, x.o);
  const bal = clientBalance(db, x.o.clientId);
  const sum = restSum(x);
  // после выдачи долг по заказу = отгружено − оплачено
  const debtAfterOrder = Math.max(0, pay.shipped + sum - pay.paid);
  const debtAfter = bal.debt - pay.debt + debtAfterOrder;
  const defer = x.client?.deferDays ?? 0;
  const dueDate = x.o.dueDate ?? plusDays(today, defer);
  const unpaid = debtAfterOrder > 0;
  return (
    <Modal
      title={`Выдать заказ № ${x.o.number}`}
      sub={x.client?.name ?? 'Клиент'}
      onClose={onClose}
      footer={
        <>
          <span data-hint="stock.handover-print">
            <Checkbox checked={print} onChange={setPrint}>
              Распечатать накладную
            </Checkbox>
          </span>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" icon={<PackageCheck />} onClick={() => setError(onDone(print))} data-hint="stock.handover-go">
            Выдать клиенту
          </Button>
        </>
      }
    >
      <div data-hint="stock.handover-sum">
      <StatList>
        <StatRow label="К выдаче" value={`${fmt.count(x.positions, 'позиция', 'позиции', 'позиций')} · ${fmt.qty(x.qty)} · мест ${x.places}`} />
        <StatRow label="Сумма к выдаче" value={<b>{fmt.money(sum)}</b>} />
        <StatRow
          label="Оплата заказа"
          value={
            <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
              <StatusChip s={PAY_STATE[pay.state]} />
              <span className="nowrap">
                {fmt.money(pay.paid)} из {fmt.money(pay.amount)}
              </span>
            </span>
          }
        />
        <StatRow
          label="Долг клиента сейчас"
          value={
            <span className={bal.overdue ? 'c-bad w-700' : undefined}>
              {fmt.money(bal.debt)}
              {bal.overdue ? ` · просрочено ${fmt.money(bal.overdue)}` : ''}
            </span>
          }
        />
        <StatRow total label="Долг после выдачи" value={fmt.money(debtAfter)} />
      </StatList>
      </div>
      {unpaid ? (
        defer > 0 ? (
          <Notice tone="info">
            Отсрочка {fmt.count(defer, 'день', 'дня', 'дней')}: оплатить {fmt.money(debtAfterOrder)} до {fmt.date(dueDate)}
          </Notice>
        ) : (
          <Notice tone="warn" title="Клиент без отсрочки">
            Заказ не оплачен на {fmt.money(debtAfterOrder)}. Возьмите оплату на кассе до выдачи или согласуйте с менеджером
          </Notice>
        )
      ) : null}
      {bal.overdue > 0 ? <Notice tone="bad">У клиента просрочка {fmt.money(bal.overdue)}. Перед выдачей уточните у менеджера</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}

/** Расходная накладная к заказу: строки, цены, итог, подписи. */
export function Waybill({ x, at }: { x: PickItem; at: string }) {
  const db = useDB();
  const c = db.settings.company;
  const sum = restSum(x);
  return (
    <div className="stock-print-page">
      <h1>
        Расходная накладная к заказу № {x.o.number} от {fmt.date(at)}
      </h1>
      <div className="stock-print-meta">
        <span>
          Продавец: {c.legalName || c.name}
          {c.inn ? `, ИНН ${c.inn}` : ''}
        </span>
        <span>
          Покупатель: {x.client?.name ?? 'Клиент'}
          {x.client?.inn ? `, ИНН ${x.client.inn}` : ''}
        </span>
        <span>Самовывоз со склада</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>№</th>
            <th>Товар</th>
            <th>Артикул</th>
            <th className="num">Кол-во</th>
            <th className="num">Цена</th>
            <th className="num">Сумма</th>
          </tr>
        </thead>
        <tbody>
          {x.lines.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td>{l.p.name}</td>
              <td>{l.p.sku}</td>
              <td className="num">{fmt.qty(l.rest)}</td>
              <td className="num">{fmt.price(l.line.price)}</td>
              <td className="num">{fmt.money(l.rest * l.line.price)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={5}>
              <b>
                Итого: {fmt.count(x.positions, 'позиция', 'позиции', 'позиций')}, {fmt.qty(x.qty)}
              </b>
            </td>
            <td className="num">
              <b>{fmt.money(sum)}</b>
            </td>
          </tr>
        </tbody>
      </table>
      <div className="stock-print-sign">
        <span>Отпустил: ____________</span>
        <span>Получил: ____________</span>
        <span>Мест: {x.places}</span>
      </div>
    </div>
  );
}
