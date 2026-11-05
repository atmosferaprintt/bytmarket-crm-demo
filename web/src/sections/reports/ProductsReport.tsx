import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, Chip, DataTable, Segmented, Select, StatusChip, STOCK_LEVEL, fmt, type Column } from '../../ui';
import { useOpenEntity } from '../../shell/entities';
import { useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { LOCATION_NAMES } from '../../data/types';
import { demandIndex, noCostCount } from '../overview/analytics';
import { DEAD_DAYS, deficitRows, expiryRows, groupRows, isDead, periodDays, productRows, totalsFor, type DeficitRow, type ExpiryRow, type GroupRow, type ProductRow } from './calc';
import { KpiTile, deltaOf, ppDelta } from '../overview/KpiTile';
import { DeltaText, DocsDrawer, HowCalc, MarginText, ReportTop, WrapHead, sum, useReportPeriod } from './parts';
import { change } from '../overview/period';
import { expensesFor } from '../overview/overviewData';
import { plusDays } from '../../data/dates';

type Metric = 'revenue' | 'qty' | 'profit';
type StockList = 'turnover' | 'dead' | 'lowmargin' | 'deficit' | 'low' | 'expiry' | 'absent';

export default function ProductsReport() {
  const db = useDB();
  const version = useDBVersion();
  const { can } = useSession();
  const seeProfit = can('seeProfit');
  const open = useOpenEntity();
  const [params] = useSearchParams();
  const { range, prev, cmp, label, today } = useReportPeriod();
  const [metric, setMetric] = useState<Metric>('revenue');
  const [cat, setCat] = useState<string>(params.get('cat') ?? '');
  const listParam = params.get('list') as StockList | null;
  const [list, setList] = useState<StockList>(listParam ?? 'turnover');
  const [groupBy, setGroupBy] = useState<'category' | 'brand'>('category');
  const [drawer, setDrawer] = useState<GroupRow | null>(null);
  const listsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (listParam) listsRef.current?.scrollIntoView({ block: 'start' });
  }, [listParam]);

  const rows = useMemo(() => productRows(db, range.from, range.to, prev.from, prev.to), [db, version, range.from, range.to, prev.from]);
  const total = useMemo(() => totalsFor(db, range.from, range.to), [db, version, range.from, range.to]);
  const prevTotal = useMemo(() => (cmp ? totalsFor(db, prev.from, prev.to) : null), [db, version, prev.from, prev.to, cmp]);
  const groups = useMemo(() => groupRows(rows, groupBy), [rows, groupBy]);
  const topCats = useMemo(() => db.categories.filter((c) => !c.parentId).sort((a, b) => a.name.localeCompare(b.name, 'ru')), [db, version]);

  // одно число товаров на весь отчёт: с продажами или возвратами за период — столько строк в рейтинге и в сумме по группам
  const sold = rows.filter((r) => r.agg.lines > 0 || r.agg.returnsQty > 0);
  const onlyReturns = sold.filter((r) => r.agg.soldQty <= 0).length;
  const sameName = useMemo(() => {
    const n = new Map<string, number>();
    for (const r of sold) n.set(r.p.name, (n.get(r.p.name) ?? 0) + 1);
    return n;
  }, [rows]);
  const noCost = useMemo(() => noCostCount(db), [db, version]);
  const ranked = cat ? sold.filter((r) => r.catId === cat) : sold;
  const margin = total.knownRevenue > 0 ? (total.profit / total.knownRevenue) * 100 : 0;
  const prevMargin = prevTotal && prevTotal.knownRevenue > 0 ? (prevTotal.profit / prevTotal.knownRevenue) * 100 : null;
  const share = total.lines ? total.knownLines / total.lines : 1;
  const days = periodDays(range.from, range.to);
  // расходы за период из журнала денег — та же формула, что на обзоре: «Прибыль после расходов» = валовая − расходы
  const expenses = useMemo(() => expensesFor(db, range.from, range.to), [db, version, range.from, range.to]);
  const net = total.profit - expenses.total;

  const rankCols: Column<ProductRow>[] = [
    {
      key: 'name',
      header: 'Товар',
      render: (r) => (
        <div className="rp-name rp-name-wide">
          <div className="cell-title" title={r.p.name}>
            {r.p.name}
          </div>
          <div className="cell-sub">
            {r.brand} · {r.category}
            {(sameName.get(r.p.name) ?? 0) > 1 && (r.p.variant || r.p.volume) ? <span className="rp-variant">{r.p.variant ?? r.p.volume}</span> : null}
            {r.outDays > 0 ? (
              <Chip tone="warn" title="Товара не было в магазине и на складе — продаж в эти дни не могло быть">
                не было {fmt.count(r.outDays, 'день', 'дня', 'дней')}
              </Chip>
            ) : null}
          </div>
        </div>
      ),
      sort: (r) => r.p.name,
      csv: (r) => r.p.name,
    },
    { key: 'qty', header: 'Продано, шт', align: 'right', render: (r) => fmt.num(r.agg.qty), sort: (r) => r.agg.qty, total: (rs) => fmt.num(sum(rs, (r) => r.agg.qty)) },
    { key: 'revenue', header: 'Выручка', align: 'right', render: (r) => fmt.money(r.agg.revenue), sort: (r) => r.agg.revenue, total: (rs) => fmt.money(sum(rs, (r) => r.agg.revenue)) },
    { key: 'profit', header: 'Валовая прибыль', align: 'right', hidden: !seeProfit, render: (r) => (r.agg.knownRevenue ? fmt.money(r.agg.profit) : <span className="faint">нет данных</span>), sort: (r) => r.agg.profit, total: (rs) => fmt.money(sum(rs, (r) => r.agg.profit)) },
    {
      key: 'margin',
      header: 'Маржа',
      align: 'right',
      hidden: !seeProfit,
      render: (r) => <MarginText margin={r.margin} share={r.agg.lines ? r.agg.knownLines / r.agg.lines : 1} />,
      sort: (r) => r.margin,
      csv: (r) => (r.margin === null ? '' : Math.round(r.margin * 10) / 10),
    },
    { key: 'share', header: 'Доля', align: 'right', render: (r) => fmt.pct(r.share * 100), sort: (r) => r.share, csv: (r) => Math.round(r.share * 1000) / 10 },
    { key: 'delta', header: 'К прошлому', align: 'right', hidden: !cmp, render: (r) => (r.prevRevenue >= 1000 ? <DeltaText cur={r.agg.revenue} prev={r.prevRevenue} /> : <span className="faint" title="В прошлом периоде продаж почти не было">—</span>), sort: (r) => (r.prevRevenue >= 1000 ? change(r.agg.revenue, r.prevRevenue) : null), csv: (r) => (r.prevRevenue >= 1000 ? change(r.agg.revenue, r.prevRevenue)?.toFixed(1) ?? '' : '') },
    { key: 'stock', header: 'Остаток, шт', align: 'right', render: (r) => (r.onHand > 0 ? fmt.num(r.onHand) : <StatusChip s={STOCK_LEVEL.out} />), sort: (r) => r.onHand, csv: (r) => r.onHand },
  ];

  const groupCols: Column<GroupRow>[] = [
    { key: 'name', header: groupBy === 'category' ? 'Категория' : 'Бренд', render: (g) => <span className="cell-title">{g.name}</span>, sort: (g) => g.name, csv: (g) => g.name },
    { key: 'skus', header: 'Товаров продавалось', align: 'right', render: (g) => fmt.num(g.skus), sort: (g) => g.skus, total: (gs) => fmt.num(sum(gs, (g) => g.skus)) },
    { key: 'revenue', header: 'Выручка', align: 'right', render: (g) => fmt.money(g.agg.revenue), sort: (g) => g.agg.revenue, total: (gs) => fmt.money(sum(gs, (g) => g.agg.revenue)) },
    {
      key: 'share',
      header: 'Доля',
      render: (g) => (
        <span className="rp-share">
          <span className="rp-share-track">
            <span style={{ width: `${Math.min(100, g.share * 100 * 2.5)}%` }} />
          </span>
          {fmt.pct(g.share * 100)}
        </span>
      ),
      sort: (g) => g.share,
      csv: (g) => Math.round(g.share * 1000) / 10,
      width: 150,
    },
    { key: 'profit', header: 'Валовая прибыль', align: 'right', hidden: !seeProfit, render: (g) => fmt.money(g.agg.profit), sort: (g) => g.agg.profit, total: (gs) => fmt.money(sum(gs, (g) => g.agg.profit)) },
    { key: 'margin', header: 'Маржа', align: 'right', hidden: !seeProfit, render: (g) => <MarginText margin={g.margin} share={g.agg.lines ? g.agg.knownLines / g.agg.lines : 1} />, sort: (g) => g.margin, csv: (g) => (g.margin === null ? '' : g.margin.toFixed(1)) },
    { key: 'returns', header: 'Возвраты', align: 'right', render: (g) => (g.agg.returns ? fmt.money(g.agg.returns) : '—'), sort: (g) => g.agg.returns, total: (gs) => fmt.money(sum(gs, (g) => g.agg.returns)) },
    { key: 'delta', header: 'К прошлому', align: 'right', hidden: !cmp, render: (g) => <DeltaText cur={g.agg.revenue} prev={g.prevRevenue || null} />, sort: (g) => change(g.agg.revenue, g.prevRevenue || null) },
  ];

  const listOptions: { value: StockList; label: string }[] = [
    { value: 'turnover', label: 'Оборачиваемость' },
    { value: 'dead', label: 'Без движения' },
    { value: 'lowmargin', label: 'Низкая маржа' },
    { value: 'deficit', label: 'Дефицит ходовых' },
    { value: 'low', label: 'Ниже минимума' },
    { value: 'expiry', label: 'Срок годности' },
    { value: 'absent', label: 'Не было в наличии' },
  ];
  const visibleLists = seeProfit ? listOptions : listOptions.filter((o) => o.value !== 'lowmargin');

  return (
    <>
      <ReportTop />
      <div className="rp-kpis">
        <KpiTile label="Выручка" value={fmt.money(total.revenue)} d={deltaOf(total.revenue, prevTotal?.revenue ?? null)} />
        {seeProfit ? (
          <KpiTile
            label="Валовая прибыль"
            value={fmt.money(total.profit)}
            d={deltaOf(total.profit, prevTotal?.profit ?? null)}
            title={`Расходы — из журнала денег за ${label}${expenses.byCategory.length ? ': ' + expenses.byCategory.slice(0, 4).map((x) => `${x.category.toLowerCase()} ${fmt.money(x.amount)}`).join(', ') : ''}`}
            extra={
              <div className="rp-kpi-lines">
                <div className="rp-kpi-line">
                  Расходы <b>{fmt.money(expenses.total)}</b>
                </div>
                <div className="rp-kpi-line">
                  После расходов <b className={net < 0 ? 'c-bad' : undefined}>{fmt.money(net)}</b>
                </div>
              </div>
            }
          />
        ) : null}
        {seeProfit ? (
          <KpiTile
            label={<span title={share < 0.999 ? `Неполные данные: себестоимость известна по ${Math.round(share * 100)} % строк` : undefined}>Маржа</span>}
            value={fmt.pct(margin)}
            d={ppDelta(margin, prevMargin)}
          />
        ) : null}
        <KpiTile label="Продано, шт" value={fmt.num(total.qty)} d={deltaOf(total.qty, prevTotal?.qty ?? null)} />
        <KpiTile
          label="Товаров продавалось"
          value={fmt.num(sold.length)}
          title={onlyReturns ? `С продажами или возвратами за период. Из них только с возвратами — ${fmt.count(onlyReturns, 'товар', 'товара', 'товаров')}` : 'С продажами за период'}
        />
      </div>

      <div className="rp-tight">
      <DataTable
        key={metric + cat}
        id="rp-products-rank"
        title="Рейтинг товаров"
        rows={ranked}
        columns={rankCols}
        rowKey={(r) => r.p.id}
        defaultSort={{ key: metric, dir: 'desc' }}
        search={{ placeholder: 'Товар, бренд, артикул', text: (r) => `${r.p.name} ${r.brand} ${r.p.sku}` }}
        toolbar={
          <>
            <Segmented
              ariaLabel="Рейтинг по"
              value={metric}
              onChange={setMetric}
              options={[
                { value: 'revenue', label: 'По выручке' },
                { value: 'qty', label: 'По количеству' },
                ...(seeProfit ? [{ value: 'profit' as Metric, label: 'По прибыли' }] : []),
              ]}
            />
            <Select
              size="sm"
              className="rp-select"
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              placeholder="Все категории"
              options={topCats.map((c) => ({ value: c.id, label: c.name }))}
              aria-label="Категория"
            />
          </>
        }
        onRowClick={(r) => open('product', r.p.id)}
        exportName={`Рейтинг товаров ${label}`}
        pageSize={25}
      />
      </div>

      <DataTable
        key={'g' + groupBy}
        id="rp-products-groups"
        title={seeProfit ? 'Прибыльность' : 'Продажи по группам'}
        rows={groups}
        columns={groupCols}
        rowKey={(g) => g.id}
        defaultSort={{ key: 'revenue', dir: 'desc' }}
        toolbar={
          <Segmented
            ariaLabel="Группировать"
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: 'category', label: 'Категории' },
              { value: 'brand', label: 'Бренды' },
            ]}
          />
        }
        search={groupBy === 'brand' ? { placeholder: 'Бренд', text: (g) => g.name } : undefined}
        onRowClick={(g) => setDrawer(g)}
        exportName={groupBy === 'category' ? `Категории ${label}` : `Бренды ${label}`}
        pageSize={groupBy === 'brand' ? 15 : 20}
      />

      <div ref={listsRef} className="rp-anchor" />
      <Card flush className="rp-lists rp-tight" title="Остатки и спрос" actions={<Segmented ariaLabel="Список" value={list} onChange={setList} options={visibleLists} />}>
        {list === 'turnover' || list === 'dead' ? <TurnoverList rows={rows} dead={list === 'dead'} label={label} /> : null}
        {list === 'lowmargin' ? <LowMarginList rows={sold} minMarkup={db.settings.minMarginPct} label={label} /> : null}
        {list === 'deficit' || list === 'low' ? <DeficitList rows={deficitRows(db)} mode={list} /> : null}
        {list === 'expiry' ? <ExpiryList rows={expiryRows(db)} /> : null}
        {list === 'absent' ? <AbsentList rows={rows} days={days} label={label} /> : null}
      </Card>

      <HowCalc
        rows={[
          ['Выручка', 'Розница — по чекам кассы в день продажи. Опт — по отгрузке со склада в день отгрузки, а не по дате заказа. Цена — итоговая, после акции и ручной скидки.'],
          ['Возвраты', 'Возврат по чеку и возврат по заказу вычитаются из выручки, штук и прибыли в день возврата. Поэтому у товара продажи могут быть меньше нуля.'],
          ['Валовая прибыль', 'Цена продажи минус себестоимость на момент продажи, по каждой строке.'],
          ['Прибыль после расходов', 'Валовая прибыль минус расходы за период из журнала денег: аренда, зарплата, топливо, связь, ремонт, недостачи — по дате записи расхода. Так же считает обзор владельца. Налоги и закупки товара сюда не входят: товар уже учтён в себестоимости.'],
          ['Неполные данные', `Если себестоимость товара неизвестна, строка входит в выручку, но не в прибыль и маржу. Без себестоимости — ${fmt.count(noCost.active, 'товар', 'товара', 'товаров')} в продаже${noCost.inactive ? ` и ${fmt.count(noCost.inactive, 'снятый', 'снятых', 'снятых')} с продажи` : ''}; за период себестоимость известна по ${Math.round(share * 100)} % строк. Такие места помечены значком.`],
          ['Маржа', 'Валовая прибыль ÷ выручка строк с известной себестоимостью. Наценка в списке «Низкая маржа» — к себестоимости.'],
          ['Без движения', `Товар есть на остатке, а продаж и отгрузок не было ${DEAD_DAYS} дней и больше — тот же порог во всех разделах. Если товара не было в наличии, отсутствие продаж не считаем низким спросом — такие дни показаны отдельно.`],
          ['Сколько товаров', 'Рейтинг, итог по группам и плитка «Товаров продавалось» считают одно и то же: товары с продажами или возвратами за период. В списках остатков товары в продаже и снятые с продажи — отдельными фильтрами.'],
          ['Оборачиваемость и дефицит', 'Спрос — продажи за последние 30 дней, делённые на дни, когда товар был в наличии (не зависит от выбранного периода). Запас, дней = остаток ÷ продажи в день. Дефицит: (доступно + ожидается по закупкам) ÷ продажи в день меньше срока поставки плюс 2 дня. Ходовой — верхние 20 % товаров по выручке.'],
          ['Источник', 'Чеки, отгрузки и возвраты из базы; остатки и партии со сроком годности — со склада. Цифры совпадают с обзором владельца.'],
        ]}
      />

      {drawer ? (
        <DocsDrawer
          title={drawer.name}
          sub={`${groupBy === 'category' ? 'Категория' : 'Бренд'} · ${label} · выручка ${fmt.money(drawer.agg.revenue)}`}
          amountLabel="Выручка"
          onClose={() => setDrawer(null)}
          rows={rows
            .filter((r) => drawer.products.includes(r.p.id) && (r.agg.lines || r.agg.returnsQty))
            .map((r) => ({
              key: r.p.id,
              at: r.lastSale ?? '',
              kind: 'Товар',
              title: r.p.name,
              sub: `${fmt.num(r.agg.qty)} шт${seeProfit && r.margin !== null ? ` · маржа ${fmt.pct(r.margin)}` : ''}`,
              amount: r.agg.revenue,
              entity: { type: 'product' as const, id: r.p.id },
            }))}
        />
      ) : null}
    </>
  );
}

