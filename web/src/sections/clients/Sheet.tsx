import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

let seq = 0;

/** Лист снизу: на телефоне — на весь экран, на компьютере — окно по центру.
    Своя деталь раздела (в общем наборе такой нет). Закрывается по Esc, крестику и фону. */
export function Sheet({ title, sub, children, footer, onClose }: { title: ReactNode; sub?: ReactNode; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  const id = useRef('');
  if (!id.current) id.current = `cl-sheet-${++seq}`;
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const layers = document.querySelectorAll('[data-layer-id]');
      const top = layers[layers.length - 1];
      if (top && top.getAttribute('data-layer-id') !== id.current) return;
      close.current();
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
    <div className="cl-sheet-layer" data-layer-id={id.current}>
      <div className="cl-sheet-backdrop" onMouseDown={onClose} />
      <div className="cl-sheet" role="dialog" aria-modal="true">
        <div className="cl-sheet-head">
          <div className="grow">
            <h2 className="cl-sheet-title">{title}</h2>
            {sub ? <div className="muted t-13 cl-sheet-sub">{sub}</div> : null}
          </div>
          <button type="button" className="btn btn-ghost btn-icon" aria-label="Закрыть" onClick={onClose}>
            <X />
          </button>
        </div>
        <div className="cl-sheet-body">{children}</div>
        {footer ? <div className="cl-sheet-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
