/* Общие помощники вкладки «Команда и права». */
import type { AuditEntry, RoleKey } from '../../../data/types';
import type { EntityType } from '../../../shell/entities';

export const ENTITY_NAMES: Record<AuditEntry['entity'], string> = {
  product: 'Товары',
  price: 'Цены',
  promo: 'Акции',
  client: 'Клиенты',
  order: 'Заказы',
  payment: 'Деньги',
  stock: 'Склад',
  purchase: 'Закупки',
  delivery: 'Доставка',
  settings: 'Настройки',
  employee: 'Сотрудники',
};

/** Какую карточку открыть по записи журнала. */
export function auditTarget(a: AuditEntry): { type: EntityType; id: string } | null {
  switch (a.entity) {
    case 'product':
    case 'price':
      return { type: 'product', id: a.entityId };
    case 'order':
      return { type: 'order', id: a.entityId };
    case 'client':
      return { type: 'client', id: a.entityId };
    case 'purchase':
      return { type: 'purchase', id: a.entityId };
    case 'delivery':
      return { type: 'delivery', id: a.entityId };
    default:
      return null;
  }
}

/** Телефон к виду +7XXXXXXXXXX; null — номер не похож на российский. */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '');
  if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return '+7' + d.slice(1);
  if (d.length === 10 && d[0] === '9') return '+7' + d;
  return null;
}

/** Роли по порядку: основная первой, новые — в порядке меню. */
export function toggleRole(roles: RoleKey[], r: RoleKey, on: boolean, order: RoleKey[]): RoleKey[] {
  if (!on) return roles.filter((x) => x !== r);
  if (roles.includes(r)) return roles;
  const next = [...roles, r];
  const head = next[0];
  return [head, ...order.filter((x) => x !== head && next.includes(x))];
}
