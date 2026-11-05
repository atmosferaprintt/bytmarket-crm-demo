import { useMemo, useState } from 'react';
import { ChevronRight, UserPlus } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { Button, Card, Chip, DataTable, EmptyState, Kpi, SearchInput, Segmented, Select, StatusChip, cx, fmt, overdueStatus, type Column, type FilterDef } from '../../ui';
import { ClientFormModal } from './ClientForm';
import { clientRows, kindName, priceTypeName, segmentName, useIsPhone, type ClientRow } from './lib';

const FILTER: FilterDef<ClientRow> = {
  key: 'f',
  showCounts: true,
  options: [
    { value: 'all', label: 'Все' },
    { value: 'debt', label: 'С долгом', test: (r) => r.b.debt > 0 },
    { value: 'overdue', label: 'Просрочка', test: (r) => r.b.overdue > 0 },
    // один термин везде — как на рабочем столе и в карточке клиента
    { value: 'missed', label: 'Пропустили привычный заказ', test: (r) => r.missed },
    { value: 'over', label: 'Сверх лимита', test: (r) => r.overLimit },
    { value: 'retail', label: 'Розница', test: (r) => r.c.priceType === 'retail' },
  ],
};

const searchText = (r: ClientRow) => [r.c.name, r.c.inn ?? '', r.c.phone, ...r.c.points.map((p) => `${p.name} ${p.address}`), ...r.c.contacts.map((x) => `${x.name} ${x.phone}`)].join(' ');

