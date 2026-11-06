import { useMemo, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Check, CheckCircle2, Info } from 'lucide-react';
import { PageHeader } from '../../../shell/PageHeader';
import { Button, Card, Chip, IconTile, Kpi, StatList, StatRow, StatusChip, cx, fmt, type Tone } from '../../../ui';
import { useDB, useDBVersion } from '../../../data/store';
import { ACCOUNT_NAMES } from '../../../data/types';
import { ProductImport } from './ProductImport';
import { setupStats, type SetupStats } from './stats';

type StepKey = 'products' | 'stock' | 'money' | 'check';
const STEPS: { key: StepKey; title: string }[] = [
  { key: 'products', title: 'Товары' },
  { key: 'stock', title: 'Остатки' },
  { key: 'money', title: 'Долги и деньги' },
  { key: 'check', title: 'Проверка' },
];

function Todo({ items }: { items: ReactNode[] }) {
  return (
    <ol className="set-todo">
      {items.map((x, i) => (
        <li key={i}>{x}</li>
      ))}
    </ol>
  );
}

function stepState(s: SetupStats, k: StepKey): { done: boolean; chip: { label: string; tone: Tone }; figure: string } {
  const problems = s.checks.filter((c) => !c.soft && c.count > 0).length;
  switch (k) {
    case 'products':
      return {
        done: s.products.total > 0,
        chip: s.products.total > 0 ? { label: 'Внесено', tone: 'ok' } : { label: 'Не начато', tone: 'neutral' },
        figure: fmt.count(s.products.total, 'товар', 'товара', 'товаров'),
      };
    case 'stock':
      return {
        done: s.stock.withStock > 0,
        chip: s.stock.withStock > 0 ? { label: 'Внесено', tone: 'ok' } : { label: 'Не начато', tone: 'neutral' },
        figure: `${fmt.num(s.stock.withStock)} из ${fmt.num(s.stock.active)} с остатком`,
      };
    case 'money':
      return {
        done: s.money.initialMoneyDate !== null || s.money.clientsDebt > 0,
        chip: s.money.initialMoneyDate !== null || s.money.clientsDebt > 0 ? { label: 'Внесено', tone: 'ok' } : { label: 'Не начато', tone: 'neutral' },
        figure: `${fmt.count(s.money.clientsDebt, 'клиент', 'клиента', 'клиентов')} с долгом`,
      };
    case 'check': {
      const total = s.checks.filter((c) => !c.soft).length;
      return {
        done: problems === 0,
        chip: problems ? { label: `Разобрать: ${problems}`, tone: 'warn' } : { label: 'Всё в порядке', tone: 'ok' },
        figure: `${fmt.num(total - problems)} из ${fmt.num(total)} в порядке`,
      };
    }
  }
}

