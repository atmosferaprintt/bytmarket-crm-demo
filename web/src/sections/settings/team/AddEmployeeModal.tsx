import { useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Button, Field, IconTile, Input, Modal, Notice, toast } from '../../../ui';
import { dispatch, useDB } from '../../../data/store';
import { ops } from '../../../data/ops';
import type { ID, RoleKey } from '../../../data/types';
import { useSession } from '../../../roles/session';
import { normalizePhone } from './common';
import { RolePicker } from './RolePicker';

const CREATE_OP = 'employee.create';
type LooseDispatch = (type: string, payload: unknown, actorId: ID) => { ok: true; id?: ID; info?: string } | { ok: false; error: string };

/** Новый сотрудник: имя, телефон, одна или несколько ролей. */
export function AddEmployeeModal({ onClose, onCreated }: { onClose: () => void; onCreated?: (id: ID) => void }) {
  const db = useDB();
  const { me } = useSession();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [roles, setRoles] = useState<RoleKey[]>(['seller']);
  const [hiredAt, setHiredAt] = useState(db.meta.today);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const nameErr = name.trim().split(/\s+/).filter(Boolean).length < 2 ? 'Имя и фамилия, например «Айшат Набиева»' : null;
  const phoneNorm = normalizePhone(phone);
  const phoneErr = !phoneNorm ? 'Телефон: 11 цифр, например +7 917 123-45-67' : db.employees.some((e) => e.phone === phoneNorm) ? 'Этот телефон уже у другого сотрудника' : null;
  const rolesErr = roles.length ? null : 'Выберите хотя бы одну роль';

  const submit = () => {
    setTried(true);
    if (nameErr || phoneErr || rolesErr) return;
    if (!(CREATE_OP in ops)) {
      setError('Сохранение новых сотрудников пока не подключено. Роли и доступ тех, кто уже работает, меняются в их карточке.');
      return;
    }
    const r = (dispatch as unknown as LooseDispatch)(CREATE_OP, { name: name.trim().replace(/\s+/g, ' '), phone: phoneNorm, roles, hiredAt }, me.id);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    toast(`${name.trim()} добавлен в команду`);
    if (r.id) onCreated?.(r.id);
    onClose();
  };

  return (
    <Modal
      title="Новый сотрудник"
      icon={
        <IconTile>
          <UserPlus />
        </IconTile>
      }
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit}>
            Добавить
          </Button>
        </>
      }
    >
      <div className="col-4">
        <div className="set-form">
          <Field label="Имя и фамилия" error={tried ? nameErr : null}>
            <Input autoFocus value={name} invalid={tried && !!nameErr} onChange={(e) => setName(e.target.value)} placeholder="Айшат Набиева" />
          </Field>
          <Field label="Телефон" error={tried ? phoneErr : null}>
            <Input value={phone} invalid={tried && !!phoneErr} inputMode="tel" onChange={(e) => setPhone(e.target.value)} placeholder="+7 900 000-00-00" />
          </Field>
          <Field label="Работает с">
            <Input type="date" value={hiredAt} max={db.meta.today} onChange={(e) => setHiredAt(e.target.value || db.meta.today)} />
          </Field>
        </div>
        <div className="col-3" data-hint="settings.add.roles">
          <div className="set-section-label">Роли</div>
          <RolePicker value={roles} onChange={setRoles} hideOwner />
          {tried && rolesErr ? <span className="field-error">{rolesErr}</span> : null}
        </div>
        {error ? <Notice tone="warn">{error}</Notice> : null}
      </div>
    </Modal>
  );
}
