import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import type { ViewRow } from '@/features/dbTypes'
import { searchAll, type SearchHit } from '@/features/search/api'

/*
 * Jobs (redesign phase 5, migration 0099): the ONLY file of this area that names v_jobs and the tables beside it.
 *
 * A job is a read-only view over rfqs and orders (no fake rows): job_key '139' is an RFQ with its live order, 'O-45' an order with
 * no RFQ. The view holds no price, amount or rate, so an engineer reads it as it is; the customer and owner names come from
 * the tables every role may already read. Names and engineers are joined here, not in the view.
 */
export type JobKind = 'enquiry' | 'direct'

export interface JobRow {
  /** '139' or 'O-45': what the address, the search and "Job 139" use. */
  key: string
  kind: JobKind
  rfqId: string | null
  orderId: string | null
  companyId: string
  companyName: string
  siteName: string | null
  ownerId: string | null
  ownerName: string | null
  /** The first item and "+2 more" (an order's lines once there is an order, else the enquiry's). */
  items: string
  stage: string | null
  stageDetail: string | null
  isHistory: boolean
  lastActivityOn: string | null
  /** "Repeat of Job 139": the key of the job this one repeats. */
  repeatOf: string | null
  cancelledOrders: number
  /** The engineers put on the job's order (an engineer's "Mine"). */
  engineerIds: string[]
  /** The enquiry or the order came from the old CRM (legacy_source set): a live job, but it raises no task and is never red (owner decision 1b). */
  imported?: boolean
}

type JobView = ViewRow<'v_jobs'>
const JOB_COLUMNS = 'job_key, kind, rfq_id, order_id, company_id, site_id, owner_id, items_summary, stage, stage_detail, is_history, last_activity_on, repeat_of_job_key, cancelled_orders'
type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>

interface Names {
  companies: Map<string, string>
  sites: Map<string, string>
  users: Map<string, string>
  engineers: Map<string, string[]>
  /** Ids of imported orders and RFQs (the ids only: legacy_source itself may hold old prices and is never read). */
  importedOrders: Set<string>
  importedRfqs: Set<string>
}

function shape(v: JobView, n: Names): JobRow | null {
  if (!v.job_key || !v.company_id) return null
  return {
    key: v.job_key,
    kind: v.kind === 'direct' ? 'direct' : 'enquiry',
    rfqId: v.rfq_id,
    orderId: v.order_id,
    companyId: v.company_id,
    companyName: n.companies.get(v.company_id) ?? 'Unknown company',
    siteName: v.site_id ? (n.sites.get(v.site_id) ?? null) : null,
    ownerId: v.owner_id,
    ownerName: v.owner_id ? (n.users.get(v.owner_id) ?? null) : null,
    items: v.items_summary ?? '',
    stage: v.stage,
    stageDetail: v.stage_detail,
    isHistory: v.is_history === true,
    lastActivityOn: v.last_activity_on,
    repeatOf: v.repeat_of_job_key,
    cancelledOrders: Number(v.cancelled_orders ?? 0),
    engineerIds: v.order_id ? (n.engineers.get(v.order_id) ?? []) : [],
    imported: Boolean((v.order_id && n.importedOrders.has(v.order_id)) || (v.rfq_id && n.importedRfqs.has(v.rfq_id))),
  }
}

const CHUNK = 100
function slices<T>(ids: T[]): T[][] {
  return Array.from({ length: Math.ceil(ids.length / CHUNK) }, (_, i) => ids.slice(i * CHUNK, (i + 1) * CHUNK))
}

async function namesFor(rows: JobView[]): Promise<Names> {
  const db = requireSupabase()
  const companyIds = [...new Set(rows.map(r => r.company_id).filter((x): x is string => !!x))]
  const siteIds = [...new Set(rows.map(r => r.site_id).filter((x): x is string => !!x))]
  const orderIds = [...new Set(rows.map(r => r.order_id).filter((x): x is string => !!x))]
  const rfqIds = [...new Set(rows.map(r => r.rfq_id).filter((x): x is string => !!x))]
  const [companies, sites, users, engineers, impOrders, impRfqs] = await Promise.all([
    Promise.all(slices(companyIds).map(async ids => unwrap(await db.from('companies').select('id, name').in('id', ids)))),
    Promise.all(slices(siteIds).map(async ids => unwrap(await db.from('company_sites').select('id, name').in('id', ids)))),
    db.from('users').select('id, name'),
    Promise.all(slices(orderIds).map(async ids => unwrap(await db.from('order_engineers').select('order_id, user_id').in('order_id', ids)))),
    Promise.all(slices(orderIds).map(async ids => unwrap(await db.from('orders').select('id').in('id', ids).not('legacy_source', 'is', null)))),
    Promise.all(slices(rfqIds).map(async ids => unwrap(await db.from('rfqs').select('id').in('id', ids).not('legacy_source', 'is', null)))).catch(() => [] as Array<Array<{ id: string }>>),
  ])
  const engineersBy = new Map<string, string[]>()
  for (const e of engineers.flat()) engineersBy.set(e.order_id, [...(engineersBy.get(e.order_id) ?? []), e.user_id])
  return {
    companies: new Map(companies.flat().map(c => [c.id, c.name])),
    sites: new Map(sites.flat().map(s => [s.id, s.name])),
    users: new Map(unwrap(users).map(u => [u.id, u.name])),
    engineers: engineersBy,
    importedOrders: new Set(impOrders.flat().map(r => r.id)),
    importedRfqs: new Set(impRfqs.flat().map(r => r.id)),
  }
}

