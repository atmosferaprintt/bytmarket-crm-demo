/* Запуск операции с коротким сообщением: успех — toast, ошибка — toast с понятным текстом.
   Курьеру итог операции (r.info) целиком не приклеиваем: там технические слова («Отгружен полностью», «Задача отмечена выполненной»).
   Ему остаётся только «Клиенту ушло сообщение в WhatsApp»; важное по деньгам — «перевод ждёт подтверждения», «долг уменьшен» —
   место вызова пишет само в okText. */
import { useCallback } from 'react';
import type { ID } from '../../data/types';
import { dispatch } from '../../data/store';
import { useSession } from '../../roles/session';
import { toast } from '../../ui';

export interface RunOpts {
  /** что приклеить из r.info: всё (диспетчер, владелец), только понятное курьеру, ничего */
  info?: 'all' | 'courier' | 'none';
}

/** Из итога операции — только то, что важно курьеру. */
function courierInfo(info: string): string {
  return info
    .split(/\.\s+/)
    .filter((x) => /WhatsApp/.test(x))
    .join('. ');
}

export function useRun() {
  const { me, role } = useSession();
  return useCallback(
    (type: string, payload: unknown, okText: string, opts: RunOpts = {}): { ok: boolean; id?: ID; info?: string; error?: string } => {
      const r = dispatch(type as never, payload as never, me.id) as { ok: boolean; id?: ID; info?: string; error?: string };
      if (!r.ok) {
        toast(r.error ?? 'Не получилось', 'error');
        return { ok: false, error: r.error };
      }
      const mode = opts.info ?? (role === 'courier' ? 'courier' : 'all');
      const tail = !r.info || mode === 'none' ? '' : mode === 'courier' ? courierInfo(r.info) : r.info;
      toast(tail ? `${okText}. ${tail}` : okText);
      return { ok: true, id: r.id, info: r.info };
    },
    [me.id, role],
  );
}
