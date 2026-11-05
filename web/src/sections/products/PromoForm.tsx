/* Новая акция: цель (товары, категория, бренд), скидка, даты, аудитория, проверка минимальной наценки. */
import { useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Promo } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { plusDays } from '../../data/dates';
import { useSession } from '../../roles/session';
import { Button, Field, Input, Modal, MoneyInput, Notice, SearchInput, Segmented, Select, fmt, toast } from '../../ui';
import { catalogRows, categoryOptions, promoMarginIssues, promoProducts, promoPrice } from './lib';

type TargetType = Promo['target']['type'];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');

export default function PromoForm({ onClose, onSaved }: { onClose: () => void; onSaved?: (id: string) => void }) {
  const db = useDB();
  const version = useDBVersion();
  const { me, can } = useSession();
  const today = db.meta.today;
  const [name, setName] = useState('');
  const [type, setType] = useState<TargetType>('products');
  const [ids, setIds] = useState<string[]>([]);
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId] = useState('');
  const [kind, setKind] = useState<Promo['kind']>('percent');
  const [value, setValue] = useState<number | ''>(10);
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(plusDays(today, 14));
  const [audience, setAudience] = useState<Promo['audience']>('all');
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rows = catalogRows(db);
  const found = useMemo(() => {
    const t = norm(q.trim());
    if (!t) return [];
    const tokens = t.split(/\s+/);
    const out = [];
    for (const r of rows) {
      if (!r.p.active || ids.includes(r.p.id)) continue;
      const s = norm(r.search);
      if (tokens.every((tok) => s.includes(tok))) out.push(r);
      if (out.length >= 6) break;
    }
    return out;
  }, [q, rows, ids]);

  const target: Promo['target'] | null =
    type === 'products' ? (ids.length ? { type, ids } : null) : type === 'category' ? (categoryId ? { type, id: categoryId } : null) : brandId ? { type, id: brandId } : null;
  const affected = useMemo(() => (target ? promoProducts(db, target, audience).filter((p) => p.active) : []), [db, version, JSON.stringify(target), audience]);
  const v = value === '' ? 0 : value;
  const issues = useMemo(() => (v > 0 && can('seeCost') ? promoMarginIssues(db, affected, { kind, value: v, audience }) : []), [db, affected, kind, v, audience]);
  const noEffect = kind === 'price' && v > 0 ? affected.filter((p) => promoPrice({ kind, value: v }, audience === 'wholesale' ? p.wholesalePrice : p.retailPrice) >= (audience === 'wholesale' ? p.wholesalePrice : p.retailPrice)).length : 0;

  const save = () => {
    setError(null);
    if (!name.trim()) return setError('Назовите акцию: её увидят продавцы и представители');
    if (!target) return setError(type === 'products' ? 'Добавьте товары в акцию' : type === 'category' ? 'Выберите категорию' : 'Выберите бренд');
    if (!v) return setError(kind === 'percent' ? 'Укажите процент скидки' : 'Укажите цену по акции');
    if (kind === 'percent' && v > 90) return setError('Скидка по акции — не больше 90 %');
    if (end < start) return setError('Акция заканчивается раньше, чем начинается');
    const r = dispatch('promo.create', { name: name.trim(), target, kind, value: v, start, end, audience }, me.id);
    if (!r.ok) return setError(r.error);
    toast(start <= today ? 'Акция запущена — товары отмечены в каталоге' : `Акция начнётся ${fmt.date(start)}`);
    onSaved?.(r.id ?? '');
    onClose();
  };

  const prodName = (id: string) => rows.find((r) => r.p.id === id)?.p.name ?? id;

  return (
    <Modal
      wide
      title="Новая акция"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={save}>
            Создать акцию
          </Button>
        </>
      }
    >
      <div className="prd-form">
        <Field label="Название">
          <Input autoFocus value={name} placeholder="Осенняя стирка" onChange={(e) => setName(e.target.value)} />
        </Field>

        <div className="prd-form-sec">
          <div className="prd-block-head">
            <h3 className="prd-block-title">На что действует</h3>
            <Segmented
              value={type}
              onChange={setType}
              options={[
                { value: 'products', label: 'Товары' },
                { value: 'category', label: 'Категория' },
                { value: 'brand', label: 'Бренд' },
              ]}
            />
          </div>
          {type === 'products' ? (
            <div className="prd-picker">
              <SearchInput value={q} onChange={setQ} placeholder="Найти товар по названию, артикулу или штрихкоду" />
              {found.length ? (
                <div className="prd-picker-list">
                  {found.map((r) => (
                    <button
                      key={r.p.id}
                      type="button"
                      className="prd-picker-row"
                      onClick={() => {
                        setIds((x) => [...x, r.p.id]);
                        setQ('');
                      }}
                    >
                      <Plus />
                      <span className="grow ellipsis">{r.p.name}</span>
                      <span className="muted num">{r.p.sku}</span>
                      <span className="num w-600">{fmt.price(r.p.retailPrice)}</span>
                    </button>
                  ))}
                </div>
              ) : q.trim() ? (
                <div className="muted t-13">Ничего не нашли — проверьте название или артикул</div>
              ) : null}
              {ids.length ? (
                <div className="prd-picked">
                  {ids.map((id) => (
                    <span key={id} className="prd-picked-item">
                      <span className="ellipsis">{prodName(id)}</span>
                      <button type="button" aria-label="Убрать из акции" onClick={() => setIds((x) => x.filter((y) => y !== id))}>
                        <X />
                      </button>
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          ) : type === 'category' ? (
            <Field label="Категория">
              <Select placeholder="Выберите категорию" options={categoryOptions(db)} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} />
            </Field>
          ) : (
            <Field label="Бренд">
              <Select
                placeholder="Выберите бренд"
                options={db.brands.map((b) => ({ value: b.id, label: b.name })).sort((a, b) => a.label.localeCompare(b.label, 'ru'))}
                value={brandId}
                onChange={(e) => setBrandId(e.target.value)}
              />
            </Field>
          )}
        </div>

        <div className="prd-form-grid-4">
          <Field label="Вид скидки">
            <Segmented
              value={kind}
              onChange={(k) => {
                setKind(k);
                setValue(k === 'percent' ? 10 : '');
              }}
              options={[
                { value: 'percent', label: 'Процент' },
                { value: 'price', label: 'Цена' },
              ]}
            />
          </Field>
          <Field label={kind === 'percent' ? 'Скидка, %' : 'Цена за штуку'}>
            {kind === 'percent' ? (
              <Input inputMode="numeric" className="num" value={value === '' ? '' : String(value)} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, '') === '' ? '' : Number(e.target.value.replace(/[^\d]/g, '')))} />
            ) : (
              <MoneyInput value={value} onChange={setValue} />
            )}
          </Field>
          <Field label="С">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="По">
            <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        <Field label="Для кого">
          <Segmented
            value={audience}
            onChange={setAudience}
            options={[
              { value: 'all', label: 'Все покупатели' },
              { value: 'retail', label: 'Розница' },
              { value: 'wholesale', label: 'Опт' },
            ]}
          />
        </Field>

        {target ? (
          <Notice tone={issues.length ? 'warn' : 'info'} title={`Акция коснётся ${fmt.count(affected.length, 'товара', 'товаров', 'товаров')}`}>
            {issues.length ? (
              <>
                <div>
                  У {fmt.count(issues.length, 'товара', 'товаров', 'товаров')} цена со скидкой ниже себестоимости плюс {db.settings.minMarginPct}&nbsp;%
                  {issues.some((i) => i.belowCost) ? ', у части — ниже себестоимости' : ''}:
                </div>
                <ul className="prd-issues">
                  {issues.slice(0, 5).map((i) => (
                    <li key={i.product.id}>
                      <span className="ellipsis">{i.product.name}</span>
                      <span className="num nowrap">
                        {i.priceType === 'retail' ? 'розница' : 'опт'} {fmt.price(i.price)}, нужно не меньше {fmt.price(i.min)}
                      </span>
                    </li>
                  ))}
                </ul>
                {issues.length > 5 ? <div>и ещё {fmt.count(issues.length - 5, 'товар', 'товара', 'товаров')}</div> : null}
                <div>Создать можно, но лучше уменьшить скидку или убрать эти товары.</div>
              </>
            ) : noEffect ? (
              `У ${fmt.count(noEffect, 'товара', 'товаров', 'товаров')} цена и так ниже — для них акция ничего не меняет`
            ) : (
              'Наценка не падает ниже минимальной'
            )}
          </Notice>
        ) : null}
        {error ? <Notice tone="bad">{error}</Notice> : null}
      </div>
    </Modal>
  );
}
