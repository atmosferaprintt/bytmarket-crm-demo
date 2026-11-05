import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Package, Receipt, Users, CornerDownLeft, ArrowRight } from 'lucide-react';
import { SearchInput, cx, fmt } from '../ui';
import { useDB } from '../data/store';
import { useSession } from '../roles/session';
import { useScoped } from '../roles/scope';
import { SECTIONS, sectionLabel } from './nav';
import { useOpenEntity } from './entities';

interface Hit {
  key: string;
  group: 'Разделы' | 'Товары' | 'Клиенты' | 'Заказы';
  title: string;
  sub: string;
  run: () => void;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** Общий поиск ⌘K: разделы, товары (название, артикул, штрихкод), клиенты (имя, телефон), заказы (номер). */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const db = useDB();
  const { role, sees } = useSession();
  const scoped = useScoped();
  const navigate = useNavigate();
  const open = useOpenEntity();
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const hits = useMemo<Hit[]>(() => {
    const t = norm(q.trim());
    const out: Hit[] = [];
    const sections = SECTIONS.filter((s) => sees(s.key));
    for (const s of sections) {
      const label = sectionLabel(s.key, role);
      if (!t || norm(label).includes(t))
        out.push({ key: `s-${s.key}`, group: 'Разделы', title: label, sub: s.tabs.map((x) => x.label).slice(0, 4).join(' · '), run: () => navigate(s.path) });
    }
    if (!t) return out.slice(0, 8);
    const digits = t.replace(/\D/g, '');
    if (sees('products')) {
      let n = 0;
      for (const p of db.products) {
        if (n >= 6) break;
        const hay = norm(p.name + ' ' + p.sku);
        const barcode = digits.length >= 4 && p.packs.some((pk) => pk.barcode.includes(digits));
        if (barcode || t.split(/\s+/).every((tok) => hay.includes(tok))) {
          out.push({ key: `p-${p.id}`, group: 'Товары', title: p.name, sub: `${p.sku} · ${fmt.price(p.retailPrice)}`, run: () => open('product', p.id) });
          n++;
        }
      }
    }
    if (sees('clients')) {
      let n = 0;
      for (const c of scoped.clients) {
        if (n >= 5) break;
        const phoneHit = digits.length >= 4 && c.phone.replace(/\D/g, '').includes(digits);
        if (phoneHit || norm(c.name).includes(t)) {
          out.push({ key: `c-${c.id}`, group: 'Клиенты', title: c.name, sub: fmt.phone(c.phone), run: () => open('client', c.id) });
          n++;
        }
      }
    }
    // заказы ищем по номеру, только если запрос — номер: «3587», «№ 3587» (а не «persil 1,3»)
    if (sees('sales') && digits.length >= 2 && /^[№#\s\d]+$/.test(q.trim())) {
      let n = 0;
      for (let i = scoped.orders.length - 1; i >= 0 && n < 5; i--) {
        const o = scoped.orders[i];
        if (String(o.number).includes(digits)) {
          const c = db.clients.find((x) => x.id === o.clientId);
          out.push({ key: `o-${o.id}`, group: 'Заказы', title: `Заказ № ${o.number}`, sub: `${c?.name ?? ''} · ${fmt.money(o.total)}`, run: () => open('order', o.id) });
          n++;
        }
      }
    }
    return out;
  }, [q, db, scoped, role, sees, navigate, open]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const run = (h: Hit | undefined) => {
    if (!h) return;
    onClose();
    h.run();
  };

  const groups: Hit['group'][] = ['Разделы', 'Товары', 'Клиенты', 'Заказы'];
  const icon = (g: Hit['group']) => (g === 'Товары' ? <Package /> : g === 'Клиенты' ? <Users /> : g === 'Заказы' ? <Receipt /> : <ArrowRight />);

  return createPortal(
    <div className="overlay palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Поиск по CRM">
        <SearchInput
          autoFocus
          size="lg"
          value={q}
          onChange={setQ}
          placeholder="Товар, штрихкод, клиент, телефон или номер заказа"
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(hits.length - 1, a + 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)); }
            if (e.key === 'Enter') run(hits[active]);
          }}
        />
        <div className="palette-list" ref={listRef}>
          {hits.length === 0 ? <div className="empty"><div className="empty-title">Ничего не нашли</div>Попробуйте артикул, штрихкод или часть названия</div> : null}
          {groups.map((g) => {
            const items = hits.filter((h) => h.group === g);
            if (!items.length) return null;
            return (
              <div key={g}>
                <div className="palette-group">{g}</div>
                {items.map((h) => {
                  const idx = hits.indexOf(h);
                  return (
                    <button key={h.key} type="button" className={cx('palette-item', idx === active && 'is-active')} onMouseEnter={() => setActive(idx)} onClick={() => run(h)}>
                      <span className="icon-tile">{icon(g)}</span>
                      <span className="grow" style={{ minWidth: 0 }}>
                        <span className="ellipsis w-600" style={{ display: 'block' }}>{h.title}</span>
                        <span className="ellipsis t-12 muted" style={{ display: 'block' }}>{h.sub}</span>
                      </span>
                      {idx === active ? <CornerDownLeft size={16} color="var(--faint)" /> : null}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
