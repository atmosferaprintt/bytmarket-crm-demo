import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from '../../ui';

/** Окно для телефона курьера: снизу на весь экран, крупные кнопки. На широком экране — окно по центру.
    Своя деталь раздела: у общего Modal нет режима «на весь экран». */
export function Sheet({
  title,
  sub,
  children,
  footer,
  onClose,
}: {
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef(onClose);
  ref.current = onClose;
  const layer = useRef(`dl-sheet-${Math.random().toString(36).slice(2)}`);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const layers = document.querySelectorAll('[data-layer-id]');
      const top = layers[layers.length - 1];
      if (top && top.getAttribute('data-layer-id') !== layer.current) return;
      ref.current();
    };
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = prev;
    };
  }, []);
  return createPortal(
    <div className="dl-sheet-overlay" data-layer-id={layer.current} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('dl-sheet')} role="dialog" aria-modal="true">
        <div className="dl-sheet-head">
          <div className="grow">
            <h2 className="dl-sheet-title">{title}</h2>
            {sub ? <div className="dl-sheet-sub">{sub}</div> : null}
          </div>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Закрыть" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="dl-sheet-body">{children}</div>
        {footer ? <div className="dl-sheet-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
