import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/money/monthEnd/api'

/*
 * Month-end (M10). Admin only: `enabled` keeps anyone else from making any of these requests. The month-end figures move with
 * every payment, expense and tick, so none of them is cached for later (staleTime 0): opening a tab always reads the books again.
 */
const live = { staleTime: 0 } as const

export const useMonthEndStatus = (month: string, enabled = true) =>
  useQuery({ queryKey: qk.money.monthEnd.status(month), queryFn: () => api.loadStatus(month), enabled, ...live })

export const useMonthEndDetails = (month: string, enabled = true) =>
  useQuery({ queryKey: [...qk.money.monthEnd.status(month), 'details'], queryFn: () => api.loadCheckDetails(month), enabled, ...live })

export const useClosedMonths = (enabled = true) =>
  useQuery({ queryKey: qk.money.monthEnd.closed(), queryFn: api.loadClosedMonths, enabled, ...live })

/** Every month with money in it, each with its P&L (a row a month). */
export const usePnlMonths = (enabled = true) =>
  useQuery({ queryKey: qk.money.monthEnd.pnl(), queryFn: api.loadPnlMonths, enabled, ...live })

export const usePaymentStats = (month: string, enabled = true) =>
  useQuery({ queryKey: qk.money.monthEnd.payments(month), queryFn: () => api.loadPaymentStats(month), enabled, ...live })

export const useCategoryLines = (month: string, enabled = true) =>
  useQuery({ queryKey: qk.money.monthEnd.categories(month), queryFn: () => api.loadCategoryLines(month), enabled, ...live })

export const useCategoryNotes = (month: string, enabled = true) =>
  useQuery({ queryKey: [...qk.money.monthEnd.categories(month), 'notes'], queryFn: () => api.loadCategoryNotes(month), enabled, ...live })

export const useViaStat = (month: string, enabled = true) =>
  useQuery({ queryKey: qk.money.monthEnd.expenseLines(month), queryFn: () => api.loadViaStat(month), enabled, ...live })

export const useAging = (asOf: string, enabled = true) =>
  useQuery({ queryKey: qk.money.monthEnd.aging(asOf), queryFn: () => api.loadAging(asOf), enabled, ...live })

export const usePayables = (asOf: string, enabled = true) =>
  useQuery({ queryKey: qk.money.monthEnd.payables(asOf), queryFn: () => api.loadPayables(asOf), enabled, ...live })

export const useGstMonths = (enabled = true) =>
  useQuery({ queryKey: qk.money.monthEnd.gst(), queryFn: api.loadGstMonths, enabled, ...live })

export const useTeamMonth = (month: string, enabled = true) =>
  useQuery({ queryKey: qk.money.monthEnd.team(month), queryFn: () => api.loadTeamMonth(month), enabled, ...live })

/** Close ONE month (months lock one at a time, oldest first: owner decision 2026-10-22). */
export function useCloseMonth() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { month: string }) => api.closeMonth(v.month),
    onSettled: (_d, _e, v) => invalidateAfter(client, 'month.close', { month: v.month }),
  })
}

export function useReopenMonth() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { month: string; note: string }) => api.reopenMonth(v.month, v.note),
    onSettled: (_d, _e, v) => invalidateAfter(client, 'month.reopen', { month: v.month }),
  })
}
