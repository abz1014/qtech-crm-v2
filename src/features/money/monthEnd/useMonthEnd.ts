import { useMemo } from 'react'
import { thisMonthKey, useMonthParam } from '@/features/money/monthParam'
import { useClosedMonths, useMonthEndDetails, useMonthEndStatus, usePnlMonths } from '@/features/money/monthEnd/hooks'
import {
  buildChecklist,
  checksWithItems,
  closeState,
  defaultMonthEndMonth,
  shiftMonth,
  type CheckCard,
  type CloseState,
  type ClosedMonth,
} from '@/features/money/monthEnd/model'

/*
 * What every Month-end view shares: the month in the address (?month=2026-10), the checklist counts, whether the month is
 * closed and whether it may be closed now. With no month (or one that cannot be shown, put right in the address with a note,
 * monthParam.ts), Lock a month opens on the month that just ended (the one being closed) and every report on this month,
 * as Money in and out does (screen review 2026-11-24, item 11).
 */
export type MonthEndDefault = 'last-month' | 'this-month'

export interface MonthEndCtx {
  today: string
  month: string
  thisMonth: string
  /** The address's own query string, kept on every Month-end link so the month follows the person around. */
  search: string
  setMonth: (m: string) => void
  go: (by: number) => void
  statusReady: boolean
  statusError: boolean
  cards: CheckCard[]
  withItems: number
  closed: ClosedMonth[]
  closedEntry: ClosedMonth | undefined
  state: CloseState | null
  /** Whether any payment or expense falls in the month (null until known). */
  hasMoney: boolean | null
  refetch: () => void
}

export function useMonthEnd(opens: MonthEndDefault = 'last-month'): MonthEndCtx {
  // A future month (or one before 2000, or 2026-13) from a link falls back to the default month (HE-21), with a note.
  const { month, today, setMonth } = useMonthParam(opens === 'this-month' ? thisMonthKey : defaultMonthEndMonth)
  const status = useMonthEndStatus(month)
  const details = useMonthEndDetails(month)
  const closedQ = useClosedMonths()
  const pnl = usePnlMonths()
  const cards = useMemo(() => buildChecklist(status.data ?? [], month, details.data), [status.data, details.data, month])
  const closed = closedQ.data ?? []
  const state = useMemo(
    () => (closedQ.data && pnl.data ? closeState(month, today, new Set(closedQ.data.map(c => c.key)), Object.keys(pnl.data)) : null),
    [closedQ.data, pnl.data, month, today],
  )
  return {
    today,
    month,
    thisMonth: today.slice(0, 7),
    search: `?month=${month}`,
    setMonth,
    go: by => setMonth(shiftMonth(month, by)),
    statusReady: status.isSuccess,
    statusError: status.isError,
    cards,
    withItems: checksWithItems(cards),
    closed,
    closedEntry: closed.find(c => c.key === month),
    state,
    hasMoney: pnl.data ? month in pnl.data : null,
    refetch: () => void status.refetch(),
  }
}

