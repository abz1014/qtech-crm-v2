import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import type { TableRow, ViewRow } from '@/features/dbTypes'
import { toBusinessDate } from '@/lib/dates'
import type { RawInquiry, RawItem, RawLeg, RawLine, RawOrderItem, RawRfq, SupplierRecordRaw } from '@/features/companies/supplierRecord'

/*
 * Companies: every database call for this area (R01 reference implementation). This is the only
 * file that names a companies table or view. Hooks (hooks.ts) wrap these in TanStack Query; nothing
 * else talks to Supabase. Access follows DATA_MODEL section 10 and is enforced by Row Level
 * Security, not here: engineers and sales read every column below, and the one money read
 * (getCompanyMoney) is a view that only an admin can select from.
 */

export type CompanyRole = 'customer' | 'supplier' | 'both' | 'prospect'

export interface CompanyListRow {
  id: string
  name: string
  country: string | null
  role: CompanyRole | null
  rfqCount: number
  orderCount: number
  updatedAt: string
}

export interface CompanyDetail {
  id: string
  name: string
  country: string | null
  /** companies.city (0038): optional, shown beside the name where a mockup shows a place. */
  city?: string | null
  notes: string | null
  createdAt: string
  role: CompanyRole | null
  isCustomer: boolean
  isSupplier: boolean
  legacyImported: boolean
}

function asRole(r: string | null | undefined): CompanyRole | null {
  return r === 'customer' || r === 'supplier' || r === 'both' || r === 'prospect' ? r : null
}

/** Every company with its derived role and how many RFQs and orders it has. Four light reads, joined here. */
export async function listCompanies(): Promise<CompanyListRow[]> {
  const db = requireSupabase()
  const [companies, roles, rfqs, orders] = await Promise.all([
    fetchAll<Pick<TableRow<'companies'>, 'id' | 'name' | 'country' | 'updated_at'>>((from, to) =>
      db.from('companies').select('id, name, country, updated_at').order('name').range(from, to),
    ),
    fetchAll<Pick<ViewRow<'v_company_roles'>, 'company_id' | 'role'>>((from, to) =>
      db.from('v_company_roles').select('company_id, role').range(from, to),
    ),
    fetchAll<{ company_id: string }>((from, to) => db.from('rfqs').select('company_id').range(from, to)),
    fetchAll<{ company_id: string }>((from, to) => db.from('orders').select('company_id').range(from, to)),
  ])
  const roleBy = new Map(roles.map(r => [r.company_id, asRole(r.role)]))
  const count = (rows: { company_id: string }[]) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(r.company_id, (m.get(r.company_id) ?? 0) + 1)
    return m
  }
  const rfqBy = count(rfqs)
  const orderBy = count(orders)
  return companies.map(c => ({
    id: c.id,
    name: c.name,
    country: c.country,
    role: roleBy.get(c.id) ?? null,
    rfqCount: rfqBy.get(c.id) ?? 0,
    orderCount: orderBy.get(c.id) ?? 0,
    updatedAt: c.updated_at,
  }))
}

export interface CompanyHit {
  id: string
  name: string
  country: string | null
  city?: string | null
  role: CompanyRole | null
}

/** Escape the characters that mean something to ilike, so typing "50%" searches for "50%". */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, c => `\\${c}`)

/** Name search for the command palette and pickers. Up to `limit` companies whose name contains the text. */
export async function searchCompanies(text: string, limit = 8): Promise<CompanyHit[]> {
  const db = requireSupabase()
  const q = text.trim()
  if (!q) return []
  const rows = unwrap(
    await db.from('companies').select('id, name, country, city').ilike('name', `%${likeEscape(q)}%`).order('name').limit(limit),
  )
  const ids = rows.map(r => r.id)
  const roles = ids.length ? unwrap(await db.from('v_company_roles').select('company_id, role').in('company_id', ids)) : []
  const roleBy = new Map(roles.map(r => [r.company_id, asRole(r.role)]))
  return rows.map(r => ({ id: r.id, name: r.name, country: r.country, city: r.city, role: roleBy.get(r.id) ?? null }))
}

/** The company whose name equals `name` ignoring case and surrounding spaces, as the unique index sees it. */
export async function findCompanyByName(name: string): Promise<CompanyHit | null> {
  const db = requireSupabase()
  const wanted = name.trim()
  if (!wanted) return null
  const rows = unwrap(await db.from('companies').select('id, name, country').ilike('name', likeEscape(wanted)).limit(5))
  const hit = rows.find(r => r.name.trim().toLowerCase() === wanted.toLowerCase())
  return hit ? { id: hit.id, name: hit.name, country: hit.country, role: null } : null
}

