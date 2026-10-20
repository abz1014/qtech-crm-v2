/*
 * Time words (DESIGN_SYSTEM section 6, rule 8): the ONE place a day count becomes words, so a late state reads the
 * same everywhere ("3 days overdue", never "3d late" or "Overdue by 3 days"). Pure functions of a whole-day count;
 * the caller works out the count from its own dates. No "d" abbreviations. "Late" alone is a history word:
 * "Delivered 3 days late" (daysLate).
 */

const whole = (n: number) => Math.round(Math.abs(n))

/** "1 day", "4 days". */
export function days(n: number): string {
  const d = whole(n)
  return d === 1 ? '1 day' : `${d} days`
}

/** "3 days overdue", "1 day overdue". A count under one day still reads "1 day overdue" (it is past its date). */
export function daysOverdue(n: number): string {
  return `${days(Math.max(1, whole(n)))} overdue`
}

/** A history fact: "3 days late" (as in "Delivered 3 days late"). */
export function daysLate(n: number): string {
  return `${days(Math.max(1, whole(n)))} late`
}

/** Days until a due date: "Due today", "Due tomorrow", "Due in 4 days"; a negative count is "3 days overdue". */
export function dueWord(daysToDue: number): string {
  const n = Math.round(daysToDue)
  if (n < 0) return daysOverdue(-n)
  if (n === 0) return 'Due today'
  if (n === 1) return 'Due tomorrow'
  return `Due in ${days(n)}`
}

/** A date ahead: "Today", "Tomorrow", "In 4 days". A negative count reads as agoDays. */
export function inDays(n: number): string {
  const d = Math.round(n)
  if (d < 0) return agoDays(-d)
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  return `In ${days(d)}`
}

/** A date behind: "Today", "Yesterday", "3 days ago". */
export function agoDays(n: number): string {
  const d = whole(n)
  if (d === 0) return 'Today'
  if (d === 1) return 'Yesterday'
  return `${days(d)} ago`
}

/** Age of an open item: "New" (under a day), "1 day old", "5 days old". */
export function ageWords(n: number): string {
  const d = Math.floor(Math.max(0, n))
  return d === 0 ? 'New' : `${days(d)} old`
}
