import { quotationRef } from '@/features/quotations/lib/refs'
import { orderRef, poRef, rfqRef } from '@/lib/refs'
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
  const refs = await screenRefs(f.entity, rows)
  return rows.map(r => ({
    id: r.id,
    entity: r.entity,
    ref: refs.get(r.id) ?? r.ref,
    companyId: r.company_id,
    companyName: r.company_name,
    docDate: r.doc_date,
    amount: r.amount === null ? null : Number(r.amount),
    isImported: r.is_imported,
    isUnhidden: r.is_unhidden,
  }))
}

/** The earliest revision's issue date per chain (an RFQ's quotations, a leg's POs): the year in QT-YY-NNNN and PO-YY-NNNN. */
function firstIssued(rows: readonly { chain: string; revision: number; issuedOn: string }[]): Map<string, string> {
  const first = new Map<string, { revision: number; on: string }>()
  for (const r of rows) {
    const had = first.get(r.chain)
    if (!had || r.revision < had.revision) first.set(r.chain, { revision: r.revision, on: r.issuedOn })
  }
  return new Map([...first].map(([k, v]) => [k, v.on]))
}

/**
 * archive_list gives the bare number ("42", or "42/1" for a revision). Screens show the same reference as everywhere else: RFQ-0139,
 * ORD-0045, QTS-IFL-4810 or QT-26-0042 with " Rev 1" for a later revision, PO-26-0017. Quotations and POs need their code, revision and
 * first issue date, read here for this page of rows only. A row that cannot be matched keeps the database text.
 */
async function screenRefs(entity: ArchiveEntity, rows: readonly { id: string; ref: string | null }[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (entity === 'rfq' || entity === 'order') {
    const dress = entity === 'rfq' ? rfqRef : orderRef
    for (const r of rows) if (r.ref && /^\d+$/.test(r.ref)) out.set(r.id, dress(Number(r.ref)))
    return out
  }
  const ids = rows.map(r => r.id)
  if (ids.length === 0) return out
  const db = requireSupabase()
  if (entity === 'quotation') {
    const qs = unwrap(await db.from('quotations').select('id, number, revision, quote_code, issued_on, rfq_id').in('id', ids)) ?? []
    if (qs.length === 0) return out
    const chain = unwrap(await db.from('quotations').select('rfq_id, revision, issued_on').in('rfq_id', [...new Set(qs.map(q => q.rfq_id))])) ?? []
    const first = firstIssued(chain.map(c => ({ chain: c.rfq_id, revision: c.revision, issuedOn: c.issued_on })))
    for (const q of qs) out.set(q.id, quotationRef(q.number, first.get(q.rfq_id) ?? q.issued_on, q.revision, q.quote_code))
  } else if (entity === 'purchase_order') {
    const ps = unwrap(await db.from('purchase_orders').select('id, number, revision, issued_on, supplier_order_id').in('id', ids)) ?? []
    if (ps.length === 0) return out
    const legs = [...new Set(ps.map(p => p.supplier_order_id))]
    const chain = unwrap(await db.from('purchase_orders').select('supplier_order_id, revision, issued_on').in('supplier_order_id', legs)) ?? []
    const first = firstIssued(chain.map(c => ({ chain: c.supplier_order_id, revision: c.revision, issuedOn: c.issued_on })))
    for (const p of ps) out.set(p.id, `${poRef(p.number, first.get(p.supplier_order_id) ?? p.issued_on)}${p.revision > 0 ? ` Rev ${p.revision}` : ''}`)
  }
  return out
}

export async function unhideRecord(entity: string, id: string): Promise<void> {
  const { error } = await requireSupabase().rpc('archive_unhide', { p_entity: entity, p_id: id })
  if (error) throw error
}

export async function rehideRecord(entity: string, id: string): Promise<void> {
  const { error } = await requireSupabase().rpc('archive_rehide', { p_entity: entity, p_id: id })
  if (error) throw error
}
