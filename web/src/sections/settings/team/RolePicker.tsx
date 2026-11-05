import type { RoleKey } from '../../../data/types';
import { ROLES, ROLE_ORDER } from '../../../roles/roles';
import { cx } from '../../../ui';
import { toggleRole } from './common';

/** Выбор одной или нескольких ролей: совмещение допустимо, первая — основная. */
export function RolePicker({ value, onChange, lockOwner, hideOwner }: { value: RoleKey[]; onChange: (v: RoleKey[]) => void; lockOwner?: boolean; hideOwner?: boolean }) {
  const roles = ROLE_ORDER.filter((r) => !(hideOwner && r === 'owner'));
  return (
    <div className="set-roles-pick">
      {roles.map((r) => {
        const checked = value.includes(r);
        const locked = r === 'owner' && lockOwner;
        return (
          <label key={r} className={cx('set-role-option', locked && 'is-disabled')}>
            <input type="checkbox" checked={checked} disabled={locked} onChange={(e) => onChange(toggleRole(value, r, e.target.checked, ROLE_ORDER))} />
            <span className="grow">
              <span className="t-13 w-700" style={{ display: 'block' }}>
                {ROLES[r].name}
                {checked && value[0] === r && value.length > 1 ? <span className="muted w-500"> · основная</span> : null}
              </span>
              <span className="t-12 muted" style={{ display: 'block' }}>
                {ROLES[r].about}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
}
