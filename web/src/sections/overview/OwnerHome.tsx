import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight, FileSpreadsheet, Info, Printer, RefreshCw } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { Card, Chip, EmptyState, MoreMenu, Segmented, cx, fmt, toast } from '../../ui';
import { ChartLegend, ComboChart, PlanMeter } from '../../ui/charts';
import { nowDemo, useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { arrangeSignals, computeSignals, loadResolved, signalsForRole, trackAttention } from './signals';
import { AssignedMark, SignalLine, taskOf, useSignalActions, useTaskMarks } from './SignalParts';
import { PeriodBar } from './PeriodBar';
import { curName, periodQuery, prevName, rangeText, useSharedPeriod } from './period';
import { noCostCount, nowAt } from './analytics';
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
  const { can, role, me } = useSession();
  const today = db.meta.today;
  // по умолчанию — месяц, в первую неделю месяца — прошлый полный (defaultPeriod); тот же период откроется в отчётах
  const [period, setPeriod] = useSharedPeriod(today);
  const [series, setSeries] = useState<SeriesKey>('all');
  const nowTime = timeOfNow(nowDemo());

  const d = useMemo(() => computeOverview(db, period, nowTime), [db, version, period, nowTime]);
  const points = useMemo(() => chartPoints(db, period, series, nowTime), [db, version, period, series, nowTime]);
  const [resolved] = useState(loadResolved);
  const all = useMemo(() => signalsForRole(computeSignals(db, today), role), [db, version, today, role]);
  const active = useMemo(() => all.filter((s) => !resolved[s.id]), [all, resolved]);
  const arranged = useMemo(() => arrangeSignals(active), [active]);
  // тот же учёт, что на вкладке «Требует внимания»: что решилось — уходит в «Разобрано сегодня»
  useMemo(() => trackAttention(role, today, nowAt().slice(11, 16), all, active, arranged.important), [role, today, all, active, arranged]);
  // число на вкладке и у «Все» — число проблем, а не строк
  const signalLines = active.length;
  const urgent = active.filter((s) => s.severity === 'high').length;
  const marks = useTaskMarks();
  const noCost = useMemo(() => noCostCount(db), [db, version]);
  const actions = useSignalActions();
  const ix = useMemo(() => ({ clients: new Map(db.clients.map((c) => [c.id, c])), suppliers: new Map(db.suppliers.map((s) => [s.id, s])) }), [db, version]);

  const s = d.sales;
  const ps = d.prevSales;
  const seeProfit = can('seeProfit');
  const incomplete = s.costKnownShare < 0.999;
  const curLabel = curName(period, today);
  const prevLabel = prevName(period);
  const q = periodQuery({ from: d.from, to: d.to });
  const net = s.grossProfit - d.expenses.total;
  const prevNet = ps && d.prevExpenses !== null ? ps.grossProfit - d.prevExpenses : null;

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [
      ['Показатель', rangeText({ from: d.from, to: d.to }), d.cmp ? rangeText({ from: d.prevFrom, to: d.prevTo }) : 'Нет данных'],
      ['Продажи, ₽', s.revenue, ps?.revenue ?? null],
      ['Розница, ₽', s.retail, ps?.retail ?? null],
      ['Опт, ₽', s.wholesale, ps?.wholesale ?? null],
      [`План ${monthGen(d.plan.month)}, ₽`, d.plan.plan, null],
      [`Выполнено плана ${monthGen(d.plan.month)}, %`, d.plan.pct, null],
    ];
    if (seeProfit) {
      rows.push(['Валовая прибыль, ₽', Math.round(s.grossProfit), ps ? Math.round(ps.grossProfit) : null]);
      rows.push(['Маржа, %', Math.round(s.marginPct * 10) / 10, ps ? Math.round(ps.marginPct * 10) / 10 : null]);
      rows.push(['Расходы, ₽', d.expenses.total, d.prevExpenses]);
      rows.push(['Прибыль после расходов, ₽', Math.round(net), prevNet !== null ? Math.round(prevNet) : null]);
    }
    rows.push(['Поступило денег, ₽', d.cash.total, d.prevCash]);
    rows.push([]);
    rows.push(['Остаток', `На ${fmt.date(d.debtDate)}`, d.debtCmpDate ? `На ${fmt.date(d.debtCmpDate)}` : 'Нет данных']);
    rows.push(['Долги покупателей, ₽', d.debt.debt, d.prevDebt]);
    rows.push(['Просрочено, ₽', d.debt.overdue, null]);
    rows.push(['Долги поставщикам, ₽', d.sup.debt, d.prevSup]);
    rows.push(['Поставщикам на этой неделе, ₽', d.week.total, null]);
    rows.push(['Средний чек, ₽', s.avgReceipt, ps?.avgReceipt ?? null]);
    rows.push([]);
    rows.push(['День', 'Продажи, ₽', 'Прошлый период, ₽']);
    for (const p of points) rows.push([p.title, p.value, p.prev]);
    downloadCsv(`Обзор ${rangeText({ from: d.from, to: d.to })}`, rows);
    toast('Обзор выгружен для Excel');
  };

  const pl = d.plan;
  const planTitle =
    pl.plan !== null
      ? `План магазина на ${fmt.monthName(pl.month, false).toLowerCase()}: ${fmt.money(pl.plan)}, продано ${fmt.money(pl.fact)}. По графику на ${fmt.date(pl.to)} — ${fmt.pct(pl.expectedPct, 0)}`
      : 'План на этот месяц не задан';
  const asOf = `на ${fmt.date(d.debtDate)}`;
  const debtCmpTitle = d.debtCmpDate ? `К ${fmt.date(d.debtCmpDate)}` : undefined;

  const marginPp = ps && ps.marginPct ? s.marginPct - ps.marginPct : null;
  const wk = d.week;
  const weekCap = wk.overdue.length ? 2 : 3;
  // одна лишняя поставка — показываем её саму, а не «ещё 1»
  const weekRows = wk.thisWeek.slice(0, wk.thisWeek.length === weekCap + 1 ? weekCap + 1 : weekCap);
  const weekMore = wk.thisWeek.slice(weekRows.length);
  const writeoffRows = d.losses.writeoffs.slice(0, 3);
  const writeoffRest = d.losses.writeoffs.slice(3).reduce((z, w) => z + w.value, 0);
  const delayedTop = d.delayed.slice(0, 4);

  return (
    <>
      <PageHeader
        section="overview"
        counts={{ attention: signalLines }}
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
          hint="overview.sales"
          value={fmt.money(s.revenue)}
          d={delta(s.revenue, ps?.revenue ?? null)}
          onClick={() => navigate(`/reports?${q}`)}
          extra={
            <div className="ov-kpi-line" title={planTitle}>
              {pl.plan !== null ? (
                <>
                  <span>План {monthGen(pl.month)}</span>
                  <PlanMeter value={pl.fact} plan={pl.plan} expectedPct={pl.expectedPct} />
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
            hint="overview.profit"
            d={delta(s.grossProfit, ps?.grossProfit ?? null)}
            onClick={() => navigate(`/reports?${q}`)}
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
          hint="overview.cash"
          value={fmt.money(d.cash.total)}
          d={delta(d.cash.total, d.prevCash)}
          onClick={() => navigate(`/money?${q}`)}
          extra={
            <div className="ov-kpi-line" title={`Наличными в кассу: ${fmt.money(d.cash.cash)}. Ожидающие подтверждения переводы не входят`}>
              <span>На счёт</span>
              <b>{fmt.money(d.cash.bank)}</b>
            </div>
          }
        />
        <KpiTile
          label="Долги покупателей"
          hint="overview.debts"
          value={fmt.money(d.debt.debt)}
          // долг — остаток на дату; сравнение с одним днём прошлого месяца колеблется от оплат в начале месяца и пугает зря
          asOf={asOf}
          dTitle={debtCmpTitle}
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
          hint="overview.suppliers"
          value={fmt.money(d.sup.debt)}
          asOf={asOf}
          dTitle={debtCmpTitle}
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
          hint="overview.chart"
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
          <div className="ov-split-wrap">
            <div className="ov-split">
              <SplitItem label="Розница" value={fmt.money(s.retail)} d={delta(s.retail, ps?.retail ?? null)} />
              <SplitItem label="Опт" value={fmt.money(s.wholesale)} d={delta(s.wholesale, ps?.wholesale ?? null)} />
              <SplitItem label="Средний чек" value={fmt.money(s.avgReceipt)} d={delta(s.avgReceipt, ps?.avgReceipt ?? null)} />
            </div>
            {seeProfit ? (
              <div className="ov-split">
                <SplitItem label="Валовая прибыль" value={fmt.money(s.grossProfit)} d={delta(s.grossProfit, ps?.grossProfit ?? null)} title="Выручка минус себестоимость проданного" />
                <SplitItem
                  label="Расходы"
                  value={fmt.money(d.expenses.total)}
                  d={delta(d.expenses.total, d.prevExpenses)}
                  good="down"
                  onClick={() => navigate(`/money/expenses?${q}`)}
                  title={d.expenses.byCategory.length ? `Из журнала денег: ${d.expenses.byCategory.slice(0, 4).map((x) => `${x.category.toLowerCase()} ${fmt.money(x.amount)}`).join(', ')}` : 'Расходов за период не было'}
                />
                <SplitItem
                  label="После расходов"
                  hint="overview.net"
                  value={fmt.money(net)}
                  d={delta(net, prevNet)}
                  tone={net < 0 ? 'bad' : undefined}
                  title="Валовая прибыль минус расходы за период из журнала денег: аренда, зарплата, топливо, недостачи"
                />
              </div>
            ) : null}
          </div>
        </Card>

        <Card
          className="ov-sig-card"
          hint="overview.signals"
          flush
          title={
            <span className="row">
              Требует внимания
              {urgent ? <Chip tone="bad">{fmt.count(urgent, 'срочный', 'срочных', 'срочных')}</Chip> : null}
            </span>
          }
          actions={
            <button type="button" className="link-button ov-all" onClick={() => navigate('/overview/attention')}>
              Все {signalLines}
              <ChevronRight />
            </button>
          }
        >
          {signalLines ? (
            <div className="list ov-sig-list">
              {topSignals(arranged.important.length ? arranged.important : arranged.rest, 6).map((sig) => (
                <SignalLine
                  key={sig.id}
                  s={sig}
                  actionLabel={actions.label(sig)}
                  onAction={() => actions.run(sig)}
                  assigned={(() => {
                    const t = taskOf(marks, sig);
                    return t ? <AssignedMark task={t} meId={me.id} db={db} /> : null;
                  })()}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="Всё спокойно">Сигналов нет: оплаты, заказы и остатки в порядке</EmptyState>
          )}
        </Card>
      </div>

      <div className="ov-four">
        <Card
          title="Платежи на неделю"
          actions={<GoButton onClick={() => navigate('/money/suppliers')} label="Долги поставщикам" />}
        >
          <div className="ov-four-value" title={`Просрочено и до ${fmt.date(wk.weekEnd)} — так же считают «Деньги → Долги поставщикам» и рабочий стол бухгалтера`}>
            {fmt.money(wk.total)}
          </div>
          {wk.total > 0 || wk.nextWeekSum > 0 ? (
            <div className="ov-mini">
              {wk.overdue.length ? (
                <button type="button" className="ov-mini-row is-click" onClick={() => navigate('/money/suppliers')} title="Срок оплаты прошёл">
                  <span className="ov-mini-date c-bad">просрочено</span>
                  <span className="ov-mini-main">{fmt.count(wk.overdue.length, 'поставка', 'поставки', 'поставок')}</span>
                  <span className="ov-mini-val c-bad">{fmt.money(wk.overdueSum)}</span>
                </button>
              ) : null}
              {weekRows.map((u) => (
                <div key={u.purchaseId} className="ov-mini-row">
                  <span className="ov-mini-date" title={fmt.date(u.dueDate)}>
                    {shortDay(u.dueDate)}
                  </span>
                  <span className="ov-mini-main" title={ix.suppliers.get(u.supplierId)?.name}>
                    <EntityLink type="supplier" id={u.supplierId}>
                      {shortParty(ix.suppliers.get(u.supplierId)?.name ?? 'Поставщик')}
                    </EntityLink>
                  </span>
                  <span className="ov-mini-val">{fmt.money(u.amount)}</span>
                </div>
              ))}
              {weekMore.length ? <MiniRow label={`Ещё ${fmt.count(weekMore.length, 'поставка', 'поставки', 'поставок')} до воскресенья`} value={fmt.money(weekMore.reduce((z, u) => z + u.amount, 0))} /> : null}
              {wk.nextWeekCount ? <MiniRow label="Следующая неделя" value={fmt.money(wk.nextWeekSum)} tone="muted" onClick={() => navigate('/money/suppliers')} /> : null}
            </div>
          ) : (
            <div className="ov-mini-empty">На этой неделе платить некому</div>
          )}
        </Card>

        <Card title="Стоимость остатков" actions={<GoButton onClick={() => navigate('/stock')} label="Остатки" />}>
          <div className="ov-four-value" title={noCost.active + noCost.inactive ? `По себестоимости. Без себестоимости ${fmt.count(noCost.active, 'товар', 'товара', 'товаров')} в продаже${noCost.inactive ? ` и ${fmt.count(noCost.inactive, 'снятый', 'снятых', 'снятых')} с продажи` : ''} — их остаток в сумму не вошёл` : 'По себестоимости'}>
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

        <Card title="Заказы с задержкой" actions={<GoButton onClick={() => navigate('/overview/attention?kind=order_delay')} label="Все задержки" />}>
          <div className="ov-four-value">{d.delayed.length ? fmt.count(d.delayed.length, 'заказ', 'заказа', 'заказов') : 'Нет'}</div>
          {delayedTop.length ? (
            <div className="ov-mini">
              {delayedTop.map((x) => (
                <button key={x.order.id} type="button" className="ov-mini-row is-click" onClick={() => open('order', x.order.id)} title={`${ix.clients.get(x.order.clientId)?.name ?? ''}, заказ № ${x.order.number}. ${x.reason}`}>
                  <span className="ov-mini-main">{shortParty(ix.clients.get(x.order.clientId)?.name ?? `Заказ № ${x.order.number}`)}</span>
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

const MON_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** «ноября» из 'YYYY-MM' */
function monthGen(ym: string): string {
  return MON_GEN[+ym.slice(5, 7) - 1];
}

/** Короткое имя для узкой строки: «ИП Логинова · «Удача»» → «ИП Логинова», «ООО «Бумажный мир Юг»» → «Бумажный мир Юг». Полное — в подсказке. */
function shortParty(name: string): string {
  const dot = name.indexOf(' · ');
  if (dot > 0) return name.slice(0, dot);
  const q = name.match(/«[^«»]+»/);
  return q ? q[0] : name;
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

function SplitItem({ label, value, d, good = 'up', onClick, title, tone, hint }: { label: string; value: string; d: Delta; good?: 'up' | 'down'; onClick?: () => void; title?: string; tone?: 'bad'; hint?: string }) {
  const cls = !d || d.dir === 'flat' ? 'muted' : d.dir === good ? 'c-ok' : 'c-bad';
  const body = (
    <>
      <span className="ov-split-label">{label}</span>
      <span className="ov-split-line">
        <span className={tone === 'bad' ? 'ov-split-value c-bad' : 'ov-split-value'}>{value}</span>
        {d ? <span className={cx('ov-split-delta', cls)}>{d.text}</span> : null}
      </span>
    </>
  );
  return onClick ? (
    <button type="button" className="ov-split-item is-click" onClick={onClick} title={title} data-hint={hint}>
      {body}
    </button>
  ) : (
    <div className="ov-split-item" title={title} data-hint={hint}>
      {body}
    </div>
  );
}

function MiniRow({ label, value, tone, onClick }: { label: string; value: string; tone?: 'warn' | 'bad' | 'muted'; onClick?: () => void }) {
  const body = (
    <>
      <span className="ov-mini-main">{label}</span>
      <span className={tone === 'warn' ? 'ov-mini-val c-warn' : tone === 'bad' ? 'ov-mini-val c-bad' : tone === 'muted' ? 'ov-mini-val is-muted' : 'ov-mini-val'}>{value}</span>
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
