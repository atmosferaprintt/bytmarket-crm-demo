/* Части окна заказа: поиск товара со сканером, привычные товары клиента, повтор «было → стало», ручная скидка. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, ScanBarcode } from 'lucide-react';
import type { ID, Order, PackKey, PriceType } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes, priceFor, stockIndex, type RepeatPreviewResult } from './data';
import { Button, Checkbox, Chip, Field, Input, Modal, Notice, STOCK_LEVEL, StatusChip, cx, fmt } from '../../ui';
import { linePackLabel, norm, productName, useIsPhone } from './lib';
import { PriceCell, PromoChip } from './parts';
import { searchProducts } from '../../data/search';
import { ProductPhoto } from '../../shell/ProductPhoto';

/* ---------- поиск товара: штрихкод, название, артикул ---------- */

export function ProductSearch({ priceType, onPick, autoFocus }: { priceType: PriceType; onPick: (productId: ID, pack?: PackKey) => void; autoFocus?: boolean }) {
  const db = useDB();
  const version = useDBVersion();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const catalog = useMemo(() => {
    const brands = indexes(db).brands;
    const byBarcode = new Map<string, { productId: ID; pack: PackKey }>();
    const items = db.products
      .filter((p) => p.active)
      .map((p) => {
        for (const pk of p.packs) byBarcode.set(pk.barcode, { productId: p.id, pack: pk.key });
        return { p, brand: brands.get(p.brandId)?.name ?? '', text: norm([p.name, p.sku, brands.get(p.brandId)?.name ?? '', p.variant ?? ''].join(' ')) };
      });
    return { items, byBarcode };
  }, [db, version]);

  const results = useMemo(() => {
    const s = q.trim();
    if (!s) return [];
    const code = catalog.byBarcode.get(s);
    if (code) {
      const it = catalog.items.find((x) => x.p.id === code.productId);
      return it ? [{ ...it, pack: code.pack as PackKey | undefined }] : [];
    }
    // общий поиск товара: точное совпадение названия выше, то, что есть на складе, — чуть выше
    const si = stockIndex(db);
    const byId = new Map(catalog.items.map((x) => [x.p.id, x]));
    return searchProducts(db, s, {
      limit: 8,
      boost: (p) => {
        const avail = si.get(p.id)?.warehouse.available ?? 0;
        const unit = p.packs[p.packs.length - 1]?.qty ?? 1;
        return avail >= unit ? 1.5 : avail > 0 ? 0.5 : 0;
      },
    }).list
      .filter((h) => byId.has(h.p.id))
      .map((h) => ({ ...byId.get(h.p.id)!, pack: undefined as PackKey | undefined }));
  }, [q, catalog, db, version]);

  const pick = (i: number) => {
    const r = results[i];
    if (!r) return;
    onPick(r.p.id, r.pack);
    setQ('');
    setActive(0);
    inputRef.current?.focus();
  };

  const si = stockIndex(db);
  const today = db.meta.today;
  const phone = useIsPhone();
  const shown = open && !!q.trim();
  useEffect(() => {
    if (shown) listRef.current?.scrollIntoView({ block: 'nearest' });
  }, [shown, results.length]);

  return (
    <div className="sales-search">
      <span className="input-wrap has-icon">
        <input
          ref={inputRef}
          className="input"
          value={q}
          autoFocus={autoFocus}
          placeholder="Добавить товар: штрихкод, название или артикул"
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(results.length - 1, a + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(0, a - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              pick(active);
            } else if (e.key === 'Escape' && q) {
              e.stopPropagation();
              setQ('');
            }
          }}
          aria-label="Добавить товар"
        />
        <ScanBarcode />
      </span>
      {open && q.trim() ? (
        <div className="sales-suggest" role="listbox" ref={listRef}>
          {results.length ? (
            results.map((r, i) => {
              const avail = si.get(r.p.id)?.warehouse.available ?? 0;
              const pr = priceFor(db, r.p.id, { priceType, date: today });
              return (
                <button
                  key={r.p.id}
                  type="button"
                  role="option"
                  aria-selected={i === active}
                  className={cx('sales-suggest-row', phone && 'is-phone', i === active && 'is-active')}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(i)}
                >
                  {phone ? (
                    // телефон: название целиком в две строки, наличие и цена — под ним
                    <>
                      <span className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                        <ProductPhoto product={r.p} size={44} />
                        <span className="sales-suggest-name grow">{productName(r.p)}</span>
                      </span>
                      <span className="muted t-12 ellipsis">{[r.p.sku, r.p.packs.slice(1).map((x) => x.name).join(', ')].filter(Boolean).join(' · ')}</span>
                      <span className="sales-suggest-foot">
                        <span className={cx('t-13 num', avail > 0 ? 'ink-2' : 'c-bad w-600')}>{avail > 0 ? `Доступно ${fmt.qty(avail)}` : 'Нет на складе'}</span>
                        {pr.promo ? <PromoChip promo={pr.promo} today={today} /> : null}
                        <span className="spacer" />
                        <span className="w-700">
                          <PriceCell price={pr.price} base={pr.base} />
                        </span>
                      </span>
                    </>
                  ) : (
                  <>
                  <ProductPhoto product={r.p} size={36} />
                  <span className="grow" style={{ minWidth: 0 }}>
                    <span className="w-600 ellipsis" style={{ display: 'block' }}>
                      {productName(r.p)}
                    </span>
                    <span className="muted t-12 ellipsis" style={{ display: 'block' }}>
                      {[r.p.sku, r.brand, r.p.packs.slice(1).map((x) => x.name).join(', ')].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  {pr.promo ? <PromoChip promo={pr.promo} today={today} /> : null}
                  <span className={cx('t-12 num', avail > 0 ? 'muted' : 'c-bad w-600')} style={{ minWidth: 64, textAlign: 'right' }}>
                    {avail > 0 ? fmt.qty(avail) : 'нет'}
                  </span>
                  <span style={{ minWidth: 64, textAlign: 'right' }}>
                    <PriceCell price={pr.price} base={pr.base} />
                  </span>
                  </>
                  )}
                </button>
              );
            })
          ) : (
            <div className="sales-suggest-empty">Ничего не нашли. Проверьте штрихкод или напишите иначе</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- привычные товары клиента ---------- */

interface HistoryItem {
  productId: ID;
  times: number;
  lastAt: string;
  lastNumber: number;
  pack: PackKey;
  packSize: number;
  packQty: number;
  qty: number;
  lastPrice: number;
}

export function HistoryPicker({ clientId, priceType, onClose, onAdd }: { clientId: ID; priceType: PriceType; onClose: () => void; onAdd: (items: { productId: ID; pack: PackKey; packQty: number }[]) => void }) {
  const db = useDB();
  const version = useDBVersion();
  const today = db.meta.today;
  const data = useMemo(() => {
    const orders = db.orders.filter((o) => o.clientId === clientId && o.state !== 'cancelled' && o.state !== 'draft').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const m = new Map<ID, HistoryItem>();
    for (const o of orders) {
      for (const l of o.lines) {
        const x = m.get(l.productId);
        if (x) {
          x.times++;
          continue;
        }
        m.set(l.productId, { productId: l.productId, times: 1, lastAt: o.createdAt, lastNumber: o.number, pack: l.pack, packSize: l.packSize, packQty: l.packQty, qty: l.qty, lastPrice: l.price });
      }
    }
    const items = [...m.values()].sort((a, b) => b.times - a.times || b.lastAt.localeCompare(a.lastAt)).slice(0, 40);
    return { orders: orders.length, items };
  }, [db, version, clientId]);
  const [picked, setPicked] = useState<Set<ID>>(() => new Set());
  const idx = indexes(db);
  const si = stockIndex(db);
  const phone = useIsPhone();

  const toggle = (id: ID) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const submit = () => {
    const out: { productId: ID; pack: PackKey; packQty: number }[] = [];
    for (const it of data.items) {
      if (!picked.has(it.productId)) continue;
      const p = idx.products.get(it.productId);
      if (!p || !p.active) continue;
      const pk = p.packs.find((x) => x.key === it.pack);
      if (pk) out.push({ productId: p.id, pack: pk.key, packQty: it.packQty });
      else out.push({ productId: p.id, pack: 'pcs', packQty: it.qty });
    }
    onAdd(out);
  };

  return (
    <Modal
      wide
      title="Из прошлых заказов"
      sub={data.orders ? `Что клиент брал раньше: ${fmt.count(data.orders, 'заказ', 'заказа', 'заказов')}` : undefined}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={() => setPicked(new Set(data.items.filter((i) => idx.products.get(i.productId)?.active).map((i) => i.productId)))}>
            Выбрать все
          </Button>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} disabled={!picked.size}>
            Добавить {picked.size ? fmt.count(picked.size, 'строку', 'строки', 'строк') : ''}
          </Button>
        </>
      }
    >
      {data.items.length && phone ? (
        // телефон: карточки вместо широкой таблицы
        <div className="sales-hist-cards">
          {data.items.map((it) => {
            const p = idx.products.get(it.productId);
            const off = !p || !p.active;
            const avail = si.get(it.productId)?.warehouse.available ?? 0;
            const pr = priceFor(db, it.productId, { priceType, date: today });
            const on = picked.has(it.productId);
            return (
              <div
                key={it.productId}
                role="checkbox"
                aria-checked={on}
                aria-disabled={off}
                tabIndex={off ? -1 : 0}
                className={cx('sales-hist-card', on && 'is-on', off && 'is-off')}
                onClick={off ? undefined : () => toggle(it.productId)}
                onKeyDown={(e) => {
                  if (!off && (e.key === ' ' || e.key === 'Enter')) {
                    e.preventDefault();
                    toggle(it.productId);
                  }
                }}
              >
                <input type="checkbox" className="sales-hist-check" checked={on} disabled={off} readOnly tabIndex={-1} aria-hidden="true" />
                <span className="sales-hist-main">
                  <span className="sales-suggest-name">{productName(p)}</span>
                  <span className="t-12 muted">
                    {off ? 'Снят с продажи' : `Брали ${fmt.count(it.times, 'раз', 'раза', 'раз')} · в последний раз ${it.pack === 'pcs' ? fmt.qty(it.qty) : `${it.packQty} × ${linePackLabel(it.pack, it.packSize)}`}, ${fmt.date(it.lastAt)}`}
                  </span>
                  {!off ? (
                    <span className="sales-suggest-foot">
                      <span className={cx('t-13 num', avail < it.qty ? 'c-bad w-600' : 'ink-2')}>{avail > 0 ? `Доступно ${fmt.qty(avail)}` : 'Нет на складе'}</span>
                      <span className="spacer" />
                      {pr.price !== it.lastPrice ? (
                        <span className={cx('sales-was-now t-13', pr.price > it.lastPrice ? 'is-up' : 'is-down')}>
                          <span className="was">{fmt.price(it.lastPrice)}</span>
                          <ArrowRight />
                          <span className="now">{fmt.price(pr.price)}</span>
                        </span>
                      ) : (
                        <span className="w-700 t-13">{fmt.price(pr.price)}</span>
                      )}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      ) : data.items.length ? (
        <div className="sales-modal-table">
          <table className="table table-dense">
            <thead>
              <tr>
                <th style={{ width: 36 }} aria-label="Выбрать" />
                <th>Товар</th>
                <th className="num">Брали</th>
                <th>В последний раз</th>
                <th className="num">Доступно</th>
                <th className="num">Цена сейчас</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((it) => {
                const p = idx.products.get(it.productId);
                const off = !p || !p.active;
                const avail = si.get(it.productId)?.warehouse.available ?? 0;
                const pr = priceFor(db, it.productId, { priceType, date: today });
                return (
                  <tr key={it.productId} className={cx(!off && 'is-clickable', off && 'sales-row-off', picked.has(it.productId) && 'is-selected')} onClick={off ? undefined : () => toggle(it.productId)}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <Checkbox checked={picked.has(it.productId)} onChange={() => toggle(it.productId)} disabled={off} />
                    </td>
                    <td>
                      <div className="cell-title">{productName(p)}</div>
                      <div className="cell-sub">{off ? 'Снят с продажи' : p?.sku}</div>
                    </td>
                    <td className="num">{fmt.count(it.times, 'раз', 'раза', 'раз')}</td>
                    <td className="nowrap">
                      {it.pack === 'pcs' ? fmt.qty(it.qty) : `${it.packQty} × ${linePackLabel(it.pack, it.packSize)}`}
                      <span className="muted"> · {fmt.date(it.lastAt)}</span>
                    </td>
                    <td className={cx('num', avail < it.qty ? 'c-bad w-600' : 'muted')}>{fmt.qty(avail)}</td>
                    <td className="num">
                      {pr.price !== it.lastPrice && !off ? (
                        <span className={cx('sales-was-now', pr.price > it.lastPrice ? 'is-up' : 'is-down')}>
                          <span className="was">{fmt.price(it.lastPrice)}</span>
                          <ArrowRight />
                          <span className="now">{fmt.price(pr.price)}</span>
                        </span>
                      ) : (
                        fmt.price(pr.price)
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Notice>Клиент ещё не заказывал — добавьте товары поиском</Notice>
      )}
    </Modal>
  );
}

/* ---------- повтор заказа: было → стало ---------- */

export function RepeatChanges({ preview, source, ack, onAck }: { preview: RepeatPreviewResult; source: Order; ack: boolean; onAck: (v: boolean) => void }) {
  const db = useDB();
  const products = indexes(db).products;
  const changed = preview.lines.filter((l) => l.status !== 'same');
  if (!changed.length)
    return (
      <Notice tone="ok" title={`Повтор заказа № ${source.number} от ${fmt.date(source.createdAt)}`}>
        Цены и наличие не изменились — строки подставлены как в прошлый раз.
      </Notice>
    );
  const qtyText = (pack: PackKey, packSize: number, packQty: number, qty: number) => (pack === 'pcs' ? fmt.qty(qty) : `${packQty} × ${packSize} = ${fmt.qty(qty)}`);
  return (
    <section className="sales-repeat card">
      <div className="sales-repeat-head">
        <div className="grow">
          <div className="t-16 w-700">
            Что изменилось с заказа № {source.number} от {fmt.date(source.createdAt)}
          </div>
        </div>
        <span className="sales-was-now t-14">
          <span className="was">{fmt.money(preview.oldTotal)}</span>
          <ArrowRight />
          <span className="now">{fmt.money(preview.total)}</span>
        </span>
      </div>
      <table className="table table-dense sales-repeat-table">
        <thead>
          <tr>
            <th>Товар</th>
            <th>Количество</th>
            <th className="num">Цена за штуку</th>
            <th>Что изменилось</th>
          </tr>
        </thead>
        <tbody>
          {changed.map((l) => {
            const oldPackQty = l.oldPackSize ? Math.round(l.oldQty / l.oldPackSize) : l.oldQty;
            return (
              <tr key={l.productId} className={cx(l.status === 'unavailable' && 'sales-row-off')}>
                <td>
                  <div className="cell-title sales-line-name" title={l.name}>
                    {products.get(l.productId) ? productName(products.get(l.productId)) : l.name}
                  </div>
                </td>
                <td className="nowrap">
                  {l.qty !== l.oldQty ? (
                    <span className={cx('sales-was-now', 'is-up')}>
                      <span className="was">{qtyText(l.pack, l.oldPackSize, oldPackQty, l.oldQty)}</span>
                      <ArrowRight />
                      <span className="now">{l.qty ? qtyText(l.pack, l.packSize, l.packQty, l.qty) : 'не берём'}</span>
                    </span>
                  ) : (
                    qtyText(l.pack, l.packSize, l.packQty, l.qty)
                  )}
                </td>
                <td className="num">
                  {l.price !== l.oldPrice && l.price > 0 ? (
                    <span className={cx('sales-was-now', l.price > l.oldPrice ? 'is-up' : 'is-down')}>
                      <span className="was">{fmt.price(l.oldPrice)}</span>
                      <ArrowRight />
                      <span className="now">{fmt.price(l.price)}</span>
                    </span>
                  ) : (
                    fmt.price(l.oldPrice)
                  )}
                </td>
                <td>
                  <span className="sales-change-list">
                    {l.status === 'unavailable' ? <StatusChip s={STOCK_LEVEL.out} /> : l.status === 'short' ? <Chip tone="warn">Не хватает</Chip> : null}
                    <span className="t-12 ink-2">{l.changes.filter((c) => c !== 'Нет в наличии').join(' · ')}</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="sales-repeat-foot">
        <Checkbox checked={ack} onChange={onAck}>
          Изменения проверил, согласен с новыми ценами и количеством
        </Checkbox>
      </div>
    </section>
  );
}

/* ---------- ручная скидка на строку ---------- */

const DISCOUNT_REASONS = ['Постоянный клиент', 'Крупный заказ', 'Мятая упаковка', 'Цена конкурента', 'Согласовано с владельцем'];

export function DiscountModal({
  productName: name,
  base,
  promoPrice,
  limit,
  pct: pct0,
  reason: reason0,
  onClose,
  onSave,
}: {
  productName: string;
  base: number;
  promoPrice: number;
  limit: number;
  pct: number;
  reason: string | null;
  onClose: () => void;
  onSave: (pct: number, reason: string) => void;
}) {
  const [pct, setPct] = useState<string>(pct0 ? String(pct0).replace('.', ',') : '');
  const [reason, setReason] = useState(reason0 ?? '');
  const value = Number(pct.replace(',', '.')) || 0;
  const price = Math.round((promoPrice * (100 - value)) / 100);
  const combined = base > 0 ? ((base - price) / base) * 100 : 0;
  const tooMuch = value > limit || combined > limit + 0.05;
  const needReason = value > 0 && !reason.trim();
  return (
    <Modal
      title="Скидка на строку"
      sub={name}
      onClose={onClose}
      footer={
        <>
          {pct0 > 0 ? (
            <Button variant="ghost" onClick={() => onSave(0, '')}>
              Убрать скидку
            </Button>
          ) : null}
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" disabled={tooMuch || needReason || value < 0} onClick={() => onSave(Math.round(value * 10) / 10, reason.trim())}>
            Применить
          </Button>
        </>
      }
    >
      <div className="grid-2">
        <Field label={limit >= 100 ? 'Скидка, %' : `Скидка, %, не больше ${fmt.pct(limit)}`} error={tooMuch ? `Больше вашего лимита ${fmt.pct(limit)}${promoPrice < base ? ' вместе с акцией' : ''}` : undefined}>
          <Input autoFocus className="sales-input-plain" inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value.replace(/[^\d.,]/g, ''))} suffix="%" invalid={tooMuch} />
        </Field>
        <Field label="Цена за штуку">
          <div className="sales-static">
            <PriceCell price={value > 0 ? price : promoPrice} base={base} />
          </div>
        </Field>
      </div>
      <Field label="Основание скидки" error={needReason ? 'Укажите основание — оно сохранится в заказе' : undefined}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Почему даём скидку" />
      </Field>
      <div className="chips">
        {DISCOUNT_REASONS.map((r) => (
          <button key={r} type="button" className={cx('chip', 'sales-chip-btn', reason === r && 'chip-info')} onClick={() => setReason(r)}>
            {r}
          </button>
        ))}
      </div>
    </Modal>
  );
}
