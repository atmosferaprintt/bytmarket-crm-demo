/* Акт сверки с поставщиком: поставки (по принятому без брака) и оплаты за период, сальдо на начало и конец, печать.
   Если у бухгалтера открыта задача «Сверка с «…»» — её можно закрыть вместе с печатью. */
import { useMemo, useState } from 'react';
import { Printer } from 'lucide-react';
import type { DB, ID, ISODate, Supplier } from '../../data/types';
import { PAY_METHOD_NAMES } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { plusDays } from '../../data/dates';
import { useSession } from '../../roles/session';
import { EntityLink } from '../../shell/entities';
import { Button, Checkbox, EmptyState, Modal, Notice, Segmented, fmt, toast } from '../../ui';
import { act } from '../stock/act';
import { usePrint } from '../stock/print';

interface ActRow {
  key: string;
  date: ISODate;
  at: string;
  doc: string;
  purchaseId: ID | null;
  debit: number; // поставка: наш долг растёт
  credit: number; // оплата: наш долг уменьшается
}

/** Все движения расчётов с поставщиком по времени. */
function actRows(db: DB, s: Supplier): ActRow[] {
  const pus = new Map(db.purchases.filter((p) => p.supplierId === s.id).map((p) => [p.id, p]));
  const recv = new Map<string, ActRow>();
  for (const m of db.movements) {
    if (m.docType !== 'purchase' || m.kind !== 'income') continue;
    const pu = pus.get(m.docId);
    if (!pu) continue;
    const price = pu.lines.find((l) => l.productId === m.productId)?.price ?? 0;
    const date = m.at.slice(0, 10);
    const key = `${pu.id}|${date}`;
    let r = recv.get(key);
    if (!r) {
      r = { key, date, at: m.at, doc: `Поставка по закупке № ${pu.number}`, purchaseId: pu.id, debit: 0, credit: 0 };
      recv.set(key, r);
    }
    r.debit += m.dOnHand * price;
  }
  const out: ActRow[] = [...recv.values()].filter((r) => r.debit > 0);
  for (const p of db.payments) {
    if (p.kind !== 'supplier' || p.supplierId !== s.id || p.status !== 'posted') continue;
    const sign = p.direction === 'out' ? 1 : -1;
    out.push({ key: p.id, date: p.at.slice(0, 10), at: p.at, doc: `Оплата № ${p.number}, ${PAY_METHOD_NAMES[p.method].toLowerCase()}`, purchaseId: null, debit: 0, credit: sign * p.amount });
  }
  return out.sort((a, b) => a.at.localeCompare(b.at));
}

interface Period {
  key: string;
  label: string;
  from: ISODate;
  to: ISODate;
}

function periods(start: ISODate, today: ISODate): Period[] {
  const res: Period[] = [];
  let y = Number(start.slice(0, 4));
  let m = Number(start.slice(5, 7));
  const ty = Number(today.slice(0, 4));
  const tm = Number(today.slice(5, 7));
  while (y < ty || (y === ty && m <= tm)) {
    const from = `${y}-${String(m).padStart(2, '0')}-01`;
    const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
    const end = plusDays(next, -1);
    const to = end > today ? today : end;
    res.push({ key: from, label: fmt.monthName(from, false).replace(/^./, (c) => c.toUpperCase()), from, to });
    if (m === 12) {
      y++;
      m = 1;
    } else m++;
  }
  return res;
}

const saldoText = (v: number) => (v > 0 ? `наш долг ${fmt.money(v)}` : v < 0 ? `аванс у поставщика ${fmt.money(-v)}` : 'расчёты закрыты, 0 ₽');

