import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import type { ViewRow } from '@/features/dbTypes'
import type { BidState, BoardRow, ClarificationState, Outcome, SourcingState } from '@/features/rfqs/board/model'

/*
 * RFQ board reads (R06). This is the only file in the board that names a table or view. Everything the
 * board shows comes from v_rfq_state (outcome, sourcing, clarification, bid and deadline dimensions);
 * the company and owner names come through its foreign keys, and the customer's own reference and the
 * first item (what was asked) are read from rfqs because the view does not carry them. Reads only: the
 * board writes nothing.
 */
type StateRow = ViewRow<'v_rfq_state'> & { companies: { name: string } | null; users: { name: string } | null }
type PgError = { code?: string; message: string }
type Page<T> = PromiseLike<{ data: T[] | null; error: PgError | null }>
/** One RFQ's reference and its first item (the embedded list is limited to one row, by position). */
type RefRow = { id: string; customer_ref: string | null; rfq_items: { description: string; position: number }[] | null }
type RefInfo = { customerRef: string | null; firstItem: string | null }

const STATE_SELECT = '*, companies(name), users(name)'
const REF_SELECT = 'id, customer_ref, rfq_items(description, position)'

const n = (v: number | null | undefined) => (v === null || v === undefined ? 0 : Number(v))

const refInfo = (rows: readonly RefRow[]) => new Map<string, RefInfo>(rows.map(r => [r.id, { customerRef: r.customer_ref, firstItem: r.rfq_items?.[0]?.description ?? null }]))

function toRow(r: StateRow, ref: RefInfo | undefined): BoardRow {
  return {
    rfqId: r.rfq_id as string,
    number: Number(r.number),
    companyId: r.company_id as string,
    companyName: r.companies?.name ?? 'Unknown company',
    customerRef: ref?.customerRef ?? null,
    firstItem: ref?.firstItem ?? null,
    ownerId: r.owner_id,
    ownerName: r.users?.name ?? null,
    receivedOn: r.received_on as string,
    dueOn: r.due_on,
    isPriority: Boolean(r.is_priority),
    daysToDue: r.days_to_due === null || r.days_to_due === undefined ? null : Number(r.days_to_due),
    isOverdue: Boolean(r.is_overdue),
    outcome: r.outcome as Outcome,
    closeReason: r.close_reason,
    sourcingState: r.sourcing_state as SourcingState,
    itemsTotal: n(r.items_total),
    itemsQuoted: n(r.items_quoted),
    itemsUncovered: n(r.items_uncovered),
    floated: n(r.floated),
    clarificationState: r.clarification_state as ClarificationState,
    toAsk: n(r.to_ask),
    waiting: n(r.waiting),
    waitingDays: r.waiting_days === null || r.waiting_days === undefined ? null : Number(r.waiting_days),
    toRelay: n(r.to_relay),
    bidState: r.bid_state as BidState,
    quotedOn: r.quoted_on ?? null,
  }
}

/** Every open RFQ, unsorted (model.sortBoard orders it). Two reads, joined here: the state view, and the refs with the first item. */
export async function listOpenRfqs(): Promise<BoardRow[]> {
  const db = requireSupabase()
  const [states, refs] = await Promise.all([
    fetchAll<StateRow>((from, to) => db.from('v_rfq_state').select(STATE_SELECT).eq('outcome', 'open').order('number').range(from, to) as unknown as Page<StateRow>),
    fetchAll<RefRow>(
      (from, to) =>
        db
          .from('rfqs')
          .select(REF_SELECT)
          .is('closed_on', null)
          .order('position', { referencedTable: 'rfq_items' })
          .limit(1, { referencedTable: 'rfq_items' })
          .order('number')
          .range(from, to) as unknown as Page<RefRow>,
    ),
  ])
  const refBy = refInfo(refs)
  return states.map(s => toRow(s, refBy.get(s.rfq_id as string)))
}

export interface ClosedPage {
  rows: BoardRow[]
  total: number
  /** A search matched more RFQs than one read takes: only the newest matches are searched. */
  capped?: boolean
}

/** How many matching RFQs one search reads by each route (reference or company, item text). Ids travel in the address. */
export const SEARCH_CAP = 120

/**
 * The RFQs whose number, customer reference, company name or item text matches `text`, newest first, at most SEARCH_CAP.
 * Two reads in parallel: the RFQ's own fields (with the matching company ids), and the items (an inner join on rfq_items).
 */
async function matchingRfqIds(text: string): Promise<{ ids: string[]; capped: boolean }> {
  const q = likeText(text)
  if (!q) return { ids: [], capped: false }
  const db = requireSupabase()
  const companyIds = unwrap(await db.from('companies').select('id').ilike('name', `%${q}%`).limit(25)).map(c => c.id)
  const clauses = [`customer_ref.ilike.%${q}%`]
  const num = parseRfqNumber(text)
  if (num !== null) clauses.push(`number.eq.${num}`)
  if (companyIds.length) clauses.push(`company_id.in.(${companyIds.join(',')})`)
  type Hit = { id: string; number: number }
  const [own, byItem] = await Promise.all([
    db.from('rfqs').select('id, number').or(clauses.join(',')).order('number', { ascending: false }).limit(SEARCH_CAP),
    db.from('rfqs').select('id, number, rfq_items!inner(id)').ilike('rfq_items.description', `%${q}%`).order('number', { ascending: false }).limit(SEARCH_CAP),
  ])
  const a = unwrap(own as unknown as { data: Hit[] | null; error: PgError | null }) ?? []
  const b = unwrap(byItem as unknown as { data: Hit[] | null; error: PgError | null }) ?? []
  const byId = new Map([...a, ...b].map(h => [h.id, Number(h.number)]))
  const ids = [...byId.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id)
  return { ids: ids.slice(0, SEARCH_CAP), capped: ids.length > SEARCH_CAP || a.length >= SEARCH_CAP || b.length >= SEARCH_CAP }
}

