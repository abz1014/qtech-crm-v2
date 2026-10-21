import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import type { TableRow, ViewRow } from '@/features/dbTypes'
import { toBusinessDate } from '@/lib/dates'
import { paisaToFixed, sumPaisa } from '@/lib/money'
import { fetchReceivablesList } from '@/features/money/payments/api'
import type { RawInquiry, RawItem, RawLeg, RawLine, RawOrderItem, RawRfq, SupplierRecordRaw } from '@/features/companies/supplierRecord'
import { phoneKey, type SearchContact } from '@/features/companies/companySearch'
import { companyActivity } from '@/features/companies/listActivity'

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
  city: string | null
  role: CompanyRole | null
  rfqCount: number
  orderCount: number
  /** R2-19: the later of its last RFQ received and its last order date (YYYY-MM-DD); null with neither. Read-only, worked out here. */
  lastActivity: string | null
  updatedAt: string
  /** Its contacts' names and phone digits (phoneKey), so the list search finds a company by a person or a number. */
  contacts: SearchContact[]
}

export interface CompanyDetail {
  id: string
  name: string
  country: string | null
  city: string | null
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

/**
 * Every company with its derived role, how many RFQs and orders it has on either side (companyActivity: a supplier's are the
 * RFQs it was asked about and the orders with a supplier order from it), and its contacts for the search. Seven light reads, joined here.
 */
export async function listCompanies(): Promise<CompanyListRow[]> {
  const db = requireSupabase()
  const [companies, roles, rfqs, orders, asks, legs, contacts] = await Promise.all([
    fetchAll<Pick<TableRow<'companies'>, 'id' | 'name' | 'country' | 'city' | 'updated_at'>>((from, to) =>
      db.from('companies').select('id, name, country, city, updated_at').order('name').range(from, to),
    ),
    fetchAll<Pick<ViewRow<'v_company_roles'>, 'company_id' | 'role'>>((from, to) =>
      db.from('v_company_roles').select('company_id, role').range(from, to),
    ),
    fetchAll<{ id: string; company_id: string; received_on: string | null }>((from, to) =>
      db.from('rfqs').select('id, company_id, received_on').order('id').range(from, to),
    ),
    fetchAll<{ id: string; company_id: string; ordered_on: string | null }>((from, to) =>
      db.from('orders').select('id, company_id, ordered_on').order('id').range(from, to),
    ),
    fetchAll<{ supplier_id: string; rfq_id: string; sent_on: string | null }>((from, to) =>
      db.from('supplier_inquiries').select('supplier_id, rfq_id, sent_on').not('sent_on', 'is', null).order('id').range(from, to),
    ),
    fetchAll<{ supplier_id: string | null; order_id: string; placed_on: string | null; created_at: string }>((from, to) =>
      db.from('supplier_orders').select('supplier_id, order_id, placed_on, created_at').order('id').range(from, to),
    ),
    fetchAll<Pick<TableRow<'contacts'>, 'company_id' | 'name' | 'phone'>>((from, to) =>
      // ordered by id: names repeat ("Accounts"), and only a unique order pages stably across 1000-row pages
      db.from('contacts').select('company_id, name, phone').order('id').range(from, to),
    ),
  ])
  const roleBy = new Map(roles.map(r => [r.company_id, asRole(r.role)]))
  const activity = companyActivity({
    rfqs,
    orders,
    asks,
    legs: legs.flatMap(l => (l.supplier_id ? [{ supplier_id: l.supplier_id, order_id: l.order_id, on: l.placed_on ?? toBusinessDate(new Date(l.created_at)) }] : [])),
  })
  const contactsBy = new Map<string, SearchContact[]>()
  for (const p of contacts) {
    const list = contactsBy.get(p.company_id) ?? []
    list.push({ name: p.name, phoneKey: phoneKey(p.phone) })
    contactsBy.set(p.company_id, list)
  }
  return companies.map(c => ({
    id: c.id,
    name: c.name,
    country: c.country,
    city: c.city,
    role: roleBy.get(c.id) ?? null,
    rfqCount: activity.get(c.id)?.rfqs ?? 0,
    orderCount: activity.get(c.id)?.orders ?? 0,
    lastActivity: activity.get(c.id)?.last ?? null,
    updatedAt: c.updated_at,
    contacts: contactsBy.get(c.id) ?? [],
  }))
}

export interface CompanyHit {
  id: string
  name: string
  country: string | null
  city?: string | null
  role: CompanyRole | null
  /** How many RFQs we have with them (pickers show "2 RFQs"). */
  rfqCount?: number
  /** Found by its first word only, not by the whole text typed: a name that is close, not the same ("similar name"). */
  similar?: boolean
}

/** Escape the characters that mean something to ilike, so typing "50%" searches for "50%". */
const likeEscape = (s: string) => s.replace(/[\\%_]/g, c => `\\${c}`)

/**
 * Name search for the command palette and pickers. Up to `limit` companies whose name contains the text; when the text is
 * several words and there is room, companies that share only its first word follow, marked `similar` ("Mianwali Polymers"
 * finds "Mianwali Plastics Ltd"), so a near duplicate is noticed before a new company is added.
 */
export async function searchCompanies(text: string, limit = 8): Promise<CompanyHit[]> {
  const db = requireSupabase()
  const q = text.trim()
  if (!q) return []
  const rows = unwrap(
    await db.from('companies').select('id, name, country, city').ilike('name', `%${likeEscape(q)}%`).order('name').limit(limit),
  )
  const first = q.split(/\s+/)[0]
  const similarRows =
    q.includes(' ') && first.length >= 3 && rows.length < limit
      ? unwrap(await db.from('companies').select('id, name, country, city').ilike('name', `%${likeEscape(first)}%`).order('name').limit(limit))
          .filter(r => !rows.some(x => x.id === r.id))
          .slice(0, limit - rows.length)
      : []
  const all = [...rows.map(r => ({ ...r, similar: false })), ...similarRows.map(r => ({ ...r, similar: true }))]
  const ids = all.map(r => r.id)
  const [roles, rfqs] = ids.length
    ? await Promise.all([db.from('v_company_roles').select('company_id, role').in('company_id', ids), db.from('rfqs').select('company_id').in('company_id', ids)])
    : [null, null]
  const roleBy = new Map(unwrap(roles ?? { data: [], error: null }).map(r => [r.company_id, asRole(r.role)]))
  const rfqCount = new Map<string, number>()
  const rfqRows = unwrap(rfqs ?? { data: [], error: null })
  for (const r of Array.isArray(rfqRows) ? rfqRows : []) rfqCount.set(r.company_id, (rfqCount.get(r.company_id) ?? 0) + 1)
  return all.map(r => ({ id: r.id, name: r.name, country: r.country, city: r.city, role: roleBy.get(r.id) ?? null, rfqCount: rfqCount.get(r.id) ?? 0, similar: r.similar }))
}

/** Who sent an enquiry, as the PDF or paste reader found it (docread parseEnquiry facts.company). */
export interface SenderHint {
  name: string | null
  domain: string | null
  emails: string[]
  phones: string[]
}

/** "Fauji Cement Company Limited" and "Fauji Cement Co. Ltd" read the same: legal words, dots and case do not count. */
export function companyNameKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/\b(?:limited|ltd|pvt|private|company|co|inc|llc|corporation|corp|the)\b\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/**
 * The company on file that sent this enquiry, or null: a contact with one of its email addresses first, then a contact at its
 * email domain, then a contact with one of its phone numbers, then a company of the same name (legal words aside). `why` says
 * which, for the screen ("Their email is on file").
 */
export async function findCompanyForSender(h: SenderHint): Promise<(CompanyHit & { why: 'email' | 'domain' | 'phone' | 'name' }) | null> {
  const db = requireSupabase()
  const byContact = async (filter: string): Promise<string | null> => {
    const rows = unwrap(await db.from('contacts').select('company_id').or(filter).limit(5))
    return rows[0]?.company_id ?? null
  }
  let id: string | null = null
  let why: 'email' | 'domain' | 'phone' | 'name' = 'email'
  const emails = h.emails.slice(0, 3).map(e => e.replace(/[,()"]/g, ''))
  if (emails.length) id = await byContact(emails.map(e => `email.ilike.${likeEscape(e)}`).join(','))
  if (!id && h.domain && /^[a-z0-9.-]+$/i.test(h.domain)) {
    why = 'domain'
    id = await byContact(`email.ilike.*@${h.domain}`)
  }
  if (!id && h.phones.length) {
    why = 'phone'
    // Stored numbers are written many ways ("0300-1234567", "+92 300 1234567"): match the last 7 digits in order.
    const keys = h.phones.slice(0, 3).map(p => p.replace(/\D/g, '').slice(-7)).filter(k => k.length === 7)
    if (keys.length) id = await byContact(keys.map(k => `phone.ilike.*${k.split('').join('*')}*`).join(','))
  }
  if (id) {
    const row = unwrap(await db.from('companies').select('id, name, country, city').eq('id', id).maybeSingle()) as { id: string; name: string; country: string | null; city: string | null } | null
    if (row) return { ...row, role: null, why }
  }
  const key = h.name ? companyNameKey(h.name) : ''
  if (key.length >= 3) {
    const hits = await searchCompanies(key.split(' ').slice(0, 2).join(' '), 8)
    const same = hits.find(c => companyNameKey(c.name) === key)
    if (same) return { ...same, why: 'name' }
  }
  return null
}

/** A company name as it is saved: no spaces around it, and runs of spaces inside become one ("A  B " is saved "A B"). */
export const tidyCompanyName = (name: string): string => name.replace(/\s+/g, ' ').trim()

/**
 * The key two names are the same company by (HW-33): case, extra spaces and punctuation at the end do not count, so
 * "Hunt  Traders." and "hunt traders" are one company. Stricter than companyNameKey, which also drops legal words.
 */
export const sameCompanyNameKey = (name: string): string =>
  tidyCompanyName(name.normalize('NFKC'))
    .toLowerCase()
    .replace(/[\s.,;:!?'"\-–—/]+$/u, '')

/**
 * The company already on file under this name (sameCompanyNameKey), or null. The unique index only ignores case and
 * surrounding spaces, so this is the check that stops "A  B" or "A B." becoming a second company.
 */
export async function findCompanyByName(name: string): Promise<CompanyHit | null> {
  const db = requireSupabase()
  const key = sameCompanyNameKey(name)
  if (!key) return null
  // Every word in order, anything between and after: finds "A  B" and "A B." for "A B"; the exact match is decided below.
  const pattern = `${key.split(' ').map(likeEscape).join('%')}%`
  const rows = unwrap(await db.from('companies').select('id, name, country').ilike('name', pattern).limit(20))
  const hit = rows.find(r => sameCompanyNameKey(r.name) === key)
  return hit ? { id: hit.id, name: hit.name, country: hit.country, role: null } : null
}

export async function getCompany(id: string): Promise<CompanyDetail | null> {
  const db = requireSupabase()
  const [company, role] = await Promise.all([
    db.from('companies').select('id, name, country, city, notes, created_at, legacy_flags, imported:legacy_source->imported').eq('id', id).maybeSingle(),
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
    legacyImported: c.imported != null || (c.legacy_flags?.length ?? 0) > 0,
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
  /** The role line under the name in the Contacts panel ("Finance", "Procurement Manager"). */
  job_title: string | null
  notes: string | null
  site_id: string | null
}

export async function listContacts(companyId: string): Promise<ContactRow[]> {
  const db = requireSupabase()
  return unwrap(
    await db.from('contacts').select('id, name, phone, email, job_title, notes, site_id').eq('company_id', companyId).order('name'),
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
      .select('id, rfq_id, sent_on, last_chased_on, chase_count, no_offer_on, no_offer_reason, imported:legacy_source->imported')
      .eq('supplier_id', companyId)
      .not('sent_on', 'is', null)
      .order('sent_on', { ascending: false })
      .limit(60),
    db
      .from('supplier_orders')
      .select('id, placed_on, expected_on, received_on, currency, imported:legacy_source->imported, orders!inner(number, cancelled_on)')
      .eq('supplier_id', companyId)
      .order('created_at', { ascending: false })
      .limit(60),
  ])
  const inquiries: RawInquiry[] = unwrap(inqRes).map(i => ({
    id: i.id,
    rfqId: i.rfq_id,
    sentOn: i.sent_on,
    lastChasedOn: i.last_chased_on,
    chaseCount: i.chase_count,
    noOfferOn: i.no_offer_on,
    noOfferReason: i.no_offer_reason,
    legacy: i.imported != null,
  }))
  type OrdRef = { number: number; cancelled_on: string | null }
  type LegRow = {
    id: string
    placed_on: string | null
    expected_on: string | null
    received_on: string | null
    currency: string | null
    imported: unknown
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
          .select('id, inquiry_id, rfq_item_id, unit_price, currency, lead_time, fx_rate_pkr, fx_rate_on, created_at, legacy_flags, imported:legacy_source->imported')
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
    legacy: l.imported != null,
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
      legacy: l.imported != null,
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
  closeReason: string | null
  orderNumber: number | null
  /** The first item's description, and how many more there are: the "What" column. */
  what: string | null
  moreItems: number
}
export interface HistoryOrder {
  id: string
  number: number
  siteId: string | null
  orderedOn: string | null
  rfqId: string | null
  lifecycle: string | null
  goods: string | null
  invoicing: string | null
  /** True when the order is past its payment due date with a balance (admin and sales only; null for engineers). */
  paymentOverdue: boolean | null
  what: string | null
  moreItems: number
}
export interface CompanyHistory {
  rfqs: HistoryRfq[]
  orders: HistoryOrder[]
}

/**
 * The company's RFQs and orders, for the site-by-site list. Status values come straight from the state views.
 * `withPayment` (admin and sales) also reads order_receivables() for the "Payment overdue" chip; an engineer's call to it is
 * refused by the database, so it is never made for them.
 */
export async function getCompanyHistory(companyId: string, withPayment = false): Promise<CompanyHistory> {
  const db = requireSupabase()
  const [rfqs, rfqState, orders, orderState] = await Promise.all([
    db
      .from('rfqs')
      .select('id, number, site_id, received_on, due_on, customer_ref, close_reason')
      .eq('company_id', companyId)
      .order('received_on', { ascending: false }),
    db.from('v_rfq_state').select('rfq_id, outcome').eq('company_id', companyId),
    db
      .from('orders')
      .select('id, number, site_id, ordered_on, rfq_id')
      .eq('company_id', companyId)
      .order('ordered_on', { ascending: false, nullsFirst: false }),
    db.from('v_order_state').select('order_id, lifecycle, goods_state, invoicing_state').eq('company_id', companyId),
  ])
  const outcomeBy = new Map(unwrap(rfqState).map(s => [s.rfq_id, s.outcome]))
  const stateBy = new Map(unwrap(orderState).map(s => [s.order_id, s]))
  const orderRows = unwrap(orders)
  const rfqRows = unwrap(rfqs)
  const orderNumberByRfq = new Map(orderRows.filter(o => o.rfq_id).map(o => [o.rfq_id as string, o.number]))

  // "What": the first item of each RFQ and of each order (by position), with how many more there are.
  const [rfqItems, orderItems, receivables] = await Promise.all([
    inBatches(
      rfqRows.map(r => r.id),
      b => db.from('rfq_items').select('rfq_id, description, position').in('rfq_id', b),
    ),
    inBatches(
      orderRows.map(o => o.id),
      b => db.from('order_items').select('order_id, description, position, is_service').in('order_id', b),
    ),
    // this company's overdue orders only, filtered on the server (it used to read order_receivables() for every order in the database)
    withPayment && orderRows.length > 0
      ? fetchReceivablesList({ p_company_id: companyId, p_state: 'overdue' }).then(
          data => ({ data, error: null }),
          (error: unknown) => ({ data: null, error }),
        )
      : Promise.resolve(null),
  ])
  const firstOf = <T extends { description: string; position: number }>(rows: T[], key: (r: T) => string) => {
    const by = new Map<string, T[]>()
    for (const r of rows) by.set(key(r), [...(by.get(key(r)) ?? []), r])
    return (id: string) => {
      const list = (by.get(id) ?? []).sort((a, b) => a.position - b.position)
      return { what: list[0]?.description ?? null, more: Math.max(list.length - 1, 0) }
    }
  }
  const rfqWhat = firstOf(rfqItems, r => r.rfq_id)
  const orderWhat = firstOf(
    orderItems.filter(i => !i.is_service),
    r => r.order_id,
  )
  const overdue = new Set<string>()
  if (receivables && !receivables.error) {
    for (const r of receivables.data ?? []) if (r.is_overdue && r.order_id) overdue.add(r.order_id)
  }
  return {
    rfqs: rfqRows.map(r => ({
      id: r.id,
      number: r.number,
      siteId: r.site_id,
      receivedOn: r.received_on,
      dueOn: r.due_on,
      customerRef: r.customer_ref,
      outcome: outcomeBy.get(r.id) ?? null,
      closeReason: r.close_reason,
      orderNumber: orderNumberByRfq.get(r.id) ?? null,
      what: rfqWhat(r.id).what,
      moreItems: rfqWhat(r.id).more,
    })),
    orders: orderRows.map(o => ({
      id: o.id,
      number: o.number,
      siteId: o.site_id,
      orderedOn: o.ordered_on,
      rfqId: o.rfq_id,
      lifecycle: stateBy.get(o.id)?.lifecycle ?? null,
      goods: stateBy.get(o.id)?.goods_state ?? null,
      invoicing: stateBy.get(o.id)?.invoicing_state ?? null,
      paymentOverdue: withPayment && receivables && !receivables.error ? overdue.has(o.id) : null,
      what: orderWhat(o.id).what,
      moreItems: orderWhat(o.id).more,
    })),
  }
}

export interface CompanyMoney {
  /** Gross invoiced (or the order lines' gross before an invoice), GST included: what they owe in all. */
  receivable: number
  /** Received from them. */
  settled: number
  /** Still owed: the sum of each order's balance (an overpaid order counts 0 here, its excess is `overpaid`). */
  balance: number
  /** Paid above an order's gross, kept apart, never netted into the balance. */
  overpaid: number
  orders: number
}

/**
 * ADMIN ONLY (the screen hides the panel). Totals over the company's orders exactly as the Receivables page lists them
 * (receivables_list for the company, over order_receivables: D-MR3 leaves out a cancelled order that was never invoiced), summed
 * in exact paisa.
 */
export async function getCompanyMoney(companyId: string): Promise<CompanyMoney> {
  const rows = await fetchReceivablesList({ p_company_id: companyId })
  const total = (k: 'gross_target' | 'settled' | 'balance' | 'overpaid_by') => Number(paisaToFixed(sumPaisa(rows.map(r => r[k] ?? 0))))
  return { receivable: total('gross_target'), settled: total('settled'), balance: total('balance'), overpaid: total('overpaid_by'), orders: rows.length }
}

// ---------------------------------------------------------------- writes

export interface NewCompany {
  /** The client-generated request id: a retry of the same save cannot add a second row. */
  id: string
  name: string
  country?: string | null
  notes?: string | null
  city?: string | null
}

export async function createCompany(input: NewCompany): Promise<{ id: string; name: string }> {
  const db = requireSupabase()
  return unwrap(
    await db
      .from('companies')
      .insert({
        id: input.id,
        name: tidyCompanyName(input.name),
        country: input.country?.trim() || null,
        notes: input.notes?.trim() || null,
        city: input.city?.trim() || null,
      })
      .select('id, name')
      .single(),
  )
}

export async function updateCompany(id: string, patch: { name?: string; country?: string | null; city?: string | null; notes?: string | null }) {
  const db = requireSupabase()
  const next = {
    ...(patch.name !== undefined ? { name: tidyCompanyName(patch.name) } : {}),
    ...(patch.country !== undefined ? { country: patch.country?.trim() || null } : {}),
    ...(patch.city !== undefined ? { city: patch.city?.trim() || null } : {}),
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
  jobTitle?: string | null
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
        job_title: input.jobTitle?.trim() || null,
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
  patch: { name: string; siteId?: string | null; phone?: string | null; email?: string | null; jobTitle?: string | null; notes?: string | null },
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
        job_title: patch.jobTitle?.trim() || null,
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
