import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, ChevronDown, RotateCcw } from 'lucide-react';
import { PageHeader } from '../../shell/PageHeader';
import { Button, Card, Chip, EmptyState, Kpi, MoreMenu, Segmented, fmt, toast } from '../../ui';
import { useDB, useDBVersion } from '../../data/store';
import { computeSignals, loadResolved, saveResolved, SIGNAL_KINDS, SMALL_AMOUNT, type Signal, type SignalKind } from './signals';
import { SignalCard, useSignalActions } from './SignalParts';
import './overview.css';

type KindFilter = 'all' | SignalKind;

/** «Требует внимания»: все сигналы с причиной, цифрами, ответственным и действием. */
export default function Attention() {
  const db = useDB();
  const version = useDBVersion();
  const today = db.meta.today;
  const [params, setParams] = useSearchParams();
  const signals = useMemo(() => computeSignals(db, today), [db, version, today]);
  const [resolved, setResolved] = useState<Record<string, string>>(loadResolved);
  const [view, setView] = useState<'active' | 'done'>('active');
  const kindParam = params.get('kind') as KindFilter | null;
  const kind: KindFilter = kindParam && SIGNAL_KINDS.some((k) => k.key === kindParam) ? kindParam : 'all';
  const setKind = (k: KindFilter) => {
    const next = new URLSearchParams(params);
    if (k === 'all') next.delete('kind');
    else next.set('kind', k);
    setParams(next, { replace: true });
  };
  const actions = useSignalActions();

  const active = signals.filter((s) => !resolved[s.id]);
  const done = signals.filter((s) => resolved[s.id]);
  const pool = view === 'active' ? active : done;
  const counts = new Map<SignalKind, number>();
  for (const s of pool) counts.set(s.kind, (counts.get(s.kind) ?? 0) + 1);
  const shown = kind === 'all' ? pool : pool.filter((s) => s.kind === kind);
  const urgentList = shown.filter((s) => s.severity === 'high');
  const main = shown.filter((s) => s.severity === 'medium');
  const small = shown.filter((s) => s.severity === 'low');
  const [more, setMore] = useState<Record<string, boolean>>({});
  // без фильтра длинные группы свёрнуты: видно главное, остальное — по кнопке
  const cut = (key: string, list: Signal[], n: number) => (kind !== 'all' || more[key] ? list : list.slice(0, n));
  const moreBtn = (key: string, list: Signal[], n: number) =>
    kind === 'all' && !more[key] && list.length > n ? (
      <div className="att-more">
        <Button variant="ghost" size="sm" icon={<ChevronDown />} onClick={() => setMore((m) => ({ ...m, [key]: true }))}>
          Показать ещё {fmt.num(list.length - n)}
        </Button>
      </div>
    ) : null;
  const card = (s: Signal, compact?: boolean) => (
    <SignalCard key={s.id} compact={compact} s={s} actionLabel={actions.label(s)} onAction={() => actions.run(s)} resolved={!!resolved[s.id]} onToggleResolved={() => toggle(s)} />
  );

  const high = active.filter((s) => s.severity === 'high');
  const money = (k: SignalKind[]) => active.filter((s) => k.includes(s.kind)).reduce((z, s) => z + s.amount, 0);

  const toggle = (s: Signal) => {
    const next = { ...resolved };
    if (next[s.id]) {
      delete next[s.id];
      toast('Сигнал возвращён в список');
    } else {
      next[s.id] = today;
      toast('Отмечено: разобрано');
    }
    setResolved(next);
    saveResolved(next);
  };
  const resetAll = () => {
    setResolved({});
    saveResolved({});
    toast('Все сигналы снова в списке');
  };

  const kindOptions = [
    { value: 'all' as KindFilter, label: 'Все', count: pool.length },
    ...SIGNAL_KINDS.filter((k) => counts.get(k.key)).map((k) => ({ value: k.key as KindFilter, label: k.label, count: counts.get(k.key) ?? 0 })),
  ];

  return (
    <>
      <PageHeader
        section="overview"
        counts={{ attention: active.length }}
        actions={<MoreMenu items={[{ label: 'Вернуть все разобранные', icon: <RotateCcw />, onClick: resetAll, disabled: !done.length }]} />}
      />

      <div className="att-summary">
        <Kpi label="Срочных" value={fmt.num(high.length)} />
        <Kpi label="Просрочено покупателями" value={fmt.money(money(['overdue']))} onClick={() => setKind('overdue')} />
        <Kpi label="Платежи на проверке" value={fmt.money(money(['payment']))} onClick={() => setKind('payment')} />
        <Kpi label="Заказы с задержкой" value={fmt.num(active.filter((s) => s.kind === 'order_delay').length)} onClick={() => setKind('order_delay')} />
      </div>

      <div className="att-toolbar">
        <Segmented ariaLabel="Вид сигнала" value={kind} onChange={setKind} options={kindOptions} />
        <span className="spacer" />
        <Segmented
          ariaLabel="Показать"
          value={view}
          onChange={setView}
          options={[
            { value: 'active', label: 'В работе', count: active.length },
            { value: 'done', label: 'Разобрано', count: done.length },
          ]}
        />
      </div>

      {!shown.length ? (
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
          <div className="att-list">{cut('main', main, 8).map((x) => card(x))}</div>
          {moreBtn('main', main, 8)}
        </Card>
      ) : null}

      {small.length ? (
        <Card
          flush
          title={
            <span className="att-group-head" title={`Суммы до ${fmt.money(SMALL_AMOUNT)} и то, что не горит, — одной строкой, чтобы не шуметь`}>
              Мелкое, одной строкой
              <Chip>{fmt.num(small.length)}</Chip>
            </span>
          }
        >
          <div className="att-list">{cut('small', small, 8).map((x) => card(x, true))}</div>
          {moreBtn('small', small, 8)}
        </Card>
      ) : null}
      {actions.modal}
    </>
  );
}
