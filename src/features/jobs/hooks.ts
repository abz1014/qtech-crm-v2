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

/** The job page's first read: the view and the enquiry or order beside it, with the names, in one round. */
export const jobFactsQuery = (key: string) => ({ queryKey: qk.jobs.part(key, 'facts'), queryFn: () => api.getJobFacts(key) })

export function useJobFacts(key: string | undefined) {
  return useQuery({ ...jobFactsQuery(key ?? ''), enabled: Boolean(key) })
}

export const cancelledOrdersQuery = (key: string, rfqId: string) => ({ queryKey: [...qk.jobs.part(key, 'cancelled'), rfqId], queryFn: () => api.listCancelledOrders(rfqId) })
export function useCancelledOrders(key: string | undefined, rfqId: string | null | undefined, count: number) {
  return useQuery({ ...cancelledOrdersQuery(key ?? '', rfqId ?? ''), enabled: Boolean(key && rfqId) && count > 0 })
}

export const jobInvoicesQuery = (key: string, orderId: string) => ({ queryKey: [...qk.jobs.part(key, 'invoices'), orderId], queryFn: () => api.listJobInvoices(orderId) })
/** The job's invoices: admin and sales only, so an engineer's page never asks. */
export function useJobInvoices(key: string | undefined, orderId: string | null | undefined, enabled: boolean) {
  return useQuery({ ...jobInvoicesQuery(key ?? '', orderId ?? ''), enabled: enabled && Boolean(key && orderId) })
}
