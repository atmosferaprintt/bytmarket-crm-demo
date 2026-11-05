/* Рабочий стол склада: что собрать сегодня, что приедет, что проверить, что перенести в магазин. */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, ChevronRight, ListChecks } from 'lucide-react';
import { useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { useScoped } from '../../roles/scope';
import { PageHeader } from '../../shell/PageHeader';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import { TaskModal } from '../../shell/TaskModal';
import { Button, Card, Chip, EmptyState, Kpi, StatusChip, DELIVERY_STATE, PICK_STATE, cx, fmt, toast } from '../../ui';
import { DOC_KIND_NAMES, movePack, stockLineOf, stockLines, type StockLine } from './calc';
import { plusDays } from '../../data/dates';
import type { Product, Task } from '../../data/types';
import { pickQueue } from './picking';
import { docRows } from './docRows';
import { DocIcon, Route } from './DocBits';
import { StockDocButtons, useStockDocs } from './docActions';
import { StockDocDrawer } from './StockDocDrawer';
import { Q_SOURCE, qReason } from './QuarantinePage';
import { act } from './act';
import './stock.css';

export default function Home() {
  const db = useDB();
  const version = useDBVersion();
  const { me, can } = useSession();
  const { myTasks } = useScoped();
  const navigate = useNavigate();
  const open = useOpenEntity();
  const docs = useStockDocs();
  const [doc, setDoc] = useState<string | null>(null);
  const [newTask, setNewTask] = useState(false);
  const ix = indexes(db);
  const today = db.meta.today;

  const data = useMemo(() => {
    const queue = pickQueue(db);
    // к сборке — только то, что ещё нужно собрать; собранное ждёт курьера или клиента
    const todayPick = queue.filter((x) => x.o.pick !== 'picked' && (x.forToday || x.o.fulfillment === 'pickup'));
    const toCouriers = queue.filter((x) => x.o.pick === 'picked' && x.o.fulfillment === 'delivery' && x.forToday);
    const toPickup = queue.filter((x) => x.o.pick === 'picked' && x.o.fulfillment === 'pickup');
    const incoming = db.purchases
      .filter((p) => p.state === 'ordered' || p.state === 'partial')
      .sort((a, b) => a.expectedAt.localeCompare(b.expectedAt));
    const quarantine = db.quarantine.filter((q) => q.state === 'check').sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const shopLow = stockLines(db)
      .filter((l) => l.shopMove)
      .sort((a, b) => a.info.shop.available - a.shopMin - (b.info.shop.available - b.shopMin) || (b.flow?.shopPerDay ?? 0) - (a.flow?.shopPerDay ?? 0));
    const feed = docRows(db).slice(0, 8);
    const tomorrow = plusDays(today, 1);
    const tomorrowPick = queue.filter((x) => x.o.pick !== 'picked' && x.o.fulfillment === 'delivery' && x.dueDay === tomorrow);
    // просьбы продавцов перенести товар в магазин: закрываются сами, когда товар перемещён
    const requests = db.tasks
      .filter((t) => t.state === 'open' && t.kind === 'move_to_shop' && t.link?.type === 'product')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((t) => requestLine(t, ix.products.get(t.link!.id), stockLineOf(db, t.link!.id), ix.employees.get(t.authorId)?.short ?? 'продавец'))
      .filter((r): r is MoveRequest => r !== null);
    return { queue, todayPick, tomorrowPick, toCouriers, toPickup, incoming, quarantine, shopLow, feed, requests };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version]);

  const tasks = useMemo(
    () =>
      myTasks
        .filter((t) => t.state === 'open')
        .sort((a, b) => a.due.localeCompare(b.due) || (a.dueTime ?? '99').localeCompare(b.dueTime ?? '99'))
        .slice(0, 7),
    [myTasks],
  );

  // сначала то, что просили продавцы, потом остальное «мало в магазине»
  const moveLines = useMemo(() => {
    const asked = data.requests.filter((r) => r.packQty > 0);
    const seen = new Set(asked.map((r) => r.p.id));
    const rest = data.shopLow.filter((l) => !seen.has(l.id));
    return [
      ...asked.map((r) => ({ productId: r.p.id, pack: r.pack, packQty: r.packQty })),
      ...rest.map((l: StockLine) => ({ productId: l.id, pack: l.shopMove!.pack.key, packQty: l.shopMove!.packQty })),
    ].slice(0, 40);
  }, [data]);
  // в таблице — без того, что уже просили продавцы: оно выше
  const lowRest = useMemo(() => {
    const asked = new Set(data.requests.map((r) => r.p.id));
    return data.shopLow.filter((l) => !asked.has(l.id));
  }, [data]);
  const moveAll = () => docs.open('transfer', { from: 'warehouse', to: 'shop', comment: 'Пополнение магазина', lines: moveLines });
  const moveOne = (r: MoveRequest) =>
    docs.open('transfer', { from: 'warehouse', to: 'shop', comment: `По просьбе: ${r.author}`, lines: [{ productId: r.p.id, pack: r.pack, packQty: Math.max(1, r.packQty) }] });

  const notStarted = data.todayPick.filter((x) => x.o.pick === 'none').length;
  const inWork = data.todayPick.length - notStarted;
  const courierName = (id: string | null | undefined) => (id ? ix.employees.get(id)?.short ?? ix.employees.get(id)?.name ?? null : null);

  const completeTask = (id: string) => {
    const r = act('task.complete', { taskId: id }, me.id);
    if (!r.ok) return toast(r.error, 'error');
    toast('Задача выполнена');
  };

  const pickCard = (
    <Card
      flush
      title="К сборке сегодня"
      sub={data.todayPick.length ? [notStarted ? `не начато ${notStarted}` : '', inWork ? `собирается ${inWork}` : ''].filter(Boolean).join(' · ') : undefined}
      actions={
        <Button variant="ghost" size="sm" iconRight={<ChevronRight />} onClick={() => navigate('/stock/picking')}>
          Вся очередь
        </Button>
      }
    >
      {data.todayPick.length === 0 ? (
        <div>
          <div className="stock-home-done">
            <span className="w-700">На сегодня всё собрано</span>
            <span className="ink-2">На завтра: {fmt.count(data.tomorrowPick.length, 'заказ', 'заказа', 'заказов')}</span>
          </div>
          {data.tomorrowPick.slice(0, 5).map((x) => (
            <button key={x.id} type="button" className="stock-list-row" onClick={() => navigate(`/stock/picking?order=${x.id}`)}>
              <span style={{ minWidth: 0 }}>
                <span className="stock-list-title">
                  <span>
                    № {x.o.number} · {x.client?.name ?? 'Клиент'}
                  </span>
                </span>
                <span className="stock-list-meta" style={{ display: 'block' }}>
                  Доставка завтра{x.delivery ? `, ${x.delivery.interval}` : ''} · {fmt.num(x.positions)} поз., {fmt.qty(x.qty)}
                </span>
              </span>
              <span className="stock-list-side">
                <StatusChip s={PICK_STATE[x.o.pick]} />
                <ChevronRight size={16} className="faint" />
              </span>
            </button>
          ))}
          {data.tomorrowPick.length > 5 ? (
            <button type="button" className="stock-home-more" onClick={() => navigate('/stock/picking')}>
              Ещё {fmt.count(data.tomorrowPick.length - 5, 'заказ', 'заказа', 'заказов')} на завтра
            </button>
          ) : null}
        </div>
      ) : (
        <div>
          {data.todayPick.slice(0, 6).map((x) => (
            <button key={x.id} type="button" className="stock-list-row" onClick={() => navigate(`/stock/picking?order=${x.id}`)}>
              <span style={{ minWidth: 0 }}>
                <span className="stock-list-title">
                  <span>
                    № {x.o.number} · {x.client?.name ?? 'Клиент'}
                  </span>
                  {x.late ? <Chip tone="bad">Опаздывает</Chip> : null}
                </span>
                <span className="stock-list-meta" style={{ display: 'block' }}>
                  {x.o.fulfillment === 'pickup' ? 'Самовывоз' : `Доставка ${x.delivery ? `${fmt.relDate(x.delivery.date, today)}, ${x.delivery.interval}` : ''}`} · {fmt.num(x.positions)} поз., {fmt.qty(x.qty)}
                </span>
              </span>
              <span className="stock-list-side">
                <StatusChip s={PICK_STATE[x.o.pick]} />
                <ChevronRight size={16} className="faint" />
              </span>
            </button>
          ))}
          {data.todayPick.length > 6 ? (
            <button type="button" className="stock-home-more" onClick={() => navigate('/stock/picking')}>
              Ещё {fmt.count(data.todayPick.length - 6, 'заказ', 'заказа', 'заказов')} в очереди
            </button>
          ) : null}
        </div>
      )}
    </Card>
  );

  const handCard = (
    <Card
      flush
      title="Передать курьерам"
      actions={
        <Button variant="ghost" size="sm" iconRight={<ChevronRight />} onClick={() => navigate('/delivery')}>
          Доставки
        </Button>
      }
    >
      {data.toCouriers.length === 0 ? (
        <EmptyState title="Передавать некому">Собранные заказы на сегодня появятся здесь</EmptyState>
      ) : (
        <div>
          {data.toCouriers.slice(0, 6).map((x) => {
            const courier = courierName(x.delivery?.courierId);
            return (
              <button key={x.id} type="button" className="stock-list-row" onClick={() => navigate(`/stock/picking?order=${x.id}`)}>
                <span style={{ minWidth: 0 }}>
                  <span className="stock-list-title">
                    <span>
                      № {x.o.number} · {x.client?.name ?? 'Клиент'}
                    </span>
                  </span>
                  <span className="stock-list-meta" style={{ display: 'block' }}>
                    {x.delivery ? x.delivery.interval : 'Время не назначено'} · мест {x.places}
                    {courier ? ` · ${courier}` : ''}
                  </span>
                </span>
                <span className="stock-list-side">{x.delivery ? <StatusChip s={DELIVERY_STATE[x.delivery.state]} /> : <Chip tone="warn">Нет доставки</Chip>}</span>
              </button>
            );
          })}
          {data.toCouriers.length > 6 ? (
            <button type="button" className="stock-home-more" onClick={() => navigate('/stock/picking')}>
              Ещё {fmt.count(data.toCouriers.length - 6, 'заказ', 'заказа', 'заказов')}
            </button>
          ) : null}
        </div>
      )}
    </Card>
  );

  const pickupCard = data.toPickup.length ? (
    <Card flush title="Ждут самовывоза">
      <div>
        {data.toPickup.slice(0, 4).map((x) => (
          <button key={x.id} type="button" className="stock-list-row" onClick={() => navigate(`/stock/picking?order=${x.id}`)}>
            <span style={{ minWidth: 0 }}>
              <span className="stock-list-title">
                <span>
                  № {x.o.number} · {x.client?.name ?? 'Клиент'}
                </span>
              </span>
              <span className="stock-list-meta" style={{ display: 'block' }}>
                {fmt.num(x.positions)} поз., {fmt.qty(x.qty)} · собран, заказ от {fmt.date(x.o.createdAt)}
              </span>
            </span>
            <span className="stock-list-side">
              <ChevronRight size={16} className="faint" />
            </span>
          </button>
        ))}
        {data.toPickup.length > 4 ? (
          <button type="button" className="stock-home-more" onClick={() => navigate('/stock/picking')}>
            Ещё {fmt.count(data.toPickup.length - 4, 'заказ', 'заказа', 'заказов')}
          </button>
        ) : null}
      </div>
    </Card>
  ) : null;

  const incomingCard = (
    <Card
      flush
      title="Ожидаются поставки"
      actions={
        <Button variant="ghost" size="sm" iconRight={<ChevronRight />} onClick={() => navigate('/purchases')}>
          Все закупки
        </Button>
      }
    >
      {data.incoming.length === 0 ? (
        <EmptyState title="Поставок не ждём">Все заказы поставщикам приняты</EmptyState>
      ) : (
        <div>
          {data.incoming.slice(0, 7).map((pu) => {
            const late = pu.expectedAt < today ? fmt.daysBetween(pu.expectedAt, today) : 0;
            const rest = pu.lines.reduce((s, l) => s + Math.max(0, l.qty - (l.received ?? 0)), 0);
            return (
              <button key={pu.id} type="button" className="stock-list-row" onClick={() => open('purchase', pu.id)}>
                <span style={{ minWidth: 0 }}>
                  <span className="stock-list-title">
                    <span>{ix.suppliers.get(pu.supplierId)?.name ?? 'Поставщик'}</span>
                  </span>
                  <span className="stock-list-meta" style={{ display: 'block' }}>
                    № {pu.number}
                    {pu.state === 'partial' ? ' · принята частично' : ''} · ждём {fmt.qty(rest)}
                  </span>
                </span>
                <span className="stock-list-side">
                  {late ? <Chip tone="bad">Опаздывает на {fmt.count(late, 'день', 'дня', 'дней')}</Chip> : <span className={pu.expectedAt === today ? 'w-700' : 'muted'}>{fmt.relDate(pu.expectedAt, today)}</span>}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </Card>
  );

  const requestsBlock = data.requests.length ? (
    <div className="stock-requests">
      <div className="stock-requests-head">Просьбы продавцов · {fmt.num(data.requests.length)}</div>
      {data.requests.map((r) => (
        <div key={r.task.id} className="stock-request-row">
          <button type="button" className="stock-request-main" onClick={() => open('product', r.p.id)}>
            <span className="stock-list-title">
              <span className="stock-request-name">{r.p.name}</span>
            </span>
            <span className="stock-list-meta stock-request-meta">
              {r.author}, {fmt.relDate(r.task.createdAt, today)} в {fmt.time(r.task.createdAt)} · в магазине {fmt.num(r.shop)}, на складе {fmt.num(r.wh)}
            </span>
          </button>
          <span className="stock-list-side">
            {r.packQty > 0 ? (
              <span className="stock-request-qty">
                {r.packSize > 1 ? <span className="muted">{fmt.num(r.packQty)} {r.pack === 'box' ? 'кор.' : 'уп.'} · </span> : null}
                <b>{fmt.qty(r.qty)}</b>
              </span>
            ) : (
              <Chip tone="bad">На складе нет</Chip>
            )}
            {can('transfer') && r.packQty > 0 ? (
              <Button size="sm" variant="ghost" icon={<ArrowLeftRight />} onClick={() => moveOne(r)}>
                Перенести
              </Button>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  ) : null;

  const moveCard = (
    <Card
      flush
      title="Мало в магазине"
      actions={
        moveLines.length && can('transfer') ? (
          <Button size="sm" icon={<ArrowLeftRight />} onClick={moveAll}>
            Переместить {fmt.count(moveLines.length, 'позицию', 'позиции', 'позиций')}
          </Button>
        ) : null
      }
    >
      {requestsBlock}
      {lowRest.length === 0 ? (
        data.requests.length ? null : <EmptyState title="В магазине всего хватает" />
      ) : (
        <div className="table-scroll">
          <table className="table table-dense stock-move-table">
            <thead>
              <tr>
                <th>Товар</th>
                <th className="num">В магазине</th>
                <th className="num">На складе</th>
                <th className="num">Переместим</th>
              </tr>
            </thead>
            <tbody>
              {lowRest.slice(0, 8).map((l) => (
                <tr key={l.id} className="is-clickable" onClick={() => open('product', l.id)}>
                  <td>
                    <div className="cell-title stock-name" title={l.p.name}>
                      {l.p.name}
                    </div>
                  </td>
                  <td className={cx('num w-700', l.info.shop.available <= 0 ? 'c-bad' : 'c-warn')}>{fmt.num(l.info.shop.available)}</td>
                  <td className="num">{fmt.num(l.info.warehouse.available)}</td>
                  <td className="num">
                    {l.shopMove!.pack.qty > 1 ? <span className="muted">{fmt.num(l.shopMove!.packQty)} {l.shopMove!.pack.key === 'box' ? 'кор.' : 'уп.'} · </span> : null}
                    <span className="w-700">{fmt.qty(l.shopMove!.qty)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {lowRest.length > 8 ? (
            <button type="button" className="stock-home-more" onClick={() => navigate('/stock?f=shopLow')}>
              Все {fmt.count(data.shopLow.length, 'позиция', 'позиции', 'позиций')}
            </button>
          ) : null}
        </div>
      )}
    </Card>
  );

  const quarantineCard = (
    <Card
      flush
      title="Карантин на проверке"
      actions={
        <Button variant="ghost" size="sm" iconRight={<ChevronRight />} onClick={() => navigate('/stock/quarantine')}>
          Открыть
        </Button>
      }
    >
      {data.quarantine.length === 0 ? (
        <EmptyState title="Проверять нечего">Возвраты и брак разобраны</EmptyState>
      ) : (
        <div>
          {data.quarantine.slice(0, 5).map((q) => {
            const p = ix.products.get(q.productId);
            const d = fmt.daysBetween(q.createdAt, today);
            return (
              <button key={q.id} type="button" className="stock-list-row" onClick={() => navigate('/stock/quarantine')}>
                <span style={{ minWidth: 0 }}>
                  <span className="stock-list-title">
                    <span title={p?.name}>{p?.name ?? 'Товар'}</span>
                  </span>
                  <span className="stock-list-meta" style={{ display: 'block' }}>
                    {Q_SOURCE[q.source]} · {qReason(q)}
                  </span>
                </span>
                <span className="stock-list-side">
                  <span className="stock-q">{fmt.qty(q.qty)}</span>
                  <span className={d >= 3 ? 'c-warn w-600' : 'muted'}>{d === 0 ? 'сегодня' : `ждёт ${fmt.count(d, 'день', 'дня', 'дней')}`}</span>
                </span>
              </button>
            );
          })}
          {data.quarantine.length > 5 ? (
            <button type="button" className="stock-home-more" onClick={() => navigate('/stock/quarantine')}>
              Ещё {fmt.count(data.quarantine.length - 5, 'позиция', 'позиции', 'позиций')}
            </button>
          ) : null}
        </div>
      )}
    </Card>
  );

  const feedCard = (
    <Card
      flush
      title="Последние документы"
      actions={
        <Button variant="ghost" size="sm" iconRight={<ChevronRight />} onClick={() => navigate('/stock/docs')}>
          Все документы
        </Button>
      }
    >
      {data.feed.length === 0 ? (
        <EmptyState title="Документов пока нет" />
      ) : (
        data.feed.map((r) => (
          <button key={r.key} type="button" className="stock-feed-row" onClick={() => (r.docId ? setDoc(r.docId) : r.purchaseId ? open('purchase', r.purchaseId) : undefined)}>
            <span className="stock-feed-time">{r.at.slice(0, 10) === today ? fmt.time(r.at) : fmt.dateShort(r.at)}</span>
            <DocIcon kind={r.kind} />
            <span style={{ minWidth: 0 }}>
              <span className="stock-list-title">
                <span>
                  {DOC_KIND_NAMES[r.kind]} № {r.number}
                </span>
                {r.diff ? <Chip tone="warn">Расхождение</Chip> : null}
              </span>
              <span className="stock-list-meta row" style={{ gap: 6 }}>
                <Route kind={r.kind} from={r.from} to={r.to} />· {fmt.num(r.lines)} поз., {fmt.qty(r.qty)} · {r.author}
              </span>
            </span>
          </button>
        ))
      )}
    </Card>
  );

  const tasksCard = (
    <Card
      flush
      title="Мои задачи"
      actions={
        <Button variant="ghost" size="sm" icon={<ListChecks />} onClick={() => setNewTask(true)}>
          Задача
        </Button>
      }
    >
      {tasks.length === 0 ? (
        <EmptyState title="Задач нет">На сегодня всё сделано</EmptyState>
      ) : (
        tasks.map((t) => {
          const late = t.due < today;
          const link = t.link;
          return (
            <div key={t.id} className="stock-task-row">
              <input type="checkbox" onChange={() => completeTask(t.id)} aria-label="Сделано" />
              <div style={{ minWidth: 0 }}>
                <div className="w-700">{t.title}</div>
                <div className="stock-list-meta row" style={{ gap: 8 }}>
                  {late ? <Chip tone="bad">Просрочена с {fmt.date(t.due)}</Chip> : <span>{fmt.relDate(t.due, today)}{t.dueTime ? `, ${t.dueTime}` : ''}</span>}
                  {link && link.type === 'purchase' ? <EntityLink type="purchase" id={link.id}>Закупка № {db.purchases.find((p) => p.id === link.id)?.number}</EntityLink> : null}
                  {link && link.type === 'order' ? <EntityLink type="order" id={link.id}>Заказ № {ix.orders.get(link.id)?.number}</EntityLink> : null}
                  {link && link.type === 'product' ? <EntityLink type="product" id={link.id}>{ix.products.get(link.id)?.name}</EntityLink> : null}
                </div>
              </div>
              {t.priority === 'high' ? <Chip tone="warn">Срочно</Chip> : <span />}
            </div>
          );
        })
      )}
    </Card>
  );

  return (
    <>
      <PageHeader section="overview" actions={<StockDocButtons open={docs.open} />} />

      <div className="card stock-strip is-4">
        <Kpi
          label="К сборке сегодня"
          value={<>{fmt.num(data.todayPick.length)} <small className="stock-kpi-unit">{fmt.plural(data.todayPick.length, 'заказ', 'заказа', 'заказов')}</small></>}
          extra={data.todayPick.length === 0 ? <span className="stock-kpi-next">На завтра: {fmt.count(data.tomorrowPick.length, 'заказ', 'заказа', 'заказов')}</span> : undefined}
          onClick={() => navigate('/stock/picking')}
        />
        <Kpi label="Передать курьерам" value={<>{fmt.num(data.toCouriers.length)} <small className="stock-kpi-unit">{fmt.plural(data.toCouriers.length, 'заказ', 'заказа', 'заказов')}</small></>} onClick={() => navigate('/stock/picking')} />
        <Kpi label="Ожидаются поставки" value={<>{fmt.num(data.incoming.length)} <small className="stock-kpi-unit">{fmt.plural(data.incoming.length, 'закупка', 'закупки', 'закупок')}</small></>} onClick={() => navigate('/purchases')} />
        <Kpi
          label="Мало в магазине"
          value={<>{fmt.num(data.shopLow.length)} <small className="stock-kpi-unit">{fmt.plural(data.shopLow.length, 'позиция', 'позиции', 'позиций')}</small></>}
          extra={data.requests.length ? <span className="stock-kpi-next">Просят продавцы: {fmt.num(data.requests.length)}</span> : undefined}
          onClick={() => navigate('/stock?f=shopLow')}
        />
      </div>

      <div className="stock-home-grid is-wide-left">
        <div className="stock-home-col">
          {pickCard}
          {moveCard}
          {tasksCard}
          {feedCard}
        </div>
        <div className="stock-home-col">
          {handCard}
          {pickupCard}
          {incomingCard}
          {quarantineCard}
        </div>
      </div>

      {doc ? <StockDocDrawer id={doc} onClose={() => setDoc(null)} /> : null}
      {newTask ? <TaskModal onClose={() => setNewTask(false)} /> : null}
      {docs.element}
    </>
  );
}

interface MoveRequest {
  task: Task;
  p: Product;
  author: string;
  shop: number;
  wh: number;
  pack: 'pcs' | 'pack' | 'box';
  packSize: number;
  packQty: number;
  qty: number;
}

/** Сколько перенести по просьбе: число из текста просьбы («12 шт», «2 кор.»), иначе — расчёт «мало в магазине», иначе одна упаковка. Не больше, чем свободно на складе. */
function requestLine(t: Task, p: Product | undefined, l: StockLine | undefined, author: string): MoveRequest | null {
  if (!p || !l) return null;
  const wh = l.info.warehouse.available;
  const mp = movePack(p);
  const box = p.packs.find((x) => x.key === 'box');
  let want = 0;
  const pcs = /(\d+)\s*шт/i.exec(t.title);
  const bx = /(\d+)\s*кор/i.exec(t.title);
  const up = /(\d+)\s*уп/i.exec(t.title);
  if (pcs) want = Number(pcs[1]);
  else if (bx) want = Number(bx[1]) * (box?.qty ?? mp.qty);
  else if (up) want = Number(up[1]) * mp.qty;
  else if (l.shopMove) want = l.shopMove.qty;
  else want = mp.qty;
  const qty = Math.min(want, wh);
  // упаковками, если ровно делится, иначе штуками
  const pk = mp.qty > 1 && qty >= mp.qty && qty % mp.qty === 0 ? mp : p.packs[0];
  return { task: t, p, author, shop: l.info.shop.available, wh, pack: pk.key, packSize: pk.qty, packQty: pk.qty > 1 ? qty / pk.qty : qty, qty };
}
