/* Долги покупателей — по клиентам: долг, просрочка, отсрочка, лимит, последняя оплата. */
import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
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
import { Button, Card, DataTable, EmptyState, Kpi, MoreMenu, SearchInput, Segmented, StatusChip, fmt, overdueStatus, type Column, type FilterDef } from '../../ui';
import { MoneyModalHost, useMoneyMenu, type MoneyModal } from './actions';
import { clientPayInfo, useMoneyPerms, type ClientPayInfo } from './lib';
import { useMoneyCounts } from './counts';
import { PhoneStats, useNarrow, usePhone } from './parts';

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
  const phone = usePhone();
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
      csv: (r) => `${r.c.name} (${r.owner}, ${r.c.deferDays > 0 ? `отсрочка ${r.c.deferDays} дн.` : 'без отсрочки'})`,
      render: (r) => (
        <div className="money-party">
          <div className="cell-title ellipsis">{r.c.name}</div>
          <div className="cell-sub ellipsis">
            {CLIENT_SEGMENT_NAMES[r.c.segment]} · {r.owner} · {r.c.deferDays > 0 ? `отсрочка ${r.c.deferDays} дн.` : 'без отсрочки'}
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
      width: narrow ? 136 : 100,
      render: (r) =>
        r.b.overdue ? (
          narrow ? (
            <div className="money-stack-r">
              <span className="w-700 c-bad">{fmt.money(r.b.overdue)}</span>
              {r.b.maxOverdueDays > 0 ? <StatusChip s={overdueStatus(r.b.maxOverdueDays)} /> : null}
            </div>
          ) : (
            <span className="w-700 c-bad">{fmt.money(r.b.overdue)}</span>
          )
        ) : (
          <span className="faint">—</span>
        ),
      total: (rs) => fmt.money(rs.reduce((s, r) => s + r.b.overdue, 0)),
    },
    {
      key: 'days',
      header: 'Дней просрочки',
      hidden: narrow,
      sort: (r) => r.b.maxOverdueDays,
      csv: (r) => r.b.maxOverdueDays || '',
      width: 130,
      render: (r) => (r.b.maxOverdueDays > 0 ? <StatusChip s={overdueStatus(r.b.maxOverdueDays)} /> : <span className="faint">—</span>),
    },
    {
      key: 'advance',
      header: 'Аванс',
      align: 'right',
      sort: (r) => r.b.advance,
      csv: (r) => r.b.advance,
      width: 96,
      render: (r) => (r.b.advance > 0 ? <span className="w-700 money-adv" title="Оплачено вперёд или переплачено: уйдёт в счёт следующих отгрузок">{fmt.money(r.b.advance)}</span> : <span className="faint">—</span>),
      total: (rs) => fmt.money(rs.reduce((s, r) => s + r.b.advance, 0)),
    },
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
          <span className="faint nowrap">Ещё не платил</span>
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
      {phone ? (
        <>
          <PhoneStats
            items={[
              { label: 'Долг покупателей', value: fmt.money(kpi.debt) },
              { label: `Просрочено · ${kpi.overdueN}`, value: <span className={kpi.overdue ? 'c-bad' : undefined}>{fmt.money(kpi.overdue)}</span> },
              { label: 'Сверх лимита', value: fmt.count(kpi.overLimit, 'клиент', 'клиента', 'клиентов') },
              { label: 'Авансы', value: <span className={kpi.advance ? 'money-adv' : undefined}>{fmt.money(kpi.advance)}</span> },
            ]}
          />
          <PhoneDebts rows={rows} canAccept={perms.accept} onOpen={(r) => open('client', r.c.id)} onAccept={(r) => setModal({ kind: 'accept', clientId: r.c.id })} />
        </>
      ) : (
        <>
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
        </>
      )}
      <MoneyModalHost modal={modal} onClose={() => setModal(null)} onOpen={setModal} />
      {task ? <TaskModal link={{ type: 'client', id: task }} defaultTitle="Напомнить об оплате долга" onClose={() => setTask(null)} /> : null}
    </>
  );
}

/* ---------- телефон: карточки вместо таблицы ---------- */

type PhoneFilter = 'all' | 'overdue' | 'limit' | 'advance';
const PHONE_TESTS: Record<PhoneFilter, (r: DRow) => boolean> = {
  all: () => true,
  overdue: (r) => r.b.overdue > 0,
  limit: (r) => r.b.creditLimit > 0 && r.b.creditLeft < 0,
  advance: (r) => r.b.advance > 0,
};
const norm = (x: string) => x.toLowerCase().replace(/ё/g, 'е');

