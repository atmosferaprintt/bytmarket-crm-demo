import { useMemo, useState } from 'react';
import { CalendarClock, ListChecks, Pencil, Power, Tag } from 'lucide-react';
import type { EntityDrawerProps } from '../../shell/entities';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { TaskModal } from '../../shell/TaskModal';
import type { DB, ID, LocationKey, Product } from '../../data/types';
import { LOCATION_NAMES } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { indexes, promoApplies } from '../../data/selectors';
import { diffDays, plusDays } from '../../data/dates';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { Button, Chip, Drawer, EmptyState, MoreMenu, Segmented, StatList, StatRow, StatusChip, Tabs, cx, fmt, toast, type TabItem } from '../../ui';
import {
  AUDIENCE,
  MOVE_KIND,
  PACK_NAME,
  SOON_DAYS,
  catalogMode,
  catalogRow,
  markupPct,
  useIsPhone,
  minAllowedPrice,
  moveDoc,
  pct1,
  promoFor,
  movesByProduct,
  promoState,
  promoValueText,
  salesByProduct,
  PROMO_STATE,
  type CatalogMode,
  type CatalogRow,
} from './lib';
import { Bars, Block, FromTo, PriceCell, PromoChip, PromoPriceChip, Qty, StockChip, Tiles, type BarDatum } from './bits';
import ProductForm from './ProductForm';
import PriceModal from './PriceModal';

type TabKey = 'main' | 'prices' | 'stock' | 'moves' | 'sales';

/** Карточка «Товар» в боковой панели. Открывается из любого раздела через ?open=product:id */
export default function EntityDrawer({ id, onClose }: EntityDrawerProps) {
  const db = useDB();
  const version = useDBVersion();
  const { role, can, me } = useSession();
  const mode = catalogMode(role);
  const [tab, setTab] = useState<TabKey>('main');
  const [editing, setEditing] = useState(false);
  const [pricing, setPricing] = useState(false);
  const [task, setTask] = useState(false);
  const row = useMemo(() => catalogRow(db, id), [db, version, id]);
  const phone = useIsPhone();

  const lastChange = useMemo(() => {
    let at: string | null = null;
    for (const a of db.audit) if ((a.entity === 'product' || a.entity === 'price') && a.entityId === id && (!at || a.at > at)) at = a.at;
    return at;
  }, [db, version, id]);

  if (!row)
    return (
      <Drawer title="Товар" onClose={onClose}>
        <EmptyState title="Товар не найден">Возможно, ссылка устарела</EmptyState>
      </Drawer>
    );

  const p = row.p;
  const tabs: TabItem[] = [
    { key: 'main', label: 'Основное' },
    { key: 'prices', label: phone ? 'Цены' : 'Цены и упаковки' },
    { key: 'stock', label: 'Остатки' },
    ...(role !== 'rep' ? [{ key: 'moves', label: 'Движения' }] : []),
    { key: 'sales', label: 'Продажи' },
  ];

  const canEdit = can('editCatalog');
  const canPrice = can('editPrices');
  const toggleActive = () => {
    const r = dispatch('product.update', { productId: p.id, patch: { active: !p.active } }, me.id);
    if (!r.ok) return toast(r.error, 'error');
    toast(p.active ? 'Товар снят с продажи' : 'Товар снова в продаже');
  };

  const footer =
    canEdit || canPrice ? (
      <>
        {canEdit ? (
          <Button icon={<Pencil />} onClick={() => setEditing(true)}>
            Изменить
          </Button>
        ) : null}
        {canPrice ? (
          <Button icon={<Tag />} onClick={() => setPricing(true)}>
            Изменить цену
          </Button>
        ) : null}
        <MoreMenu
          items={[
            { label: p.active ? 'Снять с продажи' : 'Вернуть в продажу', icon: <Power />, onClick: toggleActive, hidden: !canEdit },
            { label: 'Поставить задачу', icon: <ListChecks />, onClick: () => setTask(true) },
          ]}
        />
        <span className="spacer" />
        {lastChange ? <span className="muted t-12">Изменён {fmt.relDate(lastChange, db.meta.today)}</span> : null}
      </>
    ) : null;

  return (
    <>
      <Drawer
        title={p.name}
        sub={[`Арт. ${p.sku}`, row.brand, row.category, row.subcategory].filter(Boolean).join(' · ')}
        onClose={onClose}
        footer={footer}
        head={
          <div className="prd-drawer-head">
            <div className="prd-chips">
              <StockChip row={row} />
              {p.active && promoFor(row, mode) ? mode === 'sales' ? <PromoPriceChip info={row.wholesale} /> : <PromoChip promo={promoFor(row, mode)!} /> : null}
              {row.expirySoon && row.stock.nearestExpiry && !row.status?.label.startsWith('Срок') ? (
                <Chip tone="warn" icon={<CalendarClock />}>
                  Срок до {fmt.date(row.stock.nearestExpiry)}
                </Chip>
              ) : null}
              {p.marking ? <Chip tone="outline">Маркировка</Chip> : null}
            </div>
            <div className="prd-drawer-tabs">
              <Tabs items={tabs} value={tab} onChange={(k) => setTab(k as TabKey)} />
            </div>
          </div>
        }
      >
        {tab === 'main' ? <MainTab row={row} mode={mode} /> : null}
        {tab === 'prices' ? <PricesTab row={row} /> : null}
        {tab === 'stock' ? <StockTab row={row} mode={mode} /> : null}
        {tab === 'moves' ? <MovesTab product={p} /> : null}
        {tab === 'sales' ? <SalesTab product={p} /> : null}
      </Drawer>
      {editing ? <ProductForm product={p} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} /> : null}
      {pricing ? <PriceModal product={p} onClose={() => setPricing(false)} /> : null}
      {task ? <TaskModal link={{ type: 'product', id: p.id }} defaultTitle={`Проверить товар ${p.sku}`} onClose={() => setTask(false)} /> : null}
    </>
  );
}

