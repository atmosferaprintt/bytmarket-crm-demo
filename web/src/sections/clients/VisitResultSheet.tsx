import { useMemo, useState, type ReactNode } from 'react';
import { PhoneCall, ShoppingCart, XCircle } from 'lucide-react';
import type { ID, Visit, VisitResult } from '../../data/types';
import { REFUSAL_REASONS } from '../../data/types';
import { dispatch, getDB, useDB, useDBVersion } from '../../data/store';
import { indexes } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { Button, Checkbox, ConfirmButton, Field, Input, Notice, Textarea, cx, fmt, toast } from '../../ui';
import { NewOrderDrawer } from '../sales/NewOrderDrawer';
import { Sheet } from './Sheet';
import { linkedOrderIds, pointOf } from './lib';

const OPTIONS: { key: VisitResult; label: string; icon: ReactNode }[] = [
  { key: 'order', label: 'Заказ', icon: <ShoppingCart /> },
  { key: 'callback', label: 'Перезвонить', icon: <PhoneCall /> },
  { key: 'refusal', label: 'Отказ', icon: <XCircle /> },
];

/** Результат визита: заказ (заявка без резерва), перезвонить или отказ с причиной. */
export function VisitResultSheet({
  visit,
  offline,
  initialResult,
  noOrder,
  onClose,
  onDone,
}: {
  visit: Visit;
  offline: boolean;
  /** результат, выбранный кнопкой на карточке визита: «Отказ», «Перезвонить» */
  initialResult?: VisitResult;
  /** «Без заказа»: визит был, заказа нет. В данных это отказ с причиной (по умолчанию «Есть запас») */
  noOrder?: boolean;
  onClose: () => void;
  onDone: (r: { result: VisitResult | 'missed'; orderId?: ID }) => void;
}) {
  const db = useDB();
  const version = useDBVersion();
  const { me } = useSession();
  const today = db.meta.today;
  const idx = indexes(db);
  const client = idx.clients.get(visit.clientId);
  const point = pointOf(client, visit.pointId);

  const [result, setResult] = useState<VisitResult | null>(noOrder ? 'refusal' : initialResult ?? null);
  const [reason, setReason] = useState<string | null>(noOrder ? REFUSAL_REASONS[0] : null);
  const [comment, setComment] = useState('');
  const [callbackTask, setCallbackTask] = useState(true);
  const [callbackDate, setCallbackDate] = useState(fmt.addDays(today, 1));
  const [orderOpen, setOrderOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // заявки этого клиента за сегодня, ещё не привязанные к визиту — можно привязать, а не создавать заново
  const todayRequests = useMemo(() => {
    const linked = linkedOrderIds(db);
    return db.orders.filter((o) => o.clientId === visit.clientId && o.authorId === me.id && o.createdAt.slice(0, 10) === today && o.state !== 'cancelled' && !linked.has(o.id));
  }, [db, version, visit.clientId, me.id, today]);

  const complete = (payload: Record<string, unknown>, okText: string, res: VisitResult | 'missed', orderId?: ID) => {
    const fresh = getDB().visits.find((v) => v.id === visit.id);
    if (fresh && fresh.state !== 'planned') {
      // визит уже закрыт (например, окно заказа само отметило визит)
      toast(okText);
      onDone({ result: res, orderId });
      return true;
    }
    const r = dispatch('visit.complete', { visitId: visit.id, comment: comment.trim(), ...payload }, me.id);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    toast(okText);
    onDone({ result: res, orderId });
    return true;
  };

  const withOrder = (orderId: ID) => {
    const o = getDB().orders.find((x) => x.id === orderId);
    complete({ result: 'order', orderId }, o ? `Визит закрыт: заявка № ${o.number} на ${fmt.money(o.total)}` : 'Визит закрыт с заявкой', 'order', orderId);
  };

  const submit = () => {
    setError(null);
    if (!result) {
      setError('Выберите, чем закончился визит');
      return;
    }
    if (result === 'order') {
      setOrderOpen(true);
      return;
    }
    if (result === 'refusal') {
      if (!reason) {
        setError('Выберите причину отказа — без неё отказ не сохранить');
        return;
      }
      complete({ result: 'refusal', refusalReason: reason }, noOrder ? `Записано: без заказа — ${reason.toLowerCase()}` : `Отказ записан: ${reason.toLowerCase()}`, 'refusal');
      return;
    }
    const ok = complete({ result: 'callback' }, 'Записано: перезвонить', 'callback');
    if (ok && callbackTask && client) {
      const t = dispatch('task.create', { title: `Перезвонить: ${client.name}`, assigneeId: me.id, due: callbackDate, link: { type: 'client', id: client.id } }, me.id);
      if (!t.ok) toast(t.error, 'error');
    }
  };

  const missed = () => complete({ missed: true }, 'Визит отмечен как несостоявшийся', 'missed');

  if (orderOpen && client) {
    return (
      <NewOrderDrawer
        clientId={client.id}
        pointId={visit.pointId}
        visitId={visit.id}
        source="rep"
        onClose={() => setOrderOpen(false)}
        onCreated={(orderId) => withOrder(orderId)}
      />
    );
  }

  const primaryLabel = result === 'order' ? 'Оформить заявку' : result === 'refusal' ? (noOrder ? 'Сохранить' : 'Сохранить отказ') : result === 'callback' ? 'Сохранить' : 'Сохранить результат';

  return (
    <Sheet
      title={noOrder ? 'Визит без заказа' : 'Результат визита'}
      sub={
        <>
          <span className="w-600 ink-2">{client?.name}</span>
          {point ? ` · ${point.name}, ${point.address}` : ''}
        </>
      }
      onClose={onClose}
      footer={
        <>
          <ConfirmButton variant="ghost" size="lg" onConfirm={missed} confirmText="Не состоялся?" data-hint="rep.result-missed">
            Визит не состоялся
          </ConfirmButton>
          <span className="spacer" />
          <Button variant="primary" size="lg" icon={result === 'order' ? <ShoppingCart /> : undefined} onClick={submit} className="cl-sheet-primary">
            {primaryLabel}
          </Button>
        </>
      }
    >
      {error ? <Notice tone="bad">{error}</Notice> : null}

      {noOrder ? null : (
      <div className="cl-result-opts" role="radiogroup" aria-label="Чем закончился визит" data-hint="rep.result-opts">
        {OPTIONS.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={result === o.key}
            className={cx('cl-result-opt', result === o.key && 'is-active', `is-${o.key}`)}
            onClick={() => {
              setResult(o.key);
              setError(null);
            }}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
      )}

      {result === 'order' ? (
        <div className="col-3">
          <Notice tone="info" title="Заявка без резерва">
            Менеджер подтвердит её и зарезервирует товар. Цены — по типу цены клиента, наличие — со склада.
            {offline ? ' Сейчас нет связи: заявка встанет в очередь и отправится, когда связь появится.' : ''}
          </Notice>
          {todayRequests.length ? (
            <div className="col" style={{ gap: 8 }}>
              <div className="field-label">Заявка уже оформлена сегодня</div>
              {todayRequests.map((o) => (
                <div key={o.id} className="cl-attach-row">
                  <span className="grow">
                    <span className="w-600">№ {o.number}</span> <span className="muted">на {fmt.money(o.total)}</span>
                  </span>
                  <Button size="sm" onClick={() => withOrder(o.id)}>
                    Привязать к визиту
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {result === 'refusal' ? (
        <div className="col" style={{ gap: 8 }}>
          <div className="field-label">{noOrder ? 'Почему без заказа' : 'Причина отказа'}</div>
          <div className="cl-reasons" role="radiogroup" aria-label="Причина отказа" data-hint="rep.result-reasons">
            {REFUSAL_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                className={cx('cl-reason', reason === r && 'is-active')}
                onClick={() => {
                  setReason(r);
                  setError(null);
                }}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {result === 'callback' ? (
        <div className="cl-callback" data-hint="rep.result-callback">
          <Checkbox checked={callbackTask} onChange={setCallbackTask}>
            Поставить себе задачу перезвонить
          </Checkbox>
          {callbackTask ? (
            <Field label="Когда">
              <Input type="date" value={callbackDate} min={today} onChange={(e) => setCallbackDate(e.target.value)} />
            </Field>
          ) : null}
        </div>
      ) : null}

      <Field label="Комментарий">
        <Textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={3}
          placeholder={noOrder ? 'Например: полка полная, заехать через неделю' : result === 'refusal' ? 'Например: взяли гели у «Химторга» по акции' : result === 'callback' ? 'Например: хозяин будет после обеда' : 'Что важно передать менеджеру'}
        />
      </Field>
    </Sheet>
  );
}
