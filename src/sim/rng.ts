/** Детермінований генератор mulberry32. Увесь стан — одне 32-бітне число, тож його легко зберегти й клонувати. */
export class Rng {
  state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(maxExclusive: number): number {
    return Math.floor(this.next() * maxExclusive);
  }

  /** Наближення нормального розподілу (сума трьох рівномірних), діапазон приблизно [-1, 1]. */
  soft(): number {
    return (this.next() + this.next() + this.next()) / 1.5 - 1;
  }

  chance(p: number): boolean {
    return this.next() < p;
  }
}

/** Хеш рядка/числа у 32-бітне насіння. */
export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}
