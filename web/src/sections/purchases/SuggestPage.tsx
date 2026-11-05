/* Закупки → Предложение на закупку: по поставщикам, с учётом продаж, доступного, резерва,
   ожидаемых поставок, срока поставки и коробки поставщика. Подтверждает закупку владелец. */
import { useMemo, useState } from 'react';
import { CheckCircle2, Info, PencilLine, Send } from 'lucide-react';
import type { ID } from '../../data/types';
import type { SuggestionLine } from '../../data/ops';
import { useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { get } from '../../data/idx';
import { plusDays } from '../../data/dates';
import { useSession } from '../../roles/session';
import { PageHeader } from '../../shell/PageHeader';
import { useOpenEntity } from '../../shell/entities';
import { Button, Card, Checkbox, Chip, EmptyState, Field, Input, Modal, Notice, QtyInput, StatList, StatRow, PURCHASE_STATE, cx, fmt, toast } from '../../ui';
import { SALES_WINDOW_DAYS, SUGGEST_SAFETY_DAYS } from '../../data/thresholds';
import { act } from '../stock/act';
import { cap } from '../stock/calc';
import { suggestionAll, usePurchaseCounts } from './counts';
import { NewPurchaseModal } from './NewPurchaseModal';
import './purchases.css';

interface Group {
  sid: ID;
  name: string;
  lines: SuggestionLine[];
  urgent: number;
}

export default function SuggestPage() {
  const db = useDB();
  const version = useDBVersion();
  const { me, can, role } = useSession();
  const seeCost = can('seeCost');
  const canCreate = can('createPurchase');
  const open = useOpenEntity();
  const counts = usePurchaseCounts();
  const ix = indexes(db);
  const today = db.meta.today;
  const [sel, setSel] = useState<ID | null>(null);
  const [boxes, setBoxes] = useState<Record<ID, number>>({});
  const [off, setOff] = useState<Record<ID, boolean>>({});
  const [confirm, setConfirm] = useState(false);
  const [edit, setEdit] = useState(false);
  const [explain, setExplain] = useState(false);

  const groups = useMemo<Group[]>(() => {
    const m = new Map<ID, Group>();
    for (const l of suggestionAll(db)) {
      let g = m.get(l.supplierId);
      if (!g) {
        g = { sid: l.supplierId, name: ix.suppliers.get(l.supplierId)?.name ?? 'Поставщик', lines: [], urgent: 0 };
        m.set(l.supplierId, g);
      }
      g.lines.push(l);
      if (l.daysLeft !== null && l.daysLeft <= l.leadDays) g.urgent++;
    }
    return [...m.values()].sort((a, b) => b.urgent - a.urgent || b.lines.length - a.lines.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, version]);

  const g = groups.find((x) => x.sid === sel) ?? groups[0];
  const s = g ? ix.suppliers.get(g.sid) : undefined;
  const lines = g?.lines ?? [];
  const boxesOf = (l: SuggestionLine) => boxes[l.productId] ?? l.boxes;
  const on = lines.filter((l) => !off[l.productId]);
  const total = on.reduce((z, l) => z + boxesOf(l) * l.boxSize * l.price, 0);
  const totalBoxes = on.reduce((z, l) => z + boxesOf(l), 0);
  const totalQty = on.reduce((z, l) => z + boxesOf(l) * l.boxSize, 0);
  const groupSum = (x: Group) => x.lines.reduce((z, l) => z + (off[l.productId] ? 0 : (boxes[l.productId] ?? l.boxes) * l.boxSize * l.price), 0);
  const waiting = g ? db.purchases.filter((p) => p.supplierId === g.sid && (p.state === 'draft' || p.state === 'ordered' || p.state === 'partial')) : [];
  const owner = db.employees.find((e) => e.active && e.roles.includes('owner'));

  const sendToOwner = () => {
    if (!g || !s || !owner) return;
    const r = act(
      'task.create',
      {
        title: `Подтвердить закупку у ${s.name}: ${fmt.count(on.length, 'позиция', 'позиции', 'позиций')}, ${fmt.count(totalBoxes, 'коробка', 'коробки', 'коробок')} — по предложению на закупку`,
        assigneeId: owner.id,
        due: today,
        priority: g.urgent ? 'high' : 'normal',
        link: on[0] ? { type: 'product', id: on[0].productId } : null,
      },
      me.id,
    );
    if (!r.ok) return toast(r.error, 'error');
    toast(`Передано владельцу: ${owner.name}`);
  };

  const header = (
    <PageHeader
      section="purchases"
      counts={counts}
      actions={
        g ? (
          <>
            <Button variant="ghost" icon={<Info />} onClick={() => setExplain(true)}>
              Как считается
            </Button>
            {canCreate ? (
              <Button variant="primary" icon={<CheckCircle2 />} disabled={!on.length} onClick={() => setConfirm(true)}>
                Создать закупку
              </Button>
            ) : role === 'warehouse' ? (
              <Button variant="primary" icon={<Send />} disabled={!on.length} onClick={sendToOwner}>
                Передать владельцу
              </Button>
            ) : null}
          </>
        ) : null
      }
    />
  );

  if (!g || !s)
    return (
      <>
        {header}
        <Card>
          <EmptyState icon={<CheckCircle2 />} title="Закупать пока нечего">
            Товара хватает с учётом продаж, резерва и того, что уже едет
          </EmptyState>
        </Card>
      </>
    );

  return (
    <>
      {header}
      <div className="pur-suggest">
        <Card flush title="Поставщики" className="pur-suggest-side">
          <div className="list">
            {groups.map((x) => (
              <button key={x.sid} type="button" className={cx('pur-sup-row', x.sid === g.sid && 'is-active')} onClick={() => setSel(x.sid)}>
                <span className="pur-sup-name">{x.name}</span>
                <span className="pur-sup-meta">
                  <span>
                    {fmt.num(x.lines.length)} поз.
                    {seeCost ? ` · ${fmt.money(groupSum(x))}` : ''}
                  </span>
                  {x.urgent ? <Chip tone="bad" title="Закончится раньше, чем придёт поставка">Срочно {x.urgent}</Chip> : null}
                </span>
              </button>
            ))}
          </div>
        </Card>

        <div className="col-4 stock-tight" style={{ minWidth: 0 }}>
          <Card
            flush
            title={s.name}
            actions={
              <span className="t-13 ink-2 nowrap">
                Поставка {fmt.count(s.leadDays, 'день', 'дня', 'дней')} · наша отсрочка {s.deferDays ? fmt.count(s.deferDays, 'день', 'дня', 'дней') : 'нет, предоплата'}
                {seeCost && s.minOrder ? ` · минимум ${fmt.money(s.minOrder)}` : ''}
              </span>
            }
            foot={
              <>
                <span className="stock-doc-total">
                  В закупку: {fmt.count(on.length, 'позиция', 'позиции', 'позиций')} · {fmt.count(totalBoxes, 'коробка', 'коробки', 'коробок')} · {fmt.qty(totalQty)}
                  {seeCost ? ` · ${fmt.money(total)}` : ''}
                </span>
                <span className="spacer" />
                {off && Object.values(off).some(Boolean) ? (
                  <Button size="sm" variant="ghost" onClick={() => setOff({})}>
                    Вернуть снятые
                  </Button>
                ) : null}
              </>
            }
          >
            {waiting.length ? (
              <div style={{ padding: '0 20px 12px' }}>
                <Notice tone="info">
                  У поставщика уже есть {waiting.map((p) => `№ ${p.number} (${p.state === 'draft' ? PURCHASE_STATE.draft.label.toLowerCase() : `${PURCHASE_STATE[p.state].label.toLowerCase()}, ждём ${fmt.relDate(p.expectedAt, today)}`})`).join(', ')}. Черновик в «Ожидается» не входит
                </Notice>
              </div>
            ) : null}
            <div className="table-scroll">
              <table className="table pur-suggest-table">
                <thead>
                  <tr>
                    <th style={{ width: 36 }} aria-label="В закупку" />
                    <th>Товар</th>
                    <th className="num" title={`Продажи за ${SALES_WINDOW_DAYS} дней на кассе и оптом, в среднем за день`}>
                      В день
                    </th>
                    <th className="num" title={`Доступное ÷ продажи в день. Поставка от ${s.name} — ${fmt.count(s.leadDays, 'день', 'дня', 'дней')}`}>
                      Хватит на
                    </th>
                    <th className="num">Ожидается</th>
                    <th style={{ width: 120 }}>Коробок</th>
                    <th className="num" title="Коробок × штук в коробке">Штук</th>
                    {seeCost ? <th className="num">Сумма</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const isOff = !!off[l.productId];
                    const b = boxesOf(l);
                    const urgent = l.daysLeft !== null && l.daysLeft <= l.leadDays;
                    return (
                      <tr key={l.productId} className={cx(isOff && 'pur-off')}>
                        <td>
                          <input
                            type="checkbox"
                            className="task-check"
                            checked={!isOff}
                            onChange={() => setOff((o) => ({ ...o, [l.productId]: !isOff }))}
                            aria-label="В закупку"
                          />
                        </td>
                        <td>
                          <button type="button" className="entity-link pur-line-name" title={cap(l.reason)} onClick={() => open('product', l.productId)}>
                            {l.name}
                          </button>
                        </td>
                        <td className="num">{l.perDay >= 0.05 ? fmt.num(l.perDay, l.perDay < 10 ? 1 : 0) : <span className="faint">0</span>}</td>
                        <td className="num" title={cap(l.reason)}>
                          <WhyCell l={l} urgent={urgent} />
                        </td>
                        <td className="num">{l.expected ? fmt.num(l.expected) : <span className="faint">0</span>}</td>
                        <td>
                          <QtyInput value={b} min={1} onChange={(v) => setBoxes((x) => ({ ...x, [l.productId]: Math.max(1, v) }))} ariaLabel="Коробок" />
                        </td>
                        <td className="num">
                          <span className="w-700" title={`${b} кор. по ${l.boxSize} шт`}>{fmt.num(b * l.boxSize)}</span>
                        </td>
                        {seeCost ? <td className="num w-600">{fmt.money(b * l.boxSize * l.price)}</td> : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
          {seeCost && s.minOrder && total > 0 && total < s.minOrder ? <Notice tone="warn">До минимального заказа {s.name} не хватает {fmt.money(s.minOrder - total)}</Notice> : null}
        </div>
      </div>

      {confirm ? (
        <ConfirmModal
          supplierName={s.name}
          leadDays={s.leadDays}
          positions={on.length}
          boxes={totalBoxes}
          qty={totalQty}
          total={total}
          seeCost={seeCost}
          onEdit={() => {
            setConfirm(false);
            setEdit(true);
          }}
          onClose={() => setConfirm(false)}
          onCreate={(expectedAt, approve) => {
            const r = act('purchase.create', { supplierId: s.id, expectedAt, lines: on.map((l) => ({ productId: l.productId, boxes: boxesOf(l), boxSize: l.boxSize, price: l.price })) }, me.id);
            if (!r.ok) return r.error;
            const n = get(db, 'purchases', r.id!)?.number;
            if (approve) {
              const a = act('purchase.approve', { purchaseId: r.id, expectedAt }, me.id);
              if (!a.ok) return `Закупка № ${n} создана черновиком, но не подтверждена: ${a.error}`;
            }
            toast(`Закупка № ${n} ${approve ? 'создана и подтверждена' : 'создана черновиком'}${r.info ? `. ${r.info}` : ''}`);
            setConfirm(false);
            setBoxes({});
            setOff({});
            open('purchase', r.id!);
            return null;
          }}
        />
      ) : null}
      {edit ? <NewPurchaseModal supplierId={s.id} lines={on.map((l) => ({ productId: l.productId, boxes: boxesOf(l), boxSize: l.boxSize, price: l.price }))} onClose={() => setEdit(false)} /> : null}
      {explain ? (
        <Modal title="Как считается предложение" onClose={() => setExplain(false)} footer={<Button variant="primary" onClick={() => setExplain(false)}>Понятно</Button>}>
          <div className="col-3 t-14 ink-2">
            <p>Берём продажи товара за последние {SALES_WINDOW_DAYS} дней — на кассе и оптом — и делим на дни. Это «В день».</p>
            <p>«Хватит на» — сколько дней продержится доступное: магазин + склад − резерв под заказы.</p>
            <p>Предлагаем товар, которого не хватит на срок поставки и ещё {fmt.count(SUGGEST_SAFETY_DAYS, 'день', 'дня', 'дней')} запаса, и товар ниже минимального остатка. Уже заказанное у поставщика вычитаем.</p>
            <p>Недостающее округляем вверх до целой коробки поставщика. Количество можно поправить или снять строку.</p>
            <p>Закупку подтверждает владелец. Пока она черновик, товар не входит в «Ожидается».</p>
            <p>Причина по каждому товару — в подсказке при наведении на строку.</p>
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** «Хватит на»: число дней, а если продаж нет или товар закончился — короткий чип вместо пустоты. */
function WhyCell({ l, urgent }: { l: SuggestionLine; urgent: boolean }) {
  if (l.available <= 0) return <Chip tone="bad">Закончился</Chip>;
  if (l.daysLeft === null) return <Chip tone="warn">Ниже минимума</Chip>;
  return <span className={urgent ? 'c-bad w-700 nowrap' : 'nowrap'}>{l.daysLeft === 0 ? 'меньше дня' : fmt.count(l.daysLeft, 'день', 'дня', 'дней')}</span>;
}

function ConfirmModal({
  supplierName,
  leadDays,
  positions,
  boxes,
  qty,
  total,
  seeCost,
  onCreate,
  onEdit,
  onClose,
}: {
  supplierName: string;
  leadDays: number;
  positions: number;
  boxes: number;
  qty: number;
  total: number;
  seeCost: boolean;
  onCreate: (expectedAt: string, approve: boolean) => string | null;
  onEdit: () => void;
  onClose: () => void;
}) {
  const db = useDB();
  const { me, can } = useSession();
  const [expected, setExpected] = useState(plusDays(db.meta.today, leadDays));
  const [approve, setApprove] = useState(can('approvePurchase'));
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal
      title="Создать закупку"
      sub={supplierName}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" icon={<PencilLine />} onClick={onEdit}>
            Поправить строки
          </Button>
          <span className="spacer" />
          <Button variant="ghost" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="primary" onClick={() => setError(onCreate(expected, approve))}>
            {approve ? 'Создать и подтвердить' : 'Создать черновик'}
          </Button>
        </>
      }
    >
      <StatList>
        <StatRow label="Позиций" value={fmt.num(positions)} />
        <StatRow label="Коробок" value={fmt.num(boxes)} />
        <StatRow label="Штук" value={fmt.num(qty)} />
        {seeCost ? <StatRow total label="Сумма закупки" value={fmt.money(total)} /> : null}
      </StatList>
      <Field label="Ожидаем поставку">
        <Input type="date" value={expected} onChange={(e) => setExpected(e.target.value)} />
      </Field>
      {can('approvePurchase') ? (
        <Notice tone="info" title="Подтверждает владелец">
          <div style={{ marginTop: 6 }}>
            <Checkbox checked={approve} onChange={setApprove}>
              Я, {me.name}, подтверждаю закупку — отправить поставщику
            </Checkbox>
          </div>
        </Notice>
      ) : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Modal>
  );
}
