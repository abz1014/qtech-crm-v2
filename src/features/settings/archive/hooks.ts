import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/settings/archive/api'

/* Settings > Archive hooks. After any change every list in the app reads itself again (an archived row leaves or joins every list). */

export function useArchiveSetting() {
  return useQuery({ queryKey: qk.settings.archiveSetting(), queryFn: () => api.getArchiveSetting() })
}

export function useArchivePreview(cutoff: string | null) {
  return useQuery({
    queryKey: qk.settings.archivePreview(cutoff ?? ''),
    queryFn: () => api.previewArchive(cutoff as string),
    enabled: Boolean(cutoff),
    placeholderData: keepPreviousData,
  })
}

export function useArchiveList(f: api.ListFilter) {
  return useQuery({
    queryKey: qk.settings.archiveList(f.entity, f.companyId ?? '', f.search, f.limit, f.offset),
    queryFn: () => api.listArchive(f),
    placeholderData: keepPreviousData,
  })
}

export function useSetArchive() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { enabled: boolean; cutoff: string }) => api.setArchive(v.enabled, v.cutoff),
    onSuccess: () => client.invalidateQueries(),
  })
}

export function useUnhide() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { entity: string; id: string }) => api.unhideRecord(v.entity, v.id),
    onSuccess: () => client.invalidateQueries(),
  })
}

export function useRehide() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (v: { entity: string; id: string }) => api.rehideRecord(v.entity, v.id),
    onSuccess: () => client.invalidateQueries(),
  })
}
