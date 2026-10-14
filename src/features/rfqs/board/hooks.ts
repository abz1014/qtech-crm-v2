import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/rfqs/board/api'
import { PAGE_SIZE, sortBoard } from '@/features/rfqs/board/model'

/* RFQ board hooks (R06): one per read. Server data stays in the TanStack cache; nothing is copied into state. */

/** Every open RFQ, already in board order (due date, then priority). */
export function useOpenRfqs() {
  return useQuery({ queryKey: qk.rfqs.board(), queryFn: async () => sortBoard(await api.listOpenRfqs()) })
}

export function useClosedRfqs(page: number, enabled = true) {
  return useQuery({
    queryKey: qk.rfqs.closed(page),
    queryFn: () => api.listClosedRfqs(page, PAGE_SIZE),
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useClosedCount() {
  return useQuery({ queryKey: qk.rfqs.closedCount(), queryFn: api.countClosedRfqs })
}
