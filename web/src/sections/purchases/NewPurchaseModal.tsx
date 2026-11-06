/* Новая закупка: поставщик, строки в коробках поставщика, цена, сумма, ожидаемая дата по сроку поставки.
   Подтверждает закупку владелец: прямо здесь — галочкой, или позже в карточке закупки. */
import { useMemo, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { ID, LocationKey, Product } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { purchaseSuggestion } from '../../data/ops';
import { indexes, stockIndex } from '../../data/selectors';
import { get } from '../../data/idx';
import { plusDays } from '../../data/dates';
import { useSession } from '../../roles/session';
import { useOpenEntity } from '../../shell/entities';
import { Button, Checkbox, EmptyState, Field, Input, Modal, MoneyInput, Notice, QtyInput, Select, fmt, toast } from '../../ui';
import { ProductPicker } from '../stock/ProductPicker';
import { LOCATION_OPTIONS, boxPack } from '../stock/calc';
import { act } from '../stock/act';
import './purchases.css';

export interface NewPurchaseLine {
  productId: ID;
  boxes: number;
  boxSize?: number;
  price?: number;
}

interface Line {
  productId: ID;
  boxes: number;
  boxSize: number;
  price: number | '';
}

const priceOf = (p: Product): number => Math.max(1, Math.round(p.cost ?? p.wholesalePrice * 0.7));

export function NewPurchaseModal({ supplierId, lines: preset, onClose }: { supplierId?: ID; lines?: NewPurchaseLine[]; onClose: () => void }) {
  const db = useDB();
  const version = useDBVersion();
  const { me, can } = useSession();
  const open = useOpenEntity();
  const ix = indexes(db);
  const suppliers = db.suppliers;
  const [sid, setSid] = useState<ID>(supplierId ?? suppliers[0]?.id ?? '');
  const supplier = ix.suppliers.get(sid);
  const [expected, setExpected] = useState(plusDays(db.meta.today, supplier?.leadDays ?? 3));
  const [location, setLocation] = useState<LocationKey>('warehouse');
  const [comment, setComment] = useState('');
  const [approve, setApprove] = useState(can('approvePurchase'));
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>(() =>
    (preset ?? []).map((l) => {
      const p = ix.products.get(l.productId)!;
      return { productId: l.productId, boxes: l.boxes, boxSize: l.boxSize ?? boxPack(p).qty, price: l.price ?? priceOf(p) };
    }),
  );

  const changeSupplier = (v: ID) => {
    setSid(v);
    const s = ix.suppliers.get(v);
    setExpected(plusDays(db.meta.today, s?.leadDays ?? 3));
    setLines((ls) => ls.filter((l) => ix.products.get(l.productId)?.supplierIds.includes(v)));
  };

  const fromSuggestion = () => {
    const sug = purchaseSuggestion(db, sid);
    if (!sug.length) return toast('По этому поставщику пополнять нечего', 'info');
    setLines((ls) => {
      const have = new Set(ls.map((l) => l.productId));
      return [...ls, ...sug.filter((x) => !have.has(x.productId)).map((x) => ({ productId: x.productId, boxes: x.boxes, boxSize: x.boxSize, price: x.price }))];
    });
  };

  const add = (p: Product) => {
    setError(null);
    setLines((ls) => {
      const i = ls.findIndex((l) => l.productId === p.id);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, boxes: l.boxes + 1 } : l));
      return [...ls, { productId: p.id, boxes: 1, boxSize: boxPack(p).qty, price: priceOf(p) }];
    });
  };
  const patch = (pid: ID, v: Partial<Line>) => setLines((ls) => ls.map((l) => (l.productId === pid ? { ...l, ...v } : l)));

  const si = stockIndex(db);
  const total = lines.reduce((s, l) => s + l.boxes * l.boxSize * (Number(l.price) || 0), 0);
  const boxes = lines.reduce((s, l) => s + l.boxes, 0);
  const qty = lines.reduce((s, l) => s + l.boxes * l.boxSize, 0);
  const belowMin = supplier && supplier.minOrder > 0 && total > 0 && total < supplier.minOrder;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const filter = useMemo(() => (p: Product) => p.supplierIds.includes(sid), [sid, version]);

  const submit = () => {
    setError(null);
    if (!supplier) return setError('Выберите поставщика');
    if (!lines.length) return setError('Добавьте товары в закупку');
    if (lines.some((l) => !l.price)) return setError('Укажите закупочную цену в каждой строке');
    const r = act(
      'purchase.create',
      {
        supplierId: sid,
        expectedAt: expected,
        location,
        comment: comment.trim() || undefined,
        lines: lines.map((l) => ({ productId: l.productId, boxes: l.boxes, boxSize: l.boxSize, price: Number(l.price) })),
      },
      me.id,
    );
    if (!r.ok) return setError(r.error);
    const id = r.id!;
    let msg = `Закупка № ${get(db, 'purchases', id)?.number ?? ''} создана`;
    if (approve) {
      const a = act('purchase.approve', { purchaseId: id, expectedAt: expected }, me.id);
      if (!a.ok) {
        toast(`${msg}, но не подтверждена: ${a.error}`, 'error');
        onClose();
        open('purchase', id);
        return;
      }
      msg += ' и подтверждена';
    } else msg += ' черновиком';
    toast(r.info ? `${msg}. ${r.info}` : msg);
    onClose();
    open('purchase', id);
  };

  return (
    <Modal
      wide
      title="Новая закупка"
      onClose={onClose}
      footer={
        <>
          <span className="stock-doc-total">
            {fmt.count(lines.length, 'позиция', 'позиции', 'позиций')} · {fmt.count(boxes, 'коробка', 'коробки', 'коробок')} · {fmt.qty(qty)} · {fmt.money(total)}
          </span>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={submit} disabled={!lines.length}>
            {approve ? 'Создать и подтвердить' : 'Создать закупку'}
          </Button>
        </>
      }
    >
      <div className="pur-new-head" data-hint="purchases.new-head">
        <Field label="Поставщик">
          <Select value={sid} onChange={(e) => changeSupplier(e.target.value)} options={suppliers.map((s) => ({ value: s.id, label: s.name }))} />
        </Field>
        <Field label="Ожидаем">
          <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
        </Field>
        <Field label="Куда">
          <Select value={location} onChange={(e) => setLocation(e.target.value as LocationKey)} options={LOCATION_OPTIONS} />
        </Field>
      </div>
      {supplier ? (
        <div className="row">
          <span className="t-13 ink-2">
            Срок поставки {fmt.count(supplier.leadDays, 'день', 'дня', 'дней')} · наша отсрочка {supplier.deferDays ? fmt.count(supplier.deferDays, 'день', 'дня', 'дней') : 'нет, предоплата'}
            {supplier.minOrder ? ` · минимальный заказ ${fmt.money(supplier.minOrder)}` : ''}
          </span>
          <span className="spacer" />
          <Button size="sm" variant="ghost" icon={<Sparkles />} onClick={fromSuggestion} data-hint="purchases.new-suggest">
            Добавить по предложению
          </Button>
        </div>
      ) : null}

      <ProductPicker
        autoFocus
        hint="purchases.new-scan"
        filter={filter}
        onPick={(p) => add(p)}
        placeholder="Товар этого поставщика: название, артикул или штрихкод"
        extra={(p) => `Доступно ${fmt.num(si.get(p.id)?.total.available ?? 0)} · в коробке ${boxPack(p).qty}`}
      />

      {lines.length === 0 ? (
        <div className="stock-doc-empty">
          <EmptyState title="Строк пока нет">Найдите товар или нажмите «Добавить по предложению» — подставим то, что заканчивается</EmptyState>
        </div>
      ) : (
        <div className="stock-doc-lines" data-hint="purchases.new-lines">
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Товар</th>
                <th className="num" style={{ width: 90 }}>
                  Доступно
                </th>
                <th className="num" style={{ width: 90 }}>
                  В коробке
                </th>
                <th style={{ width: 120 }}>Коробок</th>
                <th className="num" style={{ width: 80 }}>
                  Штук
                </th>
                <th style={{ width: 120, minWidth: 110 }}>Цена за шт</th>
                <th className="num" style={{ width: 110 }}>
                  Сумма
                </th>
                <th style={{ width: 44 }} aria-label="Убрать" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => {
                const p = ix.products.get(l.productId)!;
                return (
                  <tr key={l.productId}>
                    <td>
                      <div className="cell-title stock-doc-name pur-line-name">{p.name}</div>
                      <div className="cell-sub">{p.sku}</div>
                    </td>
                    <td className="num muted">{fmt.num(si.get(p.id)?.total.available ?? 0)}</td>
                    <td className="num">{fmt.num(l.boxSize)}</td>
                    <td>
                      <QtyInput value={l.boxes} min={1} onChange={(v) => patch(l.productId, { boxes: Math.max(1, v) })} />
                    </td>
                    <td className="num w-700">{fmt.num(l.boxes * l.boxSize)}</td>
                    <td>
                      <MoneyInput size="sm" value={l.price} onChange={(v) => patch(l.productId, { price: v })} invalid={!l.price} />
                    </td>
                    <td className="num w-600">{fmt.money(l.boxes * l.boxSize * (Number(l.price) || 0))}</td>
                    <td>
                      <Button variant="ghost" size="sm" iconOnly aria-label="Убрать строку" icon={<X />} onClick={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Field label="Комментарий">
        <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Например: под акцию «Осенняя стирка»" />
      </Field>
      {can('approvePurchase') ? (
        <span data-hint="purchases.new-approve" style={{ alignSelf: 'flex-start' }}>
          <Checkbox checked={approve} onChange={setApprove}>
            Подтверждаю закупку как владелец — сразу отправить поставщику
          </Checkbox>
        </span>
      ) : null}
      {belowMin ? <Notice tone="warn">До минимального заказа поставщика не хватает {fmt.money(supplier!.minOrder - total)}</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}
