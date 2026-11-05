/* Меню: 11 пунктов, вкладки внутри разделов. Утверждено в docs/10-audit-and-plan.md. */
import type { LucideIcon } from 'lucide-react';
import { BarChart3, ClipboardList, LayoutDashboard, Package, Receipt, ScanBarcode, Settings, Truck, Users, Wallet, Warehouse } from 'lucide-react';
import type { RoleKey } from '../data/types';
import type { SectionKey } from '../roles/roles';

export interface TabDef {
  key: string;
  label: string;
  path: string; // полный путь
  roles?: RoleKey[]; // если задано — только эти роли
}

export interface SectionDef {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
  group: string;
  path: string;
  tabs: TabDef[];
}

export const SECTIONS: SectionDef[] = [
  {
    key: 'overview',
    label: 'Обзор',
    icon: LayoutDashboard,
    group: 'Работа',
    path: '/overview',
    tabs: [
      { key: 'main', label: 'Обзор', path: '/overview' },
      { key: 'attention', label: 'Требует внимания', path: '/overview/attention', roles: ['owner', 'accountant'] },
    ],
  },
  {
    key: 'register',
    label: 'Касса',
    icon: ScanBarcode,
    group: 'Работа',
    path: '/register',
    tabs: [
      { key: 'sale', label: 'Продажа', path: '/register' },
      { key: 'shift', label: 'Смена', path: '/register/shift' },
      { key: 'receipts', label: 'Чеки', path: '/register/receipts' },
    ],
  },
  {
    key: 'sales',
    label: 'Продажи',
    icon: Receipt,
    group: 'Работа',
    path: '/sales',
    tabs: [
      { key: 'orders', label: 'Заказы', path: '/sales' },
      { key: 'returns', label: 'Возвраты', path: '/sales/returns', roles: ['owner', 'manager', 'accountant'] },
      { key: 'chats', label: 'Чаты', path: '/sales/chats', roles: ['owner', 'manager', 'rep'] },
    ],
  },
  {
    key: 'clients',
    label: 'Клиенты',
    icon: Users,
    group: 'Работа',
    path: '/clients',
    tabs: [
      { key: 'list', label: 'Клиенты', path: '/clients' },
      { key: 'reps', label: 'Представители и визиты', path: '/clients/reps', roles: ['owner', 'manager', 'rep'] },
    ],
  },
  {
    key: 'delivery',
    label: 'Доставка',
    icon: Truck,
    group: 'Работа',
    path: '/delivery',
    tabs: [
      { key: 'queue', label: 'Доставки', path: '/delivery' },
      { key: 'routes', label: 'Маршруты курьеров', path: '/delivery/routes', roles: ['owner', 'dispatcher'] },
      { key: 'cash', label: 'Деньги курьеров', path: '/delivery/cash', roles: ['owner', 'dispatcher', 'courier'] },
    ],
  },
  {
    key: 'products',
    label: 'Товары',
    icon: Package,
    group: 'Товар',
    path: '/products',
    tabs: [
      { key: 'catalog', label: 'Каталог', path: '/products' },
      { key: 'pricing', label: 'Цены и акции', path: '/products/pricing', roles: ['owner', 'manager', 'accountant'] },
    ],
  },
  {
    key: 'stock',
    label: 'Склад',
    icon: Warehouse,
    group: 'Товар',
    path: '/stock',
    tabs: [
      { key: 'stock', label: 'Остатки', path: '/stock' },
      { key: 'picking', label: 'Сборка', path: '/stock/picking' },
      { key: 'docs', label: 'Документы', path: '/stock/docs' },
      { key: 'quarantine', label: 'Карантин', path: '/stock/quarantine' },
    ],
  },
  {
    key: 'purchases',
    label: 'Закупки',
    icon: ClipboardList,
    group: 'Товар',
    path: '/purchases',
    tabs: [
      { key: 'orders', label: 'Заказы поставщикам', path: '/purchases' },
      { key: 'suggest', label: 'Предложение на закупку', path: '/purchases/suggest', roles: ['owner', 'warehouse'] },
      { key: 'suppliers', label: 'Поставщики', path: '/purchases/suppliers' },
    ],
  },
  {
    key: 'money',
    label: 'Деньги',
    icon: Wallet,
    group: 'Контроль',
    path: '/money',
    tabs: [
      { key: 'journal', label: 'Журнал', path: '/money', roles: ['owner', 'accountant'] },
      { key: 'debts', label: 'Долги покупателей', path: '/money/debts' },
      { key: 'suppliers', label: 'Долги поставщикам', path: '/money/suppliers', roles: ['owner', 'accountant'] },
      { key: 'expenses', label: 'Расходы', path: '/money/expenses', roles: ['owner', 'accountant'] },
      { key: 'accounts', label: 'Кассы и счета', path: '/money/accounts', roles: ['owner', 'accountant'] },
    ],
  },
  {
    key: 'reports',
    label: 'Отчёты',
    icon: BarChart3,
    group: 'Контроль',
    path: '/reports',
    tabs: [
      { key: 'products', label: 'Товары', path: '/reports' },
      { key: 'clients', label: 'Клиенты', path: '/reports/clients' },
      { key: 'staff', label: 'Сотрудники', path: '/reports/staff' },
      { key: 'promos', label: 'Акции', path: '/reports/promos' },
      { key: 'delivery', label: 'Доставка', path: '/reports/delivery' },
    ],
  },
  {
    key: 'settings',
    label: 'Настройки',
    icon: Settings,
    group: 'Контроль',
    path: '/settings',
    tabs: [
      { key: 'company', label: 'Компания', path: '/settings' },
      { key: 'team', label: 'Команда и права', path: '/settings/team' },
      { key: 'setup', label: 'Подготовка к работе', path: '/settings/setup' },
      { key: 'integrations', label: 'Подключения', path: '/settings/integrations' },
    ],
  },
];

export function sectionByKey(key: SectionKey): SectionDef {
  return SECTIONS.find((s) => s.key === key)!;
}

export function tabsFor(section: SectionKey, role: RoleKey): TabDef[] {
  return sectionByKey(section)
    .tabs.filter((t) => !t.roles || t.roles.includes(role))
    .map((t) => (role === 'courier' && t.key === 'cash' ? { ...t, label: 'Мои деньги' } : t));
}

/** Подписи разделов для отдельных ролей: у представителя «Обзор» — это «Мой день». */
export function sectionLabel(section: SectionKey, role: RoleKey): string {
  if (section === 'overview') {
    if (role === 'rep') return 'Мой день';
    if (role === 'courier') return 'Сегодня';
    if (role === 'owner') return 'Обзор';
    return 'Рабочий стол';
  }
  if (role === 'courier' && section === 'delivery') return 'Доставки';
  if (role === 'rep' && section === 'sales') return 'Заказы';
  if (role === 'rep' && section === 'products') return 'Каталог';
  return sectionByKey(section).label;
}
