import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import type { ViewRow } from '@/features/dbTypes'
import type { FloatItemPayload } from '@/features/rfqs/lib/intakeModel'
import type { EvidenceFeedRow } from '@/features/rfqs/lib/ranking/reasons'
import type { AskOutcome, CategoryEvidenceRow, CategoryOption, PriceWinsRow, SupplierItemMemoryRow, SupplierRecord, SupplierStatsRow } from '@/features/rfqs/lib/supplierSuggestion'

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
    // Every column the memory card quotes comes from this one read, so opening a card asks for nothing more.
    fetchAll((from, to) => db.from('v_supplier_stats').select('*').range(from, to)),
    fetchAll((from, to) => db.from('companies').select('id, name, country, city').order('name').range(from, to)),
  ])
  const byId = new Map(companies.map(c => [c.id, c]))
  const out: SupplierRecord[] = []
  for (const s of stats) {
    const c = s.supplier_id ? byId.get(s.supplier_id) : undefined
    if (!c || !s.supplier_id) continue
    out.push({
      id: c.id,
      name: c.name,
      // The place beside the name: the city when one is on file (0038), the country until then.
      city: c.city ?? c.country,
      stats: { ...s, supplier_id: s.supplier_id },
    })
  }
  return out
}

/** The curated product categories (0093: brands of kind family with curated = true), by name. */
export async function listCuratedCategories(): Promise<CategoryOption[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('brands').select('id, name').eq('kind', 'family').eq('curated', true).order('name')) ?? []
  return rows.map(r => ({ id: r.id, name: r.name }))
}

/** v_supplier_category_evidence for these categories (counts only: every role reads the same). */
export async function getCategoryEvidence(familyIds: readonly string[], supplierIds: readonly string[]): Promise<CategoryEvidenceRow[]> {
  if (familyIds.length === 0 || supplierIds.length === 0) return []
  const db = requireSupabase()
  const rows = await fetchAll((from, to) => db.from('v_supplier_category_evidence').select('*').in('family_id', [...familyIds]).range(from, to))
  const keep = new Set(supplierIds)
  const out: CategoryEvidenceRow[] = []
  for (const r of rows) {
    if (!r.supplier_id || !r.family_id || !keep.has(r.supplier_id)) continue
    out.push({ supplier_id: r.supplier_id, family_id: r.family_id, asked: r.asked ?? 0, replied: r.replied ?? 0, quoted: r.quoted ?? 0, no_offer: r.no_offer ?? 0, ordered: r.ordered ?? 0, last_asked_on: r.last_asked_on })
  }
  return out
}

/** supplier_category_price_wins (0093). Admin and sales only: the caller never asks for an engineer, and the database returns NULL counts to one. */
export async function getCategoryPriceWins(familyIds: readonly string[]): Promise<PriceWinsRow[]> {
  if (familyIds.length === 0) return []
  const rows = unwrap(await requireSupabase().rpc('supplier_category_price_wins', { p_family_ids: [...familyIds] })) ?? []
  return rows.map(r => ({ supplier_id: r.supplier_id, family_id: r.family_id, wins: r.wins, of_ranked: r.of_ranked }))
}

/**
 * How each supplier's last asks ended, newest first, three at most: the demotion rule reads "no offer on 2 of the last 3".
 * The last year of sent inquiries is read; a no offer is an inquiry marked so (no_offer_on).
 */
export async function getRecentAsks(supplierIds: readonly string[], today: string): Promise<Record<string, AskOutcome[]>> {
  const out: Record<string, AskOutcome[]> = {}
  if (supplierIds.length === 0) return out
  const db = requireSupabase()
  const since = new Date(new Date(`${today}T00:00:00Z`).getTime() - 365 * 86_400_000).toISOString().slice(0, 10)
  for (let i = 0; i < supplierIds.length; i += 50) {
    const chunk = supplierIds.slice(i, i + 50)
    const rows = await fetchAll((from, to) =>
      db.from('supplier_inquiries').select('supplier_id, sent_on, no_offer_on, created_at').in('supplier_id', chunk).not('sent_on', 'is', null).gte('sent_on', since).order('sent_on', { ascending: false }).order('created_at', { ascending: false }).range(from, to),
    )
    for (const r of rows) {
      const list = (out[r.supplier_id] ??= [])
      if (list.length < 3) list.push(r.no_offer_on ? 'no_offer' : 'other')
    }
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
 * reorders). One call per DISTINCT item (the function takes the whole supplier list at once), all in flight together;
 * two items with the same description, brand and family share a call. Keyed by the item's client key.
 * `excludeRfqId` leaves out the RFQ being worked on (and the orders made from it), so it does not remember itself.
 */
export async function getSupplierMemory(
  items: readonly MemoryQuery[],
  supplierIds: readonly string[],
  excludeRfqId?: string,
): Promise<Record<string, SupplierItemMemoryRow[]>> {
  const db = requireSupabase()
  if (supplierIds.length === 0) return {}
  const sig = (it: MemoryQuery) => JSON.stringify([it.description.trim(), it.brandId, it.familyId])
  const distinct = new Map<string, MemoryQuery>()
  for (const it of items) if (!distinct.has(sig(it))) distinct.set(sig(it), it)
  const bySig = new Map<string, SupplierItemMemoryRow[]>()
  await Promise.all(
    [...distinct.entries()].map(async ([key, it]) => {
      // The generated argument types do not admit NULL for the optional ids; the function does.
      const args = {
        p_supplier_ids: [...supplierIds],
        p_brand_id: it.brandId,
        p_family_id: it.familyId,
        p_description: it.description,
        p_exclude_rfq_id: excludeRfqId ?? null,
      } as unknown as { p_supplier_ids: string[]; p_brand_id: string; p_family_id: string; p_description: string }
      const rows = unwrap(await db.rpc('supplier_item_memory', args)) ?? []
      bySig.set(key, rows as unknown as SupplierItemMemoryRow[])
    }),
  )
  return Object.fromEntries(items.map(it => [it.key, bySig.get(sig(it)) ?? []]))
}

/**
 * supplier_item_evidence(): up to three recent orders of one supplier at the best tier for the item (the memory card's evidence
 * block, g2-ranking-split.html). Opened on demand, one supplier and one item at a time.
 */
export async function getSupplierEvidence(item: Omit<MemoryQuery, 'key'>, supplierId: string, excludeRfqId?: string): Promise<EvidenceFeedRow[]> {
  const db = requireSupabase()
  // The generated argument types do not admit NULL for the optional ids; the function does.
  const args = {
    p_supplier_ids: [supplierId],
    p_brand_id: item.brandId,
    p_family_id: item.familyId,
    p_description: item.description,
    p_exclude_rfq_id: excludeRfqId ?? null,
    p_limit: 3,
  } as unknown as { p_supplier_ids: string[]; p_brand_id: string; p_family_id: string; p_description: string }
  return (unwrap(await db.rpc('supplier_item_evidence', args)) ?? []) as unknown as EvidenceFeedRow[]
}

// ---------------------------------------------------------------- writes

export interface FloatInput {
  /** Client-generated: a second call with the same id changes nothing, so a double tap cannot duplicate. */
  id: string
  companyId: string
  siteId?: string | null
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
  /**
   * false when an RFQ with this id already existed (0070): a New RFQ draft that was already saved (another tab, an earlier save whose
   * reply was lost). Nothing was written; the screen says "Already saved as RFQ-…". Absent on reads that are not a save.
   */
  created?: boolean
}

/** float_rfq (atomic: RFQ, items, inquiries, stamp), then the number the database gave it, and whether this call created it. */
export async function floatRfq(input: FloatInput): Promise<SavedRfq> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('float_rfq', {
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
  const created = (data as { created?: boolean } | null)?.created !== false
  const row = unwrap(await db.from('rfqs').select('id, number').eq('id', input.id).single()) as { id: string; number: number } | null
  if (!row) throw new Error('The RFQ was saved but could not be read back.')
  return { id: row.id, number: row.number, created }
}

/** The RFQ saved under this id, when there is one: a New RFQ draft whose RFQ was already saved is offered "Open it" instead. */
export async function findRfqById(id: string): Promise<SavedRfq | null> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('rfqs').select('id, number').eq('id', id).limit(1))
  return rows[0] ? { id: rows[0].id, number: rows[0].number } : null
}