function PhoneDebts({ rows, canAccept, onOpen, onAccept }: { rows: DRow[]; canAccept: boolean; onOpen: (r: DRow) => void; onAccept: (r: DRow) => void }) {
  const [q, setQ] = useState('');
  const [f, setF] = useState<PhoneFilter>('all');
  const [limit, setLimit] = useState(30);
  const searched = useMemo(() => {
    const t = norm(q.trim()).split(/\s+/).filter(Boolean);
    const list = t.length ? rows.filter((r) => t.every((x) => norm(`${r.c.name} ${r.c.inn ?? ''} ${r.c.phone} ${r.owner}`).includes(x))) : rows;
    return [...list].sort((a, b) => b.b.overdue - a.b.overdue || b.b.debt - a.b.debt || b.b.advance - a.b.advance);
  }, [rows, q]);
  const count = (k: PhoneFilter) => searched.filter(PHONE_TESTS[k]).length;
  const list = searched.filter(PHONE_TESTS[f]);
  return (
    <div className="col-3">
      <SearchInput value={q} onChange={setQ} placeholder="Клиент, ИНН, телефон" size="lg" />
      <div className="money-phone-seg">
        <Segmented<PhoneFilter>
          value={f}
          onChange={setF}
          ariaLabel="Какие долги"
          options={[
            { value: 'all', label: 'Все', count: searched.length },
            { value: 'overdue', label: 'Просрочка', count: count('overdue') },
            { value: 'limit', label: 'Сверх лимита', count: count('limit') },
            { value: 'advance', label: 'Аванс', count: count('advance') },
          ]}
        />
      </div>
      {list.length ? (
        list.slice(0, limit).map((r) => (
          <div key={r.c.id} role="button" tabIndex={0} className="card money-phone-card" onClick={() => onOpen(r)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(r))}>
            <div className="money-phone-card-top">
              <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                <span className="w-700 t-14 ellipsis">{r.c.name}</span>
                <span className="t-12 muted ellipsis">
                  {CLIENT_SEGMENT_NAMES[r.c.segment]} · {r.owner}
                </span>
              </span>
              <span className="col" style={{ gap: 2, alignItems: 'flex-end' }}>
                <span className="t-12 muted">{r.b.debt > 0 ? 'Долг' : 'Аванс'}</span>
                <span className={r.b.debt > 0 ? 't-16 w-700 num nowrap' : 't-16 w-700 num nowrap money-adv'}>{fmt.money(r.b.debt > 0 ? r.b.debt : r.b.advance)}</span>
              </span>
            </div>
            <div className="money-phone-card-chips">
              {r.b.maxOverdueDays > 0 ? <StatusChip s={overdueStatus(r.b.maxOverdueDays)} /> : null}
              {r.b.overdue > 0 ? <span className="t-13 w-600 c-bad nowrap">Просрочено {fmt.money(r.b.overdue)}</span> : null}
              {r.b.creditLimit > 0 && r.b.creditLeft < 0 ? <StatusChip s={{ label: `Сверх лимита на ${fmt.money(-r.b.creditLeft)}`, tone: 'warn' }} /> : null}
              {r.b.debt > 0 && r.b.advance > 0 ? <StatusChip s={{ label: `Аванс ${fmt.money(r.b.advance)}`, tone: 'info' }} /> : null}
              {r.b.debt > 0 && r.b.overdue === 0 ? <span className="t-13 ink-2 nowrap">{r.c.deferDays > 0 ? `Отсрочка ${r.c.deferDays} дн.` : 'Без отсрочки'}</span> : null}
            </div>
            {canAccept && r.b.debt > 0 ? (
              <div onClick={(e) => e.stopPropagation()}>
                <Button size="lg" block icon={<HandCoins />} onClick={() => onAccept(r)}>
                  Принять оплату
                </Button>
              </div>
            ) : null}
          </div>
        ))
      ) : (
        <Card>
          <EmptyState title={f === 'overdue' ? 'Просрочек нет' : rows.length ? 'Ничего не нашли' : 'Долгов нет'}>{rows.length ? 'Измените поиск или фильтр' : 'У ваших клиентов нет долгов и авансов'}</EmptyState>
        </Card>
      )}
      {list.length > limit ? (
        <Button size="lg" block variant="ghost" icon={<ChevronDown />} onClick={() => setLimit((n) => n + 30)}>
          Показать ещё · {list.length - limit}
        </Button>
      ) : null}
    </div>
  );
}
