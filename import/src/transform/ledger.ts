import { money } from '../lib/text'
import type { MoneyLine } from '../types'

type Side = 'old' | 'neu' | 'excluded'

/** Money tallies for the reconciliation: what the old database holds, what goes in, and what is knowingly left out. */
export class Ledger {
  private readonly sums = new Map<string, Record<Side, number>>()

  add(key: string, side: Side, amount: number): void {
    const cur = this.sums.get(key) ?? { old: 0, neu: 0, excluded: 0 }
    cur[side] = money(cur[side] + amount)
    this.sums.set(key, cur)
  }

  line(key: string): MoneyLine {
    const s = this.sums.get(key) ?? { old: 0, neu: 0, excluded: 0 }
    return { key, old: s.old, neu: s.neu, excluded: s.excluded, diff: money(s.old - s.neu - s.excluded) + 0 }
  }

  keysWithPrefix(prefix: string): string[] {
    return [...this.sums.keys()].filter(k => k.startsWith(prefix)).sort()
  }
}
