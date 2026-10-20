import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { useCategories } from '@/features/money/expenses/hooks'
import * as api from '@/features/money/inOut/api'
import { buildInOut, periodMonths, shiftPeriod, type InOutView, type Period } from '@/features/money/inOut/model'

/*
 * In vs out, admin only (`enabled`). Like the month-end reports the figures move with every payment, expense and invoice, so
 * nothing is cached for later (staleTime 0): opening the report reads the books again.
 */
const live = { staleTime: 0 } as const

export interface InOutReport {
  view: InOutView | null
  isPending: boolean
  isError: boolean
  refetch: () => void
}

export function useInOutReport(period: Period, enabled = true): InOutReport {
  const from = periodMonths(shiftPeriod(period, -1))[0]
  const ms = periodMonths(period)
  const to = ms[ms.length - 1]
  const flows = useQuery({ queryKey: qk.money.monthEnd.cashFlow(), queryFn: api.loadCashFlow, enabled, ...live })
  const profit = useQuery({ queryKey: [...qk.money.monthEnd.cashFlow(), 'profit'], queryFn: api.loadProfit, enabled, ...live })
  const detail = useQuery({ queryKey: qk.money.monthEnd.cashOutDetail(from, to), queryFn: () => api.loadCashOutDetail(from, to), enabled, ...live })
  const cats = useCategories(enabled)
  const view = useMemo(() => {
    if (!flows.data || !profit.data || !detail.data || !cats.data) return null
    const names = Object.fromEntries(cats.data.map(c => [c.id, c.name]))
    return buildInOut(period, flows.data, profit.data, detail.data, names)
  }, [period, flows.data, profit.data, detail.data, cats.data])
  const all = [flows, profit, detail, cats]
  return { view, isPending: all.some(q => q.isPending), isError: all.some(q => q.isError), refetch: () => all.forEach(q => void q.refetch()) }
}
