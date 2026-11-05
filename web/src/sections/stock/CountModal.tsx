/* Пересчёт: место и категория → лист «по учёту — факт — разница».
   Сканер прибавляет к факту, пустой факт — «не считали» и в документ не идёт. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { ID, LocationKey, Product } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { categoryFamily, indexes, stockIndex } from '../../data/selectors';
import { get } from '../../data/idx';
import { useSession } from '../../roles/session';
import { Button, Checkbox, Chip, EmptyState, Field, Input, Modal, MoreMenu, Notice, Select, cx, fmt, toast } from '../../ui';
import { ProductPicker } from './ProductPicker';
import { LOCATION_OPTIONS, boxPack, categoryOptions, placeName, shortName } from './calc';
import { act } from './act';
import './stock.css';

interface SheetRow {
  p: Product;
  expected: number;
  reserved: number;
}

/** Факт: коробки + штуки. Пусто в обоих полях — «не считали». */
interface Fact {
  b: string;
  s: string;
}

/** Крупная недостача: больше 10 шт или больше 20 % учёта — спросим причину перед проведением. */
const BIG_PCS = 10;
const BIG_SHARE = 0.2;
const BIG_REASONS = ['Не нашли на месте', 'Пересорт — лежит под другим товаром', 'Порча или бой', 'Ошибка прошлого учёта', 'Другое'];

const boxOf = (p: Product) => {
  const b = boxPack(p);
  return b.qty > 1 ? b : null;
};

