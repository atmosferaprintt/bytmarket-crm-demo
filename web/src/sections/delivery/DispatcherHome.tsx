import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarDays, ChevronRight, HandCoins, Map as MapIcon, Phone, UserPlus, UserRound } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { useDB, useDBVersion } from '../../data/store';
import { courierCash, indexes } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { Avatar, Button, Card, Chip, EmptyState, Kpi, MoreMenu, ProgressBar, fmt } from '../../ui';
import { DelayChip, LateChip, StateChip } from './parts';
import { byRoute, clockOf, delayOf, forDay, wishOf, kgText, lastFail, lateOf, loadText, loadsOf, placesText, shortDistrict, telUrl } from './lib';
import { actsFor, useDeliveryFlow } from './flow';
import './delivery.css';

/** Рабочий стол: диспетчер — что назначить, где проблемы, кто как загружен, у кого деньги. */
export default function Home() {
  const db = useDB();
  const version = useDBVersion();
  const { can } = useSession();
  const navigate = useNavigate();
  const open = useOpenEntity();
  const flow = useDeliveryFlow();
  const c = clockOf(db);
  const ix = indexes(db);

  const data = useMemo(() => {
    const today = forDay(db.deliveries, c.today, c).filter((d) => d.state !== 'returned');
    const waiting = today.filter((d) => d.state === 'waiting').sort(byRoute);
    const failed = today.filter((d) => d.state === 'failed').sort((a, b) => (lastFail(b)?.at ?? '').localeCompare(lastFail(a)?.at ?? ''));
    // опаздывают или курьер отметил «Задерживаюсь» — диспетчер видит это в «Проблемах»
    const late = today
      .filter((d) => d.state === 'assigned' && (lateOf(d, c) || delayOf(d)))
      .sort((a, b) => (lateOf(b, c)?.minutes ?? 0) - (lateOf(a, c)?.minutes ?? 0));
    const delivered = today.filter((d) => d.state === 'delivered').length;
    const onWayList = today.filter((d) => d.state === 'on_way').sort(byRoute);
    const onWay = onWayList.length;
    const loads = loadsOf(db, c.today, c);
    const cash = loads.map((l) => ({ e: l.courier, onHand: courierCash(db, l.courier.id).onHand })).sort((a, b) => b.onHand - a.onHand);
    const tomorrow = forDay(db.deliveries, c.tomorrow, c).filter((d) => d.state !== 'returned');
    return { today, waiting, failed, late, delivered, onWay, onWayList, loads, cash, tomorrow };
  }, [db, version]);

  const onHand = data.cash.reduce((z, r) => z + r.onHand, 0);
  const problems = data.failed.length + data.late.length;
  const canAssign = can('assignDelivery');
  const tomorrowWaiting = data.tomorrow.filter((d) => d.state === 'waiting').length;

  return (
    <>
      <PageHeader
        section="overview"
        actions={
          <>
            <Button variant="secondary" icon={<MapIcon />} onClick={() => navigate('/delivery/routes')}>
              Маршруты курьеров
            </Button>
            {canAssign && data.waiting.length ? (
              <Button variant="primary" icon={<UserPlus />} onClick={() => flow.bulk(data.waiting.map((d) => d.id), c.today)}>
                Назначить ожидающие · {data.waiting.length}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="dl-kpis">
        <Kpi label="Доставок сегодня" value={fmt.num(data.today.length)} />
        <Kpi
          label="Вручено"
          value={
            <>
              {data.delivered} <span className="dl-kpi-of">из {data.today.length}</span>
            </>
          }
          extra={<ProgressBar value={data.delivered} max={Math.max(1, data.today.length)} thin />} />
        <Kpi label="В пути" value={fmt.num(data.onWay)} />
        <Kpi label="Проблемы" value={<span className={problems ? 'c-bad' : undefined}>{fmt.num(problems)}</span>} />
        <Kpi label="Деньги на руках" value={<span className={onHand ? 'c-warn' : undefined}>{fmt.money(onHand)}</span>} />
      </div>

      <div className="dl-home">
        <div className="col-4">
          <Card
            title={
              <span className="row" style={{ gap: 8 }}>
                Ожидают назначения
                {data.waiting.length ? <Chip tone="warn">{data.waiting.length}</Chip> : null}
              </span>
            }
            flush
          >
            {data.waiting.length ? (
              <div className="list">
                {data.waiting.map((d) => (
                  <div key={d.id} className="list-row dl-home-row" role="button" tabIndex={0} onClick={() => open('delivery', d.id)} onKeyDown={(e) => e.key === 'Enter' && open('delivery', d.id)}>
                    <span className="dl-line-no">№ {d.number}</span>
                    <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                      <span className="w-700 ellipsis">{ix.clients.get(d.clientId)?.name ?? d.contactName}</span>
                      <span className="t-12 muted ellipsis">
                        {d.address}, {shortDistrict(d.district)} · {placesText(d.places)} · {kgText(d.weightKg)}
                      </span>
                    </span>
                    <span className="col" style={{ gap: 2, alignItems: 'flex-end' }}>
                      <span className="num w-600">{d.interval}</span>
                      <LateChip d={d} c={c} />
                    </span>
                    {canAssign ? (
                      <Button size="sm" variant="secondary" icon={<UserPlus />} onClick={(e) => { e.stopPropagation(); flow.act('assign', d); }}>
                        Назначить
                      </Button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="Все доставки на сегодня назначены" />
            )}
          </Card>

          <Card
            title={
              <span className="row" style={{ gap: 8 }}>
                Проблемы
                {problems ? <Chip tone="bad">{problems}</Chip> : null}
              </span>
            }
            flush
          >
            {problems ? (
              <div className="list">
                {data.failed.map((d) => {
                  const f = lastFail(d);
                  const wish = wishOf(d, c.today);
                  const courier = d.courierId ? ix.employees.get(d.courierId) : undefined;
                  const acts = actsFor(d, can, { courier: false, order: ix.orders.get(d.orderId) });
                  return (
                    <div key={d.id} className="list-row dl-home-row is-top" role="button" tabIndex={0} onClick={() => open('delivery', d.id)} onKeyDown={(e) => e.key === 'Enter' && open('delivery', d.id)}>
                      <span className="dl-line-no">№ {d.number}</span>
                      <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                        <span className="w-700 ellipsis">{ix.clients.get(d.clientId)?.name ?? d.contactName}</span>
                        <span className="t-12 ink-2 dl-wrap">
                          {d.address}, {shortDistrict(d.district)}
                        </span>
                        <span className="t-12 muted dl-wrap">
                          {f?.reason ?? 'Причина не указана'}
                          {f ? ` · ${fmt.time(f.at)}` : ''}
                        </span>
                        {wish ? (
                          <span className="t-12 ink-2 w-600">
                            Клиент просит {fmt.date(wish.date)}, <span className="nowrap">{wish.interval}</span>
                          </span>
                        ) : null}
                      </span>
                      <span className="dl-home-chips">
                        <StateChip d={d} />
                        <Chip tone="outline" icon={<UserRound />}>{courier?.short ?? 'Без курьера'}</Chip>
                      </span>
                      {acts.main ? (
                        <span className="row" style={{ gap: 4 }} onClick={(e) => e.stopPropagation()}>
                          <Button size="sm" variant="secondary" onClick={() => flow.act(acts.main!, d)}>
                            {acts.main.key === 'retry' ? 'Повторить' : acts.main.label}
                          </Button>
                          <MoreMenu size="sm" items={flow.menu(acts.more, d)} />
                        </span>
                      ) : null}
                    </div>
                  );
                })}
                {data.late.map((d) => {
                  const courier = d.courierId ? ix.employees.get(d.courierId) : undefined;
                  return (
                    <div key={d.id} className="list-row dl-home-row is-top" role="button" tabIndex={0} onClick={() => open('delivery', d.id)} onKeyDown={(e) => e.key === 'Enter' && open('delivery', d.id)}>
                      <span className="dl-line-no">№ {d.number}</span>
                      <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                        <span className="w-700 ellipsis">{ix.clients.get(d.clientId)?.name ?? d.contactName}</span>
                        <span className="t-12 ink-2 dl-wrap">
                          {d.address}, {shortDistrict(d.district)}
                        </span>
                        <span className="t-12 muted">Интервал {d.interval}</span>
                      </span>
                      <span className="dl-home-chips">
                        <LateChip d={d} c={c} />
                        <DelayChip d={d} />
                        <Chip tone="outline" icon={<UserRound />}>{courier?.short ?? 'Без курьера'}</Chip>
                      </span>
                      {courier ? (
                        <a className="btn btn-secondary btn-sm" href={telUrl(courier.phone)} onClick={(e) => e.stopPropagation()} title={fmt.phone(courier.phone)}>
                          <Phone />
                          Курьеру
                        </a>
                      ) : canAssign ? (
                        <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); flow.act('assign', d); }}>
                          Назначить
                        </Button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="Проблем нет — все доставки идут по плану" />
            )}
          </Card>

          <Card
            title={
              <span className="row" style={{ gap: 8 }}>
                В пути
                {data.onWay ? <Chip tone="violet">{data.onWay}</Chip> : null}
              </span>
            }
            flush
            actions={<Button size="sm" variant="ghost" iconRight={<ChevronRight />} onClick={() => navigate('/delivery?state=on_way')}>Все</Button>}
          >
            {data.onWayList.length ? (
              <div className="list">
                {data.onWayList.map((d) => {
                  const courier = d.courierId ? ix.employees.get(d.courierId) : undefined;
                  return (
                    <div key={d.id} className="list-row dl-home-row" role="button" tabIndex={0} onClick={() => open('delivery', d.id)} onKeyDown={(e) => e.key === 'Enter' && open('delivery', d.id)}>
                      <span className="dl-line-no">№ {d.number}</span>
                      <span className="grow col" style={{ gap: 2, minWidth: 0 }}>
                        <span className="w-700 ellipsis">{ix.clients.get(d.clientId)?.name ?? d.contactName}</span>
                        <span className="t-12 muted ellipsis">
                          {d.address}, {shortDistrict(d.district)} · {courier?.short ?? 'без курьера'}
                        </span>
                      </span>
                      <span className="col" style={{ gap: 2, alignItems: 'flex-end' }}>
                        <span className="num w-600">{d.interval}</span>
                        <LateChip d={d} c={c} />
                        <DelayChip d={d} />
                      </span>
                      <span className="num w-700 dl-home-sum">{d.collect > 0 ? fmt.money(d.collect) : '—'}</span>
                      {canAssign ? (
                        <span onClick={(e) => e.stopPropagation()}>
                          <MoreMenu size="sm" items={flow.menu(actsFor(d, can, { courier: false }).all, d)} />
                        </span>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState title="Сейчас никто не в пути" />
            )}
          </Card>
        </div>

        <div className="col-4">
          <Card title="Загрузка курьеров" flush actions={<Button size="sm" variant="ghost" iconRight={<ChevronRight />} onClick={() => navigate('/delivery/routes')}>Маршруты</Button>}>
            <div className="list">
              {data.loads.map((l) => (
                <button key={l.courier.id} type="button" className="list-row dl-load" onClick={() => navigate(`/delivery?courier=${l.courier.id}`)}>
                  <Avatar name={l.courier.name} />
                  <span className="grow col" style={{ gap: 4, minWidth: 0 }}>
                    <span className="row">
                      <span className="grow w-700 ellipsis">{l.courier.name}</span>
                      <span className="num t-13">
                        <span className="w-700">{l.done}</span> из {l.points}
                      </span>
                    </span>
                    <ProgressBar value={l.done} max={Math.max(1, l.points)} thin tone={l.failed ? 'warn' : 'ok'} />
                    <span className="t-12 muted ellipsis">{l.points ? loadText(l) : 'Сегодня без точек'}</span>
                  </span>
                </button>
              ))}
              {!data.loads.length ? <EmptyState title="Курьеров нет" /> : null}
            </div>
          </Card>

          <Card title="Деньги на руках" flush actions={<Button size="sm" variant="ghost" iconRight={<ChevronRight />} onClick={() => navigate('/delivery/cash')}>Сверка</Button>}>
            <div className="list">
              {data.cash.map((r) => (
                <div key={r.e.id} className="list-row">
                  <Avatar name={r.e.name} size="sm" />
                  <span className="grow w-600 ellipsis">{r.e.short}</span>
                  <span className={r.onHand ? 'num w-700' : 'num faint'}>{fmt.money(r.onHand)}</span>
                  {can('handInCash') && r.onHand > 0 ? (
                    <Button size="sm" variant="secondary" icon={<HandCoins />} onClick={() => flow.handIn(r.e.id)}>
                      Принять
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          </Card>

          <Card title="Завтра" actions={<Button size="sm" variant="ghost" iconRight={<ChevronRight />} onClick={() => navigate('/delivery?day=tomorrow')}>Открыть</Button>}>
            {data.tomorrow.length ? (
              <div className="dl-facts is-3">
                <div className="dl-fact">
                  <span className="dl-fact-label">Доставок</span>
                  <span className="dl-fact-value t-20 w-700">{data.tomorrow.length}</span>
                </div>
                <div className="dl-fact">
                  <span className="dl-fact-label">Без курьера</span>
                  <span className={`dl-fact-value t-20 w-700${tomorrowWaiting ? ' c-warn' : ''}`}>{tomorrowWaiting}</span>
                </div>
                <div className="dl-fact">
                  <span className="dl-fact-label">Мест</span>
                  <span className="dl-fact-value t-20 w-700">{fmt.num(data.tomorrow.reduce((z, d) => z + d.places, 0))}</span>
                </div>
              </div>
            ) : (
              <EmptyState icon={<CalendarDays />} title="На завтра доставок пока нет" />
            )}
          </Card>
        </div>
      </div>
      {flow.node}
    </>
  );
}
