// The words on Today's rows and pane, in one place so a test can pin them. Pure.

import { daysBetween } from '@/features/rfqs/lib/dateText'
import { formatDay } from '@/lib/formatDay'

/** "chased just now", "chased yesterday", "chased 2 days ago". `verb` is "chased" for a chase, "reminded" for a payment reminder. */
export function chasedAgo(chasedOn: string, today: string, verb = 'chased'): string {
  const d = Math.max(0, daysBetween(chasedOn, today))
  if (d === 0) return `${verb} just now`
  if (d === 1) return `${verb} yesterday`
  return `${verb} ${d} days ago`
}

/** "chased 2 days ago · next nudge on Mon 30 Nov". */
export function waitingLine(chasedOn: string, nextNudgeOn: string, today: string, verb = 'chased'): string {
  return `${chasedAgo(chasedOn, today, verb)} · next nudge on ${formatDay(nextNudgeOn)}`
}

/** "6 days ago", "today", "yesterday". */
export function agoText(on: string, today: string): string {
  const d = Math.max(0, daysBetween(on, today))
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

/** "4 days", "1 day", "today", "2 days late". */
export function distanceText(dueOn: string, today: string): string {
  const d = daysBetween(today, dueOn)
  if (d === 0) return 'today'
  const n = Math.abs(d)
  return `${n} ${n === 1 ? 'day' : 'days'}${d < 0 ? ' late' : ''}`
}

const WEEKDAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** "Friday 27 November" for the page header. */
export function headerDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return `${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${MONTH[m - 1]}`
}
