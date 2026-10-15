// The target tile's working (g2-today-b2 "Target tile, with the working"). Every figure on the tile is derived from the
// four numbers my_target_progress() returns (target, achieved, on pace, behind) plus the quarter's dates, and the tile
// shows how. Pure. This is the person's OWN progress only: nobody else's number ever reaches this code.

import { daysBetween } from '@/features/rfqs/lib/dateText'
import type { TargetProgress } from '@/features/today/api'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** The tile rounds on-pace and the gap to the nearest PKR 10,000; the exact figures stay in the working. */
export const TILE_ROUNDING = 10_000
export const roundToTile = (n: number): number => Math.round(n / TILE_ROUNDING) * TILE_ROUNDING

export function quarterStart(year: number, quarter: number): string {
  return `${year}-${String((quarter - 1) * 3 + 1).padStart(2, '0')}-01`
}

const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`

export interface TargetWorking {
  label: string
  /** "1 Oct" and "31 Dec". */
  startText: string
  endText: string
  dayOfQuarter: number
  daysInQuarter: number
  daysLeft: number
  target: number
  achieved: number
  /** Exact, as the database computes them. */
  onPaceExact: number
  behindExact: number
  aheadExact: number
  /** As shown on the tile. */
  onPace: number
  behind: number
  ahead: number
  status: 'behind' | 'ahead' | 'on_pace'
  /** Bar geometry, 0 to 100: how far the fill reaches and where the on-pace marker sits. */
  fillPct: number
  markerPct: number
  excludedCount: number
}

/** Null when no target is set for the quarter: the tile then says so and Today depends on nothing else. */
export function targetWorking(t: TargetProgress, today: string): TargetWorking | null {
  if (t.targetNet === null || t.targetNet <= 0) return null
  const start = quarterStart(t.year, t.quarter)
  const total = daysBetween(start, t.quarterEnd) + 1
  const day = Math.min(Math.max(daysBetween(start, today) + 1, 0), total)
  const aheadExact = Math.max(t.achievedNet - t.onPaceNet, 0)
  const behindExact = t.behindPace
  const status = behindExact > 0 ? 'behind' : aheadExact > 0 ? 'ahead' : 'on_pace'
  const pct = (n: number) => Math.min(Math.max((n / (t.targetNet as number)) * 100, 0), 100)
  return {
    label: `Q${t.quarter}`,
    startText: dayMonth(start),
    endText: dayMonth(t.quarterEnd),
    dayOfQuarter: day,
    daysInQuarter: total,
    daysLeft: total - day,
    target: t.targetNet,
    achieved: t.achievedNet,
    onPaceExact: t.onPaceNet,
    behindExact,
    aheadExact,
    onPace: roundToTile(t.onPaceNet),
    behind: roundToTile(behindExact),
    ahead: roundToTile(aheadExact),
    status,
    fillPct: pct(t.achievedNet),
    markerPct: pct(t.onPaceNet),
    excludedCount: t.excludedCount,
  }
}

/** "3.78M" for the marker label. */
export function millions(n: number): string {
  return `${(n / 1_000_000).toFixed(2)}M`
}

