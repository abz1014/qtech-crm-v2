import { money } from '../lib/text'
import type { MoneyLine } from '../types'

/** settled: paid before the new system on an invoice with no order (settled_before_cutover), so no payment row goes in. */
type Side = 'old' | 'neu' | 'excluded' | 'settled'

/**
 * Money tallies for the reconciliation: what the old database holds, what goes in, what is knowingly left out, and (on the
 * paid-status line only) what was settled before cutover. A line carries `settled` only when something was settled.
 */
export class Ledger {
  private readonly sums = new Map<string, Record<Side, number>>()

  add(key: string, side: Side, amount: number): void {
    const cur = this.sums.get(key) ?? { old: 0, neu: 0, excluded: 0, settled: 0 }
    cur[side] = money(cur[side] + amount)
    this.sums.set(key, cur)
  }

  line(key: string): MoneyLine {
    const s = this.sums.get(key) ?? { old: 0, neu: 0, excluded: 0, settled: 0 }
    return {
      key,
      old: s.old,
      neu: s.neu,
      excluded: s.excluded,
      ...(s.settled ? { settled: s.settled } : {}),
      diff: money(s.old - s.neu - s.excluded - s.settled) + 0,
    }
  }

  keysWithPrefix(prefix: string): string[] {
    return [...this.sums.keys()].filter(k => k.startsWith(prefix)).sort()
  }
}
