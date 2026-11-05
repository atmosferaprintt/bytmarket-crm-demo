/* Приёмка по закупке: поля пустые, пока кладовщик не впишет, что пришло (коробки + штуки),
   или не нажмёт «Всё сходится». Сканер прибавляет коробку или штуку. Причины брака — отдельно от причин недовоза. */
import { useEffect, useRef, useState } from 'react';
import { CheckCheck } from 'lucide-react';
import type { ID, Product, Purchase, PurchaseLine } from '../../data/types';
import type { Indexes } from '../../data/selectors';
import { EntityLink } from '../../shell/entities';
import { Button, Input, Notice, Select, cx, fmt } from '../../ui';
import { ProductPicker } from '../stock/ProductPicker';
import { inBoxes } from '../stock/calc';

/** Почему пришло не столько, сколько заказали. */
export const SHORT_REASONS = ['Недовоз поставщика', 'Пересорт', 'Излишек от поставщика', 'Другое'];
/** Почему товар бракованный — уходит в карантин. */
export const DEFECT_REASONS = ['Повреждена упаковка', 'Протечка', 'Истёк срок годности', 'Другое'];

export interface RecvLine {
  boxes: string;
  pcs: string;
  defect: string;
  defectReason: string;
  diffReason: string;
}
export const EMPTY_RECV: RecvLine = { boxes: '', pcs: '', defect: '', defectReason: '', diffReason: '' };

export interface RecvRow {
  l: PurchaseLine;
  p: Product | undefined;
  v: RecvLine;
  bs: number; // штук в коробке поставщика
  prev: number; // принято раньше
  wait: number; // ждём сейчас
  now: number | null; // пришло сейчас; null — не заполнено
  defNow: number;
  cum: number; // принято всего после этой приёмки
  cumDefect: number;
  showDiff: boolean;
  needDiff: boolean;
  needDefect: boolean;
}

const n = (s: string) => Number(s || 0);

export function recvRows(pu: Purchase, recv: Record<ID, RecvLine>, final: boolean, ix: Indexes): RecvRow[] {
  return pu.lines.map((l) => {
    const v = recv[l.productId] ?? EMPTY_RECV;
    const bs = Math.max(1, l.boxSize);
    const prev = l.received ?? 0;
    const wait = Math.max(0, l.qty - prev);
    const now = v.boxes === '' && v.pcs === '' ? null : n(v.boxes) * bs + n(v.pcs);
    const defNow = n(v.defect);
    const cum = prev + (now ?? 0);
    const cumDefect = l.defect + defNow;
    // излишек — причина нужна всегда; недовоз — когда закупку закрываем
    const needDiff = cum > l.qty || (final && cum < l.qty);
    const showDiff = needDiff || (now !== null && now !== wait) || v.diffReason !== '';
    return { l, p: ix.products.get(l.productId), v, bs, prev, wait, now, defNow, cum, cumDefect, showDiff, needDiff, needDefect: defNow > 0 };
  });
}

/** Ошибка формы или null. */
export function recvError(rows: RecvRow[], final: boolean): string | null {
  if (!final && rows.every((x) => x.now === null)) return 'Впишите, сколько пришло, или нажмите «Всё сходится», если привезли ровно по заказу';
  for (const x of rows) {
    const name = x.p?.name ?? 'Товар';
    if (x.defNow > (x.now ?? 0)) return `${name}: брака больше, чем пришло сейчас`;
    if (x.needDefect && !x.v.defectReason) return `Укажите причину брака: ${name}`;
    if (x.needDiff && !x.v.diffReason)
      return x.cum > x.l.qty
        ? `Укажите причину излишка: ${name} — заказано ${fmt.qty(x.l.qty)}, пришло ${fmt.qty(x.cum)}`
        : `Укажите причину недовоза: ${name} — заказано ${fmt.qty(x.l.qty)}, принято ${fmt.qty(x.cum)}`;
  }
  return null;
}

