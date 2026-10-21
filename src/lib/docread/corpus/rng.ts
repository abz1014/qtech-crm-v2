// A small seeded random source for the reader's corpus generator: the same seed always gives the same corpus, on every machine.

export interface Rng {
  /** 0 <= x < 1 */
  next(): number
  int(lo: number, hi: number): number
  pick<T>(xs: readonly T[]): T
  chance(p: number): boolean
  /** k distinct elements, in random order. */
  sample<T>(xs: readonly T[], k: number): T[]
  shuffle<T>(xs: readonly T[]): T[]
}

/** A 32-bit hash of a string (FNV-1a), for seeding from a name. */
export function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

export function rng(seed: number | string): Rng {
  let a = typeof seed === 'string' ? hash(seed) : seed >>> 0
  const next = () => {
    // mulberry32
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const int = (lo: number, hi: number) => lo + Math.floor(next() * (hi - lo + 1))
  const shuffle = <T>(xs: readonly T[]): T[] => {
    const out = [...xs]
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1))
      ;[out[i], out[j]] = [out[j] as T, out[i] as T]
    }
    return out
  }
  return {
    next,
    int,
    pick: <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)] as T,
    chance: (p: number) => next() < p,
    sample: <T>(xs: readonly T[], k: number) => shuffle(xs).slice(0, k),
    shuffle,
  }
}