function TurnoverList({ rows, dead, label }: { rows: ProductRow[]; dead: boolean; label: string }) {
  const open = useOpenEntity();
  const db = useDB();
  const version = useDBVersion();
  const demand = useMemo(() => demandIndex(db), [db, version]);
  const seeCost = useSession().can('seeCost');
  const border = plusDays(db.meta.today, -DEAD_DAYS);
  type X = { r: ProductRow; sold30: number; daily: number; absent30: number; cover: number | null };
  const data: X[] = rows
    .filter((r) => r.onHand > 0 && (!dead || isDead(r.p, r.lastSale ?? undefined, border)))
    .map((r) => {
      const d = demand.get(r.p.id);
      const daily = d?.daily ?? 0;
      return { r, sold30: d?.sold30 ?? 0, daily, absent30: d ? 30 - d.inStockDays : 0, cover: daily > 0 ? r.onHand / daily : null };
    });
  const cols: Column<X>[] = [
    {
      key: 'name',
      header: 'Товар',
      render: (x) => (
        <div className="rp-name rp-name-wide">
          <div className="cell-title" title={x.r.p.name}>
            {x.r.p.name}
          </div>
          <div className="cell-sub">
            {x.r.brand} · {x.r.category}
          </div>
        </div>
      ),
      sort: (x) => x.r.p.name,
      csv: (x) => x.r.p.name,
    },
    { key: 'onHand', header: 'Остаток, шт', align: 'right', render: (x) => fmt.num(x.r.onHand), sort: (x) => x.r.onHand, total: (xs) => fmt.num(sum(xs, (x) => x.r.onHand)) },
    { key: 'value', header: 'По себестоимости', align: 'right', hidden: !seeCost, render: (x) => (x.r.stockValue === null ? <span className="faint" title="Себестоимость неизвестна">нет данных</span> : fmt.money(x.r.stockValue)), sort: (x) => x.r.stockValue, total: (xs) => fmt.money(sum(xs, (x) => x.r.stockValue ?? 0)) },
    { key: 'sold', header: <WrapHead width={80}>Продано за 30 дней</WrapHead>, align: 'right', render: (x) => fmt.num(x.sold30), sort: (x) => x.sold30, total: (xs) => fmt.num(sum(xs, (x) => x.sold30)) },
    { key: 'cover', header: 'Запас, дней', align: 'right', render: (x) => (x.cover !== null ? fmt.num(Math.round(x.cover)) : <span className="faint">продаж нет</span>), sort: (x) => x.cover ?? 1e9, csv: (x) => (x.cover === null ? '' : Math.round(x.cover)) },
    { key: 'last', header: <WrapHead width={80}>Последняя продажа</WrapHead>, align: 'right', render: (x) => (x.r.lastSale ? <span title={x.r.sinceSale !== null ? `${fmt.count(x.r.sinceSale, 'день', 'дня', 'дней')} назад` : undefined}>{fmt.date(x.r.lastSale)}</span> : <span className="faint">не было</span>), sort: (x) => x.r.lastSale ?? '', csv: (x) => x.r.lastSale ?? '' },
    {
      key: 'absent',
      header: <WrapHead width={80}>Не было за 30 дней</WrapHead>,
      align: 'right',
      render: (x) => (x.absent30 > 0 ? <Chip tone="warn" title="Столько дней товара не было в наличии — продаж в эти дни быть не могло">{fmt.count(x.absent30, 'день', 'дня', 'дней')}</Chip> : '—'),
      sort: (x) => x.absent30,
    },
  ];
  return (
    <DataTable
      key={dead ? 'dead' : 'turn'}
      card={false}
      rows={data}
      columns={cols}
      rowKey={(x) => x.r.p.id}
      defaultSort={{ key: seeCost ? 'value' : 'onHand', dir: 'desc' }}
      search={{ placeholder: 'Товар, бренд', text: (x) => `${x.r.p.name} ${x.r.brand} ${x.r.p.sku}` }}
      onRowClick={(x) => open('product', x.r.p.id)}
      exportName={dead ? `Без движения ${label}` : `Оборачиваемость ${label}`}
      pageSize={20}
      empty={<div className="rp-empty">{dead ? 'Товаров без движения нет' : 'Остатков нет'}</div>}
      dense
      filters={[
        {
          key: 'act',
          showCounts: true,
          options: [
            { value: 'active', label: 'В продаже', test: (x) => x.r.p.active },
            { value: 'inactive', label: 'Сняты с продажи', test: (x) => !x.r.p.active },
            { value: 'all', label: 'Все' },
          ],
        },
      ]}
      totalLabel={(n) => `Итого · ${fmt.count(n, 'товар', 'товара', 'товаров')}`}
    />
  );
}

