import { useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { businessToday } from '@/lib/dates'
import { useClosedMonths, useMonthEndDetails, useMonthEndStatus, usePnlMonths } from '@/features/money/monthEnd/hooks'
import {
  buildChecklist,
  checksWithItems,
  closeState,
  defaultMonthEndMonth,
  isMonthKey,
  shiftMonth,
  type CheckCard,
  type CloseState,
  type ClosedMonth,
} from '@/features/money/monthEnd/model'

/*
 * What every Month-end view shares: the month in the address (?month=2026-10; last month when absent), the checklist counts,
 * whether the month is closed and whether it may be closed now.
 */
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

export function useMonthEnd(): MonthEndCtx {
  const today = businessToday()
  const [params, setParams] = useSearchParams()
  const asked = params.get('month')
  const month = isMonthKey(asked) ? asked : defaultMonthEndMonth(today)
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
  const setMonth = (m: string) => {
    const next = new URLSearchParams(params)
    next.set('month', m)
    setParams(next, { replace: true })
  }
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

