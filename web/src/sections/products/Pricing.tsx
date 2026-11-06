/* «Цены и акции»: акции, цены товаров с наценкой, журнал изменений цен, правила сочетания скидок. */
import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Plus } from 'lucide-react';
import type { PriceChange, Product, Promo } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { plusDays } from '../../data/dates';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { Button, Card, Chip, DataTable, StatusChip, fmt, type Column, type FilterDef } from '../../ui';
import { ROLES } from '../../roles/roles';
import {
  AUDIENCE,
  PROMO_STATE,
  catalogCount,
  catalogMode,
  catalogRows,
  pct1,
  markupPct,
  minAllowedPrice,
  promoProducts,
  promoSales,
  promoState,
  promoTargetText,
  promoValueText,
  promosToday,
  type CatalogRow,
  type PromoState,
} from './lib';
import { FromTo, PriceCell, PromoChip } from './bits';
import PriceModal from './PriceModal';
import PromoForm from './PromoForm';
import PromoDrawer from './PromoDrawer';

interface PromoRow {
  pr: Promo;
  state: PromoState;
  target: string;
  products: number;
  sold: number;
  revenue: number;
}

const AUDIENCE_SHORT: Record<Promo['audience'], string> = { all: 'Все', retail: 'Розница', wholesale: 'Опт' };

const STATE_ORDER: Record<PromoState, number> = { active: 0, future: 1, ended: 2, off: 3 };

interface PriceRow extends CatalogRow {
  changedAt: string | null;
  retailMarkup: number | null;
  wholesaleMarkup: number | null;
  low: boolean;
}

