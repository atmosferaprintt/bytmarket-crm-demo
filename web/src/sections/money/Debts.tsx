/* Долги покупателей — по клиентам: долг, просрочка, отсрочка, лимит, последняя оплата. */
import { useMemo, useState } from 'react';
import { BellRing, FileText, HandCoins } from 'lucide-react';
import type { Client, ID } from '../../data/types';
import { CLIENT_SEGMENT_NAMES } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { clientBalances, indexes, type ClientBalance } from '../../data/selectors';
import { useScoped } from '../../roles/scope';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { TaskModal } from '../../shell/TaskModal';
import { Button, DataTable, EmptyState, Kpi, MoreMenu, StatusChip, fmt, overdueStatus, type Column, type FilterDef } from '../../ui';
import { MoneyModalHost, useMoneyMenu, type MoneyModal } from './actions';
import { clientPayInfo, deferText, useMoneyPerms, type ClientPayInfo } from './lib';
import { useMoneyCounts } from './counts';
import { useNarrow } from './parts';

interface DRow {
  c: Client;
  b: ClientBalance;
  owner: string;
  last: ClientPayInfo | undefined;
}

export default function Debts() {
  const db = useDB();
  const v = useDBVersion();
  const { clients } = useScoped();
  const { role } = useSession();
  const perms = useMoneyPerms();
  const open = useOpenEntity();
  const counts = useMoneyCounts();
  const [modal, setModal] = useState<MoneyModal>(null);
  const [task, setTask] = useState<ID | null>(null);
  const menu = useMoneyMenu(setModal, ['accept']);
  const today = db.meta.today;
  const narrow = useNarrow();
  const full = role === 'owner' || role === 'accountant';

  const rows = useMemo<DRow[]>(() => {
    const bal = clientBalances(db);
    const info = clientPayInfo(db);
    const ix = indexes(db);
    const out: DRow[] = [];
    for (const c of clients) {
      const b = bal.get(c.id);
      if (!b || (b.debt <= 0 && b.advance <= 0 && b.pending <= 0)) continue;
      out.push({ c, b, owner: c.ownerId ? ix.employees.get(c.ownerId)?.short ?? '—' : 'Без ответственного', last: info.get(c.id) });
    }
    return out;
  }, [db, v, clients]);

  const kpi = useMemo(() => {
    let debt = 0;
    let overdue = 0;
    let overdueN = 0;
    let overLimit = 0;
    let advance = 0;
    for (const r of rows) {
      debt += r.b.debt;
      overdue += r.b.overdue;
      if (r.b.overdue > 0) overdueN++;
      if (r.b.creditLimit > 0 && r.b.creditLeft < 0) overLimit++;
      advance += r.b.advance;
    }
    return { debt, overdue, overdueN, overLimit, advance };
  }, [rows]);

  const columns: Column<DRow>[] = [
    {
      key: 'client',
      header: 'Клиент и ответственный',
      sort: (r) => r.c.name,
      csv: (r) => `${r.c.name} (${r.owner})`,
      render: (r) => (
        <div className="money-party">
          <div className="cell-title ellipsis">{r.c.name}</div>
          <div className="cell-sub ellipsis">
            {CLIENT_SEGMENT_NAMES[r.c.segment]} · {r.owner}
            {narrow ? ` · отсрочка ${deferText(r.c.deferDays).toLowerCase()}` : ''}
          </div>
        </div>
      ),
    },
    {
      key: 'debt',
      header: 'Долг',
      align: 'right',
      sort: (r) => r.b.debt,
      csv: (r) => r.b.debt,
      width: 96,
      render: (r) => (r.b.debt ? <span className="w-700">{fmt.money(r.b.debt)}</span> : <span className="faint">—</span>),
      total: (rs) => fmt.money(rs.reduce((s, r) => s + r.b.debt, 0)),
    },
    {
      key: 'overdue',
      header: 'Просрочено',
      align: 'right',
      sort: (r) => r.b.overdue,
      csv: (r) => r.b.overdue,
      width: 100,
      render: (r) => (r.b.overdue ? <span className="w-700 c-bad">{fmt.money(r.b.overdue)}</span> : <span className="faint">—</span>),
      total: (rs) => fmt.money(rs.reduce((s, r) => s + r.b.overdue, 0)),
    },
    {
      key: 'days',
      header: 'Дней просрочки',
      sort: (r) => r.b.maxOverdueDays,
      csv: (r) => r.b.maxOverdueDays || '',
      width: 130,
      render: (r) => (r.b.maxOverdueDays > 0 ? <StatusChip s={overdueStatus(r.b.maxOverdueDays)} /> : r.b.advance > 0 && !r.b.debt ? <StatusChip s={{ label: 'Аванс', tone: 'info' }} /> : <span className="faint">—</span>),
    },
    { key: 'defer', header: 'Отсрочка', hidden: narrow, sort: (r) => r.c.deferDays, csv: (r) => r.c.deferDays, width: 80, render: (r) => deferText(r.c.deferDays) },
    {
      key: 'limit',
      header: 'Лимит и остаток',
      align: 'right',
      sort: (r) => (r.b.creditLimit > 0 ? r.b.creditLeft : null),
      csv: (r) => (r.b.creditLimit ? `${r.b.creditLimit} / ${r.b.creditLeft}` : ''),
      width: 120,
      render: (r) =>
        r.b.creditLimit > 0 ? (
          <div>
            <div>{fmt.money(r.b.creditLimit)}</div>
            <div className={r.b.creditLeft < 0 ? 'c-bad w-600 t-12' : 'cell-sub'}>{r.b.creditLeft < 0 ? `сверх на ${fmt.money(-r.b.creditLeft)}` : `остаток ${fmt.money(r.b.creditLeft)}`}</div>
          </div>
        ) : (
          <span className="faint">Без лимита</span>
        ),
    },
    {
      key: 'last',
      header: 'Последняя оплата',
      sort: (r) => r.last?.lastAt ?? '',
      csv: (r) => (r.last?.lastAt ? `${r.last.lastAt.slice(0, 10)} ${r.last.lastAmount}` : ''),
      width: 110,
      render: (r) =>
        r.last?.lastAt ? (
          <div>
            <div className="nowrap">{fmt.relDate(r.last.lastAt, today)}</div>
            <div className="cell-sub">{fmt.money(r.last.lastAmount)}</div>
          </div>
        ) : (
          <span className="faint">Не было</span>
        ),
    },
    {
      key: 'actions',
      header: '',
      width: 1,
      render: (r) => (
        <div className="row money-row-actions" onClick={(e) => e.stopPropagation()}>
          {perms.accept ? (
            <Button size="sm" icon={<HandCoins />} title="Принять оплату" onClick={() => setModal({ kind: 'accept', clientId: r.c.id })}>
              Принять
            </Button>
          ) : null}
          <MoreMenu
            size="sm"
            items={[
              { label: 'Акт сверки', icon: <FileText />, onClick: () => setModal({ kind: 'act', clientId: r.c.id }) },
              { label: 'Напомнить об оплате', icon: <BellRing />, onClick: () => setTask(r.c.id) },
            ]}
          />
        </div>
      ),
    },
  ];

  const filters = useMemo<FilterDef<DRow>[]>(
    () => [
      {
        key: 'view',
        showCounts: true,
        options: [
          { value: 'all', label: 'Все' },
          { value: 'overdue', label: 'Просрочка', test: (r) => r.b.overdue > 0 },
          { value: 'limit', label: 'Сверх лимита', test: (r) => r.b.creditLimit > 0 && r.b.creditLeft < 0 },
          { value: 'advance', label: 'Переплата / аванс', test: (r) => r.b.advance > 0 },
        ],
      },
    ],
    [],
  );

  return (
    <>
      <PageHeader
        section="money"
        title={full ? undefined : 'Долги моих клиентов'}
        counts={counts}
        actions={
          <>
            <MoreMenu items={menu} />
            {perms.accept ? (
              <Button variant="primary" icon={<HandCoins />} onClick={() => setModal({ kind: 'accept' })}>
                Принять оплату
              </Button>
            ) : null}
          </>
        }
      />
      <div className="grid-4">
        <Kpi label="Долг покупателей" value={fmt.money(kpi.debt)} />
        <Kpi label={`Просрочено · ${fmt.count(kpi.overdueN, 'клиент', 'клиента', 'клиентов')}`} value={<span className={kpi.overdue ? 'c-bad' : undefined}>{fmt.money(kpi.overdue)}</span>} />
        <Kpi label="Сверх кредитного лимита" value={fmt.count(kpi.overLimit, 'клиент', 'клиента', 'клиентов')} />
        <Kpi label="Авансы и переплаты" value={fmt.money(kpi.advance)} />
      </div>
      <div className="money-tight">
      <DataTable
        id="money-debts"
        rows={rows}
        columns={columns}
        rowKey={(r) => r.c.id}
        search={{ placeholder: 'Клиент, ИНН, телефон', text: (r) => `${r.c.name} ${r.c.inn ?? ''} ${r.c.phone} ${r.owner}` }}
        filters={filters}
        defaultSort={{ key: 'overdue', dir: 'desc' }}
        onRowClick={(r) => open('client', r.c.id)}
        exportName="Долги покупателей"
        totalLabel={(n) => `Итого · ${fmt.count(n, 'клиент', 'клиента', 'клиентов')}`}
        empty={rows.length ? undefined : <EmptyState title="Долгов нет">У ваших клиентов нет долгов и авансов</EmptyState>}
      />
      </div>
      <MoneyModalHost modal={modal} onClose={() => setModal(null)} onOpen={setModal} />
      {task ? <TaskModal link={{ type: 'client', id: task }} defaultTitle="Напомнить об оплате долга" onClose={() => setTask(null)} /> : null}
    </>
  );
}