export function ActModal({ s, onClose }: { s: Supplier; onClose: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const { me } = useSession();
  const printer = usePrint();
  const today = db.meta.today;
  const list = useMemo(() => periods(db.meta.startDate, today), [db.meta.startDate, today]);
  // по умолчанию — прошлый месяц: сверку делают после закрытия месяца
  const [key, setKey] = useState(() => (list.length > 1 ? list[list.length - 2].key : list[0]?.key ?? 'all'));
  const all: Period = { key: 'all', label: 'Всё время', from: db.meta.startDate, to: today };
  const period = list.find((p) => p.key === key) ?? all;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => actRows(db, s), [db, version, s]);
  const before = rows.filter((r) => r.date < period.from);
  const inside = rows.filter((r) => r.date >= period.from && r.date <= period.to);
  const opening = before.reduce((z, r) => z + r.debit - r.credit, 0);
  const debit = inside.reduce((z, r) => z + r.debit, 0);
  const credit = inside.reduce((z, r) => z + r.credit, 0);
  const closing = opening + debit - credit;
  const periodText = `${fmt.date(period.from)} — ${fmt.date(period.to)}`;

  // задача «Сверка с «…»» у этого сотрудника
  const short = s.name.replace(/^(ООО|ИП|АО|ОАО|ЗАО)\s+/, '');
  const task = db.tasks.find((t) => t.state === 'open' && t.assigneeId === me.id && /сверк/i.test(t.title) && ((t.link?.type === 'supplier' && t.link.id === s.id) || t.title.includes(short)));
  const [closeTask, setCloseTask] = useState(true);

  let run = opening;
  const withSaldo = inside.map((r) => {
    run += r.debit - r.credit;
    return { r, saldo: run };
  });

  const c = db.settings.company;
  const sheet = (
    <div className="stock-print-page">
      <h1>Акт сверки взаимных расчётов</h1>
      <div className="stock-print-meta">
        <span>
          {c.legalName || c.name}
          {c.inn ? `, ИНН ${c.inn}` : ''} и {s.name}, ИНН {s.inn}
        </span>
        <span>за период {periodText}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>Дата</th>
            <th>Документ</th>
            <th className="num">Поставка</th>
            <th className="num">Оплата</th>
            <th className="num">Сальдо</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{fmt.dateShort(period.from)}</td>
            <td>Сальдо на начало</td>
            <td />
            <td />
            <td className="num">{fmt.money(opening)}</td>
          </tr>
          {withSaldo.map(({ r, saldo }) => (
            <tr key={r.key}>
              <td>{fmt.dateShort(r.date)}</td>
              <td>{r.doc}</td>
              <td className="num">{r.debit ? fmt.money(r.debit) : ''}</td>
              <td className="num">{r.credit ? fmt.money(r.credit) : ''}</td>
              <td className="num">{fmt.money(saldo)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={2}>
              <b>Обороты за период</b>
            </td>
            <td className="num">
              <b>{fmt.money(debit)}</b>
            </td>
            <td className="num">
              <b>{fmt.money(credit)}</b>
            </td>
            <td />
          </tr>
        </tbody>
      </table>
      <div className="stock-print-meta" style={{ marginTop: 12 }}>
        <b>
          На {fmt.date(period.to)}: {saldoText(closing)}
        </b>
      </div>
      <div className="stock-print-sign">
        <span>От {c.name}: ____________</span>
        <span>От {s.name}: ____________</span>
      </div>
    </div>
  );

  const doPrint = () => {
    printer.print(sheet);
    if (task && closeTask) {
      const r = act('task.complete', { taskId: task.id }, me.id);
      if (!r.ok) return toast(r.error, 'error');
      toast(`Акт сверки отправлен на печать. Задача «${task.title}» выполнена`);
    } else toast('Акт сверки отправлен на печать');
  };

  return (
    <Modal
      wide
      title={`Акт сверки с ${s.name}`}
      sub={`ИНН ${s.inn} · ${periodText}`}
      onClose={onClose}
      footer={
        <>
          {task ? (
            <span data-hint="purchases.act-task">
              <Checkbox checked={closeTask} onChange={setCloseTask}>
                Закрыть задачу «{task.title}»
              </Checkbox>
            </span>
          ) : null}
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Закрыть
          </Button>
          <Button variant="primary" icon={<Printer />} onClick={doPrint} data-hint="purchases.act-print">
            Печать акта
          </Button>
        </>
      }
    >
      <div className="col" data-hint="purchases.act-period">
        <Segmented ariaLabel="Период" value={key} onChange={setKey} options={[...list.map((p) => ({ value: p.key, label: p.label })), { value: 'all', label: all.label }]} />
      </div>
      <div className="pur-act-sum" data-hint="purchases.act-sum">
        <div>
          <div className="t-12 muted">Сальдо на {fmt.date(period.from)}</div>
          <div className="w-700 t-16">{fmt.money(opening)}</div>
        </div>
        <div>
          <div className="t-12 muted">Поставки</div>
          <div className="w-700 t-16">{fmt.money(debit)}</div>
        </div>
        <div>
          <div className="t-12 muted">Оплаты</div>
          <div className="w-700 t-16">{fmt.money(credit)}</div>
        </div>
        <div>
          <div className="t-12 muted">Сальдо на {fmt.date(period.to)}</div>
          <div className="w-700 t-16">{fmt.money(closing)}</div>
        </div>
      </div>
      {inside.length === 0 ? (
        <EmptyState title="За этот период движений нет">Сальдо не менялось: {saldoText(opening)}</EmptyState>
      ) : (
        <div className="stock-doc-lines pur-act-table" data-hint="purchases.act-table">
          <table className="table table-dense">
            <thead>
              <tr>
                <th style={{ width: 80 }}>Дата</th>
                <th>Документ</th>
                <th className="num">Поставка</th>
                <th className="num">Оплата</th>
                <th className="num">Сальдо</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="muted">{fmt.dateShort(period.from)}</td>
                <td className="muted">Сальдо на начало</td>
                <td />
                <td />
                <td className="num w-600">{fmt.money(opening)}</td>
              </tr>
              {withSaldo.map(({ r, saldo }) => (
                <tr key={r.key}>
                  <td className="nowrap">{fmt.dateShort(r.date)}</td>
                  <td>
                    {r.purchaseId ? (
                      <EntityLink type="purchase" id={r.purchaseId}>
                        {r.doc}
                      </EntityLink>
                    ) : (
                      r.doc
                    )}
                  </td>
                  <td className="num">{r.debit ? fmt.money(r.debit) : <span className="faint">—</span>}</td>
                  <td className="num">{r.credit ? fmt.money(r.credit) : <span className="faint">—</span>}</td>
                  <td className="num w-600">{fmt.money(saldo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>Обороты за период</td>
                <td className="num">{fmt.money(debit)}</td>
                <td className="num">{fmt.money(credit)}</td>
                <td className="num">{fmt.money(closing)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <Notice tone={closing < 0 ? 'ok' : 'info'}>
        На {fmt.date(period.to)}: {saldoText(closing)}. Поставки считаем по принятому без брака
      </Notice>
      {printer.element}
    </Modal>
  );
}