/** Which of these companies, sites and contacts are still on file (a restored draft may name one that was merged or removed). */
export async function stillOnFile(input: { companyId: string | null; siteId: string | null; contactId: string | null }): Promise<{ company: boolean; site: boolean; contact: boolean }> {
  const db = requireSupabase()
  const [c, s, k] = await Promise.all([
    input.companyId ? db.from('companies').select('id').eq('id', input.companyId).limit(1) : Promise.resolve({ data: [], error: null }),
    input.siteId ? db.from('company_sites').select('id').eq('id', input.siteId).limit(1) : Promise.resolve({ data: [], error: null }),
    input.contactId ? db.from('contacts').select('id').eq('id', input.contactId).limit(1) : Promise.resolve({ data: [], error: null }),
  ])
  const has = (r: { data: unknown[] | null; error: unknown }) => (unwrap(r as never) as unknown[] | null)?.length === 1
  return { company: !input.companyId || has(c), site: !input.siteId || has(s), contact: !input.contactId || has(k) }
}

/** Undo (false) or float a saved RFQ now (true). Returns how many inquiries changed. */
export async function setRfqFloated(rfqId: string, floated: boolean): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('set_rfq_floated', { p_rfq_id: rfqId, p_floated: floated })
  if (error) throw error
  return data ?? 0
}

/**
 * Ask one more supplier on a saved RFQ and mark it sent on `today` (the "Float item 4 to them" link). An inquiry is per
 * supplier, so a supplier already shortlisted is stamped, and a new one is added already sent.
 */
export async function floatToSupplier(rfqId: string, supplierId: string, today: string): Promise<void> {
  const db = requireSupabase()
  unwrap(
    await db
      .from('supplier_inquiries')
      .upsert({ rfq_id: rfqId, supplier_id: supplierId, sent_on: today }, { onConflict: 'rfq_id,supplier_id' })
      .select('id'),
  )
}

/** The RFQ a customer reference already belongs to, so a duplicate can offer "Open it". */
export async function findRfqByCustomerRef(companyId: string, customerRef: string): Promise<SavedRfq | null> {
  const db = requireSupabase()
  const rows = unwrap(
    await db.from('rfqs').select('id, number').eq('company_id', companyId).eq('customer_ref', customerRef.trim()).limit(1),
  )
  return rows[0] ? { id: rows[0].id, number: rows[0].number } : null
}

// ================================================================ RFQ detail (R07)

export type RfqStateRow = ViewRow<'v_rfq_state'>
export type InquiryStateRow = ViewRow<'v_inquiry_state'>

export interface RfqHeader {
  id: string
  number: number
  customerRef: string | null
  receivedOn: string
  dueOn: string | null
  /** The bid deadline's time (HH:MM), when one was given. */
  dueTime?: string | null
  isPriority: boolean
  /** Who entered it (rfqs.created_by); the whose-is-it rule of 0092 reads this and owner. */
  createdBy?: string | null
  quotedOn: string | null
  closedOn: string | null
  closeReason: string | null
  closeNote: string | null
  notes: string | null
  company: { id: string; name: string; country: string | null; city?: string | null; createdAt: string | null }
  site: { name: string; address: string | null } | null
  siteId?: string | null
  contactId: string | null
  contact: { name: string; phone: string | null; email?: string | null; jobTitle?: string | null } | null
  owner: { id: string; name: string; role: string; phone?: string | null } | null
  state: RfqStateRow | null
}

/**
 * The RFQ, who it is for, who owns it and its derived states (v_rfq_state). Null when there is no such RFQ.
 * ONE round: the customer, site, contact and owner come embedded in the RFQ's own read, in parallel with the state view (PERF-1,
 * the order page's fix/order-lcp pattern: the customer's name is the page's largest text, and a second round trip on slow mobile
 * data held it back). Row Level Security applies to an embedded row as to its own read: one the person may not see comes back null.
 */
