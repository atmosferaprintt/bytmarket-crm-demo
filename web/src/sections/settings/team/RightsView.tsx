import { Fragment, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Eye, Lock } from 'lucide-react';
import { Avatar, Button, Card, Chip, Segmented, fmt } from '../../../ui';
import { useDB, useDBVersion } from '../../../data/store';
import type { RoleKey } from '../../../data/types';
import { ROLES, ROLE_ORDER, roleCan } from '../../../roles/roles';
import { useSession } from '../../../roles/session';
import { ALL_ROWS_COUNT, BRIEF_ROWS_COUNT, PERM_GROUPS, roleSells } from '../perms';

export function RightsView() {
  const db = useDB();
  const version = useDBVersion();
  const { switchTo } = useSession();
  const navigate = useNavigate();
  const [only, setOnly] = useState<'all' | 'brief'>('all');

  const people = useMemo(() => {
    const m = new Map<RoleKey, typeof db.employees>();
    for (const r of ROLE_ORDER)
      m.set(
        r,
        db.employees.filter((e) => e.active && e.roles.includes(r)),
      );
    return m;
  }, [db, version]);

  const lookAs = (r: RoleKey) => {
    const p = people.get(r)?.[0];
    if (!p) return;
    switchTo(p.id, r);
    navigate('/overview');
  };

  const limits = db.settings.discountLimits;

  return (
    <>
      <Card hint="settings.team.roles" title="Роли" sub="Посмотреть глазами — открыть программу так, как её видит сотрудник этой роли" flush>
        <div className="list set-roles-list">
          {ROLE_ORDER.map((r) => {
            const list = people.get(r) ?? [];
            return (
              <div key={r} className="list-row">
                <div className="set-role-main">
                  <span className="t-14 w-700">{ROLES[r].name}</span>
                  <span className="t-13 muted">{ROLES[r].about}</span>
                </div>
                <div className="set-role-people">
                  {list.slice(0, 3).map((e) => (
                    <Avatar key={e.id} name={e.name} size="sm" />
                  ))}
                  <span className="t-13 ink-2 ellipsis" title={list.map((e) => e.name).join(', ')}>
                    {list.length ? list.map((e) => e.short).join(', ') : <span className="faint">нет сотрудников</span>}
                  </span>
                </div>
                <span style={{ width: 128, flex: '0 0 auto' }}>
                  {roleSells(r) ? <Chip tone="outline">{r === 'owner' && limits[r] >= 100 ? 'Скидка любая' : `Скидка до ${fmt.pct(limits[r] ?? 0, 0)}`}</Chip> : null}
                </span>
                {list.length ? (
                  <Button size="sm" icon={<Eye />} onClick={() => lookAs(r)}>
                    Посмотреть глазами
                  </Button>
                ) : (
                  <span style={{ width: 178 }} />
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <Card
        hint="settings.team.matrix"
        title="Что может каждая роль"
        flush
        actions={
          <Segmented
            ariaLabel="Какие права показать"
            value={only}
            onChange={setOnly}
            options={[
              { value: 'all', label: 'Все права', count: ALL_ROWS_COUNT },
              { value: 'brief', label: 'Отдельные ограничения', count: BRIEF_ROWS_COUNT },
            ]}
          />
        }
      >
        <div className="set-matrix-scroll" style={{ marginTop: 12 }}>
          <table className="set-matrix">
            <thead>
              <tr>
                <th>Право</th>
                {ROLE_ORDER.map((r) => (
                  <th key={r} title={ROLES[r].name}>
                    <span className="set-role-head">
                      <span className="w-700">{ROLES[r].short}</span>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERM_GROUPS.map((g) => {
                const rows = g.rows.filter((x) => only === 'all' || x.brief);
                if (!rows.length) return null;
                return (
                  <Fragment key={g.key}>
                    <tr className="set-group">
                      <td colSpan={ROLE_ORDER.length + 1}>{g.label}</td>
                    </tr>
                    {rows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <span
                            className={row.brief ? 'set-perm is-brief' : 'set-perm'}
                            title={row.brief ? 'Отдельное ограничение из задания: закупочные цены, прибыль, чужие клиенты, цены, скидки, списания, возвраты, выгрузка' : undefined}
                          >
                            {row.brief ? <Lock /> : <span style={{ width: 15, flex: '0 0 auto' }} />}
                            {row.label}
                            {row.key === 'discount' ? (
                              <button type="button" className="link-button t-12 w-600" onClick={() => navigate('/settings')}>
                                изменить
                              </button>
                            ) : null}
                          </span>
                        </td>
                        {ROLE_ORDER.map((r) => (
                          <td key={r} className="set-cell">
                            {row.key === 'discount' ? (
                              roleSells(r) && (limits[r] ?? 0) > 0 ? (
                                <span className="set-pct num">{fmt.pct(limits[r], 0)}</span>
                              ) : null
                            ) : roleCan(r, row.key) ? (
                              <Check aria-label="можно" />
                            ) : null}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
