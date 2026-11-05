import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader';
import { Card, Chip, EmptyState, Kpi, MoreMenu, Segmented, Select, StatusChip, fmt, toast } from '../../ui';
import { useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { arrangeSignals, computeSignals, kindsForRole, loadResolved, problemCount, saveResolved, signalsForRole, trackAttention, SMALL_AMOUNT, type GoneSignal, type Signal, type SignalKind } from './signals';
import { SIGNAL_ICON, SignalCard, SignalMarks, taskOf, useSignalActions, useTaskMarks } from './SignalParts';
import { lastReminderAt } from '../money/remind';
import { nowAt } from './analytics';
import { usePhone } from '../money/parts';
import './overview.css';

type KindFilter = 'all' | SignalKind;
type View = 'active' | 'done';

/** «Требует внимания»: главное на виду — с причиной, цифрами, ответственным и действием; однотипное мелкое — группами.
    Все числа — число проблем, а не строк: «Ещё 5 заказов с задержкой» — это пять. Фильтр по виду показывает каждую по отдельности.
    Бухгалтер видит только денежные сигналы. */
export default function Attention() {
  const db = useDB();
  const version = useDBVersion();
  const { role, me } = useSession();
  const today = db.meta.today;
  const phone = usePhone();
  const [params, setParams] = useSearchParams();
  const signals = useMemo(() => signalsForRole(computeSignals(db, today), role), [db, version, today, role]);
  const kinds = kindsForRole(role);
  const [resolved, setResolved] = useState<Record<string, string>>(loadResolved);
  const [view, setView] = useState<View>('active');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const kindParam = params.get('kind') as KindFilter | null;
  const kind: KindFilter = kindParam && kinds.some((k) => k.key === kindParam) ? kindParam : 'all';
  const setKind = (k: KindFilter) => {
    const next = new URLSearchParams(params);
    if (k === 'all') next.delete('kind');
    else next.set('kind', k);
    setParams(next, { replace: true });
    setView('active');
  };
  const actions = useSignalActions();
  const marks = useTaskMarks();

  const active = useMemo(() => signals.filter((s) => !resolved[s.id]), [signals, resolved]);
  const doneManual = useMemo(() => signals.filter((s) => resolved[s.id]), [signals, resolved]);
  const arranged = useMemo(() => arrangeSignals(active), [active]);
  // что пропало само, потому что дело сделали, и что поднялось на место разобранного
  const track = useMemo(() => trackAttention(role, today, nowAt().slice(11, 16), signals, active, arranged.important), [role, today, signals, active, arranged]);
  const doneCount = doneManual.length + track.gone.length;

  // число проблем каждого вида — то же число на плитке, в фильтре и в шапке
  const kindCount = useMemo(() => {
    const m = new Map<SignalKind, number>();
    for (const s of active) m.set(s.kind, (m.get(s.kind) ?? 0) + 1);
    return m;
  }, [active]);
  const total = active.length;
  const sumOf = (k: SignalKind) => active.filter((s) => s.kind === k).reduce((z, s) => z + s.amount, 0);
  const urgentCount = active.filter((s) => s.severity === 'high').length;

  let urgentList: Signal[];
  let urgentMore: Signal[] = [];
  let main: Signal[];
  let small: Signal[];
  if (kind === 'all') {
    urgentList = arranged.important.filter((s) => s.severity === 'high');
    urgentMore = arranged.urgentRest;
    main = arranged.important.filter((s) => s.severity === 'medium');
    small = arranged.rest;
  } else {
    // один вид — каждая проблема отдельной карточкой, без групп
    const list = active.filter((s) => s.kind === kind);
    urgentList = list.filter((s) => s.severity === 'high');
    main = list.filter((s) => s.severity === 'medium');
    small = list.filter((s) => s.severity === 'low');
  }
  const shownCount = urgentList.length + urgentMore.length + main.length + small.length;

  const toggle = (s: Signal) => {
    const ids = s.members ? s.members.map((m) => m.id) : [s.id];
    const next = { ...resolved };
    const back = !!resolved[s.id] || (!!s.members && ids.every((id) => next[id]));
    for (const id of ids) {
      if (back) delete next[id];
      else next[id] = today;
    }
    if (s.members && back) delete next[s.id];
    toast(back ? 'Сигнал возвращён в список' : s.members ? `Отмечено: разобрано ${s.members.length}` : 'Отмечено: разобрано');
    setResolved(next);
    saveResolved(next);
  };
  const resetAll = () => {
    setResolved({});
    saveResolved({});
    toast('Все сигналы снова в списке');
  };

  const card = (s: Signal, compact?: boolean): JSX.Element => {
    const m = <SignalMarks s={s} marks={marks} meId={me.id} db={db} short={compact} />;
    const has = !!taskOf(marks, s) || !!(s.remindClientId && lastReminderAt(db, s.remindClientId));
    return (
      <SignalCard
        key={s.id}
        compact={compact}
        s={s}
        actionLabel={actions.label(s)}
        onAction={() => (s.members ? setExpanded((e) => ({ ...e, [s.id]: !e[s.id] })) : actions.run(s))}
        resolved={!!resolved[s.id]}
        onToggleResolved={() => toggle(s)}
        open={!!expanded[s.id]}
        assigned={has ? m : null}
        raised={kind === 'all' && view === 'active' && track.raised.has(s.id)}
        onRemind={s.remindClientId ? () => actions.remind(s.remindClientId!) : undefined}
      >
        {s.members?.map((m) => card(m, true))}
      </SignalCard>
    );
  };

  const kindOptions = [
    { value: 'all' as KindFilter, label: 'Все', count: total },
    ...kinds
      .filter((k) => kindCount.get(k.key) || k.key === kind)
      .map((k) => ({ value: k.key as KindFilter, label: <span title={k.hint}>{k.label}</span>, count: kindCount.get(k.key) ?? 0 })),
  ];

  // число в заголовке группы — проблемы: строка «Ещё 8 товаров» — это восемь
  const group = (title: string, tone: 'bad' | 'warn' | undefined, cards: Signal[], lines: Signal[], hint?: string) =>
    cards.length || lines.length ? (
      <Card
        flush
        title={
          <span className="att-group-head" title={hint}>
            {title}
            <Chip tone={tone}>{fmt.num(problemCount(cards) + problemCount(lines))}</Chip>
          </span>
        }
      >
        <div className="att-list">
          {cards.map((x) => card(x))}
          {lines.map((x) => card(x, true))}
        </div>
      </Card>
    ) : null;

  const summary = (
    <div className="att-summary">
      <Kpi label="Срочных" value={fmt.num(urgentCount)} />
      <Kpi label={`Просрочено покупателями · ${fmt.num(kindCount.get('overdue') ?? 0)}`} value={fmt.money(sumOf('overdue'))} onClick={() => setKind('overdue')} />
      <Kpi label={`Ждут подтверждения · ${fmt.num(kindCount.get('payment') ?? 0)}`} value={fmt.money(sumOf('payment'))} onClick={() => setKind('payment')} />
      {role === 'accountant' ? (
        <Kpi label={`Оплаты поставщикам · ${fmt.num(kindCount.get('supplier') ?? 0)}`} value={fmt.money(sumOf('supplier'))} onClick={() => setKind('supplier')} />
      ) : (
        <Kpi label="Заказы с задержкой" value={fmt.num(kindCount.get('order_delay') ?? 0)} onClick={() => setKind('order_delay')} />
      )}
    </div>
  );

  const list =
    view === 'done' ? (
      <DoneList manual={doneManual} gone={track.gone} card={card} />
    ) : (
      <>
        {!shownCount ? (
          <Card>
            <EmptyState icon={<CheckCircle2 />} title="Сигналов нет">
              {kind === 'all' ? 'Оплаты, заказы и остатки в порядке' : 'По этому виду всё в порядке'}
            </EmptyState>
          </Card>
        ) : null}
        {group('Срочно', 'bad', urgentList, urgentMore)}
        {group('Важно', 'warn', main, [])}
        {group(kind === 'all' ? 'Остальное' : 'Не горит', undefined, [], small, kind === 'all' ? `Однотипное — одной строкой на вид, суммы до ${fmt.money(SMALL_AMOUNT)} и то, что не горит` : undefined)}
      </>
    );

  const phoneValue = view === 'done' ? 'done' : kind;

  return (
    <>
      <PageHeader
        section="overview"
        counts={{ attention: total }}
        // на телефоне «В работе / Разобрано» — в одном выпадающем списке с видами сигналов
        actions={
          phone ? undefined : (
            <>
              <Segmented
                ariaLabel="Показать"
                value={view}
                onChange={setView}
                options={[
                  { value: 'active', label: 'В работе', count: total },
                  { value: 'done', label: 'Разобрано сегодня', count: doneCount },
                ]}
              />
              <MoreMenu items={[{ label: 'Вернуть все разобранные', icon: <RotateCcw />, onClick: resetAll, disabled: !doneManual.length }]} />
            </>
          )
        }
      />

      {phone ? (
        <>
          <Select
            className="att-phone-filter"
            value={phoneValue}
            aria-label="Какие сигналы"
            onChange={(e) => {
              const v = e.target.value;
              if (v === 'done') setView('done');
              else setKind(v as KindFilter);
            }}
            options={[
              { value: 'all', label: `Все в работе · ${total}` },
              ...kinds.filter((k) => kindCount.get(k.key) || k.key === kind).map((k) => ({ value: k.key, label: `${k.label} · ${kindCount.get(k.key) ?? 0}` })),
              { value: 'done', label: `Разобрано сегодня · ${doneCount}` },
            ]}
          />
          {list}
          {summary}
        </>
      ) : (
        <>
          {summary}
          {view === 'active' ? (
            <div className="att-toolbar">
              <Segmented ariaLabel="Вид сигнала" value={kind} onChange={setKind} options={kindOptions} />
            </div>
          ) : null}
          {list}
        </>
      )}
      {actions.modal}
    </>
  );
}

/** «Разобрано сегодня»: что отметили вручную (можно вернуть) и что решилось само — платёж разнесли, поставщику заплатили. */
function DoneList({ manual, gone, card }: { manual: Signal[]; gone: GoneSignal[]; card: (s: Signal, compact?: boolean) => JSX.Element }) {
  if (!manual.length && !gone.length)
    return (
      <Card>
        <EmptyState icon={<CheckCircle2 />} title="Сегодня ещё ничего не разобрали">
          Сделайте дело по сигналу или отметьте его «Разобрано» — он появится здесь
        </EmptyState>
      </Card>
    );
  return (
    <>
      {gone.length ? (
        <Card
          flush
          title={
            <span className="att-group-head">
              Сделано
              <Chip tone="ok">{fmt.num(gone.length)}</Chip>
            </span>
          }
        >
          <div className="att-list">
            {gone.map((g) => (
              <div key={g.id} className="att-line is-gone">
                <span className="att-line-icon">{SIGNAL_ICON[g.kind]}</span>
                <span className="att-line-title" title={g.title}>
                  {g.title}
                </span>
                <span className="att-line-act">
                  <StatusChip s={{ label: `Решено в ${g.at}`, tone: 'ok' }} />
                </span>
              </div>
            ))}
          </div>
        </Card>
      ) : null}
      {manual.length ? (
        <Card
          flush
          title={
            <span className="att-group-head">
              Отмечено «Разобрано»
              <Chip>{fmt.num(manual.length)}</Chip>
            </span>
          }
        >
          <div className="att-list">{manual.map((s) => card(s, true))}</div>
        </Card>
      ) : null}
    </>
  );
}
