import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { businessToday } from '@/lib/dates'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/money/expenses/api'
import { SUPPLIER_PAYMENT_ID, mostUsedCategory, type RecurringTemplate } from '@/features/money/expenses/model'

/*
 * Expense hooks (R01 pattern). Every read takes `enabled`: Money's expense data is admin only, so for anyone else the
 * request is never made.
 */
export function useCategories(enabled = true) {
  return useQuery({ queryKey: qk.money.categories(), queryFn: api.listCategories, enabled, staleTime: 5 * 60_000 })
}

export function useExpenseMonth(month: string, enabled = true) {
  return useQuery({ queryKey: qk.money.expenses.month(month), queryFn: () => api.listExpenses(month), enabled })
}

/** The most-used category of the last 30 days, with its count (the burst sheet's first-row default). */
export function useMostUsedCategory(enabled = true) {
  const day = businessToday()
  return useQuery({
    queryKey: qk.money.expenses.recentUse(day),
    queryFn: async () => mostUsedCategory(await api.recentCategoryUse()),
    enabled,
  })
}

export function useLastCategoryForOrder(orderId: string | null | undefined) {
  return useQuery({
    queryKey: qk.money.expenses.lastCategory(orderId ?? ''),
    queryFn: () => api.lastCategoryForOrder(orderId as string),
    enabled: Boolean(orderId),
  })
}

export function useReceipts(expenseId: string | null | undefined) {
  return useQuery({
    queryKey: qk.money.expenses.receipts(expenseId ?? ''),
    queryFn: () => api.listReceipts(expenseId as string),
    enabled: Boolean(expenseId),
  })
}

export function useOrderOptions(enabled = true) {
  return useQuery({ queryKey: qk.money.orderOptions(), queryFn: api.listOrderOptions, enabled, staleTime: 60_000 })
}

export function useLegOptions(orderId: string | null | undefined) {
  return useQuery({
    queryKey: qk.money.legOptions(orderId ?? ''),
    queryFn: () => api.listLegOptions(orderId as string),
    enabled: Boolean(orderId),
  })
}

export function useRecurring(enabled = true) {
  return useQuery({ queryKey: qk.money.recurring.list(), queryFn: api.listRecurring, enabled })
}

export function useRecordedRecurring(period: string, enabled = true) {
  return useQuery({ queryKey: qk.money.recurring.recorded(period), queryFn: () => api.recordedRecurring(period), enabled })
}

export function useInsertExpenses() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (rows: Parameters<typeof api.insertExpenses>[0]) => api.insertExpenses(await api.withSingleLeg(rows, SUPPLIER_PAYMENT_ID)),
    onSuccess: () => invalidateAfter(client, 'expense.save', {}),
  })
}

export function useUpdateExpense() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; patch: api.ExpensePatch }) => api.updateExpense(v.id, v.patch),
    onSuccess: () => invalidateAfter(client, 'expense.save', {}),
  })
}

export function useDeleteExpense() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteExpense(id),
    onSuccess: () => invalidateAfter(client, 'expense.save', {}),
  })
}

export function useUploadReceipt() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { expenseId: string; file: File }) => api.uploadReceipt(v.expenseId, v.file),
    onSuccess: (_d, v) => invalidateAfter(client, 'expense.receipt', { expenseId: v.expenseId }),
  })
}

export function useDeleteReceipt(expenseId: string) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (r: Pick<api.Receipt, 'id' | 'path'>) => api.deleteReceipt(r),
    onSuccess: () => invalidateAfter(client, 'expense.receipt', { expenseId }),
  })
}

export function useSaveRecurring() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: api.RecurringInput) => api.saveRecurring(input),
    onSuccess: () => invalidateAfter(client, 'recurring.save', {}),
  })
}

export function useRecordRecurring() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { template: RecurringTemplate; id: string; period: string; paidOn: string; paidVia: 'bank' | 'cash' }) =>
      api.recordRecurring(v.template, { id: v.id, period: v.period, paidOn: v.paidOn, paidVia: v.paidVia }),
    onSuccess: () => invalidateAfter(client, 'recurring.record', {}),
  })
}