export function SetupPage() {
  const db = useDB();
  const version = useDBVersion();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const raw = params.get('step');
  const step: StepKey = STEPS.some((s) => s.key === raw) ? (raw as StepKey) : 'products';
  const s = useMemo(() => setupStats(db), [db, version]);

  const go = (k: StepKey) => {
    const next = new URLSearchParams(params);
    if (k === 'products') next.delete('step');
    else next.set('step', k);
    setParams(next, { replace: true });
  };

  return (
    <div className="set-page">
      <PageHeader section="settings" />

      <Card hint="settings.setup.steps">
        <div className="set-steps" role="tablist" aria-label="Шаги подготовки">
          {STEPS.map((st, i) => {
            const state = stepState(s, st.key);
            return (
              <button key={st.key} type="button" role="tab" aria-selected={step === st.key} className={cx('set-step', step === st.key && 'is-active')} onClick={() => go(st.key)}>
                <span className="set-step-top">
                  <span className={cx('set-step-dot', state.done && 'is-done')}>{state.done && step !== st.key ? <Check /> : i + 1}</span>
                  <span className="set-step-title grow">{st.title}</span>
                </span>
                <span className="set-step-figure">{state.figure}</span>
                <span>
                  <StatusChip s={state.chip} />
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {step === 'products' ? (
        <>
          <div className="set-kpis">
            <Kpi label="Товаров в каталоге" value={fmt.num(s.products.total)} />
            <Kpi label="Без себестоимости" value={fmt.num(s.products.noCost)} />
            <Kpi label="Без штрихкода производителя" value={fmt.num(s.products.innerCodes)} />
            <Kpi label="Добавлено сегодня" value={fmt.num(s.products.createdToday)} />
          </div>
          <ProductImport />
          <Card title="Перед запуском">
            <Todo
              items={[
                'Назначьте, кто отвечает за каталог, пересчёт и долги, и выберите день начала учёта.',
                'Внесите товары таблицей или сканером: название, бренд, категория, штрихкод, цены. Тысячу позиций можно вносить частями.',
                'Объёмы и ароматы — отдельные товары. Дубли штрихкодов и похожих названий программа покажет до загрузки.',
                'Проверьте, сколько штук в коробке: коробки пересчитаются в штуки по этому числу.',
                'Неизвестную себестоимость оставьте пустой — прибыль по таким товарам будет помечена как неполная.',
              ]}
            />
          </Card>
        </>
      ) : null}

      {step === 'stock' ? (
        <>
          <div className="set-kpis">
            <Kpi label="Товаров с остатком" value={`${fmt.num(s.stock.withStock)} из ${fmt.num(s.stock.active)}`} />
            <Kpi label="В магазине" value={fmt.qty(s.stock.shopUnits)} />
            <Kpi label="На складе" value={fmt.qty(s.stock.whUnits)} />
            <Kpi label="На проверке" value={fmt.qty(s.stock.quarantine)} />
          </div>
          <div className="set-two">
            <Card
              title="Что внесено"
              foot={
                <>
                  <Button onClick={() => navigate('/stock')}>Открыть остатки</Button>
                  <Button variant="ghost" onClick={() => navigate('/stock/docs')}>
                    Документы склада
                  </Button>
                </>
              }
            >
              <StatList>
                <StatRow label="Позиций в магазине" value={fmt.num(s.stock.shopItems)} />
                <StatRow label="Позиций на складе" value={fmt.num(s.stock.whItems)} />
                <StatRow
                  label="Начальный остаток проведён"
                  value={s.stock.initialDate ? `${fmt.date(s.stock.initialDate)} · ${fmt.count(s.stock.initialDocs, 'документ', 'документа', 'документов')}` : 'нет'}
                />
                <StatRow label="Последний пересчёт" value={s.stock.lastCount ? fmt.date(s.stock.lastCount) : 'не было'} />
                <StatRow label="Партий со сроком годности" value={fmt.num(s.stock.batches)} />
                <StatRow label="Товаров ниже минимального остатка" value={fmt.num(s.stock.belowMin)} />
              </StatList>
            </Card>
            <Card title="Перед запуском">
              <Todo
                items={[
                  'Пересчитайте товар отдельно в магазине и на складе — в один день, после закрытия.',
                  'Брак, просрочку и товар под вопросом отложите: в продажу они не попадут.',
                  'Для товаров со сроком годности внесите партии и даты.',
                  'Проведите начальный остаток. Это не приход и не продажа — в выручку и закупки он не попадёт.',
                  'Продажи между пересчётом и стартом внесите отдельно, иначе остаток разойдётся.',
                ]}
              />
            </Card>
          </div>
        </>
      ) : null}

      {step === 'money' ? (
        <>
          <div className="set-kpis">
            <Kpi label="Долг покупателей" value={fmt.money(s.money.debtSum)} />
            <Kpi label="Из него просрочено" value={fmt.money(s.money.overdueSum)} />
            <Kpi label="Долг поставщикам" value={fmt.money(s.money.supplierDebtSum)} />
            <Kpi label="В кассе и на счёте" value={fmt.money(s.money.accounts.shop_cash + s.money.accounts.bank)} />
          </div>
          <div className="set-two">
            <Card
              title="Что внесено"
              foot={
                <>
                  <Button onClick={() => navigate('/money/debts')}>Долги покупателей</Button>
                  <Button variant="ghost" onClick={() => navigate('/money/accounts')}>
                    Кассы и счета
                  </Button>
                </>
              }
            >
              <StatList>
                <StatRow label="Клиентов с долгом" value={fmt.num(s.money.clientsDebt)} />
                <StatRow label="Из них с просрочкой" value={fmt.num(s.money.overdueClients)} />
                <StatRow label="Авансы клиентов" value={fmt.money(s.money.advanceSum)} />
                <StatRow label="Поставщиков, которым должны" value={fmt.num(s.money.suppliersDebt)} />
                {(['shop_cash', 'bank', 'courier_cash'] as const).map((a) => (
                  <StatRow key={a} label={ACCOUNT_NAMES[a]} value={fmt.money(s.money.accounts[a])} />
                ))}
                <StatRow label="Начальные остатки денег" value={s.money.initialMoneyDate ? `внесены ${fmt.date(s.money.initialMoneyDate)}` : 'не внесены'} />
              </StatList>
            </Card>
            <Card title="Перед запуском">
              <Todo
                items={[
                  'Составьте список клиентов и поставщиков с долгами, авансами и сроками оплаты.',
                  'Сверьте долг с каждым по документам. Суммы «по памяти» отметьте как черновые — это ещё не подтверждённый долг.',
                  'Внесите остатки кассы и расчётного счёта начальным документом — это не выручка.',
                  'Зафиксируйте открытые заказы, резервы и товар в доставке, чтобы ничего не потерять при переходе.',
                ]}
              />
            </Card>
          </div>
        </>
      ) : null}

      {step === 'check' ? (
        <div className="col-4" style={{ gap: 20 }}>
          <Card title="Сводка перед запуском" flush hint="settings.setup.checks">
            <div className="list set-checks">
              {s.checks.map((c) => {
                const ok = c.count === 0;
                return (
                  <div key={c.key} className="list-row">
                    <IconTile tone={ok ? 'ok' : c.soft ? 'info' : 'warn'}>{ok ? <CheckCircle2 /> : c.soft ? <Info /> : <AlertTriangle />}</IconTile>
                    <span className="grow t-13 w-600">{c.label}</span>
                    <span className="set-check-count num">{ok ? '' : fmt.count(c.count, ...c.unit)}</span>
                    <span style={{ width: 128, flex: '0 0 auto' }}>
                      <Chip tone={ok ? 'ok' : c.soft ? 'info' : 'warn'}>{ok ? 'В порядке' : c.soft ? 'Для сведения' : 'Разобрать'}</Chip>
                    </span>
                    {ok ? (
                      <span style={{ width: 32 }} />
                    ) : (
                      <Button size="sm" variant="ghost" iconOnly aria-label={`Открыть: ${c.label}`} title="Открыть" onClick={() => navigate(c.to)}>
                        <ArrowRight />
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
          <Card title="Перед запуском">
            <Todo
              items={[
                'Покажите сводку ответственным за каталог, склад и деньги — пусть разберут свои строки.',
                'Неполные данные можно оставить, но тогда отчёты по прибыли и остаткам будут с пометкой.',
                'Проведите начальные документы и начните работу с выбранного дня. Всё, что было до него, в отчёты периода не попадёт.',
              ]}
            />
          </Card>
        </div>
      ) : null}
    </div>
  );
}
