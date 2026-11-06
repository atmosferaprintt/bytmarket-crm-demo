/* Новый товар и правка карточки: широкое окно, единицы продажи повторяющимися строками. */
import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { PackKey, Product } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { isEan13 } from '../../data/codes';
import { useSession } from '../../roles/session';
import { Button, Checkbox, Field, Input, Modal, MoneyInput, Notice, Select, cx, fmt, toast } from '../../ui';
import { PACK_NAME, barcodeIndex, categoryOptions, markupPct, minAllowedPrice, pct1 } from './lib';

interface PackRow {
  key: PackKey;
  qty: number | '';
  barcode: string;
}

interface FormState {
  name: string;
  brandId: string;
  categoryId: string;
  groupId: string;
  variant: string;
  volume: string;
  weightG: number | '';
  scent: string;
  packs: PackRow[];
  retail: number | '';
  wholesale: number | '';
  cost: number | '';
  minStock: number | '';
  supplierIds: string[];
  expiryTracked: boolean;
  marking: boolean;
  active: boolean;
}

function fromProduct(p?: Product): FormState {
  if (!p)
    return {
      name: '',
      brandId: '',
      categoryId: '',
      groupId: '',
      variant: '',
      volume: '',
      weightG: '',
      scent: '',
      packs: [
        { key: 'pcs', qty: 1, barcode: '' },
        { key: 'box', qty: '', barcode: '' },
      ],
      retail: '',
      wholesale: '',
      cost: '',
      minStock: '',
      supplierIds: [],
      expiryTracked: false,
      marking: false,
      active: true,
    };
  return {
    name: p.name,
    brandId: p.brandId,
    categoryId: p.categoryId,
    groupId: p.groupId ?? '',
    variant: p.variant ?? '',
    volume: p.volume ?? '',
    weightG: p.weightG ?? '',
    scent: p.scent ?? '',
    packs: p.packs.map((x) => ({ key: x.key, qty: x.qty, barcode: x.barcode })),
    retail: p.retailPrice,
    wholesale: p.wholesalePrice,
    cost: p.cost ?? '',
    minStock: p.minStock,
    supplierIds: [...p.supplierIds],
    expiryTracked: p.expiryTracked,
    marking: p.marking,
    active: p.active,
  };
}

const numOrEmpty = (s: string): number | '' => {
  const d = s.replace(/[^\d]/g, '');
  return d === '' ? '' : Number(d);
};
const orNull = (s: string): string | null => (s.trim() ? s.trim() : null);

