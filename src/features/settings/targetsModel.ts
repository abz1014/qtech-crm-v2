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

/**
 * What the typed text of a target cell means. Only a cell that is really empty removes a target: text that is not an
 * amount ("abc") reads as null too, and must never be taken for "empty" (hunt HE-12, it deleted a saved target).
 */
export type CellIntent = { kind: 'remove' } | { kind: 'unreadable'; message: string } | { kind: 'amount'; value: number }
export function cellIntent(text: string, value: number | null): CellIntent {
  if (text.trim() === '') return { kind: 'remove' }
  if (value === null) return { kind: 'unreadable', message: 'That is not an amount. Type digits, for example 500000, or clear the cell to remove the target.' }
  return { kind: 'amount', value }
}
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

/** The quarter after: Q4 runs into the next year's Q1. */
export const nextQuarter = (year: number, quarter: number): { year: number; quarter: Quarter } =>
  quarter === 4 ? { year: year + 1, quarter: 1 } : { year, quarter: (quarter + 1) as Quarter }

export type QuarterRef = { year: number; quarter: Quarter }

/**
 * Which quarters the grid shows (audit 2026-10-22: ten dashed "Set target" boxes for quarters already over). By default this
 * quarter and the next, which may run into next year; "Show earlier quarters" shows the four of one chosen year.
 */
export function shownQuarters(mode: 'now' | 'year', today: string, year: number): QuarterRef[] {
  if (mode === 'year') return QUARTERS.map(quarter => ({ year, quarter }))
  const now = quarterOfDate(today)
  return [now, nextQuarter(now.year, now.quarter)]
}

const grouped = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })

/** A gap in few characters: "300,000" below a million, "1.95 M" from a million up. */
export function compactPkr(n: number): string {
  const a = Math.abs(n)
  if (a < 1_000_000) return grouped.format(a)
  return `${(a / 1_000_000).toFixed(2).replace(/\.?0+$/, '')} M`
}

/**
 * A running cell's one line (audit 2026-10-22, was three lines): "Achieved 3,862,102 of 8,000,000 · 1.95 M ahead of pace".
 * Rupee figures only, never a percentage.
 */
export function progressLine(p: Pick<CellProgress, 'achieved' | 'ahead'>, target: number): string {
  const head = `Achieved ${grouped.format(p.achieved)} of ${grouped.format(target)}`
  if (p.ahead === 0) return `${head} · On pace`
  return `${head} · ${compactPkr(p.ahead)} ${p.ahead < 0 ? 'behind pace' : 'ahead of pace'}`
}