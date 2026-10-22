import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { useSeesPrices } from '@/app/session'
import { rankItemQuotes } from '@/features/rfqs/ranking/api'
import type { RankRow } from '@/features/rfqs/lib/ranking/reasons'

/**
 * The ranked quotes of one RFQ (R25). Under the RFQ's own key, so every write that refreshes the RFQ page (a saved reply, a new rate,
 * a conversion) refreshes the ranking with it. Only asked for once there is a price to rank; if it fails the page falls back to the
 * plain comparison and nothing else changes. Never asked for an engineer: the ranking carries supplier prices (owner decision 2026-10-22).
 */
export function useRankedQuotes(rfqId: string | undefined, enabled: boolean) {
  const prices = useSeesPrices()
  const q = useQuery({
    queryKey: qk.rfqs.part(rfqId ?? '', 'ranking'),
    queryFn: () => rankItemQuotes(rfqId as string),
    enabled: Boolean(rfqId) && enabled && prices,
    staleTime: 30_000,
  })
  const byLine = useMemo(() => new Map<string, RankRow>((q.data ?? []).map(r => [r.quote_line_id, r])), [q.data])
  return { ...q, byLine }
}