/** Every job, with the names beside it: the view, the companies, sites, users and engineers, all in one round. */
export async function listJobs(): Promise<JobRow[]> {
  const db = requireSupabase()
  const [views, companies, sites, users, engineers, impOrders, impRfqs] = await Promise.all([
    fetchAll<JobView>((from, to) => db.from('v_jobs').select(JOB_COLUMNS).order('job_key').range(from, to) as unknown as Page<JobView>),
    fetchAll((from, to) => db.from('companies').select('id, name').order('id').range(from, to)),
    fetchAll((from, to) => db.from('company_sites').select('id, name').order('id').range(from, to)),
    db.from('users').select('id, name'),
    fetchAll((from, to) => db.from('order_engineers').select('order_id, user_id').order('order_id').range(from, to)),
    fetchAll((from, to) => db.from('orders').select('id').not('legacy_source', 'is', null).order('id').range(from, to)),
    // a refusal here must never take the Jobs list down: the imported mark is a nicety (grey instead of red), not the list
    fetchAll((from, to) => db.from('rfqs').select('id').not('legacy_source', 'is', null).order('id').range(from, to)).catch(() => [] as Array<{ id: string }>),
  ])
  const engineersBy = new Map<string, string[]>()
  for (const e of engineers) engineersBy.set(e.order_id, [...(engineersBy.get(e.order_id) ?? []), e.user_id])
  const names: Names = {
    companies: new Map(companies.map(c => [c.id, c.name])),
    sites: new Map(sites.map(s => [s.id, s.name])),
    users: new Map(unwrap(users).map(u => [u.id, u.name])),
    engineers: engineersBy,
    importedOrders: new Set(impOrders.map(r => r.id)),
    importedRfqs: new Set(impRfqs.map(r => r.id)),
  }
  return views.map(v => shape(v, names)).filter((j): j is JobRow => j !== null)
}

/** One job by its key; null when there is none (a mistyped address). */
export async function getJob(key: string): Promise<JobRow | null> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('v_jobs').select(JOB_COLUMNS).eq('job_key', key).limit(1)) as JobView[]
  if (rows.length === 0) return null
  return shape(rows[0], await namesFor(rows))
}

// ---------------------------------------------------------------- the one search

/** A typed job number: "139", "job 139", "O-45", "job o45". */
export function jobKeyOf(text: string): string | null {
  const m = /^(?:job[-\s]*)?(?:(o)[-\s]*)?(\d{1,9})$/i.exec(text.trim())
  if (!m) return null
  const n = String(Number(m[2]))
  return m[1] ? `O-${n}` : n
}

/** "QT-26-0031" or "QT 31": the quotation number (the year part is the year of its first issue and is not stored apart). */
export function quotationNumberOf(text: string): number | null {
  const m = /^qt[-\s]*(?:\d{2}[-\s]*)?(\d{1,6})$/i.exec(text.trim())
  return m ? Number(m[1]) : null
}

const FETCH_LIMIT = 25

/**
 * THE job search, called by the Jobs page and by the command palette (so they never disagree). It finds a job by:
 *  - its number: "139", "Job 139", "O-45";
 *  - what the palette search already finds: RFQ and ORD numbers, customer reference, customer PO, supplier PO numbers, invoice
 *    numbers (admin and sales; the database returns none to an engineer), order items, and a company or contact (all its jobs);
 *  - a quotation number "QT-26-0031" (admin and sales: engineers cannot read quotations);
 *  - an enquiry's item words, which the palette's own search does not cover.
 * `hits` lets the palette hand over the search_all answer it already has, so it asks the database once.
 */
