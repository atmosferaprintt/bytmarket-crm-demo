/* Каталог товаров: таблица на все позиции, карточка открывается сбоку. Макет products-A. */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { Button, DataTable, Select, STOCK_LEVEL, fmt, type Column, type FilterDef } from '../../ui';
import { categoryFamily } from '../../data/selectors';
import { catalogMode, catalogRows, promosToday, type CatalogMode, type CatalogRow, type StockLevel } from './lib';
import { LevelChip, PriceCell, PromoChip } from './bits';
import ProductForm from './ProductForm';

const LEVEL_ORDER: Record<StockLevel, number> = { out: 0, low: 1, ok: 2, inactive: 3 };

function nameCell(r: CatalogRow) {
  return (
    <span className="prd-name" title={r.p.name}>
      {r.p.name}
    </span>
  );
}

function stateFilter(mode: CatalogMode): FilterDef<CatalogRow> {
  if (mode === 'full')
    return {
      key: 'state',
      label: 'Состояние',
      showCounts: true,
      options: [
        { value: 'all', label: 'Все' },
        { value: 'low', label: 'Ниже минимума', test: (r) => r.level === 'low' },
        { value: 'out', label: 'Нет в наличии', test: (r) => r.level === 'out' },
        { value: 'promo', label: 'Акция', test: (r) => r.p.active && !!r.promo },
        { value: 'soon', label: 'Скоро срок', test: (r) => r.expirySoon },
        { value: 'idle', label: 'Без движения', test: (r) => r.idle },
        { value: 'off', label: 'Не продаются', test: (r) => !r.p.active },
      ],
    };
  const lvl = (r: CatalogRow) => (mode === 'seller' ? r.shopLevel : r.whLevel);
  const promo = (r: CatalogRow) => (mode === 'seller' ? r.retail.promo : r.wholesale.promo ?? r.retail.promo);
  return {
    key: 'state',
    label: 'Состояние',
    showCounts: true,
    options: [
      { value: 'all', label: 'Все' },
      { value: 'promo', label: 'Акция', test: (r) => !!promo(r) },
      { value: 'have', label: mode === 'seller' ? 'Есть в магазине' : 'Есть на складе', test: (r) => lvl(r) !== 'out' },
      { value: 'out', label: 'Нет в наличии', test: (r) => lvl(r) === 'out' },
      { value: 'soon', label: 'Скоро срок', test: (r) => r.expirySoon },
    ],
  };
}

