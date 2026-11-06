import { useMemo, useState } from 'react';
import { Avatar, Chip, DataTable, EmptyState, Select, fmt, type Column, type FilterDef } from '../../../ui';
import { useDB, useDBVersion } from '../../../data/store';
import type { AuditEntry, ID } from '../../../data/types';
import { ROLES } from '../../../roles/roles';
import { useOpenEntity } from '../../../shell/entities';
import { ENTITY_NAMES, auditTarget } from './common';

type Entity = AuditEntry['entity'];

/** Журнал важных изменений (§3): автор, время и содержание. */
export function AuditView({ onOpenEmployee }: { onOpenEmployee: (id: ID) => void }) {
  const db = useDB();
  const version = useDBVersion();
  const open = useOpenEntity();
  const [entity, setEntity] = useState<Entity | ''>('');
  const [actor, setActor] = useState<ID | ''>('');
  const today = db.meta.today;

  const emp = useMemo(() => new Map(db.employees.map((e) => [e.id, e])), [db, version]);

  const counts = useMemo(() => {
    const byEntity = new Map<Entity, number>();
    const byActor = new Map<ID, number>();
    for (const a of db.audit) {
      byEntity.set(a.entity, (byEntity.get(a.entity) ?? 0) + 1);
      byActor.set(a.actorId, (byActor.get(a.actorId) ?? 0) + 1);
    }
    return { byEntity, byActor };
  }, [db, version]);

  // ключ строки — порядковый номер записи: не зависит от того, уникальны ли id в журнале
  const keyOf = useMemo(() => {
    const m = new Map<AuditEntry, string>();
    db.audit.forEach((a, i) => m.set(a, String(i)));
    return m;
  }, [db, version]);

  const rows = useMemo(() => db.audit.filter((a) => (!entity || a.entity === entity) && (!actor || a.actorId === actor)), [db, version, entity, actor]);

  const columns = useMemo<Column<AuditEntry>[]>(
    () => [
      {
        key: 'at',
        header: 'Когда',
        width: 150,
        // в одну минуту — по порядку записи: «выключено» и сразу «включено» стоят в правильном порядке
        sort: (a) => `${a.at}|${a.id.replace(/\D/g, '').padStart(8, '0')}`,
        csv: (a) => `${fmt.dateShort(a.at, true)} ${fmt.time(a.at)}`,
        render: (a) => (
          <span className="nowrap">
            {fmt.relDate(a.at, today)}, {fmt.time(a.at)}
          </span>
        ),
      },
      {
        key: 'actor',
        header: 'Кто',
        width: 200,
        sort: (a) => emp.get(a.actorId)?.name ?? '',
        csv: (a) => emp.get(a.actorId)?.name ?? '',
        render: (a) => {
          const e = emp.get(a.actorId);
          if (!e) return <span className="faint">—</span>;
          return (
            <span className="set-person" title={e.roles.map((r) => ROLES[r].name).join(', ')}>
              <Avatar name={e.name} size="sm" navy={e.roles.includes('owner')} />
              <span className="w-600 nowrap">{e.short}</span>
            </span>
          );
        },
      },
      {
        key: 'entity',
        header: 'Раздел',
        width: 130,
        sort: (a) => ENTITY_NAMES[a.entity],
        csv: (a) => ENTITY_NAMES[a.entity],
        render: (a) => <Chip>{ENTITY_NAMES[a.entity]}</Chip>,
      },
      { key: 'text', header: 'Запись', csv: (a) => a.text, render: (a) => <div className="set-audit-text">{a.text}</div> },
    ],
    [emp, today],
  );

  const filters = useMemo<FilterDef<AuditEntry>[]>(
    () => [
      {
        key: 'period',
        label: 'Период',
        showCounts: true,
        options: [
          { value: 'all', label: 'Всё время' },
          { value: 'today', label: 'Сегодня', test: (a) => a.at.slice(0, 10) === today },
          { value: 'week', label: '7 дней', test: (a) => fmt.daysBetween(a.at, today) < 7 },
          { value: 'month', label: '30 дней', test: (a) => fmt.daysBetween(a.at, today) < 30 },
        ],
      },
    ],
    [today],
  );

  const entityOptions = (Object.keys(ENTITY_NAMES) as Entity[])
    .filter((k) => counts.byEntity.get(k))
    .sort((a, b) => ENTITY_NAMES[a].localeCompare(ENTITY_NAMES[b], 'ru'))
    .map((k) => ({ value: k, label: `${ENTITY_NAMES[k]} · ${counts.byEntity.get(k)}` }));
  const actorOptions = db.employees.filter((e) => counts.byActor.get(e.id)).map((e) => ({ value: e.id, label: `${e.short} · ${counts.byActor.get(e.id)}` }));

  return (
    <div className="set-audit">
      <DataTable
        id="settings-audit"
        hint="settings.team.audit"
        rows={rows}
        columns={columns}
        rowKey={(a) => keyOf.get(a) ?? a.id}
        search={{ placeholder: 'Поиск по записи', text: (a) => `${a.text} ${emp.get(a.actorId)?.name ?? ''} ${ENTITY_NAMES[a.entity]}` }}
        filters={filters}
        defaultSort={{ key: 'at', dir: 'desc' }}
        onRowClick={(a) => {
          if (a.entity === 'employee') return onOpenEmployee(a.entityId);
          const t = auditTarget(a);
          if (t) open(t.type, t.id);
        }}
        exportName="Журнал изменений"
        pageSize={50}
        toolbar={
          <>
            <Select size="sm" aria-label="Раздел" value={entity} onChange={(e) => setEntity(e.target.value as Entity | '')} placeholder="Все разделы" options={entityOptions} style={{ width: 150 }} />
            <Select size="sm" aria-label="Сотрудник" value={actor} onChange={(e) => setActor(e.target.value)} placeholder="Все сотрудники" options={actorOptions} style={{ width: 164 }} />
          </>
        }
        totalLabel={(n) => fmt.count(n, 'запись', 'записи', 'записей')}
        empty={<EmptyState title="Записей нет">Измените поиск, раздел или период</EmptyState>}
      />
    </div>
  );
}
