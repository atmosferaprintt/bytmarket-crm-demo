/* Узкий экран (1280 и меньше): часть второстепенных колонок прячем, чтобы таблица помещалась целиком. */
import { useEffect, useState } from 'react';

export function useNarrow(query = '(max-width: 1360px)'): boolean {
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const h = () => setV(m.matches);
    h();
    m.addEventListener('change', h);
    return () => m.removeEventListener('change', h);
  }, [query]);
  return v;
}

/** «сегодня, 14:20» / «вчера, 09:57» / «31.10, 10:10» */
export function shortWhen(iso: string | null | undefined, today: string, withTime = true): string {
  if (!iso) return '—';
  const d = iso.slice(0, 10);
  const time = iso.length > 10 ? iso.slice(11, 16) : '';
  const y = new Date(today + 'T00:00');
  y.setDate(y.getDate() - 1);
  const yIso = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;
  const day = d === today ? 'сегодня' : d === yIso ? 'вчера' : `${d.slice(8, 10)}.${d.slice(5, 7)}`;
  return withTime && time ? `${day}, ${time}` : day;
}
