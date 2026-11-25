import type { CheckCard } from '@/features/money/monthEnd/model'

/** One row of the lock checks, as the Lock a month page and its confirmation both count them. */
export interface LockCheck {
  key: string
  label: string
  /** The name when clear, said as the result ("Bank statement matched", "No mistakes to fix"). */
  cleared: string
  n: number
  unit: string
  clear: boolean
}

/**
 * The ONE list of checks for locking a month (design 57-lock-month): the six month checks, then "Mistakes to fix" (the
 * reconciliation checks, which look at every month) as the seventh. The page and the confirmation both count from this list, so
 * "N of 7 checks have items" says the same thing in both.
 */
export function lockChecks(cards: readonly CheckCard[], mistakes: number): LockCheck[] {
  return [
    ...cards.map(c => ({ key: c.key, label: c.label, cleared: c.cleared, n: c.n, unit: c.unit, clear: c.clear })),
    { key: 'things_to_check', label: 'Mistakes to fix', cleared: 'No mistakes to fix', n: mistakes, unit: 'items', clear: mistakes === 0 },
  ]
}

export const lockChecksWithItems = (checks: readonly LockCheck[]): number => checks.filter(c => !c.clear).length

/** "Bank statement matched, every expense has a category and no mistakes to fix": one sentence, GST and FBR kept in capitals. */
export function clearList(names: readonly string[]): string {
  const low = names.map((n, i) => (i === 0 || /^[A-Z]{2}/.test(n) ? n : n.charAt(0).toLowerCase() + n.slice(1)))
  return low.length > 1 ? `${low.slice(0, -1).join(', ')} and ${low[low.length - 1]}` : (low[0] ?? '')
}
