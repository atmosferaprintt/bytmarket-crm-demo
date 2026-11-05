import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRightLeft, ScanBarcode } from 'lucide-react';
import type { ID, Product, Promo } from '../../data/types';
import { dispatch, useDB, useDBVersion } from '../../data/store';
import { activePromos, dailySeries, priceFor, promoApplies, shiftSummary, stockOf } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { PageHeader } from '../../shell/PageHeader';
import { EntityLink } from '../../shell/entities';
import { Button, Card, Chip, EmptyState, Kpi, Notice, cx, fmt, toast } from '../../ui';
import { buildCatalog, cartName, fixNo, nbUnits, openShift, promoPct } from './lib';
import { PromoChip } from '../sales/parts';
import { stockLines } from '../stock/calc';
import { moveQty, requestMoveToShop, requestedMoves } from './moveRequest';
import './register.css';
import { ProductPhoto } from '../../shell/ProductPhoto';

/** Рабочий стол: продавец */
export default function Home() {
  const db = useDB();
  const version = useDBVersion();
  const { me } = useSession();
  const { myTasks } = useScoped();
  const navigate = useNavigate();
  const today = db.meta.today;

  const shift = useMemo(() => openShift(db), [db, version]);
  const sum = shift ? shiftSummary(db, shift.id) : null;
  const catalog = useMemo(() => buildCatalog(db), [db, version]);

  /* мои продажи за неделю */
  const week = useMemo(() => dailySeries(db, fmt.addDays(today, -6), today, { employeeId: me.id }), [db, version, me.id, today]);
  const weekTotal = week.reduce((s, d) => s + d.retail, 0);
  const weekReceipts = week.reduce((s, d) => s + d.receiptsCount, 0);
  const weekMax = Math.max(1, ...week.map((d) => d.retail));

  /* акции сегодня */
  const promos = useMemo(() => {
    const act = activePromos(db, today).filter((p) => p.audience !== 'wholesale');
    const list: { p: Product; promo: Promo; base: number; price: number; shop: number; pop: number; category: string }[] = [];
    if (!act.length) return { list, total: 0 };
    for (const it of catalog.items) {
      if (!act.some((pr) => promoApplies(db, pr, it.p, 'retail'))) continue;
      const pr = priceFor(db, it.p.id, { priceType: 'retail', date: today });
      if (!pr.promo) continue;
      list.push({ p: it.p, promo: pr.promo, base: pr.base, price: pr.price, shop: stockOf(db, it.p.id).shop.available, pop: catalog.popularity.get(it.p.id) ?? 0, category: it.category });
    }
    list.sort((a, b) => Number(b.shop > 0) - Number(a.shop > 0) || b.pop - a.pop);
    return { list: list.slice(0, 6), total: list.length };
  }, [db, version, catalog, today]);

  /* заканчивается в магазине — тот же список, что у склада («Мало в магазине») */
  const requested = useMemo(() => requestedMoves(db), [db, version]);
  const lowAll = useMemo(
    () =>
      stockLines(db)
        .filter((l) => l.flags.has('shopLow'))
        .sort((a, b) => a.info.shop.available - a.shopMin - (b.info.shop.available - b.shopMin) || (b.flow?.shopPerDay ?? 0) - (a.flow?.shopPerDay ?? 0)),
    [db, version],
  );
  const low = lowAll.slice(0, 6);

  const askMove = (p: Product) => {
    const r = requestMoveToShop(db, me.id, p, moveQty(db, p));
    if (!r.ok) toast(r.error, 'error');
    else toast(r.text);
  };

  /* мои задачи */
  const tasks = useMemo(
    () => myTasks.filter((t) => t.state === 'open' && t.due <= today).sort((a, b) => a.due.localeCompare(b.due) || (a.dueTime ?? '').localeCompare(b.dueTime ?? '')),
    [myTasks, today],
  );
  const doneToday = myTasks.filter((t) => t.state === 'done' && t.doneAt?.slice(0, 10) === today).length;
  const toggle = (id: ID) => {
    const r = dispatch('task.complete', { taskId: id }, me.id);
    if (!r.ok) toast(r.error, 'error');
    else toast('Задача выполнена');
  };

  return (
    <>
      <PageHeader
        section="overview"
        actions={
          <Button variant="primary" icon={<ScanBarcode />} onClick={() => navigate('/register')}>
            Перейти к кассе
          </Button>
        }
      />

      {!shift ? (
        <Notice tone="warn" title="Смена не открыта">
          Откройте смену на кассе — без неё продажи и возвраты не проводятся.
        </Notice>
      ) : null}

      <div className="grid-4">
        <Kpi label={shift ? `Чеков в смене с ${fmt.time(shift.openedAt)}` : 'Чеков в смене'} value={fmt.num(sum?.receipts ?? 0)} />
        <Kpi label="Выручка смены" value={fmt.money(sum ? sum.total - sum.refunds : 0)} />
        <Kpi label="Средний чек" value={fmt.money(sum && sum.receipts ? Math.round(sum.total / sum.receipts) : 0)} />
        <Kpi label="Наличных в кассе" value={fmt.money(sum?.expectedCash ?? 0)} />
      </div>

      <div className="reg-home-grid">
        <div className="col-4" style={{ minWidth: 0 }}>
          <Card
            title="Мои продажи за неделю"
            actions={
              <span className="t-13 ink-2 w-600 num">
                {fmt.money(weekTotal)} · {fmt.count(weekReceipts, 'чек', 'чека', 'чеков')}
              </span>
            }
          >
            <div className="reg-bars" role="img" aria-label="Продажи по дням за неделю">
              {week.map((d) => {
                const isToday = d.date === today;
                const h = Math.round((d.retail / weekMax) * 100);
                return (
                  <div key={d.date} className={cx('reg-bar', isToday && 'is-today')} title={`${fmt.date(d.date)}: ${fmt.money(d.retail)}, ${fmt.count(d.receiptsCount, 'чек', 'чека', 'чеков')}`}>
                    <span className="reg-bar-value num">{d.retail ? fmt.moneyShort(d.retail) : '—'}</span>
                    <span className="reg-bar-track">
                      <span className="reg-bar-fill" style={{ height: `${Math.max(d.retail ? 4 : 0, h)}%` }} />
                    </span>
                    <span className="reg-bar-label">
                      {isToday ? 'сегодня' : `${fmt.weekday(d.date, true)}, ${Number(d.date.slice(8, 10))}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="reg-home-list" title="Акции сегодня" actions={promos.total ? <Chip>{fmt.count(promos.total, 'товар', 'товара', 'товаров')}</Chip> : null} flush>
            {promos.list.length ? (
              <div className="list">
                {promos.list.map((x) => {
                  return (
                    <div key={x.p.id} className="list-row">
                      <ProductPhoto product={x.p} size={40} />
                      <div className="grow">
                        <EntityLink type="product" id={x.p.id}>
                          <span title={x.p.name}>{nbUnits(cartName(x.p))}</span>
                        </EntityLink>
                        <div className="cell-sub t-12 muted">{x.shop > 0 ? `В магазине ${fmt.qty(x.shop)}` : 'В магазине нет'}</div>
                      </div>
                      <PromoChip promo={x.promo} pct={promoPct(x.base, x.price)} today={today} short />
                      <s className="reg-old num">{fmt.price(x.base)}</s>
                      <b className="num t-14">{fmt.price(x.price)}</b>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="Сегодня акций нет">Все товары по обычной цене</EmptyState>
            )}
          </Card>
        </div>

        <div className="col-4" style={{ minWidth: 0 }}>
          <Card
            className="reg-home-list"
            title="Заканчивается в магазине"
            actions={lowAll.length ? <Chip>{fmt.count(lowAll.length, 'позиция', 'позиции', 'позиций')}</Chip> : null}
            flush
          >
            {low.length ? (
              <div className="list">
                {low.map((x) => {
                  const q = x.shopMove?.qty ?? moveQty(db, x.p);
                  return (
                    <div key={x.id} className="list-row">
                      <div className="grow">
                        <EntityLink type="product" id={x.id}>
                          <span title={x.p.name}>{nbUnits(cartName(x.p))}</span>
                        </EntityLink>
                        <div className="t-12 muted">
                          В магазине <b className={x.info.shop.available <= 0 ? 'c-bad' : 'ink-2'}>{fmt.qty(x.info.shop.available)}</b> · на складе {fmt.qty(x.info.warehouse.available)}
                        </div>
                      </div>
                      {requested.has(x.id) ? (
                        <Chip tone="info">Попросили склад</Chip>
                      ) : (
                        <Button size="sm" icon={<ArrowRightLeft />} onClick={() => askMove(x.p)} title={`Попросить склад перенести ${fmt.qty(q)}`}>
                          Перенести {fmt.qty(q)}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="Всего хватает">В магазине есть всё, что держим на полке</EmptyState>
            )}
          </Card>

          <Card title="Мои задачи на сегодня" actions={doneToday ? <span className="t-12 muted">сделано {doneToday}</span> : null} flush>
            {tasks.length ? (
              <div className="list">
                {tasks.map((t) => (
                  <label key={t.id} className="list-row reg-task">
                    <input type="checkbox" className="task-check" checked={false} onChange={() => toggle(t.id)} aria-label="Сделано" />
                    <span className="grow">
                      <span className="w-600" style={{ display: 'block' }}>
                        {fixNo(t.title)}
                      </span>
                      <span className="row t-12 muted" style={{ marginTop: 2 }}>
                        {t.due < today ? <Chip tone="bad">Просрочена с {fmt.date(t.due)}</Chip> : <span>{t.dueTime ? `до ${t.dueTime}` : 'сегодня'}</span>}
                        {t.priority === 'high' ? <Chip tone="warn">Срочно</Chip> : null}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <EmptyState title="Задач на сегодня нет">Всё сделано</EmptyState>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