export async function getRfqHeader(id: string): Promise<RfqHeader | null> {
  const db = requireSupabase()
  const [rfqRes, stateRes] = await Promise.all([
    db
      .from('rfqs')
      .select('id, number, company_id, site_id, contact_id, customer_ref, received_on, due_on, due_time, owner_id, created_by, is_priority, quoted_on, closed_on, close_reason, close_note, notes, company:companies!rfqs_company_id_fkey(id, name, country, city, created_at), site:company_sites!rfqs_site_id_fkey(name, address), contact:contacts!rfqs_contact_id_fkey(name, phone, email, job_title), owner:users!rfqs_owner_id_fkey(id, name, role, phone)')
      .eq('id', id)
      .maybeSingle(),
    db.from('v_rfq_state').select('*').eq('rfq_id', id).maybeSingle(),
  ])
  const r = unwrap(rfqRes)
  if (!r) return null
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
  const c = one(r.company)
  const ct0 = r.contact_id ? one(r.contact) : null
  const site = r.site_id ? one(r.site) : null
  const owner = r.owner_id ? one(r.owner) : null
  return {
    id: r.id,
    number: r.number,
    customerRef: r.customer_ref,
    receivedOn: r.received_on,
    dueOn: r.due_on,
    dueTime: r.due_time ? r.due_time.slice(0, 5) : null,
    isPriority: r.is_priority,
    createdBy: r.created_by,
    quotedOn: r.quoted_on,
    closedOn: r.closed_on,
    closeReason: r.close_reason,
    closeNote: r.close_note,
    notes: r.notes,
    company: { id: r.company_id, name: c?.name ?? 'Unknown company', country: c?.country ?? null, city: c?.city ?? null, createdAt: c?.created_at ?? null },
    siteId: r.site_id,
    contactId: r.contact_id,
    site,
    contact: ct0 ? { name: ct0.name, phone: ct0.phone, email: ct0.email, jobTitle: ct0.job_title } : null,
    owner,
    state: unwrap(stateRes) as RfqStateRow | null,
  }
}

export interface RfqItemRow {
  id: string
  /** 1-based number on the RFQ (by position). */
  number: number
  description: string
  brandId: string | null
  brandName: string | null
  familyId: string | null
  /** The family brand's name (a brands row of kind family), for the item's meta line. */
  familyName?: string | null
  qty: number
  unit: string | null
}

export async function listRfqItems(rfqId: string): Promise<RfqItemRow[]> {
  const db = requireSupabase()
  const rows = unwrap(
    await db.from('rfq_items').select('id, position, description, brand_id, family_id, qty, unit, created_at').eq('rfq_id', rfqId).order('position').order('created_at'),
  )
  const brandIds = [...new Set(rows.flatMap(r => [r.brand_id, r.family_id]).filter((b): b is string => Boolean(b)))]
  const brands = brandIds.length ? unwrap(await db.from('brands').select('id, name').in('id', brandIds)) : []
  const names = new Map(brands.map(b => [b.id, b.name]))
  return rows.map((r, i) => ({
    id: r.id,
    number: i + 1,
    description: r.description,
    brandId: r.brand_id,
    brandName: r.brand_id ? (names.get(r.brand_id) ?? null) : null,
    familyId: r.family_id,
    familyName: r.family_id ? (names.get(r.family_id) ?? null) : null,
    qty: Number(r.qty),
    unit: r.unit,
  }))
}

export interface QuoteLineRow {
  id: string
  inquiryId: string
  itemId: string
  /** The supplier's price. 0 when read without prices (an engineer: owner decision 2026-10-22); never shown then. */
  unitPrice: number
  currency: string
  leadTime: string | null
  inStock: boolean | null
  fxRatePkr: number | null
  fxRateOn: string | null
}

export interface InquiryRow {
  id: string
  supplierId: string
  supplierName: string
  supplierCountry: string | null
  /** The supplier's city (companies.city), shown under its name beside the country. */
  supplierCity?: string | null
  sentOn: string | null
  /** 0097: when a person said "Yes, sent". sentOn alone only means the message was copied ("Asked"). */
  sentConfirmedAt?: string | null
  lastChasedOn: string | null
  /** users.id of whoever made the last chase (0048). */
  lastChasedBy?: string | null
  lastRelayedAt: string | null
  noOfferOn: string | null
  /** Why the supplier cannot quote (a stored key, see lib/cantQuote.ts); set together with noOfferOn. */
  noOfferReason: string | null
  /** A different reason for one item, by item id. */
  itemDeclines: Record<string, string>
  chaseCount: number
  notes: string | null
  contactName: string | null
  contactPhone: string | null
  contactEmail?: string | null
  contactTitle?: string | null
  /** The currency of this supplier's most recent quote line on any RFQ, else of its latest procurement leg, or null. */
  lastCurrency: string | null
  /** v_inquiry_state values. */
  responseState: string | null
  contactState: string | null
  itemsQuoted: number
  /** The day the first price arrived (v_inquiry_state.quote_received_on). */
  quoteReceivedOn?: string | null
  lines: QuoteLineRow[]
}

/** Quote line columns with prices (admin and sales) and without (an engineer never fetches a price: owner decision 2026-10-22). */
const QUOTE_LINE_COLS = 'id, inquiry_id, rfq_item_id, unit_price, currency, lead_time, in_stock, fx_rate_pkr, fx_rate_on'
const QUOTE_LINE_COLS_NO_PRICES = 'id, inquiry_id, rfq_item_id, currency, lead_time, in_stock'

/**
 * One row per supplier asked, with their quote lines, contact and last currency. `prices` false (an engineer) leaves the price
 * and the exchange rate out of the request: the line says who quoted which item, with lead time and stock only.
 */