/* ---------- Основное ---------- */

function variantPrice(db: DB, id: ID, mode: CatalogMode): number {
  const r = catalogRow(db, id);
  if (!r) return 0;
  return mode === 'sales' ? r.wholesale.price : r.retail.price;
}

function PriceTiles({ row, mode }: { row: CatalogRow; mode: CatalogMode }) {
  const { can, role } = useSession();
  const p = row.p;
  // представителю — одна цена: для опта, уже с акцией, если она ниже
  if (role === 'rep') return <Tiles items={[{ label: 'Цена для опта', value: <PriceCell info={row.wholesale} strong /> }]} />;
  const items = [
    { label: 'Розница', value: <PriceCell info={row.retail} /> },
    { label: mode === 'sales' ? 'Цена для опта' : 'Опт', value: <PriceCell info={row.wholesale} /> },
  ];
  if (can('seeCost')) {
    items.push({ label: 'Себестоимость', value: <>{p.cost === null ? 'не известна' : fmt.price(p.cost)}</> });
    items.push({ label: 'Наценка в опте', value: <>{pct1(markupPct(row.wholesale.price, p.cost))}</> });
  }
  return <Tiles items={items} />;
}

function StockTiles({ row, mode }: { row: CatalogRow; mode: CatalogMode }) {
  const s = row.stock;
  const availTile = { label: 'Доступно', value: <Qty v={row.available} strong />, title: 'Доступно = магазин + склад − резерв' };
  // продавцу важно, что можно продать с кассы: магазин отдельно от склада
  if (mode === 'seller')
    return (
      <Tiles
        items={[
          { label: 'В магазине', value: <Qty v={s.shop.available} strong />, title: 'Столько можно продать с кассы' },
          { label: 'На складе', value: <Qty v={s.warehouse.available} />, title: 'Можно попросить склад перенести в магазин' },
          { label: 'Ожидается', value: fmt.num(s.expected) },
        ]}
      />
    );
  // менеджеру и представителю — одно число, то же, что берёт заявка: склад минус резерв
  if (mode === 'sales')
    return (
      <Tiles
        items={[
          { label: 'Можно заказать', value: <Qty v={row.whAvailable} strong />, title: 'Склад − резерв: столько берёт заявка и заказ' },
          { label: 'Ожидается', value: fmt.num(s.expected) },
        ]}
      />
    );
  return (
    <Tiles
      items={[
        { label: 'Магазин', value: fmt.num(s.shop.onHand) },
        { label: 'Склад', value: fmt.num(s.warehouse.onHand) },
        { label: 'Резерв', value: fmt.num(s.total.reserved) },
        availTile,
        { label: 'Ожидается', value: fmt.num(s.expected) },
      ]}
    />
  );
}

