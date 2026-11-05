import type { ReactNode } from 'react';
import { RouteTabs } from '../ui';
import type { SectionKey } from '../roles/roles';
import { useSession } from '../roles/session';
import { sectionLabel, tabsFor } from './nav';

/** Шапка раздела в одну строку: заголовок, вкладки раздела (по роли), справа действия.
    На экране одна главная кнопка (variant="primary"), остальное — secondary и меню «⋯». */
export function PageHeader({ section, title, actions, tabs = true, counts }: { section: SectionKey; title?: ReactNode; actions?: ReactNode; tabs?: boolean; counts?: Record<string, number | null | undefined> }) {
  const { role } = useSession();
  const items = tabsFor(section, role);
  return (
    <div className="page-head">
      <h1 className="page-title">{title ?? sectionLabel(section, role)}</h1>
      {tabs && items.length > 1 ? (
        <RouteTabs items={items.map((t, i) => ({ key: t.key, label: t.label, to: t.path, end: i === 0 || true, count: counts?.[t.key] ?? null }))} />
      ) : null}
      {actions ? <div className="page-actions">{actions}</div> : null}
    </div>
  );
}
