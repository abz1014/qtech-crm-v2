import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import type { FloatItemPayload } from '@/features/rfqs/lib/intakeModel'
import type { SupplierItemMemoryRow, SupplierRecord } from '@/features/rfqs/lib/supplierSuggestion'

/*
 * RFQs: every database call for the intake screen (R05). This is the only file that names an RFQ table or
 * RPC for it. Access is Row Level Security's job (DATA_MODEL section 10): all three staff roles may read
 * these views and call these functions.
 */

/**
 * Everyone who can be asked for a price: the companies in v_supplier_stats (they have an inquiry, a supplier leg
 * or a carried brand), with the facts the suggestion reads. Two reads joined here, because a view cannot embed.
 */
export async function listSupplierCandidates(): Promise<SupplierRecord[]> {
  const db = requireSupabase()
  const [stats, companies] = await Promise.all([
    fetchAll((from, to) =>
      db
        .from('v_supplier_stats')
        .select('supplier_id, asked, replied, no_offer, median_reply_days, last_contact, brand_ids, brand_names')
        .range(from, to),
    ),
    fetchAll((from, to) => db.from('companies').select('id, name, country').order('name').range(from, to)),
  ])
  const byId = new Map(companies.map(c => [c.id, c]))
  const out: SupplierRecord[] = []
  for (const s of stats) {
    const c = s.supplier_id ? byId.get(s.supplier_id) : undefined
    if (!c || !s.supplier_id) continue
    out.push({
      id: c.id,
      name: c.name,
      // The screen shows a place beside the name; a company has a country, not a city, so that is what it shows.
      city: c.country,
      stats: {
        supplier_id: s.supplier_id,
        asked: s.asked,
        replied: s.replied,
        no_offer: s.no_offer,
        median_reply_days: s.median_reply_days,
        last_contact: s.last_contact,
        brand_ids: s.brand_ids,
        brand_names: s.brand_names,
      },
    })
  }
  return out
}

export interface MemoryQuery {
  key: string
  description: string
  brandId: string | null
  familyId: string | null
}

/**
 * supplier_item_memory() for each item against the same supplier list, in the caller's order (memory never
 * reorders). Keyed by the item's client key, the shape the suggestion function reads.
 */
export async function getSupplierMemory(
  items: readonly MemoryQuery[],
  supplierIds: readonly string[],
): Promise<Record<string, SupplierItemMemoryRow[]>> {
  const db = requireSupabase()
  if (supplierIds.length === 0) return {}
  const entries = await Promise.all(
    items.map(async it => {
      // The generated argument types do not admit NULL for the optional brand and family; the function does.
      const args = {
        p_supplier_ids: [...supplierIds],
        p_brand_id: it.brandId,
        p_family_id: it.familyId,
        p_description: it.description,
      } as unknown as { p_supplier_ids: string[]; p_brand_id: string; p_family_id: string; p_description: string }
      const rows = unwrap(await db.rpc('supplier_item_memory', args)) ?? []
      return [
        it.key,
        rows.map(r => ({
          supplier_id: r.supplier_id,
          best_tier: r.best_tier,
          supplied_before: r.supplied_before,
          last_ordered_on: r.last_ordered_on,
          last_po_on: r.last_po_on,
        })),
      ] as const
    }),
  )
  return Object.fromEntries(entries)
}

// ---------------------------------------------------------------- writes

export interface FloatInput {
  /** Client-generated: a second call with the same id changes nothing, so a double tap cannot duplicate. */
  id: string
  companyId: string
  siteId: string | null
  contactId: string | null
  customerRef: string
  dueOn: string | null
  isPriority: boolean
  items: FloatItemPayload[]
  supplierIds: string[]
  /** true: stamp the inquiries as sent today (Copy & mark floated). false: keep them shortlisted (Save without floating). */
  markSent: boolean
}

export interface SavedRfq {
  id: string
  number: number
}

/** float_rfq (atomic: RFQ, items, inquiries, stamp), then the number the database gave it. */
export async function floatRfq(input: FloatInput): Promise<SavedRfq> {
  const db = requireSupabase()
  const { error } = await db.rpc('float_rfq', {
    p_rfq_id: input.id,
    p_company_id: input.companyId,
    p_items: input.items as never,
    p_supplier_ids: input.supplierIds,
    p_site_id: input.siteId ?? undefined,
    p_contact_id: input.contactId ?? undefined,
    p_customer_ref: input.customerRef.trim() || undefined,
    p_due_on: input.dueOn ?? undefined,
    p_mark_sent: input.markSent,
    p_is_priority: input.isPriority,
  })
  if (error) throw error
  const row = unwrap(await db.from('rfqs').select('id, number').eq('id', input.id).single()) as { id: string; number: number } | null
  if (!row) throw new Error('The RFQ was saved but could not be read back.')
  return { id: row.id, number: row.number }
}

/** Undo (false) or float a saved RFQ now (true). Returns how many inquiries changed. */
export async function setRfqFloated(rfqId: string, floated: boolean): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('set_rfq_floated', { p_rfq_id: rfqId, p_floated: floated })
  if (error) throw error
  return data ?? 0
}

/** The RFQ a customer reference already belongs to, so a duplicate can offer "Open it". */
export async function findRfqByCustomerRef(companyId: string, customerRef: string): Promise<SavedRfq | null> {
  const db = requireSupabase()
  const rows = unwrap(
    await db.from('rfqs').select('id, number').eq('company_id', companyId).eq('customer_ref', customerRef.trim()).limit(1),
  )
  return rows[0] ? { id: rows[0].id, number: rows[0].number } : null
}
