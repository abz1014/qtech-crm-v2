import { requireSupabase, unwrap } from '@/lib/supabase'
import type { StoredFile } from '@/features/rfqs/api'
import { poLineAmounts, type LastPo, type PrefillRow, type PriceSource } from '@/features/purchaseOrders/lib/prefill'

/*
 * Supplier POs (O07): every database and storage call for the Issue purchase order dialog, the PO's PDF and the View PO link.
 * The only file that names purchase_orders, the po_line_prefill and issue_purchase_order RPCs or the generated-docs bucket for them.
 * Access is Row Level Security's job: every staff role may read and issue (DATA_MODEL section 10); the app shows the dialog to admin
 * and sales only, because a PO carries prices and engineers never handle money.
 */

export const PDF_BUCKET = 'generated-docs'

const SOURCES: readonly string[] = ['order', 'quote', 'last_po', 'typed']

/** What Issue PO would pre-fill for the leg, line by line, with where each price came from. Writes nothing. */
export async function getPrefill(legId: string): Promise<PrefillRow[]> {
  const rows = unwrap(await requireSupabase().rpc('po_line_prefill', { p_supplier_order_id: legId })) ?? []
  return rows.map(r => ({
    orderItemId: r.order_item_id,
    position: Number(r.position),
    description: r.description,
    qty: Number(r.qty),
    unit: r.unit ?? null,
    unitPrice: r.unit_price === null || r.unit_price === undefined ? null : Number(r.unit_price),
    source: (SOURCES.includes(r.price_source) ? r.price_source : 'typed') as PriceSource,
    sourceNumber: r.source_number ?? null,
    sourceRevision: r.source_revision ?? null,
    sourceOn: r.source_on ?? null,
  }))
}

/** The supplier's most recent PO on any order: the terms the next one starts from. */
export async function getLastPoToSupplier(supplierId: string): Promise<LastPo | null> {
  const rows = unwrap(
    await requireSupabase()
      .from('purchase_orders')
      .select('number, revision, issued_on, incoterm, delivery_terms, payment_terms, supplier_orders!inner(supplier_id)')
      .eq('supplier_orders.supplier_id', supplierId)
      .order('created_at', { ascending: false })
      .limit(1),
  )
  const r = rows[0]
  return r
    ? { number: r.number, revision: r.revision, issuedOn: r.issued_on, incoterm: r.incoterm, deliveryTerms: r.delivery_terms, paymentTerms: r.payment_terms }
    : null
}

export interface LegPoRow {
  id: string
  number: number
  revision: number
  issuedOn: string
  /** Revision 0's issue date: PO-YY-NNNN takes its year from the first issue (as the PDF prints it). */
  firstIssuedOn: string
  currency: string
  total: number
  pdfPath: string | null
}

/** The latest issued revision of this leg's PO, or null when the leg has none yet. Every revision is read (a handful) for the first issue date. */
export async function getLegPo(legId: string): Promise<LegPoRow | null> {
  const rows = unwrap(
    await requireSupabase().from('purchase_orders').select('id, number, revision, issued_on, currency, total, pdf_path').eq('supplier_order_id', legId).order('revision', { ascending: false }),
  )
  const r = rows[0]
  const first = rows.reduce<(typeof rows)[number] | undefined>((a, x) => (!a || x.revision < a.revision ? x : a), undefined)
  return r
    ? { id: r.id, number: r.number, revision: r.revision, issuedOn: r.issued_on, firstIssuedOn: first?.issued_on ?? r.issued_on, currency: r.currency.trim(), total: Number(r.total), pdfPath: r.pdf_path }
    : null
}

/** The number the next first-issue PO will most likely take (the highest so far plus one). Shown as the dialog's tag; the issued number is the database's. */
export async function getNextPoNumber(): Promise<number> {
  const rows = unwrap(await requireSupabase().from('purchase_orders').select('number').order('number', { ascending: false }).limit(1))
  return (rows[0]?.number ?? 0) + 1
}

