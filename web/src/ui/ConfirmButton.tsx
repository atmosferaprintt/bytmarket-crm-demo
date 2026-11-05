import { useEffect, useState, type ReactNode } from 'react';
import { Button, type ButtonProps } from './Button';

/** Кнопка с подтверждением прямо в ней: «Отменить заказ» → «Точно? Да / Нет». Без отдельного окна. */
export function ConfirmButton({ children, onConfirm, confirmText = 'Точно?', yes = 'Да', no = 'Нет', ...rest }: Omit<ButtonProps, 'onClick'> & { onConfirm: () => void; confirmText?: ReactNode; yes?: string; no?: string }) {
  const [asking, setAsking] = useState(false);
  useEffect(() => {
    if (!asking) return;
    const t = window.setTimeout(() => setAsking(false), 5000);
    return () => window.clearTimeout(t);
  }, [asking]);
  if (!asking)
    return (
      <Button {...rest} onClick={() => setAsking(true)}>
        {children}
      </Button>
    );
  return (
    <span className="row" style={{ gap: 6 }}>
      <span className="t-13 w-600">{confirmText}</span>
      <Button size={rest.size} variant="danger" onClick={() => { setAsking(false); onConfirm(); }}>
        {yes}
      </Button>
      <Button size={rest.size} variant="ghost" onClick={() => setAsking(false)}>
        {no}
      </Button>
    </span>
  );
}