export default function Pricing() {
  const db = useDB();
  const version = useDBVersion();
  const { can, role } = useSession();
  const open = useOpenEntity();
  const seeCost = can('seeCost');
  const catalogTotal = useMemo(() => catalogCount(db, catalogMode(role)), [db, version, role]);
  const canPrice = can('editPrices');
  const today = db.meta.today;
  const [creating, setCreating] = useState(false);
  const [promoId, setPromoId] = useState<string | null>(null);
  const [pricing, setPricing] = useState<Product | null>(null);

  /* ---------- акции ---------- */
  const promoRows = useMemo<PromoRow[]>(() => {
    const sales = promoSales(db);
    return db.promos.map((pr) => {
      const s = sales.get(pr.id);
      return {
        pr,
        state: promoState(pr, today),
        target: promoTargetText(db, pr),
        products: promoProducts(db, pr.target, pr.audience).length,
        sold: s?.qty ?? 0,
        revenue: s?.sum ?? 0,
      };
    });
  }, [db, version, today]);

  const promoFilters = useMemo<FilterDef<PromoRow>[]>(
    () => [
      {
        key: 'state',
        showCounts: true,
        options: [
          { value: 'all', label: 'Все' },
          { value: 'active', label: 'Действуют', test: (r) => r.state === 'active' },
          { value: 'future', label: 'Скоро', test: (r) => r.state === 'future' },
          { value: 'ended', label: 'Закончились', test: (r) => r.state === 'ended' },
          { value: 'off', label: 'Выключены', test: (r) => r.state === 'off' },
        ],
      },
    ],
    [],
  );

  const promoCols = useMemo<Column<PromoRow>[]>(
    () => [
      { key: 'name', header: 'Акция', render: (r) => <span className="w-600 nowrap">{r.pr.name}</span>, sort: (r) => r.pr.name, csv: (r) => r.pr.name, total: (rows) => fmt.count(rows.length, 'акция', 'акции', 'акций') },
      { key: 'target', header: 'На что', render: (r) => <span className="prd-cell-clip" title={r.target}>{r.target}</span>, sort: (r) => r.target, csv: (r) => r.target },
      { key: 'value', header: 'Скидка', render: (r) => <span className="w-600 nowrap">{promoValueText(r.pr)}</span>, sort: (r) => (r.pr.kind === 'percent' ? r.pr.value : 0), csv: (r) => promoValueText(r.pr) },
      { key: 'audience', header: 'Для кого', render: (r) => <span className="nowrap">{AUDIENCE_SHORT[r.pr.audience]}</span>, sort: (r) => r.pr.audience, csv: (r) => AUDIENCE[r.pr.audience] },
      {
        key: 'dates',
        header: 'Даты',
        render: (r) => <span className="nowrap" title={`${fmt.date(r.pr.start)} — ${fmt.date(r.pr.end)}`}>{`${fmt.dateShort(r.pr.start)} — ${fmt.dateShort(r.pr.end)}`}</span>,
        sort: (r) => r.pr.start,
        csv: (r) => `${r.pr.start} — ${r.pr.end}`,
      },
      { key: 'products', header: 'Товаров', align: 'right', render: (r) => fmt.num(r.products), sort: (r) => r.products },
      { key: 'sold', header: 'Продано, шт', align: 'right', render: (r) => (r.sold ? fmt.num(r.sold) : '—'), sort: (r) => r.sold, total: (rows) => fmt.num(rows.reduce((s, r) => s + r.sold, 0)) },
      { key: 'revenue', header: 'Выручка', align: 'right', render: (r) => (r.revenue ? fmt.money(r.revenue) : '—'), sort: (r) => r.revenue, total: (rows) => fmt.money(rows.reduce((s, r) => s + r.revenue, 0)) },
      {
        key: 'state',
        header: 'Статус',
        render: (r) => <StatusChip s={PROMO_STATE[r.state]} />,
        sort: (r) => STATE_ORDER[r.state],
        csv: (r) => PROMO_STATE[r.state].label,
      },
    ],
    [],
  );

  /* ---------- цены ---------- */
  const priceRows = useMemo<PriceRow[]>(() => {
    const last = new Map<string, string>();
    for (const c of db.priceChanges) {
      const prev = last.get(c.productId);
      if (!prev || c.at > prev) last.set(c.productId, c.at);
    }
    const minPct = db.settings.minMarginPct;
    return catalogRows(db)
      .filter((r) => r.p.active)
      .map((r) => {
        const min = minAllowedPrice(r.p.cost, minPct);
        return {
          ...r,
          changedAt: last.get(r.p.id) ?? null,
          retailMarkup: markupPct(r.p.retailPrice, r.p.cost),
          wholesaleMarkup: markupPct(r.p.wholesalePrice, r.p.cost),
          low: min !== null && (r.p.wholesalePrice < min || r.wholesale.price < min || r.retail.price < min),
        };
      });
  }, [db, version]);

  const monthAgo = plusDays(today, -30);
  const priceFilters = useMemo<FilterDef<PriceRow>[]>(
    () => [
      {
        key: 'kind',
        showCounts: true,
        options: [
          { value: 'all', label: 'Все' },
          ...(seeCost ? [{ value: 'low', label: 'Ниже минимальной наценки', test: (r: PriceRow) => r.low }] : []),
          { value: 'promo', label: 'С акцией', test: (r: PriceRow) => !!r.promo },
          { value: 'recent', label: 'Менялись за 30 дней', test: (r: PriceRow) => !!r.changedAt && r.changedAt >= monthAgo },
          ...(seeCost ? [{ value: 'nocost', label: 'Без себестоимости', test: (r: PriceRow) => r.p.cost === null }] : []),
        ],
      },
    ],
    [seeCost, monthAgo],
  );

  const priceCols = useMemo<Column<PriceRow>[]>(
    () => [
      { key: 'sku', header: 'Артикул', width: 92, render: (r) => <span className="muted">{r.p.sku}</span>, sort: (r) => r.p.sku, csv: (r) => r.p.sku },
      {
        key: 'name',
        header: 'Товар',
        className: 'prd-col-name',
        render: (r) => (
          <EntityLink type="product" id={r.p.id} className="entity-link prd-name">
            {r.p.name}
          </EntityLink>
        ),
        sort: (r) => r.p.name,
        csv: (r) => r.p.name,
        total: (rows) => fmt.count(rows.length, 'товар', 'товара', 'товаров'),
      },
      { key: 'cost', header: 'Себестоимость', align: 'right', hidden: !seeCost, render: (r) => (r.p.cost === null ? <span className="muted">нет</span> : fmt.price(r.p.cost)), sort: (r) => r.p.cost, csv: (r) => r.p.cost },
      { key: 'retail', header: 'Розница', align: 'right', render: (r) => <PriceCell info={r.retail} />, sort: (r) => r.p.retailPrice, csv: (r) => r.p.retailPrice },
      { key: 'rm', header: 'Наценка', align: 'right', hidden: !seeCost, render: (r) => <span className="nowrap">{pct1(r.retailMarkup)}</span>, sort: (r) => r.retailMarkup, csv: (r) => (r.retailMarkup === null ? '' : Math.round(r.retailMarkup * 10) / 10) },
      { key: 'wholesale', header: 'Опт', align: 'right', render: (r) => <PriceCell info={r.wholesale} />, sort: (r) => r.p.wholesalePrice, csv: (r) => r.p.wholesalePrice },
      {
        key: 'wm',
        header: 'Наценка опт',
        align: 'right',
        hidden: !seeCost,
        render: (r) => (r.low ? <Chip tone="warn" title={`Ниже минимальной наценки ${db.settings.minMarginPct} %`}>{pct1(r.wholesaleMarkup)}</Chip> : <span className="nowrap">{pct1(r.wholesaleMarkup)}</span>),
        sort: (r) => r.wholesaleMarkup,
        csv: (r) => (r.wholesaleMarkup === null ? '' : Math.round(r.wholesaleMarkup * 10) / 10),
      },
      { key: 'promo', header: 'Акция', render: (r) => (r.promo ? <PromoChip promo={r.promo} short /> : null), sort: (r) => (r.promo ? 0 : 1), csv: (r) => r.promo?.name ?? '' },
      { key: 'changed', header: 'Цена менялась', render: (r) => (r.changedAt ? <span className="nowrap">{fmt.relDate(r.changedAt, today)}</span> : <span className="muted">—</span>), sort: (r) => r.changedAt, csv: (r) => r.changedAt ?? '' },
    ],
    [seeCost, today, db],
  );

  /* ---------- журнал ---------- */
  const logRows = useMemo(() => [...db.priceChanges].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)), [db, version]);
  const ix = indexes(db);
  const logFilters = useMemo<FilterDef<PriceChange>[]>(
    () => [
      {
        key: 'dir',
        showCounts: true,
        options: [
          { value: 'all', label: 'Все' },
          { value: 'up', label: 'Подорожало', test: (c) => c.retailTo > c.retailFrom || (c.retailTo === c.retailFrom && c.wholesaleTo > c.wholesaleFrom) },
          { value: 'down', label: 'Подешевело', test: (c) => c.retailTo < c.retailFrom || (c.retailTo === c.retailFrom && c.wholesaleTo < c.wholesaleFrom) },
        ],
      },
    ],
    [],
  );
  const logCols = useMemo<Column<PriceChange>[]>(
    () => [
      { key: 'at', header: 'Когда', width: 150, render: (c) => <span className="nowrap">{fmt.dateTime(c.at)}</span>, sort: (c) => c.at, csv: (c) => c.at },
      {
        key: 'product',
        header: 'Товар',
        className: 'prd-col-name',
        render: (c) => (
          <EntityLink type="product" id={c.productId} className="entity-link prd-name">
            {ix.products.get(c.productId)?.name ?? 'Товар'}
          </EntityLink>
        ),
        sort: (c) => ix.products.get(c.productId)?.name ?? '',
        csv: (c) => ix.products.get(c.productId)?.name ?? '',
        total: (rows) => fmt.count(rows.length, 'изменение', 'изменения', 'изменений'),
      },
      { key: 'retail', header: 'Розница', render: (c) => <FromTo from={c.retailFrom} to={c.retailTo} />, sort: (c) => c.retailTo - c.retailFrom, csv: (c) => `${c.retailFrom} → ${c.retailTo}` },
      {
        key: 'rd',
        header: 'Изменение',
        align: 'right',
        render: (c) => <span className="nowrap">{fmt.delta(((c.retailTo - c.retailFrom) / c.retailFrom) * 100)}</span>,
        sort: (c) => (c.retailTo - c.retailFrom) / c.retailFrom,
        csv: (c) => Math.round(((c.retailTo - c.retailFrom) / c.retailFrom) * 1000) / 10,
      },
      { key: 'wholesale', header: 'Опт', render: (c) => <FromTo from={c.wholesaleFrom} to={c.wholesaleTo} />, sort: (c) => c.wholesaleTo - c.wholesaleFrom, csv: (c) => `${c.wholesaleFrom} → ${c.wholesaleTo}` },
      { key: 'author', header: 'Кто', render: (c) => <span className="nowrap">{ix.employees.get(c.authorId)?.name ?? '—'}</span>, sort: (c) => ix.employees.get(c.authorId)?.name ?? '', csv: (c) => ix.employees.get(c.authorId)?.name ?? '' },
    ],
    [ix],
  );

  const promoCount = useMemo(() => promosToday(db).length, [db, version]);

  return (
    <>
      <PageHeader
        section="products"
        counts={{ catalog: catalogTotal, pricing: promoCount }}
        actions={
          can('promos') ? (
            <Button variant="primary" icon={<Plus />} onClick={() => setCreating(true)} data-hint="products.promo-new">
              Новая акция
            </Button>
          ) : null
        }
      />
      <section className="card table-card prd-catalog prd-promos">
      <DataTable
        card={false}
        id="products-promos"
        title="Акции"
        rows={promoRows}
        columns={promoCols}
        rowKey={(r) => r.pr.id}
        search={{ placeholder: 'Название акции, бренд, категория', text: (r) => `${r.pr.name} ${r.target}` }}
        filters={promoFilters}
        defaultSort={{ key: 'state', dir: 'asc' }}
        onRowClick={(r) => setPromoId(r.pr.id)}
        selectedKey={promoId}
        exportName="Акции"
        totalLabel={() => 'Итого'}
        pageSize={12}
        empty={<div className="prd-empty-pad muted">Акций пока нет. Новая акция сразу появится в каталоге и на кассе</div>}
      />
      </section>
      <DiscountRules />
      <section className={`card table-card prd-catalog prd-prices${seeCost ? '' : ' is-simple'}`}>
      <DataTable
        card={false}
        id="products-prices"
        title="Цены"
        rows={priceRows}
        columns={priceCols}
        rowKey={(r) => r.p.id}
        search={{ placeholder: 'Название, артикул или штрихкод', text: (r) => r.search }}
        filters={priceFilters}
        defaultSort={{ key: 'name', dir: 'asc' }}
        onRowClick={(r) => (canPrice ? setPricing(r.p) : open('product', r.p.id))}
        exportName="Цены"
        totalLabel={() => 'Итого'}
        pageSize={20}
      />
      </section>
      <section className="card table-card prd-catalog prd-log">
      <DataTable
        card={false}
        id="products-price-log"
        title="Журнал изменений цен"
        rows={logRows}
        columns={logCols}
        rowKey={(c) => c.id}
        search={{ placeholder: 'Товар или сотрудник', text: (c) => `${ix.products.get(c.productId)?.name ?? ''} ${ix.products.get(c.productId)?.sku ?? ''} ${ix.employees.get(c.authorId)?.name ?? ''}` }}
        filters={logFilters}
        defaultSort={{ key: 'at', dir: 'desc' }}
        onRowClick={(c) => open('product', c.productId)}
        exportName="Журнал цен"
        totalLabel={() => 'Итого'}
        pageSize={15}
        empty={<div className="prd-empty-pad muted">Цены ещё не менялись</div>}
      />
      </section>
      {creating ? <PromoForm onClose={() => setCreating(false)} onSaved={(id) => setPromoId(id)} /> : null}
      {promoId ? <PromoDrawer id={promoId} onClose={() => setPromoId(null)} /> : null}
      {pricing ? <PriceModal product={pricing} onClose={() => setPricing(null)} /> : null}
    </>
  );
}

