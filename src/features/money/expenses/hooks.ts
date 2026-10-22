import { useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { businessToday } from '@/lib/dates'
import { mapPgError } from '@/lib/pgErrors'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import { checkCategoryName, nextSort } from '@/features/settings/categoriesModel'
import { useCreateCategory } from '@/features/settings/hooks'
import * as api from '@/features/money/expenses/api'
import * as claims from '@/features/money/expenses/claimsApi'
import { billPeriods } from '@/features/money/expenses/forMonth'
import type { PayRow } from '@/features/money/expenses/pay'
import type { CreateCategoryResult } from '@/features/money/expenses/CategoryPicker'
import {
  SUPPLIER_PAYMENT_ID,
  defaultGroupId,
  monthKey,
  rankCategoryUse,
  shiftMonth,
  type Category,
  type CategoryUse,
  type ExpenseGroup,
  type PaidVia,
  type RecurringTemplate,
} from '@/features/money/expenses/model'

/** The details typed in the last twelve months, for the Detail field's suggestions (detailSuggestions orders them per row). */
export function useRecentDetails(enabled = true) {
  const since = `${shiftMonth(monthKey(businessToday()), -11)}-01`
  return useQuery({ queryKey: qk.money.expenses.details(since), queryFn: () => api.listRecentDetails(since), enabled, staleTime: 60_000 })
}

/**
 * "Create" in the category picker (owner request 2026-10-20; group 0086): the same name rule and the same request as Settings >
 * Expense categories (useCreateCategory, so the same lists refresh), filed under the chosen group (Office running when none is
 * chosen), placed last, paid via as tapped. Resolves once the category lists hold the new one, so the picker shows it straight away.
 */
export function useInlineCategoryCreate(
  categories: readonly Category[] | undefined,
  groups: readonly ExpenseGroup[] | undefined,
): (name: string, paidVia: PaidVia, groupId?: string | null) => Promise<CreateCategoryResult> {
  const { mutateAsync } = useCreateCategory()
  return useCallback(
    async (raw: string, paidVia: PaidVia, groupId?: string | null) => {
      const all = categories ?? []
      const check = checkCategoryName(raw, all)
      if (!check.ok) return { error: check.message }
      const group = (groups ?? []).find(g => g.id === (groupId ?? defaultGroupId(groups ?? [])))
      if (!group) return { error: 'The expense groups have not loaded yet. Try again in a moment.' }
      try {
        const id = await mutateAsync({ name: check.name, group_id: group.id, grp: group.kind, default_paid_via: paidVia, sort: nextSort(all) })
        return { id }
      } catch (err) {
        return { error: mapPgError(err, { entity: 'category' }).message }
      }
    },
    [categories, groups, mutateAsync],
  )
}

/** The expense groups (0086), admin only (`enabled`). */
export function useGroups(enabled = true) {
  return useQuery({ queryKey: qk.money.groups(), queryFn: api.listGroups, enabled, staleTime: 5 * 60_000 })
}

/** Every expense paid from one month to another ("2026-07".."2026-09"), for the Expenses report. Live (staleTime 0), like every report. */
export function useExpensesBetween(fromMonth: string, toMonth: string, enabled = true) {
  return useQuery({ queryKey: qk.money.expenses.range(fromMonth, toMonth), queryFn: () => api.listExpensesBetween(fromMonth, toMonth), enabled, staleTime: 0 })
}

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

/** Categories by use in the last 30 days, most used first: one read for the default and the picker's Recent section. */
const recentUseQuery = (day: string) => ({ queryKey: qk.money.expenses.recentUse(day), queryFn: async () => rankCategoryUse(await api.recentCategoryUse()) })

/** The most-used category of the last 30 days, with its count (the burst sheet's first-row default). */
export function useMostUsedCategory(enabled = true) {
  return useQuery({ ...recentUseQuery(businessToday()), enabled, select: (use: CategoryUse[]) => (use[0] ? { id: use[0].id, count: use[0].count } : null) })
}

/** Categories by use in the last 30 days (the picker's Recent section). */
export function useCategoryUse(enabled = true) {
  return useQuery({ ...recentUseQuery(businessToday()), enabled })
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

// ------------------------------------------------------------------ 0087: monthly bills by period, Pay, claims, cash in hand

/** Template ids recorded for last month and this month (Monthly bills' due list and quick add's "settles this bill"). */
export function useRecordedBills(today: string, enabled = true) {
  const periods = billPeriods(today)
  return useQuery({ queryKey: qk.money.recurring.recorded(periods.join('+')), queryFn: () => api.recordedRecurringFor(periods), enabled })
}

/** What one supplier order still needs (Pay dialog). */
export function useLegPayState(legId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: qk.money.expenses.legPay(legId ?? ''),
    queryFn: () => api.legPayState(legId as string, businessToday()),
    enabled: enabled && Boolean(legId),
    staleTime: 0,
  })
}

/** The supplier payment and its bank charges, in one request (all or nothing). */
export function useInsertPayment() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (rows: PayRow[]) => api.insertExpenses(rows),
    onSuccess: () => invalidateAfter(client, 'expense.save', {}),
  })
}

export function usePendingClaims(enabled = true) {
  return useQuery({ queryKey: qk.money.expenses.claims('pending'), queryFn: claims.listPendingClaims, enabled })
}

export function useMyClaims(enabled = true) {
  return useQuery({ queryKey: qk.money.expenses.claims('mine'), queryFn: claims.listMyClaims, enabled })
}

export function useClaimPhotos(claimId: string | null | undefined) {
  return useQuery({ queryKey: qk.money.expenses.claimPhotos(claimId ?? ''), queryFn: () => claims.listClaimPhotos(claimId as string), enabled: Boolean(claimId) })
}

export function useCreateClaim() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: async (v: claims.NewClaim & { photo: File | null }) => {
      await claims.createClaim(v)
      // A photo that fails never undoes the claim: the caller says so and the claim stays.
      if (v.photo) return claims.uploadClaimPhoto(v.id, v.photo).then(() => true, () => false)
      return true
    },
    onSuccess: () => invalidateAfter(client, 'expense.save', {}),
  })
}

export function useWithdrawClaim() {
  const client = useQueryClient()
  return useMutation({ mutationFn: (id: string) => claims.withdrawClaim(id), onSuccess: () => invalidateAfter(client, 'expense.save', {}) })
}

export function useApproveClaim() {
  const client = useQueryClient()
  return useMutation({ mutationFn: claims.approveClaim, onSuccess: () => invalidateAfter(client, 'expense.save', {}) })
}

export function useRejectClaim() {
  const client = useQueryClient()
  return useMutation({ mutationFn: claims.rejectClaim, onSuccess: () => invalidateAfter(client, 'expense.save', {}) })
}

export function useCashInHand(enabled = true) {
  return useQuery({ queryKey: qk.money.expenses.cash(), queryFn: claims.loadCashInHand, enabled, staleTime: 0 })
}

export function useRecordCashCount() {
  const client = useQueryClient()
  return useMutation({ mutationFn: claims.recordCashCount, onSuccess: () => invalidateAfter(client, 'expense.save', {}) })
}

export function useAddCashTopup() {
  const client = useQueryClient()
  return useMutation({ mutationFn: claims.addCashTopup, onSuccess: () => invalidateAfter(client, 'expense.save', {}) })
}
