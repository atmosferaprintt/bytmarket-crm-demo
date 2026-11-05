/* Хранилище демо. База всегда заново генерируется из зерна, поверх проигрывается журнал
   операций пользователя из localStorage («bytmarket-demo-v2-ops»). Разделы читают базу через
   getDB / useDB и меняют только через dispatch. */
import { useSyncExternalStore } from 'react';
import type { DB, ID, ISODateTime } from './types';
import { OpError, applyOp, ops } from './ops';
import { DEFAULT_SEED, generate } from './generate';
import { cloneRoot } from './idx';

export type OpType = keyof typeof ops;

const STORAGE_KEY = 'bytmarket-demo-v2-ops';
/** Версия исходных данных. Менять при любой правке генератора: старый журнал тогда отбрасывается, а не применяется к другим товарам. */
export const DATA_VERSION = 'g6';
const MIN_MINUTES = 14 * 60 + 5; // сгенерированные события идут до 14:00
const MAX_MINUTES = 20 * 60 + 55;

interface JournalEntry {
  type: OpType;
  payload: unknown;
  actorId: ID;
  at: ISODateTime;
}

let db: DB | null = null;
let journal: JournalEntry[] = [];
let version = 0;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function isEntry(x: unknown): x is JournalEntry {
  if (!x || typeof x !== 'object') return false;
  const e = x as Record<string, unknown>;
  return typeof e.type === 'string' && e.type in ops && typeof e.actorId === 'string' && typeof e.at === 'string';
}

function readJournal(): JournalEntry[] {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { v?: unknown; ops?: unknown } | unknown[];
    if (Array.isArray(parsed) || !parsed || parsed.v !== DATA_VERSION || !Array.isArray(parsed.ops)) return [];
    return parsed.ops.filter(isEntry);
  } catch (e) {
    console.warn('Журнал демо не прочитан — начинаем с исходных данных', e);
    return [];
  }
}

function writeJournal(): void {
  try {
    const s = storage();
    if (!s) return;
    if (journal.length) s.setItem(STORAGE_KEY, JSON.stringify({ v: DATA_VERSION, ops: journal }));
    else s.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('Не удалось сохранить журнал демо', e);
  }
}

function load(): DB {
  const base = generate(DEFAULT_SEED);
  const saved = readJournal();
  const kept: JournalEntry[] = [];
  for (const e of saved) {
    try {
      applyOp(base, e.type, e.payload, { actorId: e.actorId, at: e.at });
      kept.push(e);
    } catch (err) {
      console.warn(`Операция «${e.type}» из журнала не применилась и пропущена:`, err instanceof Error ? err.message : err);
    }
  }
  journal = kept;
  if (kept.length !== saved.length) writeJournal();
  return base;
}

function emit(): void {
  version++;
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const getVersion = (): number => version;

/** Текущая база (генерируется один раз при первом обращении). */
export function getDB(): DB {
  if (!db) db = load();
  return db;
}

/** React-хук: перерисовка при любом изменении базы. */
export function useDB(): DB {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return getDB();
}

export function useDBVersion(): number {
  return useSyncExternalStore(subscribe, getVersion, getVersion);
}

const pad2 = (n: number): string => (n < 10 ? '0' + n : String(n));

/** «Сейчас» демо: сегодняшняя дата демо и текущее время суток, но не раньше 14:05 и не позже 20:55.
    Время не идёт назад относительно последней операции пользователя. */
export function nowDemo(): ISODateTime {
  const today = getDB().meta.today;
  const d = new Date();
  const m = Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, d.getHours() * 60 + d.getMinutes()));
  let at = `${today}T${pad2(Math.floor(m / 60))}:${pad2(m % 60)}`;
  const last = journal[journal.length - 1]?.at;
  if (last && last > at && last.startsWith(today)) at = last;
  return at;
}

/** Выполнить операцию от имени сотрудника. Ошибка правила — { ok: false, error } с понятным текстом. */
export function dispatch(type: OpType, payload: unknown, actorId: ID): { ok: true; id?: ID; info?: string } | { ok: false; error: string } {
  const cur = getDB();
  let clean: unknown;
  try {
    clean = payload === undefined ? undefined : JSON.parse(JSON.stringify(payload));
  } catch {
    return { ok: false, error: 'Данные операции не удалось сохранить' };
  }
  const at = nowDemo();
  try {
    const r = applyOp(cur, type, clean, { actorId, at });
    journal.push({ type, payload: clean, actorId, at });
    writeJournal();
    db = cloneRoot(cur);
    emit();
    return { ok: true, ...(r.id !== undefined ? { id: r.id } : {}), ...(r.info !== undefined ? { info: r.info } : {}) };
  } catch (e) {
    if (e instanceof OpError) return { ok: false, error: e.message };
    console.error('Ошибка операции демо', type, e);
    return { ok: false, error: 'Внутренняя ошибка демо: ' + (e instanceof Error ? e.message : String(e)) };
  }
}

/** Стереть журнал операций и пересоздать базу из зерна. */
export function resetDemo(): void {
  journal = [];
  writeJournal();
  db = generate(DEFAULT_SEED);
  emit();
}
