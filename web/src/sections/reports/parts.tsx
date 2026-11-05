import { createContext, useContext, useState, type ReactNode } from 'react';
import { ChevronDown, Info, Printer } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity, type EntityType } from '../../shell/entities';
import { DataTable, Drawer, MoreMenu, cx, fmt, type Column, type MenuItem } from '../../ui';
import { useDB } from '../../data/store';
import { PeriodBar } from '../overview/PeriodBar';
import { compareRange, hasCompare, rangeOf, rangeText, change, type PeriodState } from '../overview/period';

/* ---------- общий период вкладок ---------- */

export const ReportPeriodCtx = createContext<{ period: PeriodState; setPeriod: (p: PeriodState) => void } | null>(null);

export function useReportPeriod() {
  const db = useDB();
  const ctx = useContext(ReportPeriodCtx);
  if (!ctx) throw new Error('useReportPeriod вне раздела «Отчёты»');
  const today = db.meta.today;
  const range = rangeOf(ctx.period, today);
  const prev = compareRange(ctx.period, today);
  const cmp = hasCompare(ctx.period, today, db.meta.startDate);
  return { ...ctx, today, range, prev, cmp, label: rangeText(range) };
}

/** Шапка вкладки отчёта и строка периода. */
export function ReportTop({ menu = [] }: { menu?: MenuItem[] }) {
  const db = useDB();
  const { period, setPeriod, today } = useReportPeriod();
  return (
    <>
      <PageHeader section="reports" actions={<MoreMenu items={[...menu, { label: 'Печать', icon: <Printer />, onClick: () => window.print() }]} />} />
      <PeriodBar value={period} onChange={setPeriod} today={today} start={db.meta.startDate} />
    </>
  );
}

/** Свёрнутый блок «Как считается»: формула, источник, возвраты, неполные данные. */
export function HowCalc({ rows }: { rows: [string, ReactNode][] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="card rp-how">
      <button type="button" className="rp-how-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <Info />
        <span className="grow">Как считается</span>
        <ChevronDown className={cx('rp-chevron', open && 'is-open')} />
      </button>
      {open ? (
        <dl className="rp-how-body">
          {rows.map(([k, v]) => (
            <div key={k} className="rp-how-row">
              <dt>{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </section>
  );
}

/** Изменение к прошлому периоду, цветом — хорошо или плохо. */
export function DeltaText({ cur, prev, good = 'up' }: { cur: number; prev: number | null; good?: 'up' | 'down' }) {
  const c = change(cur, prev);
  if (c === null) return <span className="faint">—</span>;
  const dir = c > 0.05 ? 'up' : c < -0.05 ? 'down' : 'flat';
  const tone = dir === 'flat' ? 'muted' : dir === good ? 'c-ok' : 'c-bad';
  return <span className={cx('rp-delta', tone)}>{fmt.delta(c)}</span>;
}

/** Маржа; если себестоимость известна не по всем строкам — пометка с подсказкой. */
export function MarginText({ margin, share }: { margin: number | null; share: number }) {
  if (margin === null) return <span className="faint" title="Себестоимость неизвестна">нет данных</span>;
  return (
    <span className="rp-margin" title={share < 0.999 ? `Неполные данные: себестоимость известна по ${Math.round(share * 100)} % строк` : undefined}>
      {fmt.pct(margin)}
      {share < 0.999 ? <Info className="rp-warn-icon" aria-label="Неполные данные" /> : null}
    </span>
  );
}

/** Значок «неполные данные»: себестоимость известна не по всем строкам. */
export function PartialMark({ share }: { share: number }) {
  return (
    <span className="rp-partial" title={`Неполные данные: себестоимость известна по ${Math.round(share * 100)} % строк — прибыль занижена`}>
      <Info className="rp-warn-icon" aria-label="Неполные данные" />
    </span>
  );
}

/* ---------- документы за итогом ---------- */

export interface DocRow {
  key: string;
  at: string;
  kind: string; // «Чек», «Заказ», «Доставка», «Товар»
  title: string;
  sub: string;
  amount: number | null;
  entity: { type: EntityType; id: string };
}

/** Боковая панель со списком исходных документов: строка открывает карточку. */
export function DocsDrawer({ title, sub, rows, onClose, amountLabel = 'Сумма', extra }: { title: string; sub?: string; rows: DocRow[]; onClose: () => void; amountLabel?: string; extra?: ReactNode }) {
  const open = useOpenEntity();
  const cols: Column<DocRow>[] = [
    { key: 'at', header: 'Дата', render: (r) => (r.at ? fmt.date(r.at) : '—'), sort: (r) => r.at, width: 96 },
    {
      key: 'title',
      header: 'Документ',
      render: (r) => (
        <div>
          <div className="cell-title">{r.title}</div>
          <div className="cell-sub">{r.sub}</div>
        </div>
      ),
      sort: (r) => r.title,
      csv: (r) => `${r.title} · ${r.sub}`,
    },
    { key: 'amount', header: amountLabel, align: 'right', render: (r) => (r.amount === null ? '—' : fmt.money(r.amount)), sort: (r) => r.amount, total: (rs) => fmt.money(rs.reduce((s, r) => s + (r.amount ?? 0), 0)) },
  ];
  return (
    <Drawer title={title} sub={sub} onClose={onClose} wide>
      {extra}
      <DataTable
        card={false}
        rows={rows}
        columns={cols}
        rowKey={(r) => r.key}
        defaultSort={{ key: 'at', dir: 'desc' }}
        search={{ placeholder: 'Поиск по документам', text: (r) => `${r.title} ${r.sub}` }}
        onRowClick={(r) => open(r.entity.type, r.entity.id)}
        exportName={title}
        dense
        pageSize={40}
      />
    </Drawer>
  );
}

export const money = (v: number) => fmt.money(v);
export const qty = (v: number) => fmt.num(v);
export const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
