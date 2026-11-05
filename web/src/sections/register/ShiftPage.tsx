/* Касса → Смена: текущая смена, закрытие с пересчётом наличных, архив смен. */
import { useMemo, useState } from 'react';
import { ReceiptText } from 'lucide-react';
import type { Shift } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { indexes, shiftSummary, type ShiftSummary } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { Button, Card, Chip, ConfirmButton, DataTable, Drawer, EmptyState, Field, Kpi, MoneyInput, Notice, StatList, StatRow, fmt, toast, type Column } from '../../ui';
import { OpenShiftCard, ShiftBadge } from './ShiftParts';
import { PAY_KIND_NAMES, openShift, payKind, receiptContents, receiptsOfShift } from './lib';

interface Row {
  s: Shift;
  sum: ShiftSummary;
  seller: string;
}

function diffChip(d: number | null) {
  if (d === null) return <Chip tone="info">Открыта</Chip>;
  if (d === 0) return <Chip tone="ok">Сошлась</Chip>;
  return <Chip tone={d < 0 ? 'bad' : 'warn'}>{d < 0 ? `Не хватает ${fmt.money(-d)}` : `Излишек ${fmt.money(d)}`}</Chip>;
}

export default function ShiftPage() {
  const db = useDB();
  const version = useDBVersion();
  const { me, role } = useSession();
  const shift = useMemo(() => openShift(db), [db, version]);
  const sum = shift ? shiftSummary(db, shift.id) : null;
  const [counted, setCounted] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [closed, setClosed] = useState<{ number: number; info: string; diff: number } | null>(null);
  const [view, setView] = useState<Shift | null>(null);

  const rows = useMemo<Row[]>(() => {
    const ix = indexes(db);
    return db.shifts
      .filter((s) => role !== 'seller' || s.sellerId === me.id)
      .map((s) => ({ s, sum: shiftSummary(db, s.id), seller: ix.employees.get(s.sellerId)?.short ?? '—' }))
      .reverse();
  }, [db, version, role, me.id]);

  const seller = shift ? indexes(db).employees.get(shift.sellerId) : undefined;
  const lastClosed = useMemo(() => {
    for (let i = db.shifts.length - 1; i >= 0; i--) {
      const x = db.shifts[i];
      if (x.closedAt && (role !== 'seller' || x.sellerId === me.id)) return x;
    }
    return undefined;
  }, [db, version, role, me.id]);
  const diff = sum && counted !== '' ? Number(counted) - sum.expectedCash : null;

  const close = () => {
    if (!shift || counted === '') {
      setError('Пересчитайте наличные в кассе и введите сумму');
      return;
    }
    const n = shift.number;
    const r = dispatch('shift.close', { shiftId: shift.id, countedCash: Number(counted) }, me.id);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    setClosed({ number: n, info: r.info ?? 'Смена закрыта', diff: diff ?? 0 });
    setCounted('');
    toast(`Смена № ${n} закрыта. ${r.info ?? ''}`.trim());
  };

  const columns: Column<Row>[] = [
    { key: 'date', header: 'Дата', render: (x) => <span className="nowrap">{fmt.date(x.s.openedAt)}, {fmt.weekday(x.s.openedAt, true)}</span>, sort: (x) => x.s.openedAt, csv: (x) => fmt.dateShort(x.s.openedAt, true) },
    { key: 'number', header: 'Смена', render: (x) => <span className="cell-title">№ {x.s.number}</span>, sort: (x) => x.s.number },
    { key: 'seller', header: 'Продавец', render: (x) => <span className="nowrap">{x.seller}</span>, sort: (x) => x.seller, hidden: role === 'seller' },
    { key: 'time', header: 'Время', render: (x) => <span className="num nowrap">{fmt.time(x.s.openedAt)}–{x.s.closedAt ? fmt.time(x.s.closedAt) : 'сейчас'}</span>, csv: (x) => `${fmt.time(x.s.openedAt)}–${x.s.closedAt ? fmt.time(x.s.closedAt) : ''}` },
    { key: 'receipts', header: 'Чеков', align: 'right', render: (x) => fmt.num(x.sum.receipts), sort: (x) => x.sum.receipts, total: (rs) => fmt.num(rs.reduce((a, x) => a + x.sum.receipts, 0)) },
    { key: 'total', header: 'Выручка', align: 'right', render: (x) => <span className="w-600">{fmt.money(x.sum.total)}</span>, sort: (x) => x.sum.total, total: (rs) => fmt.money(rs.reduce((a, x) => a + x.sum.total, 0)) },
    { key: 'cash', header: 'Наличные', align: 'right', render: (x) => fmt.money(x.sum.cash), sort: (x) => x.sum.cash, total: (rs) => fmt.money(rs.reduce((a, x) => a + x.sum.cash, 0)) },
    { key: 'card', header: 'Карта', align: 'right', render: (x) => fmt.money(x.sum.card), sort: (x) => x.sum.card, total: (rs) => fmt.money(rs.reduce((a, x) => a + x.sum.card, 0)) },
    { key: 'refunds', header: 'Возвраты', align: 'right', render: (x) => (x.sum.refunds ? fmt.money(x.sum.refunds) : <span className="faint">—</span>), sort: (x) => x.sum.refunds, total: (rs) => fmt.money(rs.reduce((a, x) => a + x.sum.refunds, 0)) },
    {
      key: 'diff',
      header: 'Расхождение',
      align: 'right',
      render: (x) => diffChip(x.sum.difference),
      sort: (x) => x.sum.difference,
      csv: (x) => x.sum.difference,
      total: (rs) => {
        const d = rs.reduce((a, x) => a + (x.sum.difference ?? 0), 0);
        return d === 0 ? '0 ₽' : `${d > 0 ? '+' : ''}${fmt.money(d)}`;
      },
    },
  ];

  const today = db.meta.today;
  const weekFrom = fmt.addDays(today, -6);
  const monthFrom = today.slice(0, 8) + '01';

  return (
    <>
      <PageHeader section="register" counts={{ receipts: sum?.receipts ?? null }} actions={<ShiftBadge shift={shift} />} />

      {closed ? (
        <Notice tone={closed.diff === 0 ? 'ok' : 'warn'} title={`Смена № ${closed.number} закрыта`}>
          {closed.info}. Выручка записана в деньги магазина.
        </Notice>
      ) : null}

      {shift && sum ? (
        <div className="reg-shift-grid">
          <div className="col-4" style={{ minWidth: 0 }}>
            <div className="grid-4">
              <Kpi label="Чеков" value={fmt.num(sum.receipts)} />
              <Kpi label="Выручка" value={fmt.money(sum.total)} />
              <Kpi label="Средний чек" value={fmt.money(sum.receipts ? Math.round(sum.total / sum.receipts) : 0)} />
              <Kpi label="В кассе" value={fmt.money(sum.expectedCash)} />
            </div>
            <Card
              title={`Смена № ${shift.number}`}
              actions={
                <Button size="sm" variant="ghost" icon={<ReceiptText />} onClick={() => setView(shift)}>
                  Чеки смены
                </Button>
              }
            >
              <div className="grid-2 reg-shift-stats">
                <StatList>
                  <StatRow label="Продавец" value={seller?.name ?? '—'} />
                  <StatRow label="Открыта" value={`${fmt.relDate(shift.openedAt, today)}, ${fmt.time(shift.openedAt)}`} />
                  <StatRow label="Чеков продажи" value={fmt.num(sum.receipts)} />
                  <StatRow label="Возвраты" value={sum.refundsCount ? `${fmt.count(sum.refundsCount, 'чек', 'чека', 'чеков')} · ${fmt.money(sum.refunds)}` : 'нет'} />
                </StatList>
                <StatList>
                  <StatRow label="Выручка наличными" value={fmt.money(sum.cash)} />
                  <StatRow label="Выручка картой" value={fmt.money(sum.card)} />
                  <StatRow label="Размен на начало" value={fmt.money(shift.openingCash)} />
                  <StatRow total label="Ожидается наличных" value={fmt.money(sum.expectedCash)} />
                </StatList>
              </div>
            </Card>
          </div>

          <Card title="Закрытие смены">
            <form
              className="col-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (diff === null || diff === 0) close();
              }}
            >
              <div className="t-13 ink-2">Пересчитайте наличные в кассе вместе с разменом и введите сумму.</div>
              <Field label="Пересчитано наличных">
                <MoneyInput value={counted} onChange={setCounted} size="lg" placeholder={fmt.num(sum.expectedCash)} autoFocus />
              </Field>
              <StatList>
                <StatRow label="Ожидалось" value={fmt.money(sum.expectedCash)} />
                <StatRow label="Пересчитано" value={counted === '' ? '—' : fmt.money(Number(counted))} />
              </StatList>
              {diff === null ? null : diff === 0 ? (
                <div className="reg-change">
                  <span className="reg-change-label">Касса сошлась</span>
                  <span className="reg-change-value num">0 ₽</span>
                </div>
              ) : (
                <div className={diff < 0 ? 'reg-change is-short' : 'reg-change is-over'}>
                  <span className="reg-change-label">{diff < 0 ? 'Не хватает' : 'Излишек'}</span>
                  <span className="reg-change-value num">{fmt.money(Math.abs(diff))}</span>
                </div>
              )}
              {error ? <Notice tone="bad">{error}</Notice> : null}
              {diff !== null && diff !== 0 ? (
                <ConfirmButton variant="primary" size="lg" block onConfirm={close} confirmText="Закрыть с расхождением?" yes="Да, закрыть">
                  Закрыть смену
                </ConfirmButton>
              ) : (
                <Button variant="primary" size="lg" block type="submit" disabled={counted === ''}>
                  Закрыть смену
                </Button>
              )}
            </form>
          </Card>
        </div>
      ) : (
        <div className="reg-shift-grid">
          {lastClosed ? (
            <LastShiftCard shift={lastClosed} onOpen={() => setView(lastClosed)} />
          ) : (
            <Card title="Смена не открыта">
              <div className="t-14 ink-2">Продавать и возвращать деньги можно только в открытой смене.</div>
            </Card>
          )}
          <OpenShiftCard hideLast={!!lastClosed} />
        </div>
      )}

      <div className="reg-shifts">
      <DataTable<Row>
        id="register-shifts"
        title="Архив смен"
        rows={rows}
        columns={columns}
        rowKey={(x) => x.s.id}
        search={{ placeholder: 'Продавец или номер смены', text: (x) => `${x.seller} №${x.s.number} ${x.s.number}` }}
        filters={[
          {
            key: 'period',
            label: 'Период',
            options: [
              { value: 'all', label: 'Все' },
              { value: 'week', label: 'Неделя', test: (x) => x.s.openedAt.slice(0, 10) >= weekFrom },
              { value: 'month', label: 'Месяц', test: (x) => x.s.openedAt.slice(0, 10) >= monthFrom },
            ],
          },
          {
            key: 'diff',
            label: 'Расхождение',
            showCounts: true,
            options: [
              { value: 'all', label: 'Все' },
              { value: 'bad', label: 'С расхождением', test: (x) => x.sum.difference !== null && x.sum.difference !== 0 },
            ],
          },
        ]}
        defaultSort={{ key: 'date', dir: 'desc' }}
        onRowClick={(x) => setView(x.s)}
        exportName="Смены кассы"
        totalLabel={(n) => `Итого · ${fmt.count(n, 'смена', 'смены', 'смен')}`}
        empty={<EmptyState title="Смен пока не было" />}
      />
      </div>

      {view ? <ShiftDrawer shift={view} onClose={() => setView(null)} /> : null}
    </>
  );
}

