/* Чип состояния остатка: только исключения — нет, ниже минимума, срок, мало в магазине, без движения, не продаётся.
   Обычное «в наличии» не показываем, чтобы в таблице не было зелёного шума. Общий для «Склада» и «Товаров». */
import { Chip } from '../../ui';
import type { StockLine } from './calc';

export function StockStatusChip({ line }: { line: StockLine | undefined }) {
  if (!line?.status) return null;
  return (
    <Chip tone={line.status.tone} title={line.statusTitle}>
      {line.status.label}
    </Chip>
  );
}

/** Порядок для сортировки по статусу: сначала то, что требует действия. */
export function statusRank(line: StockLine): number {
  const f = line.flags;
  if (f.has('out')) return 0;
  if (line.expDays !== null && line.expDays < 0 && f.has('expiring')) return 1;
  if (f.has('low')) return 2;
  if (f.has('expiring')) return 3;
  if (f.has('shopLow')) return 4;
  if (f.has('stale')) return 5;
  if (f.has('inactive')) return 7;
  return 6;
}
