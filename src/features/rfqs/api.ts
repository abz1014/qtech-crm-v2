import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import type { ViewRow } from '@/features/dbTypes'
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
    // Every column the memory card quotes comes from this one read, so opening a card asks for nothing more.
    fetchAll((from, to) => db.from('v_supplier_stats').select('*').range(from, to)),
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
      stats: { ...s, supplier_id: s.supplier_id },
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

// ================================================================ RFQ detail (R07)

export type RfqStateRow = ViewRow<'v_rfq_state'>
export type InquiryStateRow = ViewRow<'v_inquiry_state'>

export interface RfqHeader {
  id: string
  number: number
  customerRef: string | null
  receivedOn: string
  dueOn: string | null
  isPriority: boolean
  quotedOn: string | null
  closedOn: string | null
  closeReason: string | null
  closeNote: string | null
  notes: string | null
  company: { id: string; name: string; country: string | null }
  site: { name: string; address: string | null } | null
  contactId: string | null
  contact: { name: string; phone: string | null } | null
  owner: { id: string; name: string; role: string } | null
  state: RfqStateRow | null
}

type Maybe<T> = { data: T | null; error: { code?: string; message: string } | null }
const none = Promise.resolve({ data: null, error: null })

/** The RFQ, who it is for, who owns it and its derived states (v_rfq_state). Null when there is no such RFQ. */
export async function getRfqHeader(id: string): Promise<RfqHeader | null> {
  const db = requireSupabase()
  const [rfqRes, stateRes] = await Promise.all([
    db
      .from('rfqs')
      .select('id, number, company_id, site_id, contact_id, customer_ref, received_on, due_on, owner_id, is_priority, quoted_on, closed_on, close_reason, close_note, notes')
      .eq('id', id)
      .maybeSingle(),
    db.from('v_rfq_state').select('*').eq('rfq_id', id).maybeSingle(),
  ])
  const r = unwrap(rfqRes)
  if (!r) return null
  const [company, site, contact, owner] = await Promise.all([
    db.from('companies').select('id, name, country').eq('id', r.company_id).maybeSingle(),
    r.site_id ? db.from('company_sites').select('name, address').eq('id', r.site_id).maybeSingle() : none,
    r.contact_id ? db.from('contacts').select('name, phone').eq('id', r.contact_id).maybeSingle() : none,
    r.owner_id ? db.from('users').select('id, name, role').eq('id', r.owner_id).maybeSingle() : none,
  ])
  const c = unwrap(company)
  return {
    id: r.id,
    number: r.number,
    customerRef: r.customer_ref,
    receivedOn: r.received_on,
    dueOn: r.due_on,
    isPriority: r.is_priority,
    quotedOn: r.quoted_on,
    closedOn: r.closed_on,
    closeReason: r.close_reason,
    closeNote: r.close_note,
    notes: r.notes,
    company: { id: r.company_id, name: c?.name ?? 'Unknown company', country: c?.country ?? null },
    contactId: r.contact_id,
    site: unwrap(site as Maybe<{ name: string; address: string | null }>),
    contact: unwrap(contact as Maybe<{ name: string; phone: string | null }>),
    owner: unwrap(owner as Maybe<{ id: string; name: string; role: string }>),
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
  qty: number
  unit: string | null
}

export async function listRfqItems(rfqId: string): Promise<RfqItemRow[]> {
  const db = requireSupabase()
  const rows = unwrap(
    await db.from('rfq_items').select('id, position, description, brand_id, family_id, qty, unit, created_at').eq('rfq_id', rfqId).order('position').order('created_at'),
  )
  const brandIds = [...new Set(rows.map(r => r.brand_id).filter((b): b is string => Boolean(b)))]
  const brands = brandIds.length ? unwrap(await db.from('brands').select('id, name').in('id', brandIds)) : []
  const names = new Map(brands.map(b => [b.id, b.name]))
  return rows.map((r, i) => ({
    id: r.id,
    number: i + 1,
    description: r.description,
    brandId: r.brand_id,
    brandName: r.brand_id ? (names.get(r.brand_id) ?? null) : null,
    familyId: r.family_id,
    qty: Number(r.qty),
    unit: r.unit,
  }))
}

export interface QuoteLineRow {
  id: string
  inquiryId: string
  itemId: string
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
  sentOn: string | null
  lastChasedOn: string | null
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
  /** The currency of this supplier's most recent quote line on any RFQ, or null. */
  lastCurrency: string | null
  /** v_inquiry_state values. */
  responseState: string | null
  contactState: string | null
  itemsQuoted: number
  lines: QuoteLineRow[]
}

/** One row per supplier asked, with their quote lines, contact and last currency. */
export async function listInquiries(rfqId: string): Promise<InquiryRow[]> {
  const db = requireSupabase()
  const inq = unwrap(
    await db
      .from('supplier_inquiries')
      .select('id, supplier_id, sent_on, last_chased_on, last_relayed_at, no_offer_on, no_offer_reason, chase_count, notes, created_at')
      .eq('rfq_id', rfqId)
      .order('created_at'),
  )
  if (inq.length === 0) return []
  const supplierIds = [...new Set(inq.map(i => i.supplier_id))]
  const inquiryIds = inq.map(i => i.id)
  const [companies, states, contacts, lines, recent, declines] = await Promise.all([
    db.from('companies').select('id, name, country').in('id', supplierIds),
    db.from('v_inquiry_state').select('inquiry_id, response_state, contact_state, items_quoted').eq('rfq_id', rfqId),
    db.from('contacts').select('company_id, name, phone, created_at').in('company_id', supplierIds).order('created_at'),
    db
      .from('supplier_quote_lines')
      .select('id, inquiry_id, rfq_item_id, unit_price, currency, lead_time, in_stock, fx_rate_pkr, fx_rate_on')
      .in('inquiry_id', inquiryIds),
    db
      .from('supplier_quote_lines')
      .select('currency, created_at, supplier_inquiries!inner(supplier_id)')
      .in('supplier_inquiries.supplier_id', supplierIds)
      .order('created_at', { ascending: false })
      .limit(500),
    db.from('inquiry_item_declines').select('inquiry_id, rfq_item_id, reason').in('inquiry_id', inquiryIds),
  ])
  const declinesBy = new Map<string, Record<string, string>>()
  for (const d of unwrap(declines)) declinesBy.set(d.inquiry_id, { ...(declinesBy.get(d.inquiry_id) ?? {}), [d.rfq_item_id]: d.reason })
  const byCompany = new Map(unwrap(companies).map(c => [c.id, c]))
  const stateBy = new Map(unwrap(states).map(s => [s.inquiry_id, s]))
  const contactBy = new Map<string, { name: string; phone: string | null }>()
  for (const c of unwrap(contacts)) if (!contactBy.has(c.company_id)) contactBy.set(c.company_id, { name: c.name, phone: c.phone })
  const lastCurrency = new Map<string, string>()
  type Recent = { currency: string; supplier_inquiries: { supplier_id: string } | { supplier_id: string }[] }
  for (const r of unwrap(recent) as unknown as Recent[]) {
    const si = Array.isArray(r.supplier_inquiries) ? r.supplier_inquiries[0] : r.supplier_inquiries
    if (si && !lastCurrency.has(si.supplier_id)) lastCurrency.set(si.supplier_id, r.currency.trim())
  }
  const linesBy = new Map<string, QuoteLineRow[]>()
  for (const l of unwrap(lines)) {
    const row: QuoteLineRow = {
      id: l.id,
      inquiryId: l.inquiry_id,
      itemId: l.rfq_item_id,
      unitPrice: Number(l.unit_price),
      currency: l.currency.trim(),
      leadTime: l.lead_time,
      inStock: l.in_stock,
      fxRatePkr: l.fx_rate_pkr === null ? null : Number(l.fx_rate_pkr),
      fxRateOn: l.fx_rate_on,
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
      sentOn: i.sent_on,
      lastChasedOn: i.last_chased_on,
      lastRelayedAt: i.last_relayed_at,
      noOfferOn: i.no_offer_on,
      noOfferReason: i.no_offer_reason,
      itemDeclines: declinesBy.get(i.id) ?? {},
      chaseCount: i.chase_count,
      notes: i.notes,
      contactName: ct?.name ?? null,
      contactPhone: ct?.phone ?? null,
      lastCurrency: lastCurrency.get(i.supplier_id) ?? null,
      responseState: s?.response_state ?? null,
      contactState: s?.contact_state ?? null,
      itemsQuoted: s?.items_quoted ?? 0,
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
}

export interface ClarificationRow {
  id: string
  question: string
  raisedByInquiryId: string | null
  firstAskedAt: string | null
  lastAskedAt: string | null
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
      .select('id, question, raised_by_inquiry_id, first_asked_at, last_asked_at, ask_count, answer, answered_at, withdrawn_at, created_at')
      .eq('rfq_id', rfqId)
      .order('created_at')
      .order('id'),
  )
  return rows.map(r => ({
    id: r.id,
    question: r.question,
    raisedByInquiryId: r.raised_by_inquiry_id,
    firstAskedAt: r.first_asked_at,
    lastAskedAt: r.last_asked_at,
    askCount: r.ask_count,
    answer: r.answer,
    answeredAt: r.answered_at,
    withdrawnAt: r.withdrawn_at,
    createdAt: r.created_at,
  }))
}

/** Files on an order (R22, migration 0041): same bucket and columns, the parent is order_id. */
export async function listOrderAttachments(orderId: string): Promise<AttachmentRow[]> {
  const db = requireSupabase()
  const rows = unwrap(
    await db.from('attachments').select('id, path, file_name, mime_type, size_bytes, clarification_id, created_at').eq('order_id', orderId).eq('bucket', FILE_BUCKET).order('created_at'),
  )
  return rows.map(r => ({
    id: r.id,
    path: r.path,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    clarificationId: r.clarification_id,
    createdAt: r.created_at,
  }))
}

export async function listAttachments(rfqId: string): Promise<AttachmentRow[]> {
  const db = requireSupabase()
  const rows = unwrap(
    await db.from('attachments').select('id, path, file_name, mime_type, size_bytes, clarification_id, created_at').eq('rfq_id', rfqId).eq('bucket', FILE_BUCKET).order('created_at'),
  )
  return rows.map(r => ({
    id: r.id,
    path: r.path,
    fileName: r.file_name,
    mimeType: r.mime_type,
    sizeBytes: r.size_bytes,
    clarificationId: r.clarification_id,
    createdAt: r.created_at,
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
export async function uploadAttachment(input: { rfqId?: string; orderId?: string; clarificationId: string | null; file: File; path: string }): Promise<AttachmentRow> {
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
    .select('id, path, file_name, mime_type, size_bytes, clarification_id, created_at')
    .single()
  if (res.error) {
    await db.storage.from(FILE_BUCKET).remove([input.path])
    throw res.error
  }
  const r = res.data
  return { id: r.id, path: r.path, fileName: r.file_name, mimeType: r.mime_type, sizeBytes: r.size_bytes, clarificationId: r.clarification_id, createdAt: r.created_at }
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
