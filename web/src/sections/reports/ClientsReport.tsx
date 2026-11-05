import { useMemo } from 'react';
import { Chip, DataTable, StatusChip, fmt, overdueStatus, type Column, type FilterDef } from '../../ui';
import { useOpenEntity } from '../../shell/entities';
import { useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { CLIENT_SEGMENT_NAMES, type ClientSegment } from '../../data/types';
import { clientRows, type ClientRow } from './calc';
import { KpiTile } from '../overview/KpiTile';
import { HowCalc, PartialMark, ReportTop, sum, useReportPeriod } from './parts';
import { clientDebtNow } from '../overview/analytics';

function Activity({ r }: { r: ClientRow }) {
  if (r.activity === 'stopped') return <Chip tone="bad" title={`Последние 30 дней покупок нет, до этого — ${fmt.money(r.prev30)}`}>Перестал покупать</Chip>;
  if (r.activity === 'drop') return <Chip tone="bad" title={`30 дней: ${fmt.money(r.last30)}, до этого: ${fmt.money(r.prev30)}`}>Снижение {fmt.delta(r.activityPct, 0)}</Chip>;
  if (r.activity === 'growth') return <Chip tone="ok" title={`30 дней: ${fmt.money(r.last30)}, до этого: ${fmt.money(r.prev30)}`}>Рост {fmt.delta(r.activityPct, 0)}</Chip>;
  if (r.activity === 'new') return <Chip tone="info">Новый</Chip>;
  return <Chip title={`30 дней: ${fmt.money(r.last30)}, до этого: ${fmt.money(r.prev30)}`}>Ровно</Chip>;
}

const ACTIVITY_TEXT: Record<ClientRow['activity'], string> = { stopped: 'Перестал покупать', drop: 'Снижение', growth: 'Рост', new: 'Новый', flat: 'Ровно' };

export default function ClientsReport() {
  const db = useDB();
  const version = useDBVersion();
  const { can } = useSession();
  const seeProfit = can('seeProfit');
  const open = useOpenEntity();
  const { range, label, today } = useReportPeriod();
  const rows = useMemo(() => clientRows(db, range.from, range.to), [db, version, range.from, range.to]);
  const debt = useMemo(() => clientDebtNow(db), [db, version]);

  const buying = rows.filter((r) => r.docs > 0);
  const revenue = sum(rows, (r) => r.agg.revenue);
  const docs = sum(rows, (r) => r.docs);
  const falling = rows.filter((r) => r.activity === 'drop' || r.activity === 'stopped');
  const offer = rows.filter((r) => r.missing.length > 0 && r.agg.revenue > 0).slice(0, 40);

  const segs = (Object.keys(CLIENT_SEGMENT_NAMES) as ClientSegment[]).filter((s) => rows.some((r) => r.c.segment === s));
  const filters: FilterDef<ClientRow>[] = [
    {
      key: 'seg',
      showCounts: true,
      options: [{ value: 'all', label: 'Все' }, ...segs.map((s) => ({ value: s, label: CLIENT_SEGMENT_NAMES[s] === 'Розничный покупатель' ? 'Розница' : CLIENT_SEGMENT_NAMES[s], test: (r: ClientRow) => r.c.segment === s }))],
    },
    {
      key: 'flag',
      showCounts: true,
      options: [
        { value: 'all', label: 'Все' },
        { value: 'drop', label: 'Снизили активность', test: (r) => r.activity === 'drop' || r.activity === 'stopped' },
        { value: 'overdue', label: 'С просрочкой', test: (r) => r.overdue > 0 },
      ],
    },
  ];

  const cols: Column<ClientRow>[] = [
    {
      key: 'name',
      header: 'Клиент',
      render: (r) => (
        <div className="rp-name">
          <div className="cell-title">{r.c.name}</div>
          <div className="cell-sub">
            {CLIENT_SEGMENT_NAMES[r.c.segment]}
            {r.c.ownerId ? ` · ${r.ownerName}` : ''}
          </div>
        </div>
      ),
      sort: (r) => r.c.name,
      csv: (r) => r.c.name,
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
    { key: 'docs', header: 'Покупок', align: 'right', render: (r) => fmt.num(r.docs), sort: (r) => r.docs, total: (rs) => fmt.num(sum(rs, (r) => r.docs)) },
    { key: 'avg', header: 'Средний', align: 'right', render: (r) => (r.docs ? fmt.money(r.avg) : '—'), sort: (r) => r.avg },
    {
      key: 'freq',
      header: 'Раз в, дней',
      align: 'right',
      render: (r) => {
        const n = r.everyDays ?? r.c.orderEveryDays;
        return n ? <span title={`Покупает в среднем раз в ${fmt.count(n, 'день', 'дня', 'дней')}${r.c.orderEveryDays ? `. Привычный срок в карточке — ${r.c.orderEveryDays}` : ''}`}>{fmt.num(n)}</span> : '—';
      },
      sort: (r) => r.everyDays ?? r.c.orderEveryDays ?? 999,
      csv: (r) => r.everyDays ?? r.c.orderEveryDays ?? '',
    },
    { key: 'last', header: 'Последняя', align: 'right', render: (r) => fmt.relDate(r.lastAt, today), sort: (r) => r.lastAt ?? '', csv: (r) => r.lastAt?.slice(0, 10) ?? '' },
    { key: 'activity', header: 'Активность', render: (r) => <Activity r={r} />, sort: (r) => r.activityPct ?? (r.activity === 'new' ? 999 : 0), csv: (r) => ACTIVITY_TEXT[r.activity] },
    {
      key: 'debt',
      header: 'Долг',
      align: 'right',
      render: (r) =>
        r.debt ? (
          <span className="rp-debt" title={r.overdue ? `Из них просрочено ${fmt.money(r.overdue)}` : undefined}>
            {fmt.money(r.debt)}
            {r.overdue > 0 ? <StatusChip s={overdueStatus(r.overdueDays)} /> : null}
          </span>
        ) : (
          '—'
        ),
      sort: (r) => r.debt,
      csv: (r) => r.debt,
      total: (rs) => fmt.money(sum(rs, (r) => r.debt)),
    },
    {
      key: 'ontime',
      header: 'В срок',
      align: 'right',
      render: (r) =>
        r.onTime === null ? (
          <span className="faint">—</span>
        ) : (
          <span className={r.onTime < 0.6 ? 'c-bad w-700' : r.onTime < 0.85 ? 'c-warn w-700' : undefined} title={`Из ${fmt.count(r.dueOrders, 'заказа', 'заказов', 'заказов')} с наступившим сроком оплачено вовремя ${Math.round(r.onTime * r.dueOrders)}`}>
            {fmt.pct(r.onTime * 100, 0)}
          </span>
        ),
      sort: (r) => r.onTime,
      csv: (r) => (r.onTime === null ? '' : Math.round(r.onTime * 100)),
    },
  ];

  const offerCols: Column<ClientRow>[] = [
    { key: 'name', header: 'Клиент', render: (r) => <span className="cell-title">{r.c.name}</span>, sort: (r) => r.c.name, csv: (r) => r.c.name },
    { key: 'seg', header: 'Тип', render: (r) => CLIENT_SEGMENT_NAMES[r.c.segment], sort: (r) => r.c.segment, csv: (r) => CLIENT_SEGMENT_NAMES[r.c.segment] },
    { key: 'missing', header: 'Не берёт у нас', render: (r) => <span className="chips">{r.missing.map((m) => <Chip key={m} tone="green">{m}</Chip>)}</span>, csv: (r) => r.missing.join(', ') },
    { key: 'owner', header: 'Ответственный', render: (r) => r.ownerName, sort: (r) => r.ownerName },
    { key: 'revenue', header: 'Продажи за период', align: 'right', render: (r) => fmt.money(r.agg.revenue), sort: (r) => r.agg.revenue },
  ];

  return (
    <>
      <ReportTop />
      <div className="rp-kpis">
        <KpiTile label="Покупали за период" value={fmt.count(buying.length, 'клиент', 'клиента', 'клиентов')} />
        <KpiTile label="Продажи клиентам" value={fmt.money(revenue)} />
        <KpiTile label="Средний заказ" value={fmt.money(docs ? revenue / docs : 0)} />
        <KpiTile label="Долг покупателей" value={fmt.money(debt.debt)} extra={<div className="rp-kpi-line">Просрочено <b className={debt.overdue ? 'c-bad' : undefined}>{fmt.money(debt.overdue)}</b></div>} />
        <KpiTile label="Снизили активность" value={fmt.count(falling.length, 'клиент', 'клиента', 'клиентов')} />
      </div>

      <div className="rp-tight">
      <DataTable
        id="rp-clients"
        title="Клиенты"
        rows={rows}
        columns={cols}
        rowKey={(r) => r.c.id}
        defaultSort={{ key: 'revenue', dir: 'desc' }}
        search={{ placeholder: 'Клиент, ИНН, ответственный', text: (r) => `${r.c.name} ${r.c.inn ?? ''} ${r.ownerName}` }}
        filters={filters}
        onRowClick={(r) => open('client', r.c.id)}
        exportName={`Клиенты ${label}`}
        pageSize={25}
      />
      </div>

      {offer.length ? (
        <DataTable
          title="Можно предложить"
          rows={offer}
          columns={offerCols}
          rowKey={(r) => r.c.id}
          defaultSort={{ key: 'revenue', dir: 'desc' }}
          onRowClick={(r) => open('client', r.c.id)}
          exportName="Можно предложить"
          pageSize={8}
          dense
        />
      ) : null}

      <HowCalc
        rows={[
          ['Продажи клиента', 'Оптовые заказы — по отгрузке, розница — по чекам с привязанной картой клиента. Чеки без клиента сюда не входят. Возвраты вычитаются в день возврата.'],
          ['Покупок и средний заказ', 'Число разных заказов и чеков клиента с продажей за период. Средний заказ = продажи ÷ покупок.'],
          ['Частота', 'Средний промежуток между днями покупок за всю историю в базе (с 5 августа). Если покупок меньше трёх — привычный срок из карточки клиента.'],
          ['Активность', 'Продажи за последние 30 дней против 30 дней перед ними. Снижение — меньше на 30 % и больше; «Перестал покупать» — за 30 дней покупок нет. Не зависит от выбранного периода.'],
          ['Долг и просрочка', 'На сегодня: отгружено минус оплачено по каждому заказу. Просрочка — заказы, у которых прошёл срок оплаты (дата отгрузки + отсрочка клиента). Цифры совпадают с разделом «Деньги».'],
          ['Платит в срок', 'Доля заказов с наступившим сроком, оплаченных полностью до срока. Учитываются только проведённые оплаты.'],
          ['Можно предложить', 'Категории, которые берут 60 % клиентов того же типа, а этот клиент у нас не берёт.'],
          ['Прибыль', 'Валовая: цена продажи минус себестоимость на момент продажи. Чистую прибыль не считаем. Строки без себестоимости не входят в прибыль — помечены значком.'],
        ]}
      />
    </>
  );
}

