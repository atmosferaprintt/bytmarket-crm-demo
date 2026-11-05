/* Одна точка вызова операций для разделов «Склад» и «Закупки». */
import { dispatch } from '../../data/store';
import type { ID } from '../../data/types';

export type ActResult = { ok: true; id?: ID; info?: string } | { ok: false; error: string };

export function act(type: string, payload: unknown, actorId: ID): ActResult {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = (dispatch as any)(type, payload, actorId) as { ok: boolean; id?: ID; info?: string; error?: string };
  if (!r || !r.ok) return { ok: false, error: r?.error ?? 'Операция не выполнена' };
  return { ok: true, id: r.id, info: r.info };
}
