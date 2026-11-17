import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { getArchiveState, unhideRecord, type ArchiveEntity } from '@/features/archive/api'

export function useArchiveState(entity: ArchiveEntity, id: string | null | undefined) {
  return useQuery({
    queryKey: qk.archive.state(entity, id ?? ''),
    queryFn: () => getArchiveState(entity, id as string),
    enabled: Boolean(id),
  })
}

/** Unarchiving changes what every list shows, so everything is refetched. */
export function useUnhideRecord() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ entity, id }: { entity: ArchiveEntity; id: string }) => unhideRecord(entity, id),
    onSuccess: () => queryClient.invalidateQueries(),
  })
}
