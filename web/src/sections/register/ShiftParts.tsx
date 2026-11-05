/* Детали смены: шапка «Смена открыта», карточка «Открыть смену». */
import { useState } from 'react';
import { LockKeyholeOpen } from 'lucide-react';
import type { Shift } from '../../data/types';
import { dispatch, useDB } from '../../data/store';
import { indexes, shiftSummary } from '../../data/selectors';
import { useSession } from '../../roles/session';
import { Button, Card, Chip, Field, MoneyInput, Notice, fmt, toast } from '../../ui';

export function ShiftBadge({ shift }: { shift: Shift | undefined }) {
  const db = useDB();
  if (!shift) return <Chip>Смена закрыта</Chip>;
  const seller = indexes(db).employees.get(shift.sellerId);
  const s = shiftSummary(db, shift.id);
  return (
    <span className="reg-shift-badge">
      <Chip tone="ok">Смена открыта</Chip>
      <span>
        {seller?.name ?? '—'} · с {fmt.time(shift.openedAt)} · {fmt.count(s.receipts, 'чек', 'чека', 'чеков')}
      </span>
    </span>
  );
}

/** Карточка «Открыть смену» с разменом на начало. */
export function OpenShiftCard({ onOpened, className, hideLast }: { onOpened?: () => void; className?: string; hideLast?: boolean }) {
  const db = useDB();
  const { me } = useSession();
  const last = [...db.shifts].reverse().find((s) => s.closedAt);
  const [cash, setCash] = useState<number | ''>(5000);
  const [error, setError] = useState<string | null>(null);
  const open = () => {
    const r = dispatch('shift.open', { openingCash: cash === '' ? 0 : cash }, me.id);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setError(null);
    toast('Смена открыта');
    onOpened?.();
  };
  return (
    <Card title="Смена закрыта" className={className}>
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
            Прошлая смена № {last.number} закрыта {fmt.relDate(last.closedAt, db.meta.today)} в {fmt.time(last.closedAt)}, пересчитано {fmt.money(last.countedCash ?? 0)}
          </div>
        ) : null}
        <Field label="Размен на начало">
          <MoneyInput value={cash} onChange={setCash} size="lg" />
        </Field>
        {error ? <Notice tone="bad">{error}</Notice> : null}
        <Button variant="primary" size="lg" block type="submit">
          Открыть смену
        </Button>
      </form>
    </Card>
  );
}
