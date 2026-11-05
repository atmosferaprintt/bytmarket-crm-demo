/* Генератор демо-магазина «БытМаркет» за 3 месяца: с 5 августа по 5 ноября 2026 года.
   Одно и то же зерно всегда даёт одну и ту же базу. */
import type { DB } from '../types';
import { Rng } from '../rng';
import { buildCatalog } from './catalog';
import { buildClients } from './clients';
import { buildEmployees, buildSettings, buildSuppliers } from './org';
import { simulate } from './sim';
import type { SimStats } from './sim';
import { buildChats, buildPlans, buildTasks } from './extras';

export const DEMO_START = '2026-08-05';
export const DEMO_TODAY = '2026-11-05';
export const DEFAULT_SEED = 20261105;

/** Последняя статистика генерации (для тестов и отладки). */
export let lastGenerationStats: SimStats | null = null;

function emptyDB(seed: number): DB {
  return {
    meta: { seed, today: DEMO_TODAY, startDate: DEMO_START, version: 0 },
    employees: [],
    categories: [],
    brands: [],
    groups: [],
    products: [],
    stock: [],
    batches: [],
    quarantine: [],
    movements: [],
    stockDocs: [],
    clients: [],
    promos: [],
    priceChanges: [],
    orders: [],
    shifts: [],
    receipts: [],
    payments: [],
    suppliers: [],
    purchases: [],
    returns: [],
    deliveries: [],
    visits: [],
    tasks: [],
    chats: [],
    plans: [],
    audit: [],
    settings: buildSettings(),
    // номера документов продолжают нумерацию магазина до начала демо
    counters: { order: 3100, receipt: 51200, payment: 7400, shift: 410, stockDoc: 640, purchase: 212, return: 86, delivery: 1480, product: 1100 },
  };
}

export function generate(seed: number = DEFAULT_SEED): DB {
  const rng = new Rng(seed);
  const db = emptyDB(seed);
  buildEmployees(db);
  const meta = buildCatalog(db, rng.fork('catalog'));
  const supplierIds = buildSuppliers(db, rng.fork('suppliers'), meta);
  const { metas } = buildClients(db, rng.fork('clients'), meta, DEMO_START);
  lastGenerationStats = simulate({ db, rng: rng.fork('sim'), meta, clients: metas, supplierIds });
  buildPlans(db, rng.fork('plans'));
  buildChats(db, rng.fork('chats'), metas);
  buildTasks(db, rng.fork('tasks'), meta);
  db.meta.version++;
  return db;
}
