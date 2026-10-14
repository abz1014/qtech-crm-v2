import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import type { ViewRow } from '@/features/dbTypes'
import type { BidState, BoardRow, ClarificationState, Outcome, SourcingState } from '@/features/rfqs/board/model'

/*
 * RFQ board reads (R06). This is the only file in the board that names a table or view. Everything the
 * board shows comes from v_rfq_state (outcome, sourcing, clarification, bid and deadline dimensions);
 * the company and owner names come through its foreign keys, and the customer's own reference is read
 * from rfqs because the view does not carry it. Reads only: the board writes nothing.
 */
type StateRow = ViewRow<'v_rfq_state'> & { companies: { name: string } | null; users: { name: string } | null }
type PgError = { code?: string; message: string }
type Page<T> = PromiseLike<{ data: T[] | null; error: PgError | null }>

const STATE_SELECT = '*, companies(name), users(name)'

const n = (v: number | null | undefined) => (v === null || v === undefined ? 0 : Number(v))

function toRow(r: StateRow, customerRef: string | null): BoardRow {
  return {
    rfqId: r.rfq_id as string,
    number: Number(r.number),
    companyId: r.company_id as string,
    companyName: r.companies?.name ?? 'Unknown company',
    customerRef,
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
  }
}

/** Every open RFQ, unsorted (model.sortBoard orders it). Two reads, joined here: the state view and the customer refs. */
export async function listOpenRfqs(): Promise<BoardRow[]> {
  const db = requireSupabase()
  const [states, refs] = await Promise.all([
    fetchAll<StateRow>((from, to) => db.from('v_rfq_state').select(STATE_SELECT).eq('outcome', 'open').order('number').range(from, to) as unknown as Page<StateRow>),
    fetchAll<{ id: string; customer_ref: string | null }>((from, to) => db.from('rfqs').select('id, customer_ref').is('closed_on', null).order('number').range(from, to)),
  ])
  const refBy = new Map(refs.map(r => [r.id, r.customer_ref]))
  return states.map(s => toRow(s, refBy.get(s.rfq_id as string) ?? null))
}

export interface ClosedPage {
  rows: BoardRow[]
  total: number
}

/** One page of won and closed RFQs, newest first, with the total for the pager. */
export async function listClosedRfqs(page: number, size: number): Promise<ClosedPage> {
  const db = requireSupabase()
  const from = page * size
  const res = await db
    .from('v_rfq_state')
    .select(STATE_SELECT, { count: 'exact' })
    .in('outcome', ['won', 'closed'])
    .order('received_on', { ascending: false })
    .order('number', { ascending: false })
    .range(from, from + size - 1)
  const rows = unwrap(res as unknown as { data: StateRow[] | null; error: PgError | null }) ?? []
  const ids = rows.map(r => r.rfq_id as string)
  const refs = ids.length ? unwrap(await db.from('rfqs').select('id, customer_ref').in('id', ids)) : []
  const refBy = new Map(refs.map(r => [r.id, r.customer_ref]))
  return { rows: rows.map(r => toRow(r, refBy.get(r.rfq_id as string) ?? null)), total: res.count ?? rows.length }
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