export interface IssueInput {
  /** Client-generated: a second call with the same id changes nothing, so a double tap cannot issue twice. */
  id: string
  legId: string
  lines: Array<{ order_item_id: string; unit_price: number; qty: number }>
  incoterm: string | null
  deliveryTerms: string | null
  paymentTerms: string | null
  shipTo: string | null
}

export async function issuePurchaseOrder(input: IssueInput): Promise<LegPoRow> {
  const { error } = await requireSupabase().rpc('issue_purchase_order', {
    p_po_id: input.id,
    p_supplier_order_id: input.legId,
    p_lines: input.lines as unknown as never,
    p_incoterm: input.incoterm ?? undefined,
    p_delivery_terms: input.deliveryTerms ?? undefined,
    p_payment_terms: input.paymentTerms ?? undefined,
    p_ship_to: input.shipTo ?? undefined,
  })
  if (error) throw error
  const rows = unwrap(await requireSupabase().from('purchase_orders').select('id, number, revision, issued_on, currency, total, pdf_path').eq('id', input.id).limit(1))
  const r = rows[0]
  if (!r) throw new Error('The PO was issued but could not be read back.')
  const first =
    r.revision === 0
      ? r.issued_on
      : (unwrap(await requireSupabase().from('purchase_orders').select('issued_on').eq('supplier_order_id', input.legId).eq('revision', 0).limit(1))[0]?.issued_on ?? r.issued_on)
  return { id: r.id, number: r.number, revision: r.revision, issuedOn: r.issued_on, firstIssuedOn: first, currency: r.currency.trim(), total: Number(r.total), pdfPath: r.pdf_path }
}

/** A leg cannot be issued without a currency: this sets it (the dialog shows it locked once it is set). */
export async function setLegCurrency(legId: string, currency: string): Promise<void> {
  const { error } = await requireSupabase().from('supplier_orders').update({ currency }).eq('id', legId)
  if (error) throw error
}

// ---------------------------------------------------------------- the PDF

export interface PoPdfLine {
  order_item_id: string
  description: string
  qty: number
  unit: string | null
  unit_price: number
  price_source: string
}

export interface PoPdfData {
  po: {
    id: string
    number: number
    revision: number
    issuedOn: string
    currency: string
    total: number
    lines: PoPdfLine[]
    incoterm: string | null
    deliveryTerms: string | null
    paymentTerms: string | null
    shipTo: string | null
    notes: string | null
  }
  /** The earlier revision this one supersedes, when there is one. */
  previous: { revision: number; issuedOn: string } | null
  /** Year the number was first issued (revision 0's issue date), which PO-YY-NNNN uses. */
  firstIssuedOn: string
  supplier: { name: string; address: string | null; city: string | null; country: string | null; attention: string | null; brands: string[] }
  /** The supplier's own reference for this order (their proforma), from the leg. */
  supplierReference: string | null
  orderNumber: number
  signatory: { name: string; jobTitle: string | null; phone: string | null } | null
}

type LegContext = Pick<PoPdfData, 'supplier' | 'supplierReference' | 'orderNumber' | 'signatory' | 'previous' | 'firstIssuedOn'>

