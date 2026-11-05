import { useMemo, useState } from 'react';
import { Avatar, Card, Chip, DataTable, DELIVERY_STATE, StatusChip, fmt, type Column } from '../../ui';
import { HBarList, SegmentBar } from '../../ui/charts';
import { useOpenEntity } from '../../shell/entities';
import { useDB, useDBVersion } from '../../data/store';
import { courierRows, deliveryFacts, onTimeShare, type CourierRow, type DeliveryFact } from './calc';
import { KpiTile } from '../overview/KpiTile';
import { DocsDrawer, HowCalc, ReportTop, WrapHead, sum, useReportPeriod } from './parts';

const OUTCOME = {
  on_time: { label: 'Вовремя', tone: 'ok' as const },
  late: { label: 'С опозданием', tone: 'warn' as const },
  late_now: { label: 'Опаздывает', tone: 'bad' as const },
  failed: { label: 'Не доставлена', tone: 'bad' as const },
  open: { label: 'В работе', tone: 'info' as const },
};
const pctOf = (v: number | null) => (v === null ? '—' : fmt.pct(v * 100, 0));

export default function DeliveryReport() {
  const db = useDB();
  const version = useDBVersion();
  const open = useOpenEntity();
  const { range, label } = useReportPeriod();
  const facts = useMemo(() => deliveryFacts(db, range.from, range.to), [db, version, range.from, range.to]);
  const couriers = useMemo(() => courierRows(db, facts), [db, version, facts]);
  const [pick, setPick] = useState<CourierRow | null>(null);
  const ix = useMemo(() => ({ clients: new Map(db.clients.map((c) => [c.id, c])), emps: new Map(db.employees.map((e) => [e.id, e])), orders: new Map(db.orders.map((o) => [o.id, o])) }), [db, version]);

  const n = (k: DeliveryFact['outcome']) => facts.filter((f) => f.outcome === k).length;
  const delivered = n('on_time') + n('late');
  const onTime = onTimeShare(n('on_time'), n('late'), n('late_now'));
  const failedAttempts = sum(facts, (f) => f.failedAttempts);
  // расход — по доставкам, на которые курьер уже выезжал; тот же счёт, что в таблице курьеров
  const spent = facts.filter((f) => f.spent);
  const cost = sum(couriers, (c) => c.cost);
  const fee = sum(spent, (f) => f.d.fee);
  const notHanded = sum(couriers, (c) => c.onHand);
  const reasons = new Map<string, number>();
  for (const f of facts) for (const a of f.d.attempts) if (a.result === 'failed') reasons.set(a.reason ?? 'Без причины', (reasons.get(a.reason ?? 'Без причины') ?? 0) + 1);
  const reasonRows = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ key: k, label: k, value: v, display: fmt.count(v, 'раз', 'раза', 'раз') }));
  const refusals = reasons.get('Отказ от товара') ?? 0;
  const underpaid = facts.filter((f) => f.underpaid);
  const hi = range.to + 'T99';
  const wrongItems = db.returns.filter((r) => r.source === 'order' && r.at >= range.from && r.at <= hi && r.lines.some((l) => l.reason === 'wrong_item')).length;
  const problems = facts.filter((f) => f.outcome === 'late' || f.outcome === 'late_now' || f.outcome === 'failed' || f.repeat);

  const ccols: Column<CourierRow>[] = [
    { key: 'name', header: 'Курьер', render: (r) => <span className="row"><Avatar name={r.e.name} size="sm" /><span className="cell-title">{r.e.name}</span></span>, sort: (r) => r.e.name, csv: (r) => r.e.name },
    { key: 'total', header: 'Доставок', align: 'right', render: (r) => fmt.num(r.total), sort: (r) => r.total, total: (rs) => fmt.num(sum(rs, (r) => r.total)) },
    { key: 'delivered', header: 'Вручено', align: 'right', render: (r) => fmt.num(r.delivered), sort: (r) => r.delivered, total: (rs) => fmt.num(sum(rs, (r) => r.delivered)) },
    {
      key: 'ontime',
      header: 'Вовремя',
      align: 'right',
      render: (r) => {
        const v = onTimeShare(r.onTime, r.late, r.lateNow);
        return <span title={r.lateNow ? `Сейчас опаздывает: ${fmt.count(r.lateNow, 'доставка', 'доставки', 'доставок')}` : undefined} className={r.lateNow ? 'c-bad w-700' : undefined}>{pctOf(v)}</span>;
      },
      sort: (r) => onTimeShare(r.onTime, r.late, r.lateNow) ?? -1,
      csv: (r) => {
        const v = onTimeShare(r.onTime, r.late, r.lateNow);
        return v === null ? '' : Math.round(v * 100);
      },
    },
    { key: 'latenow', header: <WrapHead width={76}>Опаздывают сейчас</WrapHead>, align: 'right', render: (r) => (r.lateNow ? <span className="c-bad w-700">{fmt.num(r.lateNow)}</span> : '—'), sort: (r) => r.lateNow, total: (rs) => fmt.num(sum(rs, (r) => r.lateNow)) },
    { key: 'failed', header: <WrapHead width={84}>Неудачных попыток</WrapHead>, align: 'right', render: (r) => (r.failedAttempts ? <span className="c-bad">{fmt.num(r.failedAttempts)}</span> : '—'), sort: (r) => r.failedAttempts, total: (rs) => fmt.num(sum(rs, (r) => r.failedAttempts)) },
    { key: 'repeat', header: <WrapHead width={84}>Повторных выездов</WrapHead>, align: 'right', render: (r) => (r.repeat ? fmt.num(r.repeat) : '—'), sort: (r) => r.repeat, total: (rs) => fmt.num(sum(rs, (r) => r.repeat)) },
    { key: 'cost', header: 'Расходы', align: 'right', render: (r) => fmt.money(r.cost), sort: (r) => r.cost, total: (rs) => fmt.money(sum(rs, (r) => r.cost)) },
    { key: 'collected', header: <WrapHead width={70}>Получил денег</WrapHead>, align: 'right', render: (r) => fmt.money(r.collected), sort: (r) => r.collected, total: (rs) => fmt.money(sum(rs, (r) => r.collected)) },
    { key: 'onhand', header: 'Не сдал', align: 'right', render: (r) => (r.onHand ? <span className="c-bad w-700">{fmt.money(r.onHand)}</span> : '—'), sort: (r) => r.onHand, total: (rs) => fmt.money(sum(rs, (r) => r.onHand)) },
  ];

  const pcols: Column<DeliveryFact>[] = [
    { key: 'num', header: 'Доставка', render: (f) => <span className="cell-title">№ {f.d.number}</span>, sort: (f) => f.d.number, csv: (f) => f.d.number },
    {
      key: 'date',
      header: 'Дата',
      render: (f) => (
        <div className="rp-name">
          <div className="nowrap">{fmt.date(f.d.date)}</div>
          <div className="cell-sub nowrap">{f.d.interval}</div>
        </div>
      ),
      sort: (f) => f.d.date + f.d.interval,
      csv: (f) => `${f.d.date} ${f.d.interval}`,
    },
    { key: 'client', header: 'Клиент', render: (f) => <div className="rp-name"><div className="cell-title">{ix.clients.get(f.d.clientId)?.name ?? '—'}</div><div className="cell-sub">{f.d.district}</div></div>, sort: (f) => ix.clients.get(f.d.clientId)?.name ?? '', csv: (f) => ix.clients.get(f.d.clientId)?.name ?? '' },
    { key: 'courier', header: 'Курьер', render: (f) => (f.d.courierId ? ix.emps.get(f.d.courierId)?.name ?? '—' : <span className="faint">не назначен</span>), sort: (f) => (f.d.courierId ? ix.emps.get(f.d.courierId)?.name ?? '' : '') },
    { key: 'attempts', header: 'Попыток', align: 'right', render: (f) => fmt.num(f.d.attempts.length), sort: (f) => f.d.attempts.length },
    { key: 'reason', header: 'Причина', render: (f) => f.lastReason ?? (f.outcome === 'late' ? 'Позже интервала' : f.outcome === 'late_now' ? 'Интервал прошёл, не вручена' : '—'), sort: (f) => f.lastReason ?? '' },
    { key: 'outcome', header: 'Итог', render: (f) => <Chip tone={OUTCOME[f.outcome].tone}>{OUTCOME[f.outcome].label}</Chip>, sort: (f) => f.outcome, csv: (f) => OUTCOME[f.outcome].label },
    { key: 'state', header: 'Сейчас', render: (f) => <StatusChip s={DELIVERY_STATE[f.d.state]} />, sort: (f) => f.d.state, csv: (f) => DELIVERY_STATE[f.d.state].label },
  ];

  return (
    <>
      <ReportTop />
      <div className="rp-kpis">
        <KpiTile label="Доставок" value={fmt.num(facts.length)} title={facts.some((f) => !f.d.courierId) ? `Из них курьер не назначен: ${fmt.num(facts.filter((f) => !f.d.courierId).length)} — в таблице курьеров их нет` : undefined} extra={<div className="rp-kpi-line">Вручено <b>{fmt.num(delivered)}</b></div>} />
        <KpiTile
          label="Вовремя"
          value={pctOf(onTime)}
          title="Вручены вовремя ÷ (вручены + опаздывают сейчас)"
          extra={
            <div className="rp-kpi-line">
              Опаздывают сейчас <b className={n('late_now') ? 'c-bad' : undefined}>{fmt.num(n('late_now'))}</b>
            </div>
          }
        />
        <KpiTile label="Неудачных попыток" value={fmt.num(failedAttempts)} extra={<div className="rp-kpi-line">Повторных выездов <b>{fmt.num(facts.filter((f) => f.repeat).length)}</b></div>} />
        <KpiTile label="Расходы на доставку" value={fmt.money(cost)} title="Доставки, на которые курьер уже выезжал. Сходится с итогом по курьерам" extra={<div className="rp-kpi-line">Оплатили клиенты <b>{fmt.money(fee)}</b></div>} />
        <KpiTile label={<span title="Наличные у курьеров на сегодня, не сданные в кассу">Курьеры не сдали</span>} value={fmt.money(notHanded)} />
      </div>

      <div className="rp-two">
        <Card title="Чем закончились доставки">
          <SegmentBar
            ariaLabel="Итоги доставок"
            parts={[
              { key: 'on_time', label: 'Вовремя', value: n('on_time'), slot: 1 },
              { key: 'late', label: 'С опозданием', value: n('late'), slot: 'warn' },
              { key: 'late_now', label: 'Опаздывают сейчас', value: n('late_now'), slot: 'bad' },
              { key: 'failed', label: 'Не доставлены', value: n('failed'), slot: 5 },
              { key: 'open', label: 'В работе', value: n('open'), slot: 3 },
            ]}
            format={(v) => fmt.num(v)}
          />
          <div className="rp-facts">
            <div className="rp-fact">
              <span>Отказы от товара</span>
              <b>{fmt.num(refusals)}</b>
            </div>
            <div className="rp-fact" title="Возвраты по заказам с причиной «Привезли не то»">
              <span>Привезли не то</span>
              <b>{fmt.num(wrongItems)}</b>
            </div>
            <div className="rp-fact" title="Курьер получил меньше суммы к получению — остаток в долге клиента">
              <span>Недоплата при вручении</span>
              <b>{fmt.num(underpaid.length)}</b>
            </div>
            <div className="rp-fact">
              <span>Средний расход на доставку</span>
              <b>{spent.length ? fmt.money(cost / spent.length) : '—'}</b>
            </div>
          </div>
        </Card>
        <Card title="Почему не получилось доставить">
          <HBarList rows={reasonRows} max={Math.max(1, ...reasonRows.map((r) => r.value))} slot={4} empty="Неудачных попыток не было" />
        </Card>
      </div>

      <div className="rp-tight">
      <DataTable
        id="rp-couriers"
        title="Курьеры"
        rows={couriers}
        columns={ccols}
        rowKey={(r) => r.e.id}
        defaultSort={{ key: 'total', dir: 'desc' }}
        onRowClick={(r) => setPick(r)}
        exportName={`Курьеры ${label}`}
      />
      </div>

      <div className="rp-tight">
      <DataTable
        id="rp-delivery-problems"
        title="Доставки с задержкой и неудачами"
        rows={problems}
        columns={pcols}
        rowKey={(f) => f.d.id}
        defaultSort={{ key: 'date', dir: 'desc' }}
        search={{ placeholder: 'Клиент, номер, курьер', text: (f) => `${f.d.number} ${ix.clients.get(f.d.clientId)?.name ?? ''} ${f.d.courierId ? ix.emps.get(f.d.courierId)?.name ?? '' : ''}` }}
        filters={[
          {
            key: 'o',
            showCounts: true,
            options: [
              { value: 'all', label: 'Все' },
              { value: 'failed', label: 'Не доставлены', test: (f) => f.outcome === 'failed' },
              { value: 'late_now', label: 'Опаздывают сейчас', test: (f) => f.outcome === 'late_now' },
              { value: 'late', label: 'С опозданием', test: (f) => f.outcome === 'late' },
              { value: 'repeat', label: 'Повторный выезд', test: (f) => f.repeat },
            ],
          },
        ]}
        onRowClick={(f) => open('delivery', f.d.id)}
        exportName={`Проблемные доставки ${label}`}
        pageSize={15}
        empty={<div className="rp-empty">Все доставки прошли вовремя</div>}
      />
      </div>

      <HowCalc
        rows={[
          ['Какие доставки', 'Доставки с плановой датой в выбранном периоде. Перенесённая доставка считается по новой дате.'],
          ['Вовремя', 'Вручена с первой попытки, в плановый день и не позже конца интервала. Иначе — с опозданием. «Опаздывают сейчас» — ещё не вручены, а интервал уже прошёл, как на экране доставки. Доля = вовремя ÷ (вручено + опаздывают сейчас).'],
          ['Неудачные попытки', 'Каждая отметка курьера «Не удалось» с причиной. Повторный выезд — у доставки больше одной попытки.'],
          ['Расходы', 'Сколько доставка стоит магазину (топливо, работа курьера) — по доставкам, на которые курьер уже выезжал. Итог совпадает с суммой по курьерам. Отдельно — сколько за доставку заплатили клиенты.'],
          ['Курьеры не сдали', 'Наличные, полученные курьером при вручении и ещё не сданные в кассу, — на сегодня, независимо от периода. Доставлено — не значит оплачено: недоплата остаётся долгом клиента.'],
          ['Возвраты', 'Товар, не принятый клиентом, возвращается на склад на проверку и в отчёт по товарам идёт минусом.'],
        ]}
      />

      {pick ? (
        <DocsDrawer
          title={pick.e.name}
          sub={`Доставки · ${label}`}
          amountLabel="Получено"
          onClose={() => setPick(null)}
          rows={facts
            .filter((f) => f.d.courierId === pick.e.id)
            .map((f) => ({
              key: f.d.id,
              at: f.d.date,
              kind: 'Доставка',
              title: `Доставка № ${f.d.number} · ${ix.clients.get(f.d.clientId)?.name ?? ''}`,
              sub: `${f.d.interval} · ${OUTCOME[f.outcome].label}${f.lastReason ? ' · ' + f.lastReason.toLowerCase() : ''}${f.d.collected && !f.d.handedIn ? ' · деньги не сданы' : ''}`,
              amount: f.d.collected,
              entity: { type: 'delivery' as const, id: f.d.id },
            }))}
        />
      ) : null}
    </>
  );
}
