/* Сотрудники, поставщики и настройки магазина. */
import type { DB, Employee, RoleKey, Settings, Supplier } from '../types';
import type { Rng } from '../rng';
import { makeInn10, makeInn12 } from '../codes';
import type { ProdMeta } from './catalog';

export const E = {
  owner: 'e-volkov',
  orlova: 'e-orlova',
  kim: 'e-kim',
  sokolov: 'e-sokolov',
  petrova: 'e-petrova',
  mironova: 'e-mironova',
  abdullaev: 'e-abdullaev',
  tarasov: 'e-tarasov',
  belova: 'e-belova',
  krylov: 'e-krylov',
  ismailov: 'e-ismailov',
  lebedeva: 'e-lebedeva',
  morozov: 'e-morozov',
  zaytsev: 'e-zaytsev',
  vlasov: 'e-vlasov',
} as const;

export const REPS = [E.mironova, E.abdullaev, E.tarasov] as const;
export const MANAGERS = [E.sokolov, E.petrova] as const;
export const COURIERS = [E.morozov, E.zaytsev, E.vlasov] as const;
export const SELLERS = [E.orlova, E.kim] as const;
export const WAREHOUSE = [E.krylov, E.ismailov] as const;

/** Дата выхода Олега Тарасова: с этого дня он представитель, ему передают часть точек. */
export const TARASOV_START = '2026-09-14';

const EMPLOYEES: [string, string, RoleKey[], string, string, boolean][] = [
  [E.owner, 'Александр Волков', ['owner'], '+79171500101', '2019-03-01', true],
  [E.orlova, 'Анна Орлова', ['seller'], '+79275614422', '2022-05-16', true],
  [E.kim, 'Виктория Ким', ['seller'], '+79613057718', '2024-02-01', true],
  [E.sokolov, 'Михаил Соколов', ['manager'], '+79171837740', '2021-09-01', true],
  [E.petrova, 'Ирина Петрова', ['manager'], '+79378220953', '2023-04-10', true],
  [E.mironova, 'Елена Миронова', ['rep'], '+79275092316', '2022-08-22', true],
  [E.abdullaev, 'Руслан Абдуллаев', ['rep'], '+79884417205', '2023-11-13', true],
  [E.tarasov, 'Олег Тарасов', ['rep'], '+79054781139', TARASOV_START, false],
  [E.belova, 'Ольга Белова', ['accountant'], '+79171269084', '2020-01-15', true],
  [E.krylov, 'Сергей Крылов', ['warehouse'], '+79613428867', '2021-03-01', true],
  [E.ismailov, 'Тимур Исмаилов', ['warehouse'], '+79371150642', '2024-06-03', true],
  [E.lebedeva, 'Марина Лебедева', ['dispatcher'], '+79275536019', '2023-02-20', true],
  [E.morozov, 'Денис Морозов', ['courier'], '+79171764453', '2022-10-01', true],
  [E.zaytsev, 'Артём Зайцев', ['courier'], '+79884203378', '2024-04-15', true],
  [E.vlasov, 'Кирилл Власов', ['courier'], '+79053317790', '2025-03-10', true],
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
    ['yug', 'ООО «ЮгХимОпт»', makeInn10('301508' + '642'), '+78512483310', 'Вадим Сергеевич Луценко, менеджер', 3, 21, 50000],
    ['kaspiy', 'ООО «Каспий-Дистрибуция»', makeInn10('301920' + '115'), '+78512397740', 'Алия Маратовна Кенжебаева, отдел продаж', 2, 14, 40000],
    ['volga', 'ООО «Волга-Трейд»', makeInn10('344406' + '278'), '+78442505621', 'Игорь Петрович Сафонов, региональный менеджер', 5, 30, 80000],
    ['dvor', 'ООО «ТД Южный двор»', makeInn10('616703' + '904'), '+78632263318', 'Наталья Викторовна Гречко, менеджер', 6, 21, 60000],
    ['hoz', 'ИП Гасанов Р. М. «Хозторг»', makeInn12('3016' + '084217'), '+79171402277', 'Рашид Магомедович Гасанов', 2, 7, 15000],
    ['paper', 'ООО «Бумажный мир Юг»', makeInn10('231008' + '537'), '+78612173390', 'Денис Олегович Ткаченко, менеджер', 5, 21, 50000],
    ['eko', 'ООО «ЭкоХим Поволжье»', makeInn10('631904' + '661'), '+78462006184', 'Светлана Юрьевна Борисова, менеджер', 8, 14, 40000],
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
  };
}