export async function findJobs(text: string, signal?: AbortSignal, hits?: SearchHit[]): Promise<JobRow[]> {
  const q = text.trim().replace(/\s+/g, ' ')
  if (!q) return []
  const db = requireSupabase()
  const found = hits ?? (await searchAll(q, signal, FETCH_LIMIT))
  const rfqIds = new Set<string>()
  const orderIds = new Set<string>()
  const companyIds = new Set<string>()
  for (const h of found) {
    if (h.kind === 'rfq') rfqIds.add(h.id)
    else if (h.kind === 'order') orderIds.add(h.id)
    else if (h.orderId && (h.kind === 'item' || h.kind === 'po' || h.kind === 'invoice')) orderIds.add(h.orderId)
    else if (h.kind === 'company') companyIds.add(h.id)
    else if (h.kind === 'contact' && h.companyId) companyIds.add(h.companyId)
  }
  const key = jobKeyOf(q)
  const qt = quotationNumberOf(q)
  const like = `%${q.replace(/[\\%_]/g, c => `\\${c}`)}%`
  // two small reads that may fail without failing the search (an engineer cannot read quotations)
  const quoteIds = async (): Promise<string[]> => {
    if (qt === null) return []
    const r = await db.from('quotations').select('rfq_id').eq('number', qt).limit(25)
    return r.error ? [] : r.data.map(x => x.rfq_id)
  }
  const itemIds = async (): Promise<string[]> => {
    if (q.length < 3) return []
    const r = await db.from('rfq_items').select('rfq_id').ilike('description', like).limit(FETCH_LIMIT)
    return r.error ? [] : r.data.map(x => x.rfq_id)
  }
  const [byQuote, byItem] = await Promise.all([quoteIds(), itemIds()])
  for (const id of [...byQuote, ...byItem]) rfqIds.add(id)
  if (signal?.aborted) return []
  const clauses: string[] = []
  if (key) clauses.push(`job_key.eq.${key}`)
  if (rfqIds.size) clauses.push(`rfq_id.in.(${[...rfqIds].join(',')})`)
  if (orderIds.size) clauses.push(`order_id.in.(${[...orderIds].join(',')})`)
  if (companyIds.size) clauses.push(`company_id.in.(${[...companyIds].slice(0, FETCH_LIMIT).join(',')})`)
  if (clauses.length === 0) return []
  let req = db.from('v_jobs').select(JOB_COLUMNS).or(clauses.join(',')).limit(200)
  if (signal) req = req.abortSignal(signal)
  const rows = unwrap(await req) as JobView[]
  const names = await namesFor(rows)
  const jobs = rows.map(v => shape(v, names)).filter((j): j is JobRow => j !== null)
  // The exact number first, then the newest activity.
  return jobs.sort(
    (a, b) => Number(b.key === key) - Number(a.key === key) || (b.lastActivityOn ?? '').localeCompare(a.lastActivityOn ?? '') || b.key.localeCompare(a.key, undefined, { numeric: true }),
  )
}

// ---------------------------------------------------------------- one job page

/** Who to call and where the goods go: from the enquiry, else from the order. */
export interface JobContact {
  name: string
  phone: string | null
  email: string | null
  jobTitle: string | null
}

/** What the job page's header, contact and notes need, read in ONE round (the view and the enquiry or order beside it, together). */
export interface JobFacts {
  job: JobRow
  customerRef: string | null
  receivedOn: string | null
  dueOn: string | null
  /** The enquiry's notes (rfqs.notes), else the order's. */
  notes: string | null
  closedOn: string | null
  closeReason: string | null
  contact: JobContact | null
  site: { name: string; address: string | null } | null
  /** The direct order's own number, shown beside "Job O-45" as ORD-0045. */
  orderNumber: number | null
}

type One<T> = T | T[] | null | undefined
const one = <T,>(v: One<T>): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))

interface HeadJoin {
  id: string
  number: number
  notes: string | null
  company: One<{ id: string; name: string }>
  site: One<{ name: string; address: string | null }>
  contact: One<{ name: string; phone: string | null; email: string | null; job_title: string | null }>
  owner: One<{ id: string; name: string }>
  customer_ref?: string | null
  received_on?: string | null
  due_on?: string | null
  closed_on?: string | null
  close_reason?: string | null
}

/**
 * The job with its customer, site, contact and owner: the view and the enquiry (or the direct order) read together in one round,
 * the names embedded as the order page does (perf/lcp: the customer's name is the page's largest text). Null when there is no such
 * job (a mistyped address). `money` is not needed: the view has none, and the order's customer PO is read by the order panel.
 */
