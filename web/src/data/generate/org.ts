/* Сотрудники, поставщики и настройки магазина. */
import type { DB, Employee, RoleKey, Settings, Supplier } from '../types';
import type { Rng } from '../rng';
import { makeInn10, makeInn12 } from '../codes';
import type { ProdMeta } from './catalog';

export const E = {
  owner: 'e-gadzhiev',
  alieva: 'e-alieva',
  kurbanova: 'e-kurbanova',
  omarov: 'e-omarov',
  magomedova: 'e-magomedova',
  rasulova: 'e-rasulova',
  abdullaev: 'e-abdullaev',
  khalilov: 'e-khalilov',
  suleymanova: 'e-suleymanova',
  ibragimov: 'e-ibragimov',
  ismailov: 'e-ismailov',
  abakarova: 'e-abakarova',
  musaev: 'e-musaev',
  ramazanov: 'e-ramazanov',
  daudov: 'e-daudov',
} as const;

export const REPS = [E.rasulova, E.abdullaev, E.khalilov] as const;
export const MANAGERS = [E.omarov, E.magomedova] as const;
export const COURIERS = [E.musaev, E.ramazanov, E.daudov] as const;
export const SELLERS = [E.alieva, E.kurbanova] as const;
export const WAREHOUSE = [E.ibragimov, E.ismailov] as const;

/** Дата выхода Арсена Халилова: с этого дня он представитель, ему передают часть точек. */
export const KHALILOV_START = '2026-09-14';

const EMPLOYEES: [string, string, RoleKey[], string, string, boolean][] = [
  [E.owner, 'Магомед Гаджиев', ['owner'], '+79171500101', '2019-03-01', true],
  [E.alieva, 'Патимат Алиева', ['seller'], '+79275614422', '2022-05-16', true],
  [E.kurbanova, 'Мадина Курбанова', ['seller'], '+79613057718', '2024-02-01', true],
  [E.omarov, 'Шамиль Омаров', ['manager'], '+79171837740', '2021-09-01', true],
  [E.magomedova, 'Зарема Магомедова', ['manager'], '+79378220953', '2023-04-10', true],
  [E.rasulova, 'Аминат Расулова', ['rep'], '+79275092316', '2022-08-22', true],
  [E.abdullaev, 'Ислам Абдуллаев', ['rep'], '+79884417205', '2023-11-13', true],
  [E.khalilov, 'Арсен Халилов', ['rep'], '+79054781139', KHALILOV_START, false],
  [E.suleymanova, 'Хадижат Сулейманова', ['accountant'], '+79171269084', '2020-01-15', true],
  [E.ibragimov, 'Гусейн Ибрагимов', ['warehouse'], '+79613428867', '2021-03-01', true],
  [E.ismailov, 'Мурад Исмаилов', ['warehouse'], '+79371150642', '2024-06-03', true],
  [E.abakarova, 'Джамиля Абакарова', ['dispatcher'], '+79275536019', '2023-02-20', true],
  [E.musaev, 'Саид Мусаев', ['courier'], '+79171764453', '2022-10-01', true],
  [E.ramazanov, 'Камиль Рамазанов', ['courier'], '+79884203378', '2024-04-15', true],
  [E.daudov, 'Ахмед Даудов', ['courier'], '+79053317790', '2025-03-10', true],
];

export function buildEmployees(db: DB): void {
  for (const [id, name, roles, phone, hiredAt, active] of EMPLOYEES) {
    const [first, last] = name.split(' ');
    const e: Employee = { id, name, short: `${first} ${last[0]}.`, roles: [...roles], phone, active, hiredAt };
    db.employees.push(e);
  }
}

export interface SupplierDef {
  key: string;
  supplier: Supplier;
}

export function buildSuppliers(db: DB, rng: Rng, meta: ProdMeta[]): Map<string, string> {
  const defs: [string, string, string, string, string, number, number, number][] = [
    ['yug', 'ООО «ЮгХимОпт»', makeInn10('301508' + '642'), '+78512483310', 'Абдулла Магомедович Нурмагомедов, менеджер', 3, 21, 50000],
    ['kaspiy', 'ООО «Каспий-Дистрибуция»', makeInn10('301920' + '115'), '+78512397740', 'Сабина Тагировна Мирзоева, отдел продаж', 2, 14, 40000],
    ['volga', 'ООО «Волга-Трейд»', makeInn10('344406' + '278'), '+78442505621', 'Загир Ахмедович Шахбанов, региональный менеджер', 5, 30, 80000],
    ['dvor', 'ООО «ТД Южный двор»', makeInn10('616703' + '904'), '+78632263318', 'Луиза Камилевна Гаджимурадова, менеджер', 6, 21, 60000],
    ['hoz', 'ИП Гасанов Р. М. «Хозторг»', makeInn12('3016' + '084217'), '+79171402277', 'Рашид Магомедович Гасанов', 2, 7, 15000],
    ['paper', 'ООО «Бумажный мир Юг»', makeInn10('231008' + '537'), '+78612173390', 'Эльдар Русланович Кадиев, менеджер', 5, 21, 50000],
    ['eko', 'ООО «ЭкоХим Поволжье»', makeInn10('631904' + '661'), '+78462006184', 'Наида Шамилевна Исаева, менеджер', 8, 14, 40000],
  ];
  const ids = new Map<string, string>();
  defs.forEach(([key, name, inn, phone, contact, leadDays, deferDays, minOrder], i) => {
    const id = 's-' + (i + 1);
    ids.set(key, id);
    db.suppliers.push({ id, name, inn, phone, contact, leadDays, deferDays, minOrder });
  });
  // основной поставщик по бренду; у части товаров запасной — «Хозторг» или «Волга-Трейд»
  for (const m of meta) {
    const p = db.products[m.index];
    const main = ids.get(m.supplierKey)!;
    p.supplierIds = [main];
    if (rng.chance(0.08)) {
      const alt = m.supplierKey === 'hoz' ? ids.get('kaspiy')! : ids.get('hoz')!;
      if (alt !== main) p.supplierIds.push(alt);
    }
  }
  return ids;
}

export function buildSettings(): Settings {
  return {
    company: {
      name: 'БытМаркет',
      legalName: 'ООО «БытМаркет»',
      inn: makeInn10('301908' + '473'),
      address: '414041, г. Астрахань, ул. Бориса Алексеева, 46',
      phone: '+78512556070',
      bank: 'Астраханское отделение № 8625 ПАО Сбербанк, БИК 041203602',
      account: '40702810505000014826',
    },
    // на начало периода: представитель 5 %, минимальная наценка 10 % — поднимают операциями в сентябре и октябре
    discountLimits: { owner: 100, seller: 5, manager: 10, rep: 5, accountant: 0, warehouse: 0, dispatcher: 0, courier: 0 },
    minMarginPct: 10,
    defaultDeferDays: 14,
    deliveryFee: 300,
    freeDeliveryFrom: 5000,
    // WhatsApp подключают 20 октября (операция в истории); до этого переписка шла с личных телефонов
    whatsapp: {
      connected: false,
      phone: '+79275556070',
      since: null,
      auto: { confirmed: true, pickup_ready: true, on_way: true, delivered: true, payment: true, away: true },
      hours: { from: '08:00', to: '19:00' },
    },
  };
}
