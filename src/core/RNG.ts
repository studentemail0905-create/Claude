/**
 * Deterministic seeded RNG (sfc32) with named sub-streams.
 * Each subsystem forks its own stream so adding a roll in one system
 * never shifts the rolls of another — runs stay reproducible from the seed.
 */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export class RNG {
  private a: number;
  private b: number;
  private c: number;
  private d: number;
  readonly seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.a = 0x9e3779b9;
    this.b = 0x243f6a88;
    this.c = 0xb7e15162;
    this.d = this.seed ^ 0xdeadbeef;
    for (let i = 0; i < 15; i++) this.nextU32();
  }

  nextU32(): number {
    this.a >>>= 0; this.b >>>= 0; this.c >>>= 0; this.d >>>= 0;
    let t = (this.a + this.b) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.d = (this.d + 1) | 0;
    t = (t + this.d) | 0;
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** [0,1) */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(min: number, maxInclusive: number): number {
    return Math.floor(this.range(min, maxInclusive + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  /** Approximately normal via Box-Muller. */
  gauss(mean = 0, sd = 1): number {
    const u = Math.max(1e-12, this.next());
    const v = this.next();
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Multiplicative tolerance roll: 1 ± pct (clamped normal, sd = pct/2). */
  tolerance(pct: number): number {
    const g = Math.max(-2, Math.min(2, this.gauss(0, 0.5)));
    return 1 + g * pct;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }

  weighted<T>(items: readonly T[], weight: (t: T) => number): T {
    let total = 0;
    for (const it of items) total += Math.max(0, weight(it));
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return items[items.length - 1];
  }

  fork(name: string): RNG {
    return new RNG((this.seed ^ hashString(name)) >>> 0);
  }
}

export function newSeed(): number {
  const buf = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else buf[0] = Math.floor(Math.random() * 4294967296);
  return buf[0] >>> 0;
}

export function seedToString(seed: number): string {
  return (seed >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

export function stringToSeed(s: string): number | null {
  const v = parseInt(s.trim(), 16);
  return Number.isFinite(v) ? v >>> 0 : null;
}
