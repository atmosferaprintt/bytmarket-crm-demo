/* Детерминированный генератор случайных чисел от зерна (mulberry32) и помощники.
   Одно и то же зерно всегда даёт одну и ту же последовательность — база демо после «Начать заново» та же. */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Хеш строки в 32-битное число (для производных генераторов: rng.fork('клиенты')). */
export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export class Rng {
  private readonly next01: () => number;
  private spare: number | null = null;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.next01 = mulberry32(this.seed);
  }

  /** Число в [0, 1). */
  next(): number {
    return this.next01();
  }

  /** Целое в [min, max] включительно. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next01() * (max - min + 1));
  }

  /** Дробное в [min, max). */
  float(min: number, max: number): number {
    return min + this.next01() * (max - min);
  }

  /** true с вероятностью p. */
  chance(p: number): boolean {
    return this.next01() < p;
  }

  pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error('pick: пустой список');
    return arr[Math.floor(this.next01() * arr.length)];
  }

  /** Выбор по весам. weights — массив той же длины или функция веса. */
  weighted<T>(items: readonly T[], weights: readonly number[] | ((item: T, i: number) => number)): T {
    const w = typeof weights === 'function' ? items.map(weights) : weights;
    let sum = 0;
    for (let i = 0; i < items.length; i++) sum += Math.max(0, w[i]);
    if (sum <= 0) return this.pick(items);
    let r = this.next01() * sum;
    for (let i = 0; i < items.length; i++) {
      r -= Math.max(0, w[i]);
      if (r < 0) return items[i];
    }
    return items[items.length - 1];
  }

  /** Перемешанная копия массива (Фишер — Йейтс). */
  shuffle<T>(arr: readonly T[]): T[] {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next01() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  /** k случайных элементов без повторов. */
  sample<T>(arr: readonly T[], k: number): T[] {
    return this.shuffle(arr).slice(0, Math.max(0, Math.min(k, arr.length)));
  }

  /** Нормальное распределение (Бокс — Мюллер). */
  gauss(mean = 0, sd = 1): number {
    if (this.spare !== null) {
      const s = this.spare;
      this.spare = null;
      return mean + sd * s;
    }
    let u = 0;
    let v = 0;
    while (u === 0) u = this.next01();
    while (v === 0) v = this.next01();
    const mag = Math.sqrt(-2 * Math.log(u));
    this.spare = mag * Math.sin(2 * Math.PI * v);
    return mean + sd * mag * Math.cos(2 * Math.PI * v);
  }

  /** Производный независимый генератор для отдельного блока данных. */
  fork(label: string): Rng {
    return new Rng((this.seed ^ hashString(label)) >>> 0);
  }
}

export function createRng(seed: number): Rng {
  return new Rng(seed);
}

/* Функции-помощники в функциональном стиле — то же самое, что методы Rng. */
export const pick = <T>(rng: Rng, arr: readonly T[]): T => rng.pick(arr);
export const weighted = <T>(rng: Rng, items: readonly T[], w: readonly number[] | ((item: T, i: number) => number)): T =>
  rng.weighted(items, w);
export const int = (rng: Rng, min: number, max: number): number => rng.int(min, max);
export const chance = (rng: Rng, p: number): boolean => rng.chance(p);
export const shuffle = <T>(rng: Rng, arr: readonly T[]): T[] => rng.shuffle(arr);
export const gauss = (rng: Rng, mean = 0, sd = 1): number => rng.gauss(mean, sd);

/** Таблица весов для частого выбора из большого списка: накопленные суммы и двоичный поиск. */
export class WeightedTable<T> {
  private readonly items: T[];
  private readonly cum: Float64Array;
  readonly total: number;

  constructor(items: readonly T[], weights: readonly number[]) {
    this.items = items.slice();
    this.cum = new Float64Array(items.length);
    let s = 0;
    for (let i = 0; i < items.length; i++) {
      s += Math.max(0, weights[i]);
      this.cum[i] = s;
    }
    this.total = s;
  }

  get size(): number {
    return this.items.length;
  }

  sample(rng: Rng): T {
    const r = rng.next() * this.total;
    let lo = 0;
    let hi = this.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] > r) hi = mid;
      else lo = mid + 1;
    }
    return this.items[lo];
  }
}