/* ---------- прошлая смена, пока новая не открыта ---------- */

function LastShiftCard({ shift, onOpen }: { shift: Shift; onOpen: () => void }) {
  const db = useDB();
  const sum = shiftSummary(db, shift.id);
  const seller = indexes(db).employees.get(shift.sellerId);
  return (
    <Card
      title={`Прошлая смена № ${shift.number}`}
      actions={
        <>
          {diffChip(sum.difference)}
          <Button size="sm" variant="ghost" icon={<ReceiptText />} onClick={onOpen}>
            Чеки смены
          </Button>
        </>
      }
    >
      <div className="grid-2 reg-shift-stats">
        <StatList>
          <StatRow label="Продавец" value={seller?.name ?? '—'} />
          <StatRow label="Время" value={`${fmt.relDate(shift.openedAt, db.meta.today)}, ${fmt.time(shift.openedAt)}–${fmt.time(shift.closedAt)}`} />
          <StatRow label="Чеков продажи" value={fmt.num(sum.receipts)} />
          <StatRow label="Выручка" value={fmt.money(sum.total)} />
          <StatRow label="Возвраты" value={sum.refundsCount ? `${fmt.count(sum.refundsCount, 'чек', 'чека', 'чеков')} · ${fmt.money(sum.refunds)}` : 'нет'} />
        </StatList>
        <StatList>
          <StatRow label="Наличными" value={fmt.money(sum.cash)} />
          <StatRow label="Картой" value={fmt.money(sum.card)} />
          <StatRow label="Ожидалось в кассе" value={fmt.money(sum.expectedCash)} />
          <StatRow label="Пересчитано" value={fmt.money(sum.countedCash ?? 0)} />
          <StatRow total label="Расхождение" value={sum.difference ? `${sum.difference > 0 ? '+' : ''}${fmt.money(sum.difference)}` : '0 ₽'} />
        </StatList>
      </div>
    </Card>
  );
}