export async function listInquiries(rfqId: string, prices = true): Promise<InquiryRow[]> {
  const db = requireSupabase()
  const inq = unwrap(
    await db
      .from('supplier_inquiries')
      .select('id, supplier_id, sent_on, sent_confirmed_at, last_chased_on, last_chased_by, last_relayed_at, no_offer_on, no_offer_reason, chase_count, notes, created_at')
      .eq('rfq_id', rfqId)
      .order('created_at'),
  )
  if (inq.length === 0) return []
  const supplierIds = [...new Set(inq.map(i => i.supplier_id))]
  const inquiryIds = inq.map(i => i.id)
  const [companies, states, contacts, lines, recent, declines, legs] = await Promise.all([
    db.from('companies').select('id, name, country, city').in('id', supplierIds),
    db.from('v_inquiry_state').select('inquiry_id, response_state, contact_state, items_quoted, quote_received_on').eq('rfq_id', rfqId),
    db.from('contacts').select('company_id, name, phone, email, job_title, created_at').in('company_id', supplierIds).order('created_at'),
    db
      .from('supplier_quote_lines')
      .select(prices ? QUOTE_LINE_COLS : QUOTE_LINE_COLS_NO_PRICES)
      .in('inquiry_id', inquiryIds),
    db
      .from('supplier_quote_lines')
      .select('currency, created_at, supplier_inquiries!inner(supplier_id)')
      .in('supplier_inquiries.supplier_id', supplierIds)
      .order('created_at', { ascending: false })
      .limit(500),
    db.from('inquiry_item_declines').select('inquiry_id, rfq_item_id, reason').in('inquiry_id', inquiryIds),
    // A supplier with no earlier reply but a procurement leg (A2b) is pre-filled with the leg's currency, not PKR.
    db
      .from('supplier_orders')
      .select('supplier_id, currency')
      .in('supplier_id', supplierIds)
      .not('currency', 'is', null)
      .order('created_at', { ascending: false })
      .limit(200),
  ])
  const declinesBy = new Map<string, Record<string, string>>()
  for (const d of unwrap(declines)) declinesBy.set(d.inquiry_id, { ...(declinesBy.get(d.inquiry_id) ?? {}), [d.rfq_item_id]: d.reason })
  const byCompany = new Map(unwrap(companies).map(c => [c.id, c]))
  const stateBy = new Map(unwrap(states).map(s => [s.inquiry_id, s]))
  const contactBy = new Map<string, { name: string; phone: string | null; email: string | null; title: string | null }>()
  for (const c of unwrap(contacts)) if (!contactBy.has(c.company_id)) contactBy.set(c.company_id, { name: c.name, phone: c.phone, email: c.email, title: c.job_title })
  const lastCurrency = new Map<string, string>()
  type Recent = { currency: string; supplier_inquiries: { supplier_id: string } | { supplier_id: string }[] }
  for (const r of unwrap(recent) as unknown as Recent[]) {
    const si = Array.isArray(r.supplier_inquiries) ? r.supplier_inquiries[0] : r.supplier_inquiries
    if (si && !lastCurrency.has(si.supplier_id)) lastCurrency.set(si.supplier_id, r.currency.trim())
  }
  for (const l of unwrap(legs)) if (l.currency && !lastCurrency.has(l.supplier_id)) lastCurrency.set(l.supplier_id, l.currency.trim())
  const linesBy = new Map<string, QuoteLineRow[]>()
  type DbLine = { id: string; inquiry_id: string; rfq_item_id: string; unit_price?: number; currency: string; lead_time: string | null; in_stock: boolean | null; fx_rate_pkr?: number | null; fx_rate_on?: string | null }
  for (const l of unwrap(lines) as unknown as DbLine[]) {
    const row: QuoteLineRow = {
      id: l.id,
      inquiryId: l.inquiry_id,
      itemId: l.rfq_item_id,
      unitPrice: l.unit_price === undefined ? 0 : Number(l.unit_price),
      currency: l.currency.trim(),
      leadTime: l.lead_time,
      inStock: l.in_stock,
      fxRatePkr: l.fx_rate_pkr === null || l.fx_rate_pkr === undefined ? null : Number(l.fx_rate_pkr),
      fxRateOn: l.fx_rate_on ?? null,
    }
    linesBy.set(l.inquiry_id, [...(linesBy.get(l.inquiry_id) ?? []), row])
  }
  return inq.map(i => {
    const c = byCompany.get(i.supplier_id)
    const s = stateBy.get(i.id)
    const ct = contactBy.get(i.supplier_id)
    return {
      id: i.id,
      supplierId: i.supplier_id,
      supplierName: c?.name ?? 'Unknown supplier',
      supplierCountry: c?.country ?? null,
      supplierCity: c?.city ?? null,
      sentOn: i.sent_on,
      sentConfirmedAt: i.sent_confirmed_at,
      lastChasedOn: i.last_chased_on,
      lastChasedBy: i.last_chased_by,
      lastRelayedAt: i.last_relayed_at,
      noOfferOn: i.no_offer_on,
      noOfferReason: i.no_offer_reason,
      itemDeclines: declinesBy.get(i.id) ?? {},
      chaseCount: i.chase_count,
      notes: i.notes,
      contactName: ct?.name ?? null,
      contactPhone: ct?.phone ?? null,
      contactEmail: ct?.email ?? null,
      contactTitle: ct?.title ?? null,
      lastCurrency: lastCurrency.get(i.supplier_id) ?? null,
      responseState: s?.response_state ?? null,
      contactState: s?.contact_state ?? null,
      itemsQuoted: s?.items_quoted ?? 0,
      quoteReceivedOn: s?.quote_received_on ?? null,
      lines: linesBy.get(i.id) ?? [],
    }
  })
}

export interface FxLatestRow {
  currency: string
  ratePkr: number
  asOf: string
  source: string
  ageDays: number
  staleness: 'fresh' | 'stale' | 'unusable'
}

