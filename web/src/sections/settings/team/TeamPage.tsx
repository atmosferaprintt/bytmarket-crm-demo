import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { UserPlus } from 'lucide-react';
import { PageHeader } from '../../../shell/PageHeader';
import { Button, Segmented } from '../../../ui';
import { useDB } from '../../../data/store';
import type { ID } from '../../../data/types';
import { EmployeesView } from './EmployeesView';
import { EmployeeDrawer } from './EmployeeDrawer';
import { AddEmployeeModal } from './AddEmployeeModal';
import { RightsView } from './RightsView';
import { AuditView } from './AuditView';

type View = 'people' | 'rights' | 'audit';

export function TeamPage() {
  const db = useDB();
  const [params, setParams] = useSearchParams();
  const raw = params.get('view');
  const view: View = raw === 'rights' || raw === 'audit' ? raw : 'people';
  const [openId, setOpenId] = useState<ID | null>(null);
  const [adding, setAdding] = useState(false);

  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    if (v === 'people') next.delete('view');
    else next.set('view', v);
    setParams(next, { replace: true });
  };

  return (
    <div className="set-page">
      <PageHeader
        section="settings"
        actions={
          view === 'people' ? (
            <Button variant="primary" icon={<UserPlus />} onClick={() => setAdding(true)} data-hint="settings.team.add">
              Добавить сотрудника
            </Button>
          ) : null
        }
      />

      <div className="row">
        <span data-hint="settings.team.view">
        <Segmented
          ariaLabel="Что показать"
          value={view}
          onChange={setView}
          options={[
            { value: 'people', label: 'Сотрудники', count: db.employees.length },
            { value: 'rights', label: 'Роли и права' },
            { value: 'audit', label: 'Журнал изменений', count: db.audit.length },
          ]}
        />
        </span>
      </div>

      {view === 'people' ? <EmployeesView onOpen={setOpenId} selectedId={openId} /> : null}
      {view === 'rights' ? <RightsView /> : null}
      {view === 'audit' ? <AuditView onOpenEmployee={setOpenId} /> : null}

      {openId ? <EmployeeDrawer employeeId={openId} onClose={() => setOpenId(null)} /> : null}
      {adding ? <AddEmployeeModal onClose={() => setAdding(false)} onCreated={setOpenId} /> : null}
    </div>
  );
}
