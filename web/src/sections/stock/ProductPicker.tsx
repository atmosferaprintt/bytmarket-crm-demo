/* Поле сканера и поиска товара для документов: штрихкод со сканера + Enter добавляет сразу
   (штрихкод коробки — коробкой), иначе подсказки по названию, артикулу и бренду. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ScanBarcode } from 'lucide-react';
import type { LocationKey, Pack, Product } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { stockIndex } from '../../data/selectors';
import { Input, cx, fmt } from '../../ui';
import { barcodeIndex, norm, packLabel, productSearchIndex } from './calc';
import './stock.css';

interface Match {
  p: Product;
  pack: Pack;
  byBarcode: boolean;
}

export function ProductPicker({
  onPick,
  location,
  filter,
  placeholder = 'Сканируйте штрихкод или найдите товар',
  autoFocus,
  extra,
}: {
  onPick: (p: Product, pack: Pack) => void;
  location?: LocationKey | null;
  filter?: (p: Product) => boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** дополнительный текст справа в подсказке */
  extra?: (p: Product) => string | null;
}) {
  const db = useDB();
  const version = useDBVersion();
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  const matches = useMemo<Match[]>(() => {
    const s = q.trim();
    if (!s) return [];
    const exact = barcodeIndex(db).get(s);
    if (exact && (!filter || filter(exact.p))) return [{ p: exact.p, pack: exact.pack, byBarcode: true }];
    const tokens = norm(s).split(/\s+/);
    const res: Match[] = [];
    for (const x of productSearchIndex(db)) {
      if (!x.p.active) continue;
      if (filter && !filter(x.p)) continue;
      if (tokens.every((t) => x.text.includes(t))) {
        res.push({ p: x.p, pack: x.p.packs[0], byBarcode: false });
        if (res.length >= 8) break;
      }
    }
    return res;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, db, version, filter]);

  useEffect(() => setHi(0), [q]);

  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setRect({ top: r.bottom + 6, left: r.left, width: Math.max(r.width, 460) });
  };
  useLayoutEffect(() => {
    if (open) place();
  }, [open, q]);
  useEffect(() => {
    if (!open) return;
    const h = () => place();
    window.addEventListener('scroll', h, true);
    window.addEventListener('resize', h);
    return () => {
      window.removeEventListener('scroll', h, true);
      window.removeEventListener('resize', h);
    };
  }, [open]);

  const pick = (m: Match) => {
    onPick(m.p, m.pack);
    setQ('');
    setError(null);
    setOpen(false);
    ref.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, Math.max(0, matches.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHi((h) => Math.max(0, h - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const m = matches[hi] ?? matches[0];
      if (m) pick(m);
      else if (q.trim()) setError(/^\d{8,14}$/.test(q.trim()) ? `Штрихкод ${q.trim()} не найден в каталоге` : `Не нашли «${q.trim()}» — проверьте название или артикул`);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      setOpen(false);
    }
  };

  const si = stockIndex(db);
  const list =
    open && q.trim() && rect
      ? createPortal(
          <div className="stock-picker-pop" style={{ top: rect.top, left: rect.left, width: rect.width }} role="listbox">
            {matches.length === 0 ? (
              <div className="stock-picker-empty">Ничего не нашли. Попробуйте артикул или часть названия</div>
            ) : (
              matches.map((m, i) => {
                const st = si.get(m.p.id);
                const here = location ? st?.[location].available ?? 0 : null;
                const ex = extra?.(m.p);
                return (
                  <button
                    key={m.p.id + m.pack.key}
                    type="button"
                    role="option"
                    aria-selected={i === hi}
                    className={cx('stock-picker-item', i === hi && 'is-active')}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setHi(i)}
                    onClick={() => pick(m)}
                  >
                    <span className="grow" style={{ minWidth: 0 }}>
                      <span className="stock-picker-name">{m.p.name}</span>
                      <span className="stock-picker-sub">
                        {m.p.sku}
                        {m.byBarcode ? ` · штрихкод: ${packLabel(m.pack)}` : ''}
                      </span>
                    </span>
                    <span className="stock-picker-stock num">
                      {ex ?? (here !== null ? `${location === 'shop' ? 'В магазине' : 'На складе'} ${fmt.num(here)}` : `Склад ${fmt.num(st?.warehouse.available ?? 0)} · магазин ${fmt.num(st?.shop.available ?? 0)}`)}
                    </span>
                  </button>
                );
              })
            )}
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="stock-picker">
      <Input
        ref={ref}
        size="lg"
        autoFocus={autoFocus}
        value={q}
        placeholder={placeholder}
        icon={<ScanBarcode />}
        invalid={!!error}
        onChange={(e) => {
          setQ(e.target.value);
          setError(null);
          setOpen(true);
        }}
        onFocus={() => q && setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 120)}
        onKeyDown={onKey}
        aria-label="Сканер или поиск товара"
      />
      {error ? <div className="field-error" style={{ marginTop: 6 }}>{error}</div> : null}
      {list}
    </div>
  );
}
