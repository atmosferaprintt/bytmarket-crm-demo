/* Склад → Остатки. Макет stock-A: полоса показателей, таблица по местам, фильтры со счётчиками. */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { LocationKey } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { categoryFamily } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { DataTable, EmptyState, Kpi, Segmented, Select, fmt, type Column } from '../../ui';
import { NO_MOVEMENT_DAYS, categoryOptions, stockLines, type StockFlag, type StockLine } from './calc';
import { StockStatusChip, statusRank } from './StockStatus';
import { stockTabCounts } from './picking';
import { StockDocButtons, useStockDocs } from './docActions';
import { useNarrow } from './useNarrow';

type FilterKey = 'all' | StockFlag;
const FILTERS: { key: FilterKey; label: string; hint?: string }[] = [
  { key: 'all', label: 'Все' },
  { key: 'low', label: 'Ниже минимума' },
  { key: 'out', label: 'Нет в наличии' },
  { key: 'shopLow', label: 'Мало в магазине' },
  { key: 'expiring', label: 'Истекает срок' },
  { key: 'reserved', label: 'В резерве' },
  { key: 'expected', label: 'Ожидается' },
  { key: 'quarantine', label: 'В карантине' },
  { key: 'stale', label: 'Без движения', hint: `Нет продаж и отгрузок ${NO_MOVEMENT_DAYS} дней и дольше` },
];

const n0 = (v: number): ReactNode => (v ? fmt.num(v) : <span className="faint">0</span>);