/** The facts around a leg that the PDF prints: the supplier, our order, the signatory and the earlier revisions of this leg's PO. */
async function loadLegContext(legId: string, signatoryId: string | null, beforeRevision: number | null, fallbackIssuedOn: string): Promise<LegContext> {
  const db = requireSupabase()
  const leg = unwrap(await db.from('supplier_orders').select('supplier_id, order_id, reference').eq('id', legId).maybeSingle()) as unknown as { supplier_id: string; order_id: string; reference: string | null } | null
  if (!leg) throw new Error('The supplier order of this PO could not be found.')
  const [company, site, contact, order, signatory, revs, brandLinks] = await Promise.all([
    db.from('companies').select('name, city, country').eq('id', leg.supplier_id).maybeSingle(),
    db.from('company_sites').select('address').eq('company_id', leg.supplier_id).order('created_at').limit(1),
    db.from('contacts').select('name').eq('company_id', leg.supplier_id).order('created_at').limit(1),
    db.from('orders').select('number').eq('id', leg.order_id).maybeSingle(),
    signatoryId ? db.from('users').select('name, job_title, phone').eq('id', signatoryId).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from('purchase_orders').select('revision, issued_on').eq('supplier_order_id', legId).order('revision'),
    db.from('company_brands').select('brand_id').eq('company_id', leg.supplier_id),
  ])
  const brandIds = unwrap(brandLinks).map(b => b.brand_id)
  const brands = brandIds.length ? unwrap(await db.from('brands').select('name').in('id', brandIds).order('name')) : []
  const c = unwrap(company)
  const all = unwrap(revs) ?? []
  const prev = [...all].reverse().find(r => beforeRevision === null || r.revision < beforeRevision) ?? null
  const u = unwrap(signatory as { data: { name: string; job_title: string | null; phone: string | null } | null; error: null })
  return {
    previous: prev ? { revision: prev.revision, issuedOn: prev.issued_on } : null,
    firstIssuedOn: all[0]?.issued_on ?? fallbackIssuedOn,
    supplier: {
      name: c?.name ?? 'Unknown supplier',
      address: unwrap(site)[0]?.address ?? null,
      city: c?.city ?? null,
      country: c?.country ?? null,
      attention: unwrap(contact)[0]?.name ?? null,
      brands: brands.map(x => x.name),
    },
    supplierReference: leg.reference,
    orderNumber: unwrap(order)?.number ?? 0,
    signatory: u ? { name: u.name, jobTitle: u.job_title, phone: u.phone } : null,
  }
}

/** Everything the PO PDF prints besides the company profile (which has its own query). */
export async function loadPoPdfData(poId: string): Promise<PoPdfData> {
  const po = unwrap(
    await requireSupabase()
      .from('purchase_orders')
      .select('id, supplier_order_id, number, revision, issued_on, currency, total, lines, incoterm, delivery_terms, payment_terms, ship_to, notes, signatory_id')
      .eq('id', poId)
      .maybeSingle(),
  ) as unknown as {
    id: string
    supplier_order_id: string
    number: number
    revision: number
    issued_on: string
    currency: string
    total: number
    lines: unknown
    incoterm: string | null
    delivery_terms: string | null
    payment_terms: string | null
    ship_to: string | null
    notes: string | null
    signatory_id: string
  } | null
  if (!po) throw new Error('This purchase order could not be found.')
  const ctx = await loadLegContext(po.supplier_order_id, po.signatory_id, po.revision, po.issued_on)
  return {
    ...ctx,
    po: {
      id: po.id,
      number: po.number,
      revision: po.revision,
      issuedOn: po.issued_on,
      currency: po.currency.trim(),
      total: Number(po.total),
      lines: (Array.isArray(po.lines) ? po.lines : []) as unknown as PoPdfLine[],
      incoterm: po.incoterm,
      deliveryTerms: po.delivery_terms,
      paymentTerms: po.payment_terms,
      shipTo: po.ship_to,
      notes: po.notes,
    },
  }
}

export interface PoDraft {
  legId: string
  number: number
  revision: number
  issuedOn: string
  currency: string
  lines: PoPdfLine[]
  incoterm: string | null
  deliveryTerms: string | null
  paymentTerms: string | null
  shipTo: string | null
  signatoryId: string
}

/** The same data for a PO that has not been issued yet (the dialog's Preview PDF). Nothing is written. */
export async function loadPoPreviewData(d: PoDraft): Promise<PoPdfData> {
  const ctx = await loadLegContext(d.legId, d.signatoryId, null, d.issuedOn)
  const total = poLineAmounts(d.lines).total
  return {
    ...ctx,
    po: { id: 'preview', number: d.number, revision: d.revision, issuedOn: d.issuedOn, currency: d.currency, total, lines: d.lines, incoterm: d.incoterm, deliveryTerms: d.deliveryTerms, paymentTerms: d.paymentTerms, shipTo: d.shipTo, notes: null },
  }
}

