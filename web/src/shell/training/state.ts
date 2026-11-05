/* Режим обучения: включён ли и какие подсказки уже просмотрены. Хранится в браузере у каждого. */
import { useSyncExternalStore } from 'react';

const KEY = 'bm-training-v1';

interface TrainingState {
  on: boolean;
  seen: string[];
}

let state: TrainingState = read();
const listeners = new Set<() => void>();

function read(): TrainingState {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return { on: false, seen: [] };
    const x = JSON.parse(raw) as Partial<TrainingState>;
    return { on: x.on === true, seen: Array.isArray(x.seen) ? x.seen.filter((s) => typeof s === 'string') : [] };
  } catch {
    return { on: false, seen: [] };
  }
}

function write(next: TrainingState): void {
  state = next;
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(next));
  } catch {
    /* не запомним — режим живёт до перезагрузки */
  }
  for (const l of listeners) l();
}

export function setTraining(on: boolean): void {
  write({ ...state, on });
}

export function markSeen(id: string): void {
  if (state.seen.includes(id)) return;
  write({ ...state, seen: [...state.seen, id] });
}

export function resetSeen(): void {
  write({ ...state, seen: [] });
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useTraining(): TrainingState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}
