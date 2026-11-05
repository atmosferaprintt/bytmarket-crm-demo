/* Мелкие детали раздела «Доставка»: выбор дня, счётчики состояний, чипы, ссылки на карту и звонок. */
import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { MapPin, Phone } from 'lucide-react';
import type { Delivery, DeliveryState, ISODate, Order } from '../../data/types';
import { orderPayment } from '../../data/selectors';
import type { DB } from '../../data/types';
import { Chip, DELIVERY_STATE, PAY_STATE, Segmented, StatusChip, cx, fmt } from '../../ui';
import { delayOf, lateOf, mapUrl, telUrl, type Clock } from './lib';

/** Узкий экран (1280 и уже): таблицы прячут второстепенные колонки внутрь соседних. */
export function useNarrow(query = '(max-width: 1400px)'): boolean {
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const h = () => setV(m.matches);
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [query]);
  return v;
}

/* ---------- день в адресе страницы: ?day=tomorrow | YYYY-MM-DD ---------- */

export function useDayParam(c: Clock): [ISODate, (d: ISODate) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get('day');
  const day = raw === 'tomorrow' ? c.tomorrow : raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : c.today;
  const set = (d: ISODate) => {
    const next = new URLSearchParams(params);
    if (d === c.today) next.delete('day');
    else next.set('day', d === c.tomorrow ? 'tomorrow' : d);
    setParams(next, { replace: true });
  };
  return [day, set];
}

/** «Сегодня · Завтра · дата». */
export function DayPicker({ day, onChange, c, counts, compact }: { day: ISODate; onChange: (d: ISODate) => void; c: Clock; counts?: { today?: number; tomorrow?: number }; compact?: boolean }) {
  const seg = day === c.today ? 'today' : day === c.tomorrow ? 'tomorrow' : '';
  return (
    <div className={cx('dl-day', compact && 'is-compact')}>
      <Segmented
        ariaLabel="День"
        value={seg}
        onChange={(v) => onChange(v === 'tomorrow' ? c.tomorrow : c.today)}
        options={[
          { value: 'today', label: 'Сегодня', count: counts?.today },
          { value: 'tomorrow', label: 'Завтра', count: counts?.tomorrow },
        ]}
      />
      {compact ? null : (
        <input
          type="date"
          className={cx('input input-sm dl-date', !seg && 'is-set')}
          value={day}
          aria-label="Дата"
          onChange={(e) => e.target.value && onChange(e.target.value)}
        />
      )}
    </div>
  );
}

/** Выбор дня внутри окна. */
export function DayChoice({ value, onChange, c }: { value: ISODate; onChange: (d: ISODate) => void; c: Clock }) {
  const seg = value === c.today ? 'today' : value === c.tomorrow ? 'tomorrow' : '';
  return (
    <div className="dl-day">
      <Segmented
        ariaLabel="День"
        value={seg}
        onChange={(v) => onChange(v === 'tomorrow' ? c.tomorrow : c.today)}
        options={[
          { value: 'today', label: 'Сегодня' },
          { value: 'tomorrow', label: 'Завтра' },
        ]}
      />
      <input type="date" className={cx('input input-sm dl-date', !seg && 'is-set')} value={value} min={c.today} aria-label="Дата" onChange={(e) => e.target.value && onChange(e.target.value)} />
    </div>
  );
}

/* ---------- счётчики состояний — фильтры ---------- */

export type StateFilter = 'all' | DeliveryState | 'late';

export const STATE_ORDER: DeliveryState[] = ['waiting', 'assigned', 'on_way', 'delivered', 'failed'];

export function StatePills({ value, onChange, counts, late, returned }: { value: StateFilter; onChange: (v: StateFilter) => void; counts: Record<string, number>; late: number; returned: number }) {
  const items: { key: StateFilter; label: string; n: number; tone?: string }[] = [
    { key: 'all', label: 'Все', n: counts.all ?? 0 },
    ...STATE_ORDER.map((s) => ({ key: s as StateFilter, label: DELIVERY_STATE[s].label, n: counts[s] ?? 0, tone: DELIVERY_STATE[s].tone })),
  ];
  if (returned) items.push({ key: 'returned', label: DELIVERY_STATE.returned.label, n: returned, tone: 'outline' });
  items.push({ key: 'late', label: 'Опаздывают', n: late, tone: 'bad' });
  return (
    <div className="dl-states" role="radiogroup" aria-label="Состояние доставки">
      {items.map((it) => (
        <button
          key={it.key}
          type="button"
          role="radio"
          aria-checked={value === it.key}
          className={cx('dl-state', value === it.key && 'is-active', it.n > 0 && it.tone && `tone-${it.tone}`)}
          onClick={() => onChange(it.key)}
        >
          <span className="dl-state-label">{it.label}</span>
          <span className="dl-state-n">{fmt.num(it.n)}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- чипы ---------- */

export function StateChip({ d, size }: { d: Delivery; size?: 'md' | 'lg' }) {
  return <StatusChip s={DELIVERY_STATE[d.state]} size={size} />;
}

export function LateChip({ d, c, short }: { d: Delivery; c: Clock; short?: boolean }) {
  const late = lateOf(d, c);
  if (!late) return null;
  return <Chip tone="bad" title={late.label}>{short ? late.label.replace(/^Опоздание /, '') : late.label}</Chip>;
}

/** Курьер отметил «Задерживаюсь»: «Задерживается до 15:30». */
export function DelayChip({ d, label = 'Задерживается до' }: { d: Delivery; label?: string }) {
  const until = delayOf(d);
  if (!until) return null;
  const last = [...(d.notes ?? [])].reverse().find((n) => n.text.startsWith('Задерживается'));
  return (
    <Chip tone="warn" title={last?.text}>
      {`${label} ${until}`}
    </Chip>
  );
}

/** Оплата заказа — отдельно от доставки: «Доставлено» не значит «оплачено». */
export function PayChip({ db, order }: { db: DB; order: Order | undefined }) {
  if (!order || order.state === 'cancelled') return null;
  const pay = orderPayment(db, order);
  if (pay.overdueDays > 0) return <Chip tone="bad">{`Просрочка ${pay.overdueDays} дн.`}</Chip>;
  return <StatusChip s={PAY_STATE[pay.state]} />;
}

/* ---------- ссылки ---------- */

export function MapLink({ d, children, className }: { d: Pick<Delivery, 'lat' | 'lng'>; children?: ReactNode; className?: string }) {
  return (
    <a className={className ?? 'dl-maplink'} href={mapUrl(d)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
      {children ?? (
        <>
          <MapPin />
          Открыть в картах
        </>
      )}
    </a>
  );
}

export function CallButton({ phone, label = 'Позвонить', size = 'md', block }: { phone: string; label?: string; size?: 'sm' | 'md' | 'lg'; block?: boolean }) {
  return (
    <a
      className={cx('btn btn-secondary', size === 'sm' && 'btn-sm', size === 'lg' && 'btn-lg', block && 'btn-block')}
      href={telUrl(phone)}
      onClick={(e) => e.stopPropagation()}
      title={fmt.phone(phone)}
    >
      <Phone />
      {label}
    </a>
  );
}