export async function getCompany(id: string): Promise<CompanyDetail | null> {
  const db = requireSupabase()
  const [company, role] = await Promise.all([
    db.from('companies').select('id, name, country, city, notes, created_at, legacy_flags, legacy_source').eq('id', id).maybeSingle(),
    db.from('v_company_roles').select('role, is_customer, is_supplier').eq('company_id', id).maybeSingle(),
  ])
  const c = unwrap(company)
  if (!c) return null
  const r = unwrap(role)
  return {
    id: c.id,
    name: c.name,
    country: c.country,
    city: c.city,
    notes: c.notes,
    createdAt: c.created_at,
    role: asRole(r?.role),
    isCustomer: r?.is_customer ?? false,
    isSupplier: r?.is_supplier ?? false,
    legacyImported: c.legacy_source !== null || (c.legacy_flags?.length ?? 0) > 0,
  }
}

export interface SiteRow {
  id: string
  name: string
  address: string | null
}

export async function listSites(companyId: string): Promise<SiteRow[]> {
  const db = requireSupabase()
  return unwrap(await db.from('company_sites').select('id, name, address').eq('company_id', companyId).order('name'))
}

export interface ContactRow {
  id: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  site_id: string | null
}

export async function listContacts(companyId: string): Promise<ContactRow[]> {
  const db = requireSupabase()
  return unwrap(
    await db.from('contacts').select('id, name, phone, email, notes, site_id').eq('company_id', companyId).order('name'),
  )
}

export interface CarriedBrand {
  brandId: string
  name: string
  kind: 'brand' | 'family'
}

