/* Документы склада на несколько строк: приход, перемещение, списание.
   Сканер и поиск сверху, строки в штуках или упаковках «= N шт», итог и «Провести». */
import { useMemo, useState } from 'react';
import { ArrowLeftRight, ScanBarcode, X } from 'lucide-react';
import type { ID, LocationKey, PackKey, Product, WriteoffReason } from '../../data/types';
import { WRITEOFF_REASONS } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes, stockIndex } from '../../data/selectors';
import { get } from '../../data/idx';
import { useSession } from '../../roles/session';
import { Button, EmptyState, Field, Input, Modal, Notice, QtyInput, Select, fmt, toast } from '../../ui';
import { ProductPicker } from './ProductPicker';
import { LOCATION_OPTIONS, packLabel, packOf, placeName } from './calc';
import { act } from './act';
import './stock.css';

export type DocKind = 'income' | 'transfer' | 'writeoff';

export interface DocPresetLine {
  productId: ID;
  pack?: PackKey;
  packQty: number;
  reason?: WriteoffReason;
}
export interface DocPreset {
  lines?: DocPresetLine[];
  from?: LocationKey;
  to?: LocationKey;
  comment?: string;
}

interface Line {
  key: string;
  productId: ID;
  pack: PackKey;
  packQty: number;
  reason: WriteoffReason | '';
  expiry: string;
}

const TITLES: Record<DocKind, string> = { income: 'Приход товара', transfer: 'Перемещение', writeoff: 'Списание' };
const POST: Record<DocKind, string> = { income: 'Провести приход', transfer: 'Провести перемещение', writeoff: 'Провести списание' };
const DONE: Record<DocKind, string> = { income: 'Приход', transfer: 'Перемещение', writeoff: 'Списание' };
const DONE_VERB: Record<DocKind, string> = { income: 'проведён', transfer: 'проведено', writeoff: 'проведено' };

let seq = 0;
const newKey = () => `l${++seq}`;