function columnsFor(mode: CatalogMode): Column<CatalogRow>[] {
  const head: Column<CatalogRow>[] = [
    { key: 'sku', header: 'Артикул', width: 92, render: (r) => <span className="muted">{r.p.sku}</span>, sort: (r) => r.p.sku, csv: (r) => r.p.sku },
    {
      key: 'name',
      header: 'Название',
      render: nameCell,
      sort: (r) => r.p.name,
      csv: (r) => r.p.name,
      className: 'prd-col-name',
      total: (rows) => fmt.count(rows.length, 'товар', 'товара', 'товаров'),
    },
    { key: 'brand', header: 'Бренд', render: (r) => <span className="prd-clip" title={r.brand}>{r.brand}</span>, sort: (r) => r.brand, csv: (r) => r.brand, className: 'prd-col-brand' },
    {
      key: 'category',
      header: 'Категория',
      render: (r) => <span className="prd-clip" title={r.subcategory}>{r.category}</span>,
      sort: (r) => r.category,
      csv: (r) => `${r.category} · ${r.subcategory}`,
      className: 'prd-col-cat',
    },
    { key: 'packs', header: 'Упаковки', render: (r) => <span className="muted nowrap t-12">{r.packs}</span>, csv: (r) => r.packs },
  ];
  const sumOf = (get: (r: CatalogRow) => number) => (rows: CatalogRow[]) => fmt.num(rows.reduce((s, r) => s + get(r), 0));

  if (mode === 'full')
    return [
      ...head,
      { key: 'retail', header: 'Розница', align: 'right', render: (r) => <PriceCell info={r.retail} />, sort: (r) => r.retail.price, csv: (r) => r.retail.price },
      { key: 'wholesale', header: 'Опт', align: 'right', render: (r) => <PriceCell info={r.wholesale} />, sort: (r) => r.wholesale.price, csv: (r) => r.wholesale.price },
      { key: 'shop', header: 'Магазин', align: 'right', render: (r) => fmt.num(r.stock.shop.onHand), sort: (r) => r.stock.shop.onHand, total: sumOf((r) => r.stock.shop.onHand) },
      { key: 'wh', header: 'Склад', align: 'right', render: (r) => fmt.num(r.stock.warehouse.onHand), sort: (r) => r.stock.warehouse.onHand, total: sumOf((r) => r.stock.warehouse.onHand) },
      {
        key: 'avail',
        header: 'Доступно',
        align: 'right',
        render: (r) => (
          <span className="w-700" title={`Склад ${fmt.num(r.stock.warehouse.onHand)} минус резерв ${fmt.num(r.stock.warehouse.reserved)}: столько можно обещать оптом`}>
            {fmt.num(r.stock.warehouse.available)}
          </span>
        ),
        sort: (r) => r.stock.warehouse.available,
        total: sumOf((r) => r.stock.warehouse.available),
      },
      {
        key: 'status',
        header: 'Статус',
        render: (r) => (
          <span className="prd-chips">
            {r.level !== 'ok' || !r.promo ? <LevelChip level={r.level} /> : null}
            {r.promo && r.p.active ? <PromoChip promo={r.promo} short={r.level !== 'ok'} /> : null}
          </span>
        ),
        sort: (r) => LEVEL_ORDER[r.level],
        csv: (r) => STOCK_LEVEL[r.level].label + (r.promo ? ', акция' : ''),
      },
    ];

  if (mode === 'seller')
    return [
      ...head,
      { key: 'price', header: 'Цена', align: 'right', render: (r) => <PriceCell info={r.retail} strong />, sort: (r) => r.retail.price, csv: (r) => r.retail.price },
      { key: 'promo', header: 'Акция', render: (r) => (r.retail.promo ? <PromoChip promo={r.retail.promo} short /> : null), sort: (r) => (r.retail.promo ? 0 : 1), csv: (r) => r.retail.promo?.name ?? '' },
      {
        key: 'shop',
        header: 'В магазине',
        align: 'right',
        render: (r) => (r.stock.shop.available > 0 ? <span className="w-700">{fmt.num(r.stock.shop.available)}</span> : <LevelChip level="out" />),
        sort: (r) => r.stock.shop.available,
        total: sumOf((r) => r.stock.shop.available),
      },
      { key: 'wh', header: 'На складе', align: 'right', render: (r) => fmt.num(r.stock.warehouse.available), sort: (r) => r.stock.warehouse.available, total: sumOf((r) => r.stock.warehouse.available) },
    ];

  const promo = (r: CatalogRow) => r.wholesale.promo ?? r.retail.promo;
  return [
    ...head,
    { key: 'wholesale', header: 'Опт', align: 'right', render: (r) => <PriceCell info={r.wholesale} strong />, sort: (r) => r.wholesale.price, csv: (r) => r.wholesale.price },
    { key: 'retail', header: 'Розница', align: 'right', render: (r) => <PriceCell info={r.retail} />, sort: (r) => r.retail.price, csv: (r) => r.retail.price },
    { key: 'promo', header: 'Акция', render: (r) => (promo(r) ? <PromoChip promo={promo(r)!} short /> : null), sort: (r) => (promo(r) ? 0 : 1), csv: (r) => promo(r)?.name ?? '' },
    {
      key: 'avail',
      header: 'Доступно на складе',
      align: 'right',
      render: (r) =>
        r.stock.warehouse.available > 0 ? (
          <span className="w-700" title="Склад минус резерв: столько можно обещать оптом">
            {fmt.num(r.stock.warehouse.available)}
          </span>
        ) : (
          <LevelChip level="out" />
        ),
      sort: (r) => r.stock.warehouse.available,
      total: sumOf((r) => r.stock.warehouse.available),
    },
  ];
}