function LowMarginList({ rows, minMarkup, label }: { rows: ProductRow[]; minMarkup: number; label: string }) {
  const open = useOpenEntity();
  const data = rows
    .filter((r) => r.agg.soldQty > 0 && r.p.cost !== null && r.agg.knownRevenue > 0)
    .map((r) => {
      const avgPrice = r.agg.revenue / Math.max(1, r.agg.qty);
      const markup = r.p.cost ? ((avgPrice - r.p.cost) / r.p.cost) * 100 : null;
      return { r, avgPrice, markup };
    })
    .filter((x) => (x.r.margin ?? 100) < 18 || (x.markup !== null && x.markup < minMarkup + 10));
  type X = (typeof data)[number];
  const cols: Column<X>[] = [
    { key: 'name', header: 'Товар', render: (x) => <div className="rp-name"><div className="cell-title">{x.r.p.name}</div><div className="cell-sub">{x.r.brand} · {x.r.category}</div></div>, sort: (x) => x.r.p.name, csv: (x) => x.r.p.name },
    { key: 'price', header: 'Средняя цена', align: 'right', render: (x) => fmt.price(x.avgPrice), sort: (x) => x.avgPrice, csv: (x) => Math.round(x.avgPrice * 100) / 100 },
    { key: 'cost', header: 'Себестоимость', align: 'right', render: (x) => fmt.price(x.r.p.cost), sort: (x) => x.r.p.cost },
    { key: 'markup', header: 'Наценка', align: 'right', render: (x) => <span className={x.markup !== null && x.markup < minMarkup ? 'c-bad w-700' : undefined}>{fmt.pct(x.markup)}</span>, sort: (x) => x.markup },
    { key: 'margin', header: 'Маржа', align: 'right', render: (x) => fmt.pct(x.r.margin), sort: (x) => x.r.margin },
    { key: 'qty', header: 'Продано, шт', align: 'right', render: (x) => fmt.num(x.r.agg.soldQty), sort: (x) => x.r.agg.soldQty, total: (xs) => fmt.num(sum(xs, (x) => x.r.agg.soldQty)) },
    { key: 'revenue', header: 'Выручка', align: 'right', render: (x) => fmt.money(x.r.agg.revenue), sort: (x) => x.r.agg.revenue, total: (xs) => fmt.money(sum(xs, (x) => x.r.agg.revenue)) },
    { key: 'profit', header: 'Прибыль', align: 'right', render: (x) => fmt.money(x.r.agg.profit), sort: (x) => x.r.agg.profit, total: (xs) => fmt.money(sum(xs, (x) => x.r.agg.profit)) },
    { key: 'promo', header: 'Скидки', align: 'right', render: (x) => (x.r.agg.promoDiscount + x.r.agg.manualDiscount > 0 ? fmt.money(x.r.agg.promoDiscount + x.r.agg.manualDiscount) : '—'), sort: (x) => x.r.agg.promoDiscount + x.r.agg.manualDiscount },
  ];
  return (
    <DataTable
      card={false}
      rows={data}
      columns={cols}
      rowKey={(x) => x.r.p.id}
      defaultSort={{ key: 'margin', dir: 'asc' }}
      search={{ placeholder: 'Товар, бренд', text: (x) => `${x.r.p.name} ${x.r.brand}` }}
      onRowClick={(x) => open('product', x.r.p.id)}
      exportName={`Низкая маржа ${label}`}
      pageSize={20}
      dense
      filters={[
        {
          key: 'm',
          showCounts: true,
          options: [
            { value: 'all', label: 'Все' },
            { value: 'below', label: `Наценка ниже ${minMarkup} %`, test: (x) => x.markup !== null && x.markup < minMarkup },
          ],
        },
      ]}
      empty={<div className="rp-empty">Товаров с низкой маржой нет</div>}
    />
  );
}

