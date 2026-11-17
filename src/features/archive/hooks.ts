import { useMutation, useQuery, useQueries, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { getArchiveState, unhideRecord, type ArchiveEntity } from '@/features/archive/api'

export interface ArchivePart {
  entity: ArchiveEntity
  id: string
}

const stateQuery = (entity: ArchiveEntity, id: string) => ({
  queryKey: qk.archive.state(entity, id),
  queryFn: () => getArchiveState(entity, id),
})

export function useArchiveState(entity: ArchiveEntity, id: string | null | undefined) {
  return useQuery({ ...stateQuery(entity, id ?? ''), enabled: Boolean(id) })
}

/**
 * One thing made of several records (a job is an RFQ and its order): it is archived only when every part is (so the parts shown
 * are exactly the ones to bring back). Until every part has been read, it is not archived.
 */
export function useArchiveParts(parts: readonly ArchivePart[]) {
  return useQueries({
    queries: parts.map(p => stateQuery(p.entity, p.id)),
    combine: results => {
      const all = results.length > 0 && results.every(r => r.data !== undefined)
      const states = results.map(r => r.data)
      const archived = all && states.every(s => s?.archived === true)
      return {
        archived,
        cutoff: archived ? (states.find(s => s?.cutoff)?.cutoff ?? null) : null,
      }
    },
  })
}

/** Unarchiving changes what every list shows, so everything is refetched. */
export function useUnhideRecord() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (parts: readonly ArchivePart[]) => {
      for (const p of parts) await unhideRecord(p.entity, p.id)
    },
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
