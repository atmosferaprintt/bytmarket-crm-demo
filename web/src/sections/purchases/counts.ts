/* Счётчики на вкладках раздела «Закупки». */
import { useMemo } from 'react';
import { useDB, useDBVersion } from '../../data/store';
import { purchaseSuggestion } from '../../data/ops';
import { useSession } from '../../roles/session';
import { memoDb } from '../stock/calc';
import type { DB } from '../../data/types';

export function suggestionAll(db: DB) {
  return memoDb(db, 'suggestion', () => purchaseSuggestion(db));
}

export function usePurchaseCounts(): Record<string, number> {
  const db = useDB();
  const version = useDBVersion();
  const { role } = useSession();
  return useMemo(() => {
    const drafts = db.purchases.filter((p) => p.state === 'draft').length;
    const res: Record<string, number> = {};
    if (role === 'owner' && drafts) res.orders = drafts;
    if (role === 'owner' || role === 'warehouse') {
      const urgent = suggestionAll(db).filter((x) => x.daysLeft !== null && x.daysLeft <= x.leadDays).length;
      if (urgent) res.suggest = urgent;
    }
    return res;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version, role]);
}
