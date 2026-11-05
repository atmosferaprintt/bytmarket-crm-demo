import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { cx } from './cx';

export interface TabItem {
  key: string;
  label: ReactNode;
  count?: number | null;
}

/** Вкладки-кнопки (состояние внутри экрана). Для вкладок раздела используйте RouteTabs. */
export function Tabs({ items, value, onChange }: { items: TabItem[]; value: string; onChange: (key: string) => void }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={t.key === value} className={cx('tab', t.key === value && 'is-active')} onClick={() => onChange(t.key)}>
          {t.label}
          {t.count ? <span className="tab-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Вкладки раздела — ссылки маршрутизатора. */
export function RouteTabs({ items }: { items: (TabItem & { to: string; end?: boolean })[] }) {
  return (
    <nav className="tabs" aria-label="Вкладки раздела">
      {items.map((t) => (
        <NavLink key={t.key} to={t.to} end={t.end ?? true} className={({ isActive }) => cx('tab', isActive && 'is-active')}>
          {t.label}
          {t.count ? <span className="tab-count">{t.count}</span> : null}
        </NavLink>
      ))}
    </nav>
  );
}

export interface SegOption<V extends string = string> {
  value: V;
  label: ReactNode;
  count?: number | null;
}

/** Фильтры-таблетки. */
export function Segmented<V extends string = string>({ options, value, onChange, ariaLabel }: { options: SegOption<V>[]; value: V; onChange: (v: V) => void; ariaLabel?: string }) {
  return (
    <div className="seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={cx('seg-item', o.value === value && 'is-active')} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined && o.count !== null ? <span className="seg-count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}
