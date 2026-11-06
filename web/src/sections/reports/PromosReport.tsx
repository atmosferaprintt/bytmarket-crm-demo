import { useMemo, useState } from 'react';
import { Chip, DataTable, PROMO_STATE, StatusChip, fmt, type Column } from '../../ui';
import { useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { promoRows, productRows, type PromoRow } from './calc';
import { KpiTile } from '../overview/KpiTile';
import { DeltaText, DocsDrawer, HowCalc, PartialMark, ReportTop, WrapHead, sum, useReportPeriod } from './parts';
import { rangeText } from '../overview/period';

const AUDIENCE = { all: 'Всем', retail: 'Розница', wholesale: 'Опт' };

export default function PromosReport() {
  const db = useDB();
  const version = useDBVersion();
  const { can } = useSession();
  const seeProfit = can('seeProfit');
  const { range, prev, label } = useReportPeriod();
  const rows = useMemo(() => promoRows(db, range.from, range.to), [db, version, range.from, range.to]);
  const prodRows = useMemo(() => productRows(db, range.from, range.to, prev.from, prev.to), [db, version, range.from, range.to, prev.from]);
  const [pick, setPick] = useState<PromoRow | null>(null);

  const revenue = sum(rows, (r) => r.agg.revenue);
  const discount = sum(rows, (r) => r.agg.promoDiscount);
  const profit = sum(rows, (r) => r.agg.profit);
  const stockValue = sum(rows.filter((r) => r.state === 'active' || r.state === 'future'), (r) => r.stockValue);

  const cols: Column<PromoRow>[] = [
    {
      key: 'name',
      header: 'Акция',
      render: (r) => (
        <div className="rp-name">
          <div className="cell-title">{r.pr.name}</div>
          <div className="cell-sub">
            {r.target} · {AUDIENCE[r.pr.audience]} · {r.pr.kind === 'percent' ? `−${r.pr.value} %` : `по ${fmt.price(r.pr.value)}`}
          </div>
        </div>
      ),
      sort: (r) => r.pr.name,
      csv: (r) => r.pr.name,
    },
    {
      key: 'dates',
      header: 'Сроки',
      render: (r) => (
        <span className="rp-dates">
          <span>{fmt.date(r.pr.start)} –</span>
          <span>{fmt.date(r.pr.end)}</span>
        </span>
      ),
      sort: (r) => r.pr.start,
      csv: (r) => `${r.pr.start} – ${r.pr.end}`,
    },
    { key: 'state', header: 'Состояние', render: (r) => <StatusChip s={PROMO_STATE[r.state]} />, sort: (r) => r.state, csv: (r) => PROMO_STATE[r.state].label },
    { key: 'qty', header: <WrapHead width={56}>Продано, шт</WrapHead>, align: 'right', render: (r) => fmt.num(r.agg.qty), sort: (r) => r.agg.qty, total: (rs) => fmt.num(sum(rs, (r) => r.agg.qty)) },
    { key: 'revenue', header: 'Выручка', align: 'right', render: (r) => fmt.money(r.agg.revenue), sort: (r) => r.agg.revenue, total: (rs) => fmt.money(sum(rs, (r) => r.agg.revenue)) },
    { key: 'disc', header: 'Скидка', align: 'right', render: (r) => fmt.money(r.agg.promoDiscount), sort: (r) => r.agg.promoDiscount, total: (rs) => fmt.money(sum(rs, (r) => r.agg.promoDiscount)) },
    {
      key: 'profit',
      header: 'Прибыль',
      align: 'right',
      hidden: !seeProfit,
      render: (r) => (
        <span title={r.margin !== null ? `Маржа ${fmt.pct(r.margin)}` : 'Себестоимость неизвестна'}>
          {fmt.money(r.agg.profit)}
          {r.agg.lines && r.agg.knownLines < r.agg.lines ? <PartialMark share={r.agg.knownLines / r.agg.lines} /> : null}
        </span>
      ),
      sort: (r) => r.agg.profit,
      total: (rs) => fmt.money(sum(rs, (r) => r.agg.profit)),
    },
    {
      key: 'avg',
      header: <WrapHead width={52}>Чек с акцией</WrapHead>,
      align: 'right',
      render: (r) => (r.receipts ? <span title={`${fmt.count(r.receipts, 'чек', 'чека', 'чеков')} с акционным товаром. Обычный средний чек за период — ${fmt.money(r.avgAll)}`}>{fmt.money(r.avgWith)}</span> : '—'),
      sort: (r) => r.avgWith,
    },
    {
      key: 'growth',
      header: (
        <span data-hint="reports.promos.growth">
          <WrapHead width={116}>К такому же периоду до акции</WrapHead>
        </span>
      ),
      csvHeader: 'К такому же периоду до акции',
      align: 'right',
      render: (r) =>
        r.growth === null ? (
          <span className="faint" title="Перед акцией в базе нет столько же дней для сравнения">—</span>
        ) : (
          <span title={`Эти товары за дни акции: ${fmt.money(r.during)}, за столько же дней до неё: ${fmt.money(r.before)}`}>
            <DeltaText cur={r.during} prev={r.before} />
          </span>
        ),
      sort: (r) => r.growth,
      csv: (r) => r.growth?.toFixed(1) ?? '',
    },
    {
      key: 'stock',
      header: 'Остаток',
      align: 'right',
      render: (r) => (
        <span className="rp-stock-col" title={`${fmt.qty(r.stockQty)} по себестоимости`}>
          {fmt.money(r.stockValue)}
          {r.absentProducts ? (
            <Chip tone="warn" title="Столько товаров акции заканчивались: их не было в наличии 3 дня и больше за время акции">
              {fmt.count(r.absentProducts, 'товар заканчивался', 'товара заканчивались', 'товаров заканчивались')}
            </Chip>
          ) : null}
        </span>
      ),
      sort: (r) => r.stockValue,
      total: (rs) => fmt.money(sum(rs, (r) => r.stockValue)),
    },
  ];

  return (
    <>
      <ReportTop />
      <div className="rp-kpis">
        <KpiTile label="Акций за период" value={fmt.num(rows.length)} extra={<div className="rp-kpi-line">Действуют сейчас <b>{fmt.num(rows.filter((r) => r.state === 'active').length)}</b></div>} />
        <KpiTile label="Выручка по акциям" value={fmt.money(revenue)} />
        <KpiTile label="Скидка покупателям" value={fmt.money(discount)} hint="reports.promos.discount" />
        {seeProfit ? <KpiTile label="Прибыль по акциям" value={fmt.money(profit)} extra={<div className="rp-kpi-line">Маржа <b>{revenue ? fmt.pct((profit / revenue) * 100) : '—'}</b></div>} /> : null}
        <KpiTile label="Остаток акционных товаров" value={fmt.money(stockValue)} />
      </div>

      <div className="rp-tight">
      <DataTable
        id="rp-promos"
        hint="reports.promos.table"
        title="Акции"
        rows={rows}
        columns={cols}
        rowKey={(r) => r.pr.id}
        defaultSort={{ key: 'revenue', dir: 'desc' }}
        filters={[
          {
            key: 'state',
            showCounts: true,
            options: [
              { value: 'all', label: 'Все' },
              { value: 'active', label: PROMO_STATE.active.label, test: (r) => r.state === 'active' },
              { value: 'future', label: PROMO_STATE.future.label, test: (r) => r.state === 'future' },
              { value: 'ended', label: PROMO_STATE.ended.label, test: (r) => r.state === 'ended' },
              { value: 'off', label: PROMO_STATE.off.label, test: (r) => r.state === 'off' },
            ],
          },
        ]}
        onRowClick={(r) => setPick(r)}
        exportName={`Акции ${label}`}
        empty={<div className="rp-empty">За период акций не было</div>}
      />
      </div>

      <HowCalc
        rows={[
          ['Продажи по акции', 'Строки чеков и заказов, где цена взята по этой акции. Опт — по отгрузке, розница — по чекам. Возврат акционного товара вычитается.'],
          ['Скидка покупателям', 'Обычная цена минус акционная, умноженная на количество. Ручная скидка продавца сюда не входит.'],
          ['Чек с акцией', 'Средняя сумма чеков, в которых есть акционный товар. Обычный средний чек за тот же период — в подсказке.'],
          ['К такому же периоду до акции', 'Выручка тех же товаров за дни акции против стольких же дней перед её началом, для той же аудитории. Если товар заканчивался — не было в наличии 3 дня и больше, — это помечено: рост или падение могло быть из-за остатка, а не акции.'],
          ['Остаток', 'Сколько акционных товаров лежит сейчас, по себестоимости.'],
          ['Прибыль', 'Валовая, по строкам с известной себестоимостью. Чистую прибыль не считаем.'],
        ]}
      />

      {pick ? (
        <DocsDrawer
          title={pick.pr.name}
          sub={`${pick.target} · ${rangeText({ from: pick.pr.start, to: pick.pr.end })}`}
          amountLabel="Выручка"
          onClose={() => setPick(null)}
          rows={prodRows
            .filter((r) => pick.productIds.includes(r.p.id))
            .map((r) => ({
              key: r.p.id,
              at: r.lastSale ?? '',
              kind: 'Товар',
              title: r.p.name,
              sub: `Продано ${fmt.num(r.agg.qty)} шт · остаток ${fmt.num(r.onHand)} шт${r.outDays ? ` · не было ${fmt.count(r.outDays, 'день', 'дня', 'дней')}` : ''}`,
              amount: r.agg.revenue,
              entity: { type: 'product' as const, id: r.p.id },
            }))}
        />
      ) : null}
    </>
  );
}
