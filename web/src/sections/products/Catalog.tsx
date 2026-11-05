/* Каталог товаров: таблица на все позиции, карточка открывается сбоку. Макет products-A. */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { Button, DataTable, Select, fmt, type Column, type FilterDef } from '../../ui';
import { categoryFamily } from '../../data/selectors';
import { NO_MOVEMENT_DAYS } from '../../data/thresholds';
import { useNarrow } from '../stock/useNarrow';
import { statusRank } from '../stock/StockStatus';
import { catalogCount, catalogMode, catalogRows, promoFor, promosToday, type CatalogMode, type CatalogRow } from './lib';
import { PriceCell, PromoChip, PromoPriceChip, Qty, StockChip } from './bits';
import ProductForm from './ProductForm';

const AVAIL_TITLE = 'Доступно = магазин + склад − резерв';
const WH_TITLE = 'Можно заказать = склад − резерв: столько берёт заявка и заказ';

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
        { value: 'low', label: 'Ниже минимума', test: (r) => r.belowMin },
        { value: 'out', label: 'Нет в наличии', test: (r) => r.out },
        { value: 'promo', label: 'Акция', test: (r) => r.p.active && !!r.promo },
        { value: 'soon', label: 'Истекает срок', test: (r) => r.expirySoon },
        { value: 'idle', label: `Без движения ${NO_MOVEMENT_DAYS} дней`, test: (r) => r.idle },
        { value: 'off', label: 'Не продаются', test: (r) => !r.p.active },
      ],
    };
  const promo = (r: CatalogRow) => promoFor(r, mode);
  return {
    key: 'state',
    label: 'Состояние',
    showCounts: true,
    options: [
      { value: 'all', label: 'Все' },
      { value: 'promo', label: 'Акция', test: (r) => !!promo(r) },
      mode === 'seller'
        ? { value: 'have', label: 'Есть в магазине', test: (r) => r.stock.shop.available > 0 }
        : { value: 'have', label: 'Можно заказать', test: (r) => r.whAvailable > 0 },
      { value: 'out', label: 'Нет в наличии', test: (r) => r.out },
      { value: 'soon', label: 'Истекает срок', test: (r) => r.expirySoon },
    ],
  };
}