/** Today's rate per currency (manual beats auto on the same day). */
export async function listFxLatest(): Promise<FxLatestRow[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('v_fx_latest').select('currency, rate_pkr, as_of, source, age_days, staleness'))
  return rows
    .filter(r => r.currency && r.rate_pkr !== null && r.as_of)
    .map(r => ({
      currency: (r.currency as string).trim(),
      ratePkr: Number(r.rate_pkr),
      asOf: r.as_of as string,
      source: r.source ?? 'manual',
      ageDays: Number(r.age_days ?? 0),
      staleness: (r.staleness ?? 'unusable') as FxLatestRow['staleness'],
    }))
}

// ---------------------------------------------------------------- RFQ detail writes

export interface SaveReplyInput {
  inquiryId: string
  currency: string
  leadTime: string | null
  inStock: boolean | null
  /** Items with a price now. Existing lines for these items are updated in place. */
  prices: Array<{ itemId: string; unitPrice: number }>
  /** Items whose line goes: the price was cleared, or the currency changed (the line is then re-entered at today's rate). */
  removeItemIds: string[]
}

/** Save one supplier's reply: the removals, then every price typed in one upsert. */
export async function saveReply(input: SaveReplyInput): Promise<number> {
  const db = requireSupabase()
  if (input.removeItemIds.length > 0) {
    const { error } = await db.from('supplier_quote_lines').delete().eq('inquiry_id', input.inquiryId).in('rfq_item_id', input.removeItemIds)
    if (error) throw error
  }
  if (input.prices.length === 0) return 0
  const { error } = await db.from('supplier_quote_lines').upsert(
    input.prices.map(p => ({
      inquiry_id: input.inquiryId,
      rfq_item_id: p.itemId,
      unit_price: p.unitPrice,
      currency: input.currency,
      lead_time: input.leadTime,
      in_stock: input.inStock,
    })),
    { onConflict: 'inquiry_id,rfq_item_id' },
  )
  if (error) throw error
  return input.prices.length
}

/** Marks the inquiry "can't quote" (the day and the reason key go together), or takes it back (both null). The notes are never touched. */
export async function setInquiryNoOffer(input: { inquiryId: string; noOfferOn: string | null; reason: string | null }): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('supplier_inquiries').update({ no_offer_on: input.noOfferOn, no_offer_reason: input.reason }).eq('id', input.inquiryId)
  if (error) throw error
}

/** A different reason for one item of an inquiry (a stored key), or none (null) to take it back. */
export async function setItemDecline(input: { inquiryId: string; itemId: string; reason: string | null }): Promise<void> {
  const db = requireSupabase()
  if (input.reason === null) {
    const { error } = await db.from('inquiry_item_declines').delete().eq('inquiry_id', input.inquiryId).eq('rfq_item_id', input.itemId)
    if (error) throw error
    return
  }
  const { error } = await db
    .from('inquiry_item_declines')
    .upsert({ inquiry_id: input.inquiryId, rfq_item_id: input.itemId, reason: input.reason }, { onConflict: 'inquiry_id,rfq_item_id' })
  if (error) throw error
}

/** stamp_supplier_chase: last_chased_on = today, chase_count + 1. Returns the new count. */
export async function stampSupplierChase(inquiryId: string): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('stamp_supplier_chase', { p_inquiry_id: inquiryId })
  if (error) throw error
  return data ?? 0
}

/** Mark bid sent (quoted_on = the given day) or take it back (null). */
export async function setBidSent(rfqId: string, on: string | null): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('rfqs').update({ quoted_on: on }).eq('id', rfqId)
  if (error) throw error
}

/** Close or lose: closed_on and the reason go together (the table checks it). All null re-opens. */
export async function setRfqClosed(input: { rfqId: string; closedOn: string | null; reason: string | null; note: string | null }): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('rfqs').update({ closed_on: input.closedOn, close_reason: input.reason, close_note: input.note }).eq('id', input.rfqId)
  if (error) throw error
}

// ================================================================ Clarifications and files (R09, R10)

export interface AttachmentRow {
  id: string
  path: string
  fileName: string
  mimeType: string
  sizeBytes: number
  clarificationId: string | null
  createdAt: string
  /** 0100: the file shows a price (a customer PO, a supplier quote, an enquiry with prices). An engineer reads no such file. */
  hasPrices: boolean
}

export interface ClarificationRow {
  id: string
  question: string
  raisedByInquiryId: string | null
  /** The item the question is about (clarifications.rfq_item_id), if tagged. */
  rfqItemId: string | null
  firstAskedAt: string | null
  lastAskedAt: string | null
  /** users.id of whoever last asked the customer (0048). */
  lastAskedBy?: string | null
  askCount: number
  answer: string | null
  answeredAt: string | null
  withdrawnAt: string | null
  createdAt: string
}

const FILE_BUCKET = 'rfq-files'

/** Every question on the RFQ, withdrawn ones too (the panel keeps them in a closed list). */
export async function listClarifications(rfqId: string): Promise<ClarificationRow[]> {
  const db = requireSupabase()
  const rows = unwrap(
    await db
      .from('clarifications')
      .select('id, question, raised_by_inquiry_id, rfq_item_id, first_asked_at, last_asked_at, last_asked_by, ask_count, answer, answered_at, withdrawn_at, created_at')
      .eq('rfq_id', rfqId)
      .order('created_at')
      .order('id'),
  )
  return rows.map(r => ({
    id: r.id,
    question: r.question,
    raisedByInquiryId: r.raised_by_inquiry_id,
    rfqItemId: r.rfq_item_id,
    firstAskedAt: r.first_asked_at,
    lastAskedAt: r.last_asked_at,
    lastAskedBy: r.last_asked_by,
    askCount: r.ask_count,
    answer: r.answer,
    answeredAt: r.answered_at,
    withdrawnAt: r.withdrawn_at,
    createdAt: r.created_at,
  }))
}

/** Files on an order (R22, migration 0042): same bucket and columns, the parent is order_id. */
export async function listOrderAttachments(orderId: string): Promise<AttachmentRow[]> {
  const db = requireSupabase()
  const rows = unwrap(
    await db.from('attachments').select('id, path, file_name, mime_type, size_bytes, clarification_id, created_at, has_prices').eq('order_id', orderId).eq('bucket', FILE_BUCKET).order('created_at'),
  )
  return rows.map(r => ({
    id: r.id,
    path: r.path,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    clarificationId: r.clarification_id,
    createdAt: r.created_at,
    hasPrices: r.has_prices,
  }))
}

