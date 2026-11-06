/* Новая акция: цель (товары, категория, бренд), скидка, даты, аудитория, проверка минимальной наценки. */
import { useMemo, useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import type { Promo } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { plusDays } from '../../data/dates';
import { useSession } from '../../roles/session';
import { Button, Field, Input, Modal, MoneyInput, Notice, SearchInput, Segmented, Select, fmt, toast } from '../../ui';
import { catalogRows, categoryOptions, promoMarginIssues, promoProducts, promoPrice, safePromoPct, safePromoPrice } from './lib';

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
  const seeCost = can('seeCost');
  const issues = useMemo(() => (v > 0 && seeCost ? promoMarginIssues(db, affected, { kind, value: v, audience }) : []), [db, affected, kind, v, audience, seeCost]);
  // безопасная скидка: наценка ни у одного товара акции не падает ниже минимальной (для «Все покупатели» — и в рознице, и в опте)
  const safePct = useMemo(() => (seeCost && kind === 'percent' && affected.length ? safePromoPct(db, affected, audience) : null), [db, affected, kind, audience, seeCost]);
  const safePrice = useMemo(() => (seeCost && kind === 'price' && affected.length ? safePromoPrice(db, affected) : null), [db, affected, kind, seeCost]);

  /** Убрать из акции товары, где наценка падает ниже минимальной. Категорию или бренд превращаем в список товаров без них. */
  const dropIssues = () => {
    const bad = new Set(issues.map((i) => i.product.id));
    const keep = affected.filter((p) => !bad.has(p.id)).map((p) => p.id);
    if (!keep.length) {
      setError('Если убрать эти товары, в акции ничего не останется. Лучше уменьшить скидку');
      return;
    }
    setType('products');
    setIds(keep);
    setError(null);
    toast(`Убрали ${fmt.count(bad.size, 'товар', 'товара', 'товаров')}: в акции ${fmt.count(keep.length, 'товар', 'товара', 'товаров')}`);
  };
  // «цена» ничего не меняет, если обычная цена и так не выше: для «Все покупатели» — ни в рознице, ни в опте
  const noEffect =
    kind === 'price' && v > 0
      ? affected.filter((p) => {
          const bases = audience === 'retail' ? [p.retailPrice] : audience === 'wholesale' ? [p.wholesalePrice] : [p.retailPrice, p.wholesalePrice];
          return bases.every((b) => promoPrice({ kind, value: v }, b) >= b);
        }).length
      : 0;

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
          <Button variant="primary" onClick={save} data-hint="products.promo-save">
            Создать акцию
          </Button>
        </>
      }
    >
      <div className="prd-form">
        <div data-hint="products.promo-name">
          <Field label="Название">
            <Input autoFocus value={name} placeholder="Осенняя стирка" onChange={(e) => setName(e.target.value)} />
          </Field>
        </div>

        <div className="prd-form-sec" data-hint="products.promo-target">
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
          <div data-hint="products.promo-value">
            <Field
              label={kind === 'percent' ? 'Скидка, %' : 'Цена за штуку'}
              hint={
                safePct !== null ? (
                  <span className="nowrap" title={`Наценка не падает ниже ${db.settings.minMarginPct} % ни у одного товара${audience === 'all' ? ' — ни в рознице, ни в опте' : ''}`}>
                    {safePct > 0 ? <>Безопасная скидка — до {safePct}&nbsp;%</> : 'Наценка у части товаров уже на минимуме'}
                  </span>
                ) : safePrice !== null ? (
                  <span className="nowrap" title={`Наценка не падает ниже ${db.settings.minMarginPct} % ни у одного товара`}>
                    Безопасная цена — от {fmt.price(safePrice)}
                  </span>
                ) : undefined
              }
            >
              {kind === 'percent' ? (
                <Input inputMode="numeric" className="num" value={value === '' ? '' : String(value)} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, '') === '' ? '' : Number(e.target.value.replace(/[^\d]/g, '')))} />
              ) : (
                <MoneyInput value={value} onChange={setValue} />
              )}
            </Field>
          </div>
          <Field label="С">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="По">
            <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>

        <div data-hint="products.promo-audience">
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
        </div>

        {target ? (
          <div data-hint="products.promo-check">
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
                          {i.prices.map((x) => `${x.priceType === 'retail' ? 'розница' : 'опт'} ${fmt.price(x.price)}`).join(', ')}, нужно не меньше {fmt.price(i.min)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  {issues.length > 5 ? <div>и ещё {fmt.count(issues.length - 5, 'товар', 'товара', 'товаров')}</div> : null}
                  <div className="prd-issues-foot">
                    <span className="grow">
                      Создать можно, но лучше {safePct !== null && safePct > 0 ? `дать скидку до ${safePct} %` : 'уменьшить скидку'} или убрать эти товары.
                    </span>
                    <Button size="sm" icon={<Trash2 />} onClick={dropIssues} data-hint="products.promo-drop">
                      Убрать эти товары
                    </Button>
                  </div>
                </>
              ) : noEffect ? (
                `У ${fmt.count(noEffect, 'товара', 'товаров', 'товаров')} цена и так ниже — для них акция ничего не меняет`
              ) : (
                'Наценка не падает ниже минимальной'
              )}
            </Notice>
          </div>
        ) : null}
        {error ? <Notice tone="bad">{error}</Notice> : null}
      </div>
    </Modal>
  );
}