export default function ProductForm({ product, onClose, onSaved }: { product?: Product; onClose: () => void; onSaved: (id: string) => void }) {
  const db = useDB();
  const version = useDBVersion();
  const { me, can } = useSession();
  const seeCost = can('seeCost');
  const [f, setF] = useState<FormState>(() => fromProduct(product));
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setF((s) => ({ ...s, [k]: v }));
    setError(null);
  };

  const brands = useMemo(() => db.brands.map((b) => ({ value: b.id, label: b.name })).sort((a, b) => a.label.localeCompare(b.label, 'ru')), [db, version]);
  const cats = useMemo(() => categoryOptions(db, true), [db, version]);
  const groups = useMemo(
    () =>
      db.groups
        .filter((g) => !f.brandId || g.brandId === f.brandId)
        .map((g) => ({ value: g.id, label: g.name }))
        .sort((a, b) => a.label.localeCompare(b.label, 'ru')),
    [db, version, f.brandId],
  );
  const barcodes = barcodeIndex(db);

  /* проверки по строкам упаковок */
  const packErrors = f.packs.map((pk, i) => {
    const errs: { qty?: string; barcode?: string } = {};
    if (pk.key !== 'pcs') {
      if (pk.qty === '' || pk.qty < 2) errs.qty = 'Не меньше 2 шт';
      else if (f.packs.some((o, j) => j !== i && o.key !== 'pcs' && o.qty === pk.qty)) errs.qty = 'Такая упаковка уже есть';
    }
    const code = pk.barcode.trim();
    if (code) {
      if (!/^\d{13}$/.test(code)) errs.barcode = 'Нужно 13 цифр';
      else if (!isEan13(code)) errs.barcode = 'Неверная контрольная цифра';
      else {
        const owner = barcodes.get(code);
        if (owner && owner.id !== product?.id) errs.barcode = `Уже есть у товара «${owner.name}»`;
        else if (f.packs.some((o, j) => j < i && o.barcode.trim() === code)) errs.barcode = 'Повторяется в этом товаре';
      }
    }
    return errs;
  });
  const packsBad = packErrors.some((e) => e.qty || e.barcode);
  const usedKeys = new Set(f.packs.map((x) => x.key));

  const retail = f.retail === '' ? null : f.retail;
  const wholesale = f.wholesale === '' ? null : f.wholesale;
  const cost = f.cost === '' ? null : f.cost;
  const minPrice = minAllowedPrice(cost, db.settings.minMarginPct);
  const wholesaleHigh = retail !== null && wholesale !== null && wholesale > retail;
  const belowMargin = minPrice !== null && ((wholesale !== null && wholesale < minPrice) || (retail !== null && retail < minPrice));

  const missing: string[] = [];
  if (!f.name.trim()) missing.push('название');
  if (!f.brandId) missing.push('бренд');
  if (!f.categoryId) missing.push('категорию');
  if (retail === null) missing.push('розничную цену');

  const addPack = () => {
    const key: PackKey = usedKeys.has('pack') ? 'box' : usedKeys.has('box') ? 'pack' : 'pack';
    set('packs', [...f.packs, { key, qty: '', barcode: '' }]);
  };
  const setPack = (i: number, patch: Partial<PackRow>) => set('packs', f.packs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const removePack = (i: number) => set('packs', f.packs.filter((_, j) => j !== i));

  const save = () => {
    setTried(true);
    setError(null);
    if (missing.length) {
      setError(`Заполните ${missing.join(', ')}`);
      return;
    }
    if (packsBad) {
      setError('Проверьте единицы продажи: в строках есть ошибки');
      return;
    }
    if (wholesaleHigh) {
      setError('Оптовая цена выше розничной. Опт должен быть не дороже розницы');
      return;
    }
    const order: Record<PackKey, number> = { pcs: 0, pack: 1, box: 2 };
    const packs = [...f.packs]
      .sort((a, b) => order[a.key] - order[b.key])
      .map((x) => ({ key: x.key, qty: x.key === 'pcs' ? 1 : Number(x.qty), barcode: x.barcode.trim() }));
    const data = {
      name: f.name.trim(),
      brandId: f.brandId,
      categoryId: f.categoryId,
      groupId: f.groupId || null,
      variant: orNull(f.variant),
      volume: orNull(f.volume),
      weightG: f.weightG === '' ? null : f.weightG,
      scent: orNull(f.scent),
      retailPrice: retail!,
      wholesalePrice: wholesale ?? retail!,
      minStock: f.minStock === '' ? 0 : f.minStock,
      supplierIds: f.supplierIds,
      expiryTracked: f.expiryTracked,
      marking: f.marking,
      active: f.active,
      ...(seeCost ? { cost } : {}),
    };
    if (!product) {
      const r = dispatch('product.create', { ...data, packs }, me.id);
      if (!r.ok) return setError(r.error);
      toast('Товар добавлен в каталог');
      onSaved(r.id ?? '');
      return;
    }
    // в правке отправляем только изменённое: история цен и упаковок пишется только при изменении
    const patch: Record<string, unknown> = {};
    const p = product;
    if (data.name !== p.name) patch.name = data.name;
    if (data.brandId !== p.brandId) patch.brandId = data.brandId;
    if (data.categoryId !== p.categoryId) patch.categoryId = data.categoryId;
    if (data.groupId !== p.groupId) patch.groupId = data.groupId;
    if (data.variant !== p.variant) patch.variant = data.variant;
    if (data.volume !== p.volume) patch.volume = data.volume;
    if (data.weightG !== p.weightG) patch.weightG = data.weightG;
    if (data.scent !== p.scent) patch.scent = data.scent;
    if (data.retailPrice !== p.retailPrice) patch.retailPrice = data.retailPrice;
    if (data.wholesalePrice !== p.wholesalePrice) patch.wholesalePrice = data.wholesalePrice;
    if (seeCost && cost !== p.cost) patch.cost = cost;
    if (data.minStock !== p.minStock) patch.minStock = data.minStock;
    if (data.supplierIds.join('|') !== p.supplierIds.join('|')) patch.supplierIds = data.supplierIds;
    if (data.expiryTracked !== p.expiryTracked) patch.expiryTracked = data.expiryTracked;
    if (data.marking !== p.marking) patch.marking = data.marking;
    if (data.active !== p.active) patch.active = data.active;
    const packsChanged = JSON.stringify(packs) !== JSON.stringify(p.packs.map((x) => ({ key: x.key, qty: x.qty, barcode: x.barcode })));
    if (packsChanged) patch.packs = packs;
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    const r = dispatch('product.update', { productId: p.id, patch }, me.id);
    if (!r.ok) return setError(r.error);
    toast(patch.retailPrice !== undefined || patch.wholesalePrice !== undefined ? 'Карточка сохранена, новая цена записана в историю' : 'Карточка сохранена');
    onSaved(p.id);
  };

  return (
    <Modal
      wide
      title={product ? 'Изменить товар' : 'Новый товар'}
      sub={product ? `${product.sku} · проведённые чеки и заказы не меняются` : undefined}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={save}>
            {product ? 'Сохранить' : 'Добавить товар'}
          </Button>
        </>
      }
    >
      <div className="prd-form">
        <div className="prd-form-sec" data-hint="products.form-main">
          <h3 className="prd-block-title">Товар</h3>
          <Field label="Название" error={tried && !f.name.trim() ? 'Укажите название' : undefined}>
            <Input autoFocus value={f.name} invalid={tried && !f.name.trim()} placeholder="Fairy «Сочный лимон», средство для посуды, 450 мл" onChange={(e) => set('name', e.target.value)} />
          </Field>
          <div className="prd-form-grid-3">
            <Field label="Бренд" error={tried && !f.brandId ? 'Выберите бренд' : undefined}>
              <Select
                placeholder="Выберите"
                options={brands}
                value={f.brandId}
                onChange={(e) => setF((s) => ({ ...s, brandId: e.target.value, groupId: db.groups.find((g) => g.id === s.groupId)?.brandId === e.target.value ? s.groupId : '' }))}
              />
            </Field>
            <Field label="Категория" error={tried && !f.categoryId ? 'Выберите категорию' : undefined}>
              <Select placeholder="Выберите" options={cats} value={f.categoryId} onChange={(e) => set('categoryId', e.target.value)} />
            </Field>
            <Field label="Группа вариантов">
              <Select
                placeholder="Без группы"
                options={groups}
                value={f.groupId}
                onChange={(e) => {
                  const g = db.groups.find((x) => x.id === e.target.value);
                  setF((s) => ({ ...s, groupId: e.target.value, brandId: g?.brandId ?? s.brandId, categoryId: s.categoryId || g?.categoryId || '' }));
                }}
              />
            </Field>
          </div>
        </div>

        <div className="prd-form-sec">
          <h3 className="prd-block-title">Характеристики</h3>
          <div className="prd-form-grid-4">
            <Field label="Вариант">
              <Input value={f.variant} placeholder="450 мл · Лимон" onChange={(e) => set('variant', e.target.value)} />
            </Field>
            <Field label="Объём">
              <Input value={f.volume} placeholder="450 мл" onChange={(e) => set('volume', e.target.value)} />
            </Field>
            <Field label="Вес, г">
              <Input inputMode="numeric" className="num" value={f.weightG === '' ? '' : String(f.weightG)} placeholder="490" onChange={(e) => set('weightG', numOrEmpty(e.target.value))} />
            </Field>
            <Field label="Аромат">
              <Input value={f.scent} placeholder="Лимон" onChange={(e) => set('scent', e.target.value)} />
            </Field>
          </div>
        </div>

        <div className="prd-form-sec" data-hint="products.form-packs">
          <div className="prd-block-head">
            <h3 className="prd-block-title">Единицы продажи</h3>
            <span className="muted t-12">Учёт ведётся в штуках: коробка 24 шт списывает 24 шт</span>
          </div>
          <div className="prd-packs">
            <div className="prd-pack-row prd-pack-head t-12 muted w-600">
              <span>Единица</span>
              <span>Штук в единице</span>
              <span>Штрихкод EAN-13</span>
              <span />
            </div>
            {f.packs.map((pk, i) => (
              <div key={i} className="prd-pack-row">
                {pk.key === 'pcs' ? (
                  <div className="prd-pack-fixed">Штука</div>
                ) : (
                  <Select
                    aria-label="Единица"
                    options={(['pack', 'box'] as const).map((k) => ({ value: k, label: PACK_NAME[k], disabled: k !== pk.key && usedKeys.has(k) }))}
                    value={pk.key}
                    onChange={(e) => setPack(i, { key: e.target.value as PackKey })}
                  />
                )}
                <Field error={packErrors[i].qty && (tried || pk.qty !== '') ? packErrors[i].qty : undefined}>
                  {pk.key === 'pcs' ? (
                    <div className="prd-pack-fixed is-num">1</div>
                  ) : (
                    <Input
                      aria-label="Штук в единице"
                      inputMode="numeric"
                      className="num"
                      value={pk.qty === '' ? '' : String(pk.qty)}
                      invalid={!!packErrors[i].qty && (tried || pk.qty !== '')}
                      placeholder={pk.key === 'pack' ? '6' : '24'}
                      onChange={(e) => setPack(i, { qty: numOrEmpty(e.target.value) })}
                    />
                  )}
                </Field>
                <Field error={packErrors[i].barcode}>
                  <Input
                    aria-label="Штрихкод"
                    inputMode="numeric"
                    value={pk.barcode}
                    invalid={!!packErrors[i].barcode}
                    placeholder="Пусто — присвоим свой код"
                    onChange={(e) => setPack(i, { barcode: e.target.value.replace(/[^\d]/g, '').slice(0, 13) })}
                  />
                </Field>
                {pk.key === 'pcs' ? <span /> : <Button variant="ghost" size="sm" iconOnly icon={<Trash2 />} aria-label="Убрать единицу" onClick={() => removePack(i)} />}
              </div>
            ))}
          </div>
          {f.packs.length < 3 ? (
            <div>
              <Button variant="ghost" size="sm" icon={<Plus />} onClick={addPack}>
                {usedKeys.has('pack') ? 'Добавить коробку' : 'Добавить упаковку'}
              </Button>
            </div>
          ) : null}
        </div>

        <div className="prd-form-sec" data-hint="products.form-prices">
          <h3 className="prd-block-title">Цены за штуку</h3>
          <div className={cx(seeCost ? 'prd-form-grid-4' : 'prd-form-grid-3')}>
            <Field label="Розница" error={tried && retail === null ? 'Укажите цену' : undefined}>
              <MoneyInput value={f.retail} invalid={tried && retail === null} onChange={(v) => set('retail', v)} />
            </Field>
            <Field label="Опт" error={wholesaleHigh ? 'Дороже розницы' : undefined}>
              <MoneyInput value={f.wholesale} invalid={wholesaleHigh} placeholder={retail !== null ? String(retail) : undefined} onChange={(v) => set('wholesale', v)} />
            </Field>
            {seeCost ? (
              <Field label="Себестоимость">
                <MoneyInput value={f.cost} placeholder="Не знаем" onChange={(v) => set('cost', v)} />
              </Field>
            ) : null}
            {seeCost ? (
              <div className="field">
                <span className="field-label">Наценка опт / розница</span>
                <div className="prd-pack-fixed num">
                  {cost !== null && (wholesale ?? retail) !== null ? `${pct1(markupPct((wholesale ?? retail)!, cost))} / ${pct1(markupPct(retail ?? 0, cost))}` : '—'}
                </div>
              </div>
            ) : null}
          </div>
          {seeCost && belowMargin ? (
            <Notice tone="warn">
              Цена ниже себестоимости плюс {db.settings.minMarginPct}&nbsp;% — нужно не меньше {fmt.price(minPrice)}. Сохранить можно, но проверьте цену.
            </Notice>
          ) : null}
        </div>

        <div className="prd-form-sec" data-hint="products.form-stock">
          <h3 className="prd-block-title">Склад и учёт</h3>
          <div className="prd-form-grid-4">
            <Field label="Минимальный остаток, шт">
              <Input inputMode="numeric" className="num" value={f.minStock === '' ? '' : String(f.minStock)} placeholder="0" onChange={(e) => set('minStock', numOrEmpty(e.target.value))} />
            </Field>
          </div>
          <div>
            <div className="field-label" style={{ marginBottom: 8 }}>
              Поставщики
            </div>
            <div className="prd-suppliers">
              {db.suppliers.map((s) => (
                <Checkbox
                  key={s.id}
                  checked={f.supplierIds.includes(s.id)}
                  onChange={(v) => set('supplierIds', v ? [...f.supplierIds, s.id] : f.supplierIds.filter((x) => x !== s.id))}
                >
                  {s.name}
                </Checkbox>
              ))}
            </div>
          </div>
          <div className="prd-flags">
            <Checkbox checked={f.expiryTracked} onChange={(v) => set('expiryTracked', v)}>
              Учитывать партии и сроки годности
            </Checkbox>
            <Checkbox checked={f.marking} onChange={(v) => set('marking', v)}>
              Подлежит маркировке
            </Checkbox>
            <Checkbox checked={f.active} onChange={(v) => set('active', v)}>
              Продаётся
            </Checkbox>
          </div>
        </div>

        {error ? <Notice tone="bad">{error}</Notice> : null}
      </div>
    </Modal>
  );
}