export async function listCompanyBrands(companyId: string): Promise<CarriedBrand[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('company_brands').select('brand_id, brands(name, kind)').eq('company_id', companyId))
  return rows
    .map(r => {
      const b = Array.isArray(r.brands) ? r.brands[0] : r.brands
      return b
        ? { brandId: r.brand_id, name: b.name, kind: (b.kind === 'family' ? 'family' : 'brand') as CarriedBrand['kind'] }
        : null
    })
    .filter((b): b is CarriedBrand => b !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listBrands() {
  const db = requireSupabase()
  return fetchAll<Pick<TableRow<'brands'>, 'id' | 'name' | 'kind'>>((from, to) =>
    db.from('brands').select('id, name, kind').order('name').range(from, to),
  )
}

export type SupplierStats = ViewRow<'v_supplier_stats'>

export async function getSupplierStats(companyId: string): Promise<SupplierStats | null> {
  const db = requireSupabase()
  return unwrap(await db.from('v_supplier_stats').select('*').eq('supplier_id', companyId).maybeSingle())
}

export interface SupplierEnquiry {
  inquiryId: string
  rfqId: string
  rfqNumber: number | null
  sentOn: string
  replied: boolean
  quoted: boolean
  noOffer: boolean
  replyDays: number | null
  isLegacy: boolean
}

/** The supplier's sent enquiries of the last 24 months (v_supplier_activity), newest first, with the RFQ number. */
export async function getSupplierActivity(companyId: string): Promise<SupplierEnquiry[]> {
  const db = requireSupabase()
  const rows = unwrap(
    await db
      .from('v_supplier_activity')
      .select('inquiry_id, rfq_id, sent_on, replied, quoted, no_offer, reply_days, is_legacy')
      .eq('supplier_id', companyId)
      .order('sent_on', { ascending: false })
      .limit(50),
  )
  const rfqIds = [...new Set(rows.map(r => r.rfq_id).filter((x): x is string => !!x))]
  const numbers = rfqIds.length ? unwrap(await db.from('rfqs').select('id, number').in('id', rfqIds)) : []
  const numberBy = new Map(numbers.map(n => [n.id, n.number]))
  return rows.map(r => ({
    inquiryId: r.inquiry_id ?? '',
    rfqId: r.rfq_id ?? '',
    rfqNumber: numberBy.get(r.rfq_id ?? '') ?? null,
    sentOn: r.sent_on ?? '',
    replied: r.replied ?? false,
    quoted: r.quoted ?? false,
    noOffer: r.no_offer ?? false,
    replyDays: r.reply_days,
    isLegacy: r.is_legacy ?? false,
  }))
}

const IN_CHUNK = 80
function chunks<T>(list: readonly T[], size = IN_CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
/** Several `in (...)` reads of at most IN_CHUNK ids each, run together, so a long list never makes a request line too long. */
async function inBatches<T>(
  ids: readonly string[],
  read: (batch: string[]) => PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>,
): Promise<T[]> {
  const parts = await Promise.all(chunks([...new Set(ids)]).map(async b => unwrap(await read(b)) ?? []))
  return parts.flat()
}

type Rel<T> = T | T[] | null | undefined
const one = <T>(v: Rel<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

/** How many times this supplier quoted an item of each brand or family ("quoted 4x"). Guessed imported items are left out. */
export async function getSupplierBrandQuotes(companyId: string): Promise<Record<string, number>> {
  const db = requireSupabase()
  type Row = { legacy_flags: string[]; rfq_items: Rel<{ brand_id: string | null; family_id: string | null }> }
  const rows = (await fetchAll((from, to) =>
    db
      .from('supplier_quote_lines')
      .select('legacy_flags, rfq_items!inner(brand_id, family_id), supplier_inquiries!inner(supplier_id)')
      .eq('supplier_inquiries.supplier_id', companyId)
      .range(from, to),
  )) as unknown as Row[]
  const counts: Record<string, number> = {}
  for (const r of rows) {
    if (r.legacy_flags?.includes('item_guessed')) continue
    const it = one(r.rfq_items)
    for (const id of [it?.brand_id, it?.family_id]) if (id) counts[id] = (counts[id] ?? 0) + 1
  }
  return counts
}

/**
 * Everything the supplier's recent quotes, deliveries and "Open with them" panels say, as plain rows
 * (supplierRecord.ts turns them into the display). Reads the newest 60 enquiries and 60 legs with this supplier.
 */
export async function getSupplierRecord(companyId: string): Promise<SupplierRecordRaw> {
  const db = requireSupabase()
  const [inqRes, legRes] = await Promise.all([
    db
      .from('supplier_inquiries')
      .select('id, rfq_id, sent_on, last_chased_on, no_offer_on, no_offer_reason, legacy_source')
      .eq('supplier_id', companyId)
      .not('sent_on', 'is', null)
      .order('sent_on', { ascending: false })
      .limit(60),
    db
      .from('supplier_orders')
      .select('id, placed_on, expected_on, received_on, currency, legacy_source, orders!inner(number, cancelled_on)')
      .eq('supplier_id', companyId)
      .order('created_at', { ascending: false })
      .limit(60),
  ])
  const inquiries: RawInquiry[] = unwrap(inqRes).map(i => ({
    id: i.id,
    rfqId: i.rfq_id,
    sentOn: i.sent_on,
    lastChasedOn: i.last_chased_on,
    noOfferOn: i.no_offer_on,
    noOfferReason: i.no_offer_reason,
    legacy: i.legacy_source !== null,
  }))
  type OrdRef = { number: number; cancelled_on: string | null }
  type LegRow = {
    id: string
    placed_on: string | null
    expected_on: string | null
    received_on: string | null
    currency: string | null
    legacy_source: unknown
    orders: Rel<OrdRef>
  }
  const legRows = unwrap(legRes) as unknown as LegRow[]
  const rfqIds = [...new Set(inquiries.map(i => i.rfqId))]

  const [lineRows, itemRows, rfqRows, poRows] = await Promise.all([
    inBatches(
      inquiries.map(i => i.id),
      b =>
        db
          .from('supplier_quote_lines')
          .select('id, inquiry_id, rfq_item_id, unit_price, currency, lead_time, fx_rate_pkr, fx_rate_on, created_at, legacy_flags, legacy_source')
          .in('inquiry_id', b),
    ),
    inBatches(rfqIds, b => db.from('rfq_items').select('id, rfq_id, position, description, qty, unit, brand_id').in('rfq_id', b)),
    inBatches(rfqIds, b => db.from('rfqs').select('id, number, closed_on').in('id', b)),
    inBatches(
      legRows.map(l => l.id),
      b => db.from('purchase_orders').select('supplier_order_id, number, revision, issued_on').in('supplier_order_id', b),
    ),
  ])
  const brandIds = itemRows.map(i => i.brand_id).filter((x): x is string => !!x)
  type OiRow = { rfq_item_id: string | null; orders: Rel<OrdRef>; supplier_orders: Rel<{ supplier_id: string }> }
  const [brandRows, orderItemRows] = await Promise.all([
    inBatches(brandIds, b => db.from('brands').select('id, name').in('id', b)),
    inBatches(
      lineRows.map(l => l.rfq_item_id),
      b => db.from('order_items').select('rfq_item_id, orders!inner(number, cancelled_on), supplier_orders(supplier_id)').in('rfq_item_id', b),
    ),
  ])
  const brandName = new Map(brandRows.map(b => [b.id, b.name]))

  const lines: RawLine[] = lineRows.map(l => ({
    id: l.id,
    inquiryId: l.inquiry_id,
    itemId: l.rfq_item_id,
    unitPrice: Number(l.unit_price),
    currency: l.currency.trim(),
    leadTime: l.lead_time,
    fxRatePkr: l.fx_rate_pkr === null ? null : Number(l.fx_rate_pkr),
    fxRateOn: l.fx_rate_on,
    enteredOn: toBusinessDate(new Date(l.created_at)),
    hidden: l.legacy_flags.includes('currency_unverified'),
    legacy: l.legacy_source !== null,
  }))
  const items: RawItem[] = itemRows.map(i => ({
    id: i.id,
    rfqId: i.rfq_id,
    position: i.position,
    description: i.description,
    qty: Number(i.qty),
    unit: i.unit,
    brandName: i.brand_id ? (brandName.get(i.brand_id) ?? null) : null,
  }))
  const rfqs: RawRfq[] = rfqRows.map(r => ({ id: r.id, number: r.number, closedOn: r.closed_on }))
  const orderItems: RawOrderItem[] = (orderItemRows as unknown as OiRow[])
    .filter(o => o.rfq_item_id)
    .map(o => {
      const ord = one(o.orders)
      return { itemId: o.rfq_item_id as string, orderNumber: ord?.number ?? 0, cancelled: Boolean(ord?.cancelled_on), supplierId: one(o.supplier_orders)?.supplier_id ?? null }
    })
  const latestPo = new Map<string, { number: number; revision: number; issuedOn: string }>()
  for (const p of poRows) {
    const cur = latestPo.get(p.supplier_order_id)
    if (!cur || p.revision > cur.revision) latestPo.set(p.supplier_order_id, { number: p.number, revision: p.revision, issuedOn: p.issued_on })
  }
  const legs: RawLeg[] = legRows.map(l => {
    const ord = one(l.orders)
    return {
      id: l.id,
      orderNumber: ord?.number ?? 0,
      cancelled: Boolean(ord?.cancelled_on),
      placedOn: l.placed_on,
      expectedOn: l.expected_on,
      receivedOn: l.received_on,
      legacy: l.legacy_source !== null,
      currency: l.currency?.trim() ?? null,
      po: latestPo.get(l.id) ?? null,
    }
  })
  return { supplierId: companyId, inquiries, lines, items, rfqs, orderItems, legs }
}

export interface HistoryRfq {
  id: string
  number: number
  siteId: string | null
  receivedOn: string
  dueOn: string | null
  customerRef: string | null
  outcome: string | null
  orderNumber: number | null
}
export interface HistoryOrder {
  id: string
  number: number
  siteId: string | null
  orderedOn: string | null
  rfqId: string | null
  lifecycle: string | null
  invoicing: string | null
}
export interface CompanyHistory {
  rfqs: HistoryRfq[]
  orders: HistoryOrder[]
}

/** The company's RFQs and orders, for the site-by-site list. Status values come straight from the state views. */
export async function getCompanyHistory(companyId: string): Promise<CompanyHistory> {
  const db = requireSupabase()
  const [rfqs, rfqState, orders, orderState] = await Promise.all([
    db
      .from('rfqs')
      .select('id, number, site_id, received_on, due_on, customer_ref')
      .eq('company_id', companyId)
      .order('received_on', { ascending: false }),
    db.from('v_rfq_state').select('rfq_id, outcome').eq('company_id', companyId),
    db
      .from('orders')
      .select('id, number, site_id, ordered_on, rfq_id')
      .eq('company_id', companyId)
      .order('ordered_on', { ascending: false, nullsFirst: false }),
    db.from('v_order_state').select('order_id, lifecycle, invoicing_state').eq('company_id', companyId),
  ])
  const outcomeBy = new Map(unwrap(rfqState).map(s => [s.rfq_id, s.outcome]))
  const stateBy = new Map(unwrap(orderState).map(s => [s.order_id, s]))
  const orderRows = unwrap(orders)
  const orderNumberByRfq = new Map(orderRows.filter(o => o.rfq_id).map(o => [o.rfq_id as string, o.number]))
  return {
    rfqs: unwrap(rfqs).map(r => ({
      id: r.id,
      number: r.number,
      siteId: r.site_id,
      receivedOn: r.received_on,
      dueOn: r.due_on,
      customerRef: r.customer_ref,
      outcome: outcomeBy.get(r.id) ?? null,
      orderNumber: orderNumberByRfq.get(r.id) ?? null,
    })),
    orders: orderRows.map(o => ({
      id: o.id,
      number: o.number,
      siteId: o.site_id,
      orderedOn: o.ordered_on,
      rfqId: o.rfq_id,
      lifecycle: stateBy.get(o.id)?.lifecycle ?? null,
      invoicing: stateBy.get(o.id)?.invoicing_state ?? null,
    })),
  }
}

export interface CompanyMoney {
  receivable: number
  settled: number
  balance: number
  orders: number
}

/** ADMIN ONLY (v_order_money refuses anyone else; the screen also hides the panel). Totals over the company's orders. */
export async function getCompanyMoney(companyId: string): Promise<CompanyMoney> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('v_order_money').select('receivable, settled').eq('company_id', companyId))
  let receivable = 0
  let settled = 0
  for (const r of rows) {
    receivable += Number(r.receivable ?? 0)
    settled += Number(r.settled ?? 0)
  }
  return { receivable, settled, balance: receivable - settled, orders: rows.length }
}

// ---------------------------------------------------------------- writes

export interface NewCompany {
  /** The client-generated request id: a retry of the same save cannot add a second row. */
  id: string
  name: string
  country?: string | null
  city?: string | null
  notes?: string | null
}

export async function createCompany(input: NewCompany): Promise<{ id: string; name: string }> {
  const db = requireSupabase()
  return unwrap(
    await db
      .from('companies')
      .insert({
        id: input.id,
        name: input.name.trim(),
        country: input.country?.trim() || null,
        ...(input.city !== undefined ? { city: input.city?.trim() || null } : {}),
        notes: input.notes?.trim() || null,
      })
      .select('id, name')
      .single(),
  )
}

export async function updateCompany(id: string, patch: { name?: string; country?: string | null; notes?: string | null }) {
  const db = requireSupabase()
  const next = {
    ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
    ...(patch.country !== undefined ? { country: patch.country?.trim() || null } : {}),
    ...(patch.notes !== undefined ? { notes: patch.notes?.trim() || null } : {}),
  }
  unwrap(await db.from('companies').update(next).eq('id', id).select('id').single())
}

export async function addSite(input: { id: string; companyId: string; name: string; address?: string | null }) {
  const db = requireSupabase()
  unwrap(
    await db
      .from('company_sites')
      .insert({ id: input.id, company_id: input.companyId, name: input.name.trim(), address: input.address?.trim() || null })
      .select('id')
      .single(),
  )
}

export async function addContact(input: {
  id: string
  companyId: string
  siteId?: string | null
  name: string
  phone?: string | null
  email?: string | null
  notes?: string | null
}) {
  const db = requireSupabase()
  unwrap(
    await db
      .from('contacts')
      .insert({
        id: input.id,
        company_id: input.companyId,
        site_id: input.siteId || null,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        notes: input.notes?.trim() || null,
      })
      .select('id')
      .single(),
  )
}

export async function updateSite(id: string, patch: { name: string; address?: string | null }) {
  const db = requireSupabase()
  unwrap(await db.from('company_sites').update({ name: patch.name.trim(), address: patch.address?.trim() || null }).eq('id', id).select('id').single())
}

export async function updateContact(
  id: string,
  patch: { name: string; siteId?: string | null; phone?: string | null; email?: string | null; notes?: string | null },
) {
  const db = requireSupabase()
  unwrap(
    await db
      .from('contacts')
      .update({
        name: patch.name.trim(),
        site_id: patch.siteId || null,
        phone: patch.phone?.trim() || null,
        email: patch.email?.trim() || null,
        notes: patch.notes?.trim() || null,
      })
      .eq('id', id)
      .select('id')
      .single(),
  )
}

/**
 * Raised when a site or contact cannot be removed because RFQs, orders or quotations still point at it. The
 * foreign keys are ON DELETE RESTRICT, so the database refuses with 23503 and this carries the counts, read
 * only after that refusal, to say how many. `code` stays 23503 so mapPgError-style handling treats it alike.
 */
export class InUseError extends Error {
  readonly code = '23503'
  constructor(readonly noun: 'site' | 'contact', readonly uses: { rfqs: number; orders: number; quotations: number }) {
    super(inUseSentence(noun, uses))
    this.name = 'InUseError'
  }
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function inUseSentence(noun: string, u: { rfqs: number; orders: number; quotations: number }): string {
  const parts = [u.rfqs > 0 ? count(u.rfqs, 'RFQ') : '', u.orders > 0 ? count(u.orders, 'order') : '', u.quotations > 0 ? count(u.quotations, 'quotation') : ''].filter(Boolean)
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  return `This ${noun} is used on ${list}; it can't be removed.`
}

/** How many rows of RFQs, orders and quotations point at a site or contact. */
async function countRefs(kind: 'site' | 'contact', id: string) {
  const db = requireSupabase()
  const col = kind === 'site' ? 'site_id' : 'contact_id'
  const n = async (q: PromiseLike<{ data: unknown[] | null; error: { code?: string; message: string } | null }>) => (unwrap(await q) ?? []).length
  const [rfqs, orders, quotations] = await Promise.all([
    n(db.from('rfqs').select('id').eq(col, id)),
    n(db.from('orders').select('id').eq(col, id)),
    kind === 'contact' ? n(db.from('quotations').select('id').eq('contact_id', id)) : Promise.resolve(0),
  ])
  return { rfqs, orders, quotations }
}

/** Delete a site or contact. The database refuses (23503) while anything uses it; only then are the uses counted. */
async function removeRow(table: 'company_sites' | 'contacts', kind: 'site' | 'contact', companyId: string, id: string) {
  const db = requireSupabase()
  const res = await db.from(table).delete().eq('id', id).eq('company_id', companyId).select('id')
  if (res.error?.code === '23503') {
    const uses = await countRefs(kind, id)
    if (uses.rfqs + uses.orders + uses.quotations > 0) throw new InUseError(kind, uses)
  }
  unwrap(res)
}

/** Remove a site. Throws InUseError if an RFQ or order is filed under it (the database refuses; nothing is unfiled). */
export function removeSite(companyId: string, id: string) {
  return removeRow('company_sites', 'site', companyId, id)
}

/** Remove a contact. Throws InUseError if an RFQ, order or quotation names them. */
export function removeContact(companyId: string, id: string) {
  return removeRow('contacts', 'contact', companyId, id)
}

/** Stop carrying a brand. Only the link goes: the brand itself and any quotes for it stay. */
export async function unlinkBrand(companyId: string, brandId: string) {
  const db = requireSupabase()
  unwrap(await db.from('company_brands').delete().eq('company_id', companyId).eq('brand_id', brandId).select('brand_id'))
}

/** Link a brand (or family) to a company. Idempotent: carrying it twice is not an error. */
export async function linkBrand(companyId: string, brandId: string) {
  const db = requireSupabase()
  unwrap(
    await db
      .from('company_brands')
      .upsert({ company_id: companyId, brand_id: brandId }, { onConflict: 'company_id,brand_id', ignoreDuplicates: true }),
  )
}

/** Create a brand by typing its name; if it already exists (any case) the existing one is returned. */
export async function createBrand(input: {
  id: string
  name: string
  kind?: 'brand' | 'family'
}): Promise<{ id: string; name: string }> {
  const db = requireSupabase()
  const name = input.name.trim()
  const made = await db.from('brands').insert({ id: input.id, name, kind: input.kind ?? 'brand' }).select('id, name').single()
  if (!made.error) return made.data
  if (made.error.code !== '23505') throw made.error
  const found = unwrap(await db.from('brands').select('id, name').ilike('name', likeEscape(name)).limit(5))
  const same = found.find(b => b.name.trim().toLowerCase() === name.toLowerCase())
  if (!same) throw made.error
  return same
}

/** Admin only (the function checks). Moves everything on `dropId` onto `keepId`, then deletes `dropId`. */
export async function mergeCompanies(keepId: string, dropId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('merge_companies', { p_keep: keepId, p_drop: dropId })
  if (error) throw error
}
