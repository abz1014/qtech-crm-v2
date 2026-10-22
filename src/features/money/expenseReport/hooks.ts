import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { useCategories, useExpensesBetween, useGroups } from '@/features/money/expenses/hooks'
import { loadCashFlow } from '@/features/money/inOut/api'
import { periodMonths, shiftPeriod, type Period } from '@/features/money/inOut/model'
import { buildExpenseReport, toEntries, type ExpenseReportView } from '@/features/money/expenseReport/model'

/*
 * The Expenses report's reads, admin only (`enabled`): the expenses of the period and the period before (one request, paged), the
 * categories and groups, and the cash-flow months In vs out reads (the same query key, so the two reports share it). Live like
 * every report (staleTime 0): opening it reads the books again.
 */
export interface ExpenseReport {
  view: ExpenseReportView | null
  isPending: boolean
  isError: boolean
  refetch: () => void
}

export function useExpenseReport(period: Period, enabled = true): ExpenseReport {
  const from = periodMonths(shiftPeriod(period, -1))[0]
  const ms = periodMonths(period)
  const to = ms[ms.length - 1]
  const list = useExpensesBetween(from, to, enabled)
  const cats = useCategories(enabled)
  const groups = useGroups(enabled)
  const flows = useQuery({ queryKey: qk.money.monthEnd.cashFlow(), queryFn: loadCashFlow, enabled, staleTime: 0 })
  const view = useMemo(() => {
    if (!list.data || !cats.data || !groups.data || !flows.data) return null
    return buildExpenseReport({ period, entries: toEntries(list.data.rows, list.data), categories: cats.data, groups: groups.data, flows: flows.data })
  }, [period, list.data, cats.data, groups.data, flows.data])
  const all = [list, cats, groups, flows]
  return { view, isPending: all.some(q => q.isPending), isError: all.some(q => q.isError), refetch: () => all.forEach(q => void q.refetch()) }
}
