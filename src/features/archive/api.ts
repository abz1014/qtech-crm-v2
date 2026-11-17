import { requireSupabase, unwrap } from '@/lib/supabase'

/*
 * Archive, detail-page side (migration 0141). The only file here that names the RPCs and the table.
 * is_archived is false when archiving is off or the row is brought back, and NULL when the caller cannot see the row
 * (an engineer on an invoice, payment or expense): NULL is "not archived" here, so the banner stays out of the way.
 */
export type ArchiveEntity =
  | 'rfq' | 'order' | 'quotation' | 'purchase_order' | 'supplier_order' | 'invoice' | 'payment'
  | 'expense' | 'claim' | 'topup' | 'cash_count' | 'inquiry' | 'clarification'

export interface ArchiveState {
  archived: boolean
  /** The first date that stays visible (a row dated before it is archived); null when it was not read. */
  cutoff: string | null
}

export async function getArchiveState(entity: ArchiveEntity, id: string): Promise<ArchiveState> {
  const db = requireSupabase()
  const flag = await db.rpc('is_archived', { p_entity: entity, p_id: id })
  if (flag.error || flag.data !== true) return { archived: false, cutoff: null }
  const s = await db.from('archive_settings').select('cutoff').eq('id', 1).maybeSingle()
  return { archived: true, cutoff: s.error ? null : (s.data?.cutoff ?? null) }
}

/** Admin only: brings one archived record back into the lists. */
export async function unhideRecord(entity: ArchiveEntity, id: string): Promise<void> {
  unwrap(await requireSupabase().rpc('archive_unhide', { p_entity: entity, p_id: id }))
}
