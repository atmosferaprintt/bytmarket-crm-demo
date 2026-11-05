/* Касса → Продажа: поиск или скан слева, чек справа, оплата по F9. Утверждённый макет cash-A. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  CircleCheck,
  Percent,
  Plus,
  Printer,
  ReceiptText,
  ScanBarcode,
  Undo2,
  UserRound,
  Wallet,
  X,
  Lock,
} from 'lucide-react';
import type { ID, PackKey } from '../../data/types';
import { dispatch, getDB, useDB, useDBVersion } from '../../data/store';
import { indexes, priceFor, shiftSummary, stockOf } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { Button, Card, Chip, EmptyState, Input, MoreMenu, Notice, QtyInput, Segmented, Select, cx, fmt, toast } from '../../ui';
import {
  DISCOUNT_REASONS,
  EMPTY_CART,
  PACK_SHORT,
  PAY_KIND_NAMES,
  buildCatalog,
  cardNumber,
  cartName,
  categoryIcon,
  clientByCard,
  nbUnits,
  newKey,
  norm,
  openShift,
  payKind,
  popularItems,
  priceCart,
  promoPct,
  receiptContents,
  receiptsOfShift,
  searchCatalog,
  type CartLine,
  type CartState,
  type CatalogItem,
  type PricedLine,
} from './lib';
import { PayModal, type PayResult } from './PayModal';
import { ClientPicker } from './ClientPicker';
import { ReturnLookup, useOpenRefund } from './ReturnLookup';
import { OpenShiftCard, ShiftBadge } from './ShiftParts';
import { usePrintReceipt } from './Print';

/* ---------- черновик чека сохраняется сам ---------- */

function loadCart(key: string): CartState {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const c = JSON.parse(raw) as CartState;
      if (Array.isArray(c.lines)) return { ...EMPTY_CART, ...c };
    }
  } catch {
    /* черновика нет */
  }
  return EMPTY_CART;
}

function saveCart(key: string, c: CartState) {
  try {
    if (!c.lines.length && !c.clientId && !c.discountPct) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(c));
  } catch {
    /* не сохраним — не страшно */
  }
}

/* ---------- подсветка найденного ---------- */

function highlight(text: string, query: string): ReactNode {
  const tokens = norm(query.trim()).split(/\s+/).filter((t) => t.length > 0);
  if (!tokens.length) return text;
  const n = norm(text);
  const marks = new Array<boolean>(text.length).fill(false);
  for (const t of tokens) {
    let i = n.indexOf(t);
    while (i >= 0) {
      for (let k = i; k < i + t.length; k++) marks[k] = true;
      i = n.indexOf(t, i + t.length);
    }
  }
  const out: ReactNode[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i++) {
    if (i === text.length || marks[i] !== marks[start]) {
      const seg = text.slice(start, i);
      out.push(marks[start] ? <mark key={start}>{seg}</mark> : seg);
      start = i;
    }
  }
  return out;
}

interface Done {
  id: ID;
  number: number;
  total: number;
  change: number;
  cash: number;
  card: number;
}

