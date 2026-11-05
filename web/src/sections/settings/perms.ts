/* Права простыми словами для матрицы «что может каждая роль». Источник прав — ROLES в roles/roles.ts. */
import type { RoleKey } from '../../data/types';
import { ROLES, type Perm } from '../../roles/roles';

export interface PermRow {
  key: Perm | 'discount';
  label: string;
  /** отдельное ограничение из задания (§3): закупочные цены, прибыль, чужие клиенты, цены, скидки, списания, возвраты, выгрузка */
  brief?: boolean;
}

export interface PermGroup {
  key: string;
  label: string;
  rows: PermRow[];
}

export const PERM_GROUPS: PermGroup[] = [
  {
    key: 'money',
    label: 'Деньги',
    rows: [
      { key: 'seeCost', label: 'Видит закупочные цены и себестоимость', brief: true },
      { key: 'seeProfit', label: 'Видит прибыль и маржу', brief: true },
      { key: 'acceptPayment', label: 'Принимает оплату от клиентов' },
      { key: 'confirmPayment', label: 'Подтверждает переводы по выписке' },
      { key: 'refundMoney', label: 'Возвращает деньги покупателям', brief: true },
      { key: 'paySupplier', label: 'Платит поставщикам' },
      { key: 'expenses', label: 'Записывает расходы' },
      { key: 'handInCash', label: 'Принимает деньги у курьеров' },
    ],
  },
  {
    key: 'stock',
    label: 'Товар и склад',
    rows: [
      { key: 'editPrices', label: 'Меняет цены', brief: true },
      { key: 'promos', label: 'Заводит акции' },
      { key: 'editCatalog', label: 'Добавляет и правит товары' },
      { key: 'writeoff', label: 'Списывает товар', brief: true },
      { key: 'income', label: 'Оприходует товар' },
      { key: 'transfer', label: 'Перемещает между магазином и складом' },
      { key: 'count', label: 'Проводит пересчёт' },
      { key: 'inspectQuarantine', label: 'Решает по товару на проверке' },
      { key: 'createPurchase', label: 'Составляет заказ поставщику' },
      { key: 'approvePurchase', label: 'Подтверждает закупку' },
      { key: 'receivePurchase', label: 'Принимает поставку' },
    ],
  },
  {
    key: 'sales',
    label: 'Продажи',
    rows: [
      { key: 'discount', label: 'Ручная скидка, не больше', brief: true },
      { key: 'sellRegister', label: 'Продаёт на кассе' },
      { key: 'refundReceipt', label: 'Оформляет возврат по чеку', brief: true },
      { key: 'createOrder', label: 'Создаёт оптовый заказ с резервом' },
      { key: 'createRequest', label: 'Принимает заявку без резерва' },
      { key: 'confirmOrder', label: 'Подтверждает заказ' },
      { key: 'cancelOrder', label: 'Отменяет заказ' },
      { key: 'overrideLimit', label: 'Отгружает сверх лимита и при просрочке' },
      { key: 'shipOrder', label: 'Отгружает заказ' },
      { key: 'assignDelivery', label: 'Назначает доставки курьерам' },
      { key: 'deliver', label: 'Вручает доставки' },
      { key: 'planVisits', label: 'Планирует визиты к клиентам' },
    ],
  },
  {
    key: 'data',
    label: 'Данные',
    rows: [
      { key: 'allClients', label: 'Видит всех клиентов, а не только своих', brief: true },
      { key: 'editClients', label: 'Заводит и правит клиентов' },
      { key: 'export', label: 'Выгружает данные в Excel', brief: true },
      { key: 'manageTeam', label: 'Управляет сотрудниками и правами' },
      { key: 'settings', label: 'Меняет настройки магазина' },
    ],
  },
];

export const BRIEF_ROWS_COUNT = PERM_GROUPS.reduce((n, g) => n + g.rows.filter((r) => r.brief).length, 0);
export const ALL_ROWS_COUNT = PERM_GROUPS.reduce((n, g) => n + g.rows.length, 0);

/** Роль вообще продаёт: касса, заказ или заявка. Только у таких ролей есть смысл в лимите скидки. */
export function roleSells(role: RoleKey): boolean {
  const p = ROLES[role].perms;
  return role === 'owner' || p.includes('sellRegister') || p.includes('createOrder') || p.includes('createRequest');
}