export async function getJobFacts(key: string): Promise<JobFacts | null> {
  const db = requireSupabase()
  const direct = /^O-(\d+)$/.exec(key)
  const number = direct ? Number(direct[1]) : /^\d{1,9}$/.test(key) ? Number(key) : null
  if (number === null) return null
  const embeds = (t: 'rfqs' | 'orders', own: string) =>
    `${own}, company:companies!${t}_company_id_fkey(id, name), site:company_sites!${t}_site_id_fkey(name, address), contact:contacts!${t}_contact_id_fkey(name, phone, email, job_title), owner:users!${t}_owner_id_fkey(id, name)`
  const head = direct
    ? db
        .from('orders')
        .select(embeds('orders', 'id, number, notes'))
        .eq('number', number)
        .is('rfq_id', null)
        .maybeSingle()
    : db
        .from('rfqs')
        .select(embeds('rfqs', 'id, number, notes, customer_ref, received_on, due_on, closed_on, close_reason'))
        .eq('number', number)
        .maybeSingle()
  // whether it came from the old CRM: the id only, in the same round
  const importedRead = (async (): Promise<boolean> => {
    try {
      const r = direct
        ? await db.from('orders').select('id').eq('number', number).is('rfq_id', null).not('legacy_source', 'is', null).limit(1)
        : await db.from('rfqs').select('id').eq('number', number).not('legacy_source', 'is', null).limit(1)
      return !r.error && (r.data?.length ?? 0) > 0
    } catch {
      return false // the grey mark is a nicety: a refusal must never keep the page from opening
    }
  })()
  const [view, headRes, impRes] = await Promise.all([db.from('v_jobs').select(JOB_COLUMNS).eq('job_key', key).maybeSingle(), head, importedRead])
  const v = unwrap(view) as JobView | null
  const h = unwrap(headRes) as unknown as HeadJoin | null
  if (!v || !h || !v.job_key || !v.company_id) return null
  const company = one(h.company)
  const site = one(h.site)
  const contact = one(h.contact)
  const owner = one(h.owner)
  const job: JobRow = {
    key: v.job_key,
    kind: v.kind === 'direct' ? 'direct' : 'enquiry',
    rfqId: v.rfq_id,
    orderId: v.order_id,
    companyId: v.company_id,
    companyName: company?.name ?? 'Unknown company',
    siteName: site?.name ?? null,
    ownerId: v.owner_id,
    ownerName: owner?.name ?? null,
    items: v.items_summary ?? '',
    stage: v.stage,
    stageDetail: v.stage_detail,
    isHistory: v.is_history === true,
    lastActivityOn: v.last_activity_on,
    repeatOf: v.repeat_of_job_key,
    cancelledOrders: Number(v.cancelled_orders ?? 0),
    engineerIds: [],
    imported: impRes,
  }
  return {
    job,
    customerRef: h.customer_ref ?? null,
    receivedOn: h.received_on ?? null,
    dueOn: h.due_on ?? null,
    notes: h.notes ?? null,
    closedOn: h.closed_on ?? null,
    closeReason: h.close_reason ?? null,
    contact: contact ? { name: contact.name, phone: contact.phone, email: contact.email, jobTitle: contact.job_title } : null,
    site: site ?? null,
    orderNumber: direct ? number : null,
  }
}

export interface CancelledOrder {
  id: string
  number: number
  cancelledOn: string
  reason: string | null
}

/** The orders of this enquiry that were cancelled: history inside the job (a cancel followed by a reorder is still one job). */
export async function listCancelledOrders(rfqId: string): Promise<CancelledOrder[]> {
  const rows = unwrap(await requireSupabase().from('orders').select('id, number, cancelled_on, cancel_reason').eq('rfq_id', rfqId).not('cancelled_on', 'is', null).order('number'))
  return rows.flatMap(r => (r.cancelled_on ? [{ id: r.id, number: r.number, cancelledOn: r.cancelled_on, reason: r.cancel_reason }] : []))
}

export interface JobInvoice {
  id: string
  number: string | null
  invoiceDate: string | null
  /** net + GST: admin and sales only (an engineer's read is never made). */
  gross: number
}

/** The invoices of the job's order (admin and sales; never called for an engineer). */
export async function listJobInvoices(orderId: string): Promise<JobInvoice[]> {
  const rows = unwrap(await requireSupabase().from('invoices').select('id, number, invoice_date, net_amount, gst_amount').eq('order_id', orderId).order('invoice_date'))
  return rows.map(r => ({ id: r.id, number: r.number, invoiceDate: r.invoice_date, gross: Number(r.net_amount) + Number(r.gst_amount) }))
}
