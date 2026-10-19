// The collision line (O-3): "Ali chased this 1h ago". Nobody should chase a customer or supplier a colleague has just chased.
// Pure: the clock comes in. `at` is a timestamp (the time is known: "1h ago") or a plain date (only the day is known).

import { daysBetween } from './dateText'

const KARACHI_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Karachi', year: 'numeric', month: '2-digit', day: '2-digit' })

/** "just now", "12 min ago", "1h ago", "today", "yesterday", "3 days ago". */
export function agoWhen(at: string, nowMs: number): string {
  const hasTime = at.length > 10
  const today = KARACHI_DAY.format(new Date(nowMs))
  if (hasTime) {
    const ms = nowMs - new Date(at).getTime()
    const min = Math.floor(ms / 60_000)
    if (min < 2) return 'just now'
    if (min < 60) return `${min} min ago`
    const h = Math.floor(min / 60)
    if (h < 24 && KARACHI_DAY.format(new Date(at)) === today) return `${h}h ago`
    const day = KARACHI_DAY.format(new Date(at))
    const d = Math.max(0, daysBetween(day, today))
    return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
  }
  const d = Math.max(0, daysBetween(at.slice(0, 10), today))
  return d === 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago`
}

/** "Ali chased this 1h ago": the first name only, as people say it. */
export function chasedByText(name: string, at: string, nowMs: number): string {
  const first = name.trim().split(/\s+/)[0] || name
  return `${first} chased this ${agoWhen(at, nowMs)}`
}
