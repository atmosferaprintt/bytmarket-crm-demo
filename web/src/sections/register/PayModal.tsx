/* Окно оплаты: наличные, карта или смешанная; получено, быстрые суммы, сдача. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Banknote, CreditCard, Info, ArrowLeftRight } from 'lucide-react';
import { Button, Field, Modal, MoneyInput, Notice, cx, fmt } from '../../ui';

export type PayMethodUI = 'cash' | 'card' | 'mixed';

export interface PayResult {
  cash: number;
  card: number;
}

const NOTES = [100, 200, 500, 1000, 1500, 2000, 3000, 5000, 10000];

/** Быстрые суммы: «без сдачи» и три ближайшие купюры выше суммы. */
function quickSums(due: number): number[] {
  const out: number[] = [];
  for (const n of NOTES) {
    if (n > due && out.length < 3 && !out.includes(n)) out.push(n);
  }
  const k5 = Math.ceil(due / 5000) * 5000;
  if (out.length < 3 && k5 > due && !out.includes(k5)) out.push(k5);
  return out;
}

export function PayModal({
  total,
  number,
  positions,
  busy,
  error,
  onPay,
  onClose,
}: {
  total: number;
  number: number;
  positions: number;
  busy: boolean;
  error: string | null;
  onPay: (r: PayResult) => void;
  onClose: () => void;
}) {
  const [method, setMethod] = useState<PayMethodUI>('cash');
  const [received, setReceived] = useState<number | ''>('');
  const [card, setCard] = useState<number | ''>('');
  const formRef = useRef<HTMLFormElement>(null);

  const cardPart = method === 'card' ? total : method === 'mixed' ? Math.min(Number(card || 0), total) : 0;
  const cashDue = total - cardPart;
  const cashGiven = method === 'card' ? 0 : received === '' ? cashDue : Number(received);
  const change = cashGiven + cardPart - total;
  const short = change < 0 ? -change : 0;
  const cardTooBig = method === 'mixed' && Number(card || 0) > total;
  const mixedEmpty = method === 'mixed' && (card === '' || Number(card) <= 0);
  const canPay = !busy && short === 0 && !cardTooBig && !mixedEmpty;
  const quick = useMemo(() => quickSums(cashDue), [cashDue]);

  // фокус в нужное поле при смене способа
  useEffect(() => {
    if (method === 'card') {
      formRef.current?.querySelector<HTMLElement>('.reg-change.is-card')?.focus();
      return;
    }
    const el = formRef.current?.querySelector<HTMLInputElement>(method === 'mixed' ? '[data-f-wrap="card"] input' : '[data-f-wrap="cash"] input');
    el?.focus();
    el?.select();
  }, [method]);

  const submit = () => {
    if (!canPay) return;
    onPay({ cash: method === 'card' ? 0 : cashGiven, card: cardPart });
  };

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'F9') {
        e.preventDefault();
        submit();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const methods: { key: PayMethodUI; label: string; icon: JSX.Element }[] = [
    { key: 'cash', label: 'Наличные', icon: <Banknote /> },
    { key: 'card', label: 'Карта', icon: <CreditCard /> },
    { key: 'mixed', label: 'Смешанная', icon: <ArrowLeftRight /> },
  ];

  return (
    <Modal
      title="Оплата"
      sub={`Чек № ${number} · ${fmt.count(positions, 'позиция', 'позиции', 'позиций')}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} kbd="Esc">
            Отмена
          </Button>
          <Button variant="primary" size="lg" onClick={submit} disabled={!canPay} loading={busy} kbd="F9">
            {method === 'card' ? `Оплачено картой` : 'Провести оплату'}
          </Button>
        </>
      }
    >
      <form
        ref={formRef}
        className="col-4"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.target as HTMLElement).tagName !== 'BUTTON') {
            e.preventDefault();
            submit();
          }
        }}
      >
        <div className="reg-due">
          <span className="reg-due-label">К оплате</span>
          <span className="reg-due-value num">{fmt.money(total)}</span>
        </div>

        <div className="reg-paym" role="radiogroup" aria-label="Способ оплаты">
          {methods.map((m) => (
            <button
              key={m.key}
              type="button"
              role="radio"
              aria-checked={method === m.key}
              className={cx(method === m.key && 'is-active')}
              onClick={() => setMethod(m.key)}
            >
              {m.icon}
              {m.label}
            </button>
          ))}
        </div>

        {method === 'mixed' ? (
          <Field label="Картой" error={cardTooBig ? `Картой можно не больше ${fmt.money(total)}` : undefined}>
            <span data-f-wrap="card">
              <MoneyInput value={card} onChange={setCard} placeholder="0" size="lg" invalid={cardTooBig} />
            </span>
          </Field>
        ) : null}

        {method !== 'card' ? (
          <>
            <Field label={method === 'mixed' ? `Наличными получено · нужно ${fmt.money(Math.max(0, cashDue))}` : 'Получено наличными'}>
              <span data-f-wrap="cash">
                <MoneyInput value={received} onChange={setReceived} placeholder={fmt.num(cashDue)} size="lg" />
              </span>
            </Field>
            <div className="reg-quick">
              <button type="button" className="btn btn-secondary" onClick={() => setReceived(cashDue)}>
                Без сдачи
              </button>
              {quick.map((n) => (
                <button key={n} type="button" className="btn btn-secondary num" onClick={() => setReceived(n)}>
                  {fmt.money(n)}
                </button>
              ))}
            </div>
            {short > 0 ? (
              <div className="reg-change is-short">
                <span className="reg-change-label">Не хватает</span>
                <span className="reg-change-value num">{fmt.money(short)}</span>
              </div>
            ) : (
              <div className="reg-change">
                <span className="reg-change-label">Сдача</span>
                <span className="reg-change-value num">{fmt.money(change)}</span>
              </div>
            )}
          </>
        ) : (
          <div className="reg-change is-card" tabIndex={-1}>
            <span className="reg-change-label">Приложите карту к терминалу</span>
            <span className="reg-change-value num">{fmt.money(total)}</span>
          </div>
        )}

        {error ? <Notice tone="bad">{error}</Notice> : null}

        <div className="reg-fiscal">
          <Info />
          Чек не фискальный: касса не подключена
        </div>
      </form>
    </Modal>
  );
}
