import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/rfqs/board/api'
import { PAGE_SIZE, sortBoard } from '@/features/rfqs/board/model'

/* RFQ board hooks (R06): one per read. Server data stays in the TanStack cache; nothing is copied into state. */

/** Every open RFQ, already in board order (due date, then priority). */
export function useOpenRfqs() {
  return useQuery({ queryKey: qk.rfqs.board(), queryFn: async () => sortBoard(await api.listOpenRfqs()) })
}

/** One page of won and closed RFQs; with `text`, searched on the server over every closed RFQ (the key keeps the closed prefix, so invalidation reaches it). */
export function useClosedRfqs(page: number, text: string, enabled = true) {
  const q = text.trim().toLowerCase()
  return useQuery({
    queryKey: [...qk.rfqs.closed(page), q] as const,
    queryFn: () => api.listClosedRfqs(page, PAGE_SIZE, q),
    placeholderData: keepPreviousData,
    enabled,
  })
}

/** Quoted net per open RFQ, for the Value column. `enabled` is false for an engineer: the request is never made. */
export function useRfqValues(enabled: boolean) {
  return useQuery({ queryKey: qk.rfqs.values(), queryFn: api.listRfqValues, enabled, staleTime: 60_000 })
}
