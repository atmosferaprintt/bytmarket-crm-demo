/* Карточка «Закупка» в боковой панели: строки «заказано — принято — брак — причина», подтверждение,
   приёмка (частичная оставляет «ожидается», брак уходит в карантин), оплаты и долг по закупке. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, PackageCheck, Printer, Wallet } from 'lucide-react';
import type { EntityDrawerProps } from '../../shell/entities';
import { EntityLink } from '../../shell/entities';
import { useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { get } from '../../data/idx';
import { LOCATION_NAMES, PAY_METHOD_NAMES } from '../../data/types';
import { useSession } from '../../roles/session';
import {
  Button,
  Card,
  Checkbox,
  Chip,
  ConfirmButton,
  Drawer,
  EmptyState,
  MoreMenu,
  Notice,
  StatList,
  StatRow,
  StatusChip,
  Steps,
  PURCHASE_STATE,
  cx,
  fmt,
  overdueStatus,
  toast,
} from '../../ui';
import { act } from '../stock/act';
import { inBoxes } from '../stock/calc';
import { usePrint } from '../stock/print';
import { purchasePayments, purchaseRowOf } from './calc';
import { ReceiveBody, recvError, recvPayload, recvRows, type RecvLine } from './receive';
import { PaySupplierModal } from './PaySupplierModal';
import './purchases.css';

export default function EntityDrawer({ id, onClose, initialMode = 'view' }: EntityDrawerProps & { initialMode?: 'view' | 'receive' }) {
  const db = useDB();
  const version = useDBVersion();
  const { me, can } = useSession();
  const seeCost = can('seeCost');
  const ix = indexes(db);
  const printer = usePrint();
  const [mode, setMode] = useState<'view' | 'receive'>(initialMode);
  const [recv, setRecv] = useState<Record<string, RecvLine>>({});
  const [final, setFinal] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [error]);
  const [pay, setPay] = useState(false);
  const pu = get(db, 'purchases', id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const row = useMemo(() => (pu ? purchaseRowOf(db, pu.id) : undefined), [pu, version]);
  const pays = pu ? purchasePayments(db).get(pu.id) ?? [] : [];

  if (!pu || !row)
    return (
      <Drawer title="Закупка" onClose={onClose}>
        <EmptyState title="Закупка не найдена" />
      </Drawer>
    );

  const s = row.supplier;
  const today = db.meta.today;
  const open = pu.state === 'ordered' || pu.state === 'partial';
  const canReceive = open && can('receivePurchase');
  const canApprove = pu.state === 'draft' && can('approvePurchase');
  const canPay = row.debt > 0 && can('paySupplier');
  const canCancel = (pu.state === 'draft' || pu.state === 'ordered') && can('createPurchase');
  const author = ix.employees.get(pu.authorId)?.name ?? '—';
  const approver = pu.approvedBy ? ix.employees.get(pu.approvedBy)?.name ?? '—' : null;

  // поля приёмки пустые: кладовщик вписывает, что пришло, или нажимает «Всё сходится»
  const startReceive = () => {
    setRecv({});
    setFinal(false);
    setError(null);
    setTried(false);
    setMode('receive');
  };

  const rRows = recvRows(pu, recv, final, ix);
  const emptyLines = rRows.filter((x) => x.now === null && x.wait > 0).length;

  const submitReceive = () => {
    setError(null);
    setTried(true);
    const err = recvError(rRows, final);
    if (err) return setError(err);
    const r = act('purchase.receive', { purchaseId: pu.id, lines: recvPayload(rRows, final), final }, me.id);
    if (!r.ok) return setError(r.error);
    toast(r.info ? `Приёмка проведена: ${r.info}` : 'Приёмка проведена');
    setRecv({});
    setMode('view');
  };

  const approve = () => {
    const r = act('purchase.approve', { purchaseId: pu.id }, me.id);
    if (!r.ok) return toast(r.error, 'error');
    toast(`Закупка № ${pu.number} подтверждена`);
  };
  const cancel = () => {
    const r = act('purchase.cancel', { purchaseId: pu.id }, me.id);
    if (!r.ok) return toast(r.error, 'error');
    toast(`Закупка № ${pu.number} отменена`);
  };

  const steps = [
    { label: PURCHASE_STATE.draft.label, state: 'done' as const },
    { label: PURCHASE_STATE.ordered.label, state: pu.state === 'draft' ? ('current' as const) : ('done' as const) },
    { label: PURCHASE_STATE.received.label, state: pu.state === 'received' ? ('done' as const) : open ? ('current' as const) : ('todo' as const) },
    ...(seeCost ? [{ label: 'Оплачена', state: pu.state === 'received' && row.debt === 0 && row.accepted > 0 ? ('done' as const) : pu.state === 'received' ? ('current' as const) : ('todo' as const) }] : []),
  ];

  const sheet = (
    <div className="stock-print-page">
      <h1>
        Закупка № {pu.number} · {s?.name}
      </h1>
      <div className="stock-print-meta">
        <span>от {fmt.date(pu.createdAt)}</span>
        <span>ожидаем {fmt.date(pu.expectedAt)}</span>
        <span>{LOCATION_NAMES[pu.location]}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th>№</th>
            <th>Товар</th>
            <th>Артикул</th>
            <th className="num">Коробок</th>
            <th className="num">Заказано</th>
            <th className="num">Принято</th>
            <th className="num">Брак</th>
          </tr>
        </thead>
        <tbody>
          {pu.lines.map((l, i) => {
            const p = ix.products.get(l.productId);
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{p?.name}</td>
                <td>{p?.sku}</td>
                <td className="num">{l.boxes}</td>
                <td className="num">{l.qty}</td>
                <td className="num">{l.received ?? ''}</td>
                <td className="num">{l.received !== null ? l.defect : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="stock-print-sign">
        <span>Принял: ____________</span>
        <span>Сдал (водитель): ____________</span>
      </div>
    </div>
  );

  const footer =
    mode === 'receive' ? (
      <>
        <span data-hint="purchases.recv-final">
          <Checkbox checked={final} onChange={setFinal}>
            Больше не ждём — закрыть закупку
          </Checkbox>
        </span>
        <span className="spacer" />
        <Button variant="ghost" onClick={() => setMode('view')}>
          Отмена
        </Button>
        <Button variant="primary" icon={<PackageCheck />} onClick={submitReceive} data-hint="purchases.recv-post">
          Провести приёмку
        </Button>
      </>
    ) : (
      <>
        {canCancel ? (
          <ConfirmButton variant="ghost" confirmText="Отменить закупку?" onConfirm={cancel}>
            Отменить закупку
          </ConfirmButton>
        ) : null}
        <span className="spacer" />
        <MoreMenu items={[{ label: 'Печать', icon: <Printer />, onClick: () => printer.print(sheet) }]} />
        {canPay ? (
          <Button variant={canApprove || canReceive ? 'secondary' : 'primary'} icon={<Wallet />} onClick={() => setPay(true)} data-hint="purchases.pay">
            Оплатить
          </Button>
        ) : null}
        {canApprove ? (
          <Button variant="primary" icon={<CheckCircle2 />} onClick={approve} data-hint="purchases.approve">
            Подтвердить закупку
          </Button>
        ) : null}
        {canReceive ? (
          <Button variant="primary" icon={<PackageCheck />} onClick={startReceive} data-hint="purchases.receive-start">
            {pu.state === 'partial' ? 'Принять остаток' : 'Принять товар'}
          </Button>
        ) : null}
      </>
    );

  return (
    <Drawer
      wide
      title={`Закупка № ${pu.number}`}
      sub={`${row.supplierName} · от ${fmt.date(pu.createdAt)}`}
      onClose={onClose}
      head={
        <div className="chips">
          <StatusChip s={PURCHASE_STATE[pu.state]} />
          {row.lateDays ? <Chip tone="bad">Опаздывает на {fmt.count(row.lateDays, 'день', 'дня', 'дней')}</Chip> : null}
          {row.hasDiff ? <Chip tone="warn">Есть расхождения</Chip> : null}
          {seeCost && row.debt > 0 && row.overdueDays ? <StatusChip s={overdueStatus(row.overdueDays)} /> : null}
          {seeCost && pu.state === 'received' && row.debt === 0 && row.accepted > 0 ? <Chip tone="ok">Оплачена</Chip> : null}
        </div>
      }
      footer={footer}
    >
      {mode === 'view' ? (
        <div data-hint="purchases.steps" style={{ alignSelf: 'flex-start' }}>
          <Steps items={steps} />
        </div>
      ) : null}

      {mode === 'view' ? (
        <div className="grid-2" data-hint="purchases.info">
          <StatList>
            <StatRow label="Поставщик" value={s ? <EntityLink type="supplier" id={s.id}>{s.name}</EntityLink> : '—'} />
            <StatRow label="Ожидаем" value={<span className={row.lateDays ? 'c-bad' : undefined}>{fmt.relDate(pu.expectedAt, today)}</span>} />
            <StatRow label="Куда" value={LOCATION_NAMES[pu.location]} />
            {pu.receivedAt ? <StatRow label="Принята" value={fmt.dateTime(pu.receivedAt)} /> : null}
          </StatList>
          <StatList>
            <StatRow label="Создал" value={author} />
            <StatRow label="Подтвердил" value={approver ?? <span className="c-warn">ждёт владельца</span>} />
            {seeCost ? <StatRow label="Сумма" value={fmt.money(pu.state === 'ordered' || pu.state === 'draft' ? row.ordered : row.accepted)} /> : null}
            {seeCost && pu.dueDate ? <StatRow label="Оплатить до" value={<span className={row.overdueDays ? 'c-bad' : undefined}>{fmt.date(pu.dueDate)}</span>} /> : null}
          </StatList>
        </div>
      ) : (
        <ReceiveBody pu={pu} rows={rRows} setRecv={setRecv} tried={tried} />
      )}
      {pu.comment && mode === 'view' ? <div className="t-13 ink-2">{pu.comment}</div> : null}

      {mode === 'view' ? (
      <section className="card is-flush" data-hint="purchases.lines">
        <div className="table-scroll">
          <table className="table table-dense pur-lines stock-tight-table">
            <thead>
              <tr>
                <th>Товар</th>
                <th className="num">Заказано</th>
                <th className="num">Принято</th>
                <th className="num">Брак</th>
                <th>Причина</th>
                {seeCost ? <th className="num">Цена</th> : null}
                {seeCost ? <th className="num">Сумма</th> : null}
              </tr>
            </thead>
            <tbody>
              {pu.lines.map((l) => {
                const p = ix.products.get(l.productId);
                const short = l.received !== null && l.received < l.qty;
                const boxes = p ? inBoxes(p, l.qty) : null;
                return (
                  <tr key={l.productId}>
                    <td>
                      {p ? (
                        <EntityLink type="product" id={p.id}>
                          <span className="pur-line-name">{p.name}</span>
                        </EntityLink>
                      ) : (
                        '—'
                      )}
                      <div className="cell-sub">{p?.sku}</div>
                    </td>
                    <td className="num">
                      <span className="w-600" title={boxes ?? `${l.boxes} × ${l.boxSize}`}>{fmt.qty(l.qty)}</span>
                      <span className="muted nowrap"> · {l.boxes} кор.</span>
                    </td>
                    <td className={cx('num', short && 'c-warn w-700')}>{l.received === null ? <span className="faint">—</span> : fmt.num(l.received)}</td>
                    <td className={cx('num', l.defect > 0 && 'c-bad w-700')}>{l.received === null ? <span className="faint">—</span> : l.defect ? fmt.num(l.defect) : <span className="faint">0</span>}</td>
                    <td>{l.diffReason ? <span className="pur-reason">{l.diffReason}</span> : <span className="faint">—</span>}</td>
                    {seeCost ? <td className="num muted">{fmt.price(l.price)}</td> : null}
                    {seeCost ? <td className="num w-600">{fmt.money((l.received === null ? l.qty : l.received - l.defect) * l.price)}</td> : null}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>Итого {fmt.count(pu.lines.length, 'позиция', 'позиции', 'позиций')}</td>
                <td className="num">{fmt.num(row.qty)}</td>
                <td className="num">{fmt.num(pu.lines.reduce((z, l) => z + (l.received ?? 0), 0))}</td>
                <td className="num">{fmt.num(row.defect)}</td>
                <td />
                {seeCost ? <td /> : null}
                {seeCost ? <td className="num">{fmt.money(pu.state === 'ordered' || pu.state === 'draft' ? row.ordered : row.accepted)}</td> : null}
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
      ) : null}

      {mode === 'receive' && rRows.some((x) => x.defNow > 0) ? (
        <Notice tone="warn">Брак {fmt.qty(rRows.reduce((z, x) => z + x.defNow, 0))} уйдёт в карантин. Поставщику оплачиваем только годный товар</Notice>
      ) : null}
      {mode === 'receive' && !final && (emptyLines > 0 || rRows.some((x) => x.now !== null && x.now < x.wait)) ? (
        <Notice>
          {emptyLines ? `Не заполнено ${fmt.count(emptyLines, 'строка', 'строки', 'строк')}. ` : ''}Привезли не всё — закупка станет «Принята частично», остальное будет ждать. Больше не ждём — отметьте «Закрыть закупку»
        </Notice>
      ) : null}
      {error ? (
        <div ref={errorRef}>
          <Notice tone="bad">{error}</Notice>
        </div>
      ) : null}

      {seeCost && mode === 'view' && (pu.state === 'partial' || pu.state === 'received') ? (
        <Card title="Оплаты" flush hint="purchases.pays">
          <div className="pur-pay-sum">
            <StatList>
              <StatRow label="Принято на сумму" value={fmt.money(row.accepted)} />
              <StatRow label="Оплачено" value={fmt.money(row.paid)} />
              <StatRow total label="Долг по закупке" value={<span className={row.overdueDays ? 'c-bad' : undefined}>{fmt.money(row.debt)}</span>} />
            </StatList>
          </div>
          {pays.length ? (
            <div className="list">
              {pays.map(({ pay: p, amount }) => (
                <div key={p.id} className="list-row">
                  <div className="grow">
                    <div className="w-600">
                      Платёж № {p.number} · {PAY_METHOD_NAMES[p.method]}
                    </div>
                    <div className="cell-sub">
                      {fmt.dateTime(p.at)} · {ix.employees.get(p.authorId)?.name ?? ''}
                    </div>
                  </div>
                  <span className="w-700 num">{fmt.money(amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="list-row muted">Оплат по закупке ещё не было</div>
          )}
        </Card>
      ) : null}

      {pay && s ? <PaySupplierModal supplierId={s.id} purchaseId={pu.id} onClose={() => setPay(false)} /> : null}
      {printer.element}
    </Drawer>
  );
}
