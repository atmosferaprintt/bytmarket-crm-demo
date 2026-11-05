import { useMemo, useState } from 'react';
import { Avatar, Card, DataTable, fmt, type Column } from '../../ui';
import { HBarList, PlanMeter, SegmentBar } from '../../ui/charts';
import { useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { ROLES } from '../../roles/roles';
import { VISIT_RESULT } from '../../ui';
import { staffRows, type StaffRow } from './calc';
import { KpiTile } from '../overview/KpiTile';
import { DocsDrawer, HowCalc, PartialMark, ReportTop, sum, useReportPeriod, type DocRow } from './parts';
import { groupFacts, planFor, saleFacts, topCategoryId } from '../overview/analytics';

export default function StaffReport() {
  const db = useDB();
  const version = useDBVersion();
  const { can } = useSession();
  const seeProfit = can('seeProfit');
  const { range, label } = useReportPeriod();
  const rows = useMemo(() => staffRows(db, range.from, range.to), [db, version, range.from, range.to]);
  const storePlan = useMemo(() => planFor(db, range.from, range.to), [db, version, range.from, range.to]);
  const [pick, setPick] = useState<StaffRow | null>(null);
  const [repPick, setRepPick] = useState<StaffRow | null>(null);

  const revenue = sum(rows, (r) => r.agg.revenue);
  const reps = rows.filter((r) => r.role === 'rep' && r.visits);
  const visitsDone = sum(reps, (r) => r.visits!.done);
  const visitsPlanned = sum(reps, (r) => r.visits!.planned);
  const visitOrders = sum(reps, (r) => r.visits!.order);

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
      key: 'docs',
      header: 'Покупок',
      align: 'right',
      render: (r) => <span title={`Чеков: ${r.receipts}, заказов: ${r.orders}. Повторные покупки: ${r.repeatDocs}`}>{fmt.num(r.receipts + r.orders)}</span>,
      sort: (r) => r.receipts + r.orders,
      total: (rs) => fmt.num(sum(rs, (r) => r.receipts + r.orders)),
    },
    { key: 'avg', header: 'Средний', align: 'right', render: (r) => (r.avg ? fmt.money(r.avg) : '—'), sort: (r) => r.avg },
    { key: 'new', header: 'Новых', align: 'right', render: (r) => (r.newClients ? fmt.num(r.newClients) : '—'), sort: (r) => r.newClients, total: (rs) => fmt.num(sum(rs, (r) => r.newClients)) },
    { key: 'disc', header: 'Скидки', align: 'right', render: (r) => (r.agg.manualDiscount > 0 ? fmt.money(r.agg.manualDiscount) : '—'), sort: (r) => r.agg.manualDiscount, total: (rs) => fmt.money(sum(rs, (r) => r.agg.manualDiscount)) },
    { key: 'ret', header: 'Возвраты', align: 'right', render: (r) => (r.agg.returns ? fmt.money(r.agg.returns) : '—'), sort: (r) => r.agg.returns, total: (rs) => fmt.money(sum(rs, (r) => r.agg.returns)) },
    { key: 'cancel', header: 'Отмены', align: 'right', render: (r) => (r.cancelled ? fmt.num(r.cancelled) : '—'), sort: (r) => r.cancelled },
    {
      key: 'debt',
      header: 'Долг клиентов',
      align: 'right',
      render: (r) => (r.clientsDebt ? <span title={r.clientsOverdue ? `Из них просрочено ${fmt.money(r.clientsOverdue)}` : undefined} className={r.clientsOverdue ? 'c-bad' : undefined}>{fmt.money(r.clientsDebt)}</span> : '—'),
      sort: (r) => r.clientsDebt,
      total: (rs) => fmt.money(sum(rs, (r) => r.clientsDebt)),
    },
    {
      key: 'plan',
      header: 'План',
      render: (r) => (r.plan ? <PlanMeter value={r.agg.revenue} plan={r.plan} title={`План на период: ${fmt.money(r.plan)}`} /> : <span className="faint">не задан</span>),
      sort: (r) => (r.plan ? r.agg.revenue / r.plan : -1),
      csv: (r) => (r.plan ? Math.round((r.agg.revenue / r.plan) * 100) : ''),
      width: 120,
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
          label="План магазина"
          value={storePlan ? fmt.pct((revenue / storePlan) * 100, 0) : 'не задан'}
          extra={storePlan ? <div className="rp-kpi-line">из <b>{fmt.money(storePlan)}</b></div> : undefined}
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
          ['Чеков и заказов, средний', 'Чеки продажи и заказы (без черновиков и отмен), созданные за период. Средний — их сумма ÷ количество.'],
          ['Новые клиенты', 'Клиент заведён в базе после 5 августа, и первая его покупка — в выбранном периоде. Засчитывается тому, кто её оформил. Повторные — покупки клиентов, которые уже покупали раньше.'],
          ['Скидки и отмены', 'Ручные скидки — то, что сотрудник дал сверх акции. Отмены — заказы ответственного, отменённые за период.'],
          ['Долг клиентов', 'Долг на сегодня по клиентам, закреплённым за сотрудником. Красным — если есть просрочка.'],
          ['План', 'Личный план на месяц × доля дней месяца в периоде. Выполнение = продажи ÷ план.'],
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
            <Card title="Что продавал">
              <HBarList rows={mix(pick)} format={fmt.money} empty="Продаж за период нет" />
            </Card>
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
