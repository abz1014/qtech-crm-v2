/* DateRail's pure part: the six states and how they follow from the dates (kept apart so it can be unit-tested without a DOM). */
export type DateRailState = 'on-track' | 'due-soon' | 'due-today' | 'overdue' | 'done' | 'no-date'

/** Within this many days of the due day a rail turns from on-track to due-soon. */
export const DUE_SOON_DAYS = 4

/** Whole calendar days from a to b (YYYY-MM-DD), negative when b is earlier. */
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)

/** The state a rail is in, from its dates: done when `doneOn` is set, then overdue, due-today, due-soon, on-track; no-date without a due day. */
export function railState(due: string | null, today: string, doneOn?: string | null): DateRailState {
  if (doneOn) return 'done'
  if (!due) return 'no-date'
  const left = daysBetween(today, due)
  if (left < 0) return 'overdue'
  if (left === 0) return 'due-today'
  return left <= DUE_SOON_DAYS ? 'due-soon' : 'on-track'
}