export function StockDocModal({ kind, preset, onClose }: { kind: DocKind; preset?: DocPreset; onClose: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const { me, can } = useSession();
  const seeCost = can('seeCost');
  const ix = indexes(db);
  const [from, setFrom] = useState<LocationKey>(preset?.from ?? 'warehouse');
  const [to, setTo] = useState<LocationKey>(preset?.to ?? (kind === 'transfer' ? 'shop' : 'warehouse'));
  const [comment, setComment] = useState(preset?.comment ?? '');
  const [lines, setLines] = useState<Line[]>(() =>
    (preset?.lines ?? []).map((l) => ({ key: newKey(), productId: l.productId, pack: l.pack ?? 'pcs', packQty: l.packQty, reason: l.reason ?? '', expiry: '' })),
  );
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);

  // откуда берём товар (для проверки свободного остатка)
  const source: LocationKey | null = kind === 'transfer' ? from : kind === 'writeoff' ? from : null;
  const target: LocationKey = kind === 'transfer' ? to : kind === 'income' ? to : from;

  const si = stockIndex(db);
  const rows = useMemo(() => {
    const need = new Map<ID, number>();
    const res = lines.map((l) => {
      const p = ix.products.get(l.productId)!;
      const pk = packOf(p, l.pack);
      const qty = l.packQty * pk.qty;
      need.set(p.id, (need.get(p.id) ?? 0) + qty);
      return { l, p, pk, qty };
    });
    return res.map((r) => {
      const free = source ? si.get(r.p.id)?.[source].available ?? 0 : null;
      const short = free !== null && (need.get(r.p.id) ?? 0) > free;
      return { ...r, free, short };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, version, source]);

  const totalQty = rows.reduce((s, r) => s + r.qty, 0);
  const totalCost = rows.reduce((s, r) => s + (r.p.cost ?? 0) * r.qty, 0);
  const hasShort = rows.some((r) => r.short);
  const missingReason = kind === 'writeoff' && lines.some((l) => !l.reason);

  const add = (p: Product, packKey: PackKey) => {
    setError(null);
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === p.id && l.pack === packKey);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, packQty: l.packQty + 1 } : l));
      return [...ls, { key: newKey(), productId: p.id, pack: packKey, packQty: 1, reason: '', expiry: '' }];
    });
  };
  const patch = (key: string, v: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...v } : l)));
  const remove = (key: string) => setLines((ls) => ls.filter((l) => l.key !== key));

  const submit = () => {
    setTried(true);
    setError(null);
    if (!lines.length) return setError('Добавьте хотя бы одну строку: отсканируйте товар или найдите его по названию');
    if (kind === 'income' && !comment.trim()) return setError('Укажите основание прихода: например, «Накладная № 418 от ЮгХимОпт»');
    if (missingReason) return setError('Выберите причину списания в каждой строке');
    const payloadLines = rows.map((r) => ({
      productId: r.p.id,
      qty: r.qty,
      ...(kind === 'writeoff' ? { reason: r.l.reason } : {}),
      ...(kind === 'income' && r.l.expiry ? { expiry: r.l.expiry } : {}),
    }));
    const r =
      kind === 'income'
        ? act('stock.income', { location: to, lines: payloadLines, comment: comment.trim() }, me.id)
        : kind === 'transfer'
          ? act('stock.transfer', { from, to, lines: payloadLines, comment: comment.trim() || undefined }, me.id)
          : act('stock.writeoff', { location: from, lines: payloadLines, comment: comment.trim() || undefined }, me.id);
    if (!r.ok) return setError(r.error);
    const doc = r.id ? get(db, 'stockDocs', r.id) : undefined;
    toast(`${DONE[kind]}${doc ? ` № ${doc.number}` : ''} ${DONE_VERB[kind]}: ${fmt.count(rows.length, 'позиция', 'позиции', 'позиций')}, ${fmt.qty(totalQty)}`);
    onClose();
  };

  const placeSelect = (value: LocationKey, onChange: (v: LocationKey) => void) => (
    <Select value={value} onChange={(e) => onChange(e.target.value as LocationKey)} options={LOCATION_OPTIONS} />
  );

  return (
    <Modal
      wide
      title={TITLES[kind]}
      onClose={onClose}
      footer={
        <>
          <span className="stock-doc-total">
            {fmt.count(rows.length, 'позиция', 'позиции', 'позиций')} · {fmt.qty(totalQty)}
            {seeCost && kind === 'writeoff' && totalCost > 0 ? <span className="muted"> · по себестоимости {fmt.money(totalCost)}</span> : null}
          </span>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} disabled={!lines.length}>
            {POST[kind]}
          </Button>
        </>
      }
    >
      <div className={kind === 'transfer' ? 'stock-doc-head is-transfer' : 'stock-doc-head'}>
        {kind === 'transfer' ? (
          <>
            <Field label="Откуда">{placeSelect(from, (v) => { setFrom(v); if (v === to) setTo(from); })}</Field>
            <Button
              variant="ghost"
              iconOnly
              aria-label="Поменять местами"
              title="Поменять местами"
              className="stock-swap"
              onClick={() => {
                setFrom(to);
                setTo(from);
              }}
              icon={<ArrowLeftRight />}
            />
            <Field label="Куда">{placeSelect(to, (v) => { setTo(v); if (v === from) setFrom(to); })}</Field>
            <Field label="Комментарий">
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder={to === 'shop' ? 'Пополнение магазина' : 'Возврат на склад'} />
            </Field>
          </>
        ) : kind === 'income' ? (
          <>
            <Field label="Куда">{placeSelect(to, setTo)}</Field>
            <Field label="Основание" error={tried && !comment.trim() ? 'Нужно основание' : undefined}>
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Накладная № 418 от ЮгХимОпт" />
            </Field>
          </>
        ) : (
          <>
            <Field label="Откуда списываем">{placeSelect(from, setFrom)}</Field>
            <Field label="Комментарий">
              <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: разбита коробка при разгрузке" />
            </Field>
          </>
        )}
      </div>

      <ProductPicker autoFocus onPick={(p, pk) => add(p, pk.key)} location={source ?? target} />

      {rows.length === 0 ? (
        <div className="stock-doc-empty">
          <EmptyState icon={<ScanBarcode />} title="Строк пока нет">
            Отсканируйте штрихкод или найдите товар по названию. Штрихкод коробки добавит коробку
          </EmptyState>
        </div>
      ) : (
        <div className="stock-doc-lines">
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Товар</th>
                <th style={{ width: 140 }}>Упаковка</th>
                <th style={{ width: 120 }}>Количество</th>
                <th className="num" style={{ width: 90 }}>
                  Штук
                </th>
                {source ? (
                  <th className="num" style={{ width: 96 }} title={`Свободно ${source === 'shop' ? 'в магазине' : 'на складе'}: факт минус резерв`}>
                    Свободно
                  </th>
                ) : null}
                {kind === 'writeoff' ? <th style={{ width: 150 }}>Причина</th> : null}
                {kind === 'income' ? <th style={{ width: 150 }}>Годен до</th> : null}
                <th style={{ width: 44 }} aria-label="Убрать" />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ l, p, pk, qty, free, short }) => (
                <tr key={l.key}>
                  <td>
                    <div className="cell-title stock-doc-name">{p.name}</div>
                    <div className="cell-sub">
                      {p.sku}
                      {ix.brands.get(p.brandId) ? ` · ${ix.brands.get(p.brandId)!.name}` : ''}
                    </div>
                  </td>
                  <td>
                    <Select
                      size="sm"
                      value={l.pack}
                      onChange={(e) => patch(l.key, { pack: e.target.value as PackKey })}
                      options={p.packs.map((x) => ({ value: x.key, label: packLabel(x) }))}
                    />
                  </td>
                  <td>
                    <QtyInput value={l.packQty} min={1} onChange={(v) => patch(l.key, { packQty: Math.max(1, v) })} />
                  </td>
                  <td className="num w-700">{pk.qty > 1 ? <span title={`${l.packQty} × ${pk.qty}`}>= {fmt.qty(qty)}</span> : fmt.qty(qty)}</td>
                  {source ? <td className={short ? 'num c-bad w-700' : 'num muted'}>{fmt.num(free)}</td> : null}
                  {kind === 'writeoff' ? (
                    <td>
                      <Select
                        size="sm"
                        value={l.reason}
                        placeholder="Причина"
                        className={tried && !l.reason ? 'is-invalid' : undefined}
                        onChange={(e) => patch(l.key, { reason: e.target.value as WriteoffReason })}
                        options={(Object.keys(WRITEOFF_REASONS) as WriteoffReason[]).map((k) => ({ value: k, label: WRITEOFF_REASONS[k] }))}
                      />
                    </td>
                  ) : null}
                  {kind === 'income' ? (
                    <td>{p.expiryTracked ? <Input size="sm" type="date" value={l.expiry} onChange={(e) => patch(l.key, { expiry: e.target.value })} aria-label="Годен до" /> : <span className="faint">—</span>}</td>
                  ) : null}
                  <td>
                    <Button variant="ghost" size="sm" iconOnly aria-label="Убрать строку" title="Убрать строку" icon={<X />} onClick={() => remove(l.key)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasShort ? (
        <Notice tone="warn">
          {placeName(source)}: свободного товара меньше, чем в документе. Резерв под заказы {kind === 'writeoff' ? 'списать' : 'переместить'} нельзя — уменьшите количество или снимите резерв в заказе
        </Notice>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}