export default function SalePage() {
  const db = useDB();
  const version = useDBVersion();
  const { me, can, discountLimit, role } = useSession();
  const scoped = useScoped();
  const navigate = useNavigate();
  const openEntity = useOpenEntity();
  const openRefund = useOpenRefund();
  const [print, printNode] = usePrintReceipt();
  const cartKey = `bm-register-cart:${me.id}`;

  const shift = useMemo(() => openShift(db), [db, version]);
  const catalog = useMemo(() => buildCatalog(db), [db, version]);
  const priceType = 'retail' as const;

  const [cart, setCartState] = useState<CartState>(() => loadCart(cartKey));
  const cartRef = useRef(cart);
  /** Изменить чек: считаем от последнего состояния, сразу сохраняем черновик. */
  const setCart = useCallback(
    (fn: (c: CartState) => CartState) => {
      const next = fn(cartRef.current);
      cartRef.current = next;
      saveCart(cartKey, next);
      setCartState(next);
    },
    [cartKey],
  );

  const [query, setQuery] = useState('');
  const [hl, setHl] = useState(0);
  const [mult, setMult] = useState(1);
  const [scanError, setScanError] = useState<string | null>(null);
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [done, setDone] = useState<Done | null>(null);
  const [pay, setPay] = useState<{ key: string } | null>(null);
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [picker, setPicker] = useState(false);
  const [lookup, setLookup] = useState(false);
  const busyRef = useRef(false);
  // второй щелчок двойного нажатия «Провести оплату» не должен попасть в список товаров под окном
  const paidAtRef = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);

  const focusSearch = useCallback(() => {
    window.setTimeout(() => searchRef.current?.focus(), 0);
  }, []);

  /* ---------- поиск ---------- */
  const found = useMemo(() => searchCatalog(catalog, query, 8), [catalog, query]);
  const popular = useMemo(() => popularItems(catalog, db, 6), [catalog, db, version]);
  const list = query.trim() ? found.list : popular;
  // пока поле пустое, ходовые товары выбираются только стрелками: случайный Enter ничего не добавит
  const [arrowed, setArrowed] = useState(false);
  const activeHl = query.trim() || arrowed ? hl : -1;
  useEffect(() => {
    setHl(0);
    setArrowed(false);
  }, [query]);

  /* ---------- чек ---------- */
  const client = cart.clientId ? indexes(db).clients.get(cart.clientId) : undefined;
  const isOwner = role === 'owner';
  const pctOver = cart.discountPct > discountLimit;
  const priced = useMemo(
    () => priceCart(db, pctOver ? { ...cart, discountPct: 0 } : cart, client?.priceType ?? priceType, isOwner),
    [db, version, cart, pctOver, client, isOwner],
  );
  const reasonMissing = cart.discountPct > 0 && !cart.discountReason;
  const canPay = !!shift && priced.lines.length > 0 && !pctOver && !reasonMissing;
  const nextNumber = (db.counters['receipt'] ?? db.receipts.length) + 1;

  const inCart = (productId: ID, exceptKey?: string) =>
    cartRef.current.lines.reduce((s, l) => {
      if (l.productId !== productId || l.key === exceptKey) return s;
      const p = indexes(db).products.get(l.productId);
      const pk = p?.packs.find((x) => x.key === l.pack);
      return s + l.packQty * (pk?.qty ?? 1);
    }, 0);

  const add = (productId: ID, pack: PackKey, n = mult) => {
    const it = catalog.byId.get(productId);
    if (!it) {
      setScanError('Товар не найден или снят с продажи');
      return;
    }
    if (!shift) {
      setScanError('Сначала откройте смену — справа');
      return;
    }
    const pk = it.p.packs.find((x) => x.key === pack) ?? it.p.packs[0];
    const st = stockOf(db, productId);
    const have = inCart(productId);
    const need = have + n * pk.qty;
    if (need > st.shop.available) {
      if (st.shop.available <= 0) {
        setScanError(
          st.warehouse.available > 0
            ? `${it.p.name}: в магазине нет. На складе ${fmt.qty(st.warehouse.available)} — попросите склад перенести.`
            : `${it.p.name}: нет в наличии ни в магазине, ни на складе.`,
        );
      } else {
        setScanError(
          `${it.p.name}: в магазине ${fmt.qty(st.shop.available)}${have ? `, в чеке уже ${fmt.qty(have)}` : ''}. Больше продать нельзя.`,
        );
      }
      return;
    }
    let key = '';
    setCart((c) => {
      const ex = c.lines.find((l) => l.productId === productId && l.pack === pk.key);
      if (ex) {
        key = ex.key;
        return { ...c, lines: c.lines.map((l) => (l === ex ? { ...l, packQty: l.packQty + n } : l)) };
      }
      key = newKey();
      return { ...c, lines: [...c.lines, { key, productId, pack: pk.key, packQty: n }] };
    });
    window.setTimeout(() => {
      setLastKey(key);
      const el = linesRef.current?.querySelector(`[data-line-key="${key}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }, 0);
    setQuery('');
    setMult(1);
    setScanError(null);
    setDone(null);
    return key;
  };

  const setLineQty = (l: CartLine, v: number) => {
    const p = indexes(db).products.get(l.productId);
    if (!p) return;
    const pk = p.packs.find((x) => x.key === l.pack) ?? p.packs[0];
    const avail = stockOf(db, l.productId).shop.available;
    const other = inCart(l.productId, l.key);
    const maxPacks = Math.floor((avail - other) / pk.qty);
    let qty = Math.max(1, v);
    let err: string | null = null;
    if (qty > maxPacks) {
      qty = Math.max(1, maxPacks);
      err = `В магазине ${fmt.qty(avail)} — больше не продать`;
    }
    setLineErrors((e) => {
      const n = { ...e };
      if (err) n[l.key] = err;
      else delete n[l.key];
      return n;
    });
    setCart((c) => ({ ...c, lines: c.lines.map((x) => (x.key === l.key ? { ...x, packQty: qty } : x)) }));
  };

  const setLinePack = (l: CartLine, pack: PackKey) => {
    const p = indexes(db).products.get(l.productId);
    if (!p || pack === l.pack) return;
    const pk = p.packs.find((x) => x.key === pack);
    if (!pk) return;
    const avail = stockOf(db, l.productId).shop.available;
    const other = inCart(l.productId, l.key);
    const maxPacks = Math.floor((avail - other) / pk.qty);
    if (maxPacks < 1) {
      setLineErrors((e) => ({ ...e, [l.key]: `${pack === 'box' ? 'Коробка' : 'Упаковка'} — это ${fmt.qty(pk.qty)}, а в магазине ${fmt.qty(avail - other)}` }));
      return;
    }
    const qty = Math.min(l.packQty, maxPacks);
    setLineErrors((e) => {
      const n = { ...e };
      if (qty < l.packQty) n[l.key] = `В магазине ${fmt.qty(avail)} — больше не продать`;
      else delete n[l.key];
      return n;
    });
    setCart((c) => {
      const twin = c.lines.find((x) => x.key !== l.key && x.productId === l.productId && x.pack === pack);
      if (twin) return { ...c, lines: c.lines.filter((x) => x.key !== l.key).map((x) => (x === twin ? { ...x, packQty: x.packQty + qty } : x)) };
      return { ...c, lines: c.lines.map((x) => (x.key === l.key ? { ...x, pack, packQty: qty } : x)) };
    });
    focusSearch();
  };

  const removeLine = (key: string) => {
    setCart((c) => ({ ...c, lines: c.lines.filter((l) => l.key !== key) }));
    setLineErrors((e) => {
      const n = { ...e };
      delete n[key];
      return n;
    });
    focusSearch();
  };

  const clearCart = () => {
    setCart(() => EMPTY_CART);
    setLineErrors({});
    setScanError(null);
    focusSearch();
  };

  const focusLineQty = (key: string) => {
    window.setTimeout(() => {
      const el = linesRef.current?.querySelector<HTMLInputElement>(`[data-line-key="${key}"] .qty input`);
      el?.focus();
      el?.select();
    }, 0);
  };

  /* ---------- ввод в поле ---------- */
  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value.trim();
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!value && !arrowed) {
        setArrowed(true);
        setHl(0);
      } else setHl((h) => Math.min(list.length - 1, h + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setArrowed(true);
      setHl((h) => Math.max(0, h - 1));
      return;
    }
    if (e.key === 'Escape') {
      if (query) setQuery('');
      else if (mult !== 1) setMult(1);
      setScanError(null);
      return;
    }
    if (e.key === '*') {
      e.preventDefault();
      if (/^\d{1,3}$/.test(value) && Number(value) > 0) {
        setMult(Number(value));
        setQuery('');
        setScanError(null);
        return;
      }
      const it = value ? list[hl] : undefined;
      if (it) {
        const key = add(it.p.id, 'pcs', 1);
        if (key) focusLineQty(key);
        return;
      }
      const last = lastKey && cart.lines.some((l) => l.key === lastKey) ? lastKey : cart.lines[cart.lines.length - 1]?.key;
      if (last) focusLineQty(last);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!value) {
        if (arrowed && list[hl]) add(list[hl].p.id, 'pcs');
        return;
      }
      if (/^\d{8,14}$/.test(value)) {
        const hit = catalog.byBarcode.get(value);
        if (hit) {
          add(hit.productId, hit.pack);
          return;
        }
        const c = clientByCard(db, value);
        if (c) {
          setCart((x) => ({ ...x, clientId: c.id }));
          setQuery('');
          setScanError(null);
          toast(`Покупатель: ${c.name}`);
          return;
        }
        setScanError(`Штрихкод ${value} не найден в каталоге. Найдите товар по названию или артикулу.`);
        setQuery('');
        return;
      }
      const bySku = catalog.bySku.get(norm(value));
      if (bySku) {
        add(bySku, 'pcs');
        return;
      }
      if (list[hl]) add(list[hl].p.id, 'pcs');
      else setScanError(`По запросу «${value}» ничего нет. Проверьте название или отсканируйте штрихкод.`);
    }
  };

  /* ---------- оплата ---------- */
  const startPay = () => {
    if (!shift) {
      toast('Сначала откройте смену', 'error');
      return;
    }
    if (!priced.lines.length) {
      if (done) return; // чек только что оплачен — повторное F9 ничего не делает
      setScanError('Чек пуст — добавьте товар');
      focusSearch();
      return;
    }
    if (pctOver || reasonMissing) return;
    setPayError(null);
    setPay({ key: newKey() });
  };

  const checkout = (r: PayResult) => {
    if (!pay || busyRef.current) return;
    busyRef.current = true;
    setPayBusy(true);
    const payload = {
      lines: priced.lines.map((l) => ({
        productId: l.productId,
        pack: l.pack,
        packQty: l.packQty,
        discountPct: l.discounted ? cart.discountPct : 0,
        discountReason: l.discounted ? cart.discountReason : undefined,
      })),
      clientId: cart.clientId,
      cash: r.cash,
      card: r.card,
      idempotencyKey: pay.key,
    };
    const res = dispatch('receipt.checkout', payload, me.id);
    busyRef.current = false;
    setPayBusy(false);
    if (!res.ok) {
      setPayError(res.error);
      return;
    }
    const rec = getDB().receipts.find((x) => x.id === res.id);
    paidAtRef.current = Date.now();
    setPay(null);
    setDone(rec ? { id: rec.id, number: rec.number, total: rec.total, change: rec.change, cash: rec.cash, card: rec.card } : null);
    setCart(() => EMPTY_CART);
    setLineErrors({});
    toast(rec ? `Чек № ${rec.number} пробит${rec.change > 0 ? `, сдача ${fmt.money(rec.change)}` : ''}` : 'Чек пробит');
    focusSearch();
  };

  /* ---------- клавиатура на всём экране ---------- */
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keyRef.current = (e: KeyboardEvent) => {
    const layer = document.querySelector('[data-layer-id]');
    if (e.key === 'F9') {
      e.preventDefault();
      if (!layer) startPay();
      return;
    }
    if (layer) return;
    const a = document.activeElement as HTMLElement | null;
    const typing = !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
    if (e.key === 'Escape' && !typing) {
      setQuery('');
      setScanError(null);
      focusSearch();
      return;
    }
    if (!typing && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) searchRef.current?.focus();
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  /* ---------- последние чеки смены ---------- */
  const shiftReceipts = useMemo(() => {
    if (!shift) return [];
    const mine = role === 'seller' ? new Set(scoped.receipts.map((r) => r.id)) : null;
    return receiptsOfShift(db, shift.id).filter((r) => !mine || mine.has(r.id));
  }, [db, version, shift, scoped.receipts, role]);
  const sum = shift ? shiftSummary(db, shift.id) : null;

  /* ---------- разметка ---------- */
  const hint = query.trim() ? `Найдено ${fmt.num(found.total)}` : 'Ходовые товары';

  return (
    <>
      <PageHeader
        section="register"
        counts={{ receipts: sum?.receipts ?? null }}
        actions={
          <>
            <ShiftBadge shift={shift} />
            {can('refundReceipt') ? (
              <Button icon={<Undo2 />} onClick={() => setLookup(true)}>
                Возврат
              </Button>
            ) : null}
            <MoreMenu
              items={[
                { label: 'Закрыть смену', icon: <Lock />, onClick: () => navigate('/register/shift'), hidden: !shift },
                { label: 'Все чеки', icon: <ReceiptText />, onClick: () => navigate('/register/receipts') },
                { label: 'Печать последнего чека', icon: <Printer />, onClick: () => shiftReceipts[0] && print(shiftReceipts[0].id), hidden: !shiftReceipts.length },
              ]}
            />
          </>
        }
      />

      <div className="reg-pos">
        <div className="col-4" style={{ minWidth: 0 }}>
          <Card className="reg-search-card">
            <div className="input-wrap has-icon reg-search">
              <input
                ref={searchRef}
                className="input input-lg"
                value={query}
                autoFocus
                placeholder="Сканируйте штрихкод или введите название"
                aria-label="Поиск товара"
                onChange={(e) => {
                  setQuery(e.target.value);
                  if (scanError) setScanError(null);
                }}
                onKeyDown={onSearchKey}
              />
              <ScanBarcode className="is-lg" />
              {mult > 1 ? (
                <span className="reg-mult" title="Следующий товар добавится в этом количестве">
                  × {mult}
                </span>
              ) : null}
            </div>
            <div className="reg-hint">
              <span>{hint}</span>
              <span className="reg-hint-item">
                <span className="kbd">
                  <ArrowUp />
                </span>
                <span className="kbd">
                  <ArrowDown />
                </span>
                выбрать
              </span>
              <span className="reg-hint-item">
                <span className="kbd">Enter</span>в чек
              </span>
              <span className="reg-hint-item" title="«3*» перед сканом — добавить 3 штуки; «*» после поиска — ввести количество">
                <span className="kbd">*</span>количество
              </span>
              <span className="spacer" />
              <span className="reg-hint-item">
                Сканер
                <Chip tone="ok" icon={<Check />}>
                  Готов
                </Chip>
              </span>
            </div>
            {scanError ? (
              <div className="reg-scan-error">
                <Notice tone="bad">{scanError}</Notice>
              </div>
            ) : null}
            {list.length ? (
              <div className="reg-sugg-list" role="listbox" aria-label="Найденные товары">
                {list.map((it, i) => (
                  <SuggRow
                    key={it.p.id}
                    it={it}
                    query={query}
                    active={i === activeHl}
                    onHover={() => {
                      setHl(i);
                      if (!query.trim()) setArrowed(true);
                    }}
                    onAdd={() => {
                      if (Date.now() - paidAtRef.current < 600) return;
                      add(it.p.id, 'pcs');
                      focusSearch();
                    }}
                  />
                ))}
              </div>
            ) : query.trim() ? (
              <EmptyState title="Ничего не нашли">Проверьте название, артикул или отсканируйте штрихкод</EmptyState>
            ) : null}
          </Card>

          <Card
            title="Последние чеки смены"
            flush
            className="reg-recent"
            actions={
              <Link to="/register/receipts" className="btn btn-ghost btn-sm">
                Все чеки
                <ChevronRight />
              </Link>
            }
          >
            {shiftReceipts.length ? (
              <div className="table-scroll">
                <table className="table table-dense">
                  <thead>
                    <tr>
                      <th>Чек</th>
                      <th>Время</th>
                      <th>Состав</th>
                      <th>Оплата</th>
                      <th className="num">Сумма</th>
                      <th style={{ width: 44 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {shiftReceipts.slice(0, 5).map((r) => (
                      <tr key={r.id} className="is-clickable" onClick={() => openEntity('receipt', r.id)}>
                        <td className="cell-title nowrap">№ {r.number}</td>
                        <td className="num">{fmt.time(r.at)}</td>
                        <td className="reg-td-contents">
                          <span className="ellipsis" style={{ display: 'block' }}>
                            {receiptContents(db, r)}
                          </span>
                        </td>
                        <td>
                          <Chip tone={r.kind === 'refund' ? 'warn' : 'neutral'}>{PAY_KIND_NAMES[payKind(r)]}</Chip>
                        </td>
                        <td className="num w-600">{r.kind === 'refund' ? `−${fmt.money(r.total)}` : fmt.money(r.total)}</td>
                        <td className="num" onClick={(e) => e.stopPropagation()}>
                          <MoreMenu
                            size="sm"
                            items={[
                              { label: 'Открыть чек', icon: <ReceiptText />, onClick: () => openEntity('receipt', r.id) },
                              { label: 'Печать чека', icon: <Printer />, onClick: () => print(r.id) },
                              { label: 'Возврат по чеку', icon: <Undo2 />, onClick: () => openRefund(r), hidden: r.kind !== 'sale' || !can('refundReceipt') },
                            ]}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title={shift ? 'В этой смене чеков пока нет' : 'Смена не открыта'}>{shift ? 'Первый чек появится здесь сразу после оплаты' : null}</EmptyState>
            )}
          </Card>
        </div>

        {shift ? (
          <section className="card reg-receipt" aria-label="Чек">
            <div className="card-head">
              <h2 className="card-title nowrap">Чек № {nextNumber}</h2>
              {priced.lines.length ? <Chip>{fmt.count(priced.lines.length, 'позиция', 'позиции', 'позиций')}</Chip> : null}
              <span className="spacer" />
              <Button size="sm" icon={<UserRound />} onClick={() => setPicker(true)} title={client ? `Карта ${cardNumber(db, client)}` : 'Карта постоянного покупателя'}>
                <span className="reg-client-name">{client ? client.name : 'Покупатель'}</span>
              </Button>
              <MoreMenu
                size="sm"
                items={[
                  { label: 'Убрать покупателя', icon: <X />, onClick: () => setCart((c) => ({ ...c, clientId: null })), hidden: !client },
                  { label: 'Очистить чек', icon: <X />, danger: true, onClick: clearCart, disabled: !cart.lines.length && !cart.discountPct },
                ]}
              />
            </div>

            <div className="reg-lines" ref={linesRef}>
              {priced.lines.length ? (
                priced.lines.map((l) => (
                  <ReceiptLineRow
                    key={l.key}
                    l={l}
                    discountPct={cart.discountPct}
                    fresh={l.key === lastKey}
                    error={lineErrors[l.key]}
                    onQty={(v) => setLineQty(l, v)}
                    onPack={(p) => setLinePack(l, p)}
                    onRemove={() => removeLine(l.key)}
                    onDone={focusSearch}
                  />
                ))
              ) : done ? (
                <div className="reg-done">
                  <CircleCheck />
                  <div className="t-16 w-700">Оплачено · чек № {done.number}</div>
                  <div className="reg-done-sum num">{fmt.money(done.total)}</div>
                  {done.change > 0 ? (
                    <div className="t-14 w-600">
                      Сдача <span className="num">{fmt.money(done.change)}</span>
                    </div>
                  ) : (
                    <div className="t-13 muted">{done.card > 0 && done.cash > 0 ? 'Смешанная оплата' : done.card > 0 ? 'Оплачено картой' : 'Без сдачи'}</div>
                  )}
                  <div className="row" style={{ marginTop: 4 }}>
                    <Button icon={<Printer />} onClick={() => print(done.id)}>
                      Печать чека
                    </Button>
                    <Button variant="ghost" onClick={() => openEntity('receipt', done.id)}>
                      Открыть чек
                    </Button>
                  </div>
                </div>
              ) : (
                <EmptyState title="Чек пуст" icon={<ScanBarcode />}>
                  Отсканируйте товар или найдите по названию
                </EmptyState>
              )}
            </div>

            {discountLimit > 0 && priced.lines.length ? (
              <DiscountRow
                cart={cart}
                limit={discountLimit}
                amount={priced.discount}
                onChange={(patch) => setCart((c) => ({ ...c, ...patch }))}
                error={pctOver ? `Ваш лимит скидки — ${fmt.pct(discountLimit)}. Больше может дать только владелец.` : reasonMissing ? 'Выберите основание скидки' : null}
                note={
                  cart.discountPct > 0 && !pctOver && priced.discountEligible === 0
                    ? 'Все товары в чеке уже по акции — скидка к ним не добавляется'
                    : cart.discountPct > 0 && !pctOver && priced.discountLines < priced.discountEligible
                      ? `Скидка дана не на все товары: на ${priced.discountEligible - priced.discountLines} цена уже минимальная`
                      : null
                }
              />
            ) : null}

            <div className="reg-totals">
              {priced.lines.length ? (
                <div className="stat-list">
                  <div className="stat-row">
                    <span className="stat-label">Без скидок</span>
                    <span className="stat-value num">{fmt.money(priced.gross)}</span>
                  </div>
                  {priced.promo > 0 ? (
                    <div className="stat-row">
                      <span className="stat-label">{priced.promoNames.length === 1 ? `Акция «${priced.promoNames[0]}»` : 'Акции'}</span>
                      <span className="stat-value num">−{fmt.money(priced.promo)}</span>
                    </div>
                  ) : null}
                  {priced.discount > 0 ? (
                    <div className="stat-row">
                      <span className="stat-label">
                        Скидка {fmt.pct(cart.discountPct)}
                        {priced.promo > 0 ? ', кроме акций' : ''}
                      </span>
                      <span className="stat-value num">−{fmt.money(priced.discount)}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
              <div className="reg-total">
                <span className="reg-total-label">К оплате</span>
                <span className="reg-total-value num">{fmt.money(priced.total)}</span>
              </div>
            </div>
            <div className="reg-pay">
              <Button variant="primary" block className="reg-pay-btn" icon={<Wallet />} kbd="F9" disabled={!canPay} onClick={startPay}>
                Оплатить
              </Button>
            </div>
          </section>
        ) : (
          <OpenShiftCard className="reg-receipt" onOpened={focusSearch} />
        )}
      </div>

      {pay ? (
        <PayModal
          total={priced.total}
          number={nextNumber}
          positions={priced.lines.length}
          busy={payBusy}
          error={payError}
          onPay={checkout}
          onClose={() => {
            setPay(null);
            focusSearch();
          }}
        />
      ) : null}
      {picker ? (
        <ClientPicker
          current={cart.clientId}
          onPick={(id) => setCart((c) => ({ ...c, clientId: id }))}
          onClose={() => {
            setPicker(false);
            focusSearch();
          }}
        />
      ) : null}
      {lookup ? <ReturnLookup onClose={() => setLookup(false)} /> : null}
      {printNode}
    </>
  );
}

/* ---------- строка подсказки ---------- */

function SuggRow({ it, query, active, onHover, onAdd }: { it: CatalogItem; query: string; active: boolean; onHover: () => void; onAdd: () => void }) {
  const db = useDB();
  const st = stockOf(db, it.p.id);
  const info = priceFor(db, it.p.id, { priceType: 'retail', date: db.meta.today });
  const Icon = categoryIcon(it.category);
  return (
    <div
      className={cx('reg-sugg', active && 'is-hl')}
      role="option"
      aria-selected={active}
      onMouseEnter={onHover}
      onClick={onAdd}
    >
      <span className="icon-tile reg-tile">
        <Icon />
      </span>
      <div className="reg-sugg-name">
        <div className="reg-sugg-title">{highlight(nbUnits(it.p.name), query)}</div>
        <div className="cell-sub">
          {it.p.sku} · {it.p.packs[0]?.barcode}
        </div>
      </div>
      <div className="reg-sugg-stock">
        {st.shop.available > 0 ? (
          <>
            В магазине <b className="num">{fmt.qty(st.shop.available)}</b>
          </>
        ) : st.warehouse.available > 0 ? (
          <span className="reg-sugg-out">
            <Chip tone="warn">Нет в магазине</Chip>
            <span className="cell-sub">на складе {fmt.qty(st.warehouse.available)}</span>
          </span>
        ) : (
          <Chip tone="bad">Нет в наличии</Chip>
        )}
      </div>
      <div className="reg-sugg-price">
        {info.promo ? (
          <>
            <Chip tone="green">Акция −{promoPct(info.base, info.price)} %</Chip>
            <s className="reg-old num">{fmt.price(info.base)}</s>
          </>
        ) : null}
        <b className="num">{fmt.price(info.price)}</b>
      </div>
      <div className="reg-sugg-act">
        {active ? (
          <span className="kbd">Enter</span>
        ) : (
          <button
            type="button"
            className="btn btn-secondary btn-sm btn-icon"
            aria-label="В чек"
            onClick={(e) => {
              e.stopPropagation();
              onAdd();
            }}
          >
            <Plus />
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- строка чека ---------- */

function ReceiptLineRow({
  l,
  fresh,
  error,
  onQty,
  onPack,
  onRemove,
  onDone,
  discountPct,
}: {
  l: PricedLine;
  discountPct: number;
  fresh: boolean;
  error?: string;
  onQty: (v: number) => void;
  onPack: (p: PackKey) => void;
  onRemove: () => void;
  onDone: () => void;
}) {
  const unitPrice = l.price * l.packSize;
  const unitBase = l.base * l.packSize;
  return (
    <div className={cx('reg-line', fresh && 'is-fresh')} data-line-key={l.key}>
      <div className="reg-line-top">
        <div className="reg-line-name" title={l.p.name}>
          {nbUnits(cartName(l.p))}
        </div>
        <div className="reg-line-sum num" title={`${fmt.price(unitPrice)} × ${l.packQty}`}>
          {fmt.money(l.sum)}
        </div>
      </div>
      <div className="reg-line-bottom">
        <span
          onKeyDown={(e) => {
            if (e.key === 'Enter') window.setTimeout(onDone, 0);
            if (e.key === 'Escape') onDone();
          }}
        >
          <QtyInput value={l.packQty} min={1} onChange={onQty} ariaLabel={`Количество: ${l.p.name}`} />
        </span>
        {l.p.packs.length > 1 ? (
          <span className="reg-seg-xs">
            <Segmented<PackKey>
              ariaLabel="Единица"
              value={l.pack}
              onChange={onPack}
              options={l.p.packs.map((k) => ({ value: k.key, label: k.key === 'pcs' ? 'шт' : `${PACK_SHORT[k.key]} ${k.qty}` }))}
            />
          </span>
        ) : null}
        <span className="spacer" />
        <span className="nowrap num reg-line-calc" title={unitBase > unitPrice ? `Без скидки ${fmt.price(unitBase)}` : undefined}>
          {fmt.price(unitPrice)} × {l.packQty}
        </span>
        {l.promo ? <Chip tone="green">−{promoPct(l.base, l.promoPrice)} %</Chip> : l.discounted ? <Chip>−{fmt.pct(discountPct)}</Chip> : null}
        <button type="button" className="reg-icon-btn reg-line-x" aria-label="Убрать из чека" onClick={onRemove}>
          <X />
        </button>
      </div>
      {error ? <div className="reg-line-error">{error}</div> : null}
    </div>
  );
}

/* ---------- ручная скидка ---------- */

function DiscountRow({
  cart,
  limit,
  amount,
  onChange,
  error,
  note,
}: {
  cart: CartState;
  limit: number;
  amount: number;
  onChange: (p: Partial<CartState>) => void;
  error: string | null;
  note: string | null;
}) {
  const [text, setText] = useState(cart.discountPct ? String(cart.discountPct) : '');
  useEffect(() => setText(cart.discountPct ? String(cart.discountPct) : ''), [cart.discountPct]);
  return (
    <div className="reg-disc-wrap">
      <div className="reg-disc">
        <Percent />
        <Select
          size="sm"
          aria-label="Основание скидки"
          value={cart.discountReason}
          placeholder="Скидка: основание"
          options={DISCOUNT_REASONS.map((r) => ({ value: r, label: r }))}
          onChange={(e) => onChange({ discountReason: e.target.value })}
        />
        <Input
          size="sm"
          className="right"
          inputMode="decimal"
          aria-label={`Скидка, %, до ${limit}`}
          placeholder="0"
          value={text}
          invalid={!!error && cart.discountPct > limit}
          suffix="%"
          onChange={(e) => {
            const t = e.target.value.replace(',', '.').replace(/[^\d.]/g, '');
            setText(t);
            const v = Number(t);
            onChange({ discountPct: Number.isFinite(v) ? Math.min(100, Math.round(v * 10) / 10) : 0 });
          }}
        />
        <span className="w-700 nowrap num reg-disc-sum">{amount > 0 ? `−${fmt.money(amount)}` : '—'}</span>
      </div>
      {error ? <div className="reg-line-error">{error}</div> : note ? <div className="t-12 muted">{note}</div> : null}
    </div>
  );
}