export function ClientsPage() {
  const db = useDB();
  const version = useDBVersion();
  const { can, role } = useSession();
  const scoped = useScoped();
  const open = useOpenEntity();
  const phone = useIsPhone();
  const [creating, setCreating] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState('');
  const today = db.meta.today;

  const all = useMemo(() => {
    const m = clientRows(db);
    return scoped.clients.map((c) => m.get(c.id)!).filter(Boolean);
  }, [db, version, scoped.clients]);

  const owners = useMemo(() => {
    const ids = new Set(all.map((r) => r.c.ownerId).filter((x): x is string => !!x));
    return db.employees.filter((e) => ids.has(e.id)).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  }, [all, db]);

  const rows = useMemo(() => {
    if (!ownerFilter) return all;
    if (ownerFilter === 'none') return all.filter((r) => !r.c.ownerId);
    return all.filter((r) => r.c.ownerId === ownerFilter);
  }, [all, ownerFilter]);

  const kpi = useMemo(() => {
    let debt = 0;
    let overdue = 0;
    let overdueN = 0;
    let missed = 0;
    for (const r of rows) {
      debt += r.b.debt;
      if (r.b.overdue > 0) {
        overdue += r.b.overdue;
        overdueN++;
      }
      if (r.missed) missed++;
    }
    return { debt, overdue, overdueN, missed };
  }, [rows]);

  const canFilterOwner = can('allClients') && owners.length > 1;

  const columns: Column<ClientRow>[] = [
    {
      key: 'name',
      header: 'Клиент',
      render: (r) => (
        <div className="cl-cell-client" title={r.c.name}>
          <div className="cell-title ellipsis">{r.c.name}</div>
          <div className="cell-sub ellipsis">
            {kindName(r.c)} · {segmentName(r.c)}
            {r.c.points.length ? ` · ${fmt.count(r.c.points.length, 'точка', 'точки', 'точек')}` : ''}
            {!r.c.active ? ' · отключён' : ''}
          </div>
        </div>
      ),
      sort: (r) => r.c.name,
      csv: (r) => `${r.c.name} (${kindName(r.c)}, ${segmentName(r.c)})`,
      // имя забирает всю свободную ширину, остальные колонки — по содержимому
      width: '100%',
    },
    {
      key: 'price',
      header: 'Цены',
      render: (r) => <Chip tone={r.c.priceType === 'wholesale' ? 'info' : 'neutral'}>{priceTypeName(r.c.priceType)}</Chip>,
      sort: (r) => r.c.priceType,
      width: 64,
      className: 'cl-col-price',
      csv: (r) => priceTypeName(r.c.priceType),
    },
    {
      key: 'owner',
      header: 'Ответственный',
      render: (r) => (r.owner ? <span className="nowrap">{r.owner.short}</span> : <span className="faint">—</span>),
      sort: (r) => r.owner?.name ?? '',
      csv: (r) => r.owner?.name ?? '',
      hidden: role === 'rep' || role === 'manager',
    },
    {
      key: 'debt',
      header: 'Долг',
      align: 'right',
      render: (r) =>
        r.b.debt > 0 ? (
          <span className="cl-cell-stack is-right">
            <span className="w-600">{fmt.money(r.b.debt)}</span>
            {r.b.maxOverdueDays > 0 ? (
              <span title={`Просрочено ${fmt.money(r.b.overdue)}`}>
                <StatusChip s={overdueStatus(r.b.maxOverdueDays)} />
              </span>
            ) : null}
          </span>
        ) : (
          <span className="faint">—</span>
        ),
      sort: (r) => r.b.debt,
      csv: (r) => r.b.debt,
      total: (rs) => fmt.money(rs.reduce((s, r) => s + r.b.debt, 0)),
    },
    {
      key: 'limit',
      header: 'Остаток лимита',
      csv: (r) => (r.c.creditLimit > 0 ? r.b.creditLeft : ''),
      align: 'right',
      render: (r) =>
        r.c.creditLimit > 0 ? (
          <span className={cx(r.overLimit && 'c-bad w-600')} title={`Лимит ${fmt.money(r.c.creditLimit)}`}>
            {fmt.money(r.b.creditLeft)}
          </span>
        ) : (
          <span className="faint" title="Без кредита: оплата сразу">
            —
          </span>
        ),
      sort: (r) => (r.c.creditLimit > 0 ? r.b.creditLeft : null),
    },
    {
      key: 'last',
      header: 'Последняя покупка',
      render: (r) => (
        <span className="cl-cell-stack">
          <span className="nowrap">{r.b.lastOrderAt ? fmt.relDate(r.b.lastOrderAt, today) : <span className="faint">ещё не покупал</span>}</span>
          {r.missed ? (
            <span title={`Пропустил привычный заказ: обычно заказывает раз в ${fmt.count(r.c.orderEveryDays ?? 0, 'день', 'дня', 'дней')}, с последней покупки прошло ${fmt.count(r.daysSince ?? 0, 'день', 'дня', 'дней')}`}>
              <Chip tone="warn">Пропустил привычный заказ</Chip>
            </span>
          ) : null}
        </span>
      ),
      sort: (r) => r.b.lastOrderAt ?? '',
      csv: (r) => (r.b.lastOrderAt ? r.b.lastOrderAt.slice(0, 10) : ''),
    },
    {
      key: 'sales90',
      header: 'Продажи за 90 дней',
      csv: (r) => r.sales90,
      align: 'right',
      render: (r) => (r.sales90 ? fmt.money(r.sales90) : <span className="faint">—</span>),
      sort: (r) => r.sales90,
      total: (rs) => fmt.money(rs.reduce((s, r) => s + r.sales90, 0)),
    },
  ];

  const ownerSelect = canFilterOwner ? (
    <Select
      size="sm"
      className="cl-owner-select"
      value={ownerFilter}
      onChange={(e) => setOwnerFilter(e.target.value)}
      aria-label="Ответственный"
      options={[{ value: '', label: 'Все ответственные' }, ...owners.map((e) => ({ value: e.id, label: e.name })), { value: 'none', label: 'Без ответственного' }]}
    />
  ) : null;

  return (
    <>
      <PageHeader
        section="clients"
        actions={
          can('editClients') ? (
            <Button variant="primary" icon={<UserPlus />} onClick={() => setCreating(true)}>
              Добавить клиента
            </Button>
          ) : null
        }
      />
      {!phone ? (
        <div className="grid-4">
          <Kpi label={role === 'rep' || role === 'manager' ? 'Мои клиенты' : 'Клиентов'} value={fmt.num(rows.length)} />
          <Kpi label="Должны нам" value={fmt.money(kpi.debt)} />
          <Kpi label={`Просрочено у ${fmt.count(kpi.overdueN, 'клиента', 'клиентов', 'клиентов')}`} value={<span className={cx(kpi.overdue > 0 && 'c-bad')}>{fmt.money(kpi.overdue)}</span>} />
          <Kpi label="Пропустили привычный заказ" value={fmt.num(kpi.missed)} />
        </div>
      ) : null}
      {phone ? (
        <ClientCards rows={rows} onOpen={(id) => open('client', id)} />
      ) : (
        <div className="cl-clients-table">
        <DataTable
          id="clients-list"
          rows={rows}
          columns={columns}
          rowKey={(r) => r.c.id}
          search={{ placeholder: 'Имя, ИНН, телефон, адрес', text: searchText }}
          filters={[FILTER]}
          toolbar={ownerSelect}
          defaultSort={{ key: 'debt', dir: 'desc' }}
          onRowClick={(r) => open('client', r.c.id)}
          exportName={can('export') ? 'Клиенты' : undefined}
          totalLabel={(n) => `Итого · ${fmt.count(n, 'клиент', 'клиента', 'клиентов')}`}
          empty={<EmptyState title="Клиентов не нашли">Измените поиск или фильтр</EmptyState>}
        />
        </div>
      )}
      {creating ? <ClientFormModal onClose={() => setCreating(false)} onSaved={(id) => id && open('client', id)} /> : null}
    </>
  );
}

