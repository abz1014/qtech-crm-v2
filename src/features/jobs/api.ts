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
}

type JobView = ViewRow<'v_jobs'>
const JOB_COLUMNS = 'job_key, kind, rfq_id, order_id, company_id, site_id, owner_id, items_summary, stage, stage_detail, is_history, last_activity_on, repeat_of_job_key, cancelled_orders'
type Page<T> = PromiseLike<{ data: T[] | null; error: { code?: string; message: string } | null }>

interface Names {
  companies: Map<string, string>
  sites: Map<string, string>
  users: Map<string, string>
  engineers: Map<string, string[]>
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
  const [companies, sites, users, engineers] = await Promise.all([
    Promise.all(slices(companyIds).map(async ids => unwrap(await db.from('companies').select('id, name').in('id', ids)))),
    Promise.all(slices(siteIds).map(async ids => unwrap(await db.from('company_sites').select('id, name').in('id', ids)))),
    db.from('users').select('id, name'),
    Promise.all(slices(orderIds).map(async ids => unwrap(await db.from('order_engineers').select('order_id, user_id').in('order_id', ids)))),
  ])
  const engineersBy = new Map<string, string[]>()
  for (const e of engineers.flat()) engineersBy.set(e.order_id, [...(engineersBy.get(e.order_id) ?? []), e.user_id])
  return {
    companies: new Map(companies.flat().map(c => [c.id, c.name])),
    sites: new Map(sites.flat().map(s => [s.id, s.name])),
    users: new Map(unwrap(users).map(u => [u.id, u.name])),
    engineers: engineersBy,
  }
}

/** Every job, with the names beside it: the view, the companies, sites, users and engineers, all in one round. */
export async function listJobs(): Promise<JobRow[]> {
  const db = requireSupabase()
  const [views, companies, sites, users, engineers] = await Promise.all([
    fetchAll<JobView>((from, to) => db.from('v_jobs').select(JOB_COLUMNS).order('job_key').range(from, to) as unknown as Page<JobView>),
    fetchAll((from, to) => db.from('companies').select('id, name').order('id').range(from, to)),
    fetchAll((from, to) => db.from('company_sites').select('id, name').order('id').range(from, to)),
    db.from('users').select('id, name'),
    fetchAll((from, to) => db.from('order_engineers').select('order_id, user_id').order('order_id').range(from, to)),
  ])
  const engineersBy = new Map<string, string[]>()
  for (const e of engineers) engineersBy.set(e.order_id, [...(engineersBy.get(e.order_id) ?? []), e.user_id])
  const names: Names = {
    companies: new Map(companies.map(c => [c.id, c.name])),
    sites: new Map(sites.map(s => [s.id, s.name])),
    users: new Map(unwrap(users).map(u => [u.id, u.name])),
    engineers: engineersBy,
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
