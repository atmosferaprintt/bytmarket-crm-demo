/* Запуск операции с коротким сообщением: успех — toast, ошибка — toast с понятным текстом. */
import { useCallback } from 'react';
import type { ID } from '../../data/types';
import { dispatch } from '../../data/store';
import { useSession } from '../../roles/session';
import { toast } from '../../ui';

export function useRun() {
  const { me } = useSession();
  return useCallback(
    (type: string, payload: unknown, okText: string): { ok: boolean; id?: ID; error?: string } => {
      const r = dispatch(type as never, payload as never, me.id) as { ok: boolean; id?: ID; info?: string; error?: string };
      if (!r.ok) {
        toast(r.error ?? 'Не получилось', 'error');
        return { ok: false, error: r.error };
      }
      toast(r.info ? `${okText}. ${r.info}` : okText);
      return { ok: true, id: r.id };
    },
    [me.id],
  );
}
