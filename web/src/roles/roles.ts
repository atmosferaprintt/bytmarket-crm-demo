/* Роли демо: какие разделы видны, что можно делать. Это показ, а не защита данных. */
import type { RoleKey } from '../data/types';

export type SectionKey =
  | 'overview'
  | 'register'
  | 'sales'
  | 'clients'
  | 'products'
  | 'stock'
  | 'purchases'
  | 'money'
  | 'delivery'
  | 'reports'
  | 'settings';

export type Perm =
  | 'seeCost' // закупочные цены и себестоимость
  | 'seeProfit' // прибыль и маржа
  | 'editPrices'
  | 'editCatalog'
  | 'editClients'
  | 'allClients' // видит всех клиентов, а не только своих
  | 'createOrder' // подтверждённый заказ с резервом
  | 'createRequest' // заявка без резерва
  | 'confirmOrder'
  | 'cancelOrder'
  | 'overrideLimit' // подтвердить сверх лимита / при просрочке
  | 'shipOrder'
  | 'acceptPayment'
  | 'confirmPayment' // подтвердить перевод по выписке
  | 'refundMoney'
  | 'paySupplier'
  | 'expenses'
  | 'sellRegister'
  | 'refundReceipt'
  | 'writeoff'
  | 'transfer'
  | 'count'
  | 'income'
  | 'inspectQuarantine'
  | 'createPurchase'
  | 'approvePurchase'
  | 'receivePurchase'
  | 'assignDelivery'
  | 'deliver'
  | 'handInCash'
  | 'planVisits'
  | 'promos'
  | 'export'
  | 'manageTeam'
  | 'settings';

export interface RoleMeta {
  key: RoleKey;
  name: string; // «Торговый представитель»
  short: string; // «Представитель»
  about: string; // одна строка: что делает в системе
  sees: string; // «видит: …»
  mobile: boolean; // основной экран — телефон
  sections: SectionKey[];
  perms: Perm[];
}

const ALL_SECTIONS: SectionKey[] = ['overview', 'register', 'sales', 'clients', 'products', 'stock', 'purchases', 'money', 'delivery', 'reports', 'settings'];

const ALL_PERMS: Perm[] = [
  'seeCost', 'seeProfit', 'editPrices', 'editCatalog', 'editClients', 'allClients', 'createOrder', 'createRequest', 'confirmOrder', 'cancelOrder',
  'overrideLimit', 'shipOrder', 'acceptPayment', 'confirmPayment', 'refundMoney', 'paySupplier', 'expenses', 'sellRegister', 'refundReceipt',
  'writeoff', 'transfer', 'count', 'income', 'inspectQuarantine', 'createPurchase', 'approvePurchase', 'receivePurchase', 'assignDelivery',
  'deliver', 'handInCash', 'planVisits', 'promos', 'export', 'manageTeam', 'settings',
];

export const ROLES: Record<RoleKey, RoleMeta> = {
  owner: {
    key: 'owner',
    name: 'Владелец',
    short: 'Владелец',
    about: 'Результат магазина, деньги, сигналы и решения',
    sees: 'всё, включая прибыль и закупочные цены',
    mobile: false,
    sections: ALL_SECTIONS,
    perms: ALL_PERMS,
  },
  seller: {
    key: 'seller',
    name: 'Продавец',
    short: 'Продавец',
    about: 'Быстрая продажа на кассе, смена, возврат по чеку',
    sees: 'кассу, свои чеки и каталог без закупочных цен',
    mobile: false,
    sections: ['overview', 'register', 'products'],
    perms: ['sellRegister', 'refundReceipt'],
  },
  manager: {
    key: 'manager',
    name: 'Менеджер',
    short: 'Менеджер',
    about: 'Свои оптовые клиенты, заказы, резервы и оплаты',
    sees: 'своих клиентов, их заказы, долги и доставки',
    mobile: false,
    sections: ['overview', 'sales', 'clients', 'products', 'delivery', 'money'],
    perms: ['editClients', 'createOrder', 'createRequest', 'confirmOrder', 'cancelOrder', 'shipOrder', 'acceptPayment', 'planVisits', 'export'],
  },
  rep: {
    key: 'rep',
    name: 'Торговый представитель',
    short: 'Представитель',
    about: 'Мой день: визиты по точкам, заявки, долги клиентов',
    sees: 'только закреплённые точки и свои заявки',
    mobile: true,
    sections: ['overview', 'clients', 'sales', 'products'],
    perms: ['createRequest', 'planVisits'],
  },
  accountant: {
    key: 'accountant',
    name: 'Бухгалтер',
    short: 'Бухгалтер',
    about: 'Платежи, долги покупателей и поставщикам, расходы, сверка',
    sees: 'деньги, документы, прибыль; без правки товара',
    mobile: false,
    sections: ['overview', 'money', 'sales', 'clients', 'products', 'purchases', 'reports'],
    perms: ['seeCost', 'seeProfit', 'allClients', 'acceptPayment', 'confirmPayment', 'refundMoney', 'paySupplier', 'expenses', 'export'],
  },
  warehouse: {
    key: 'warehouse',
    name: 'Сотрудник склада',
    short: 'Склад',
    about: 'Приёмка, сборка, перемещения, пересчёт, карантин',
    sees: 'остатки и документы склада, без цен закупки',
    mobile: false,
    sections: ['overview', 'stock', 'purchases', 'products', 'delivery'],
    perms: ['shipOrder', 'writeoff', 'transfer', 'count', 'income', 'inspectQuarantine', 'receivePurchase'],
  },
  dispatcher: {
    key: 'dispatcher',
    name: 'Диспетчер',
    short: 'Диспетчер',
    about: 'Назначение доставок, маршруты курьеров, проблемы',
    sees: 'доставки, адреса и контакты получателей',
    mobile: false,
    sections: ['overview', 'delivery'],
    perms: ['assignDelivery', 'handInCash'],
  },
  courier: {
    key: 'courier',
    name: 'Курьер',
    short: 'Курьер',
    about: 'Только назначенные мне доставки',
    sees: 'свои заявки: адрес, контакт, сумму к получению',
    mobile: true,
    sections: ['overview', 'delivery'],
    perms: ['deliver'],
  },
};

export const ROLE_ORDER: RoleKey[] = ['owner', 'seller', 'manager', 'rep', 'accountant', 'warehouse', 'dispatcher', 'courier'];

export function roleCan(role: RoleKey, perm: Perm): boolean {
  return ROLES[role].perms.includes(perm);
}

export function roleSees(role: RoleKey, section: SectionKey): boolean {
  return ROLES[role].sections.includes(section);
}
