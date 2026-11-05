/* Цифры для шагов «Подготовки к работе»: что уже внесено и что стоит проверить перед запуском. */
import type { AccountKey, DB } from '../../../data/types';
import { accountBalances, clientBalances, stockIndex, supplierBalances } from '../../../data/selectors';
import { isInn } from '../../../data/codes';
import { nameTokens } from './importer';

export interface CheckItem {
  key: string;
  label: string;
  count: number;
  unit: [string, string, string];
  to: string;
  /** не ошибка, а то, что стоит знать */
  soft?: boolean;
}

export interface SetupStats {
  products: { total: number; active: number; noCost: number; innerCodes: number; createdToday: number; brands: number; categories: number };
  stock: {
    active: number;
    withStock: number;
    shopItems: number;
    shopUnits: number;
    whItems: number;
    whUnits: number;
    quarantine: number;
    initialDocs: number;
    initialDate: string | null;
    lastCount: string | null;
    batches: number;
    belowMin: number;
  };
  money: {
    clientsDebt: number;
    debtSum: number;
    overdueClients: number;
    overdueSum: number;
    advanceSum: number;
    suppliersDebt: number;
    supplierDebtSum: number;
    accounts: Record<AccountKey, number>;
    initialMoneyDate: string | null;
  };
  checks: CheckItem[];
}

export function setupStats(db: DB): SetupStats {
  const today = db.meta.today;
  const m = db.settings.minMarginPct;

  // товары
  let noCost = 0;
  let innerCodes = 0;
  let createdToday = 0;
  let active = 0;
  let belowMargin = 0;
  const names = new Map<string, number>();
  for (const p of db.products) {
    if (p.active) active++;
    if (p.cost === null) noCost++;
    if (p.packs[0]?.barcode.startsWith('2')) innerCodes++;
    if (p.createdAt === today) createdToday++;
    if (p.active && p.cost !== null && p.wholesalePrice < Math.ceil((p.cost * (100 + m)) / 100)) belowMargin++;
    const k = nameTokens(p.name).exact;
    names.set(k, (names.get(k) ?? 0) + 1);
  }
  let dupNames = 0;
  for (const n of names.values()) if (n > 1) dupNames += n;

  // остатки
  const si = stockIndex(db);
  let withStock = 0;
  let shopItems = 0;
  let shopUnits = 0;
  let whItems = 0;
  let whUnits = 0;
  let quarantine = 0;
  let belowMin = 0;
  for (const p of db.products) {
    const s = si.get(p.id);
    if (!s) continue;
    if (p.active && s.total.onHand > 0) withStock++;
    if (s.shop.onHand > 0) shopItems++;
    if (s.warehouse.onHand > 0) whItems++;
    shopUnits += s.shop.onHand;
    whUnits += s.warehouse.onHand;
    quarantine += s.quarantine;
    if (p.active && p.minStock > 0 && s.total.available < p.minStock) belowMin++;
  }
  let negative = 0;
  for (const r of db.stock) if (r.onHand < 0 || r.reserved > r.onHand) negative++;
  let initialDocs = 0;
  let initialDate: string | null = null;
  let lastCount: string | null = null;
  for (const d of db.stockDocs) {
    if (d.kind === 'initial') {
      initialDocs++;
      if (!initialDate || d.at < initialDate) initialDate = d.at;
    }
    if (d.kind === 'count' && (!lastCount || d.at > lastCount)) lastCount = d.at;
  }
  const batches = db.batches.filter((b) => b.qty > 0).length;

  // долги и деньги
  const cb = clientBalances(db);
  let clientsDebt = 0;
  let debtSum = 0;
  let overdueClients = 0;
  let overdueSum = 0;
  let advanceSum = 0;
  for (const b of cb.values()) {
    if (b.debt > 0) {
      clientsDebt++;
      debtSum += b.debt;
    }
    if (b.overdue > 0) {
      overdueClients++;
      overdueSum += b.overdue;
    }
    advanceSum += b.advance;
  }
  const sb = supplierBalances(db);
  let suppliersDebt = 0;
  let supplierDebtSum = 0;
  for (const b of sb.values())
    if (b.debt > 0) {
      suppliersDebt++;
      supplierDebtSum += b.debt;
    }
  let initialMoneyDate: string | null = null;
  let pending = 0;
  let unidentified = 0;
  for (const p of db.payments) {
    if (p.kind === 'transfer' && p.direction === 'in' && !p.toAccount && (!initialMoneyDate || p.at < initialMoneyDate)) initialMoneyDate = p.at;
    if (p.status === 'pending') pending++;
    if (p.status === 'unidentified') unidentified++;
  }

  // клиенты
  let noOwner = 0;
  let noInn = 0;
  for (const c of db.clients) {
    if (!c.active) continue;
    if (c.segment !== 'retail' && !c.ownerId) noOwner++;
    if (c.kind !== 'person' && !c.inn) noInn++;
  }
  const co = db.settings.company;
  const companyGaps = (['name', 'legalName', 'inn', 'address', 'phone', 'bank', 'account'] as const).filter((k) => !co[k].trim()).length + (co.inn && !isInn(co.inn) ? 1 : 0);

  const checks: CheckItem[] = [
    { key: 'company', label: 'Реквизиты компании для счетов', count: companyGaps, unit: ['поле не заполнено', 'поля не заполнены', 'полей не заполнено'], to: '/settings' },
    { key: 'noCost', label: 'Товары без себестоимости — прибыль по ним неполная', count: noCost, unit: ['товар', 'товара', 'товаров'], to: '/products' },
    { key: 'dupNames', label: 'Одинаковые названия в каталоге', count: dupNames, unit: ['товар', 'товара', 'товаров'], to: '/products' },
    { key: 'inner', label: 'Без штрихкода производителя, только код магазина', count: innerCodes, unit: ['товар', 'товара', 'товаров'], to: '/products', soft: true },
    { key: 'margin', label: `Опт ниже минимальной наценки ${m} %`, count: belowMargin, unit: ['товар', 'товара', 'товаров'], to: '/products/pricing' },
    { key: 'negative', label: 'Минус на остатке или резерв больше остатка', count: negative, unit: ['строка', 'строки', 'строк'], to: '/stock' },
    { key: 'quarantine', label: 'Товар на проверке: брак, возвраты, недовоз', count: quarantine, unit: ['штука', 'штуки', 'штук'], to: '/stock/quarantine', soft: true },
    { key: 'unidentified', label: 'Неопознанные платежи на счёте', count: unidentified, unit: ['платёж', 'платежа', 'платежей'], to: '/money' },
    { key: 'pending', label: 'Переводы ждут подтверждения по выписке', count: pending, unit: ['перевод', 'перевода', 'переводов'], to: '/money' },
    { key: 'noOwner', label: 'Оптовые клиенты без ответственного', count: noOwner, unit: ['клиент', 'клиента', 'клиентов'], to: '/clients' },
    { key: 'noInn', label: 'Организации и ИП без ИНН — счёт не выставить', count: noInn, unit: ['клиент', 'клиента', 'клиентов'], to: '/clients' },
  ];

  return {
    products: { total: db.products.length, active, noCost, innerCodes, createdToday, brands: db.brands.length, categories: db.categories.length },
    stock: { active, withStock, shopItems, shopUnits, whItems, whUnits, quarantine, initialDocs, initialDate, lastCount, batches, belowMin },
    money: { clientsDebt, debtSum, overdueClients, overdueSum, advanceSum, suppliersDebt, supplierDebtSum, accounts: accountBalances(db), initialMoneyDate },
    checks,
  };
}
