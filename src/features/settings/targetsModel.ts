/*
 * Pure helpers for Settings › Targets (M06). A target is one amount of NET cash received (GST left out) per person
 * per calendar quarter. Nothing here touches the network: the page passes rows in and gets cells and plans out.
 */
export const QUARTERS = [1, 2, 3, 4] as const
export type Quarter = (typeof QUARTERS)[number]

export const MIN_YEAR = 2020
export const MAX_YEAR = 2100
/** targets.target_net_pkr is numeric(14,2): 12 digits before the point. */
export const MAX_TARGET = 999_999_999_999

export interface TargetRow {
  id: string
  user_id: string
  year: number
  quarter: number
  target_net_pkr: number
}

/** One row of v_target_progress (admin only). */
export interface ProgressRow {
  user_id: string
  year: number
  quarter: number
  target_net: number | null
  achieved_net: number
  on_pace_net: number | null
  behind_pace: number | null
  excluded_count: number
}

export const cellKey = (userId: string, year: number, quarter: number) => `${userId}|${year}|${quarter}`

export function indexTargets(rows: readonly TargetRow[]): Map<string, TargetRow> {
  return new Map(rows.map(r => [cellKey(r.user_id, r.year, r.quarter), r]))
}
export function indexProgress(rows: readonly ProgressRow[]): Map<string, ProgressRow> {
  return new Map(rows.map(r => [cellKey(r.user_id, r.year, r.quarter), r]))
}

export const quarterOfDate = (iso: string): { year: number; quarter: Quarter } => ({
  year: Number(iso.slice(0, 4)),
  quarter: (Math.floor((Number(iso.slice(5, 7)) - 1) / 3) + 1) as Quarter,
})

/** The quarter before: Q1 reaches back into the previous year's Q4. */
export const previousQuarter = (year: number, quarter: number): { year: number; quarter: Quarter } =>
  quarter === 1 ? { year: year - 1, quarter: 4 } : { year, quarter: (quarter - 1) as Quarter }

export const quarterLabel = (year: number, quarter: number) => `Q${quarter} ${year}`

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
export const quarterMonths = (quarter: number) => `${MONTHS[(quarter - 1) * 3]} to ${MONTHS[(quarter - 1) * 3 + 2]}`

export type QuarterPhase = 'past' | 'current' | 'future'
export function quarterPhase(year: number, quarter: number, today: string): QuarterPhase {
  const t = quarterOfDate(today)
  const a = year * 4 + quarter
  const b = t.year * 4 + t.quarter
  return a < b ? 'past' : a > b ? 'future' : 'current'
}

/** The date a quarter starts, as a short text ("1 Jan 2027"). */
export const quarterStartText = (year: number, quarter: number) => `1 ${MONTHS[(quarter - 1) * 3]} ${year}`

export type AmountCheck = { ok: true; amount: number } | { ok: false; message: string }
/** What may be saved in a cell. Empty is handled by the caller (it removes the target). */
export function checkTargetAmount(n: number | null): AmountCheck {
  if (n === null) return { ok: false, message: 'Enter an amount in rupees.' }
  if (!(n > 0)) return { ok: false, message: 'A target must be above 0. Leave the cell empty to remove it.' }
  if (n > MAX_TARGET) return { ok: false, message: 'That amount is too large.' }
  return { ok: true, amount: Math.round(n * 100) / 100 }
}

/** The footer line under the grid, like the Team list's: "3 people · 2 with Q4 targets". `quarter` is the current quarter when the year shown is this year. */
export function targetsFooter(userIds: readonly string[], targets: readonly TargetRow[], year: number, quarter: number | null): string {
  const ids = new Set(userIds)
  const mine = targets.filter(t => t.year === year && ids.has(t.user_id) && (quarter === null || t.quarter === quarter))
  const withTarget = new Set(mine.map(t => t.user_id)).size
  const people = `${userIds.length} ${userIds.length === 1 ? 'person' : 'people'}`
  return `${people} · ${withTarget} with ${quarter === null ? `targets in ${year}` : `Q${quarter} ${withTarget === 1 ? 'target' : 'targets'}`}`
}

export interface CopyPlan {
  from: { year: number; quarter: Quarter }
  into: { year: number; quarter: Quarter }
  /** Targets to add: only people with a target in the earlier quarter and none in this one. */
  add: { user_id: string; year: number; quarter: number; target_net_pkr: number }[]
  /** People who already have a target in this quarter (left alone). */
  kept: number
  /** People with nothing to copy from. */
  nothingToCopy: number
}

/** "Copy last quarter": fills empty cells of `into` from the quarter before it. It never overwrites a target. */
export function planCopy(userIds: readonly string[], targets: readonly TargetRow[], year: number, quarter: number): CopyPlan {
  const idx = indexTargets(targets)
  const from = previousQuarter(year, quarter)
  const add: CopyPlan['add'] = []
  let kept = 0
  let nothingToCopy = 0
  for (const id of userIds) {
    if (idx.has(cellKey(id, year, quarter))) {
      kept++
      continue
    }
    const src = idx.get(cellKey(id, from.year, from.quarter))
    if (!src) {
      nothingToCopy++
      continue
    }
    add.push({ user_id: id, year, quarter, target_net_pkr: src.target_net_pkr })
  }
  return { from, into: { year, quarter: quarter as Quarter }, add, kept, nothingToCopy }
}

export interface CellProgress {
  kind: 'none' | 'not-started' | 'running'
  achieved: number
  onPace: number
  /** Positive: ahead of pace. Negative: behind. */
  ahead: number
  excluded: number
}

/**
 * What sits beside a cell's target. Always rupee amounts, never a bare percentage: "achieved" and "on pace" are
 * figures from v_target_progress, and the gap is the difference of the two.
 */
export function cellProgress(target: TargetRow | undefined, p: ProgressRow | undefined, phase: QuarterPhase): CellProgress {
  const achieved = p ? Number(p.achieved_net) : 0
  const excluded = p ? Number(p.excluded_count) : 0
  if (!target) return { kind: 'none', achieved, onPace: 0, ahead: 0, excluded }
  if (phase === 'future') return { kind: 'not-started', achieved, onPace: 0, ahead: 0, excluded }
  // Whole rupees for the pace line: the gap is then plainly achieved minus on pace, as shown.
  const onPace = p?.on_pace_net == null ? 0 : Math.round(Number(p.on_pace_net))
  const got = Math.round(achieved)
  return { kind: 'running', achieved: got, onPace, ahead: got - onPace, excluded }
}