function MainTab({ row, mode }: { row: CatalogRow; mode: CatalogMode }) {
  const db = useDB();
  const version = useDBVersion();
  const { role } = useSession();
  const open = useOpenEntity();
  const p = row.p;
  const ix = indexes(db);
  const group = p.groupId ? db.groups.find((g) => g.id === p.groupId) : undefined;
  const variants = useMemo(
    () => (p.groupId ? db.products.filter((x) => x.groupId === p.groupId).sort((a, b) => (a.weightG ?? 0) - (b.weightG ?? 0) || a.name.localeCompare(b.name, 'ru')) : []),
    [db, version, p.groupId],
  );
  const sameScent = variants.every((x) => x.scent === p.scent);
  const month = useMemo(() => {
    const from = plusDays(db.meta.today, -29);
    let qty = 0;
    let sum = 0;
    for (const e of salesByProduct(db).get(p.id) ?? []) {
      if (e.date < from) continue;
      qty += e.qty;
      sum += e.sum;
    }
    return { qty, sum };
  }, [db, version, p.id]);
  const recent = useMemo(() => (movesByProduct(db).get(p.id) ?? []).filter((m) => m.dOnHand !== 0).slice(-4).reverse(), [db, version, p.id]);
  const suppliers = p.supplierIds.map((sid) => ix.suppliers.get(sid)).filter(Boolean);
  const canSuppliers = role === 'owner' || role === 'warehouse' || role === 'accountant';

  return (
    <>
      <Block title="Цены за штуку">
        <PriceTiles row={row} mode={mode} />
      </Block>
      <Block title="Остатки, шт">
        <StockTiles row={row} mode={mode} />
      </Block>
      {variants.length > 1 ? (
        <Block title="Варианты в группе">
          <div className="prd-variants">
            {variants.map((v) => (
              <button
                key={v.id}
                type="button"
                className={cx('prd-variant', v.id === p.id && 'is-current')}
                onClick={() => v.id !== p.id && open('product', v.id)}
                title={v.name}
              >
                <span>{(sameScent ? v.volume : null) ?? v.variant ?? v.volume ?? v.sku}</span>
                <span className="w-700">{fmt.price(variantPrice(db, v.id, mode))}</span>
              </button>
            ))}
          </div>
        </Block>
      ) : null}
      <Block title="Характеристики">
        <div className="prd-specs">
          <StatList>
            <StatRow label="Объём" value={p.volume ?? '—'} />
            <StatRow label="Вес" value={p.weightG ? (p.weightG >= 1000 ? `${fmt.num(p.weightG / 1000, 2).replace(/,?0+$/, '')} кг` : `${fmt.num(p.weightG)} г`) : '—'} />
            <StatRow label="Аромат" value={p.scent ?? '—'} />
            <StatRow label="Единица учёта" value="штука" />
            <StatRow label="Группа" value={group?.name ?? 'без группы'} />
          </StatList>
          <StatList>
            <StatRow label="Бренд" value={row.brand} />
            <StatRow label="Категория" value={row.subcategory || row.category} />
            {mode === 'full' ? <StatRow label="Минимальный остаток" value={fmt.qty(p.minStock)} /> : null}
            <StatRow label="Сроки годности" value={p.expiryTracked ? 'учитываются' : 'не учитываются'} />
            <StatRow label="Маркировка" value={p.marking ? 'подлежит' : 'не нужна'} />
          </StatList>
        </div>
      </Block>
      {mode === 'full' ? (
        <Block title="Поставщики">
          {suppliers.length ? (
            <div className="prd-list">
              {suppliers.map((s) => (
                <div key={s!.id} className="prd-list-row">
                  {canSuppliers ? (
                    <EntityLink type="supplier" id={s!.id}>
                      {s!.name}
                    </EntityLink>
                  ) : (
                    <span className="w-600">{s!.name}</span>
                  )}
                  <span className="spacer" />
                  <span className="muted">поставка за {fmt.count(s!.leadDays, 'день', 'дня', 'дней')}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="muted">Поставщик не указан</div>
          )}
        </Block>
      ) : null}
      <Block title="Продажи за 30 дней">
        <Tiles
          items={[
            { label: 'Продано', value: fmt.qty(month.qty) },
            { label: 'Выручка', value: fmt.money(month.sum) },
            { label: 'Последняя продажа', value: row.lastSale ? fmt.relDate(row.lastSale, db.meta.today) : 'не было' },
          ]}
        />
      </Block>
      {role !== 'rep' && recent.length ? (
        <Block title="Последние движения">
          <div className="prd-list">
            {recent.map((m) => (
              <div key={m.id} className="prd-list-row">
                <span className="muted num prd-list-date">{fmt.dateShort(m.at)}</span>
                <span className="grow ellipsis">
                  {MOVE_KIND[m.kind]} · {moveDoc(db, m).label}
                </span>
                <span className={cx('num w-700', m.dOnHand > 0 ? 'c-ok' : undefined)}>
                  {m.dOnHand > 0 ? '+' : ''}
                  {fmt.qty(m.dOnHand)}
                </span>
              </div>
            ))}
          </div>
        </Block>
      ) : null}
    </>
  );
}

/* ---------- Цены и упаковки ---------- */

function PricesTab({ row }: { row: CatalogRow }) {
  const db = useDB();
  const version = useDBVersion();
  const { can, role } = useSession();
  // представитель видит одну цену — для опта
  const rep = role === 'rep';
  const seeCost = can('seeCost');
  const p = row.p;
  const ix = indexes(db);
  const history = useMemo(() => db.priceChanges.filter((c) => c.productId === p.id).sort((a, b) => (a.at < b.at ? 1 : -1)), [db, version, p.id]);
  const promos = useMemo(() => {
    const today = db.meta.today;
    return db.promos
      .filter((pr) => promoState(pr, today) === 'active' || promoState(pr, today) === 'future')
      .filter((pr) => (!rep && promoApplies(db, pr, p, 'retail')) || promoApplies(db, pr, p, 'wholesale') || pr.id === row.wholesale.promo?.id)
      .sort((a, b) => (a.start < b.start ? -1 : 1));
  }, [db, version, p, rep, row.wholesale.promo]);
  const minPrice = minAllowedPrice(p.cost, db.settings.minMarginPct);

  return (
    <>
      <Block title="Единицы продажи">
        <div className="table-scroll prd-inner-table">
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Единица и штрихкод</th>
                <th className="num prd-hide-phone">Штук</th>
                {rep ? null : <th className="num">Розница</th>}
                <th className="num">{rep ? 'Цена для опта' : 'Опт'}</th>
              </tr>
            </thead>
            <tbody>
              {p.packs.map((pk) => (
                <tr key={pk.key}>
                  <td>
                    <div className="w-600">{pk.key === 'pcs' ? 'Штука' : `${PACK_NAME[pk.key]} ${pk.qty} шт`}</div>
                    <div className="t-12 muted">{pk.barcode}</div>
                  </td>
                  <td className="num prd-hide-phone">{fmt.num(pk.qty)}</td>
                  {rep ? null : <td className="num">{fmt.price(row.retail.price * pk.qty)}</td>}
                  <td className="num">{fmt.price(row.wholesale.price * pk.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Block>
      <Block title="Цены за штуку">
        <StatList>
          {rep ? null : <StatRow label="Розница" value={<PriceCell info={row.retail} />} />}
          <StatRow label={rep ? 'Цена для опта' : 'Опт'} value={<PriceCell info={row.wholesale} />} />
          {seeCost ? <StatRow label="Себестоимость" value={p.cost === null ? 'не известна' : fmt.price(p.cost)} /> : null}
          {seeCost ? <StatRow label="Наценка в рознице" value={pct1(markupPct(p.retailPrice, p.cost))} /> : null}
          {seeCost ? <StatRow label="Наценка в опте" value={pct1(markupPct(p.wholesalePrice, p.cost))} /> : null}
          {seeCost && minPrice !== null ? <StatRow label={`Не ниже, с наценкой ${db.settings.minMarginPct} %`} value={fmt.price(minPrice)} /> : null}
        </StatList>
      </Block>
      <Block title="Акции">
        {promos.length ? (
          <div className="prd-list">
            {promos.map((pr) => {
              const st = promoState(pr, db.meta.today);
              return (
                <div key={pr.id} className="prd-list-row">
                  <div className="grow">
                    <div className="w-600">{pr.name}</div>
                    <div className="muted t-12">
                      {promoValueText(pr)} · {AUDIENCE[pr.audience].toLowerCase()} · {fmt.date(pr.start)} — {fmt.date(pr.end)}
                    </div>
                  </div>
                  <StatusChip s={PROMO_STATE[st]} />
                </div>
              );
            })}
          </div>
        ) : (
          <div className="muted">Акций на товар нет</div>
        )}
      </Block>
      <Block title="История цены">
        {history.length ? (
          <div className="table-scroll prd-inner-table">
            <table className="table table-dense">
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Розница</th>
                  <th>Опт</th>
                  <th className="prd-hide-phone">Кто</th>
                </tr>
              </thead>
              <tbody>
                {history.map((c) => (
                  <tr key={c.id}>
                    <td className="nowrap" title={fmt.dateTime(c.at)}>
                      <span className="prd-hide-phone">{fmt.date(c.at)}</span>
                      <span className="prd-only-phone">{fmt.dateShort(c.at)}</span>
                    </td>
                    <td>
                      <FromTo from={c.retailFrom} to={c.retailTo} />
                    </td>
                    <td>
                      <FromTo from={c.wholesaleFrom} to={c.wholesaleTo} />
                    </td>
                    <td className="nowrap prd-hide-phone">{ix.employees.get(c.authorId)?.short ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted">Цена не менялась с {fmt.date(p.createdAt, { year: true })}</div>
        )}
      </Block>
    </>
  );
}

/* ---------- Остатки ---------- */

function placeExtras(db: DB, productId: ID) {
  const quarantine: Record<LocationKey, number> = { shop: 0, warehouse: 0 };
  for (const q of db.quarantine) if (q.productId === productId && q.state === 'check') quarantine[q.location] += q.qty;
  const expected: Record<LocationKey, number> = { shop: 0, warehouse: 0 };
  const incoming: { id: ID; number: number; supplierId: ID; date: string; qty: number }[] = [];
  for (const pu of db.purchases) {
    if (pu.state !== 'ordered' && pu.state !== 'partial') continue;
    for (const l of pu.lines) {
      if (l.productId !== productId) continue;
      const rest = l.qty - (l.received ?? 0);
      if (rest <= 0) continue;
      expected[pu.location] += rest;
      incoming.push({ id: pu.id, number: pu.number, supplierId: pu.supplierId, date: pu.expectedAt, qty: rest });
    }
  }
  incoming.sort((a, b) => (a.date < b.date ? -1 : 1));
  return { quarantine, expected, incoming };
}

function StockTab({ row, mode }: { row: CatalogRow; mode: CatalogMode }) {
  const db = useDB();
  const version = useDBVersion();
  const { role } = useSession();
  const p = row.p;
  const s = row.stock;
  const ex = useMemo(() => placeExtras(db, p.id), [db, version, p.id]);
  const batches = useMemo(
    () => db.batches.filter((b) => b.productId === p.id && b.qty > 0).sort((a, b) => (a.expiry < b.expiry ? -1 : 1)),
    [db, version, p.id],
  );
  const ix = indexes(db);
  const today = db.meta.today;
  const soon = plusDays(today, SOON_DAYS);
  const places: LocationKey[] = ['shop', 'warehouse'];
  const canPurchases = role === 'owner' || role === 'warehouse' || role === 'accountant';

  return (
    <>
      <Block title="По местам, шт">
        <div className="table-scroll prd-inner-table">
          <table className="table table-dense">
            <thead>
              <tr>
                <th>Место</th>
                <th className="num">Факт</th>
                <th className="num">Резерв</th>
                <th className="num">Доступно</th>
                <th className="num prd-hide-phone">Карантин</th>
                <th className="num prd-hide-phone">Ожидается</th>
              </tr>
            </thead>
            <tbody>
              {places.map((l) => (
                <tr key={l}>
                  <td className="w-600">{LOCATION_NAMES[l]}</td>
                  <td className="num">{fmt.num(s[l].onHand)}</td>
                  <td className="num">{fmt.num(s[l].reserved)}</td>
                  <td className="num w-700">{fmt.num(s[l].available)}</td>
                  <td className="num prd-hide-phone">{fmt.num(ex.quarantine[l])}</td>
                  <td className="num prd-hide-phone">{fmt.num(ex.expected[l])}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Всего</td>
                <td className="num">{fmt.num(s.total.onHand)}</td>
                <td className="num">{fmt.num(s.total.reserved)}</td>
                <td className="num">{fmt.num(s.total.available)}</td>
                <td className="num prd-hide-phone">{fmt.num(s.quarantine)}</td>
                <td className="num prd-hide-phone">{fmt.num(s.expected)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {mode === 'full' ? (
          <div className="row prd-min-row">
            <span className="muted" title="По магазину и складу вместе; сравниваем с «Доступно»">
              Минимальный остаток
            </span>
            <span className="w-700 num">{fmt.qty(p.minStock)}</span>
            <span className="muted">· в магазине держим от {fmt.qty(row.line.shopMin)}</span>
            <StockChip row={row} />
          </div>
        ) : null}
      </Block>
      {ex.incoming.length ? (
        <Block title="Ожидаемые поставки">
          <div className="prd-list">
            {ex.incoming.map((x) => (
              <div key={x.id} className="prd-list-row">
                <span className="muted num prd-list-date">{fmt.dateShort(x.date)}</span>
                <span className="grow ellipsis">
                  {canPurchases ? (
                    <EntityLink type="purchase" id={x.id}>
                      Закупка № {x.number}
                    </EntityLink>
                  ) : (
                    `Закупка № ${x.number}`
                  )}
                  <span className="muted"> · {ix.suppliers.get(x.supplierId)?.name ?? ''}</span>
                </span>
                <span className="num w-700">+{fmt.qty(x.qty)}</span>
              </div>
            ))}
          </div>
        </Block>
      ) : null}
      <Block title="Партии и сроки годности">
        {!p.expiryTracked ? (
          <div className="muted">Сроки годности по товару не ведутся</div>
        ) : batches.length ? (
          <div className="table-scroll prd-inner-table">
            <table className="table table-dense">
              <thead>
                <tr>
                  <th>Место</th>
                  <th className="prd-hide-phone">Принята</th>
                  <th className="num">Штук</th>
                  <th>Годен до</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td>{LOCATION_NAMES[b.location]}</td>
                    <td className="prd-hide-phone">{fmt.date(b.receivedAt)}</td>
                    <td className="num">{fmt.num(b.qty)}</td>
                    <td>
                      <div className="prd-expiry">
                        <span className="w-600 nowrap">{fmt.date(b.expiry, { year: b.expiry.slice(0, 4) !== today.slice(0, 4) })}</span>
                        {b.expiry < today ? (
                          <Chip tone="bad">Просрочен</Chip>
                        ) : b.expiry <= soon ? (
                          <Chip tone="warn">{`Осталось ${fmt.count(diffDays(today, b.expiry), 'день', 'дня', 'дней')}`}</Chip>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted">Партий на остатке нет</div>
        )}
      </Block>
    </>
  );
}

/* ---------- Движения ---------- */

function MovesTab({ product }: { product: Product }) {
  const db = useDB();
  const version = useDBVersion();
  const [place, setPlace] = useState<'all' | LocationKey>('all');
  const [limit, setLimit] = useState(30);
  const ix = indexes(db);
  const all = useMemo(() => [...(movesByProduct(db).get(product.id) ?? [])].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)), [db, version, product.id]);
  const list = place === 'all' ? all : all.filter((m) => m.location === place);
  const count = (l: LocationKey) => all.filter((m) => m.location === l).length;

  return (
    <Block
      title="Движения"
      actions={
        <Segmented
          value={place}
          onChange={(v) => {
            setPlace(v);
            setLimit(30);
          }}
          options={[
            { value: 'all', label: 'Все', count: all.length },
            { value: 'shop', label: 'Магазин', count: count('shop') },
            { value: 'warehouse', label: 'Склад', count: count('warehouse') },
          ]}
        />
      }
    >
      {list.length ? (
        <>
          <div className="table-scroll prd-inner-table">
            <table className="table table-dense">
              <thead>
                <tr>
                  <th>Когда</th>
                  <th>Операция и документ</th>
                  <th className="num">Штук</th>
                  <th className="prd-hide-phone">Кто</th>
                </tr>
              </thead>
              <tbody>
                {list.slice(0, limit).map((m) => {
                  const doc = moveDoc(db, m);
                  const reserveOnly = m.dOnHand === 0;
                  const d = reserveOnly ? m.dReserved : m.dOnHand;
                  return (
                    <tr key={m.id}>
                      <td className="nowrap">
                        {fmt.dateShort(m.at)} <span className="muted">{fmt.time(m.at)}</span>
                      </td>
                      <td>
                        <div className="w-600">{MOVE_KIND[m.kind]}</div>
                        <div className="t-12 muted">
                          {doc.entity ? (
                            <EntityLink type={doc.entity.type} id={doc.entity.id} className="entity-link prd-doc-link">
                              {doc.label}
                            </EntityLink>
                          ) : (
                            doc.label
                          )}
                          {place === 'all' ? ` · ${LOCATION_NAMES[m.location]}` : ''}
                        </div>
                      </td>
                      <td className={cx('num nowrap', reserveOnly ? 'muted' : d > 0 ? 'c-ok w-700' : 'w-700')}>
                        {reserveOnly ? 'резерв ' : d > 0 ? '+' : ''}
                        {fmt.num(reserveOnly ? Math.abs(d) : d)}
                      </td>
                      <td className="nowrap prd-hide-phone">{ix.employees.get(m.authorId)?.short ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {list.length > limit ? (
            <div className="row" style={{ gap: 8 }}>
              <span className="muted t-12">
                Показано {fmt.num(limit)} из {fmt.num(list.length)}
              </span>
              <Button size="sm" onClick={() => setLimit((l) => l + 60)}>
                Показать ещё
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <EmptyState title="Движений нет">По этому месту товар не двигался</EmptyState>
      )}
    </Block>
  );
}

/* ---------- Продажи ---------- */

const WEEKS = 13;

function SalesTab({ product }: { product: Product }) {
  const db = useDB();
  const version = useDBVersion();
  const scoped = useScoped();
  const { role } = useSession();
  const [measure, setMeasure] = useState<'qty' | 'sum'>('qty');
  const today = db.meta.today;
  const visible = useMemo(() => new Set(scoped.clients.map((c) => c.id)), [scoped.clients]);

  const data = useMemo(() => {
    const evts = salesByProduct(db).get(product.id) ?? [];
    const weeks = Array.from({ length: WEEKS }, (_, i) => {
      const end = plusDays(today, -7 * (WEEKS - 1 - i));
      const start = plusDays(end, -6);
      return { start, end, qty: 0, sum: 0 };
    });
    const from = weeks[0].start;
    let qty = 0;
    let sum = 0;
    let retailQty = 0;
    let wholesaleQty = 0;
    const buyers = new Map<ID, { qty: number; sum: number; last: string }>();
    let anonQty = 0;
    let anonSum = 0;
    for (const e of evts) {
      if (e.date < from || e.date > today) continue;
      const k = Math.floor(diffDays(e.date, today) / 7);
      const w = weeks[WEEKS - 1 - k];
      if (w) {
        w.qty += e.qty;
        w.sum += e.sum;
      }
      qty += e.qty;
      sum += e.sum;
      if (e.kind === 'retail') retailQty += e.qty;
      else wholesaleQty += e.qty;
      if (e.clientId) {
        const b = buyers.get(e.clientId) ?? { qty: 0, sum: 0, last: e.date };
        b.qty += e.qty;
        b.sum += e.sum;
        if (e.date > b.last) b.last = e.date;
        buyers.set(e.clientId, b);
      } else {
        anonQty += e.qty;
        anonSum += e.sum;
      }
    }
    const top = [...buyers.entries()]
      .filter(([cid, b]) => b.qty > 0 && visible.has(cid))
      .sort((a, b) => b[1].sum - a[1].sum)
      .slice(0, 8);
    return { weeks, qty, sum, retailQty, wholesaleQty, top, anonQty, anonSum, from };
  }, [db, version, product.id, today, visible]);

  const ix = indexes(db);
  const bars: BarDatum[] = data.weeks.map((w) => ({
    key: w.start,
    axis: fmt.dateShort(w.start),
    tip: `${fmt.date(w.start)} — ${fmt.date(w.end)}`,
    value: Math.max(0, measure === 'qty' ? w.qty : w.sum),
  }));
  const own = role === 'manager' || role === 'rep';

  return (
    <>
      <Block title="Продажи за 90 дней">
        <Tiles
          items={[
            { label: 'Продано', value: fmt.qty(data.qty) },
            { label: 'Выручка', value: fmt.money(data.sum) },
            { label: 'В рознице', value: fmt.qty(data.retailQty) },
            { label: 'Оптом', value: fmt.qty(data.wholesaleQty) },
          ]}
        />
      </Block>
      <Block
        title="По неделям"
        actions={
          <Segmented
            value={measure}
            onChange={setMeasure}
            options={[
              { value: 'qty', label: 'Штуки' },
              { value: 'sum', label: 'Выручка' },
            ]}
          />
        }
      >
        {data.qty > 0 ? (
          <Bars data={bars} format={measure === 'qty' ? (v) => fmt.qty(v) : (v) => fmt.money(v)} label={measure === 'qty' ? 'Продано штук по неделям' : 'Выручка по неделям'} />
        ) : (
          <EmptyState title="Продаж за 90 дней не было">
            {product.createdAt > data.from ? `Товар в каталоге с ${fmt.date(product.createdAt)}` : 'Проверьте цену и наличие'}
          </EmptyState>
        )}
      </Block>
      <Block title={own ? 'Мои клиенты, которые берут товар' : 'Главные покупатели'}>
        {data.top.length || (!own && data.anonQty > 0) ? (
          <div className="table-scroll prd-inner-table">
            <table className="table table-dense">
              <thead>
                <tr>
                  <th>Клиент</th>
                  <th className="num">Штук</th>
                  <th className="num">Сумма</th>
                  <th className="prd-hide-phone">Последняя покупка</th>
                </tr>
              </thead>
              <tbody>
                {data.top.map(([cid, b]) => (
                  <tr key={cid}>
                    <td className="prd-buyer">
                      <EntityLink type="client" id={cid}>
                        {ix.clients.get(cid)?.name ?? 'Клиент'}
                      </EntityLink>
                    </td>
                    <td className="num">{fmt.num(b.qty)}</td>
                    <td className="num">{fmt.money(b.sum)}</td>
                    <td className="nowrap prd-hide-phone">{fmt.relDate(b.last, today)}</td>
                  </tr>
                ))}
                {!own && data.anonQty > 0 ? (
                  <tr>
                    <td className="muted">Розница без карты клиента</td>
                    <td className="num">{fmt.num(data.anonQty)}</td>
                    <td className="num">{fmt.money(data.anonSum)}</td>
                    <td className="prd-hide-phone" />
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="muted">{own ? 'Ваши клиенты этот товар пока не брали' : 'Покупателей с картой пока нет'}</div>
        )}
      </Block>
    </>
  );
}

