import { requireSupabase, unwrap } from '@/lib/supabase'
import type { StoredFile } from '@/features/rfqs/api'

/*
 * Quotations (R19): every database and storage call for issuing a quotation, listing its revisions and keeping its PDF.
 * The only file that names the quotations table, the issue_quotation / customer_price_memory RPCs or the generated-docs
 * bucket. Access is Row Level Security's job: every staff role may read and issue (DATA_MODEL section 10).
 */

export const PDF_BUCKET = 'generated-docs'

/** One line of the frozen snapshot inside quotations.lines (written by issue_quotation). */
export interface QuotationLine {
  rfq_item_id: string
  description: string
  qty: number
  unit: string | null
  unit_price_net: number
  gst_rate: number
  lead_time: string | null
}

export interface QuotationRow {
  id: string
  number: number
  revision: number
  issuedOn: string
  validUntil: string
  contactId: string | null
  lines: QuotationLine[]
  netTotal: number
  gstTotal: number
  deliveryText: string | null
  paymentTerms: string | null
  notes: string | null
  signatoryId: string
  pdfPath: string | null
}

const COLS =
  'id, number, revision, issued_on, valid_until, contact_id, lines, net_total, gst_total, delivery_text, payment_terms, notes, signatory_id, pdf_path'

type DbQuotation = {
  id: string
  number: number
  revision: number
  issued_on: string
  valid_until: string
  contact_id: string | null
  lines: unknown
  net_total: number
  gst_total: number
  delivery_text: string | null
  payment_terms: string | null
  notes: string | null
  signatory_id: string
  pdf_path: string | null
}

function toRow(r: DbQuotation): QuotationRow {
  return {
    id: r.id,
    number: r.number,
    revision: r.revision,
    issuedOn: r.issued_on,
    validUntil: r.valid_until,
    contactId: r.contact_id,
    lines: (Array.isArray(r.lines) ? r.lines : []) as QuotationLine[],
    netTotal: Number(r.net_total),
    gstTotal: Number(r.gst_total),
    deliveryText: r.delivery_text,
    paymentTerms: r.payment_terms,
    notes: r.notes,
    signatoryId: r.signatory_id,
    pdfPath: r.pdf_path,
  }
}

/** The same without the lines and totals: what an engineer reads (owner decision 2026-10-22: no prices, not even fetched). */
const COLS_NO_PRICES = 'id, number, revision, issued_on, valid_until, contact_id, delivery_text, payment_terms, notes, signatory_id, pdf_path'

/**
 * Every revision of the RFQ's quotation, newest first. `prices` false (an engineer) reads no lines and no totals: the rows
 * then carry no lines and zero totals, which no engineer screen shows.
 */
export async function listQuotations(rfqId: string, prices = true): Promise<QuotationRow[]> {
  const rows = unwrap(await requireSupabase().from('quotations').select(prices ? COLS : COLS_NO_PRICES).eq('rfq_id', rfqId).order('revision', { ascending: false }))
  return (rows as unknown as DbQuotation[]).map(r => toRow(prices ? r : { ...r, lines: [], net_total: 0, gst_total: 0 }))
}

export async function getQuotation(id: string): Promise<QuotationRow> {
  const row = unwrap(await requireSupabase().from('quotations').select(COLS).eq('id', id).single())
  return toRow(row as unknown as DbQuotation)
}

// ---------------------------------------------------------------- the items being quoted

export interface QuoteItem {
  id: string
  position: number
  description: string
  qty: number
  unit: string | null
  quotedUnitPriceNet: number | null
  gstRate: number
  quotedLeadTime: string | null
  brandName: string | null
  familyName: string | null
}

