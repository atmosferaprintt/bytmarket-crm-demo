import type { ReactNode } from 'react';
import { cx } from './cx';

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral' | 'violet' | 'green' | 'outline';

/** Чип статуса: всегда текст; цвет только помогает. */
export function Chip({ tone = 'neutral', icon, children, size = 'md', title }: { tone?: Tone; icon?: ReactNode; children: ReactNode; size?: 'md' | 'lg'; title?: string }) {
  return (
    <span className={cx('chip', tone !== 'neutral' && `chip-${tone}`, size === 'lg' && 'chip-lg')} title={title}>
      {icon}
      {children}
    </span>
  );
}

/** Готовый статус из словаря statuses.ts: <StatusChip s={orderStateStatus(o.state)} /> */
export function StatusChip({ s, size }: { s: { label: string; tone: Tone }; size?: 'md' | 'lg' }) {
  return (
    <Chip tone={s.tone} size={size}>
      {s.label}
    </Chip>
  );
}
