import { requireSupabase, unwrap } from '@/lib/supabase'

/*
 * Settings > Archive (0141): every server call for this screen, and the only file that names archive_settings or the archive_*
 * functions. All the functions are admin only: the database refuses anyone else (42501).
 */
export const ARCHIVE_ENTITIES = [
  'rfq',
  'order',
  'quotation',
  'purchase_order',
  'supplier_order',
  'invoice',
  'payment',
  'expense',
  'claim',
  'topup',
  'cash_count',
  'inquiry',
  'clarification',
] as const
export type ArchiveEntity = (typeof ARCHIVE_ENTITIES)[number]

export interface ArchiveSetting {
  enabled: boolean
  /** YYYY-MM-DD: a record dated before this is archived. */
  cutoff: string
}

export interface PreviewRow {
  entity: string
  wouldHide: number
  imported: number
  open: number
  openAmountPkr: number
  alreadyUnhidden: number
}

export interface ArchiveRow {
  id: string
  entity: string
  ref: string | null
  companyId: string | null
  companyName: string | null
  docDate: string | null
  amount: number | null
  isImported: boolean
  isUnhidden: boolean
}

export interface ListFilter {
  entity: ArchiveEntity
  companyId: string | null
  search: string
  limit: number
  offset: number
}

/** The one settings row (id = 1). Every role can read it. */
export async function getArchiveSetting(): Promise<ArchiveSetting | null> {
  const { data, error } = await requireSupabase().from('archive_settings').select('enabled,cutoff').eq('id', 1).maybeSingle()
  if (error) throw error
  return data ? { enabled: data.enabled, cutoff: data.cutoff } : null
}

export async function setArchive(enabled: boolean, cutoff: string): Promise<void> {
  const { error } = await requireSupabase().rpc('archive_set', { p_enabled: enabled, p_cutoff: cutoff })
  if (error) throw error
}

export async function previewArchive(cutoff: string): Promise<PreviewRow[]> {
  const rows = unwrap(await requireSupabase().rpc('archive_preview', { p_cutoff: cutoff })) ?? []
  return rows.map(r => ({
    entity: r.entity,
    wouldHide: Number(r.would_hide),
    imported: Number(r.of_which_imported),
    open: Number(r.of_which_open),
    openAmountPkr: Number(r.open_amount_pkr ?? 0),
    alreadyUnhidden: Number(r.already_unhidden),
  }))
}

export async function listArchive(f: ListFilter): Promise<ArchiveRow[]> {
  const search = f.search.trim()
  const rows =
    unwrap(
      await requireSupabase().rpc('archive_list', {
        p_entity: f.entity,
        p_company_id: f.companyId ?? undefined,
        p_search: search === '' ? undefined : search,
        p_limit: f.limit,
        p_offset: f.offset,
      }),
    ) ?? []
  return rows.map(r => ({
    id: r.id,
    entity: r.entity,
    ref: r.ref,
    companyId: r.company_id,
    companyName: r.company_name,
    docDate: r.doc_date,
    amount: r.amount === null ? null : Number(r.amount),
    isImported: r.is_imported,
    isUnhidden: r.is_unhidden,
  }))
}

export async function unhideRecord(entity: string, id: string): Promise<void> {
  const { error } = await requireSupabase().rpc('archive_unhide', { p_entity: entity, p_id: id })
  if (error) throw error
}

export async function rehideRecord(entity: string, id: string): Promise<void> {
  const { error } = await requireSupabase().rpc('archive_rehide', { p_entity: entity, p_id: id })
  if (error) throw error
}
