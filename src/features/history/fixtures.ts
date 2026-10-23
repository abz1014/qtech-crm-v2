import type { HistoryEvent, HistoryPage } from '@/features/history/api'

/** Fictional history events for tests. */
let n = 0
export function ev(over: Partial<HistoryEvent> & Pick<HistoryEvent, 'at' | 'action'>): HistoryEvent {
  n += 1
  return { id: n, table: 'expenses', record_id: 'e1', by: 'u1', by_name: 'Ayesha', was: null, now: null, child_label: null, ...over }
}
export const page = (events: HistoryEvent[], refs: Record<string, string> = {}, has_more = false): HistoryPage => ({ events, refs, has_more })

export const CATEGORY_RENT = 'ca7e0000-0000-4000-8000-000000000002'
export const CATEGORY_FUEL = 'ca7e0000-0000-4000-8000-000000000004'
