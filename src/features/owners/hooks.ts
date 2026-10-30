import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/owners/api'

export function useOwnerCandidates() {
  return useQuery({ queryKey: [...qk.settings.team(), 'owner-candidates'] as const, queryFn: () => api.listOwnerCandidates(), staleTime: 60_000 })
}

export function useOpenWork(userId: string | undefined) {
  return useQuery({ queryKey: [...qk.settings.team(), 'open-work', userId ?? ''] as const, queryFn: () => api.openWorkOf(userId as string), enabled: Boolean(userId) })
}

export function useReassignOwner() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { kind: api.OwnedKind; id: string; to: string }) => api.reassignOwner(v.kind, v.id, v.to),
    onSuccess: () => invalidateAfter(client, 'owner.reassign', {}),
  })
}

export function useReassignOpenWork() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { from: string; to: string }) => api.reassignOpenWork(v.from, v.to),
    onSuccess: () => invalidateAfter(client, 'owner.reassign', {}),
  })
}
