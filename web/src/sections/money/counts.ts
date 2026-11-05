/* Счётчики на вкладках раздела «Деньги». */
import { useMemo } from 'react';
import { useDB, useDBVersion } from '../../data/store';
import { clientBalances } from '../../data/selectors';
import { useScoped } from '../../roles/scope';

export function useMoneyCounts(): Record<string, number> {
  const db = useDB();
  const v = useDBVersion();
  const { clients } = useScoped();
  return useMemo(() => {
    let journal = 0;
    for (const p of db.payments) if (p.status !== 'posted') journal++;
    const bal = clientBalances(db);
    let debts = 0;
    for (const c of clients) if ((bal.get(c.id)?.overdue ?? 0) > 0) debts++;
    return { journal, debts };
  }, [db, v, clients]);
}
