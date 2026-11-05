import { useMemo, useState } from 'react';
import { firstOfMonth, plusDays } from '../../data/dates';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, FileSpreadsheet, Info, Printer, RefreshCw } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { Card, Chip, EmptyState, MoreMenu, Segmented, fmt, toast } from '../../ui';
import { ChartLegend, ComboChart, PlanMeter } from '../../ui/charts';
import { nowDemo, useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { computeSignals, loadResolved } from './signals';
import { SignalLine, useSignalActions } from './SignalParts';
import { PeriodBar } from './PeriodBar';
import { curName, prevName, rangeText, type PeriodState } from './period';
import { chartPoints, computeOverview, type SeriesKey } from './overviewData';
import { downloadCsv } from './csv';
import { KpiTile, deltaOf, type Delta } from './KpiTile';
import './overview.css';

const delta = deltaOf;
const ppText = (v: number) => (Math.abs(v) < 0.05 ? '0 п. п.' : `${v > 0 ? '+' : '−'}${fmt.num(Math.abs(v), 1)} п. п.`);

/** Обзор владельца: как идут дела за период и что требует решения сегодня. */
export default function OwnerHome() {
  const db = useDB();
  const version = useDBVersion();
  const navigate = useNavigate();
  const open = useOpenEntity();
  const { can } = useSession();
  const today = db.meta.today;
  // В первую неделю месяца по умолчанию — прошлый полный месяц: пять неполных дней дают ложный минус ко всему.
  const [period, setPeriod] = useState<PeriodState>(() => ({ kind: 'month', anchor: Number(today.slice(8, 10)) <= 7 ? plusDays(firstOfMonth(today), -1) : today }));
  const [series, setSeries] = useState<SeriesKey>('all');
  const nowTime = timeOfNow(nowDemo());

  const d = useMemo(() => computeOverview(db, period, nowTime), [db, version, period, nowTime]);
  const points = useMemo(() => chartPoints(db, period, series, nowTime), [db, version, period, series, nowTime]);
  const signals = useMemo(() => computeSignals(db, today), [db, version, today]);
  const [resolved] = useState(loadResolved);
  const active = signals.filter((s) => !resolved[s.id]);
  const urgent = active.filter((s) => s.severity === 'high').length;
  const actions = useSignalActions();
  const ix = useMemo(() => ({ clients: new Map(db.clients.map((c) => [c.id, c])), suppliers: new Map(db.suppliers.map((s) => [s.id, s])) }), [db, version]);

  const s = d.sales;
  const ps = d.prevSales;
  const seeProfit = can('seeProfit');
  const incomplete = s.costKnownShare < 0.999;
  const curLabel = curName(period, today);
  const prevLabel = prevName(period);

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [
      ['Показатель', rangeText({ from: d.from, to: d.to }), d.cmp ? rangeText({ from: d.prevFrom, to: d.prevTo }) : 'Нет данных'],
      ['Продажи, ₽', s.revenue, ps?.revenue ?? null],
      ['Розница, ₽', s.retail, ps?.retail ?? null],
      ['Опт, ₽', s.wholesale, ps?.wholesale ?? null],
      ['План, ₽', d.plan, null],
    ];
    if (seeProfit) {
      rows.push(['Валовая прибыль, ₽', Math.round(s.grossProfit), ps ? Math.round(ps.grossProfit) : null]);
      rows.push(['Маржа, %', Math.round(s.marginPct * 10) / 10, ps ? Math.round(ps.marginPct * 10) / 10 : null]);
    }
    rows.push(['Поступило денег, ₽', d.cash.total, d.prevCash]);
    rows.push(['Долги покупателей, ₽', d.debt.debt, d.prevDebt]);
    rows.push(['Просрочено, ₽', d.debt.overdue, null]);
    rows.push(['Долги поставщикам, ₽', d.sup.debt, d.prevSup]);
    rows.push(['Средний чек, ₽', s.avgReceipt, ps?.avgReceipt ?? null]);
    rows.push([]);
    rows.push(['День', 'Продажи, ₽', 'Прошлый период, ₽']);
    for (const p of points) rows.push([p.title, p.value, p.prev]);
    downloadCsv(`Обзор ${rangeText({ from: d.from, to: d.to })}`, rows);
    toast('Обзор выгружен для Excel');
  };

  const planTitle =
    d.plan !== null
      ? `План магазина на ${rangeText({ from: d.from, to: d.to })}: ${fmt.money(d.plan)}${d.planMonth ? `. На весь месяц — ${fmt.money(d.planMonth)}` : ''}`
      : 'План на этот период не задан';

  const marginPp = ps && ps.marginPct ? s.marginPct - ps.marginPct : null;
  const lateList = d.upcoming.filter((u) => u.dueDate < today);
  const lateSum = lateList.reduce((z, u) => z + u.amount, 0);
  const upcoming = d.upcoming.filter((u) => u.dueDate >= today).slice(0, lateList.length ? 3 : 4);
  const writeoffRows = d.losses.writeoffs.slice(0, 3);
  const writeoffRest = d.losses.writeoffs.slice(3).reduce((z, w) => z + w.value, 0);
  const delayedTop = d.delayed.slice(0, 4);

  return (
    <>
      <PageHeader
        section="overview"
        counts={{ attention: active.length }}
        actions={
          <span className="ov-head-menu">
            <MoreMenu
              items={[
                { label: 'Выгрузить в Excel', icon: <FileSpreadsheet />, onClick: exportCsv },
                { label: 'Печать', icon: <Printer />, onClick: () => window.print() },
              ]}
            />
          </span>
        }
      />

      <PeriodBar
        value={period}
        onChange={setPeriod}
        today={today}
        start={db.meta.startDate}
        right={
          <span className="ov-stamp" title="Цифры пересчитываются сразу после каждой операции">
            <RefreshCw />
            Данные на {fmt.date(today)}, {nowTime}
          </span>
        }
      />

      <div className="ov-kpis">
        <KpiTile
          label="Продажи"
          value={fmt.money(s.revenue)}
          d={delta(s.revenue, ps?.revenue ?? null)}
          onClick={() => navigate('/reports')}
          extra={
            <div className="ov-kpi-line" title={planTitle}>
              {d.plan !== null ? (
                <>
                  <PlanMeter value={s.revenue} plan={d.plan} />
                  <span>плана</span>
                </>
              ) : (
                <span>План не задан</span>
              )}
            </div>
          }
        />
        {seeProfit ? (
          <KpiTile
            label={
              <span className="ov-kpi-label" title={incomplete ? `Неполные данные: себестоимость известна по ${fmt.pct(s.costKnownShare * 100, 0)} строк продаж. Прибыль и маржа посчитаны только по ним` : 'Выручка минус себестоимость проданного, возвраты вычтены'}>
                Валовая прибыль
                {incomplete ? <Info className="ov-info" aria-label="Неполные данные" /> : null}
              </span>
            }
            value={fmt.money(s.grossProfit)}
            d={delta(s.grossProfit, ps?.grossProfit ?? null)}
            onClick={() => navigate('/reports')}
            extra={
              <div className="ov-kpi-line">
                <span>Маржа</span>
                <b>{fmt.pct(s.marginPct)}</b>
                {marginPp !== null ? <span className={marginPp > 0.05 ? 'c-ok' : marginPp < -0.05 ? 'c-bad' : undefined}>{ppText(marginPp)}</span> : null}
              </div>
            }
          />
        ) : null}
        <KpiTile
          label="Поступило денег"
          value={fmt.money(d.cash.total)}
          d={delta(d.cash.total, d.prevCash)}
          onClick={() => navigate('/money')}
          extra={
            <div className="ov-kpi-line" title={`Наличными в кассу: ${fmt.money(d.cash.cash)}. Ожидающие подтверждения переводы не входят`}>
              <span>На счёт</span>
              <b>{fmt.money(d.cash.bank)}</b>
            </div>
          }
        />
        <KpiTile
          label="Долги покупателей"
          value={fmt.money(d.debt.debt)}
          d={delta(d.debt.debt, d.prevDebt)}
          good="down"
          onClick={() => navigate('/money/debts')}
          extra={
            <div className="ov-kpi-line">
              <span>Просрочено</span>
              <b className={d.debt.overdue > 0 ? 'c-bad' : undefined}>{fmt.money(d.debt.overdue)}</b>
            </div>
          }
        />
        <KpiTile
          label="Долги поставщикам"
          value={fmt.money(d.sup.debt)}
          d={delta(d.sup.debt, d.prevSup)}
          good="down"
          onClick={() => navigate('/money/suppliers')}
          extra={
            <div
              className="ov-kpi-line"
              title={d.nextPay ? `Ближайший платёж по графику: ${fmt.date(d.nextPay.date)}, ${fmt.money(d.nextPay.amount)}` : 'Платежей по графику нет'}
            >
              {d.sup.overdue > 0 ? (
                <>
                  <span>Просрочено</span>
                  <b className="c-bad">{fmt.money(d.sup.overdue)}</b>
                </>
              ) : d.nextPay ? (
                <>
                  <span>{fmt.date(d.nextPay.date)}</span>
                  <b>{fmt.money(d.nextPay.amount)}</b>
                </>
              ) : (
                <span>Платежей по графику нет</span>
              )}
            </div>
          }
        />
      </div>

      <div className="ov-main">
        <Card
          className="ov-chart-card"
          title={
            <span className="row-3 ov-chart-head">
              {period.kind === 'today' ? 'Продажи по часам' : 'Продажи по дням'}
              <ChartLegend
                items={[
                  { label: curLabel, kind: 'bar' },
                  { label: prevLabel, kind: 'line' },
                ]}
              />
            </span>
          }
          actions={
            <Segmented
              ariaLabel="Какие продажи"
              value={series}
              onChange={setSeries}
              options={[
                { value: 'all', label: 'Всего' },
                { value: 'retail', label: 'Розница' },
                { value: 'wholesale', label: 'Опт' },
              ]}
            />
          }
        >
          <ComboChart
            points={points}
            height={240}
            fill
            valueName={curLabel}
            prevName={prevLabel}
            format={fmt.money}
            ariaLabel={`${series === 'all' ? 'Продажи' : series === 'retail' ? 'Розничные продажи' : 'Оптовые продажи'}: ${curLabel.toLowerCase()} столбцами, ${prevLabel.toLowerCase()} линией`}
            markKey={period.kind === 'today' ? undefined : today}
          />
          <div className="ov-split">
            <SplitItem label="Розница" value={fmt.money(s.retail)} d={delta(s.retail, ps?.retail ?? null)} />
            <SplitItem label="Опт" value={fmt.money(s.wholesale)} d={delta(s.wholesale, ps?.wholesale ?? null)} />
            <SplitItem label="Средний чек" value={fmt.money(s.avgReceipt)} d={delta(s.avgReceipt, ps?.avgReceipt ?? null)} />
          </div>
        </Card>

        <Card
          className="ov-sig-card"
          flush
          title={
            <span className="row">
              Требует внимания
              {urgent ? <Chip tone="bad">{fmt.count(urgent, 'срочный', 'срочных', 'срочных')}</Chip> : null}
            </span>
          }
          actions={
            <button type="button" className="link-button ov-all" onClick={() => navigate('/overview/attention')}>
              Все {active.length}
              <ChevronRight />
            </button>
          }
        >
          {active.length ? (
            <div className="list ov-sig-list">
              {topSignals(active, 6).map((sig) => (
                <SignalLine key={sig.id} s={sig} actionLabel={actions.label(sig)} onAction={() => actions.run(sig)} />
              ))}
            </div>
          ) : (
            <EmptyState title="Всё спокойно">Сигналов нет: оплаты, заказы и остатки в порядке</EmptyState>
          )}
        </Card>
      </div>

      <div className="ov-four">
        <Card
          title="Платежи поставщикам"
          actions={<GoButton onClick={() => navigate('/money/suppliers')} label="Все долги поставщикам" />}
        >
          <div className="ov-four-value">{fmt.money(d.sup.debt)}</div>
          {upcoming.length || lateList.length ? (
            <div className="ov-mini">
              {lateList.length ? (
                <button type="button" className="ov-mini-row is-click" onClick={() => navigate('/money/suppliers')} title="Срок оплаты прошёл">
                  <span className="ov-mini-date c-bad">просрочено</span>
                  <span className="ov-mini-main">{fmt.count(lateList.length, 'поставка', 'поставки', 'поставок')}</span>
                  <span className="ov-mini-val c-bad">{fmt.money(lateSum)}</span>
                </button>
              ) : null}
              {upcoming.map((u) => (
                <div key={u.purchaseId} className="ov-mini-row">
                  <span className="ov-mini-date" title={fmt.date(u.dueDate)}>
                    {shortDay(u.dueDate)}
                  </span>
                  <span className="ov-mini-main">
                    <EntityLink type="supplier" id={u.supplierId}>
                      {ix.suppliers.get(u.supplierId)?.name ?? 'Поставщик'}
                    </EntityLink>
                  </span>
                  <span className="ov-mini-val">{fmt.money(u.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="ov-mini-empty">Все поставщики оплачены</div>
          )}
        </Card>

        <Card title="Стоимость остатков" actions={<GoButton onClick={() => navigate('/stock')} label="Остатки" />}>
          <div className="ov-four-value" title={d.stock.unknownCost ? `По себестоимости. Без себестоимости ${fmt.count(d.stock.unknownCost, 'товар', 'товара', 'товаров')} — не вошли в сумму` : 'По себестоимости'}>
            {fmt.money(d.stock.total)}
          </div>
          <div className="ov-mini">
            <MiniRow label="Склад" value={fmt.money(d.stock.warehouse)} />
            <MiniRow label="Магазин" value={fmt.money(d.stock.shop)} />
            <MiniRow label={`Без движения ${d.stock.dead.days} дней`} value={fmt.money(d.stock.dead.value)} tone="warn" onClick={() => navigate('/reports?list=dead')} />
            <MiniRow label="Ниже минимума" value={fmt.count(d.stock.belowMin, 'позиция', 'позиции', 'позиций')} onClick={() => navigate('/reports?list=low')} />
          </div>
        </Card>

        <Card title="Возвраты и списания" actions={<GoButton onClick={() => navigate('/sales/returns')} label="Возвраты" />}>
          <div className="ov-four-value" title="Возвраты — по цене продажи, списания — по себестоимости">
            {fmt.money(d.losses.total)}
          </div>
          <div className="ov-mini">
            <MiniRow label="Возвраты покупателей" value={fmt.money(d.losses.returns)} />
            {writeoffRows.map((w) => (
              <MiniRow key={w.key} label={`Списано: ${w.reason}`} value={fmt.money(w.value)} />
            ))}
            {writeoffRest > 0 ? <MiniRow label="Списано: прочее" value={fmt.money(writeoffRest)} /> : null}
            {!writeoffRows.length ? <MiniRow label="Списаний не было" value="—" /> : null}
          </div>
        </Card>

        <Card title="Заказы с задержкой" actions={<GoButton onClick={() => navigate('/overview/attention')} label="Все задержки" />}>
          <div className="ov-four-value">{d.delayed.length ? fmt.count(d.delayed.length, 'заказ', 'заказа', 'заказов') : 'Нет'}</div>
          {delayedTop.length ? (
            <div className="ov-mini">
              {delayedTop.map((x) => (
                <button key={x.order.id} type="button" className="ov-mini-row is-click" onClick={() => open('order', x.order.id)} title={x.reason}>
                  <span className="ov-mini-main">{ix.clients.get(x.order.clientId)?.name ?? `Заказ № ${x.order.number}`}</span>
                  <Chip tone={x.tone}>{x.label}</Chip>
                </button>
              ))}
            </div>
          ) : (
            <div className="ov-mini-empty">Все заказы идут по графику</div>
          )}
        </Card>
      </div>
      {actions.modal}
    </>
  );
}

const MON3 = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
/** «7 ноя» */
function shortDay(iso: string): string {
  return `${+iso.slice(8, 10)} ${MON3[+iso.slice(5, 7) - 1]}`;
}

/** «14:32» из того, что вернул nowDemo: строка даты-времени, Date или число. */
function timeOfNow(v: unknown): string {
  if (typeof v === 'string' && v.length >= 16) return v.slice(11, 16);
  const d = v instanceof Date ? v : typeof v === 'number' ? new Date(v) : null;
  if (d && !Number.isNaN(d.getTime())) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return '18:00';
}

/** Шесть главных сигналов: по важности, но не больше двух одного вида — чтобы было видно разное. */
function topSignals<T extends { kind: string }>(list: T[], n: number): T[] {
  const out: T[] = [];
  const per = new Map<string, number>();
  for (const s of list) {
    if (out.length >= n) break;
    if ((per.get(s.kind) ?? 0) >= 2) continue;
    per.set(s.kind, (per.get(s.kind) ?? 0) + 1);
    out.push(s);
  }
  for (const s of list) {
    if (out.length >= n) break;
    if (!out.includes(s)) out.push(s);
  }
  return out;
}

function SplitItem({ label, value, d }: { label: string; value: string; d: Delta }) {
  return (
    <div>
      <span className="ov-split-label">
        {label}
        {d ? <span className={d.dir === 'up' ? 'c-ok' : d.dir === 'down' ? 'c-bad' : 'muted'}>{d.text}</span> : null}
      </span>
      <span className="ov-split-value">{value}</span>
    </div>
  );
}

function MiniRow({ label, value, tone, onClick }: { label: string; value: string; tone?: 'warn' | 'bad'; onClick?: () => void }) {
  const body = (
    <>
      <span className="ov-mini-main">{label}</span>
      <span className={tone === 'warn' ? 'ov-mini-val c-warn' : tone === 'bad' ? 'ov-mini-val c-bad' : 'ov-mini-val'}>{value}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="ov-mini-row is-click" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="ov-mini-row">{body}</div>
  );
}

function GoButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={onClick} aria-label={label} title={label}>
      <ChevronRight />
    </button>
  );
}