function DeficitList({ rows, mode }: { rows: DeficitRow[]; mode: 'deficit' | 'low' }) {
  const open = useOpenEntity();
  const data = mode === 'deficit' ? rows.filter((r) => r.shortage) : rows.filter((r) => r.belowMin);
  const cols: Column<DeficitRow>[] = [
    { key: 'name', header: 'Товар', render: (r) => <div className="rp-name"><div className="cell-title">{r.p.name}</div><div className="cell-sub">{r.p.sku}</div></div>, sort: (r) => r.p.name, csv: (r) => r.p.name },
    { key: 'sold', header: 'Продано за 30 дней', align: 'right', render: (r) => fmt.num(r.sold30), sort: (r) => r.sold30 },
    { key: 'daily', header: 'В день', align: 'right', render: (r) => fmt.num(r.daily, r.daily < 10 ? 1 : 0), sort: (r) => r.daily, csv: (r) => Math.round(r.daily * 10) / 10 },
    { key: 'avail', header: 'Доступно', align: 'right', render: (r) => fmt.num(r.available), sort: (r) => r.available },
    { key: 'min', header: 'Минимум', align: 'right', render: (r) => fmt.num(r.minStock), sort: (r) => r.minStock },
    { key: 'exp', header: 'Ожидается', align: 'right', render: (r) => (r.expected ? fmt.num(r.expected) : '—'), sort: (r) => r.expected },
    { key: 'cover', header: 'Хватит на, дней', align: 'right', render: (r) => (r.cover === null ? '—' : <span className={r.cover < r.leadDays ? 'c-bad w-700' : undefined}>{fmt.num(Math.floor(r.cover))}</span>), sort: (r) => r.cover ?? 1e9 },
    { key: 'lead', header: 'Поставка, дней', align: 'right', render: (r) => fmt.num(r.leadDays), sort: (r) => r.leadDays },
    {
      key: 'state',
      header: 'Состояние',
      render: (r) => (r.out ? <StatusChip s={STOCK_LEVEL.out} /> : r.shortage ? <Chip tone="warn">Ходовой заканчивается</Chip> : <StatusChip s={STOCK_LEVEL.low} />),
      sort: (r) => (r.out ? 0 : r.shortage ? 1 : 2),
      csv: (r) => (r.out ? 'Нет в наличии' : r.shortage ? 'Ходовой заканчивается' : 'Ниже минимума'),
    },
  ];
  return (
    <DataTable
      key={mode}
      card={false}
      rows={data}
      columns={cols}
      rowKey={(r) => r.p.id}
      defaultSort={mode === 'deficit' ? { key: 'daily', dir: 'desc' } : { key: 'avail', dir: 'asc' }}
      search={{ placeholder: 'Товар, артикул', text: (r) => `${r.p.name} ${r.p.sku}` }}
      filters={[
        {
          key: 'f',
          showCounts: true,
          options: [
            { value: 'all', label: 'Все' },
            { value: 'out', label: 'Нет в наличии', test: (r) => r.out },
            { value: 'fast', label: 'Ходовые', test: (r) => r.fast },
          ],
        },
      ]}
      onRowClick={(r) => open('product', r.p.id)}
      exportName={mode === 'deficit' ? 'Дефицит ходовых' : 'Ниже минимума'}
      pageSize={20}
      dense
      empty={<div className="rp-empty">{mode === 'deficit' ? 'Ходовые товары в запасе' : 'Все товары выше минимума'}</div>}
    />
  );
}

