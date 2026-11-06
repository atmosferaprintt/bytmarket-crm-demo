/* Детали смены: шапка «Смена открыта», карточка «Открыть смену». */
import { useState } from 'react';
import { LockKeyholeOpen } from 'lucide-react';
import type { Shift } from '../../data/types';
import { dispatch, useDB } from '../../data/store';
import { indexes, shiftSummary } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { Button, Card, Chip, Field, MoneyInput, Notice, fmt, toast } from '../../ui';
import { fixNo } from './lib';
import { handOver } from './Print';

export function ShiftBadge({ shift }: { shift: Shift | undefined }) {
  const db = useDB();
  if (!shift)
    return (
      <span data-hint="register.shift">
        <Chip>Смена закрыта</Chip>
      </span>
    );
  const seller = indexes(db).employees.get(shift.sellerId);
  const s = shiftSummary(db, shift.id);
  return (
    <span className="reg-shift-badge" data-hint="register.shift">
      <Chip tone="ok">Смена открыта</Chip>
      <span>
        {seller?.name ?? '—'} · с {fmt.time(shift.openedAt)} · {fmt.count(s.receipts, 'чек', 'чека', 'чеков')}
      </span>
    </span>
  );
}

/** Карточка «Открыть смену» с разменом на начало. */
export function OpenShiftCard({ onOpened, className, hideLast, title = 'Смена закрыта' }: { onOpened?: () => void; className?: string; hideLast?: boolean; title?: string }) {
  const db = useDB();
  const { me } = useSession();
  const last = [...db.shifts].reverse().find((s) => s.closedAt);
  // размен не подставляем: продавец пересчитывает деньги сам; оставленное прошлой сменой — подсказка одной кнопкой
  const left = last && last.countedCash !== null ? handOver(last.countedCash, last.openingCash).keep : null;
  const [cash, setCash] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const open = () => {
    if (cash === '') {
      setError('Пересчитайте деньги в кассе и укажите размен — можно 0 ₽');
      return;
    }
    const r = dispatch('shift.open', { openingCash: cash }, me.id);
    if (!r.ok) {
      setError(fixNo(r.error));
      return;
    }
    setError(null);
    toast('Смена открыта');
    onOpened?.();
  };
  return (
    <Card title={title} className={className} hint="register.open-shift">
      <form
        className="col-4"
        onSubmit={(e) => {
          e.preventDefault();
          open();
        }}
      >
        <div className="reg-open-icon">
          <LockKeyholeOpen />
        </div>
        <div className="t-14 ink-2">Чтобы продавать, откройте смену. Пересчитайте деньги в кассе и укажите размен.</div>
        {last && !hideLast ? (
          <div className="t-13 muted">
            Прошлая смена № {last.number} закрыта {fmt.dateTime(last.closedAt)}, пересчитано {fmt.money(last.countedCash ?? 0)}
          </div>
        ) : null}
        <Field label="Размен на начало">
          <MoneyInput
            value={cash}
            onChange={(v) => {
              setCash(v);
              setError(null);
            }}
            size="lg"
            placeholder="Пересчитано в кассе"
            ariaLabel="Размен на начало, ₽"
          />
        </Field>
        {left !== null && cash === '' ? (
          <button type="button" className="btn btn-ghost btn-sm reg-left-btn" onClick={() => setCash(left)}>
            Оставили на размен прошлой сменой: <span className="num">{fmt.money(left)}</span>
          </button>
        ) : null}
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <Button variant="primary" size="lg" block type="submit">
          Открыть смену
        </Button>
      </form>
    </Card>
  );
}
