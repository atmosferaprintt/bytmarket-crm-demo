import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { cx } from './cx';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  hidden?: boolean;
  separator?: boolean;
}

/** Всплывающее меню «⋯» со второстепенными действиями. */
export function MoreMenu({ items, label = 'Ещё действия', trigger, icon, size = 'md', align = 'end' }: { items: MenuItem[]; label?: string; trigger?: ReactNode; /** своя иконка вместо «⋯» */ icon?: ReactNode; size?: 'sm' | 'md'; align?: 'start' | 'end' }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const visible = items.filter((i) => !i.hidden);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    const w = menu.current?.offsetWidth ?? 220;
    const h = menu.current?.offsetHeight ?? 200;
    let left = align === 'end' ? r.right - w : r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    setPos({ top, left });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (menu.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onScroll = () => setOpen(false);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  if (!visible.length) return null;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={cx('btn', trigger ? 'btn-secondary' : 'btn-ghost', !trigger && 'btn-icon', size === 'sm' && 'btn-sm')}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        {trigger ?? icon ?? <MoreHorizontal />}
      </button>
      {open
        ? createPortal(
            <div ref={menu} className="menu" role="menu" style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }} onClick={(e) => e.stopPropagation()}>
              {visible.map((it, i) =>
                it.separator ? (
                  <div key={`sep-${i}`} className="menu-sep" />
                ) : (
                  <button
                    key={it.label}
                    type="button"
                    role="menuitem"
                    className={cx('menu-item', it.danger && 'is-danger')}
                    disabled={it.disabled}
                    style={it.disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                    onClick={() => {
                      setOpen(false);
                      it.onClick?.();
                    }}
                  >
                    {it.icon}
                    {it.label}
                  </button>
                ),
              )}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