/* ---------- карточка смены: итоги и чеки ---------- */

function ShiftDrawer({ shift, onClose }: { shift: Shift; onClose: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const openEntity = useOpenEntity();
  const sum = shiftSummary(db, shift.id);
  const list = useMemo(() => receiptsOfShift(db, shift.id), [db, version, shift.id]);
  const seller = indexes(db).employees.get(shift.sellerId);
  return (
    <Drawer
      title={`Смена № ${shift.number}`}
      sub={`${fmt.date(shift.openedAt)} · ${seller?.name ?? '—'} · ${fmt.time(shift.openedAt)}–${shift.closedAt ? fmt.time(shift.closedAt) : 'сейчас'}`}
      head={<div className="chips">{diffChip(sum.difference)}</div>}
      onClose={onClose}
      wide
    >
      <div className="grid-2">
        <section className="card card-pad">
          <StatList>
            <StatRow label="Чеков продажи" value={fmt.num(sum.receipts)} />
            <StatRow label="Выручка" value={fmt.money(sum.total)} />
            <StatRow label="Возвраты" value={sum.refundsCount ? `${sum.refundsCount} · ${fmt.money(sum.refunds)}` : 'нет'} />
            <StatRow label="Картой" value={fmt.money(sum.card)} />
          </StatList>
        </section>
        <section className="card card-pad">
          <StatList>
            <StatRow label="Размен на начало" value={fmt.money(shift.openingCash)} />
            <StatRow label="Наличными за смену" value={fmt.money(sum.cash)} />
            <StatRow label="Ожидалось в кассе" value={fmt.money(sum.expectedCash)} />
            <StatRow total label="Пересчитано" value={sum.countedCash === null ? 'смена открыта' : fmt.money(sum.countedCash)} />
          </StatList>
        </section>
      </div>
      <DataTable
        rows={list}
        rowKey={(r) => r.id}
        dense
        onRowClick={(r) => openEntity('receipt', r.id)}
        search={{ placeholder: 'Номер или товар', text: (r) => `№${r.number} ${r.number} ${receiptContents(db, r)}` }}
        columns={[
          { key: 'n', header: 'Чек', render: (r) => <span className="cell-title">№ {r.number}</span>, sort: (r) => r.number },
          { key: 't', header: 'Время', render: (r) => fmt.time(r.at), sort: (r) => r.at },
          { key: 'c', header: 'Состав', render: (r) => <span className="ellipsis reg-td-contents" style={{ display: 'block' }}>{receiptContents(db, r)}</span> },
          { key: 'p', header: 'Оплата', render: (r) => <Chip tone={r.kind === 'refund' ? 'warn' : 'neutral'}>{PAY_KIND_NAMES[payKind(r)]}</Chip> },
          {
            key: 's',
            header: 'Сумма',
            align: 'right',
            render: (r) => <span className="w-600">{r.kind === 'refund' ? `−${fmt.money(r.total)}` : fmt.money(r.total)}</span>,
            sort: (r) => (r.kind === 'refund' ? -r.total : r.total),
            total: (rs) => fmt.money(rs.reduce((a, r) => a + (r.kind === 'refund' ? -r.total : r.total), 0)),
          },
        ]}
        defaultSort={{ key: 't', dir: 'desc' }}
        totalLabel={(n) => `Итого · ${fmt.count(n, 'чек', 'чека', 'чеков')}`}
      />
    </Drawer>
  );
}
