import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, RotateCcw } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader';
import { Card, Chip, EmptyState, Kpi, MoreMenu, Segmented, fmt, toast } from '../../ui';
import { useDB, useDBVersion } from '../../data/store';
import { useSession } from '../../roles/session';
import { arrangeSignals, computeSignals, kindsForRole, loadResolved, saveResolved, signalsForRole, SMALL_AMOUNT, type Signal, type SignalKind } from './signals';
import { SignalCard, useSignalActions } from './SignalParts';
import './overview.css';

type KindFilter = 'all' | SignalKind;

/** «Требует внимания»: главное на виду — с причиной, цифрами, ответственным и действием; однотипное мелкое — группами.
    Бухгалтер видит только денежные сигналы. */
export default function Attention() {
  const db = useDB();
  const version = useDBVersion();
  const { role } = useSession();
  const today = db.meta.today;
  const [params, setParams] = useSearchParams();
  const signals = useMemo(() => signalsForRole(computeSignals(db, today), role), [db, version, today, role]);
  const kinds = kindsForRole(role);
  const [resolved, setResolved] = useState<Record<string, string>>(loadResolved);
  const [view, setView] = useState<'active' | 'done'>('active');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const kindParam = params.get('kind') as KindFilter | null;
  const kind: KindFilter = kindParam && kinds.some((k) => k.key === kindParam) ? kindParam : 'all';
  const setKind = (k: KindFilter) => {
    const next = new URLSearchParams(params);
    if (k === 'all') next.delete('kind');
    else next.set('kind', k);
    setParams(next, { replace: true });
  };
  const actions = useSignalActions();

  const active = signals.filter((s) => !resolved[s.id]);
  const done = signals.filter((s) => resolved[s.id]);
  const arranged = useMemo(() => arrangeSignals(active), [signals, resolved]);
  const lines = arranged.important.length + arranged.rest.length;

  // Строки списка. «В работе» — как на экране: главное по одному, однотипное мелкое — одной строкой-группой.
  // Фильтр по виду показывает те же строки этого вида, поэтому счётчик чипа = число карточек, а сумма чипов = «Все».
  const rows = view === 'active' ? [...arranged.important, ...arranged.rest] : done;
  const rowCounts = new Map<SignalKind, number>();
  for (const s of rows) rowCounts.set(s.kind, (rowCounts.get(s.kind) ?? 0) + 1);
  const ofKind = (s: Signal) => kind === 'all' || s.kind === kind;
  const urgentList = (view === 'active' ? arranged.important : done).filter((s) => s.severity === 'high' && ofKind(s));
  const main = (view === 'active' ? arranged.important : done).filter((s) => s.severity === 'medium' && ofKind(s));
  const small = (view === 'active' ? arranged.rest : done.filter((s) => s.severity === 'low')).filter(ofKind);
  const shownCount = urgentList.length + main.length + small.length;

  const money = (k: SignalKind[]) => active.filter((s) => k.includes(s.kind)).reduce((z, s) => z + s.amount, 0);
  const urgentCount = arranged.important.filter((s) => s.severity === 'high').length;
  const delayedOrders = active.filter((s) => s.kind === 'order_delay').length;

  const toggle = (s: Signal) => {
    const ids = s.members ? s.members.map((m) => m.id) : [s.id];
    const next = { ...resolved };
    const back = !!resolved[s.id] || (!!s.members && ids.every((id) => next[id]));
    for (const id of ids) {
      if (back) delete next[id];
      else next[id] = today;
    }
    if (s.members) {
      if (back) delete next[s.id];
    }
    toast(back ? 'Сигнал возвращён в список' : s.members ? `Отмечено: разобрано ${s.members.length}` : 'Отмечено: разобрано');
    setResolved(next);
    saveResolved(next);
  };
  const resetAll = () => {
    setResolved({});
    saveResolved({});
    toast('Все сигналы снова в списке');
  };

  const card = (s: Signal, compact?: boolean): JSX.Element => (
    <SignalCard
      key={s.id}
      compact={compact}
      s={s}
      actionLabel={actions.label(s)}
      onAction={() => (s.members ? setExpanded((e) => ({ ...e, [s.id]: !e[s.id] })) : actions.run(s))}
      resolved={!!resolved[s.id]}
      onToggleResolved={() => toggle(s)}
      open={!!expanded[s.id]}
    >
      {s.members?.map((m) => card(m, true))}
    </SignalCard>
  );

  const kindOptions = [
    { value: 'all' as KindFilter, label: 'Все', count: rows.length },
    ...kinds
      .filter((k) => rowCounts.get(k.key) || k.key === kind)
      .map((k) => ({ value: k.key as KindFilter, label: <span title={k.hint}>{k.label}</span>, count: rowCounts.get(k.key) ?? 0 })),
  ];

  return (
    <>
      <PageHeader
        section="overview"
        counts={{ attention: lines }}
        actions={
          <>
            <Segmented
              ariaLabel="Показать"
              value={view}
              onChange={setView}
              options={[
                { value: 'active', label: 'В работе', count: lines },
                { value: 'done', label: 'Разобрано', count: done.length },
              ]}
            />
            <MoreMenu items={[{ label: 'Вернуть все разобранные', icon: <RotateCcw />, onClick: resetAll, disabled: !done.length }]} />
          </>
        }
      />

      <div className="att-summary">
        <Kpi label="Срочных" value={fmt.num(urgentCount)} />
        <Kpi label="Просрочено покупателями" value={fmt.money(money(['overdue']))} onClick={() => setKind('overdue')} />
        <Kpi label="Ждут подтверждения" value={fmt.money(active.filter((s) => s.tag === 'pending').reduce((z, s) => z + s.amount, 0))} onClick={() => setKind('payment')} />
        {role === 'accountant' ? (
          <Kpi label="Поставщикам на этой неделе" value={fmt.money(money(['supplier']))} onClick={() => setKind('supplier')} />
        ) : (
          <Kpi label="Заказы с задержкой" value={fmt.num(delayedOrders)} onClick={() => setKind('order_delay')} />
        )}
      </div>

      <div className="att-toolbar">
        <Segmented ariaLabel="Вид сигнала" value={kind} onChange={setKind} options={kindOptions} />
      </div>

      {!shownCount ? (
        <Card>
          <EmptyState icon={<CheckCircle2 />} title={view === 'active' ? 'Сигналов нет' : 'Разобранных пока нет'}>
            {view === 'active' ? 'По этому виду всё в порядке' : 'Отметьте сигнал «Разобрано», чтобы он не мешал'}
          </EmptyState>
        </Card>
      ) : null}

      {urgentList.length ? (
        <Card
          flush
          title={
            <span className="att-group-head">
              Срочно
              <Chip tone="bad">{fmt.num(urgentList.length)}</Chip>
            </span>
          }
        >
          <div className="att-list">{urgentList.map((x) => card(x))}</div>
        </Card>
      ) : null}

      {main.length ? (
        <Card
          flush
          title={
            <span className="att-group-head">
              Важно
              <Chip tone="warn">{fmt.num(main.length)}</Chip>
            </span>
          }
        >
          <div className="att-list">{main.map((x) => card(x))}</div>
        </Card>
      ) : null}

      {small.length ? (
        <Card
          flush
          title={
            <span className="att-group-head" title={`Однотипное — одной строкой на вид, суммы до ${fmt.money(SMALL_AMOUNT)} и то, что не горит`}>
              Остальное
              <Chip>{fmt.num(small.length)}</Chip>
            </span>
          }
        >
          <div className="att-list">{small.map((x) => card(x, true))}</div>
        </Card>
      ) : null}
      {actions.modal}
    </>
  );
}
