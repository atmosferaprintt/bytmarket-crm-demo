import { readFileSync } from 'node:fs';
/* Хранилище: dispatch, журнал в localStorage, проигрывание после перезагрузки, сброс, время демо. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const KEY = 'bytmarket-demo-v2-ops';
// текущая версия данных читается из store.ts, чтобы тест не ломался при её смене
const CURRENT_VERSION = /DATA_VERSION = '([^']+)'/.exec(readFileSync(new URL('./store.ts', import.meta.url), 'utf8'))![1];

class MemoryStorage {
  data = new Map<string, string>();
  getItem(k: string): string | null {
    return this.data.has(k) ? this.data.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.data.set(k, v);
  }
  removeItem(k: string): void {
    this.data.delete(k);
  }
  clear(): void {
    this.data.clear();
  }
  key(i: number): string | null {
    return [...this.data.keys()][i] ?? null;
  }
  get length(): number {
    return this.data.size;
  }
}

let mem: MemoryStorage;

beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('localStorage', mem);
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('store', () => {
  it('dispatch меняет базу, пишет журнал, а после перезагрузки журнал проигрывается', async () => {
    const store = await import('./store');
    const db = store.getDB();
    const tasks = db.tasks.length;
    const r = store.dispatch('task.create', { title: 'Проверить витрину', assigneeId: 'e-kim', due: db.meta.today }, 'e-volkov');
    expect(r.ok).toBe(true);
    expect(store.getDB().tasks.length).toBe(tasks + 1);
    expect(store.getDB()).not.toBe(db); // новая версия — новый корень для React
    const saved = JSON.parse(mem.getItem(KEY)!);
    expect(saved.v).toBe(store.DATA_VERSION);
    expect(saved.ops).toHaveLength(1);
    expect(saved.ops[0]).toMatchObject({ type: 'task.create', actorId: 'e-volkov' });

    vi.resetModules();
    const again = await import('./store');
    const db2 = again.getDB();
    expect(db2.tasks.length).toBe(tasks + 1);
    expect(db2.tasks[db2.tasks.length - 1].title).toBe('Проверить витрину');
  });

  it('ошибка правила возвращается текстом и не попадает в журнал', async () => {
    const store = await import('./store');
    const r = store.dispatch('shift.open', {}, 'e-orlova');
    expect(r).toEqual({ ok: false, error: expect.stringContaining('Смена уже открыта') });
    expect(mem.getItem(KEY)).toBeNull();
    const bad = store.dispatch('order.confirm', { orderId: 'нет-такого' }, 'e-sokolov');
    expect(bad.ok).toBe(false);
  });

  it('повтор с тем же ключом через dispatch не создаёт второй платёж', async () => {
    const store = await import('./store');
    const db = store.getDB();
    const client = db.clients.find((c) => c.segment !== 'retail')!;
    const n = db.payments.length;
    const payload = { clientId: client.id, amount: 1500, method: 'cash', idempotencyKey: 'store-pay-1' };
    const a = store.dispatch('payment.client', payload, 'e-sokolov');
    const b = store.dispatch('payment.client', payload, 'e-sokolov');
    expect(a.ok && b.ok).toBe(true);
    if (a.ok && b.ok) expect(b.id).toBe(a.id);
    expect(store.getDB().payments.length).toBe(n + 1);
  });

  it('сломанная запись журнала пропускается с предупреждением', async () => {
    mem.setItem(
      KEY,
      JSON.stringify({ v: CURRENT_VERSION, ops: [
        { type: 'order.confirm', payload: { orderId: 'нет-такого' }, actorId: 'e-sokolov', at: '2026-11-05T15:00' },
        { type: 'task.create', payload: { title: 'Живая задача', assigneeId: 'e-kim', due: '2026-11-05' }, actorId: 'e-volkov', at: '2026-11-05T15:01' },
        { мусор: true },
      ] }),
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = await import('./store');
    const db = store.getDB();
    expect(db.tasks.some((t) => t.title === 'Живая задача')).toBe(true);
    expect(warn).toHaveBeenCalled();
    expect(JSON.parse(mem.getItem(KEY)!).ops).toHaveLength(1);
    warn.mockRestore();
  });

  it('недоступный localStorage не ломает демо', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('нет доступа');
      },
      setItem: () => {
        throw new Error('нет доступа');
      },
      removeItem: () => {
        throw new Error('нет доступа');
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = await import('./store');
    const r = store.dispatch('task.create', { title: 'Без хранилища', assigneeId: 'e-kim', due: '2026-11-05' }, 'e-volkov');
    expect(r.ok).toBe(true);
    warn.mockRestore();
  });

  it('resetDemo стирает журнал и возвращает исходную базу', async () => {
    const store = await import('./store');
    const tasks = store.getDB().tasks.length;
    store.dispatch('task.create', { title: 'Временная', assigneeId: 'e-kim', due: '2026-11-05' }, 'e-volkov');
    const v = store.useDBVersion.length; // хук не вызываем вне React — только проверяем, что он есть
    expect(typeof v).toBe('number');
    store.resetDemo();
    expect(store.getDB().tasks.length).toBe(tasks);
    expect(mem.getItem(KEY)).toBeNull();
  });

  it('nowDemo: сегодняшняя дата демо и время между 14:05 и 20:55', async () => {
    const store = await import('./store');
    const now = store.nowDemo();
    expect(now.startsWith(store.getDB().meta.today + 'T')).toBe(true);
    const t = now.slice(11);
    expect(t >= '14:05' && t <= '20:55').toBe(true);
  });
});

describe('версия данных', () => {
  it('журнал от другой версии генератора не применяется', async () => {
    vi.resetModules();
    mem.setItem(KEY, JSON.stringify({ v: 'старая', ops: [{ type: 'task.create', payload: { title: 'Из старой версии', assigneeId: 'e-kim', due: '2026-11-05' }, actorId: 'e-volkov', at: '2026-11-05T15:01' }] }));
    const store = await import('./store');
    expect(store.getDB().tasks.some((t) => t.title === 'Из старой версии')).toBe(false);
  });
});
