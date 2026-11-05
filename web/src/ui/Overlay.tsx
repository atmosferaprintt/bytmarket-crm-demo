import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from './cx';

let layerSeq = 0;
function useLayerId() {
  const id = useRef<string>('');
  if (!id.current) id.current = `layer-${++layerSeq}`;
  return id.current;
}

function useTopEscape(onClose: () => void, layerId: string) {
  const ref = useRef(onClose);
  ref.current = onClose;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const layers = document.querySelectorAll('[data-layer-id]');
      const top = layers[layers.length - 1];
      if (top && top.getAttribute('data-layer-id') !== layerId) return;
      ref.current();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [layerId]);
}

function useBodyLock() {
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
}

/** Окно по центру. Закрывается по Esc, крестику и клику по фону. */
export function Modal({
  title,
  sub,
  children,
  footer,
  onClose,
  wide,
  icon,
}: {
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  icon?: ReactNode;
}) {
  const layerId = useLayerId();
  useTopEscape(onClose, layerId);
  useBodyLock();
  return createPortal(
    <div className="overlay" data-layer-id={layerId} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={cx('modal', wide && 'is-wide')} role="dialog" aria-modal="true">
        <div className="modal-head">
          {icon}
          <div className="grow">
            <h2 className="modal-title">{title}</h2>
            {sub ? <div className="muted t-13" style={{ marginTop: 4 }}>{sub}</div> : null}
          </div>
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Закрыть" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

/** Боковая панель справа: карточки заказа, клиента, товара. */
export function Drawer({
  title,
  sub,
  head,
  children,
  footer,
  onClose,
  wide,
  actions,
}: {
  title: ReactNode;
  sub?: ReactNode;
  head?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  wide?: boolean;
  actions?: ReactNode;
}) {
  const layerId = useLayerId();
  useTopEscape(onClose, layerId);
  useBodyLock();
  return createPortal(
    <div className="drawer-layer" data-layer-id={layerId}>
      <div className="drawer-backdrop" onMouseDown={onClose} />
      <aside className={cx('drawer', wide && 'is-wide')} role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div className="grow" style={{ minWidth: 0 }}>
            <h2 className="drawer-title">{title}</h2>
            {sub ? <div className="muted t-13" style={{ marginTop: 4 }}>{sub}</div> : null}
            {head ? <div style={{ marginTop: 12 }}>{head}</div> : null}
          </div>
          {actions ? <div className="row">{actions}</div> : null}
          <button type="button" className="btn btn-ghost btn-icon btn-sm" aria-label="Закрыть" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="drawer-body">{children}</div>
        {footer ? <div className="drawer-foot">{footer}</div> : null}
      </aside>
    </div>,
    document.body,
  );
}
