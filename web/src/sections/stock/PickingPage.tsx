/* Склад → Сборка: очередь подтверждённых заказов, лист сборки, «Начать сборку → Собрано», выдача самовывозом. */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowRight, ExternalLink, PackageCheck, Play, Printer } from 'lucide-react';
import type { Delivery } from '../../data/types';
import { LOCATION_NAMES } from '../../data/types';
import { nowDemo, useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { EntityLink, useOpenEntity } from '../../shell/entities';
import {
  Button,
  Card,
  Chip,
  DataTable,
  EmptyState,
  MoreMenu,
  Notice,
  ProgressBar,
  StatusChip,
  cx,
  DELIVERY_STATE,
  PICK_STATE,
  SHIP_STATE,
  fmt,
  toast,
  type Column,
  type FilterDef,
} from '../../ui';
import { pickQueue, stockTabCounts, type PickItem } from './picking';
import { HandOverModal, UnpickedModal, Waybill, restSum } from './PickingModals';
import { act } from './act';
import { usePrint } from './print';

/** Порядок очереди: сегодняшнее и самовывоз — сверху, потом на будущие дни, собранные — в конце. */
function pickRank(x: PickItem): number {
  if (x.o.pick === 'picked') return 2;
  return x.forToday || x.o.fulfillment === 'pickup' ? 0 : 1;
}

function whenText(x: PickItem, today: string): string {
  if (x.o.fulfillment === 'pickup') return 'Самовывоз';
  if (!x.delivery) return 'Доставка, дата не назначена';
  return `${fmt.relDate(x.delivery.date, today)}, ${x.delivery.interval}`;
}

function packText(rest: number, pack: string, packSize: number): string {
  if (pack === 'pcs' || packSize <= 1) return '';
  const n = Math.floor(rest / packSize);
  const tail = rest - n * packSize;
  const unit = pack === 'box' ? 'кор.' : 'уп.';
  if (!n) return '';
  return `${fmt.num(n)} ${unit} по ${packSize}${tail ? ` + ${tail} шт` : ''}`;
}

export function PickSheet({ x, today, client }: { x: PickItem; today: string; client: string }) {
  return (
    <div className="stock-print-page">
      <h1>Лист сборки · заказ № {x.o.number}</h1>
      <div className="stock-print-meta">
        <span>Клиент: {client}</span>
        <span>{x.o.fulfillment === 'pickup' ? 'Самовывоз' : `Доставка: ${x.delivery ? `${fmt.date(x.delivery.date)}, ${x.delivery.interval}, ${x.delivery.address}` : 'дата не назначена'}`}</span>
        <span>Откуда: {LOCATION_NAMES[x.o.location]}</span>
        <span>
          Позиций: {x.positions} · штук: {x.qty} · мест: {x.places}
        </span>
        <span>Напечатан: {fmt.date(today)}</span>
      </div>
      <table>
        <thead>
          <tr>
            <th style={{ width: 24 }} />
            <th>№</th>
            <th>Товар</th>
            <th>Артикул</th>
            <th>Упаковка</th>
            <th className="num">Штук</th>
          </tr>
        </thead>
        <tbody>
          {x.lines.map((l, i) => (
            <tr key={i}>
              <td>
                <span className="stock-print-box" />
              </td>
              <td>{i + 1}</td>
              <td>{l.p.name}</td>
              <td>{l.p.sku}</td>
              <td>{packText(l.rest, l.line.pack, l.line.packSize) || 'штучно'}</td>
              <td className="num">{l.rest}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="stock-print-sign">
        <span>Собрал: ____________</span>
        <span>Проверил: ____________</span>
        <span>Мест: ______</span>
      </div>
    </div>
  );
}

function DeliveryNote({ d, courier }: { d: Delivery | undefined; courier: string | null }) {
  if (!d) return <Notice tone="warn">Доставка по заказу ещё не оформлена. Менеджер или диспетчер назначат дату и курьера</Notice>;
  if (d.state === 'waiting')
    return (
      <Notice tone="warn" title="Ждёт назначения курьера">
        Доставка № {d.number} на {fmt.date(d.date)}, {d.interval}. Товар спишется со склада, когда курьер отметит выезд
      </Notice>
    );
  return (
    <Notice tone="info" title={`Ждёт курьера${courier ? `: ${courier}` : ''}`}>
      Доставка № {d.number}, {fmt.date(d.date)}, {d.interval}. Отдайте собранный заказ курьеру — товар спишется со склада, когда он отметит выезд
    </Notice>
  );
}

export default function PickingPage() {
  const db = useDB();
  const version = useDBVersion();
  const { me, can } = useSession();
  const open = useOpenEntity();
  const printer = usePrint();
  const ix = indexes(db);
  const today = db.meta.today;
  // сначала то, что нужно собрать (не собран / собирается), собранные — ниже; внутри — по сроку
  const queue = useMemo(
    () => [...pickQueue(db)].sort((a, b) => pickRank(a) - pickRank(b)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [db, version],
  );
  const [params] = useSearchParams();
  const [sel, setSel] = useState<string | null>(() => params.get('order'));
  const [askPicked, setAskPicked] = useState<PickItem | null>(null);
  const [handOver, setHandOver] = useState<PickItem | null>(null);
  // выданный заказ уходит из очереди — показываем итог выдачи, а не переключаемся молча на другой
  const [handed, setHanded] = useState<{ x: PickItem; at: string; info: string } | null>(null);
  const firstOpen = queue.find((x) => x.o.pick !== 'picked') ?? queue[0];
  const showHanded = handed !== null && handed.x.id === sel && !queue.some((x) => x.id === sel);
  const current = showHanded ? undefined : queue.find((x) => x.id === sel) ?? firstOpen;
  useEffect(() => {
    if (!showHanded && current && current.id !== sel) setSel(current.id);
  }, [current, sel, showHanded]);

  const canWork = can('shipOrder');
  const clientName = (x: PickItem) => x.client?.name ?? 'Клиент';

  const filters: FilterDef<PickItem>[] = useMemo(
    () => [
      {
        key: 'stage',
        label: 'Этап',
        showCounts: true,
        options: [
          { value: 'all', label: 'Все' },
          { value: 'today', label: 'На сегодня', test: (x) => x.forToday },
          { value: 'none', label: 'Не начаты', test: (x) => x.o.pick === 'none' },
          { value: 'picking', label: 'Собираются', test: (x) => x.o.pick === 'picking' },
          { value: 'picked', label: 'Собраны', test: (x) => x.o.pick === 'picked' },
        ],
      },
    ],
    [],
  );

  const columns: Column<PickItem>[] = [
    {
      key: 'order',
      header: 'Заказ',
      sort: (x) => x.o.number,
      csv: (x) => x.o.number,
      render: (x) => (
        <div className="stock-order-cell">
          <div className="cell-title">№ {x.o.number}</div>
          <div className="cell-sub">{clientName(x)}</div>
        </div>
      ),
    },
    {
      key: 'when',
      header: 'Когда нужно',
      sort: (x) => (x.forToday ? '0' : '1') + (x.dueDay ?? '9999') + x.o.createdAt,
      csv: (x) => whenText(x, today),
      render: (x) => (
        <div>
          <div className="row" style={{ gap: 6 }}>
            <span className={x.forToday ? 'w-700 nowrap' : 'nowrap'}>{whenText(x, today)}</span>
          </div>
          {x.late ? <Chip tone="bad">Опаздывает</Chip> : x.o.fulfillment === 'pickup' ? <div className="cell-sub">заказ от {fmt.date(x.o.createdAt)}</div> : null}
        </div>
      ),
    },
    {
      key: 'qty',
      header: 'Состав',
      align: 'right',
      sort: (x) => x.qty,
      csv: (x) => x.qty,
      render: (x) => (
        <span className="nowrap">
          {fmt.num(x.positions)} поз. · <b>{fmt.qty(x.qty)}</b>
        </span>
      ),
      total: (rs) => fmt.qty(rs.reduce((s, x) => s + x.qty, 0)),
    },
    {
      key: 'pick',
      header: 'Сборка',
      sort: (x) => x.o.pick,
      csv: (x) => PICK_STATE[x.o.pick].label,
      render: (x) => (
        <div className="chips">
          <StatusChip s={PICK_STATE[x.o.pick]} />
          {x.o.ship === 'partial' ? <StatusChip s={SHIP_STATE.partial} /> : null}
        </div>
      ),
    },
  ];

  const run = (type: string, payload: unknown, ok: string) => {
    const r = act(type, payload, me.id);
    if (!r.ok) return toast(r.error, 'error');
    toast(r.info ? `${ok}. ${r.info}` : ok);
  };

  const markPicked = (x: PickItem) => run('order.pick', { orderId: x.o.id, stage: 'picked' }, `Заказ № ${x.o.number} собран`);

  const doHandOver = (x: PickItem, print: boolean): string | null => {
    const r = act('order.ship', { orderId: x.o.id }, me.id);
    if (!r.ok) return r.error;
    const at = nowDemo();
    setHanded({ x, at, info: r.info ?? '' });
    setHandOver(null);
    toast(`Заказ № ${x.o.number} выдан клиенту`);
    if (print) printer.print(<Waybill x={x} at={at} />);
    return null;
  };

  const todays = queue.filter((x) => x.forToday);
  const printToday = () => {
    const list = todays.length ? todays : queue;
    if (!list.length) return toast('Собирать нечего', 'info');
    printer.print(
      <>
        {list.map((x) => (
          <PickSheet key={x.id} x={x} today={today} client={clientName(x)} />
        ))}
      </>,
    );
  };

  const side = current ? (
    (() => {
      const x = current;
      // собранный заказ — все галочки стоят; при сборке отмечает кладовщик; до начала — пусто
      const picked = x.o.pick === 'picked';
      // отметки хранятся в заказе (order.pickChecked): ушёл на другой экран и вернулся — прогресс на месте
      const checkedIds = new Set(x.o.pickChecked ?? []);
      const isChecked = (pid: string) => picked || checkedIds.has(pid);
      const doneCount = picked ? x.lines.length : x.lines.filter((l) => checkedIds.has(l.line.productId)).length;
      const allDone = doneCount >= x.lines.length;
      const courier = x.delivery?.courierId ? ix.employees.get(x.delivery.courierId)?.name ?? null : null;
      const toggle = (pid: string) => {
        const next = new Set(checkedIds);
        if (next.has(pid)) next.delete(pid);
        else next.add(pid);
        const starting = x.o.pick === 'none' && next.size > 0;
        const r = act('order.pickProgress', { orderId: x.o.id, checked: [...next] }, me.id);
        if (!r.ok) return toast(r.error, 'error');
        if (starting) toast(`Сборка заказа № ${x.o.number} начата`);
      };
      return (
        <Card
          className="stock-pick-side"
          title={
            <EntityLink type="order" id={x.o.id}>
              Заказ № {x.o.number}
            </EntityLink>
          }
          sub={clientName(x)}
          actions={
            <MoreMenu
              items={[
                { label: 'Открыть заказ', icon: <ExternalLink />, onClick: () => open('order', x.o.id) },
                { label: 'Печать листа сборки', icon: <Printer />, onClick: () => printer.print(<PickSheet x={x} today={today} client={clientName(x)} />) },
              ]}
            />
          }
          foot={
            canWork ? (
              <div className="stock-pick-actions" style={{ width: '100%' }}>
                {x.o.pick === 'none' ? (
                  <Button variant="primary" icon={<Play />} onClick={() => run('order.pick', { orderId: x.o.id, stage: 'picking' }, `Сборка заказа № ${x.o.number} начата`)}>
                    Начать сборку
                  </Button>
                ) : x.o.pick === 'picking' ? (
                  <Button variant="primary" icon={<PackageCheck />} onClick={() => (allDone ? markPicked(x) : setAskPicked(x))}>
                    Собрано
                  </Button>
                ) : x.o.fulfillment === 'pickup' ? (
                  <Button variant="primary" icon={<PackageCheck />} onClick={() => setHandOver(x)}>
                    Выдать самовывозом
                  </Button>
                ) : null}
                <Button icon={<Printer />} onClick={() => printer.print(<PickSheet x={x} today={today} client={clientName(x)} />)}>
                  Лист сборки
                </Button>
              </div>
            ) : null
          }
        >
          <div className="stock-pick-meta">
            <StatusChip s={PICK_STATE[x.o.pick]} />
            {x.delivery ? <StatusChip s={DELIVERY_STATE[x.delivery.state]} /> : null}
          </div>
          <div className="t-13 ink-2 w-600" style={{ marginTop: 8 }}>
            {x.o.fulfillment === 'delivery' ? `Доставка ${whenText(x, today)}` : 'Самовывоз'}
          </div>
          {x.delivery ? <div className="t-12 muted" style={{ marginTop: 2 }}>{x.delivery.address}{courier ? ` · курьер ${courier}` : ''}</div> : null}
          {x.o.comment ? <div className="t-13 ink-2" style={{ marginTop: 8 }}>{x.o.comment}</div> : null}
          {x.o.pick === 'picking' ? (
            <div className="col" style={{ gap: 6, marginTop: 12 }}>
              <div className="row t-12">
                <span className="grow muted">Отобрано</span>
                <span className="w-700">
                  {doneCount} из {x.lines.length}
                </span>
              </div>
              <ProgressBar value={doneCount} max={x.lines.length} thin />
            </div>
          ) : null}
          <div className="stock-pick-sum" style={{ marginTop: 12, marginBottom: 8 }}>
            <span>
              <b>{fmt.count(x.positions, 'позиция', 'позиции', 'позиций')}</b> · {fmt.qty(x.qty)} · мест {x.places}
            </span>
            <span className="muted">Откуда: {LOCATION_NAMES[x.o.location].toLowerCase()}</span>
          </div>
          <div className="stock-pick-lines">
            {x.lines.map((l, i) => {
              const isDone = isChecked(l.line.productId);
              const pk = packText(l.rest, l.line.pack, l.line.packSize);
              // отмечать можно и до «Начать сборку»: первая отметка сама начинает сборку
              const locked = picked || !canWork;
              return (
                <label key={i} className={cx('stock-pick-line', isDone && !picked && 'is-done', locked && 'is-locked')}>
                  <input type="checkbox" checked={isDone} disabled={locked} onChange={() => toggle(l.line.productId)} aria-label="Отобрано" />
                  <span style={{ minWidth: 0 }}>
                    <span className="stock-pick-name">{l.p.name}</span>
                    <span className="stock-pick-sku">{l.p.sku}</span>
                  </span>
                  <span className="stock-pick-qty">
                    <b>{fmt.qty(l.rest)}</b>
                    {pk ? <span>{pk}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
          {x.o.pick === 'picked' && x.o.fulfillment === 'delivery' ? (
            <div style={{ marginTop: 12 }}>
              <DeliveryNote d={x.delivery} courier={courier} />
            </div>
          ) : null}
        </Card>
      );
    })()
  ) : handed && showHanded ? (
    <Card
      className="stock-pick-side"
      title={
        <EntityLink type="order" id={handed.x.o.id}>
          Заказ № {handed.x.o.number}
        </EntityLink>
      }
      sub={clientName(handed.x)}
      foot={
        <div className="stock-pick-actions" style={{ width: '100%' }}>
          {firstOpen ? (
            <Button variant="primary" iconRight={<ArrowRight />} onClick={() => setSel(firstOpen.id)}>
              Следующий: № {firstOpen.o.number}
            </Button>
          ) : null}
          <Button icon={<Printer />} onClick={() => printer.print(<Waybill x={handed.x} at={handed.at} />)}>
            Накладная
          </Button>
        </div>
      }
    >
      <Notice tone="ok" title={`Выдан клиенту в ${fmt.time(handed.at)}`}>
        {fmt.count(handed.x.positions, 'позиция', 'позиции', 'позиций')} · {fmt.qty(handed.x.qty)} на {fmt.money(restSum(handed.x))}. {handed.info}
      </Notice>
    </Card>
  ) : null;

  return (
    <>
      <PageHeader
        section="stock"
        counts={stockTabCounts(db)}
        actions={
          <Button icon={<Printer />} onClick={printToday}>
            Листы на сегодня
          </Button>
        }
      />
      {queue.length === 0 && !showHanded ? (
        <Card>
          <EmptyState icon={<PackageCheck />} title="Собирать нечего">
            Все подтверждённые заказы собраны и отгружены
          </EmptyState>
        </Card>
      ) : (
        <div className="stock-pick stock-tight">
          <DataTable
            id="stock-picking"
            rows={queue}
            columns={columns}
            rowKey={(x) => x.id}
            filters={filters}
            search={{ placeholder: 'Номер заказа или клиент', text: (x) => x.search }}
            selectedKey={current?.id ?? null}
            onRowClick={(x) => setSel(x.id)}
            exportName="Сборка"
            totalLabel={(n) => `Итого ${fmt.count(n, 'заказ', 'заказа', 'заказов')}`}
            empty={<EmptyState title="Таких заказов нет">Измените отбор</EmptyState>}
          />
          {side}
        </div>
      )}
      {askPicked ? (
        <UnpickedModal
          x={askPicked}
          onClose={() => setAskPicked(null)}
          onConfirm={() => {
            const x = askPicked;
            setAskPicked(null);
            markPicked(x);
          }}
        />
      ) : null}
      {handOver ? <HandOverModal x={handOver} onClose={() => setHandOver(null)} onDone={(print) => doHandOver(handOver, print)} /> : null}
      {printer.element}
    </>
  );
}