export default function Catalog() {
  const db = useDB();
  const version = useDBVersion();
  const { role, can } = useSession();
  const open = useOpenEntity();
  const [params] = useSearchParams();
  const openId = params.get('open')?.startsWith('product:') ? params.get('open')!.slice(8) : null;
  const mode = catalogMode(role);
  const [cat, setCat] = useState('');
  const [brand, setBrand] = useState('');
  const [supplier, setSupplier] = useState('');
  const [adding, setAdding] = useState(false);

  const all = useMemo(() => {
    const rows = catalogRows(db);
    return mode === 'full' ? rows : rows.filter((r) => r.p.active);
  }, [db, version, mode]);

  const catOptions = useMemo(
    () => db.categories.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((c) => ({ value: c.id, label: c.name })),
    [db, version],
  );
  const brandOptions = useMemo(() => db.brands.map((b) => ({ value: b.id, label: b.name })).sort((a, b) => a.label.localeCompare(b.label, 'ru')), [db, version]);
  const supplierOptions = useMemo(() => db.suppliers.map((s) => ({ value: s.id, label: s.name })), [db, version]);

  const rows = useMemo(() => {
    const fam = cat ? categoryFamily(db, cat) : null;
    return all.filter((r) => (!fam || fam.has(r.p.categoryId)) && (!brand || r.p.brandId === brand) && (!supplier || r.p.supplierIds.includes(supplier)));
  }, [all, cat, brand, supplier, db]);

  const filters = useMemo(() => [stateFilter(mode)], [mode]);
  const columns = useMemo(() => columnsFor(mode), [mode]);
  const promoCount = useMemo(() => promosToday(db).length, [db, version]);

  return (
    <>
      <PageHeader
        section="products"
        counts={{ catalog: all.length, pricing: promoCount }}
        actions={
          can('editCatalog') ? (
            <Button variant="primary" icon={<Plus />} onClick={() => setAdding(true)}>
              Добавить товар
            </Button>
          ) : null
        }
      />
      <section className={`card table-card prd-catalog prd-catalog-${mode}`}>
      <DataTable
        card={false}
        id={`products-${mode}`}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.p.id}
        search={{ placeholder: 'Название, артикул или штрихкод', text: (r) => r.search }}
        filters={filters}
        defaultSort={{ key: 'name', dir: 'asc' }}
        onRowClick={(r) => open('product', r.p.id)}
        selectedKey={openId}
        rowClassName={(r) => (r.p.active ? undefined : 'prd-row-off')}
        exportName="Товары"
        totalLabel={() => 'Итого'}
        presetViews={
          mode === 'full'
            ? [
                { name: 'Нужно заказать', search: '', filters: { state: 'low' }, sort: { key: 'avail', dir: 'asc' } },
                { name: 'Лежит без продаж', search: '', filters: { state: 'idle' }, sort: { key: 'wh', dir: 'desc' } },
              ]
            : [{ name: 'Акции', search: '', filters: { state: 'promo' }, sort: { key: 'name', dir: 'asc' } }]
        }
        toolbar={
          <>
            <Select className="prd-filter-select" aria-label="Категория" placeholder="Все категории" options={catOptions} value={cat} onChange={(e) => setCat(e.target.value)} />
            <Select className="prd-filter-select" aria-label="Бренд" placeholder="Все бренды" options={brandOptions} value={brand} onChange={(e) => setBrand(e.target.value)} />
            {mode === 'full' ? (
              <Select className="prd-filter-select" aria-label="Поставщик" placeholder="Все поставщики" options={supplierOptions} value={supplier} onChange={(e) => setSupplier(e.target.value)} />
            ) : null}
          </>
        }
      />
      </section>
      {adding ? (
        <ProductForm
          onClose={() => setAdding(false)}
          onSaved={(id) => {
            setAdding(false);
            open('product', id);
          }}
        />
      ) : null}
    </>
  );
}
