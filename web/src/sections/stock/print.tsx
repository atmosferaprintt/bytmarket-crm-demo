/* Печать листов: содержимое рисуется в скрытый блок и печатается через window.print. */
import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './stock.css';

export function usePrint() {
  const [node, setNode] = useState<ReactNode>(null);
  useEffect(() => {
    if (!node) return;
    document.body.classList.add('stock-printing');
    const t = window.setTimeout(() => {
      window.print();
      document.body.classList.remove('stock-printing');
      setNode(null);
    }, 60);
    return () => {
      window.clearTimeout(t);
      document.body.classList.remove('stock-printing');
    };
  }, [node]);
  const element = node ? createPortal(<div className="stock-print">{node}</div>, document.body) : null;
  return { print: (n: ReactNode) => setNode(n), element };
}
