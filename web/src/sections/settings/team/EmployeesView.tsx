import { useMemo, useState } from 'react';
import { Avatar, Chip, DataTable, Select, StatusChip, fmt, type Column, type FilterDef } from '../../../ui';
import { useDB, useDBVersion } from '../../../data/store';
import type { Employee, ID, RoleKey } from '../../../data/types';
import { ROLES, ROLE_ORDER } from '../../../roles/roles';
import { EMPLOYEE_STATE } from './EmployeeDrawer';

export function EmployeesView({ onOpen, selectedId }: { onOpen: (id: ID) => void; selectedId: ID | null }) {
  const db = useDB();
  const version = useDBVersion();
  const [role, setRole] = useState<RoleKey | ''>('');

  const lastAction = useMemo(() => {
    const m = new Map<ID, string>();
    for (const a of db.audit) m.set(a.actorId, a.at);
    return m;
  }, [db, version]);

  const rows = useMemo(() => (role ? db.employees.filter((e) => e.roles.includes(role)) : db.employees), [db, version, role]);

  const columns = useMemo<Column<Employee>[]>(
    () => [
      {
        key: 'name',
        header: 'Сотрудник',
        sort: (e) => e.name,
        csv: (e) => e.name,
        render: (e) => (
          <span className="set-person">
            <Avatar name={e.name} size="sm" navy={e.roles.includes('owner')} />
            <span className="cell-title">{e.name}</span>
          </span>
        ),
      },
      {
        key: 'roles',
        header: 'Роли',
        sort: (e) => ROLE_ORDER.indexOf(e.roles[0]),
        csv: (e) => e.roles.map((r) => ROLES[r].name).join(', '),
        render: (e) => (
          <span className="chips">
            {e.roles.map((r, i) => (
              <Chip key={r} tone={i === 0 ? 'neutral' : 'outline'} title={i === 0 ? 'Основная роль' : 'Совмещает'}>
                {ROLES[r].name}
              </Chip>
            ))}
          </span>
        ),
      },
      { key: 'phone', header: 'Телефон', render: (e) => <span className="num">{fmt.phone(e.phone)}</span>, csv: (e) => fmt.phone(e.phone) },
      {
        key: 'hiredAt',
        header: 'Работает с',
        sort: (e) => e.hiredAt,
        csv: (e) => fmt.dateShort(e.hiredAt, true),
        render: (e) => <span className="nowrap">{fmt.date(e.hiredAt, { year: true })}</span>,
      },
      {
        key: 'last',
        header: 'Последнее изменение',
        sort: (e) => lastAction.get(e.id) ?? null,
        csv: (e) => (lastAction.get(e.id) ? fmt.dateTime(lastAction.get(e.id)) : ''),
        render: (e) => {
          const at = lastAction.get(e.id);
          return at ? (
            <span className="nowrap">
              {fmt.relDate(at, db.meta.today)}, {fmt.time(at)}
            </span>
          ) : (
            <span className="faint">—</span>
          );
        },
      },
      {
        key: 'active',
        header: 'Доступ',
        sort: (e) => (e.active ? 0 : 1),
        csv: (e) => (e.active ? EMPLOYEE_STATE.active.label : EMPLOYEE_STATE.inactive.label),
        render: (e) => <StatusChip s={e.active ? EMPLOYEE_STATE.active : EMPLOYEE_STATE.inactive} />,
      },
    ],
    [lastAction, db.meta.today],
  );

  const filters = useMemo<FilterDef<Employee>[]>(
    () => [
      {
        key: 'state',
        label: 'Доступ',
        showCounts: true,
        options: [
          { value: 'all', label: 'Все' },
          { value: 'active', label: 'Работают', test: (e) => e.active },
          { value: 'off', label: 'Доступ закрыт', test: (e) => !e.active },
          { value: 'multi', label: 'Совмещают роли', test: (e) => e.roles.length > 1 },
        ],
      },
    ],
    [],
  );

  const roleCounts = useMemo(() => {
    const m = new Map<RoleKey, number>();
    for (const e of db.employees) for (const r of e.roles) m.set(r, (m.get(r) ?? 0) + 1);
    return m;
  }, [db, version]);

  return (
    <DataTable
      id="settings-team"
      rows={rows}
      columns={columns}
      rowKey={(e) => e.id}
      search={{ placeholder: 'Имя или телефон', text: (e) => `${e.name} ${e.phone} ${e.roles.map((r) => ROLES[r].name).join(' ')}` }}
      filters={filters}
      defaultSort={{ key: 'roles', dir: 'asc' }}
      onRowClick={(e) => onOpen(e.id)}
      selectedKey={selectedId}
      exportName="Сотрудники"
      toolbar={
        <Select
          size="sm"
          aria-label="Роль"
          value={role}
          onChange={(ev) => setRole(ev.target.value as RoleKey | '')}
          placeholder="Все роли"
          options={ROLE_ORDER.map((r) => ({ value: r, label: `${ROLES[r].short} · ${roleCounts.get(r) ?? 0}` }))}
          style={{ width: 190 }}
        />
      }
      totalLabel={(n) => fmt.count(n, 'сотрудник', 'сотрудника', 'сотрудников')}
    />
  );
}