export async function listAttachments(rfqId: string): Promise<AttachmentRow[]> {
  const db = requireSupabase()
  const rows = unwrap(
    await db.from('attachments').select('id, path, file_name, mime_type, size_bytes, clarification_id, created_at, has_prices').eq('rfq_id', rfqId).eq('bucket', FILE_BUCKET).order('created_at'),
  )
  return rows.map(r => ({
    id: r.id,
    path: r.path,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    clarificationId: r.clarification_id,
    createdAt: r.created_at,
    hasPrices: r.has_prices,
  }))
}

export interface NewQuestion {
  /** Client-generated, so a retry or a double tap cannot add the same question twice. */
  id: string
  question: string
  inquiryId: string | null
}

export async function addClarifications(rfqId: string, questions: readonly NewQuestion[]): Promise<number> {
  const db = requireSupabase()
  if (questions.length === 0) return 0
  // One statement gives every row the same created_at; stagger it by a millisecond so the pasted order is the shown order.
  const base = Date.now()
  const { error } = await db
    .from('clarifications')
    .upsert(
      questions.map((q, i) => ({ id: q.id, rfq_id: rfqId, question: q.question, raised_by_inquiry_id: q.inquiryId, created_at: new Date(base + i).toISOString() })),
      { onConflict: 'id', ignoreDuplicates: true },
    )
  if (error) throw error
  return questions.length
}

/** stamp_clarification_ask: first_asked_at if empty, last_asked_at = now, ask_count + 1, for the open questions in the set. */
export async function stampClarificationAsk(ids: readonly string[]): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('stamp_clarification_ask', { p_clarification_ids: [...ids] })
  if (error) throw error
  return data ?? 0
}

export interface ClarificationAskBefore {
  id: string
  firstAskedAt: string | null
  lastAskedAt: string | null
  lastAskedBy?: string | null
  askCount: number
}

/** Take an ask back: put each question's asked fields back to what they were before the stamp (the Undo of "Copy questions"). */
export async function restoreClarificationAsk(before: readonly ClarificationAskBefore[]): Promise<void> {
  const db = requireSupabase()
  for (const b of before) {
    const { error } = await db.from('clarifications').update({ first_asked_at: b.firstAskedAt, last_asked_at: b.lastAskedAt, last_asked_by: b.lastAskedBy ?? null, ask_count: b.askCount }).eq('id', b.id)
    if (error) throw error
  }
}

/** Take a supplier chase back (the Undo of "Copy & mark chased"). */
export async function restoreSupplierChase(inquiryId: string, before: { lastChasedOn: string | null; lastChasedBy?: string | null; chaseCount: number }): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('supplier_inquiries').update({ last_chased_on: before.lastChasedOn, last_chased_by: before.lastChasedBy ?? null, chase_count: before.chaseCount }).eq('id', inquiryId)
  if (error) throw error
}

/** An answer: text, or none (a photo answers alone), stamped now. All null takes the answer back. */
export async function setClarificationAnswer(input: { id: string; answer: string | null; answeredAt: string | null }): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('clarifications').update({ answer: input.answer, answered_at: input.answeredAt }).eq('id', input.id)
  if (error) throw error
}

/** Withdraw (a time) or put back (null). */
export async function setClarificationWithdrawn(id: string, at: string | null): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('clarifications').update({ withdrawn_at: at }).eq('id', id)
  if (error) throw error
}

/** "Copy answers for supplier X": last_relayed_at on the inquiry. A previous value (or null) puts it back for Undo. */
export async function setInquiryRelayed(inquiryId: string, at: string | null): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('supplier_inquiries').update({ last_relayed_at: at }).eq('id', inquiryId)
  if (error) throw error
}

/**
 * Upload one file to rfq-files at {rfq_id}/{uuid}.{ext} and record it. The object goes first; if the row cannot be
 * written the object is removed again, so nothing is left behind.
 */
export async function uploadAttachment(input: { rfqId?: string; orderId?: string; clarificationId: string | null; file: File; path: string; hasPrices: boolean }): Promise<AttachmentRow> {
  const db = requireSupabase()
  const up = await db.storage.from(FILE_BUCKET).upload(input.path, input.file, { contentType: input.file.type, upsert: false })
  if (up.error) throw up.error
  const res = await db
    .from('attachments')
    .insert({
      bucket: FILE_BUCKET,
      path: input.path,
      file_name: input.file.name,
      mime_type: input.file.type,
      size_bytes: input.file.size,
      rfq_id: input.rfqId ?? null,
      order_id: input.orderId ?? null,
      clarification_id: input.clarificationId,
    })
    .select('id, path, file_name, mime_type, size_bytes, clarification_id, created_at, has_prices')
    .single()
  if (res.error) {
    await db.storage.from(FILE_BUCKET).remove([input.path])
    throw res.error
  }
  const r = res.data
  return { id: r.id, path: r.path, fileName: r.file_name, mimeType: r.mime_type, sizeBytes: r.size_bytes, clarificationId: r.clarification_id, createdAt: r.created_at, hasPrices: r.has_prices }
}

/** Admin: tag a file as carrying prices (hidden from engineers) or not. Migration 0100's policy refuses an engineer here. */
export async function setAttachmentHasPrices(id: string, hasPrices: boolean): Promise<void> {
  const { error } = await requireSupabase().from('attachments').update({ has_prices: hasPrices }).eq('id', id)
  if (error) throw error
}

/** The row first, then the object: a failed object removal leaves an orphan (swept later), never a row pointing at nothing. */
export async function deleteAttachment(att: Pick<AttachmentRow, 'id' | 'path'>): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('attachments').delete().eq('id', att.id)
  if (error) throw error
  await db.storage.from(FILE_BUCKET).remove([att.path])
}

