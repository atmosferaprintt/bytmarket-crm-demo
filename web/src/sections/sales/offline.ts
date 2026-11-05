/* «Нет связи» у представителя: заявки, оформленные без связи, сохраняются в телефоне и ждут отправки.
   Одно хранилище на «Мой день», окно заявки и список заказов (ключ тот же, что был у «Моего дня»). Только показ, не данные магазина. */
import { useSyncExternalStore } from 'react';
import type { ID } from '../../data/types';

export interface OfflineState {
  on: boolean;
  queued: ID[];
}

const KEY = 'bm-rep-offline';
const EMPTY: OfflineState = { on: false, queued: [] };
const listeners = new Set<() => void>();
let cache: OfflineState | null = null;

function read(): OfflineState {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as Partial<OfflineState>) : null;
    cache = v ? { on: !!v.on, queued: Array.isArray(v.queued) ? v.queued : [] } : EMPTY;
  } catch {
    cache = EMPTY;
  }
  return cache;
}

function write(next: OfflineState): void {
  cache = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* не запомним — живёт до перезагрузки */
  }
  for (const l of listeners) l();
}

export function getOffline(): OfflineState {
  return read();
}

export function setOffline(next: OfflineState | ((prev: OfflineState) => OfflineState)): void {
  write(typeof next === 'function' ? next(read()) : next);
}

/** Заявка оформлена без связи — ставим в очередь отправки. */
export function queueOffline(orderId: ID): void {
  setOffline((s) => (s.queued.includes(orderId) ? s : { ...s, queued: [...s.queued, orderId] }));
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = null;
    fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

export function useOffline(): OfflineState {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
