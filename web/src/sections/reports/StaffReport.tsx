import { useEffect, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { Avatar, Card, DataTable, StatList, StatRow, fmt, type Column } from '../../ui';
import { HBarList, PlanMeter, SegmentBar } from '../../ui/charts';
import { useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { ROLES } from '../../roles/roles';
import { VISIT_RESULT } from '../../ui';
import { staffRows, type StaffRow } from './calc';
import { KpiTile } from '../overview/KpiTile';
import { DocsDrawer, HowCalc, ReportTop, WrapHead, sum, useReportPeriod, type DocRow } from './parts';
import { groupFacts, saleFacts, topCategoryId } from '../overview/analytics';
import { planProgress } from '../../data/kpis';
/** До 1500 px таблица сотрудников без второстепенных колонок: средний, новые, скидки, отмены — в панели сотрудника. */
function useCompact(): boolean {
  const q = '(max-width: 1500px)';
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const h = () => setV(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, []);
  return v;
}

const MON_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MON_NOM = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const monthIx = (ym: string) => +ym.slice(5, 7) - 1;

export default function StaffReport() {
  const db = useDB();
  const version = useDBVersion();
  const { can } = useSession();
  const seeProfit = can('seeProfit');
  const { range, label } = useReportPeriod();
  const rows = useMemo(() => staffRows(db, range.from, range.to), [db, version, range.from, range.to]);
  // план — месяц, в который попадает конец периода; та же формула, что в «Клиенты → Представители» и на обзоре
  const storePlan = useMemo(() => planProgress(db, null, range.to), [db, version, range.to]);
  const planMonth = MON_NOM[monthIx(storePlan.month)];
  const narrow = useCompact();
  const left = (r: StaffRow) => (r.plan.plan ? Math.max(0, r.plan.plan - r.plan.fact) : null);
  const [pick, setPick] = useState<StaffRow | null>(null);
  const [repPick, setRepPick] = useState<StaffRow | null>(null);

  const revenue = sum(rows, (r) => r.agg.revenue);
  const reps = rows.filter((r) => r.role === 'rep' && r.visits);
  const visitsDone = sum(reps, (r) => r.visits!.done);
  const visitsPlanned = sum(reps, (r) => r.visits!.planned);
  const visitOrders = sum(reps, (r) => r.visits!.order);
  // чеков и заказов; «Средний» = «Продажи» ÷ это число — ровно по тем цифрам, что стоят в строке
  const docsOf = (r: StaffRow) => r.receipts + r.orders;
  const avgOf = (r: StaffRow) => (docsOf(r) ? Math.round(r.agg.revenue / docsOf(r)) : 0);
  const known = (r: StaffRow) => (r.agg.lines ? r.agg.knownLines / r.agg.lines : 1);
  const partial = rows.some((r) => known(r) < 1);

  const cols: Column<StaffRow>[] = [
    {
      key: 'name',
      header: 'Сотрудник',
      render: (r) => (
        <span className="rp-person">
          <Avatar name={r.e.name} size="sm" />
          <span className="rp-name">
            <span className="cell-title">{r.e.name}</span>
            <span className="cell-sub">{ROLES[r.role].short}</span>
          </span>
        </span>
      ),
      sort: (r) => r.e.name,
      csv: (r) => `${r.e.name} (${ROLES[r.role].short})`,
    },
    { key: 'revenue', header: 'Продажи', align: 'right', render: (r) => fmt.money(r.agg.revenue), sort: (r) => r.agg.revenue, total: (rs) => fmt.money(sum(rs, (r) => r.agg.revenue)) },
    {
      key: 'profit',
      header: partial ? (
        <span className="rp-head-mark" title="Неполные данные: у части проданных товаров не указана себестоимость, поэтому прибыль занижена. Доля строк с себестоимостью — в подсказке у суммы">
          Прибыль
          <Info className="rp-warn-icon" aria-label="Неполные данные" />
        </span>
      ) : (
        'Прибыль'
      ),
      align: 'right',
      hidden: !seeProfit,
      render: (r) => (
        <span title={[r.margin !== null ? `Маржа ${fmt.pct(r.margin)}` : 'Себестоимость неизвестна', known(r) < 1 ? `себестоимость известна по ${Math.round(known(r) * 100)} % строк` : ''].filter(Boolean).join(', ')}>
          {fmt.money(r.agg.profit)}
        </span>
      ),
      sort: (r) => r.agg.profit,
      total: (rs) => fmt.money(sum(rs, (r) => r.agg.profit)),
    },
    {
      key: 'docs',
      header: <WrapHead width={64}>Чеков и заказов</WrapHead>,
      align: 'right',
      render: (r) => <span title={`Чеков: ${r.receipts}, заказов: ${r.orders}. Повторные покупки: ${r.repeatDocs}`}>{fmt.num(docsOf(r))}</span>,
      sort: docsOf,
      csv: docsOf,
      total: (rs) => fmt.num(sum(rs, docsOf)),
    },
    {
      key: 'avg',
      header: <span title="Продажи ÷ чеков и заказов">Средний</span>,
      align: 'right',
      hidden: narrow,
      render: (r) => (avgOf(r) ? fmt.money(avgOf(r)) : '—'),
      sort: avgOf,
      csv: avgOf,
      total: (rs) => {
        const n = sum(rs, docsOf);
        return n ? fmt.money(Math.round(sum(rs, (r) => r.agg.revenue) / n)) : '—';
      },
    },
    { key: 'new', header: 'Новых', align: 'right', hidden: narrow, render: (r) => (r.newClients ? fmt.num(r.newClients) : '—'), sort: (r) => r.newClients, total: (rs) => fmt.num(sum(rs, (r) => r.newClients)) },
    { key: 'disc', header: 'Скидки', align: 'right', hidden: narrow, render: (r) => (r.agg.manualDiscount > 0 ? fmt.money(r.agg.manualDiscount) : '—'), sort: (r) => r.agg.manualDiscount, total: (rs) => fmt.money(sum(rs, (r) => r.agg.manualDiscount)) },
    { key: 'ret', header: 'Возвраты', align: 'right', render: (r) => (r.agg.returns ? fmt.money(r.agg.returns) : '—'), sort: (r) => r.agg.returns, total: (rs) => fmt.money(sum(rs, (r) => r.agg.returns)) },
    { key: 'cancel', header: 'Отмены', align: 'right', hidden: narrow, render: (r) => (r.cancelled ? fmt.num(r.cancelled) : '—'), sort: (r) => r.cancelled },
    {
      key: 'debt',
      header: <WrapHead width={64}>Долг клиентов</WrapHead>,
      align: 'right',
      render: (r) => (r.clientsDebt ? <span title={r.clientsOverdue ? `Из них просрочено ${fmt.money(r.clientsOverdue)}` : undefined} className={r.clientsOverdue ? 'c-bad' : undefined}>{fmt.money(r.clientsDebt)}</span> : '—'),
      sort: (r) => r.clientsDebt,
      total: (rs) => fmt.money(sum(rs, (r) => r.clientsDebt)),
    },
    {
      key: 'plan',
      header: (
        <span className="rp-plan-head" title={`План на ${planMonth}: продажи с 1 числа к плану всего месяца. По графику — сколько должно быть на ${fmt.date(storePlan.to)}`}>
          План месяца
          <span className="rp-plan-sched">по графику {fmt.pct(storePlan.expectedPct, 0)}</span>
        </span>
      ),
      render: (r) =>
        r.plan.plan ? (
          <PlanMeter value={r.plan.fact} plan={r.plan.plan} expectedPct={r.plan.expectedPct} title={`План на ${planMonth}: ${fmt.money(r.plan.plan)}, продано ${fmt.money(r.plan.fact)}`} />
        ) : (
          <span className="faint">не задан</span>
        ),
      sort: (r) => r.plan.pct ?? -1,
      csv: (r) => r.plan.pct ?? '',
      csvHeader: 'Выполнено плана, %',
      width: 130,
    },
    {
      key: 'planSum',
      header: <span title={`План продаж на ${planMonth}`}>План, ₽</span>,
      csvHeader: `План на ${planMonth}, ₽`,
      align: 'right',
      render: (r) => (r.plan.plan ? fmt.money(r.plan.plan) : <span className="faint">—</span>),
      sort: (r) => r.plan.plan,
      csv: (r) => r.plan.plan ?? '',
      total: (rs) => fmt.money(sum(rs, (r) => r.plan.plan ?? 0)),
    },
    {
      key: 'left',
      header: <span data-hint="reports.staff.left" title={`Сколько осталось продать до плана на ${planMonth}: план минус продано с 1 числа`}>Осталось</span>,
      csvHeader: 'Осталось до плана, ₽',
      align: 'right',
      render: (r) => {
        const x = left(r);
        if (x === null) return <span className="faint">—</span>;
        return x === 0 ? <span className="c-ok w-600">выполнен</span> : fmt.money(x);
      },
      sort: (r) => left(r),
      csv: (r) => left(r) ?? '',
      total: (rs) => fmt.money(sum(rs, (r) => left(r) ?? 0)),
    },
  ];

  type V = StaffRow & { visits: NonNullable<StaffRow['visits']> };
  const vcols: Column<V>[] = [
    { key: 'name', header: 'Представитель', render: (r) => <span className="rp-person"><Avatar name={r.e.name} size="sm" /><span className="cell-title">{r.e.name}</span></span>, sort: (r) => r.e.name, csv: (r) => r.e.name },
    { key: 'planned', header: 'Назначено', align: 'right', render: (r) => fmt.num(r.visits.planned), sort: (r) => r.visits.planned, total: (rs) => fmt.num(sum(rs, (r) => r.visits.planned)) },
    { key: 'done', header: 'Сделано', align: 'right', render: (r) => fmt.num(r.visits.done), sort: (r) => r.visits.done, total: (rs) => fmt.num(sum(rs, (r) => r.visits.done)) },
    { key: 'missed', header: 'Пропущено', align: 'right', render: (r) => (r.visits.missed ? <span className="c-bad">{fmt.num(r.visits.missed)}</span> : '—'), sort: (r) => r.visits.missed, total: (rs) => fmt.num(sum(rs, (r) => r.visits.missed)) },
    {
      key: 'results',
      header: 'Результат',
      render: (r) => (
        <SegmentBar
          ariaLabel="Результаты визитов"
          parts={[
            { key: 'order', label: VISIT_RESULT.order.label, value: r.visits.order, slot: 1 },
            { key: 'callback', label: VISIT_RESULT.callback.label, value: r.visits.callback, slot: 2 },
            { key: 'refusal', label: VISIT_RESULT.refusal.label, value: r.visits.refusal, slot: 3 },
          ]}
        />
      ),
      csv: (r) => `заказ ${r.visits.order}, перезвонить ${r.visits.callback}, отказ ${r.visits.refusal}`,
      width: 280,
    },
    { key: 'conv', header: 'С заказом', align: 'right', render: (r) => (r.visits.done ? fmt.pct((r.visits.order / r.visits.done) * 100, 0) : '—'), sort: (r) => (r.visits.done ? r.visits.order / r.visits.done : 0), csv: (r) => (r.visits.done ? Math.round((r.visits.order / r.visits.done) * 100) : '') },
    { key: 'reason', header: 'Частый отказ', render: (r) => r.visits.topRefusal ?? '—', sort: (r) => r.visits.topRefusal ?? '' },
    { key: 'sum', header: 'Заказы с визитов', align: 'right', render: (r) => fmt.money(r.visits.orderSum), sort: (r) => r.visits.orderSum, total: (rs) => fmt.money(sum(rs, (r) => r.visits.orderSum)) },
  ];

  const docsFor = (r: StaffRow): DocRow[] => {
    const hi = range.to + 'T99';
    const cl = new Map(db.clients.map((c) => [c.id, c.name]));
    const out: DocRow[] = [];
    for (const rc of db.receipts) {
      if (rc.sellerId !== r.e.id || rc.at < range.from || rc.at > hi) continue;
      out.push({ key: rc.id, at: rc.at, kind: 'Чек', title: `${rc.kind === 'refund' ? 'Возврат по чеку' : 'Чек'} № ${rc.number}`, sub: `${fmt.time(rc.at)} · ${rc.clientId ? cl.get(rc.clientId) ?? '' : 'без карты клиента'} · ${fmt.count(rc.lines.length, 'позиция', 'позиции', 'позиций')}`, amount: rc.kind === 'refund' ? -rc.total : rc.total, entity: { type: 'receipt', id: rc.id } });
    }
    for (const o of db.orders) {
      if (o.ownerId !== r.e.id || o.createdAt < range.from || o.createdAt > hi || o.state === 'draft') continue;
      out.push({ key: o.id, at: o.createdAt, kind: 'Заказ', title: `Заказ № ${o.number}${o.state === 'cancelled' ? ' · отменён' : ''}`, sub: cl.get(o.clientId) ?? '', amount: o.state === 'cancelled' ? 0 : o.total, entity: { type: 'order', id: o.id } });
    }
    return out;
  };

  const mix = (r: StaffRow) => {
    const facts = saleFacts(db, range.from, range.to).filter((f) => f.employeeId === r.e.id);
    const pIx = new Map(db.products.map((p) => [p.id, p]));
    const g = groupFacts(facts, (f) => {
      const p = pIx.get(f.productId);
      return p ? topCategoryId(db, p.categoryId) : null;
    });
    const cats = new Map(db.categories.map((c) => [c.id, c.name]));
    return [...g.entries()]
      .map(([id, a]) => ({ key: id, label: cats.get(id) ?? id, value: a.revenue }))
      .filter((x) => x.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  };

  return (
    <>
      <ReportTop />
      <div className="rp-kpis">
        <KpiTile label="Продажи сотрудников" value={fmt.money(revenue)} />
        <KpiTile
          label={`План магазина на ${planMonth}`}
          hint="reports.staff.plan"
          value={storePlan.pct !== null ? fmt.pct(storePlan.pct, 0) : 'не задан'}
          title={storePlan.plan ? `Продано ${fmt.money(storePlan.fact)} из ${fmt.money(storePlan.plan)}` : undefined}
          extra={storePlan.plan ? <div className="rp-kpi-line">По графику <b>{fmt.pct(storePlan.expectedPct, 0)}</b></div> : undefined}
        />
        <KpiTile label="Новые клиенты" value={fmt.num(sum(rows, (r) => r.newClients))} />
        <KpiTile label="Ручные скидки" value={fmt.money(sum(rows, (r) => r.agg.manualDiscount))} />
        <KpiTile
          label="Визиты представителей"
          value={`${fmt.num(visitsDone)} из ${fmt.num(visitsPlanned)}`}
          extra={<div className="rp-kpi-line">С заказом <b>{visitsDone ? fmt.pct((visitOrders / visitsDone) * 100, 0) : '—'}</b></div>}
        />
      </div>

      <div className="rp-tight">
      <DataTable
        id="rp-staff"
        hint="reports.staff.table"
        title="Сотрудники"
        rows={rows}
        columns={cols}
        rowKey={(r) => r.e.id}
        defaultSort={{ key: 'revenue', dir: 'desc' }}
        filters={[
          {
            key: 'role',
            showCounts: true,
            options: [
              { value: 'all', label: 'Все' },
              { value: 'manager', label: 'Менеджеры', test: (r) => r.role === 'manager' },
              { value: 'rep', label: 'Представители', test: (r) => r.role === 'rep' },
              { value: 'seller', label: 'Продавцы', test: (r) => r.role === 'seller' },
            ],
          },
        ]}
        onRowClick={(r) => setPick(r)}
        exportName={`Сотрудники ${label}`}
        pageSize={30}
      />
      </div>

      {reps.length ? (
        <div className="rp-tight">
        <DataTable
          title="Визиты представителей"
          hint="reports.staff.visits"
          rows={reps as V[]}
          columns={vcols}
          rowKey={(r) => r.e.id}
          defaultSort={{ key: 'done', dir: 'desc' }}
          onRowClick={(r) => setRepPick(r)}
          exportName={`Визиты ${label}`}
        />
        </div>
      ) : (
        <Card title="Визиты представителей">
          <div className="rp-empty">За период визитов не было</div>
        </Card>
      )}

      <HowCalc
        rows={[
          ['Чей результат', 'Опт засчитывается ответственному за заказ, розница — продавцу, который пробил чек. Одна продажа — один сотрудник, двойного счёта нет. Визит представителя считается визитом, а деньги по заказу с визита — только по заказу.'],
          ['Продажи', 'Как в отчёте по товарам: опт — по отгрузке, розница — по чекам, возвраты — минусом в день возврата.'],
          ['Чеков и заказов, средний', 'Чеки продажи и заказы (без черновиков и отмен), созданные за период. Средний — продажи сотрудника ÷ чеков и заказов, по цифрам из той же строки.'],
          ['Новые клиенты', 'Клиент заведён в базе после 5 августа, и первая его покупка — в выбранном периоде. Засчитывается тому, кто её оформил. Повторные — покупки клиентов, которые уже покупали раньше.'],
          ['Скидки и отмены', 'Ручные скидки — то, что сотрудник дал сверх акции. Отмены — заказы ответственного, отменённые за период.'],
          ['Долг клиентов', 'Долг на сегодня по клиентам, закреплённым за сотрудником. Красным — если есть просрочка.'],
          ['План месяца', `Продажи сотрудника с 1 ${MON_GEN[monthIx(storePlan.month)]} к его плану на весь месяц — по той же формуле, что в разделе «Клиенты → Представители» и на обзоре. «По графику» — доля прошедших дней месяца: столько должно быть выполнено к сегодняшнему дню. Риска на полосе — там, где надо быть. «Осталось» — план минус продано с 1 числа.`],
          ['Прибыль', 'Валовая, по строкам с известной себестоимостью. Чистую прибыль не считаем.'],
        ]}
      />

      {pick ? (
        <DocsDrawer
          title={pick.e.name}
          sub={`${ROLES[pick.role].short} · ${label} · продажи ${fmt.money(pick.agg.revenue)}`}
          onClose={() => setPick(null)}
          rows={docsFor(pick)}
          extra={
            <>
              <Card title={`Итоги · ${label}`} hint="reports.staff.pick">
                <StatList>
                  <StatRow label="Продажи" value={fmt.money(pick.agg.revenue)} />
                  <StatRow label="Чеков и заказов" value={`${fmt.num(docsOf(pick))}${avgOf(pick) ? ` · средний ${fmt.money(avgOf(pick))}` : ''}`} />
                  {pick.newClients ? <StatRow label="Новых клиентов" value={fmt.num(pick.newClients)} /> : null}
                  {pick.agg.manualDiscount > 0 ? <StatRow label="Ручные скидки" value={fmt.money(pick.agg.manualDiscount)} /> : null}
                  {pick.cancelled ? <StatRow label="Отменённых заказов" value={fmt.num(pick.cancelled)} /> : null}
                  {seeProfit ? <StatRow label="Валовая прибыль" value={`${fmt.money(pick.agg.profit)}${pick.margin !== null ? ` · маржа ${fmt.pct(pick.margin)}` : ''}`} /> : null}
                  <StatRow label={`План на ${planMonth}`} value={pick.plan.plan ? fmt.money(pick.plan.plan) : 'не задан'} />
                  {pick.plan.plan ? (
                    <StatRow
                      label={`Продано с 1 ${MON_GEN[monthIx(storePlan.month)]}`}
                      value={
                        <span className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                          <PlanMeter value={pick.plan.fact} plan={pick.plan.plan} expectedPct={pick.plan.expectedPct} title={`По графику на ${fmt.date(pick.plan.to)} — ${fmt.pct(pick.plan.expectedPct, 0)}`} />
                        </span>
                      }
                    />
                  ) : null}
                  {pick.plan.plan ? <StatRow label="Осталось до плана" value={left(pick) ? fmt.money(left(pick)!) : <span className="c-ok">План выполнен</span>} /> : null}
                  <StatRow
                    label="Долг его клиентов"
                    value={
                      pick.clientsDebt ? (
                        <span>
                          {fmt.money(pick.clientsDebt)}
                          {pick.clientsOverdue ? <span className="c-bad"> · просрочено {fmt.money(pick.clientsOverdue)}</span> : null}
                        </span>
                      ) : (
                        'нет'
                      )
                    }
                  />
                </StatList>
              </Card>
              <Card title="Что продавал">
                <HBarList rows={mix(pick)} format={fmt.money} empty="Продаж за период нет" />
              </Card>
            </>
          }
        />
      ) : null}
      {repPick ? (
        <VisitsDrawer rep={repPick} from={range.from} to={range.to} label={label} onClose={() => setRepPick(null)} />
      ) : null}
    </>
  );
}

function VisitsDrawer({ rep, from, to, label, onClose }: { rep: StaffRow; from: string; to: string; label: string; onClose: () => void }) {
  const db = useDB();
  const clients = new Map(db.clients.map((c) => [c.id, c]));
  const orders = new Map(db.orders.map((o) => [o.id, o]));
  return (
        <DocsDrawer
          title={`Визиты: ${rep.e.name}`}
          sub={label}
          amountLabel="Заказ"
          onClose={onClose}
          rows={db.visits
            .filter((v) => v.repId === rep.e.id && v.date >= from && v.date <= to)
            .map((v) => {
              const c = clients.get(v.clientId);
              const o = v.orderId ? orders.get(v.orderId) : undefined;
              const res = v.result ? VISIT_RESULT[v.result].label : v.state === 'missed' ? 'Пропущен' : 'Запланирован';
              return {
                key: v.id,
                at: v.date + 'T' + v.time,
                kind: 'Визит',
                title: c?.name ?? 'Клиент',
                sub: `${v.time} · ${res}${v.refusalReason ? ': ' + v.refusalReason.toLowerCase() : ''}`,
                amount: o ? o.total : null,
                entity: o ? { type: 'order' as const, id: o.id } : { type: 'client' as const, id: v.clientId },
              };
            })}
        />
  );
}
