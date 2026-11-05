import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Info } from 'lucide-react';
import { cx } from './cx';

type ToastTone = 'ok' | 'error' | 'info';
interface ToastItem {
  id: number;
  text: string;
  tone: ToastTone;
}

let seq = 0;
const listeners = new Set<(t: ToastItem[]) => void>();
let items: ToastItem[] = [];

function emit() {
  for (const l of listeners) l(items);
}

/** Короткое сообщение внизу справа: toast('Оплата записана'); toast('Не хватает товара', 'error') */
export function toast(text: string, tone: ToastTone = 'ok') {
  const id = ++seq;
  items = [...items, { id, text, tone }].slice(-4);
  emit();
  window.setTimeout(() => {
    items = items.filter((t) => t.id !== id);
    emit();
  }, tone === 'error' ? 6000 : 3500);
}

export function ToastStack() {
  const [list, setList] = useState<ToastItem[]>(items);
  useEffect(() => {
    listeners.add(setList);
    return () => {
      listeners.delete(setList);
    };
  }, []);
  if (!list.length) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={cx('toast', t.tone === 'error' && 'is-error')}>
          {t.tone === 'error' ? <XCircle /> : t.tone === 'info' ? <Info /> : <CheckCircle2 />}
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  );
}
