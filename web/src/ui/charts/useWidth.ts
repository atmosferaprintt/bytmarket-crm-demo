import { useLayoutEffect, useRef, useState } from 'react';

/** Размер контейнера в пикселях: график рисуется в настоящих пикселях, текст не растягивается. */
export function useWidth<T extends HTMLElement>(fallback = 600, fallbackHeight = 260) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  const [height, setHeight] = useState(fallbackHeight);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      if (w > 0) setWidth((prev) => (prev === w ? prev : w));
      if (h > 0) setHeight((prev) => (prev === h ? prev : h));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, width, height };
}

/** Круглая верхняя граница шкалы и шаг: 0 / 50 тыс. / 100 тыс. … Берём самую плотную шкалу на 3–6 делений. */
export function niceScale(max: number, ticks = 4): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 1 };
  const pow = Math.pow(10, Math.floor(Math.log10(max / ticks)));
  let best: { max: number; step: number } | null = null;
  for (const p of [pow / 10, pow, pow * 10]) {
    for (const k of [1, 2, 2.5, 5]) {
      const step = k * p;
      const n = Math.ceil(max / step);
      if (n < 3 || n > 6) continue;
      const top = n * step;
      if (!best || top < best.max || (top === best.max && step > best.step)) best = { max: top, step };
    }
  }
  return best ?? { max: Math.ceil(max / pow) * pow, step: pow };
}

const NB = ' ';

/** Подписи оси: «50 тыс.», «1,2 млн», «800». */
export function axisMoney(v: number): string {
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1_000_000) {
    const m = a / 1_000_000;
    return (Number.isInteger(m) ? String(m) : m.toFixed(1).replace('.', ',')) + NB + 'млн';
  }
  if (a >= 1000) {
    const k = a / 1000;
    return (Number.isInteger(k) ? String(k) : k.toFixed(1).replace('.', ',')) + NB + 'тыс.';
  }
  return String(Math.round(a));
}