export default function StockPage() {
  const db = useDB();
  const version = useDBVersion();
  const { can } = useSession();
  const seeCost = can('seeCost');
  const open = useOpenEntity();
  const docs = useStockDocs();
  const navigate = useNavigate();
  const narrow = useNarrow();
  // закупочная цена за штуку — только на широком экране: на 1280–1440 место нужнее названию (она есть в карточке товара)
  const wide = !useNarrow('(max-width: 1560px)');
  const [place, setPlace] = useState<'all' | LocationKey>('all');
  const [cat, setCat] = useState('');
  const [params] = useSearchParams();
  const [flt, setFlt] = useState<FilterKey>(() => {
    const f = params.get('f');
    return FILTERS.some((x) => x.key === f) ? (f as FilterKey) : 'all';
  });

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lines = useMemo(() => stockLines(db), [db, version]);
  const tabCounts = stockTabCounts(db);

  const catLines = useMemo(() => {
    if (!cat) return lines;
    const fam = categoryFamily(db, cat);
    return lines.filter((l) => fam.has(l.categoryId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, cat]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: catLines.length };
    for (const f of FILTERS) if (f.key !== 'all') c[f.key] = 0;
    for (const l of catLines) for (const f of l.flags) c[f] = (c[f] ?? 0) + 1;
    return c;
  }, [catLines]);

  const rows = useMemo(() => (flt === 'all' ? catLines : catLines.filter((l) => l.flags.has(flt as StockFlag))), [catLines, flt]);

  const kpi = useMemo(() => {
    let value = 0;
    let noCost = 0;
    let quarantine = 0;
    for (const l of lines) {
      if (l.value !== null) value += l.value;
      else if (l.info.total.onHand > 0) noCost++;
      quarantine += l.info.quarantine;
    }
    let incoming = 0;
    let incomingSum = 0;
    for (const pu of db.purchases) {
      if (pu.state !== 'ordered' && pu.state !== 'partial') continue;
      incoming++;
      for (const ln of pu.lines) incomingSum += Math.max(0, ln.qty - (ln.received ?? 0)) * ln.price;
    }
    return {
      value,
      noCost,
      quarantine,
      incoming,
      incomingSum,
      low: lines.filter((l) => l.flags.has('low')).length,
      expiring: lines.filter((l) => l.flags.has('expiring')).length,
      shopLow: lines.filter((l) => l.flags.has('shopLow')).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines, version]);

  const at = (l: StockLine) => (place === 'all' ? l.info.total : l.info[place]);
  const placeValue = (l: StockLine) => (l.cost === null ? null : at(l).onHand * l.cost);
  const sum = (rs: StockLine[], f: (l: StockLine) => number) => rs.reduce((s, l) => s + f(l), 0);

  const columns: Column<StockLine>[] = [
    {
      key: 'sku',
      header: 'Артикул',
      sort: (l) => l.p.sku,
      csv: (l) => l.p.sku,
      className: 'stock-col-sku',
      render: (l) => <span className="muted nowrap">{l.p.sku}</span>,
      total: () => 'Итого',
    },
    {
      key: 'name',
      header: 'Товар',
      sort: (l) => l.p.name,
      csv: (l) => l.p.name,
      className: 'stock-col-name',
      render: (l) => (
        <div className="cell-title stock-name" title={l.p.name}>
          {l.p.name}
        </div>
      ),
      total: (rs) => fmt.count(rs.length, 'товар', 'товара', 'товаров'),
    },
    {
      key: 'shop',
      header: 'Магазин',
      align: 'right',
      hidden: place === 'warehouse',
      sort: (l) => l.info.shop.onHand,
      csv: (l) => l.info.shop.onHand,
      render: (l) => <span className={l.flags.has('shopLow') ? 'c-warn w-700' : undefined}>{n0(l.info.shop.onHand)}</span>,
      total: (rs) => fmt.num(sum(rs, (l) => l.info.shop.onHand)),
    },
    {
      key: 'shopMin',
      header: 'Минимум в\u00a0магазине',
      align: 'right',
      hidden: place === 'warehouse',
      className: 'stock-th-wrap',
      sort: (l) => l.shopMin,
      csv: (l) => l.shopMin,
      render: (l) => (
        <span className="muted" title={`Держим на полке магазина от ${fmt.qty(l.shopMin)}: два дня продаж магазина. Меньше — «Мало в магазине», перенесите со склада`}>
          {fmt.num(l.shopMin)}
        </span>
      ),
    },
    {
      key: 'wh',
      header: 'Склад',
      align: 'right',
      hidden: place === 'shop',
      sort: (l) => l.info.warehouse.onHand,
      csv: (l) => l.info.warehouse.onHand,
      render: (l) => n0(l.info.warehouse.onHand),
      total: (rs) => fmt.num(sum(rs, (l) => l.info.warehouse.onHand)),
    },
    {
      key: 'res',
      header: 'Резерв',
      align: 'right',
      sort: (l) => at(l).reserved,
      csv: (l) => at(l).reserved,
      render: (l) => n0(at(l).reserved),
      total: (rs) => fmt.num(sum(rs, (l) => at(l).reserved)),
    },
    {
      key: 'avail',
      header: place === 'all' ? 'Доступно' : place === 'shop' ? 'Доступно в магазине' : 'Доступно на складе',
      align: 'right',
      sort: (l) => at(l).available,
      csv: (l) => at(l).available,
      render: (l) => {
        const v = at(l).available;
        return <span className={v <= 0 ? 'w-700 c-bad' : l.flags.has('low') ? 'w-700 c-warn' : 'w-700'}>{fmt.num(v)}</span>;
      },
      total: (rs) => fmt.num(sum(rs, (l) => at(l).available)),
    },
    {
      key: 'min',
      header: 'Минимум всего',
      align: 'right',
      className: 'stock-th-wrap',
      sort: (l) => l.p.minStock,
      csv: (l) => l.p.minStock,
      render: (l) => (
        <span className="muted" title={`Минимальный остаток по магазину и складу вместе: ${fmt.qty(l.p.minStock)}. Доступно меньше — «Ниже минимума», пора закупать`}>
          {fmt.num(l.p.minStock)}
        </span>
      ),
    },
    {
      key: 'exp',
      header: 'Ожидается',
      align: 'right',
      // на 1280 у владельца места нет из-за «Суммы»: ожидаемое видно по отбору «Ожидается» и в карточке товара
      hidden: narrow && seeCost && flt !== 'expected',
      sort: (l) => l.info.expected,
      csv: (l) => l.info.expected,
      render: (l) => n0(l.info.expected),
      total: (rs) => fmt.num(sum(rs, (l) => l.info.expected)),
    },
    {
      key: 'q',
      header: 'Карантин',
      align: 'right',
      hidden: narrow && flt !== 'quarantine',
      sort: (l) => l.info.quarantine,
      csv: (l) => l.info.quarantine,
      render: (l) => (l.info.quarantine ? <span className="stock-q">{fmt.num(l.info.quarantine)}</span> : n0(0)),
      total: (rs) => fmt.num(sum(rs, (l) => l.info.quarantine)),
    },
    {
      key: 'cost',
      header: 'Закупка',
      align: 'right',
      hidden: !seeCost || !wide,
      csv: (l) => l.cost,
      render: (l) => <span className="muted nowrap">{l.cost === null ? '—' : fmt.price(l.cost)}</span>,
    },
    {
      key: 'value',
      header: 'Сумма',
      align: 'right',
      hidden: !seeCost,
      sort: (l) => placeValue(l),
      csv: (l) => placeValue(l),
      render: (l) => {
        const v = placeValue(l);
        if (v === null) return <span className="faint" title="Закупочная цена неизвестна">—</span>;
        return <span className="w-600 nowrap">{fmt.money(v)}</span>;
      },
      total: (rs) => fmt.money(sum(rs, (l) => placeValue(l) ?? 0)),
    },
    {
      key: 'status',
      header: 'Статус',
      className: 'stock-col-status',
      sort: (l) => statusRank(l),
      csv: (l) => l.status?.label ?? 'В наличии',
      render: (l) => <StockStatusChip line={l} />,
    },
  ];

  const unit = (n: number, one: string, few: string, many: string) => <small className="stock-kpi-unit">{fmt.plural(n, one, few, many)}</small>;

  return (
    <>
      <PageHeader section="stock" counts={tabCounts} actions={<StockDocButtons open={docs.open} />} />

      <div className="card stock-strip">
        {seeCost ? (
          <Kpi
            label={<span title={kpi.noCost ? `По закупочной цене. Без цены: ${kpi.noCost} товаров` : 'По закупочной цене'}>Стоимость остатков</span>}
            value={fmt.money(kpi.value)}
            onClick={() => setFlt('all')}
          />
        ) : (
          <Kpi label="Мало в магазине" value={<>{fmt.num(kpi.shopLow)} {unit(kpi.shopLow, 'позиция', 'позиции', 'позиций')}</>} onClick={() => setFlt('shopLow')} />
        )}
        <Kpi label="Ниже минимума" value={<>{fmt.num(kpi.low)} {unit(kpi.low, 'позиция', 'позиции', 'позиций')}</>} onClick={() => setFlt('low')} />
        <Kpi label="Истекает срок" value={<>{fmt.num(kpi.expiring)} {unit(kpi.expiring, 'позиция', 'позиции', 'позиций')}</>} onClick={() => setFlt('expiring')} />
        <Kpi
          label="В карантине"
          value={
            <>
              {fmt.num(kpi.quarantine)} <small className="stock-kpi-unit">шт · {fmt.count(tabCounts.quarantine, 'позиция', 'позиции', 'позиций')}</small>
            </>
          }
          onClick={() => navigate('/stock/quarantine')}
        />
        <Kpi
          label="Ожидается поставок"
          value={
            <>
              {fmt.num(kpi.incoming)}{' '}
              <small className="stock-kpi-unit">{seeCost ? `на ${fmt.money(kpi.incomingSum)}` : fmt.plural(kpi.incoming, 'закупка', 'закупки', 'закупок')}</small>
            </>
          }
          onClick={() => setFlt('expected')}
        />
      </div>

      <section className="card table-card stock-tight stock-main">
      <DataTable
        card={false}
        id="stock-main"
        rows={rows}
        columns={columns}
        rowKey={(l) => l.id}
        search={{ placeholder: 'Товар, артикул или штрихкод', text: (l) => l.search }}
        defaultSort={{ key: 'name', dir: 'asc' }}
        onRowClick={(l) => open('product', l.id)}
        exportName="Остатки"
        totalLabel={(n) => `Итого ${fmt.count(n, 'товар', 'товара', 'товаров')}`}
        presetViews={[
          { name: 'Остатки по местам', search: '', filters: {}, sort: { key: 'name', dir: 'asc' } },
          { name: 'Меньше всего доступно', search: '', filters: {}, sort: { key: 'avail', dir: 'asc' } },
          ...(seeCost ? [{ name: 'Дороже всего лежит', search: '', filters: {}, sort: { key: 'value', dir: 'desc' as const } }] : []),
        ]}
        toolbar={
          <>
            <Select
              className="stock-select"
              value={place}
              onChange={(e) => setPlace(e.target.value as 'all' | LocationKey)}
              aria-label="Место"
              options={[
                { value: 'all', label: 'Все места' },
                { value: 'warehouse', label: 'Склад' },
                { value: 'shop', label: 'Магазин' },
              ]}
            />
            <Select className="stock-select is-wide" value={cat} onChange={(e) => setCat(e.target.value)} aria-label="Категория" options={[{ value: '', label: 'Все категории' }, ...categoryOptions(db)]} />
            <div className="stock-pills">
              <Segmented ariaLabel="Отбор" value={flt} onChange={(v) => setFlt(v as FilterKey)} options={FILTERS.map((f) => ({ value: f.key, label: f.hint ? <span title={f.hint}>{f.label}</span> : f.label, count: counts[f.key] ?? 0 }))} />
            </div>
          </>
        }
        empty={<EmptyState title="Таких товаров нет">Снимите отбор или поменяйте категорию</EmptyState>}
      />
        <div className="table-foot">Доступно = магазин + склад − резерв</div>
      </section>
      {docs.element}
    </>
  );
}
