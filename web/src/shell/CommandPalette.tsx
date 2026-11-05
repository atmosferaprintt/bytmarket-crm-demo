import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Package, Receipt, Truck, Users, CornerDownLeft, ArrowRight } from 'lucide-react';
import { phoneDigits, searchProducts } from '../data/search';
import { SearchInput, cx, fmt } from '../ui';
import { useDB } from '../data/store';
import { useSession } from '../roles/session';
import { useScoped } from '../roles/scope';
import { SECTIONS, sectionLabel } from './nav';
import { useOpenEntity } from './entities';

interface Hit {
  key: string;
  group: 'Разделы' | 'Товары' | 'Клиенты' | 'Поставщики' | 'Документы';
  title: string;
  sub: string;
  run: () => void;
}

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

/** Общий поиск ⌘K: разделы, товары (название по-русски и латиницей, артикул, штрихкод), клиенты (имя, контакт, телефон с 8 или 7),
    поставщики, документы по номеру (заказ, закупка, чек, доставка; «закупка 238»), доставки по клиенту и адресу у диспетчера и курьера. */
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
    const digits = phoneDigits(t);
    const onlyNumber = /^[№#\s\d]+$/.test(q.trim());
    // «закупка 238», «чек 54210», «доставка 1652», «заказ 3587» — номер документа с подсказкой вида
    const kindWord = /^(закупк|заказ|чек|доставк|платеж|платёж|оплат)/.exec(t)?.[1] ?? null;
    const num = (kindWord ? t.replace(/^\S+\s*/, '') : t).replace(/[№#\s]/g, '');
    const isNum = /^\d{2,}$/.test(num) && (onlyNumber || !!kindWord);
    const wants = (k: string) => !kindWord || kindWord.startsWith(k);
    const wholesale = role === 'manager' || role === 'rep';

    if (sees('products') && !kindWord) {
      for (const h of searchProducts(db, q, { limit: 6 }).list) {
        const p = h.p;
        out.push({ key: `p-${p.id}`, group: 'Товары', title: p.name, sub: `${p.sku} · ${wholesale ? `опт ${fmt.price(p.wholesalePrice)}` : fmt.price(p.retailPrice)}`, run: () => open('product', p.id) });
      }
    }
    if (sees('clients') && !kindWord) {
      let n = 0;
      for (const c of scoped.clients) {
        if (n >= 5) break;
        const phones = [c.phone, ...c.contacts.map((x) => x.phone)].map((x) => phoneDigits(x ?? ''));
        const phoneHit = digits.length >= 4 && phones.some((x) => x.includes(digits));
        const contact = c.contacts.find((x) => norm(x.name).includes(t));
        if (phoneHit || norm(c.name).includes(t) || contact) {
          out.push({ key: `c-${c.id}`, group: 'Клиенты', title: c.name, sub: contact ? `${contact.name}, ${contact.role.toLowerCase()} · ${fmt.phone(contact.phone)}` : fmt.phone(c.phone), run: () => open('client', c.id) });
          n++;
        }
      }
    }
    if (sees('purchases') && !kindWord) {
      for (const sp of db.suppliers) {
        if (norm(`${sp.name} ${sp.contact}`).includes(t) || (digits.length >= 4 && phoneDigits(sp.phone).includes(digits)))
          out.push({ key: `sp-${sp.id}`, group: 'Поставщики', title: sp.name, sub: sp.contact, run: () => open('supplier', sp.id) });
      }
    }
    if (isNum) {
      if (sees('sales') && wants('заказ')) {
        let n = 0;
        for (let i = scoped.orders.length - 1; i >= 0 && n < 5; i--) {
          const o = scoped.orders[i];
          if (String(o.number).startsWith(num)) {
            const c = db.clients.find((x) => x.id === o.clientId);
            out.push({ key: `o-${o.id}`, group: 'Документы', title: `Заказ № ${o.number}`, sub: `${c?.name ?? ''} · ${fmt.money(o.total)}`, run: () => open('order', o.id) });
            n++;
          }
        }
      }
      if (sees('purchases') && wants('закупк')) {
        for (const pu of db.purchases) {
          if (String(pu.number) !== num) continue;
          const sp = db.suppliers.find((x) => x.id === pu.supplierId);
          out.push({ key: `pu-${pu.id}`, group: 'Документы', title: `Закупка № ${pu.number}`, sub: `${sp?.name ?? ''} · ${fmt.money(pu.total)}`, run: () => open('purchase', pu.id) });
        }
      }
      if (sees('register') && wants('чек')) {
        const mine = role === 'seller' ? scoped.receipts : db.receipts;
        for (const r of mine) {
          if (String(r.number) !== num) continue;
          out.push({ key: `r-${r.id}`, group: 'Документы', title: `${r.kind === 'sale' ? 'Чек' : 'Возврат'} № ${r.number}`, sub: `${fmt.dateTime(r.at)} · ${fmt.money(r.total)}`, run: () => open('receipt', r.id) });
        }
      }
      if (sees('delivery') && wants('доставк')) {
        for (const d of scoped.deliveries) {
          const o = db.orders.find((x) => x.id === d.orderId);
          if (String(d.number) !== num && String(o?.number ?? '') !== num) continue;
          out.push({ key: `d-${d.id}`, group: 'Документы', title: `Доставка № ${d.number}`, sub: `${d.address} · заказ № ${o?.number ?? ''}`, run: () => open('delivery', d.id) });
        }
      }
    }
    // доставки по клиенту и адресу — для диспетчера и курьера («где мой заказ»)
    if (sees('delivery') && !sees('clients') && !isNum && t.length >= 3) {
      let n = 0;
      for (let i = scoped.deliveries.length - 1; i >= 0 && n < 6; i--) {
        const d = scoped.deliveries[i];
        const c = db.clients.find((x) => x.id === d.clientId);
        if (norm(`${c?.name ?? ''} ${d.address} ${d.contactName}`).includes(t) || (digits.length >= 4 && phoneDigits(d.contactPhone).includes(digits))) {
          out.push({ key: `d-${d.id}`, group: 'Документы', title: `Доставка № ${d.number} · ${c?.name ?? ''}`, sub: `${fmt.date(d.date)}, ${d.interval} · ${d.address}`, run: () => open('delivery', d.id) });
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

  const groups: Hit['group'][] = ['Разделы', 'Документы', 'Товары', 'Клиенты', 'Поставщики'];
  const icon = (g: Hit['group']) => (g === 'Товары' ? <Package /> : g === 'Клиенты' ? <Users /> : g === 'Поставщики' ? <Truck /> : g === 'Документы' ? <Receipt /> : <ArrowRight />);

  return createPortal(
    <div className="overlay palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Поиск по CRM">
        <SearchInput
          autoFocus
          size="lg"
          value={q}
          onChange={setQ}
          placeholder={sees("clients") || sees("products") ? "Товар, клиент, телефон или номер документа" : "Номер доставки, клиент или адрес"}
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
