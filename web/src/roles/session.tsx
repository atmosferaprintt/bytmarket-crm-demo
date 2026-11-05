/* Кто сейчас смотрит демо. Переключение ролей — для показа, без настоящего входа. */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { Employee, ID, RoleKey } from '../data/types';
import { useDB, useDBVersion } from '../data/store';
import { ROLES, roleCan, roleSees, type Perm, type RoleMeta, type SectionKey } from './roles';

const KEY = 'bm-session-v2';

interface Stored {
  employeeId: ID | null;
  role: RoleKey;
}

function load(): Stored {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as Stored;
  } catch {
    /* нет хранилища — начинаем как владелец */
  }
  return { employeeId: null, role: 'owner' };
}
function save(s: Stored) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ничего страшного */
  }
}

export interface Session {
  me: Employee;
  role: RoleKey;
  meta: RoleMeta;
  can: (perm: Perm) => boolean;
  sees: (section: SectionKey) => boolean;
  /** лимит ручной скидки, % */
  discountLimit: number;
  switchTo: (employeeId: ID, role: RoleKey) => void;
}

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const db = useDB();
  const version = useDBVersion();
  const [stored, setStored] = useState<Stored>(load);

  const me = useMemo(() => {
    const byId = stored.employeeId ? db.employees.find((e) => e.id === stored.employeeId && e.roles.includes(stored.role)) : undefined;
    // без выбранного человека — первый, у кого эта роль основная (у владельца может быть и роль менеджера)
    return (
      byId ??
      db.employees.find((e) => e.active && e.roles[0] === stored.role) ??
      db.employees.find((e) => e.roles.includes(stored.role)) ??
      db.employees.find((e) => e.roles.includes('owner')) ??
      db.employees[0]
    );
  }, [db, version, stored]);

  const role: RoleKey = me.roles.includes(stored.role) ? stored.role : me.roles[0];

  const switchTo = useCallback((employeeId: ID, r: RoleKey) => {
    const next = { employeeId, role: r };
    save(next);
    setStored(next);
  }, []);

  const value = useMemo<Session>(
    () => ({
      me,
      role,
      meta: ROLES[role],
      can: (perm) => roleCan(role, perm),
      sees: (section) => roleSees(role, section),
      discountLimit: db.settings.discountLimits[role] ?? 0,
      switchTo,
    }),
    [me, role, db, version, switchTo],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Текущий сотрудник, роль и права: const { me, role, can } = useSession(); */
export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession вне SessionProvider');
  return s;
}
