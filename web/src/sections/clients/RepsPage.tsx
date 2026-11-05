import { useMemo, useState } from 'react';
import { CalendarPlus, ChevronLeft, ChevronRight } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import type { Visit } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { firstOfMonth } from '../../data/dates';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { Avatar, Button, Card, DataTable, EmptyState, Input, Segmented, Select, StatusChip, VISIT_RESULT, VISIT_STATE, cx, fmt, type Column, type Tone } from '../../ui';
import { PlanVisitModal } from './PlanVisitModal';
import { repList, repStats, useIsPhone, visitSummary, type RepStats } from './lib';
import { PlanBar, PlanChip, planLabel, planTitle, visitTimes } from './parts';

interface VisitRow {
  v: Visit;
  client: string;
  point: string;
  address: string;
  rep: string;
  status: { label: string; tone: Tone };
  statusKey: string;
  orderNumber: number | null;
  orderTotal: number;
}

export function RepsPage() {
  const db = useDB();
  const version = useDBVersion();
  const { me, role, can } = useSession();
  const scoped = useScoped();
  const open = useOpenEntity();
  const today = db.meta.today;
  const [date, setDate] = useState(today);
  const [repFilter, setRepFilter] = useState<string>(role === 'rep' ? me.id : '');
  const [planning, setPlanning] = useState(false);
  const [phoneFilter, setPhoneFilter] = useState('all');
  const phone = useIsPhone();

  const reps = useMemo(() => (role === 'rep' ? [me] : repList(db)), [db, version, role, me]);
  const stats = useMemo(() => reps.map((r) => repStats(db, r)), [db, version, reps]);
  const monthFrom = firstOfMonth(today);
  const summary = useMemo(() => visitSummary(db, monthFrom, today, role === 'rep' ? me.id : repFilter || null), [db, version, monthFrom, today, role, me.id, repFilter]);

  const rows = useMemo<VisitRow[]>(() => {
    const idx = indexes(db);
    return scoped.visits
      .filter((v) => v.date === date && (!repFilter || v.repId === repFilter))
      .map((v) => {
        const c = idx.clients.get(v.clientId);
        const pt = c?.points.find((p) => p.id === v.pointId) ?? c?.points[0];
        const o = v.orderId ? idx.orders.get(v.orderId) : undefined;
        const statusKey = v.state === 'done' && v.result ? v.result : v.state;
        return {
          v,
          client: c?.name ?? '—',
          point: pt?.name ?? '',
          address: pt ? `${pt.address}${pt.district ? ` · ${pt.district}` : ''}` : '',
          rep: idx.employees.get(v.repId)?.short ?? '',
          status: v.state === 'done' && v.result ? VISIT_RESULT[v.result] : VISIT_STATE[v.state],
          statusKey,
          orderNumber: o?.number ?? null,
          orderTotal: o && o.state !== 'cancelled' ? o.total : 0,
        };
      });
  }, [db, version, scoped.visits, date, repFilter]);

  const columns: Column<VisitRow>[] = [
    { key: 'time', header: 'По плану', render: (r) => <span className="w-600">{r.v.time}</span>, sort: (r) => r.v.time, className: 'cl-col-time' },
    {
      key: 'doneAt',
      header: <span title="Когда представитель записал результат визита">Отметил</span>,
      render: (r) => (r.v.state !== 'planned' && r.v.doneAt ? fmt.time(r.v.doneAt) : <span className="faint">—</span>),
      sort: (r) => (r.v.state !== 'planned' && r.v.doneAt ? r.v.doneAt : null),
      csv: (r) => (r.v.state !== 'planned' && r.v.doneAt ? fmt.time(r.v.doneAt) : ''),
      className: 'cl-col-time',
    },
    { key: 'rep', header: 'Представитель', render: (r) => r.rep, sort: (r) => r.rep, hidden: role === 'rep' },
    {
      key: 'client',
      header: 'Клиент и точка',
      render: (r) => (
        <div className="cl-cell-client is-wide" title={`${r.client} · ${r.point} · ${r.address}`}>
          <div className="cell-title ellipsis">{r.client}</div>
          <div className="cell-sub ellipsis">{r.point ? `${r.point} · ${r.address}` : r.address}</div>
        </div>
      ),
      sort: (r) => r.client,
      csv: (r) => `${r.client} · ${r.point} · ${r.address}`,
    },
    { key: 'status', header: 'Результат', render: (r) => <StatusChip s={r.status} />, sort: (r) => r.status.label, csv: (r) => r.status.label },
    {
      key: 'note',
      header: 'Причина или комментарий',
      render: (r) => <span className="ink-2 cl-cell-note">{[r.v.refusalReason, r.v.comment].filter(Boolean).join(' · ') || <span className="faint">—</span>}</span>,
      csv: (r) => [r.v.refusalReason, r.v.comment].filter(Boolean).join(' · '),
    },
    {
      key: 'order',
      header: 'Заказ',
      align: 'right',
      render: (r) =>
        r.v.orderId && r.orderNumber ? (
          <span className="cl-cell-stack is-right">
            <span className="w-600 nowrap">{fmt.money(r.orderTotal)}</span>
            <EntityLink type="order" id={r.v.orderId} className="entity-link t-12">
              № {r.orderNumber}
            </EntityLink>
          </span>
        ) : (
          <span className="faint">—</span>
        ),
      csv: (r) => (r.orderNumber ? `№ ${r.orderNumber} · ${r.orderTotal}` : ''),
      sort: (r) => r.orderTotal,
      total: (rs) => fmt.money(rs.reduce((s, r) => s + r.orderTotal, 0)),
    },
  ];

  const resultFilter = {
    key: 'r',
    showCounts: true,
    options: [
      { value: 'all', label: 'Все' },
      { value: 'planned', label: 'Запланированы', test: (r: VisitRow) => r.statusKey === 'planned' },
      { value: 'order', label: 'Заказ', test: (r: VisitRow) => r.statusKey === 'order' },
      { value: 'callback', label: 'Перезвонить', test: (r: VisitRow) => r.statusKey === 'callback' },
      { value: 'refusal', label: 'Отказ', test: (r: VisitRow) => r.statusKey === 'refusal' },
      { value: 'missed', label: 'Пропущены', test: (r: VisitRow) => r.statusKey === 'missed' },
    ],
  };

  const shiftDate = (k: number) => setDate((d) => fmt.addDays(d, k));
  const phoneOpt = resultFilter.options.find((o) => o.value === phoneFilter);
  const phoneRows = (phoneOpt?.test ? rows.filter(phoneOpt.test) : rows).slice().sort((a, b) => a.v.time.localeCompare(b.v.time));
  const rel = fmt.relDate(date, today);
  const dateTitle = date === today ? 'Визиты сегодня' : rel === 'вчера' || rel === 'завтра' ? `Визиты ${rel}` : `Визиты ${fmt.date(date)}`;

  const toolbar = (
    <>
      <span className="row" style={{ gap: 4 }}>
        <Button size="sm" variant="ghost" iconOnly aria-label="Предыдущий день" onClick={() => shiftDate(-1)}>
          <ChevronLeft />
        </Button>
        <Input size="sm" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="cl-date-input" aria-label="День" />
        <Button size="sm" variant="ghost" iconOnly aria-label="Следующий день" onClick={() => shiftDate(1)}>
          <ChevronRight />
        </Button>
        {date !== today ? (
          <Button size="sm" variant="ghost" onClick={() => setDate(today)}>
            Сегодня
          </Button>
        ) : null}
      </span>
      {role !== 'rep' ? (
        <Select
          size="sm"
          className="cl-owner-select"
          value={repFilter}
          onChange={(e) => setRepFilter(e.target.value)}
          aria-label="Представитель"
          options={[{ value: '', label: 'Все представители' }, ...repList(db).map((r) => ({ value: r.id, label: r.name }))]}
        />
      ) : null}
    </>
  );

  const done = summary.done;
  const maxReason = summary.reasons[0]?.[1] ?? 0;
  const monthNom = fmt.monthName(today.slice(0, 7), false).toLowerCase();
  const visitsHead = done || summary.results.missed
    ? `выполнено ${fmt.num(done)}${summary.results.missed ? ` · пропущено ${fmt.num(summary.results.missed)}` : ''}`
    : 'визитов не было';

  return (
    <>
      <PageHeader
        section="clients"
        actions={
          can('planVisits') ? (
            <Button variant="primary" icon={<CalendarPlus />} onClick={() => setPlanning(true)}>
              Запланировать визит
            </Button>
          ) : null
        }
      />

      <div className={cx('cl-rep-grid', stats.length === 1 && 'is-single')}>
        {stats.map((s) => (
          <RepCard key={s.rep.id} s={s} active={repFilter === s.rep.id} onClick={role === 'rep' ? undefined : () => setRepFilter((f) => (f === s.rep.id ? '' : s.rep.id))} />
        ))}
        {!stats.length ? (
          <Card>
            <EmptyState title="Представителей нет">Добавьте сотрудника с ролью «Торговый представитель» в настройках</EmptyState>
          </Card>
        ) : null}
      </div>

      <div className="grid-2">
        <Card title={`Результаты визитов за ${monthNom}`} actions={<span className="muted t-13">{visitsHead}</span>}>
          <div className="cl-bars">
            {(
              [
                ['order', 'С заказом', 'is-ok'],
                ['callback', 'Перезвонить', 'is-info'],
                ['refusal', 'Отказ', 'is-bad'],
              ] as const
            ).map(([k, label, tone]) => {
              const n = summary.results[k];
              return (
                <div key={k} className="cl-bar-row" title={k === 'order' ? 'Доля выполненных визитов, после которых оформили заказ. Пропущенные визиты не считаются.' : undefined}>
                  <span className="cl-bar-label">{label}</span>
                  <span className="cl-bar-track">
                    <span className={cx('cl-bar-fill', tone)} style={{ width: `${done ? (n / done) * 100 : 0}%` }} />
                  </span>
                  <span className="cl-bar-value num">
                    {n}
                    <span className="muted"> · {fmt.pct(done ? (n / done) * 100 : null, 0)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
        <Card title={`Причины отказов за ${monthNom}`} actions={<span className="muted t-13">{fmt.count(summary.results.refusal, 'отказ', 'отказа', 'отказов')}</span>}>
          {summary.reasons.length ? (
            <div className="cl-bars">
              {summary.reasons.map(([reason, n]) => (
                <div key={reason} className="cl-bar-row">
                  <span className="cl-bar-label">{reason}</span>
                  <span className="cl-bar-track">
                    <span className="cl-bar-fill is-warn" style={{ width: `${maxReason ? (n / maxReason) * 100 : 0}%` }} />
                  </span>
                  <span className="cl-bar-value num">{n}</span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Отказов нет">С начала месяца ни одного отказа</EmptyState>
          )}
        </Card>
      </div>

      {phone ? (
        <Card title={dateTitle} flush>
          <div className="cl-phone-visits-tools">
            <span className="row" style={{ gap: 4 }}>
              <Button size="sm" variant="ghost" iconOnly aria-label="Предыдущий день" onClick={() => shiftDate(-1)}>
                <ChevronLeft />
              </Button>
              <Input size="sm" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="cl-date-input" aria-label="День" />
              <Button size="sm" variant="ghost" iconOnly aria-label="Следующий день" onClick={() => shiftDate(1)}>
                <ChevronRight />
              </Button>
            </span>
            <div className="cl-seg-scroll">
              <Segmented
                value={phoneFilter}
                onChange={setPhoneFilter}
                options={resultFilter.options.map((o) => ({ value: o.value, label: o.label, count: o.test ? rows.filter(o.test).length : rows.length }))}
              />
            </div>
          </div>
          {phoneRows.length ? (
            <div className="cl-list is-flush">
              {phoneRows.map((r) => (
                <button key={r.v.id} type="button" className="cl-list-row is-top" onClick={() => open('client', r.v.clientId)}>
                  <span className="cl-list-main">
                    <span className="w-600">{r.client}</span>
                    <span className="t-12 ink-2 w-600">{visitTimes(r.v)}</span>
                    {[r.point, r.v.refusalReason, r.v.comment].some(Boolean) ? <span className="muted t-12">{[r.point, r.v.refusalReason, r.v.comment].filter(Boolean).join(' · ')}</span> : null}
                  </span>
                  <span className="chips cl-list-chips">
                    <StatusChip s={r.status} />
                    {r.orderNumber ? <span className="t-12 w-600">№ {r.orderNumber} · {fmt.money(r.orderTotal)}</span> : null}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title={date === today ? 'Сегодня визитов нет' : 'В этот день визитов нет'}>Выберите другой день</EmptyState>
          )}
        </Card>
      ) : (
      <DataTable
        id="clients-visits"
        title={dateTitle}
        rows={rows}
        columns={columns}
        rowKey={(r) => r.v.id}
        filters={[resultFilter]}
        toolbar={toolbar}
        defaultSort={{ key: 'time', dir: 'asc' }}
        onRowClick={(r) => open('client', r.v.clientId)}
        exportName={can('export') ? `Визиты ${date}` : undefined}
        totalLabel={(n) => fmt.count(n, 'визит', 'визита', 'визитов')}
        empty={
          <EmptyState title={date === today ? 'Сегодня визитов нет' : 'В этот день визитов нет'}>
            {can('planVisits') ? 'Запланируйте визит кнопкой вверху' : 'Выберите другой день'}
          </EmptyState>
        }
      />
      )}

      {planning ? <PlanVisitModal repId={role === 'rep' ? me.id : repFilter || undefined} date={date >= today ? (date === today ? undefined : date) : undefined} onClose={() => setPlanning(false)} /> : null}
    </>
  );
}

function RepCard({ s, active, onClick }: { s: RepStats; active: boolean; onClick?: () => void }) {
  const body = (
    <>
      <div className="row-3">
        <Avatar name={s.rep.name} size="lg" />
        <div className="grow">
          <div className="t-16 w-700 ellipsis">{s.rep.name}</div>
          <div className="muted t-12">
            {fmt.count(s.clients, 'клиент', 'клиента', 'клиентов')} · {fmt.count(s.points, 'точка', 'точки', 'точек')}
          </div>
        </div>
      </div>
      <div className="col" style={{ gap: 8 }} title={planTitle(s)}>
        <div className="t-13 w-600">{planLabel(s)}</div>
        <div className="row t-13" style={{ gap: 8 }}>
          {s.plan ? (
            <span className="num w-600 nowrap grow">
              {fmt.money(s.fact)} <span className="muted w-500">из {fmt.money(s.plan)}</span>
            </span>
          ) : (
            <span className="grow" />
          )}
          <PlanChip s={s} />
        </div>
        <PlanBar s={s} />
      </div>
      <div className="cl-rep-facts">
        <div title="Выполнено визитов сегодня из назначенных">
          <div className="cl-fact-label">Визиты сегодня</div>
          <div className="cl-fact-value">
            {s.todayDone} <span className="muted">из {s.todayTotal}</span>
          </div>
        </div>
        <div title={s.monthDone ? `С заказом — ${s.monthWithOrder} из ${fmt.count(s.monthDone, 'выполненного визита', 'выполненных визитов', 'выполненных визитов')} с 1 ${s.monthGen}. Пропущенные визиты не входят.` : 'Выполненных визитов в этом месяце ещё нет'}>
          <div className="cl-fact-label">С заказом</div>
          <div className="cl-fact-value">{fmt.pct(s.orderShare, 0)}</div>
        </div>
        <div title={s.ordersToday ? `Оформлено сегодня: ${fmt.count(s.ordersToday, 'заказ', 'заказа', 'заказов')}${s.ordersTodayWaiting ? `, ждут подтверждения — ${s.ordersTodayWaiting}` : ''}. В план входят после отгрузки.` : 'Сегодня заказов ещё нет'}>
          <div className="cl-fact-label">Заказы сегодня</div>
          <div className="cl-fact-value">{s.ordersTodaySum ? fmt.money(s.ordersTodaySum) : '—'}</div>
        </div>
      </div>
    </>
  );
  if (!onClick) return <div className="card cl-rep-card">{body}</div>;
  return (
    <button type="button" className={cx('card cl-rep-card is-clickable', active && 'is-active')} onClick={onClick} aria-pressed={active} title={active ? 'Показать всех' : 'Показать визиты этого представителя'}>
      {body}
    </button>
  );
}