export const pdfPathFor = (poId: string, revision: number) => `${poId}/${revision}.pdf`

/** Stores the PDF at {po_id}/{revision}.pdf and records the path on the (otherwise frozen) PO row. */
export async function storePoPdf(po: { id: string; revision: number }, pdf: Blob): Promise<string> {
  const db = requireSupabase()
  const path = pdfPathFor(po.id, po.revision)
  const up = await db.storage.from(PDF_BUCKET).upload(path, pdf, { contentType: 'application/pdf', upsert: true })
  if (up.error) throw up.error
  const { error } = await db.from('purchase_orders').update({ pdf_path: path }).eq('id', po.id)
  if (error) throw error
  return path
}

export async function downloadStoredPoPdf(path: string): Promise<Blob> {
  const { data, error } = await requireSupabase().storage.from(PDF_BUCKET).download(path)
  if (error) throw error
  return data
}

/** The latest PO of each leg of an order, with its supplier and the lines it covers: what the cancel dialog needs to say who must be told. */
export async function listSentPos(orderId: string): Promise<import('@/features/purchaseOrders/lib/cancelText').SentPo[]> {
  const db = requireSupabase()
  const legs = unwrap(await db.from('supplier_orders').select('id, supplier_id').eq('order_id', orderId))
  if (legs.length === 0) return []
  const [pos, items, companies] = await Promise.all([
    db.from('purchase_orders').select('number, revision, issued_on, supplier_order_id, lines').in('supplier_order_id', legs.map(l => l.id)).order('revision', { ascending: false }),
    db.from('order_items').select('id, description, unit').eq('order_id', orderId),
    db.from('companies').select('id, name').in('id', [...new Set(legs.map(l => l.supplier_id))]),
  ])
  // The first contact of each supplier (the same one the goods chase uses), for Open in WhatsApp / Open in email.
  const contactRows = unwrap(
    await db.from('contacts').select('company_id, name, phone, email').in('company_id', [...new Set(legs.map(l => l.supplier_id))]).order('created_at'),
  )
  const firstContact = new Map<string, { name: string; phone: string | null; email: string | null }>()
  for (const c of contactRows) if (!firstContact.has(c.company_id)) firstContact.set(c.company_id, { name: c.name, phone: c.phone, email: c.email })
  const byItem = new Map(unwrap(items).map(i => [i.id, i]))
  const names = new Map(unwrap(companies).map(c => [c.id, c.name]))
  const seen = new Set<string>()
  const out: import('@/features/purchaseOrders/lib/cancelText').SentPo[] = []
  for (const p of unwrap(pos)) {
    if (seen.has(p.supplier_order_id)) continue // the latest revision of the leg's PO only
    seen.add(p.supplier_order_id)
    const leg = legs.find(l => l.id === p.supplier_order_id)
    const lines = (Array.isArray(p.lines) ? p.lines : []) as Array<{ order_item_id: string; qty: number }>
    out.push({
      ref: `PO-${p.issued_on.slice(2, 4)}-${String(p.number).padStart(4, '0')}`,
      supplierName: names.get(leg?.supplier_id ?? '') ?? 'the supplier',
      items: lines.map(l => ({ description: byItem.get(l.order_item_id)?.description ?? 'Item', qty: Number(l.qty), unit: byItem.get(l.order_item_id)?.unit ?? null })),
      contact: firstContact.get(leg?.supplier_id ?? '') ?? null,
    })
  }
  return out
}

/** delete_po_revision (0092, admin only): the latest revision only. The rows are gone when this resolves; the PDF it names is the caller's to remove. */
export async function deletePoRevision(poId: string): Promise<StoredFile[]> {
  const rows = unwrap(await requireSupabase().rpc('delete_po_revision', { p_po_id: poId })) ?? []
  return rows.map(r => ({ bucket: r.storage_bucket, path: r.storage_path }))
}