/** Свёрнутый блок «Как применяются скидки». */
function DiscountRules() {
  const db = useDB();
  const [open, setOpen] = useState(false);
  const lim = db.settings.discountLimits;
  const roles = (['seller', 'manager', 'rep'] as const).map((r) => `${ROLES[r].short.toLowerCase()} — до ${lim[r]} %`).join(', ');
  return (
    <Card
      className={open ? 'prd-rules-card is-open' : 'prd-rules-card'}
      hint="products.rules"
      title="Как применяются скидки"
      actions={
        <Button variant="ghost" size="sm" icon={open ? <ChevronUp /> : <ChevronDown />} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? 'Свернуть' : 'Показать правила'}
        </Button>
      }
    >
      {open ? (
        <ol className="prd-rules">
          <li>
            <span className="w-600">Цена клиента.</span> Розничный покупатель платит розницу, оптовый клиент — опт. Тип цены задан в карточке клиента.
          </li>
          <li>
            <span className="w-600">Акция и цена клиента не складываются.</span> Берётся большая скидка: если цена по акции ниже цены клиента — действует акция, иначе цена клиента.
          </li>
          <li>
            <span className="w-600">Ручная скидка — в пределах роли:</span> {roles}. Основание скидки сохраняется в строке чека или заказа.
          </li>
          <li>
            <span className="w-600">Не ниже минимальной наценки.</span> Итоговая цена не опускается ниже себестоимости плюс {db.settings.minMarginPct}&nbsp;%. Дешевле — только с согласия владельца.
          </li>
          <li>
            <span className="w-600">История не меняется.</span> Новая цена и новая акция действуют для новых чеков и заказов. Проведённые документы остаются по своей цене.
          </li>
        </ol>
      ) : undefined}
    </Card>
  );
}