/** Short-lived links for showing and opening files (the bucket is private). Keyed by path. */
export async function signFileUrls(paths: readonly string[], seconds = 600): Promise<Record<string, string>> {
  const db = requireSupabase()
  if (paths.length === 0) return {}
  const { data, error } = await db.storage.from(FILE_BUCKET).createSignedUrls([...paths], seconds)
  if (error) throw error
  const out: Record<string, string> = {}
  for (const d of data ?? []) if (d.path && d.signedUrl) out[d.path] = d.signedUrl
  return out
}

// ================================================================ RFQ detail parity (Part C of the parity audit)

/** Add an item to an RFQ that already exists: the description is the only thing required (qty 1 and GST 18 come from the table). */
export async function addRfqItem(input: { id: string; rfqId: string; description: string; qty?: number; unit?: string | null }): Promise<void> {
  const db = requireSupabase()
  const last = unwrap(await db.from('rfq_items').select('position').eq('rfq_id', input.rfqId).order('position', { ascending: false }).limit(1))
  const position = last.length > 0 ? Number(last[0].position) + 1 : 0
  const { error } = await db.from('rfq_items').upsert(
    { id: input.id, rfq_id: input.rfqId, position, description: input.description.trim(), qty: input.qty ?? 1, unit: input.unit?.trim() || null },
    { onConflict: 'id', ignoreDuplicates: true },
  )
  if (error) throw error
}

export interface RfqHeaderPatch {
  companyId: string
  siteId?: string | null
  contactId: string | null
  customerRef: string | null
  receivedOn: string
}

/** Fix the RFQ's header. The database refuses someone else's entry (HINT not_yours) and a closed month. */
export async function updateRfqHeader(rfqId: string, p: RfqHeaderPatch): Promise<void> {
  const { data, error } = await requireSupabase()
    .from('rfqs')
    .update({ company_id: p.companyId, site_id: p.siteId, contact_id: p.contactId, customer_ref: p.customerRef?.trim() || null, received_on: p.receivedOn })
    .eq('id', rfqId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw { code: '42501', message: 'Only the person who entered this, or an admin, can change it.', hint: 'not_yours' }
}

export interface RfqItemPatch {
  description: string
  qty: number
  unit: string | null
}

export async function updateRfqItem(id: string, p: RfqItemPatch): Promise<void> {
  const { data, error } = await requireSupabase()
    .from('rfq_items')
    .update({ description: p.description.trim(), qty: p.qty, unit: p.unit?.trim() || null })
    .eq('id', id)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw { code: '42501', message: 'Only the person who entered this, or an admin, can change it.', hint: 'not_yours' }
}

/** C4: set (or clear, with null) the product category of one item. The 0092 guard lets the person who entered the RFQ, its owner or an admin do it. */
export async function setRfqItemCategory(id: string, familyId: string | null): Promise<void> {
  const { data, error } = await requireSupabase().from('rfq_items').update({ family_id: familyId }).eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw { code: '42501', message: 'Only the person who entered this, or an admin, can change it.', hint: 'not_yours' }
}

/** Remove an item. An item an order line is based on is refused by the database (HINT linked_to_order). */
export async function removeRfqItem(id: string): Promise<void> {
  const { data, error } = await requireSupabase().from('rfq_items').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw { code: '42501', message: 'Only the person who entered this, or an admin, can change it.', hint: 'not_yours' }
}

/** Remove one supplier's price for one item. The row is returned so an Undo can put it back exactly as it was. */
export async function removeQuoteLine(input: { inquiryId: string; itemId: string }): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('supplier_quote_lines').delete().eq('inquiry_id', input.inquiryId).eq('rfq_item_id', input.itemId)
  if (error) throw error
}

/** Put a removed price back with the rate it was entered at (the capture trigger leaves a rate that is already set). */
export async function restoreQuoteLine(line: QuoteLineRow): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('supplier_quote_lines').upsert(
    {
      inquiry_id: line.inquiryId,
      rfq_item_id: line.itemId,
      unit_price: line.unitPrice,
      currency: line.currency,
      lead_time: line.leadTime,
      in_stock: line.inStock,
      fx_rate_pkr: line.fxRatePkr,
      fx_rate_on: line.fxRateOn,
    },
    { onConflict: 'inquiry_id,rfq_item_id' },
  )
  if (error) throw error
}

/** v_supplier_stats for the suppliers on this RFQ (asked, replied, the usual reply time), for the memory line under each name. */
export async function listSupplierStatsFor(supplierIds: readonly string[]): Promise<Record<string, SupplierStatsRow>> {
  const db = requireSupabase()
  if (supplierIds.length === 0) return {}
  const rows = unwrap(
    await db.from('v_supplier_stats').select('supplier_id, asked, replied, no_offer, median_reply_days, last_contact, reply_days_n').in('supplier_id', [...supplierIds]),
  )
  const out: Record<string, SupplierStatsRow> = {}
  for (const r of rows) {
    if (!r.supplier_id) continue
    out[r.supplier_id] = {
      supplier_id: r.supplier_id,
      asked: r.asked,
      replied: r.replied,
      no_offer: r.no_offer,
      median_reply_days: r.median_reply_days,
      last_contact: r.last_contact,
      reply_days_n: r.reply_days_n,
      brand_ids: null,
    }
  }
  return out
}

/** Ask more suppliers (Float to another supplier, Copy enquiry text): an inquiry per supplier, stamped sent today. Suppliers already asked are left alone. */
export async function addInquiries(input: { rfqId: string; supplierIds: readonly string[]; sentOn: string }): Promise<string[]> {
  const db = requireSupabase()
  if (input.supplierIds.length === 0) return []
  const existing = unwrap(await db.from('supplier_inquiries').select('supplier_id').eq('rfq_id', input.rfqId))
  const have = new Set(existing.map(e => e.supplier_id))
  const fresh = input.supplierIds.filter(id => !have.has(id))
  if (fresh.length === 0) return []
  const rows = unwrap(
    await db
      .from('supplier_inquiries')
      .insert(fresh.map(supplier_id => ({ rfq_id: input.rfqId, supplier_id, sent_on: input.sentOn })))
      .select('id'),
  )
  return rows.map(r => r.id)
}

