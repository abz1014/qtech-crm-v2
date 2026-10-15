import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/fx/api'

export function useFxHistory(currency: string | undefined) {
  return useQuery({ queryKey: qk.fx.history(currency ?? ''), queryFn: () => api.listFxHistory(currency as string), enabled: Boolean(currency) })
}

export function useSetFxRate() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (input: { currency: string; ratePkr: number; asOf?: string }) => api.setFxRate(input),
    onSuccess: () => invalidateAfter(client, 'fx.set', {}),
  })
}
