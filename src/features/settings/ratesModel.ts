import type { FxLatestRow } from '@/features/rfqs/api'
import { formatDay } from '@/lib/formatDay'

/* The rates' status line (kept apart from the component so it tests without a DOM). The table's helpers are in src/features/fx/ratesModel.ts. */

/**
 * What the rates' one status line says, from the rows themselves (audit 2026-10-22: "Updated every night" sat above five rows that
 * all said "Entered by hand"). Says what actually happened: when the newest automatic rate is from, and how many are by hand.
 *   no rows               "No rates yet."
 *   all automatic         "Last automatic update Thu 26 Nov."
 *   mixed                 "Last automatic update Thu 26 Nov. 2 rates entered by hand."
 *   all by hand           "No automatic update yet. Rates entered by hand."
 */
export function ratesStatusLine(rows: readonly Pick<FxLatestRow, 'asOf' | 'source'>[]): string {
  if (rows.length === 0) return 'No rates yet.'
  const auto = rows.filter(r => r.source === 'auto').map(r => r.asOf).sort()
  const byHand = rows.length - auto.length
  if (auto.length === 0) return 'No automatic update yet. Rates entered manually.'
  const last = `Last automatic update ${formatDay(auto[auto.length - 1])}.`
  return byHand === 0 ? last : `${last} ${byHand} ${byHand === 1 ? 'rate' : 'rates'} entered manually.`
}