import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/money/review/api'

/*
 * Review imported hooks (admin only: `enabled` is the admin check). A decision or a link changes who owes what, which orders are
 * history, an order's costs mark and Today's rows, so the money lists, orders and Today all go stale.
 */
const KEY = [...qk.money.all, 'review-imported'] as const

export const useReviewItems = (enabled = true) => useQuery({ queryKey: KEY, queryFn: api.listReviewItems, enabled, staleTime: 0 })

function refresh(client: QueryClient) {
  return Promise.all([qk.money.all, qk.orders.all, qk.today.all].map(queryKey => client.invalidateQueries({ queryKey })))
}

export function useSetReview() {
  const client = useQueryClient()
  return useMutation({ mutationFn: api.setLegacyReview, onSuccess: () => refresh(client) })
}

export function useFindMatches() {
  return useMutation({ mutationFn: api.findMatches })
}

export function useLinkOne() {
  const client = useQueryClient()
  return useMutation({ mutationFn: api.linkOne, onSuccess: () => refresh(client) })
}

export function useLinkAllCertain() {
  const client = useQueryClient()
  return useMutation({ mutationFn: api.linkAllCertain, onSuccess: () => refresh(client) })
}
