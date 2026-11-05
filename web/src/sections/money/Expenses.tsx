/* Расходы: помесячно по категориям и список записей. */
import { useMemo, useState } from 'react';
import { Receipt } from 'lucide-react';
import type { Payment } from '../../data/types';
import { ACCOUNT_NAMES, EXPENSE_CATEGORIES, PAY_METHOD_NAMES } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { plusMonths } from '../../data/dates';
import { PageHeader } from '../../shell/PageHeader';
import { Button, DataTable, Kpi, MoreMenu, Select, cx, fmt, type Column } from '../../ui';
import { MoneyModalHost, useMoneyMenu, type MoneyModal } from './actions';
import { PERIOD_OPTIONS, clean, periodBounds, useMoneyPerms, type PeriodKey } from './lib';
import { useMoneyCounts } from './counts';

interface CatRow {
  cat: string;
  byMonth: Record<string, number>;
  total: number;
}

interface ExpRow {
  p: Payment;
  author: string;
}

export default function Expenses() {
  const db = useDB();
  const v = useDBVersion();
  const perms = useMoneyPerms();
  const counts = useMoneyCounts();
  const [modal, setModal] = useState<MoneyModal>(null);
  const [cat, setCat] = useState('');
  const [period, setPeriod] = useState<PeriodKey>('all');
  const menu = useMoneyMenu(setModal, ['expense']);
  const today = db.meta.today;

  const { months, cats, list } = useMemo(() => {
    const months: string[] = [];
    for (let m = db.meta.startDate.slice(0, 7); m <= today.slice(0, 7); m = plusMonths(m + '-01', 1).slice(0, 7)) months.push(m);
    const map = new Map<string, CatRow>();
    for (const c of EXPENSE_CATEGORIES) map.set(c, { cat: c, byMonth: {}, total: 0 });
    const list: ExpRow[] = [];
    const ix = indexes(db);
    for (const p of db.payments) {
      if (p.kind !== 'expense' || p.status !== 'posted') continue;
      const c = p.expenseCategory ?? 'Другое';
      let row = map.get(c);
      if (!row) {
        row = { cat: c, byMonth: {}, total: 0 };
        map.set(c, row);
      }
      const m = p.at.slice(0, 7);
      row.byMonth[m] = (row.byMonth[m] ?? 0) + p.amount;
      row.total += p.amount;
      list.push({ p, author: ix.employees.get(p.authorId)?.short ?? '—' });
    }
    return { months, cats: [...map.values()], list };
  }, [db, v, today]);

  const thisMonth = today.slice(0, 7);
  const prevMonth = plusMonths(thisMonth + '-01', -1).slice(0, 7);
  const kpi = useMemo(() => {
    const sumOf = (m: string) => cats.reduce((s, c) => s + (c.byMonth[m] ?? 0), 0);
    const full = months.filter((m) => m !== thisMonth && m + '-01' >= db.meta.startDate);
    const avg = full.length ? Math.round(full.reduce((s, m) => s + sumOf(m), 0) / full.length) : 0;
    const top = [...cats].sort((a, b) => (b.byMonth[prevMonth] ?? 0) - (a.byMonth[prevMonth] ?? 0))[0];
    return { cur: sumOf(thisMonth), prev: sumOf(prevMonth), avg, top };
  }, [cats, months, thisMonth, prevMonth, db]);

  const pivotCols: Column<CatRow>[] = [
    { key: 'cat', header: 'Категория', sort: (r) => r.cat, csv: (r) => r.cat, render: (r) => <span className={cx('w-600', cat === r.cat && 'c-ok')}>{r.cat}</span> },
    ...months.map<Column<CatRow>>((m) => ({
      key: m,
      header: fmt.monthName(m, false) + (m === thisMonth ? ', по ' + fmt.date(today) : ''),
      align: 'right',
      sort: (r) => r.byMonth[m] ?? 0,
      csv: (r) => r.byMonth[m] ?? 0,
      render: (r) => (r.byMonth[m] ? fmt.money(r.byMonth[m]) : <span className="faint">—</span>),
      total: (rs) => fmt.money(rs.reduce((s, r) => s + (r.byMonth[m] ?? 0), 0)),
    })),
    {
      key: 'total',
      header: 'Всего',
      align: 'right',
      sort: (r) => r.total,
      csv: (r) => r.total,
      render: (r) => <span className="w-700">{fmt.money(r.total)}</span>,
      total: (rs) => fmt.money(rs.reduce((s, r) => s + r.total, 0)),
    },
  ];

  const { from, to } = periodBounds(period, today, db.meta.startDate);
  const shown = useMemo(() => list.filter((r) => (!cat || r.p.expenseCategory === cat) && r.p.at.slice(0, 10) >= from && r.p.at.slice(0, 10) <= to), [list, cat, from, to]);

  const listCols: Column<ExpRow>[] = [
    { key: 'at', header: 'Дата', sort: (r) => r.p.at, csv: (r) => r.p.at.slice(0, 10), width: 120, render: (r) => <span className="nowrap">{fmt.relDate(r.p.at, today)}</span> },
    { key: 'cat', header: 'Категория', sort: (r) => r.p.expenseCategory ?? '', csv: (r) => r.p.expenseCategory ?? '', width: 200, render: (r) => <span className="w-600">{r.p.expenseCategory}</span> },
    {
      key: 'amount',
      header: 'Сумма',
      align: 'right',
      sort: (r) => r.p.amount,
      csv: (r) => r.p.amount,
      width: 120,
      render: (r) => <span className="w-700">{fmt.money(r.p.amount)}</span>,
      total: (rs) => fmt.money(rs.reduce((s, r) => s + r.p.amount, 0)),
    },
    {
      key: 'acc',
      header: 'Касса или счёт',
      sort: (r) => r.p.account,
      csv: (r) => ACCOUNT_NAMES[r.p.account],
      width: 170,
      render: (r) => (
        <span className="nowrap">
          {ACCOUNT_NAMES[r.p.account]}
          <span className="muted"> · {PAY_METHOD_NAMES[r.p.method].toLowerCase()}</span>
        </span>
      ),
    },
    { key: 'comment', header: 'Комментарий', csv: (r) => clean(r.p.comment), render: (r) => <span className="ellipsis money-comment">{clean(r.p.comment) === r.p.expenseCategory ? '' : clean(r.p.comment)}</span> },
    { key: 'author', header: 'Автор', sort: (r) => r.author, csv: (r) => r.author, width: 110, render: (r) => <span className="ink-2 nowrap">{r.author}</span> },
  ];

  return (
    <>
      <PageHeader
        section="money"
        counts={counts}
        actions={
          <>
            <MoreMenu items={menu} />
            {perms.expense ? (
              <Button variant="primary" icon={<Receipt />} onClick={() => setModal({ kind: 'expense', category: cat || undefined })}>
                Записать расход
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid-4">
        <Kpi label={`Расходы, ${fmt.monthName(thisMonth, false).toLowerCase()} по ${fmt.date(today)}`} value={fmt.money(kpi.cur)} />
        <Kpi label={`Расходы, ${fmt.monthName(prevMonth, false).toLowerCase()}`} value={fmt.money(kpi.prev)} />
        <Kpi label="В среднем за месяц" value={fmt.money(kpi.avg)} />
        <Kpi label={`Крупнейшая статья: ${(kpi.top?.cat ?? '—').toLowerCase()}`} value={fmt.money(kpi.top?.byMonth[prevMonth] ?? 0)} />
      </div>
      <DataTable
        id="money-exp-pivot"
        title="По категориям и месяцам"
        rows={cats}
        columns={pivotCols}
        rowKey={(r) => r.cat}
        defaultSort={{ key: 'total', dir: 'desc' }}
        onRowClick={(r) => setCat((c) => (c === r.cat ? '' : r.cat))}
        selectedKey={cat || null}
        exportName="Расходы по категориям"
        totalLabel={() => 'Итого'}
        pageSize={30}
      />
      <DataTable
        id="money-exp-list"
        title="Записи"
        rows={shown}
        columns={listCols}
        rowKey={(r) => r.p.id}
        search={{ placeholder: 'Комментарий, сумма, автор', text: (r) => `${r.p.comment} ${r.p.amount} ${r.author} ${r.p.expenseCategory}` }}
        toolbar={
          <>
            <Select
              size="sm"
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              options={[{ value: '', label: 'Все категории' }, ...cats.map((c) => ({ value: c.cat, label: c.cat }))]}
              aria-label="Категория"
              style={{ width: 210 }}
            />
            <Select size="sm" value={period} onChange={(e) => setPeriod(e.target.value as PeriodKey)} options={PERIOD_OPTIONS} aria-label="Период" style={{ width: 170 }} />
          </>
        }
        defaultSort={{ key: 'at', dir: 'desc' }}
        exportName="Расходы"
        totalLabel={(n) => `Итого · ${fmt.num(n)}`}
        pageSize={20}
      />
      <MoneyModalHost modal={modal} onClose={() => setModal(null)} onOpen={setModal} />
    </>
  );
}
