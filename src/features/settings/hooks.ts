import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/settings/api'
import type { Role } from '@/features/settings/api'
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
