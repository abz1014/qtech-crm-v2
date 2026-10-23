import { useInfiniteQuery } from '@tanstack/react-query'
import { requireSupabase, unwrap } from '@/lib/supabase'
import { qk } from '@/features/queryKeys'

/*
 * Record history (0090): "was X, now Y, by whom, when" for one record. One RPC, `record_history`, which checks that the caller
 * can open the record and redacts the values for their role (an engineer never receives a money column). The key is
 * (table, id), so the Job page and every other screen can reuse the same cached read.
 */
export const HISTORY_TABLES = [
  'rfqs',
  'orders',
  'invoices',
  'payments_in',
  'expenses',
  'quotations',
  'purchase_orders',
  'companies',
  'contacts',
  'company_sites',
  'recurring_expenses',
] as const
export type HistoryTable = (typeof HISTORY_TABLES)[number]

export interface HistoryEvent {
  id: number | string
  /** ISO timestamp of the change. One transaction stamps all its rows with the same value. */
  at: string
  action: 'insert' | 'update' | 'delete' | string
  /** The table this event is about: the record's own, or a child's (an order line). */
  table: string
  record_id: string
  by: string | null
  by_name: string | null
  was: Record<string, unknown> | null
  now: Record<string, unknown> | null
  /** The name of a child line ("Valve DN50"); only on a child's event. */
  child_label: string | null
}

export interface HistoryPage {
  events: HistoryEvent[]
  /** uuid to name, for every id found in the values. */
  refs: Record<string, string>
  has_more: boolean
}

export const HISTORY_PAGE_SIZE = 30

export async function fetchRecordHistory(table: HistoryTable, id: string, before?: string | null, limit = HISTORY_PAGE_SIZE): Promise<HistoryPage> {
  const db = requireSupabase()
  const raw = unwrap(await db.rpc('record_history', { p_table: table, p_id: id, p_before: before ?? undefined, p_limit: limit })) as Partial<HistoryPage> | null
  return { events: raw?.events ?? [], refs: raw?.refs ?? {}, has_more: raw?.has_more ?? false }
}

/** The pages of one record's history, newest first. The next page is asked for with the last event's `at`. */
export function useRecordHistory(table: HistoryTable, id: string | null | undefined, enabled = true) {
  return useInfiniteQuery({
    queryKey: qk.history.record(table, id ?? ''),
    queryFn: ({ pageParam }) => fetchRecordHistory(table, id as string, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: last => (last.has_more && last.events.length > 0 ? last.events[last.events.length - 1].at : undefined),
    enabled: enabled && !!id,
    // a history is read when it is opened: never shown from before the last save
    staleTime: 0,
    gcTime: 60_000,
  })
}
