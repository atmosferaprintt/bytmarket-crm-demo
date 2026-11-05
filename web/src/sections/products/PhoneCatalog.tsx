/* Каталог на телефоне (представитель): карточки вместо таблицы, поиск сверху, категории таблетками. */
import { useMemo, useState } from 'react';
import { Tag } from 'lucide-react';
import { useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { Button, EmptyState, SearchInput, cx, fmt } from '../../ui';
import { catalogMode, catalogRows, type CatalogRow } from './lib';
import { LevelChip, PromoChip } from './bits';

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е');
const PAGE = 30;

export default function PhoneCatalog() {
  const db = useDB();
  const version = useDBVersion();
  const { role } = useSession();
  const open = useOpenEntity();
  const mode = catalogMode(role);
  const [q, setQ] = useState('');
  const [pill, setPill] = useState<string>('all');
  const [limit, setLimit] = useState(PAGE);

  const all = useMemo(() => catalogRows(db).filter((r) => r.p.active), [db, version]);
  const cats = useMemo(() => db.categories.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name, 'ru')), [db, version]);
  const promoOf = (r: CatalogRow) => (mode === 'seller' ? r.retail.promo : mode === 'sales' ? r.wholesale.promo ?? r.retail.promo : r.promo);

  const list = useMemo(() => {
    const tokens = norm(q.trim()).split(/\s+/).filter(Boolean);
    return all.filter((r) => {
      if (pill === 'promo' && !promoOf(r)) return false;
      if (pill !== 'all' && pill !== 'promo' && r.topCategoryId !== pill) return false;
      if (!tokens.length) return true;
      const s = norm(r.search);
      return tokens.every((t) => s.includes(t));
    });
  }, [all, q, pill, mode]);

  const pills = [{ id: 'all', name: 'Все' }, { id: 'promo', name: 'Акции' }, ...cats.map((c) => ({ id: c.id, name: c.name }))];

  return (
    <>
      <PageHeader section="products" />
      <div className="prd-m-top">
        <SearchInput
          size="lg"
          value={q}
          onChange={(v) => {
            setQ(v);
            setLimit(PAGE);
          }}
          placeholder="Товар, бренд или штрихкод"
        />
        <div className="prd-m-pills" role="radiogroup" aria-label="Категория">
          {pills.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={pill === p.id}
              className={cx('prd-m-pill', pill === p.id && 'is-active')}
              onClick={() => {
                setPill(p.id);
                setLimit(PAGE);
              }}
            >
              {p.id === 'promo' ? <Tag /> : null}
              {p.name}
            </button>
          ))}
        </div>
      </div>
      {list.length ? (
        <div className="prd-m-list">
          {list.slice(0, limit).map((r) => (
            <ProductCard key={r.p.id} row={r} mode={mode} promo={promoOf(r)} onOpen={() => open('product', r.p.id)} />
          ))}
          {list.length > limit ? (
            <Button size="lg" block onClick={() => setLimit((l) => l + PAGE)}>
              Показать ещё {fmt.num(Math.min(PAGE, list.length - limit))} из {fmt.num(list.length - limit)}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="card">
          <EmptyState title="Ничего не нашли">Проверьте название или выберите другую категорию</EmptyState>
        </div>
      )}
    </>
  );
}

function ProductCard({ row, mode, promo, onOpen }: { row: CatalogRow; mode: ReturnType<typeof catalogMode>; promo: CatalogRow['promo']; onOpen: () => void }) {
  const p = row.p;
  const seller = mode === 'seller';
  const info = seller ? row.retail : row.wholesale;
  const avail = seller ? row.stock.shop.available : row.stock.warehouse.available;
  const discounted = !!info.promo && info.price < info.base;
  return (
    <button type="button" className="card prd-m-card" onClick={onOpen}>
      <div className="prd-m-name">{p.name}</div>
      <div className="prd-m-meta">
        <span>{p.sku}</span>
        <span>{row.packs}</span>
      </div>
      <div className="prd-m-bottom">
        <div className="prd-m-col">
          <span className="prd-m-label">{seller ? 'Цена' : 'Опт за штуку'}</span>
          <span className="prd-m-price">
            {fmt.price(info.price)}
            {discounted ? <s className="prd-old">{fmt.price(info.base)}</s> : null}
          </span>
        </div>
        <div className="prd-m-col is-right">
          <span className="prd-m-label">{seller ? 'В магазине' : 'Доступно на складе'}</span>
          {avail > 0 ? <span className="prd-m-avail">{fmt.qty(avail)}</span> : <LevelChip level="out" />}
        </div>
      </div>
      {promo ? (
        <div className="prd-m-promo">
          <PromoChip promo={promo} />
          <span className="muted t-12">до {fmt.date(promo.end)}</span>
        </div>
      ) : null}
    </button>
  );
}