function ExpiryList({ rows }: { rows: ExpiryRow[] }) {
  const open = useOpenEntity();
  const seeCost = useSession().can('seeCost');
  const cols: Column<ExpiryRow>[] = [
    { key: 'name', header: 'Товар', render: (r) => <div className="rp-name"><div className="cell-title">{r.p.name}</div><div className="cell-sub">{r.p.sku}</div></div>, sort: (r) => r.p.name, csv: (r) => r.p.name },
    { key: 'loc', header: 'Где', render: (r) => LOCATION_NAMES[r.location], sort: (r) => r.location, csv: (r) => LOCATION_NAMES[r.location] },
    { key: 'qty', header: 'В партии, шт', align: 'right', render: (r) => fmt.num(r.qty), sort: (r) => r.qty, total: (rs) => fmt.num(sum(rs, (r) => r.qty)) },
    { key: 'expiry', header: 'Годен до', align: 'right', render: (r) => fmt.date(r.expiry, { year: r.expiry.slice(0, 4) !== '2026' }), sort: (r) => r.expiry, csv: (r) => r.expiry },
    {
      key: 'left',
      header: 'Осталось',
      render: (r) => (r.daysLeft < 0 ? <Chip tone="bad">Истёк</Chip> : <Chip tone={r.daysLeft <= 14 ? 'bad' : 'warn'}>{fmt.count(r.daysLeft, 'день', 'дня', 'дней')}</Chip>),
      sort: (r) => r.daysLeft,
      csv: (r) => r.daysLeft,
    },
    { key: 'value', header: 'По себестоимости', align: 'right', hidden: !seeCost, render: (r) => (r.value === null ? '—' : fmt.money(r.value)), sort: (r) => r.value, total: (rs) => fmt.money(sum(rs, (r) => r.value ?? 0)) },
  ];
  return (
    <DataTable
      card={false}
      rows={rows}
      columns={cols}
      rowKey={(r) => r.id}
      defaultSort={{ key: 'left', dir: 'asc' }}
      search={{ placeholder: 'Товар', text: (r) => `${r.p.name} ${r.p.sku}` }}
      onRowClick={(r) => open('product', r.p.id)}
      exportName="Срок годности"
      pageSize={20}
      dense
      empty={<div className="rp-empty">В ближайшие 60 дней сроки не истекают</div>}
    />
  );
}

