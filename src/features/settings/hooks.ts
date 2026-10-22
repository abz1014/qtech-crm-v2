import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/settings/api'
import type { Role } from '@/features/settings/api'
import type { CategoryGroup } from '@/features/settings/categoriesModel'
import type { ProfileValues } from '@/features/settings/companyProfile'

/*
 * Settings hooks (R01 pattern): keys from the factory, what refreshes after a write from the
 * invalidation map. The team list comes from the admin-users function; only an admin may read it,
 * so the Team screen passes `enabled` and nobody else makes the request.
 */

export function useTeam(enabled: boolean) {
  return useQuery({ queryKey: qk.settings.team(), queryFn: () => api.listTeam(), enabled })
}

/*
 * The two writes that return a generated password use gcTime 0: TanStack would otherwise keep the
 * mutation result (the password) in its cache for minutes. With 0 it is dropped as soon as the dialog
 * that shows it has gone.
 */
export function useCreatePerson() {
  const client = useQueryClient()
  return useMutation({
    gcTime: 0,
    mutationFn: (v: Parameters<typeof api.createPerson>[0]) => api.createPerson(v),
    onSuccess: () => invalidateAfter(client, 'team.create', {}),
  })
}

export function useResetPassword() {
  const client = useQueryClient()
  return useMutation({
    gcTime: 0,
    mutationFn: (userId: string) => api.resetPassword(userId),
    onSuccess: () => invalidateAfter(client, 'team.reset-password', {}),
  })
}

export function useSetRole() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { userId: string; role: Role }) => api.setRole(v.userId, v.role),
    onSuccess: () => invalidateAfter(client, 'team.set-role', {}),
  })
}

export function useSetJobTitle() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { userId: string; jobTitle: string | null }) => api.setJobTitle(v.userId, v.jobTitle),
    onSuccess: () => invalidateAfter(client, 'team.set-job-title', {}),
  })
}

export function useSetPhone() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { userId: string; phone: string | null }) => api.setPhone(v.userId, v.phone),
    onSuccess: () => invalidateAfter(client, 'team.set-phone', {}),
  })
}

export function useMyDetails(userId: string) {
  return useQuery({ queryKey: qk.settings.myDetails(), queryFn: () => api.getMyDetails(userId), enabled: userId !== '' })
}

export function useDeactivatePerson() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api.deactivatePerson(userId),
    onSuccess: () => invalidateAfter(client, 'team.deactivate', {}),
  })
}

export function useReactivatePerson() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (userId: string) => api.reactivatePerson(userId),
    onSuccess: () => invalidateAfter(client, 'team.reactivate', {}),
  })
}

export function useCompanyProfile() {
  return useQuery({ queryKey: qk.settings.profile(), queryFn: () => api.getCompanyProfile() })
}

export function useSaveCompanyProfile() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (values: ProfileValues) => api.saveCompanyProfile(values),
    onSuccess: saved => {
      client.setQueryData(qk.settings.profile(), saved)
      return invalidateAfter(client, 'company-profile.update', {})
    },
  })
}

export function useChangePassword() {
  return useMutation({ mutationFn: (v: { current: string; next: string }) => api.changeOwnPassword(v.current, v.next) })
}

// ---------------------------------------------------------------- targets (M06)

/** Both reads are admin only, so the page passes `enabled` and no one else makes the request. */
export function useTargets(year: number, enabled: boolean) {
  return useQuery({ queryKey: qk.settings.targetRows(year), queryFn: () => api.listTargets(year), enabled })
}
export function useTargetProgress(year: number, enabled: boolean) {
  return useQuery({ queryKey: qk.settings.targetProgress(year), queryFn: () => api.listTargetProgress(year), enabled })
}

export function useSaveTarget() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { userId: string; year: number; quarter: number; amount: number }) => api.saveTarget(v),
    onSuccess: () => invalidateAfter(client, 'target.save', {}),
  })
}
export function useRemoveTargets() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (ids: readonly string[]) => api.removeTargets(ids),
    onSuccess: () => invalidateAfter(client, 'target.save', {}),
  })
}
export function useAddTargets() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (rows: Parameters<typeof api.addTargets>[0]) => api.addTargets(rows),
    onSuccess: () => invalidateAfter(client, 'target.save', {}),
  })
}

// ---------------------------------------------------------------- expense categories (M13)

/** The expense groups (0084). Same key as the expense screens' read, so one cache serves both. Admin only (`enabled`). */
export function useExpenseGroups(enabled: boolean) {
  return useQuery({ queryKey: qk.money.groups(), queryFn: () => api.listGroups(), enabled, staleTime: 5 * 60_000 })
}

export function useCategories(enabled: boolean) {
  return useQuery({ queryKey: qk.settings.categories(), queryFn: () => api.listCategories(), enabled })
}

export function useUpdateCategory() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; patch: api.CategoryPatch }) => api.updateCategory(v.id, v.patch),
    onSuccess: () => invalidateAfter(client, 'category.save', {}, { wait: 'all' }),
  })
}
export function useCreateCategory() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: Parameters<typeof api.createCategory>[0]) => api.createCategory(v),
    onSuccess: () => invalidateAfter(client, 'category.save', {}, { wait: 'all' }),
  })
}
export function useReorderCategories() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (changes: readonly { id: string; sort: number }[]) => api.reorderCategories(changes),
    onSuccess: () => invalidateAfter(client, 'category.save', {}, { wait: 'all' }),
  })
}
/** What each category had paid this month (gross), for the list's "this month" figure. Admin only (`enabled`). */
export function useCategoryMonthTotals(month: string, enabled: boolean) {
  return useQuery({ queryKey: qk.money.categoryMonth(month), queryFn: () => api.categoryMonthTotals(month), enabled, staleTime: 0 })
}
export function useMergeCategories() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { from: string; into: string }) => api.mergeCategories(v.from, v.into),
    onSuccess: () => invalidateAfter(client, 'category.merge', {}, { wait: 'all' }),
  })
}
export function useCreateGroup() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { name: string; kind: CategoryGroup; sort: number }) => api.createGroup(v),
    onSuccess: () => invalidateAfter(client, 'category.save', {}, { wait: 'all' }),
  })
}
export function useUpdateGroup() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { id: string; patch: { name?: string; sort?: number } }) => api.updateGroup(v.id, v.patch),
    onSuccess: () => invalidateAfter(client, 'category.save', {}, { wait: 'all' }),
  })
}
export function useDeleteGroup() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteGroup(id),
    onSuccess: () => invalidateAfter(client, 'category.save', {}, { wait: 'all' }),
  })
}
export function useDeleteCategory() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.deleteCategory(id),
    onSuccess: () => invalidateAfter(client, 'category.save', {}, { wait: 'all' }),
  })
}