/**
 * Stamp shortlisted inquiries (New RFQ's "Save without asking") sent on `on`: only rows not yet sent change. Returns the ids that
 * changed, for the Undo.
 */
export async function markInquiriesSent(ids: readonly string[], on: string): Promise<string[]> {
  if (ids.length === 0) return []
  const db = requireSupabase()
  const rows = unwrap(await db.from('supplier_inquiries').update({ sent_on: on }).in('id', [...ids]).is('sent_on', null).select('id'))
  return rows.map(r => r.id)
}

/**
 * "Did you send it? Yes, sent" (0097): stamp sent_confirmed_at on inquiries that were asked and not yet confirmed. Only this call writes
 * the column, so "Sent" on a screen always means a person said so. Returns the ids that changed, for the Undo.
 */
export async function confirmInquiriesSent(ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return []
  const db = requireSupabase()
  const rows = unwrap(await db.from('supplier_inquiries').update({ sent_confirmed_at: new Date().toISOString() }).in('id', [...ids]).not('sent_on', 'is', null).is('sent_confirmed_at', null).select('id'))
  return rows.map(r => r.id)
}

/** The Undo of confirmInquiriesSent: back to "Asked". */
export async function unconfirmInquiriesSent(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return
  const db = requireSupabase()
  unwrap(await db.from('supplier_inquiries').update({ sent_confirmed_at: null }).in('id', [...ids]).select('id'))
}

/** The Undo of markInquiriesSent: back to shortlisted, only while still stamped that day and not chased since. */
export async function unmarkInquiriesSent(ids: readonly string[], stampedOn: string): Promise<void> {
  if (ids.length === 0) return
  const db = requireSupabase()
  unwrap(await db.from('supplier_inquiries').update({ sent_on: null }).in('id', [...ids]).eq('sent_on', stampedOn).is('last_chased_on', null).select('id'))
}

/** Take back inquiries just added: they go back to shortlisted (sent_on empty), which is the only state staff may delete. */
export async function removeInquiries(ids: readonly string[]): Promise<void> {
  const db = requireSupabase()
  if (ids.length === 0) return
  const { error: e1 } = await db.from('supplier_inquiries').update({ sent_on: null }).in('id', [...ids])
  if (e1) throw e1
  const { error: e2 } = await db.from('supplier_inquiries').delete().in('id', [...ids])
  if (e2) throw e2
}

/** The signed-in person's job title and phone (users.job_title, users.phone), printed under a chase text's signature. */
export async function getMySignature(userId: string): Promise<{ jobTitle: string | null; phone: string | null }> {
  const db = requireSupabase()
  const row = unwrap(await db.from('users').select('job_title, phone').eq('id', userId).maybeSingle()) as { job_title: string | null; phone: string | null } | null
  return { jobTitle: row?.job_title ?? null, phone: row?.phone ?? null }
}

/** Everyone's name by id (users are readable by every staff role): for "Ali chased this 1h ago". */
export async function listUserNames(): Promise<Record<string, string>> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('users').select('id, name'))
  return Object.fromEntries(rows.map(r => [r.id, r.name]))
}

// ================================================================ Delete an RFQ (0092)

export interface RfqDeleteCounts {
  /** Issued quotations, oldest first. */
  quotations: { number: number; revision: number; issuedOn: string }[]
  items: number
  /** Supplier prices (quote lines) on the RFQ's inquiries. */
  supplierPrices: number
  /** Files that will be removed from storage: the RFQ's attachments and the PDFs of its quotations. */
  files: number
}

/** What delete_rfq would take with the RFQ, for the confirm. Admin-only screens call it; row security answers for anyone else. */
export async function getRfqDeleteCounts(rfqId: string): Promise<RfqDeleteCounts> {
  const db = requireSupabase()
  const [quotes, items, prices, attachments] = await Promise.all([
    db.from('quotations').select('number, revision, issued_on, pdf_path').eq('rfq_id', rfqId).order('number').order('revision'),
    db.from('rfq_items').select('id', { count: 'exact', head: true }).eq('rfq_id', rfqId),
    db.from('supplier_quote_lines').select('id, supplier_inquiries!inner(rfq_id)', { count: 'exact', head: true }).eq('supplier_inquiries.rfq_id', rfqId),
    db.from('attachments').select('id', { count: 'exact', head: true }).eq('rfq_id', rfqId),
  ])
  const q = unwrap(quotes) ?? []
  for (const r of [items, prices, attachments]) if (r.error) throw r.error
  return {
    quotations: q.map(r => ({ number: r.number, revision: r.revision, issuedOn: r.issued_on })),
    items: items.count ?? 0,
    supplierPrices: prices.count ?? 0,
    files: (attachments.count ?? 0) + q.filter(r => r.pdf_path).length,
  }
}

export interface StoredFile {
  bucket: string
  path: string
}

/** delete_rfq: the rows are gone when this resolves; the files it names are the caller's to remove from storage. */
export async function deleteRfq(rfqId: string): Promise<StoredFile[]> {
  const rows = unwrap(await requireSupabase().rpc('delete_rfq', { p_rfq_id: rfqId })) ?? []
  return rows.map(r => ({ bucket: r.storage_bucket, path: r.storage_path }))
}

/**
 * Removes stored files, one call per bucket. A file that will not go must not undo a delete that already happened, so this never
 * throws: it returns the files it could not remove.
 */
export async function removeStoredFiles(files: readonly StoredFile[]): Promise<StoredFile[]> {
  const byBucket = new Map<string, string[]>()
  for (const f of files) byBucket.set(f.bucket, [...(byBucket.get(f.bucket) ?? []), f.path])
  const failed: StoredFile[] = []
  for (const [bucket, paths] of byBucket) {
    try {
      const { error } = await requireSupabase().storage.from(bucket).remove(paths)
      if (error) throw error
    } catch (e) {
      console.error(`Could not remove ${paths.length} file(s) from ${bucket} after deleting an RFQ`, e)
      failed.push(...paths.map(path => ({ bucket, path })))
    }
  }
  return failed
}
