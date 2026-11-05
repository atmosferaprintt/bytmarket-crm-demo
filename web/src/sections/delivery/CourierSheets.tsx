/* Окна курьера: «Вручено» (сумма и способ) и «Не удалось» (причина). Крупно, под палец. */
import { useState } from 'react';
import { Banknote, Check, CreditCard, Hourglass } from 'lucide-react';
import type { ID, PayMethod } from '../../data/types';
import { DELIVERY_FAIL_REASONS } from '../../data/types';
import { useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { Button, EmptyState, Field, MoneyInput, Notice, cx, fmt } from '../../ui';
import { Sheet } from './Sheet';
import { LESS_REASONS, shortDistrict } from './lib';
import { useRun } from './run';

type Method = 'cash' | 'card' | 'none';

export function DeliverSheet({ id, onClose }: { id: ID; onClose: () => void }) {
  const db = useDB();
  useDBVersion();
  const d = db.deliveries.find((x) => x.id === id);
  const client = d ? indexes(db).clients.get(d.clientId) : undefined;
  const [method, setMethod] = useState<Method>(d && d.collect > 0 ? 'cash' : 'none');
  const [amount, setAmount] = useState<number | ''>(d?.collect ?? 0);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useRun();
  if (!d)
    return (
      <Sheet title="Вручено" onClose={onClose}>
        <EmptyState title="Доставка не найдена" />
      </Sheet>
    );

  const got = method === 'none' ? 0 : amount === '' ? 0 : amount;
  const less = method !== 'none' && d.collect > 0 && got < d.collect;
  const more = method !== 'none' && got > d.collect;

  const submit = () => {
    if (method !== 'none' && got <= 0) {
      setError('Введите сумму или выберите «Денег нет»');
      return;
    }
    if (less && !reason) {
      setError('Выберите, почему получили меньше');
      return;
    }
    const note =
      method === 'none' && d.collect > 0 ? 'Денег нет, оплата по отсрочке' : less ? `Получено ${fmt.money(got)} из ${fmt.money(d.collect)}: ${reason}` : '';
    const payload: { deliveryId: ID; collected: number; method: PayMethod; comment?: string } = {
      deliveryId: d.id,
      collected: got,
      method: method === 'card' ? 'card' : 'cash',
    };
    if (note) payload.comment = d.comment ? `${d.comment}. ${note}` : note;
    const r = run('delivery.deliver', payload, got ? `Вручено, получено ${fmt.money(got)}` : 'Вручено');
    if (r.ok) onClose();
    else setError(r.error ?? null);
  };

  const choices: { key: Method; label: string; icon: JSX.Element }[] = [
    { key: 'cash', label: 'Наличные', icon: <Banknote /> },
    { key: 'card', label: 'Карта', icon: <CreditCard /> },
    { key: 'none', label: d.collect > 0 ? 'Денег нет — по отсрочке' : 'Без оплаты', icon: <Hourglass /> },
  ];

  return (
    <Sheet
      title="Вручено"
      sub={`№ ${d.number} · ${client?.name ?? d.contactName} · ${d.address}, ${shortDistrict(d.district)}`}
      onClose={onClose}
      footer={
        <Button variant="primary" size="lg" block onClick={submit} icon={<Check />}>
          {got ? `Вручено, получил ${fmt.money(got)}` : 'Вручено без оплаты'}
        </Button>
      }
    >
      <div className="dl-collect">
        <span className="dl-collect-label">К получению</span>
        <span className="dl-collect-value">{fmt.money(d.collect)}</span>
      </div>
      {d.collect === 0 ? <Notice tone="ok">Заказ оплачен заранее или по отсрочке — деньги брать не нужно</Notice> : null}

      <div className="dl-choices" role="radiogroup" aria-label="Способ оплаты">
        {choices.map((ch) => (
          <button
            key={ch.key}
            type="button"
            role="radio"
            aria-checked={method === ch.key}
            className={cx('dl-choice', method === ch.key && 'is-active')}
            onClick={() => {
              setMethod(ch.key);
              setError(null);
              if (ch.key !== 'none' && (amount === '' || amount === 0)) setAmount(d.collect);
            }}
          >
            {ch.icon}
            <span className="grow">{ch.label}</span>
            {method === ch.key ? <Check className="dl-choice-check" /> : null}
          </button>
        ))}
      </div>

      {method !== 'none' ? (
        <Field label="Получил">
          <MoneyInput size="lg" value={amount} onChange={(v) => { setAmount(v); setError(null); }} />
        </Field>
      ) : null}

      {less ? (
        <div className="col-3">
          <span className="field-label">Получил меньше — почему</span>
          <div className="dl-reasons is-small">
            {LESS_REASONS.map((r) => (
              <button key={r} type="button" className={cx('dl-reason', reason === r && 'is-active')} onClick={() => { setReason(r); setError(null); }}>
                <span className="grow">{r}</span>
                {reason === r ? <Check /> : null}
              </button>
            ))}
          </div>
          <Notice tone="warn">Остаток {fmt.money(d.collect - got)} останется долгом клиента</Notice>
        </div>
      ) : null}
      {more ? <Notice tone="info">Больше, чем к получению: {fmt.money(got - d.collect)} уйдёт в счёт долга клиента</Notice> : null}
      {method === 'none' && d.collect > 0 ? <Notice tone="warn">Сумма {fmt.money(d.collect)} останется долгом клиента</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Sheet>
  );
}

export function FailSheet({ id, onClose }: { id: ID; onClose: () => void }) {
  const db = useDB();
  useDBVersion();
  const d = db.deliveries.find((x) => x.id === id);
  const client = d ? indexes(db).clients.get(d.clientId) : undefined;
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useRun();
  if (!d)
    return (
      <Sheet title="Не удалось" onClose={onClose}>
        <EmptyState title="Доставка не найдена" />
      </Sheet>
    );
  const submit = () => {
    if (!reason) {
      setError('Выберите причину');
      return;
    }
    const r = run('delivery.fail', { deliveryId: d.id, reason }, `Доставка № ${d.number}: не удалось — ${reason.toLowerCase()}`);
    if (r.ok) onClose();
    else setError(r.error ?? null);
  };
  return (
    <Sheet
      title="Не удалось вручить"
      sub={`№ ${d.number} · ${client?.name ?? d.contactName} · ${d.address}`}
      onClose={onClose}
      footer={
        <Button variant="primary" size="lg" block onClick={submit} disabled={!reason}>
          {reason ? `Отметить: ${reason.toLowerCase()}` : 'Выберите причину'}
        </Button>
      }
    >
      <span className="field-label">Причина</span>
      <div className="dl-reasons" role="radiogroup" aria-label="Причина">
        {DELIVERY_FAIL_REASONS.map((r) => (
          <button key={r} type="button" role="radio" aria-checked={reason === r} className={cx('dl-reason', reason === r && 'is-active')} onClick={() => { setReason(r); setError(null); }}>
            <span className="grow">{r}</span>
            {reason === r ? <Check /> : null}
          </button>
        ))}
      </div>
      <Notice tone="info">
        {d.state === 'on_way' ? 'Товар остаётся у вас. ' : ''}Диспетчер решит: повторить доставку или вернуть товар на склад.
      </Notice>
      {error ? <Notice tone="bad">{error}</Notice> : null}
    </Sheet>
  );
}
