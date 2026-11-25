import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { businessToday } from '@/lib/dates'
import { isMonthKey } from '@/features/money/monthKey'
import { monthKeyLabel } from '@/features/money/expenses/model'

/*
 * The month in the address (?month=2026-11) of every Money month page: the reports, Lock a month, Bank check, Payments.
 * One rule (screen review 2026-11-24, items 11 and 18):
 *   - no month in the address: the page's own default. Every report opens on this month (Asia/Karachi), as Money in and out
 *     does; Lock a month and Bank check open on the month that just ended, the one being closed.
 *   - a month that cannot be shown (2026-13, a month still to come, one before the books): the page shows its default, the
 *     address is put right (replaced, so Back does not return to the bad link) and a small note says what happened.
 * The note rides in the history entry's state, so it shows once for that link and goes when the person moves to another month.
 */

/** A period from the address that could not be shown, and the one shown instead ("November 2026"). */
export interface FixedPeriod {
  asked: string
  shown: string
}

const NOTE_KEY = 'periodFixed'

/** The earliest month a link may open (nothing in the books is older). */
const FIRST_MONTH = '2000-01'

/** This month in Karachi, "2026-11": what every report opens on. */
export const thisMonthKey = (today: string = businessToday()): string => today.slice(0, 7)

/** A month from the address that may be shown: well formed, not before 2000 and not after this month. */
export const isShowableMonth = (s: string | null, today: string): s is string => isMonthKey(s) && s >= FIRST_MONTH && s <= thisMonthKey(today)

/** The note under the page heading: "2026-13 in the link is not a month, so this shows November 2026." */
export function fixedPeriodNote(f: FixedPeriod, today: string = businessToday()): string {
  const month = thisMonthKey(today)
  const quarter = `${month.slice(0, 4)}-Q${Math.ceil(Number(month.slice(5, 7)) / 3)}`
  const now = isMonthKey(f.asked) ? month : /^\d{4}-Q[1-4]$/.test(f.asked) ? quarter : null
  const why = now === null ? 'is not a month' : f.asked > now ? 'has not started yet' : f.asked < FIRST_MONTH ? 'is before the books start' : 'cannot be shown here'
  return `${f.asked} in the link ${why}, so this shows ${f.shown}.`
}

/** The history state that carries the note, for a setSearchParams(…, { replace: true, state }) that puts the address right. */
export const fixedPeriodState = (f: FixedPeriod) => ({ [NOTE_KEY]: f })

/** The month shown and how to change it, from ?month=. A month that cannot be shown is replaced by `fallback` in the address. */
export function useMonthParam(fallback: (today: string) => string = thisMonthKey): { month: string; today: string; thisMonth: string; setMonth: (m: string) => void } {
  const today = businessToday()
  const [params, setParams] = useSearchParams()
  const asked = params.get('month')
  const ok = isShowableMonth(asked, today)
  const month = ok ? asked : fallback(today)
  useEffect(() => {
    if (asked === null || ok) return
    setParams(
      prev => {
        const next = new URLSearchParams(prev)
        next.set('month', month)
        return next
      },
      { replace: true, state: fixedPeriodState({ asked, shown: monthKeyLabel(month) }) },
    )
  }, [asked, ok, month, setParams])
  const setMonth = (m: string) => {
    const next = new URLSearchParams(params)
    next.set('month', m)
    setParams(next, { replace: true })
  }
  return { month, today, thisMonth: thisMonthKey(today), setMonth }
}

/** The note a page was sent with after its link's month was put right, from the history state; null otherwise. */
export function readFixedPeriod(state: unknown): FixedPeriod | null {
  const f = state && typeof state === 'object' ? (state as Record<string, unknown>)[NOTE_KEY] : null
  return f && typeof f === 'object' && typeof (f as FixedPeriod).asked === 'string' && typeof (f as FixedPeriod).shown === 'string' ? (f as FixedPeriod) : null
}
