import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronsUpDown, ListChecks, PanelLeftClose, PanelLeftOpen, Search, MoreHorizontal } from 'lucide-react';
import { Avatar, ToastStack, cx, fmt } from '../ui';
import { useDB, useDBVersion } from '../data/store';
import { useSession } from '../roles/session';
import { useScoped } from '../roles/scope';
import type { SectionKey } from '../roles/roles';
import { SECTIONS, sectionLabel } from './nav';
import { RoleSwitcher } from './RoleSwitcher';
import { CommandPalette } from './CommandPalette';
import { TasksPanel } from './TasksPanel';
import { EntityHost } from './entities';

function useIsPhone() {
  const q = '(max-width: 760px)';
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const h = () => setPhone(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return phone;
}

/** Счётчики у пунктов меню: то, что требует действия этой роли. */
function useNavBadges(): Partial<Record<SectionKey, { n: number; alert?: boolean }>> {
  const db = useDB();
  const version = useDBVersion();
  const { role, me } = useSession();
  const scoped = useScoped();
  return useMemo(() => {
    const today = db.meta.today;
    const res: Partial<Record<SectionKey, { n: number; alert?: boolean }>> = {};
    const requests = scoped.orders.filter((o) => o.state === 'request').length;
    if (requests && ['owner', 'manager', 'rep'].includes(role)) res.sales = { n: requests };
    if (['owner', 'warehouse'].includes(role)) {
      const totals = new Map<string, number>();
      for (const s of db.stock) totals.set(s.productId, (totals.get(s.productId) ?? 0) + s.onHand - s.reserved);
      let low = 0;
      for (const p of db.products) if (p.active && (totals.get(p.id) ?? 0) < p.minStock) low++;
      if (low) res.stock = { n: low };
    }
    if (['owner', 'dispatcher'].includes(role)) {
      const waiting = db.deliveries.filter((d) => d.date <= today && (d.state === 'waiting' || d.state === 'failed')).length;
      if (waiting) res.delivery = { n: waiting, alert: true };
    }
    if (role === 'courier') {
      const mine = scoped.deliveries.filter((d) => d.date === today && (d.state === 'assigned' || d.state === 'on_way')).length;
      if (mine) res.delivery = { n: mine };
    }
    if (['owner', 'accountant'].includes(role)) {
      const pend = db.payments.filter((p) => p.status !== 'posted').length;
      if (pend) res.money = { n: pend };
    }
    if (role === 'rep') {
      const left = scoped.visits.filter((v) => v.date === today && v.state === 'planned').length;
      if (left) res.overview = { n: left };
    }
    return res;
  }, [db, version, role, me.id, scoped]);
}

export function Layout({ children }: { children: ReactNode }) {
  const db = useDB();
  const { me, role, meta, sees } = useSession();
  const scoped = useScoped();
  const phone = useIsPhone();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('bm-nav-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [roleOpen, setRoleOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const badges = useNavBadges();

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  useEffect(() => setMoreOpen(false), [location.pathname]);

  const sections = SECTIONS.filter((s) => sees(s.key));
  const groups = [...new Set(sections.map((s) => s.group))];
  const openTasks = scoped.myTasks.filter((t) => t.state === 'open' && t.due <= db.meta.today).length;
  const wd = fmt.weekday(db.meta.today);
  const todayLabel = `${wd[0].toUpperCase()}${wd.slice(1)}, ${fmt.date(db.meta.today)}`;

  const toggleCollapsed = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('bm-nav-collapsed', c ? '0' : '1');
      } catch {
        /* не запомним */
      }
      return !c;
    });
  };

  const phoneSections = sections.slice(0, sections.length > 5 ? 4 : 5);
  const restSections = sections.length > 5 ? sections.slice(4) : [];

  return (
    <div className={cx('app', collapsed && 'is-collapsed', meta.mobile && 'is-mobile-role')}>
      <aside className="sidebar">
        <div className="sidebar-inner">
          <NavLink to="/overview" className="sidebar-logo" aria-label="БытМаркет — на главную">
            <img className="logo-full" src="/brand/bytmarket-light.png" alt="БытМаркет" />
            <img className="logo-mark" src="/brand/bytmarket-mark-light.png" alt="" />
          </NavLink>
          <nav className="nav" aria-label="Разделы">
            {groups.map((g) => (
              <div key={g} className="col" style={{ gap: 2 }}>
                {groups.length > 1 ? <div className="nav-group-label">{g}</div> : null}
                {sections
                  .filter((s) => s.group === g)
                  .map((s) => {
                    const Icon = s.icon;
                    const b = badges[s.key];
                    return (
                      <NavLink key={s.key} to={s.path} className={({ isActive }) => cx('nav-item', isActive && 'is-active')} title={collapsed ? sectionLabel(s.key, role) : undefined}>
                        <Icon />
                        <span className="nav-label">{sectionLabel(s.key, role)}</span>
                        {b ? <span className={cx('nav-badge', b.alert && 'is-alert')}>{b.n}</span> : null}
                      </NavLink>
                    );
                  })}
              </div>
            ))}
          </nav>
          <div className="sidebar-foot">
            <button type="button" className="role-button" onClick={() => setRoleOpen(true)} title="Посмотреть глазами другого сотрудника">
              <Avatar name={me.name} />
              <span className="role-meta">
                <span className="role-name" style={{ display: 'block' }}>{me.name}</span>
                <span className="role-sub">{meta.name}</span>
              </span>
              <ChevronsUpDown size={16} color="var(--nav-muted)" />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          {phone ? (
            <>
              <img src="/brand/bytmarket-color.png" alt="БытМаркет" className="topbar-logo" />
              <span className="spacer" />
            </>
          ) : (
            <>
              <button type="button" className="btn btn-ghost btn-icon" onClick={toggleCollapsed} aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'} title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}>
                {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </button>
              <button type="button" className="search-trigger" onClick={() => setSearchOpen(true)}>
                <Search />
                <span>Найти товар, клиента или заказ</span>
                <span className="kbd">⌘K</span>
              </button>
              <span className="topbar-date">{todayLabel}</span>
              <span className="spacer" />
            </>
          )}
          <span className="demo-chip" title="Данные выдуманы, внешние сервисы не подключены">Демо</span>
          <button type="button" className="btn btn-ghost btn-icon topbar-tasks" onClick={() => setTasksOpen(true)} aria-label="Мои задачи" title="Мои задачи">
            <ListChecks />
            {openTasks ? <span className="tasks-count">{openTasks}</span> : null}
          </button>
          {phone ? (
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => setRoleOpen(true)} aria-label="Сменить сотрудника">
              <Avatar name={me.name} size="sm" />
            </button>
          ) : null}
        </header>
        <main className="content">{children}</main>
      </div>

      {phone ? (
        <nav className="mobile-bar" aria-label="Разделы">
          {phoneSections.map((s) => {
            const Icon = s.icon;
            const b = badges[s.key];
            return (
              <NavLink key={s.key} to={s.path} className={({ isActive }) => cx(isActive && 'is-active')}>
                <span className="mobile-icon">
                  <Icon />
                  {b ? <span className="mobile-badge">{b.n}</span> : null}
                </span>
                {sectionLabel(s.key, role)}
              </NavLink>
            );
          })}
          {restSections.length ? (
            <button type="button" className={cx(moreOpen && 'is-active')} onClick={() => setMoreOpen((v) => !v)}>
              <MoreHorizontal />
              Ещё
            </button>
          ) : null}
        </nav>
      ) : null}
      {phone && moreOpen ? (
        <div className="mobile-more" onClick={() => setMoreOpen(false)}>
          <div className="mobile-more-sheet card" onClick={(e) => e.stopPropagation()}>
            {restSections.map((s) => {
              const Icon = s.icon;
              return (
                <NavLink key={s.key} to={s.path} className="list-row">
                  <span className="icon-tile"><Icon /></span>
                  <span className="w-600">{sectionLabel(s.key, role)}</span>
                </NavLink>
              );
            })}
          </div>
        </div>
      ) : null}

      <EntityHost />
      <ToastStack />
      {roleOpen ? <RoleSwitcher onClose={() => setRoleOpen(false)} /> : null}
      {searchOpen ? <CommandPalette onClose={() => setSearchOpen(false)} /> : null}
      {tasksOpen ? <TasksPanel onClose={() => setTasksOpen(false)} /> : null}
    </div>
  );
}