function columnsFor(mode: CatalogMode, narrow: boolean): Column<CatalogRow>[] {
  const sumOf = (get: (r: CatalogRow) => number) => (rows: CatalogRow[]) => fmt.num(rows.reduce((s, r) => s + get(r), 0));
  const head: Column<CatalogRow>[] = [
    { key: 'sku', header: 'Артикул', className: 'prd-col-sku', render: (r) => <span className="muted">{r.p.sku}</span>, sort: (r) => r.p.sku, csv: (r) => r.p.sku, total: () => 'Итого' },
    {
      key: 'name',
      header: 'Название',
      render: nameCell,
      sort: (r) => r.p.name,
      csv: (r) => r.p.name,
      className: 'prd-col-name',
      total: (rows) => fmt.count(rows.length, 'товар', 'товара', 'товаров'),
    },
    { key: 'brand', header: 'Бренд', render: (r) => r.brand, sort: (r) => r.brand, csv: (r) => r.brand, className: 'prd-col-nowrap' },
    {
      key: 'category',
      header: 'Категория',
      hidden: narrow,
      render: (r) => <span title={r.subcategory}>{r.category}</span>,
      sort: (r) => r.category,
      csv: (r) => `${r.category} · ${r.subcategory}`,
      className: 'prd-col-nowrap',
    },
  ];
  const packs: Column<CatalogRow> = { key: 'packs', header: 'Упаковки', className: 'prd-col-nowrap', render: (r) => <span className="muted t-12">{r.packs}</span>, csv: (r) => r.packs };
  const avail: Column<CatalogRow> = {
    key: 'avail',
    header: 'Доступно',
    align: 'right',
    render: (r) => (
      <span
        className={r.available > 0 && r.belowMin ? 'w-700 c-warn' : undefined}
        title={`${AVAIL_TITLE}: ${fmt.num(r.stock.shop.onHand)} + ${fmt.num(r.stock.warehouse.onHand)} − ${fmt.num(r.stock.total.reserved)}`}
      >
        <Qty v={r.available} strong />
      </span>
    ),
    sort: (r) => r.available,
    csv: (r) => r.available,
    total: sumOf((r) => r.available),
  };

  if (mode === 'full')
    return [
      ...head,
      { key: 'retail', header: 'Розница', align: 'right', render: (r) => <PriceCell info={r.retail} />, sort: (r) => r.retail.price, csv: (r) => r.retail.price },
      { key: 'wholesale', header: 'Опт', align: 'right', render: (r) => <PriceCell info={r.wholesale} />, sort: (r) => r.wholesale.price, csv: (r) => r.wholesale.price },
      { key: 'shop', header: 'Магазин', align: 'right', render: (r) => fmt.num(r.stock.shop.onHand), sort: (r) => r.stock.shop.onHand, csv: (r) => r.stock.shop.onHand, total: sumOf((r) => r.stock.shop.onHand) },
      { key: 'wh', header: 'Склад', align: 'right', render: (r) => fmt.num(r.stock.warehouse.onHand), sort: (r) => r.stock.warehouse.onHand, csv: (r) => r.stock.warehouse.onHand, total: sumOf((r) => r.stock.warehouse.onHand) },
      avail,
      {
        key: 'status',
        header: 'Статус',
        className: 'prd-col-nowrap',
        render: (r) => <StockChip row={r} />,
        sort: (r) => statusRank(r.line),
        csv: (r) => r.status?.label ?? 'В наличии',
      },
    ];

  if (mode === 'seller')
    return [
      ...head,
      packs,
      { key: 'price', header: 'Цена', align: 'right', render: (r) => <PriceCell info={r.retail} strong />, sort: (r) => r.retail.price, csv: (r) => r.retail.price },
      { key: 'promo', header: 'Акция', className: 'prd-col-nowrap', render: (r) => (r.retail.promo ? <PromoChip promo={r.retail.promo} short /> : null), sort: (r) => (r.retail.promo ? 0 : 1), csv: (r) => r.retail.promo?.name ?? '' },
      {
        key: 'shop',
        header: 'В магазине',
        align: 'right',
        render: (r) => <Qty v={r.stock.shop.available} strong />,
        sort: (r) => r.stock.shop.available,
        csv: (r) => r.stock.shop.available,
        total: sumOf((r) => r.stock.shop.available),
      },
      // с кассы продаётся только магазин; склад — чтобы знать, есть ли что перенести
      {
        key: 'wh',
        header: 'На складе',
        align: 'right',
        render: (r) => <span className="muted">{fmt.num(r.stock.warehouse.available)}</span>,
        sort: (r) => r.stock.warehouse.available,
        csv: (r) => r.stock.warehouse.available,
        total: sumOf((r) => r.stock.warehouse.available),
      },
    ];

  return [
    ...head,
    packs,
    { key: 'wholesale', header: 'Цена для опта', align: 'right', className: 'prd-col-nowrap', render: (r) => <PriceCell info={r.wholesale} strong />, sort: (r) => r.wholesale.price, csv: (r) => r.wholesale.price },
    {
      key: 'promo',
      header: 'Акция',
      className: 'prd-col-nowrap',
      render: (r) => <PromoPriceChip info={r.wholesale} />,
      sort: (r) => (promoFor(r, 'sales') ? 0 : 1),
      csv: (r) => promoFor(r, 'sales')?.name ?? '',
    },
    { key: 'retail', header: 'Розница', align: 'right', render: (r) => <span className="muted">{fmt.price(r.retail.price)}</span>, sort: (r) => r.retail.price, csv: (r) => r.retail.price },
    {
      key: 'whAvail',
      header: 'Можно заказать',
      align: 'right',
      className: 'prd-col-nowrap',
      render: (r) => (
        <span title={WH_TITLE}>
          <Qty v={r.whAvailable} strong />
        </span>
      ),
      sort: (r) => r.whAvailable,
      csv: (r) => r.whAvailable,
      total: sumOf((r) => r.whAvailable),
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

  const narrow = useNarrow();
  const all = useMemo(() => {
    const rows = catalogRows(db);
    return mode === 'full' ? rows : rows.filter((r) => r.p.active);
  }, [db, version, mode]);
  const count = useMemo(() => catalogCount(db, mode), [db, version, mode]);

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
  const columns = useMemo(() => columnsFor(mode, narrow), [mode, narrow]);
  const promoCount = useMemo(() => promosToday(db).length, [db, version]);

  return (
    <>
      <PageHeader
        section="products"
        counts={{ catalog: count, pricing: promoCount }}
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
                { name: 'Без движения', search: '', filters: { state: 'idle' }, sort: { key: 'wh', dir: 'desc' } },
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