export async function listQuoteItems(rfqId: string): Promise<QuoteItem[]> {
  const db = requireSupabase()
  const rows = unwrap(
    await db
      .from('rfq_items')
      .select('id, position, description, brand_id, family_id, qty, unit, quoted_unit_price_net, gst_rate, quoted_lead_time, created_at')
      .eq('rfq_id', rfqId)
      .order('position')
      .order('created_at'),
  )
  // brands and families are both rows of `brands`
  const nameIds = [...new Set(rows.flatMap(r => [r.brand_id, r.family_id]).filter((b): b is string => Boolean(b)))]
  const names = new Map((nameIds.length ? unwrap(await db.from('brands').select('id, name').in('id', nameIds)) : []).map(b => [b.id, b.name]))
  return rows.map(r => ({
    brandName: r.brand_id ? (names.get(r.brand_id) ?? null) : null,
    familyName: r.family_id ? (names.get(r.family_id) ?? null) : null,
    id: r.id,
    position: r.position,
    description: r.description,
    qty: Number(r.qty),
    unit: r.unit,
    quotedUnitPriceNet: r.quoted_unit_price_net === null ? null : Number(r.quoted_unit_price_net),
    gstRate: Number(r.gst_rate),
    quotedLeadTime: r.quoted_lead_time,
  }))
}

/** The two price chips of one item: what this customer last paid for it, and what we last quoted it. */
export interface PriceMemory {
  itemId: string
  soldPrice: number | null
  soldOn: string | null
  /** ORD-0031 for the sold chip. */
  soldOrderNumber: number | null
  quotedPrice: number | null
  quotedOn: string | null
  quotedNumber: number | null
  quotedRevision: number | null
}

export async function getPriceMemory(rfqId: string): Promise<PriceMemory[]> {
  const rows = unwrap(await requireSupabase().rpc('customer_price_memory', { p_rfq_id: rfqId })) ?? []
  return rows.map(r => ({
    itemId: r.rfq_item_id,
    soldPrice: r.sold_price === null ? null : Number(r.sold_price),
    soldOn: r.sold_on,
    soldOrderNumber: r.sold_order_number,
    quotedPrice: r.quoted_price === null ? null : Number(r.quoted_price),
    quotedOn: r.quoted_on,
    quotedNumber: r.quoted_number,
    quotedRevision: r.quoted_revision,
  }))
}

export interface ContactChoice {
  id: string
  name: string
  jobTitle: string | null
}

// ---------------------------------------------------------------- issue

export interface IssueItemInput {
  id: string
  unitPrice: number
  gstRate: number
  leadTime: string | null
  /** The quantity the person saw. The server refuses the issue when the stored one differs (HW-3). */
  qty?: number
}

export interface IssueInput {
  /** Client-generated: a second call with the same id changes nothing, so a double tap cannot issue twice. */
  id: string
  rfqId: string
  /** The included items. Only these are priced into rfq_items and snapshotted (partial quotations, 0039). */
  items: IssueItemInput[]
  validUntil: string
  contactId: string | null
  deliveryText: string | null
  paymentTerms: string | null
  notes: string | null
}

/**
 * One call (0083): issue_quotation writes the prices into rfq_items and makes the revision in one transaction, so a refused
 * issue (an overflowing total, a quantity changed meanwhile, a dropped connection) changes no price (HW-43). What was typed
 * is kept by the dialog's draft (issueDraft.ts), not by writing it early.
 */
export async function issueQuotation(input: IssueInput): Promise<QuotationRow> {
  const db = requireSupabase()
  const { error } = await db.rpc('issue_quotation', {
    p_quotation_id: input.id,
    p_rfq_id: input.rfqId,
    p_valid_until: input.validUntil,
    p_contact_id: input.contactId ?? undefined,
    // The RPC coalesces a NULL text with the previous revision's, so an emptied field is sent as '' to stay empty.
    p_delivery_text: input.deliveryText ?? '',
    p_payment_terms: input.paymentTerms ?? '',
    p_notes: input.notes ?? '',
    p_item_ids: input.items.map(i => i.id),
    p_lines: input.items.map(i => ({
      id: i.id,
      unit_price: i.unitPrice,
      gst_rate: i.gstRate,
      lead_time: i.leadTime,
      ...(i.qty !== undefined ? { qty: i.qty } : {}),
    })),
  })
  if (error) throw error
  return getQuotation(input.id)
}

// ---------------------------------------------------------------- the PDF

export interface PdfData {
  quotation: QuotationRow
  /** The earlier revision this one supersedes, when there is one. */
  previous: { revision: number; issuedOn: string } | null
  /** Year the number was first issued (revision 0's issue date), which QT-YY-NNNN uses. */
  firstIssuedOn: string
  customer: { name: string; country: string | null }
  siteName: string | null
  siteAddress: string | null
  attention: string | null
  attentionTitle: string | null
  customerRef: string | null
  rfqNumber: number
  signatory: { name: string; jobTitle: string | null; phone: string | null } | null
  /** A preview of a quotation that has not been issued: the PDF says so and prints no real number. */
  preview?: boolean
}

