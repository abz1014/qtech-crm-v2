import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { invalidateAfter } from '@/features/invalidation'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/money/bank/api'
import { applyTick, type BankLine, type RawBank } from '@/features/money/bank/model'

/** One statement month's raw lines. Admin only: `enabled` keeps anyone else from making the request. */
export function useBankMonth(month: string, enabled = true) {
  return useQuery({
    queryKey: qk.money.bank.month(month),
    queryFn: () => api.loadBank(month),
    enabled,
  })
}

/**
 * Tick or untick one line (one request). The line moves at once; a refused write puts it back and the caller shows why.
 * `tick: false` clears the month.
 */
export function useTickLine(month: string) {
  const client = useQueryClient()
  const key = qk.money.bank.month(month)
  const mutationKey = [...key, 'tick'] as const
  return useMutation({
    mutationKey,
    mutationFn: (v: { line: Pick<BankLine, 'kind' | 'ids'>; tick: boolean }) =>
      api.setBankMonth(v.line.kind, v.line.ids, v.tick ? month : null),
    onMutate: async v => {
      await client.cancelQueries({ queryKey: key })
      const before = client.getQueryData<RawBank>(key)
      if (before) client.setQueryData<RawBank>(key, applyTick(before, v.line, v.tick ? month : null))
      return { before }
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.before) client.setQueryData(key, ctx.before)
    },
    // Read back only when the last of a quick run of ticks has landed, so a refetch never undoes a tick still in flight.
    onSettled: () => (client.isMutating({ mutationKey }) <= 1 ? invalidateAfter(client, 'bank.tick', {}) : undefined),
  })
}