/** Строки для purchase.receive: принятое и брак — нарастающим итогом, причина брака и недовоза в одной записи. */
export function recvPayload(rows: RecvRow[], final: boolean) {
  return rows
    .filter((x) => final || x.now !== null)
    .map((x) => {
      const reason = [x.v.defectReason, x.v.diffReason].filter(Boolean).join('; ');
      return { productId: x.l.productId, received: x.cum, defect: x.cumDefect, ...(reason ? { diffReason: reason } : {}) };
    });
}

function split(total: number, bs: number): Pick<RecvLine, 'boxes' | 'pcs'> {
  if (bs <= 1) return { boxes: '', pcs: String(total) };
  const b = Math.floor(total / bs);
  const r = total - b * bs;
  return { boxes: String(b), pcs: r ? String(r) : b ? '' : '0' };
}

export function fillAll(pu: Purchase): Record<ID, RecvLine> {
  const r: Record<ID, RecvLine> = {};
  for (const l of pu.lines) r[l.productId] = { ...EMPTY_RECV, ...split(Math.max(0, l.qty - (l.received ?? 0)), Math.max(1, l.boxSize)) };
  return r;
}

const digits = (s: string) => s.replace(/[^\d]/g, '');

export function ReceiveBody({
  pu,
  rows,
  setRecv,
  tried,
}: {
  pu: Purchase;
  rows: RecvRow[];
  setRecv: (f: (r: Record<ID, RecvLine>) => Record<ID, RecvLine>) => void;
  /** после попытки провести — подсвечиваем незаполненные причины */
  tried: boolean;
}) {
  const [scanError, setScanError] = useState<string | null>(null);
  const [flash, setFlash] = useState<ID | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const prevTotal = pu.lines.reduce((z, l) => z + (l.received ?? 0), 0);
  const filled = rows.filter((x) => x.now !== null).length;

  useEffect(() => {
    if (!flash) return;
    tableRef.current?.querySelector(`[data-pid="${flash}"]`)?.scrollIntoView({ block: 'nearest' });
    const t = window.setTimeout(() => setFlash(null), 1200);
    return () => window.clearTimeout(t);
  }, [flash]);

  const patch = (pid: ID, v: Partial<RecvLine>) => setRecv((r) => ({ ...r, [pid]: { ...(r[pid] ?? EMPTY_RECV), ...v } }));

  const scan = (p: Product, packQty: number) => {
    const x = rows.find((r) => r.l.productId === p.id);
    if (!x) return setScanError(`${p.name} нет в закупке № ${pu.number}. Если его привезли сверх заказа — оформите ручной приход`);
    setScanError(null);
    patch(p.id, split((x.now ?? 0) + packQty, x.bs));
    setFlash(p.id);
  };

  return (
    <>
      <Notice tone="info" title="Приёмка">
        {prevTotal > 0 ? `Раньше по закупке приняли ${fmt.qty(prevTotal)}. Впишите только то, что привезли сейчас. ` : 'Впишите, сколько пришло: коробками и штуками. '}
        Не привезли — оставьте пустым, строка останется в «Ожидается». Брак уйдёт в карантин и в продажу не попадёт
      </Notice>
      <div className="pur-recv-tools">
        <div className="grow" style={{ minWidth: 0 }}>
          <ProductPicker autoFocus onPick={(p, pk) => scan(p, pk.qty)} placeholder="Сканируйте коробку или штуку — прибавим к «Пришло»" extra={(p) => (pu.lines.some((l) => l.productId === p.id) ? 'в закупке' : 'нет в закупке')} />
        </div>
        <Button
          icon={<CheckCheck />}
          onClick={() => {
            setScanError(null);
            setRecv(() => fillAll(pu));
          }}
          title="Заполнить все строки по заказу: пришло ровно столько, сколько ждём, брака нет">
          Всё сходится
        </Button>
      </div>
      {scanError ? <Notice tone="bad">{scanError}</Notice> : null}

      <section className="card is-flush">
        <div className="table-scroll" ref={tableRef}>
          <table className="table table-dense pur-lines pur-recv">
            <thead>
              <tr>
                <th>Товар</th>
                <th className="num">Ждём</th>
                <th>Пришло</th>
                <th>Брак, шт</th>
                <th>Причина</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => {
                const { l, p, v, bs, wait, now } = x;
                const diff = now !== null && (now !== wait || x.defNow > 0);
                const boxes = p ? inBoxes(p, wait) : null;
                // коробка поставщика может быть упаковкой товара: «уп. по 6»
                const unit = p?.packs.find((k) => k.qty === bs && k.key !== 'pcs')?.key === 'pack' ? 'уп.' : 'кор.';
                return (
                  <tr key={l.productId} data-pid={l.productId} className={cx(diff && 'pur-row-diff', flash === l.productId && 'stock-flash')}>
                    <td>
                      {p ? (
                        <EntityLink type="product" id={p.id}>
                          <span className="pur-line-name">{p.name}</span>
                        </EntityLink>
                      ) : (
                        '—'
                      )}
                      <div className="cell-sub">{p?.sku}</div>
                    </td>
                    <td className="num">
                      <div className="w-700 nowrap" title={x.prev ? `Заказано ${fmt.qty(l.qty)}, раньше приняли ${fmt.qty(x.prev)}` : undefined}>
                        {fmt.qty(wait)}
                      </div>
                      {bs > 1 && wait >= bs ? <div className="muted nowrap t-12">{boxes}</div> : null}
                    </td>
                    <td>
                      <div className="pur-recv-qty">
                        {bs > 1 ? (
                          <>
                            <Input size="sm" className="num pur-num-s" inputMode="numeric" value={v.boxes} placeholder="—" onChange={(e) => patch(l.productId, { boxes: digits(e.target.value) })} aria-label={`Коробок: ${p?.name ?? ''}`} />
                            <span className="t-12 muted nowrap">
                              {unit} по {bs} +
                            </span>
                          </>
                        ) : null}
                        <Input size="sm" className="num pur-num-s" inputMode="numeric" value={v.pcs} placeholder="—" onChange={(e) => patch(l.productId, { pcs: digits(e.target.value) })} aria-label={`Штук: ${p?.name ?? ''}`} />
                        <span className="t-12 muted">шт</span>
                      </div>
                      {now !== null && bs > 1 ? (
                        <div className={cx('t-12 w-700 pur-recv-eq', now < wait ? 'c-warn' : now > wait ? 'c-bad' : 'c-ok')}>= {fmt.qty(now)}</div>
                      ) : null}
                    </td>
                    <td>
                      <Input size="sm" className="num pur-num-s" inputMode="numeric" value={v.defect} placeholder="0" onChange={(e) => patch(l.productId, { defect: digits(e.target.value) })} aria-label={`Брак: ${p?.name ?? ''}`} />
                    </td>
                    <td>
                      <div className="col" style={{ gap: 6 }}>
                        {x.needDefect ? (
                          <Select size="sm" value={v.defectReason} placeholder="Причина брака" className={tried && !v.defectReason ? 'is-invalid' : undefined} onChange={(e) => patch(l.productId, { defectReason: e.target.value })} options={DEFECT_REASONS.map((r) => ({ value: r, label: r }))} aria-label="Причина брака" />
                        ) : null}
                        {x.showDiff ? (
                          <Select
                            size="sm"
                            value={v.diffReason}
                            placeholder={x.cum > l.qty ? 'Почему больше' : 'Почему меньше'}
                            className={tried && x.needDiff && !v.diffReason ? 'is-invalid' : undefined}
                            onChange={(e) => patch(l.productId, { diffReason: e.target.value })}
                            options={SHORT_REASONS.map((r) => ({ value: r, label: r }))}
                            aria-label="Причина расхождения"
                          />
                        ) : null}
                        {!x.needDefect && !x.showDiff ? <span className={now === null ? 'faint' : 'c-ok w-600'}>{now === null ? '—' : 'сходится'}</span> : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td>
                  Заполнено {fmt.num(filled)} из {fmt.count(rows.length, 'строки', 'строк', 'строк')}
                </td>
                <td className="num">{fmt.num(rows.reduce((z, x) => z + x.wait, 0))}</td>
                <td>{fmt.qty(rows.reduce((z, x) => z + (x.now ?? 0), 0))}</td>
                <td>{fmt.num(rows.reduce((z, x) => z + x.defNow, 0))}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </>
  );
}