/** Everything the PDF prints besides the company profile (which has its own query). */
export async function loadPdfData(quotationId: string): Promise<PdfData> {
  const db = requireSupabase()
  const quotation = await getQuotation(quotationId)
  const link = unwrap(await db.from('quotations').select('rfq_id').eq('id', quotationId).maybeSingle()) as { rfq_id: string } | null
  if (!link) throw new Error('This quotation could not be found.')
  const rfq = unwrap(await db.from('rfqs').select('id, number, company_id, site_id, contact_id, customer_ref').eq('id', link.rfq_id).maybeSingle()) as {
    id: string
    number: number
    company_id: string
    site_id: string | null
    contact_id: string | null
    customer_ref: string | null
  } | null
  if (!rfq) throw new Error('The RFQ of this quotation could not be found.')
  const contactId = quotation.contactId ?? rfq.contact_id
  const [company, site, contact, signatory, revs] = await Promise.all([
    db.from('companies').select('name, country').eq('id', rfq.company_id).single(),
    rfq.site_id ? db.from('company_sites').select('name, address').eq('id', rfq.site_id).maybeSingle() : Promise.resolve(null),
    contactId ? db.from('contacts').select('name, job_title').eq('id', contactId).maybeSingle() : Promise.resolve(null),
    loadSignatory(quotation.signatoryId),
    db.from('quotations').select('revision, issued_on').eq('rfq_id', rfq.id).order('revision'),
  ])
  const c = unwrap(company)
  const s = site ? unwrap(site) : null
  const k = contact ? unwrap(contact) : null
  const u = signatory
  const all = unwrap(revs) ?? []
  const prev = [...all].reverse().find(r => r.revision < quotation.revision) ?? null
  return {
    quotation,
    previous: prev ? { revision: prev.revision, issuedOn: prev.issued_on } : null,
    firstIssuedOn: all[0]?.issued_on ?? quotation.issuedOn,
    customer: { name: c?.name ?? 'Unknown company', country: c?.country ?? null },
    siteName: s?.name ?? null,
    siteAddress: s?.address ?? null,
    attention: k?.name ?? null,
    attentionTitle: k?.job_title ?? null,
    customerRef: rfq.customer_ref,
    rfqNumber: rfq.number,
    signatory: u,
  }
}

/** The signed-in person as the PDF prints them: name, job title and phone (all optional but the name). */
export async function loadSignatory(userId: string): Promise<{ name: string; jobTitle: string | null; phone: string | null } | null> {
  const row = unwrap(await requireSupabase().from('users').select('name, job_title, phone').eq('id', userId).maybeSingle()) as {
    name: string
    job_title: string | null
    phone: string | null
  } | null
  return row ? { name: row.name, jobTitle: row.job_title, phone: row.phone } : null
}

export const pdfPathFor = (quotationId: string, revision: number) => `${quotationId}/${revision}.pdf`

/** Stores the PDF at {quotation_id}/{revision}.pdf and records the path on the (otherwise frozen) quotation row. */
export async function storePdf(q: Pick<QuotationRow, 'id' | 'revision'>, pdf: Blob): Promise<string> {
  const db = requireSupabase()
  const path = pdfPathFor(q.id, q.revision)
  const up = await db.storage.from(PDF_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (up.error) throw up.error
  const { error } = await db.from('quotations').update({ pdf_path: path }).eq('id', q.id)
  if (error) throw error
  return path
}

export async function downloadStoredPdf(path: string): Promise<Blob> {
  const { data, error } = await requireSupabase().storage.from(PDF_BUCKET).download(path)
  if (error) throw error
  return data
}

/** delete_quotation_revision (0092, admin only): the latest revision only. The rows are gone when this resolves; the PDF it names is the caller's to remove. */
export async function deleteQuotationRevision(quotationId: string): Promise<StoredFile[]> {
  const rows = unwrap(await requireSupabase().rpc('delete_quotation_revision', { p_quotation_id: quotationId })) ?? []
  return rows.map(r => ({ bucket: r.storage_bucket, path: r.storage_path }))
}