/**
 * One page of won and closed RFQs, newest first, with the total for the pager. With `text`, only the RFQs whose number, customer
 * reference, company or item text match: the search runs on the server, over every closed RFQ, not over the page on screen.
 */
export async function listClosedRfqs(page: number, size: number, text = ''): Promise<ClosedPage> {
  const db = requireSupabase()
  const from = page * size
  const search = text.trim() ? await matchingRfqIds(text) : null
  if (search && search.ids.length === 0) return { rows: [], total: 0 }
  let query = db.from('v_rfq_state').select(STATE_SELECT, { count: 'exact' }).in('outcome', ['won', 'closed'])
  if (search) query = query.in('rfq_id', search.ids)
  const res = await query
    .order('received_on', { ascending: false })
    .order('number', { ascending: false })
    .range(from, from + size - 1)
  const rows = unwrap(res as unknown as { data: StateRow[] | null; error: PgError | null }) ?? []
  const ids = rows.map(r => r.rfq_id as string)
  const refs = ids.length
    ? (unwrap(
        (await db
          .from('rfqs')
          .select(REF_SELECT)
          .in('id', ids)
          .order('position', { referencedTable: 'rfq_items' })
          .limit(1, { referencedTable: 'rfq_items' })) as unknown as { data: RefRow[] | null; error: PgError | null },
      ) ?? [])
    : []
  const refBy = refInfo(refs)
  return { rows: rows.map(r => toRow(r, refBy.get(r.rfq_id as string))), total: res.count ?? rows.length, capped: search?.capped }
}

/** How many RFQs are won or closed, for the tab label. A count only: no rows travel. */
export async function countClosedRfqs(): Promise<number> {
  const db = requireSupabase()
  const res = await db.from('v_rfq_state').select('rfq_id', { count: 'exact', head: true }).in('outcome', ['won', 'closed'])
  if (res.error) throw res.error
  return res.count ?? 0
}

export interface RfqHit {
  id: string
  number: number
  customerRef: string | null
  companyName: string
  closed: boolean
}

/** Escape ilike wildcards, and drop the characters that would end an `or=(...)` filter early. */
const likeText = (s: string) =>
  s
    .replace(/[\\%_]/g, c => `\\${c}`)
    .replace(/[,()"*]/g, ' ')
    .trim()

/** "RFQ-0177", "rfq 177" or "177" is a number. Anything else is text. */
export function parseRfqNumber(q: string): number | null {
  const m = /^(?:rfq[\s-]*)?0*(\d{1,9})$/i.exec(q.trim())
  return m ? Number(m[1]) : null
}

/** Palette search: by RFQ number, by the customer's reference, or by company name. At most 8 hits, newest first. */
export async function searchRfqs(text: string): Promise<RfqHit[]> {
  const q = likeText(text)
  if (!q) return []
  const db = requireSupabase()
  const companyIds = unwrap(await db.from('companies').select('id').ilike('name', `%${q}%`).limit(25)).map(c => c.id)
  const clauses = [`customer_ref.ilike.%${q}%`]
  const num = parseRfqNumber(text)
  if (num !== null) clauses.push(`number.eq.${num}`)
  if (companyIds.length) clauses.push(`company_id.in.(${companyIds.join(',')})`)
  const res = await db
    .from('rfqs')
    .select('id, number, customer_ref, closed_on, companies(name)')
    .or(clauses.join(','))
    .order('number', { ascending: false })
    .limit(8)
  type Hit = { id: string; number: number; customer_ref: string | null; closed_on: string | null; companies: { name: string } | null }
  const rows = unwrap(res as unknown as { data: Hit[] | null; error: PgError | null }) ?? []
  return rows.map(r => ({ id: r.id, number: Number(r.number), customerRef: r.customer_ref, companyName: r.companies?.name ?? '', closed: r.closed_on !== null }))
}

/**
 * The board's Value (PKR net) column: for each open RFQ, the net of the prices we have put on its items (quantity x quoted unit
 * price net). An RFQ with no price on any item has no entry (the cell shows a dash). This is money: the caller never makes this
 * request for an engineer, and the column is not drawn for one.
 */
export async function listRfqValues(): Promise<Record<string, number>> {
  const db = requireSupabase()
  const rows = await fetchAll<{ rfq_id: string; qty: number | string; quoted_unit_price_net: number | string | null }>(
    (from, to) => db.from('rfq_items').select('rfq_id, qty, quoted_unit_price_net').not('quoted_unit_price_net', 'is', null).order('rfq_id').range(from, to) as unknown as Page<{ rfq_id: string; qty: number | string; quoted_unit_price_net: number | string | null }>,
  )
  const out: Record<string, number> = {}
  for (const r of rows) out[r.rfq_id] = Math.round(((out[r.rfq_id] ?? 0) + Number(r.qty) * Number(r.quoted_unit_price_net)) * 100) / 100
  return out
}