function AbsentList({ rows, days, label }: { rows: ProductRow[]; days: number; label: string }) {
  const open = useOpenEntity();
  const data = rows
    .filter((r) => r.outDays > 0 && r.p.active)
    .map((r) => {
      const inStock = days - r.outDays;
      const daily = inStock > 0 ? r.agg.soldQty / inStock : null;
      const avgPrice = r.agg.soldQty > 0 ? r.agg.revenue / Math.max(1, r.agg.qty) : r.p.retailPrice;
      return { r, inStock, daily, lost: daily !== null ? Math.round(daily * r.outDays * avgPrice) : null };
    });
  type X = (typeof data)[number];
  const cols: Column<X>[] = [
    { key: 'name', header: 'Товар', render: (x) => <div className="rp-name"><div className="cell-title">{x.r.p.name}</div><div className="cell-sub">{x.r.brand} · {x.r.category}</div></div>, sort: (x) => x.r.p.name, csv: (x) => x.r.p.name },
    { key: 'out', header: 'Не было, дней', align: 'right', render: (x) => <span className="w-700">{fmt.num(x.r.outDays)}</span>, sort: (x) => x.r.outDays, csv: (x) => x.r.outDays },
    { key: 'in', header: 'Был, дней', align: 'right', render: (x) => fmt.num(x.inStock), sort: (x) => x.inStock },
    { key: 'sold', header: 'Продано, шт', align: 'right', render: (x) => fmt.num(x.r.agg.soldQty), sort: (x) => x.r.agg.soldQty },
    { key: 'daily', header: 'В день, когда был', align: 'right', render: (x) => (x.daily === null ? '—' : fmt.num(x.daily, 1)), sort: (x) => x.daily, csv: (x) => (x.daily === null ? '' : x.daily.toFixed(1)) },
    {
      key: 'lost',
      header: 'Недополучено, оценка',
      align: 'right',
      render: (x) => (x.lost === null ? <Chip tone="neutral" title="Товара не было весь период: спрос неизвестен, это не значит, что его нет">спрос неизвестен</Chip> : fmt.money(x.lost)),
      sort: (x) => x.lost,
      total: (xs) => fmt.money(sum(xs, (x) => x.lost ?? 0)),
    },
    { key: 'now', header: 'Сейчас', render: (x) => (x.r.onHand > 0 ? <StatusChip s={STOCK_LEVEL.ok} /> : <StatusChip s={STOCK_LEVEL.out} />), sort: (x) => x.r.onHand, csv: (x) => x.r.onHand },
  ];
  return (
    <DataTable
      card={false}
      rows={data}
      columns={cols}
      rowKey={(x) => x.r.p.id}
      defaultSort={{ key: 'lost', dir: 'desc' }}
      search={{ placeholder: 'Товар, бренд', text: (x) => `${x.r.p.name} ${x.r.brand}` }}
      filters={[
        {
          key: 'n',
          showCounts: true,
          options: [
            { value: 'all', label: 'Все' },
            { value: 'now', label: 'Нет и сейчас', test: (x) => x.r.onHand <= 0 },
            { value: 'back', label: 'Уже привезли', test: (x) => x.r.onHand > 0 },
          ],
        },
      ]}
      onRowClick={(x) => open('product', x.r.p.id)}
      exportName={`Дни отсутствия ${label}`}
      pageSize={20}
      dense
      empty={<div className="rp-empty">Все товары были в наличии весь период</div>}
    />
  );
}