export function CountModal({ onClose, preset }: { onClose: () => void; preset?: { location?: LocationKey; categoryId?: ID } }) {
  const db = useDB();
  const version = useDBVersion();
  const { me, can } = useSession();
  const seeCost = can('seeCost');
  const ix = indexes(db);
  const [location, setLocation] = useState<LocationKey>(preset?.location ?? 'warehouse');
  const [categoryId, setCategoryId] = useState<ID>(preset?.categoryId ?? '');
  const [onlyStock, setOnlyStock] = useState(true);
  const [extra, setExtra] = useState<ID[]>([]); // добавленные сканером вне категории
  const [fact, setFact] = useState<Record<ID, Fact>>({});
  const [askBig, setAskBig] = useState(false);
  const [bigReason, setBigReason] = useState<Record<ID, string>>({});
  const [flash, setFlash] = useState<ID | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ number: number | null; info: string } | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  const sheet = useMemo<SheetRow[]>(() => {
    if (!categoryId) return [];
    const fam = categoryFamily(db, categoryId);
    const si = stockIndex(db);
    const list: SheetRow[] = [];
    const seen = new Set<ID>();
    for (const p of db.products) {
      if (!fam.has(p.categoryId)) continue;
      const st = si.get(p.id)![location];
      if (onlyStock && st.onHand === 0 && st.reserved === 0) continue;
      if (!p.active && st.onHand === 0) continue;
      list.push({ p, expected: st.onHand, reserved: st.reserved });
      seen.add(p.id);
    }
    list.sort((a, b) => a.p.name.localeCompare(b.p.name, 'ru'));
    for (const id of extra) {
      if (seen.has(id)) continue;
      const p = ix.products.get(id);
      if (!p) continue;
      const st = si.get(id)![location];
      list.push({ p, expected: st.onHand, reserved: st.reserved });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryId, location, onlyStock, extra, version]);

  useEffect(() => {
    setFact({});
    setExtra([]);
  }, [categoryId, location]);

  useEffect(() => {
    if (!flash) return;
    const el = tableRef.current?.querySelector(`[data-pid="${flash}"]`);
    el?.scrollIntoView({ block: 'nearest' });
    const t = window.setTimeout(() => setFlash(null), 1200);
    return () => window.clearTimeout(t);
  }, [flash]);

  const has = (id: ID) => !!fact[id] && (fact[id].b !== '' || fact[id].s !== '');
  const totalOf = (p: Product): number => {
    const v = fact[p.id];
    if (!v) return 0;
    return Number(v.b || 0) * (boxOf(p)?.qty ?? 1) + Number(v.s || 0);
  };
  const counted = sheet.filter((r) => has(r.p.id));
  const diffs = counted.map((r) => ({ r, f: totalOf(r.p), d: totalOf(r.p) - r.expected }));
  const big = diffs.filter((x) => x.d < 0 && (-x.d > BIG_PCS || -x.d > x.r.expected * BIG_SHARE));
  const plus = diffs.reduce((s, x) => s + Math.max(0, x.d), 0);
  const minus = diffs.reduce((s, x) => s + Math.max(0, -x.d), 0);
  const changed = diffs.filter((x) => x.d !== 0).length;
  const underReserve = diffs.filter((x) => x.f < x.r.reserved);
  const diffCost = diffs.reduce((s, x) => s + x.d * (x.r.p.cost ?? 0), 0);

  // скан коробки прибавляет коробку, скан штуки или упаковки — штуки
  const scan = (p: Product, qty: number) => {
    if (!sheet.some((r) => r.p.id === p.id)) setExtra((e) => [...e, p.id]);
    const bx = boxOf(p);
    setFact((f) => {
      const v = f[p.id] ?? { b: '', s: '' };
      if (bx && qty === bx.qty) return { ...f, [p.id]: { ...v, b: String(Number(v.b || 0) + 1) } };
      return { ...f, [p.id]: { ...v, s: String(Number(v.s || 0) + qty) } };
    });
    setFlash(p.id);
  };

  const split = (p: Product, qty: number): Fact => {
    const bx = boxOf(p);
    if (!bx || qty < bx.qty) return { b: '', s: String(qty) };
    const n = Math.floor(qty / bx.qty);
    const rest = qty - n * bx.qty;
    return { b: String(n), s: rest ? String(rest) : '' };
  };

  const fillRest = () => {
    setFact((f) => {
      const n = { ...f };
      for (const r of sheet) if (!n[r.p.id] || (n[r.p.id].b === '' && n[r.p.id].s === '')) n[r.p.id] = split(r.p, r.expected);
      return n;
    });
  };

  const setPart = (id: ID, part: keyof Fact, v: string) => setFact((x) => ({ ...x, [id]: { ...(x[id] ?? { b: '', s: '' }), [part]: v.replace(/[^\d]/g, '') } }));

  const submit = (confirmed = false) => {
    setError(null);
    if (!counted.length) return setError('Введите факт хотя бы по одной позиции. Пустые строки в пересчёт не попадут');
    if (big.length && !confirmed) {
      setAskBig(true);
      return;
    }
    const cat = db.categories.find((c) => c.id === categoryId);
    const bigText = big.length ? `. Крупная недостача: ${big.map((x) => `${shortName(x.r.p)} −${x.d * -1} шт (${bigReason[x.r.p.id]})`).join('; ')}` : '';
    const r = act(
      'stock.count',
      { location, lines: counted.map((x) => ({ productId: x.p.id, qty: totalOf(x.p) })), comment: `Пересчёт: ${placeName(location).toLowerCase()}, ${cat?.name ?? 'выборочно'}${bigText}`.slice(0, 2000) },
      me.id,
    );
    setAskBig(false);
    if (!r.ok) return setError(r.error);
    const doc = r.id ? get(db, 'stockDocs', r.id) : undefined;
    setResult({ number: doc?.number ?? null, info: r.info ?? 'Пересчёт проведён' });
    toast(`Пересчёт${doc ? ` № ${doc.number}` : ''} проведён`);
  };

  if (result) {
    const warn = /резерв/i.test(result.info);
    return (
      <Modal title={`Пересчёт${result.number ? ` № ${result.number}` : ''} проведён`} onClose={onClose} footer={<Button variant="primary" onClick={onClose}>Готово</Button>}>
        <Notice tone={warn ? 'warn' : 'ok'} title={warn ? 'Проверьте заказы' : 'Остатки обновлены'}>
          <div className="col" style={{ gap: 4, marginTop: 4 }}>
            {result.info.split('. ').map((s, i) => (
              <span key={i}>{s.replace(/\.$/, '')}</span>
            ))}
          </div>
        </Notice>
        {warn ? <div className="t-13 ink-2">Факт меньше резерва: часть подтверждённых заказов не из чего собрать. Уменьшите заказ или дождитесь поставки.</div> : null}
      </Modal>
    );
  }

  return (
    <Modal
      wide
      title="Пересчёт"
      onClose={onClose}
      footer={
        <>
          <span className="stock-doc-total">
            Пересчитано {fmt.num(counted.length)} из {fmt.num(sheet.length)}
            {changed ? (
              <>
                {' '}· расхождений {fmt.num(changed)}
                {plus ? <span className="c-ok"> · излишек {fmt.qty(plus)}</span> : null}
                {minus ? <span className="c-bad"> · недостача {fmt.qty(minus)}</span> : null}
                {seeCost && diffCost ? <span className="muted"> · {diffCost > 0 ? '+' : '−'}{fmt.money(Math.abs(diffCost))}</span> : null}
              </>
            ) : null}
          </span>
          <span className="spacer" />
          {sheet.length ? <MoreMenu items={[{ label: 'Заполнить остальные по учёту', icon: <ClipboardCheck />, onClick: fillRest }]} /> : null}
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={() => submit()} disabled={!counted.length}>
            Провести пересчёт
          </Button>
        </>
      }
    >
      <div className="stock-doc-head is-count">
        <Field label="Место">
          <Select value={location} onChange={(e) => setLocation(e.target.value as LocationKey)} options={LOCATION_OPTIONS} />
        </Field>
        <Field label="Категория">
          <Select value={categoryId} placeholder="Выберите категорию" onChange={(e) => setCategoryId(e.target.value)} options={categoryOptions(db)} />
        </Field>
        <div className="stock-count-only">
          <Checkbox checked={onlyStock} onChange={setOnlyStock}>
            Только с остатком
          </Checkbox>
        </div>
      </div>

      {categoryId ? <ProductPicker autoFocus location={location} onPick={(p, pk) => scan(p, pk.qty)} placeholder="Сканируйте товар — прибавим к факту" /> : null}

      {!categoryId ? (
        <div className="stock-doc-empty">
          <EmptyState icon={<ClipboardCheck />} title="Выберите место и категорию">
            Покажем лист пересчёта: сколько по учёту, сколько насчитали и разницу
          </EmptyState>
        </div>
      ) : sheet.length === 0 ? (
        <div className="stock-doc-empty">
          <EmptyState title="В этой категории здесь нет товара">Снимите «Только с остатком», чтобы посчитать и пустые места</EmptyState>
        </div>
      ) : (
        <div className="stock-doc-lines stock-count-sheet" ref={tableRef}>
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Товар</th>
                <th className="num" style={{ width: 96 }}>
                  По учёту
                </th>
                <th className="num" style={{ width: 84 }}>
                  Резерв
                </th>
                <th className="num" style={{ width: 196 }} title="Сколько насчитали: коробки и штуки">
                  Факт, кор. + шт
                </th>
                <th className="num" style={{ width: 96 }}>
                  Разница
                </th>
                <th style={{ width: 150 }} />
              </tr>
            </thead>
            <tbody>
              {sheet.map((r) => {
                const v = fact[r.p.id] ?? { b: '', s: '' };
                const bx = boxOf(r.p);
                const f = has(r.p.id) ? totalOf(r.p) : null;
                const d = f === null ? null : f - r.expected;
                return (
                  <tr key={r.p.id} data-pid={r.p.id} className={cx(flash === r.p.id && 'stock-flash')}>
                    <td>
                      <div className="cell-title stock-doc-name">{r.p.name}</div>
                      <div className="cell-sub">{r.p.sku}</div>
                    </td>
                    <td className="num">{fmt.num(r.expected)}</td>
                    <td className="num muted">{r.reserved ? fmt.num(r.reserved) : '—'}</td>
                    <td className="num">
                      <div className="stock-fact-cell">
                        {bx ? (
                          <>
                            <Input size="sm" className="num stock-fact" inputMode="numeric" value={v.b} placeholder="—" title={`Коробок по ${bx.qty} шт`} aria-label={`Коробок: ${r.p.name}`} onChange={(e) => setPart(r.p.id, 'b', e.target.value)} />
                            <span className="t-12 muted nowrap" title={`${bx.key === 'box' ? 'Коробка' : 'Упаковка'} — ${bx.qty} шт`}>
                              {bx.key === 'box' ? 'кор.' : 'уп.'} +
                            </span>
                          </>
                        ) : null}
                        <Input size="sm" className="num stock-fact" inputMode="numeric" value={v.s} placeholder="—" aria-label={`Штук: ${r.p.name}`} onChange={(e) => setPart(r.p.id, 's', e.target.value)} />
                        <span className="t-12 muted">шт</span>
                      </div>
                      {bx && f !== null && v.b !== '' ? <div className="t-12 w-600 ink-2 stock-fact-eq">= {fmt.qty(f)}</div> : null}
                    </td>
                    <td className={cx('num w-700', d !== null && d > 0 && 'c-ok', d !== null && d < 0 && 'c-bad')}>{d === null ? <span className="faint">—</span> : d === 0 ? '0' : `${d > 0 ? '+' : '−'}${fmt.num(Math.abs(d))}`}</td>
                    <td>{f !== null && f < r.reserved ? <Chip tone="bad">Меньше резерва</Chip> : d === 0 ? <Chip tone="ok">Сходится</Chip> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {underReserve.length ? (
        <Notice tone="warn" title="Факт меньше резерва">
          {underReserve
            .slice(0, 3)
            .map((x) => `${x.r.p.name}: факт ${fmt.qty(x.f)}, в резерве ${fmt.qty(x.r.reserved)}`)
            .join('; ')}
          {underReserve.length > 3 ? ` и ещё ${underReserve.length - 3}` : ''}. Пересчёт проведём честно, но эти заказы не из чего собрать
        </Notice>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {askBig ? (
        <Modal
          title={`Крупная недостача: ${fmt.count(big.length, 'позиция', 'позиции', 'позиций')}`}
          sub="Проверьте ещё раз и укажите причину — она попадёт в документ пересчёта"
          onClose={() => setAskBig(false)}
          footer={
            <>
              <span className="spacer" />
              <Button variant="ghost" onClick={() => setAskBig(false)}>
                Пересчитать
              </Button>
              <Button variant="primary" disabled={big.some((x) => !bigReason[x.r.p.id])} onClick={() => submit(true)}>
                Провести с недостачей
              </Button>
            </>
          }
        >
          <div className="stock-big-list">
            {big.map((x) => (
              <div key={x.r.p.id} className="stock-big-row">
                <div style={{ minWidth: 0 }}>
                  <div className="w-600 stock-doc-name">{x.r.p.name}</div>
                  <div className="t-12 ink-2">
                    По учёту {fmt.qty(x.r.expected)}, насчитали {fmt.qty(x.f)} · <span className="c-bad w-700">−{fmt.num(-x.d)} шт</span>
                  </div>
                </div>
                <Select size="sm" value={bigReason[x.r.p.id] ?? ''} placeholder="Причина" onChange={(e) => setBigReason((b) => ({ ...b, [x.r.p.id]: e.target.value }))} options={BIG_REASONS.map((v) => ({ value: v, label: v }))} aria-label={`Причина недостачи: ${x.r.p.name}`} />
              </div>
            ))}
          </div>
          {seeCost ? (
            <div className="t-13 ink-2">
              Недостача по закупочной цене: <b>{fmt.money(big.reduce((z, x) => z + -x.d * (x.r.p.cost ?? 0), 0))}</b>
            </div>
          ) : null}
        </Modal>
      ) : null}
    </Modal>
  );
}
