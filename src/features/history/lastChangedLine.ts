import { agoDays } from '@/lib/timeWords'
import { toBusinessDate } from '@/lib/dates'
import type { HistoryEvent } from '@/features/history/api'

// ---------------------------------------------------------------- "Last changed by"
/** "just now", "12 minutes ago", "3 hours ago", "Yesterday", "2 days ago": how long ago, for the one-line summary. */
export function agoWords(iso: string, now: Date = new Date()): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const mins = Math.floor((now.getTime() - t) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} ${mins === 1 ? 'minute' : 'minutes'} ago`
  const dayGap = daysBetween(toBusinessDate(new Date(t)), toBusinessDate(now))
  if (dayGap <= 0) {
    const h = Math.floor(mins / 60)
    return `${h} ${h === 1 ? 'hour' : 'hours'} ago`
  }
  return agoDays(dayGap).toLowerCase() === 'yesterday' ? 'yesterday' : agoDays(dayGap)
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** "Last changed by Ayesha, 2 days ago"; null when there is nothing to say. */
export function lastChangedLine(event: Pick<HistoryEvent, 'at' | 'by_name'> | undefined, now: Date = new Date()): string | null {
  if (!event) return null
  const when = agoWords(event.at, now)
  if (!when) return null
  return event.by_name ? `Last changed by ${event.by_name}, ${when}` : `Last changed ${when}`
}