/** Список клиентов на телефоне: карточки вместо широкой таблицы. */
function ClientCards({ rows, onOpen }: { rows: ClientRow[]; onOpen: (id: string) => void }) {
  const db = useDB();
  const today = db.meta.today;
  const [q, setQ] = useState('');
  const [f, setF] = useState('all');
  const searched = useMemo(() => {
    const tokens = q.trim().toLowerCase().replace(/ё/g, 'е').split(/\s+/).filter(Boolean);
    if (!tokens.length) return rows;
    return rows.filter((r) => {
      const t = searchText(r).toLowerCase().replace(/ё/g, 'е');
      return tokens.every((x) => t.includes(x));
    });
  }, [rows, q]);
  const counts = useMemo(() => Object.fromEntries(FILTER.options.map((o) => [o.value, o.test ? searched.filter(o.test).length : searched.length])), [searched]);
  const opt = FILTER.options.find((o) => o.value === f);
  const list = (opt?.test ? searched.filter(opt.test) : searched).slice().sort((a, b) => b.b.maxOverdueDays - a.b.maxOverdueDays || b.b.debt - a.b.debt || a.c.name.localeCompare(b.c.name, 'ru'));
  const debt = list.reduce((s, r) => s + r.b.debt, 0);
  return (
    <>
      <SearchInput value={q} onChange={setQ} placeholder="Клиент, адрес или телефон" size="lg" />
      <div className="cl-seg-scroll">
        <Segmented value={f} onChange={setF} options={FILTER.options.map((o) => ({ value: o.value, label: o.label, count: counts[o.value] }))} />
      </div>
      <div className="row t-13">
        <span className="w-600">{fmt.count(list.length, 'клиент', 'клиента', 'клиентов')}</span>
        <span className="spacer" />
        {debt > 0 ? (
          <span className="muted">
            Долг <span className="w-700 ink-2">{fmt.money(debt)}</span>
          </span>
        ) : null}
      </div>
      {list.length ? (
        <div className="col-3">
          {list.map((r) => (
            <button key={r.c.id} type="button" className="card cl-client-card" onClick={() => onOpen(r.c.id)}>
              <span className="row" style={{ alignItems: 'flex-start' }}>
                <span className="grow">
                  <span className="cl-client-card-name">{r.c.name}</span>
                  <span className="muted t-12">
                    {kindName(r.c)} · {segmentName(r.c)} · {priceTypeName(r.c.priceType).toLowerCase()}
                  </span>
                </span>
                <ChevronRight size={18} className="faint" />
              </span>
              <span className="chips">
                {r.b.debt > 0 ? <Chip tone="warn">Долг {fmt.money(r.b.debt)}</Chip> : <Chip tone="ok">Без долга</Chip>}
                {r.b.maxOverdueDays > 0 ? <StatusChip s={overdueStatus(r.b.maxOverdueDays)} /> : null}
                {r.overLimit ? <Chip tone="bad">Сверх лимита</Chip> : null}
                {r.missed ? <Chip tone="warn">Пропустил привычный заказ</Chip> : null}
              </span>
              <span className="row t-12 muted">
                <span>{r.b.lastOrderAt ? `Последняя покупка: ${fmt.relDate(r.b.lastOrderAt, today)}` : 'Ещё не покупал'}</span>
                <span className="spacer" />
                <span>{fmt.count(r.c.points.length, 'точка', 'точки', 'точек')}</span>
              </span>
            </button>
          ))}
        </div>
      ) : (
        <Card>
          <EmptyState title="Никого не нашли">Измените поиск или фильтр</EmptyState>
        </Card>
      )}
    </>
  );
}

