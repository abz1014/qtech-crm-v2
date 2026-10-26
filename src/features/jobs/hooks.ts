import { useQuery } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/jobs/api'

/** The Jobs list: every job. `role` is in the key because an engineer's list is read by a different person with different rows. */
export const jobsListQuery = (role: string) => ({ queryKey: qk.jobs.list(role), queryFn: () => api.listJobs() })
export const jobQuery = (key: string) => ({ queryKey: qk.jobs.detail(key), queryFn: () => api.getJob(key) })
export const jobSearchQuery = (text: string) => ({ queryKey: qk.jobs.search(text), queryFn: ({ signal }: { signal: AbortSignal }) => api.findJobs(text, signal) })

export function useJobsList(role: string | null) {
  return useQuery({ ...jobsListQuery(role ?? ''), enabled: role !== null })
}

export function useJob(key: string | undefined) {
  return useQuery({ ...jobQuery(key ?? ''), enabled: Boolean(key) })
}

/** The typed words' jobs: the very function the command palette calls (api.findJobs). */
export function useJobSearch(text: string) {
  const t = text.trim()
  return useQuery({ ...jobSearchQuery(t), enabled: t !== '', staleTime: 15_000 })
}
