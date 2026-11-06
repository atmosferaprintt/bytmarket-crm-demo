import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, Lock, Unlock } from 'lucide-react';
import { Avatar, Button, Chip, ConfirmButton, Drawer, EmptyState, Field, Input, MoreMenu, Notice, StatList, StatRow, StatusChip, fmt, toast } from '../../../ui';
import { dispatch, useDB, useDBVersion } from '../../../data/store';
import type { ID, RoleKey } from '../../../data/types';
import { ROLES } from '../../../roles/roles';
import { useSession } from '../../../roles/session';
import { ENTITY_NAMES, normalizePhone } from './common';
import { RolePicker } from './RolePicker';

export const EMPLOYEE_STATE = {
  active: { label: 'Работает', tone: 'ok' as const },
  inactive: { label: 'Доступ закрыт', tone: 'outline' as const },
};

export function EmployeeDrawer({ employeeId, onClose }: { employeeId: ID; onClose: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const { me, switchTo } = useSession();
  const navigate = useNavigate();
  const e = db.employees.find((x) => x.id === employeeId);
  const [roles, setRoles] = useState<RoleKey[]>(e?.roles ?? []);
  // телефон — одно поле в привычном виде «+7 917 123-45-67»; сохраняется в базе без пробелов
  const [phone, setPhone] = useState(e ? fmt.phone(e.phone) : '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!e) return;
    setRoles(e.roles);
    setPhone(fmt.phone(e.phone));
    setError(null);
  }, [employeeId, e?.roles.join(), e?.phone]);

  const actions = useMemo(() => {
    const list = db.audit.filter((a) => a.actorId === employeeId);
    return { total: list.length, last: list.slice(-6).reverse() };
  }, [db, version, employeeId]);

  if (!e)
    return (
      <Drawer title="Сотрудник" onClose={onClose}>
        <EmptyState title="Сотрудник не найден" />
      </Drawer>
    );

  const isOwner = e.roles.includes('owner');
  const phoneNorm = normalizePhone(phone);
  const phoneChanged = (phoneNorm ?? phone.trim()) !== e.phone;
  const rolesChanged = roles.join() !== e.roles.join();
  const dirty = rolesChanged || phoneChanged;

  const save = () => {
    if (!roles.length) {
      setError('Оставьте хотя бы одну роль');
      return;
    }
    if (phoneChanged && !phoneNorm) {
      setError('Телефон: нужно 11 цифр, например +7 917 123-45-67');
      return;
    }
    const patch: { roles?: RoleKey[]; phone?: string } = {};
    if (rolesChanged) patch.roles = roles;
    if (phoneChanged && phoneNorm) patch.phone = phoneNorm;
    const r = dispatch('employee.update', { employeeId: e.id, patch }, me.id);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    toast('Сотрудник сохранён');
  };

  const setActive = (active: boolean) => {
    const r = dispatch('employee.update', { employeeId: e.id, patch: { active } }, me.id);
    if (!r.ok) {
      toast(r.error, 'error');
      return;
    }
    toast(active ? `${e.short}: доступ открыт` : `${e.short}: доступ закрыт`);
  };

  const lookAs = (role: RoleKey) => {
    switchTo(e.id, role);
    onClose();
    navigate('/overview');
  };

  return (
    <Drawer
      title={
        <span className="row-3">
          <Avatar name={e.name} size="lg" navy={isOwner} />
          <span>{e.name}</span>
        </span>
      }
      head={
        <div className="chips">
          <StatusChip s={e.active ? EMPLOYEE_STATE.active : EMPLOYEE_STATE.inactive} />
          {e.roles.map((r, i) => (
            <Chip key={r} tone={i === 0 ? 'neutral' : 'outline'} title={i === 0 ? 'Основная роль' : 'Совмещает'}>
              {ROLES[r].name}
            </Chip>
          ))}
        </div>
      }
      onClose={onClose}
      footer={
        <>
          {e.active ? (
            e.roles.length > 1 ? (
              <MoreMenu
                label="Посмотреть глазами"
                trigger={
                  <>
                    <Eye />
                    Посмотреть глазами
                  </>
                }
                align="start"
                items={e.roles.map((r) => ({ label: ROLES[r].name, icon: <Eye />, onClick: () => lookAs(r) }))}
              />
            ) : (
              <Button icon={<Eye />} onClick={() => lookAs(e.roles[0])} data-hint="settings.emp.look">
                Посмотреть глазами
              </Button>
            )
          ) : null}
          <span className="spacer" />
          <Button variant="primary" disabled={!dirty} onClick={save}>
            Сохранить
          </Button>
        </>
      }
    >
      <div className="col-4" style={{ gap: 20 }}>
        <StatList>
          <StatRow label="Работает с" value={fmt.date(e.hiredAt, { year: true })} />
          <StatRow
            label={<span title="Цены, товары, клиенты, оплаты, остатки, настройки — всё, что пишется в журнал изменений">Внёс изменений в программе</span>}
            value={actions.total ? fmt.count(actions.total, 'изменение', 'изменения', 'изменений') : 'пока нет'}
          />
        </StatList>

        <div className="col-3" data-hint="settings.emp.roles">
          <div className="set-section-label">Роли</div>
          <RolePicker value={roles} onChange={setRoles} lockOwner={isOwner} hideOwner={!isOwner} />
        </div>

        <Field label="Телефон">
          <Input value={phone} onChange={(ev) => setPhone(ev.target.value)} onBlur={() => phoneNorm && setPhone(fmt.phone(phoneNorm))} inputMode="tel" placeholder="+7 917 123-45-67" />
        </Field>

        {error ? <Notice tone="bad">{error}</Notice> : null}

        {!isOwner ? (
          <div className="col-3" data-hint="settings.emp.access">
            <div className="set-section-label">Доступ к программе</div>
            <div className="row-3" style={{ flexWrap: 'wrap' }}>
              {e.active ? (
                <ConfirmButton icon={<Lock />} confirmText="Закрыть доступ?" onConfirm={() => setActive(false)}>
                  Закрыть доступ
                </ConfirmButton>
              ) : (
                <Button icon={<Unlock />} onClick={() => setActive(true)}>
                  Открыть доступ
                </Button>
              )}
              <span className="t-13 muted">{e.active ? 'Уволился или в отпуске — закройте доступ, история останется' : 'Сотрудник не может входить и проводить операции'}</span>
            </div>
          </div>
        ) : null}

        <div className="col-3">
          <div className="set-section-label">Последние изменения</div>
          {actions.last.length ? (
            <div className="list">
              {actions.last.map((a) => (
                <div key={a.id} className="list-row" style={{ padding: '10px 0', alignItems: 'flex-start' }}>
                  <span className="t-12 muted nowrap" style={{ width: 92, flex: '0 0 auto', paddingTop: 1 }}>
                    {fmt.relDate(a.at, db.meta.today)}, {fmt.time(a.at)}
                  </span>
                  <span className="grow t-13">{a.text}</span>
                  <Chip>{ENTITY_NAMES[a.entity]}</Chip>
                </div>
              ))}
            </div>
          ) : (
            <div className="t-13 muted">Важных изменений не вносил</div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
