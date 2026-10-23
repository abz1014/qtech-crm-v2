import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import { poRef } from '@/lib/refs'
import type { TableUpdate, ViewRow } from '@/features/dbTypes'
import type { ConvertPayloadLine } from '@/features/orders/lib/convert'
import { medianDeliveryDays } from '@/features/orders/lib/leadTime'
import type { RankedQuote } from '@/features/orders/lib/ranking'
import type { RankRow } from '@/features/rfqs/lib/ranking/reasons'
import type { LegPatch } from '@/features/orders/lib/legModel'
import type { StepLeg } from '@/features/orders/lib/orderSteps'
import { fetchReceivablesList } from '@/features/money/payments/api'

/*
 * Orders (O01, O03): every database call for converting an RFQ and for the order page. This is the only file that names an
 * order table, view or RPC for them. Access is Row Level Security's job (DATA_MODEL section 10); the app mirrors it:
 * an engineer's reads never ask for a price column or for the money columns of v_order_state, so none reaches the browser.
 */

export type OrderStateRow = ViewRow<'v_order_state'>

export interface OrderHeader {
  id: string
  number: number
  companyId: string
  companyName: string
  rfqId: string | null
  customerPo: string | null
  /** orders.created_at: which quotation was the latest when the order was made. */
  createdAt?: string
  orderedOn: string | null
  paymentTermsDays: number | null
  needsCommissioning: boolean
  plannedOn: string | null
  doneOn: string | null
  cancelledOn: string | null
  /** orders.cancel_reason: a fixed key (lib/cancel.ts builds the words). */
  cancelReason: string | null
  /** Imported from the old CRM (orders.legacy_source is set). */
  imported: boolean
  notes: string | null
  site: { name: string; address: string | null } | null
  contact: { name: string; phone: string | null } | null
  owner: { id: string; name: string } | null
  /** Derived states from v_order_state. For an engineer the money columns are never requested, so net, gst, gross and invoiced stay null. */
  state: {
    lifecycle: string | null
    goods: string | null
    commissioning: string | null
    invoicing: string | null
    dataTrust: string | null
    net: number | null
    gst: number | null
    gross: number | null
    invoiced: number | null
  } | null
}

const STATE_NO_MONEY = 'order_id, lifecycle, goods_state, commissioning_state, data_trust'
const STATE_WITH_MONEY = 'order_id, lifecycle, goods_state, commissioning_state, invoicing_state, data_trust, net, gst, gross, invoiced'

/** The order, its people and its derived states. Null when there is no such order. `money` is false for an engineer. */
export async function getOrderHeader(id: string, money: boolean): Promise<OrderHeader | null> {
  const db = requireSupabase()
  // The customer, site, contact and owner come embedded in the order's own read, not in a second round after it (perf/lcp: the
  // customer's name is the page's largest text, and a second round trip on a phone's mobile data held it back). Row Level Security
  // applies to an embedded row as to its own read: one the person may not see comes back null, as its own read did.
  const [orderRes, stateRes] = await Promise.all([
    db
      .from('orders')
      .select('*, company:companies!orders_company_id_fkey(name), site:company_sites!orders_site_id_fkey(name, address), contact:contacts!orders_contact_id_fkey(name, phone), owner:users!orders_owner_id_fkey(id, name)')
      .eq('id', id)
      .maybeSingle(),
    db
      .from('v_order_state')
      .select(money ? STATE_WITH_MONEY : STATE_NO_MONEY)
      .eq('order_id', id)
      .maybeSingle(),
  ])
  const o = unwrap(orderRes)
  if (!o) return null
  const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null))
  const company = one(o.company)
  const site = o.site_id ? one(o.site) : null
  const contact = o.contact_id ? one(o.contact) : null
  const owner = o.owner_id ? one(o.owner) : null
  const s = unwrap(stateRes) as Partial<OrderStateRow> | null
  return {
    id: o.id,
    number: o.number,
    companyId: o.company_id,
    companyName: company?.name ?? 'Unknown company',
    rfqId: o.rfq_id,
    customerPo: o.customer_po_number,
    createdAt: o.created_at,
    orderedOn: o.ordered_on,
    paymentTermsDays: o.payment_terms_days,
    needsCommissioning: o.needs_commissioning,
    plannedOn: o.commissioning_planned_on,
    doneOn: o.commissioning_done_on,
    cancelledOn: o.cancelled_on,
    cancelReason: o.cancel_reason,
    imported: o.legacy_source !== null,
    notes: o.notes,
    site,
    contact,
    owner,
    state: s
      ? {
          lifecycle: s.lifecycle ?? null,
          goods: s.goods_state ?? null,
          commissioning: s.commissioning_state ?? null,
          invoicing: s.invoicing_state ?? null,
          dataTrust: s.data_trust ?? null,
          net: s.net === undefined || s.net === null ? null : Number(s.net),
          gst: s.gst === undefined || s.gst === null ? null : Number(s.gst),
          gross: s.gross === undefined || s.gross === null ? null : Number(s.gross),
          invoiced: s.invoiced === undefined || s.invoiced === null ? null : Number(s.invoiced),
        }
      : null,
  }
}

export interface OrderItemRow {
  id: string
  /** 1-based number by position. */
  number: number
  description: string
  brandName: string | null
  /** The model words the line was matched on (order_items.model_tokens), upper-cased for the sub-line. */
  model: string | null
  qty: number
  unit: string | null
  isService: boolean
  legId: string | null
  rfqItemId: string | null
  /** Null for an engineer: the column is never requested. */
  unitPriceNet: number | null
  gstRate: number | null
  supplierUnitPrice: number | null
  /** A repeat copied this line at 0 for the person to price it (order_items.legacy_flags 'price_needed', still priced 0). Never for an engineer. */
  priceNeeded?: boolean
}

export async function listOrderItems(orderId: string, money: boolean): Promise<OrderItemRow[]> {
  const db = requireSupabase()
  const base = 'id, position, description, brand_id, model_tokens, qty, unit, is_service, supplier_order_id, rfq_item_id, created_at'
  const rows = unwrap(
    await db
      .from('order_items')
      .select(money ? `${base}, unit_price_net, gst_rate, supplier_unit_price, legacy_flags` : base)
      .eq('order_id', orderId)
      .order('position')
      .order('created_at'),
  ) as unknown as Array<Record<string, unknown>>
  const brandIds = [...new Set(rows.map(r => r.brand_id as string | null).filter((b): b is string => Boolean(b)))]
  const brands = brandIds.length ? unwrap(await db.from('brands').select('id, name').in('id', brandIds)) : []
  const names = new Map(brands.map(b => [b.id, b.name]))
  const num = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  return rows.map((r, i) => ({
    id: r.id as string,
    number: i + 1,
    description: r.description as string,
    brandName: r.brand_id ? (names.get(r.brand_id as string) ?? null) : null,
    model: Array.isArray(r.model_tokens) && r.model_tokens.length > 0 ? (r.model_tokens as string[]).join(' ').toUpperCase() : null,
    qty: Number(r.qty),
    unit: (r.unit as string | null) ?? null,
    isService: Boolean(r.is_service),
    legId: (r.supplier_order_id as string | null) ?? null,
    rfqItemId: (r.rfq_item_id as string | null) ?? null,
    unitPriceNet: money ? num(r.unit_price_net) : null,
    gstRate: money ? num(r.gst_rate) : null,
    supplierUnitPrice: money ? num(r.supplier_unit_price) : null,
    priceNeeded: money && Array.isArray(r.legacy_flags) && (r.legacy_flags as string[]).includes('price_needed') && Number(r.unit_price_net) === 0,
  }))
}

export interface OrderLegRow {
  id: string
  supplierId: string
  supplierName: string
  currency: string | null
  reference: string | null
  placedOn: string | null
  expectedOn: string | null
  receivedOn: string | null
  deliveredOn: string | null
  lastChasedOn: string | null
  chaseCount: number
  inquiryId: string | null
  /** The lead times the supplier quoted for the lines on this leg (text as written), for the suggested expected date. */
  leadTimes: string[]
}

/** The order's legs as stored, with supplier names and the quote lines' lead times: what shapeOrderLegs orders against the items. */
export interface OrderLegsRaw {
  legs: Array<{
    id: string
    supplier_id: string
    currency: string | null
    reference: string | null
    placed_on: string | null
    expected_on: string | null
    received_on: string | null
    delivered_on: string | null
    last_chased_on: string | null
    chase_count: number
    inquiry_id: string | null
    created_at: string
  }>
  names: ReadonlyMap<string, string>
  quoteLines: ReadonlyArray<{ inquiry_id: string; rfq_item_id: string; lead_time: string | null }>
}

export async function fetchOrderLegs(orderId: string): Promise<OrderLegsRaw> {
  const db = requireSupabase()
  const legs = unwrap(await db.from('supplier_orders').select('*').eq('order_id', orderId).order('created_at').order('id')) as unknown as OrderLegsRaw['legs']
  if (legs.length === 0) return { legs: [], names: new Map(), quoteLines: [] }
  const supplierIds = [...new Set(legs.map(l => l.supplier_id))]
  const inquiryIds = [...new Set(legs.map(l => l.inquiry_id).filter((i): i is string => Boolean(i)))]
  const [companies, lines] = await Promise.all([
    db.from('companies').select('id, name').in('id', supplierIds),
    inquiryIds.length
      ? db.from('supplier_quote_lines').select('inquiry_id, rfq_item_id, lead_time').in('inquiry_id', inquiryIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  return { legs, names: new Map(unwrap(companies).map(c => [c.id, c.name])), quoteLines: (unwrap(lines) ?? []) as OrderLegsRaw['quoteLines'] }
}

/**
 * The legs in display order with their lead times, against the order's items as they are NOW. Kept apart from the fetch so a change to
 * the items (a split, a line moved to another leg) re-orders the legs without waiting for them to be fetched again.
 */
export function shapeOrderLegs(raw: OrderLegsRaw, itemRows: readonly Pick<OrderItemRow, 'legId' | 'rfqItemId' | 'number'>[]): OrderLegRow[] {
  // Leg letters (A, B, ...) must not depend on the order the database happens to return rows in: a leg comes in the order of its
  // first line on the order, then by its creation time.
  const firstLine = (legId: string) => Math.min(...itemRows.filter(i => i.legId === legId).map(i => i.number), Number.MAX_SAFE_INTEGER)
  const ordered = [...raw.legs].sort((a, b) => firstLine(a.id) - firstLine(b.id) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  return ordered.map(l => {
    const itemIds = new Set(itemRows.filter(i => i.legId === l.id && i.rfqItemId).map(i => i.rfqItemId as string))
    return {
      id: l.id,
      supplierId: l.supplier_id,
      supplierName: raw.names.get(l.supplier_id) ?? 'Unknown supplier',
      currency: l.currency ? l.currency.trim() : null,
      reference: l.reference,
      placedOn: l.placed_on,
      expectedOn: l.expected_on,
      receivedOn: l.received_on,
      deliveredOn: l.delivered_on,
      lastChasedOn: l.last_chased_on,
      chaseCount: l.chase_count,
      inquiryId: l.inquiry_id,
      leadTimes: raw.quoteLines.filter(q => q.inquiry_id === l.inquiry_id && itemIds.has(q.rfq_item_id) && q.lead_time).map(q => q.lead_time as string),
    }
  })
}

export async function listOrderLegs(orderId: string, itemRows: readonly Pick<OrderItemRow, 'legId' | 'rfqItemId' | 'number'>[]): Promise<OrderLegRow[]> {
  return shapeOrderLegs(await fetchOrderLegs(orderId), itemRows)
}

export interface PersonRow {
  id: string
  name: string
}

export async function listOrderEngineers(orderId: string): Promise<PersonRow[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('order_engineers').select('user_id').eq('order_id', orderId))
  if (rows.length === 0) return []
  const users = unwrap(
    await db
      .from('users')
      .select('id, name')
      .in(
        'id',
        rows.map(r => r.user_id),
      ),
  )
  return users.map(u => ({ id: u.id, name: u.name })).sort((a, b) => a.name.localeCompare(b.name))
}

/** Active engineers: who can be put on a commissioning job. */
export async function listEngineerCandidates(): Promise<PersonRow[]> {
  const rows = unwrap(await requireSupabase().from('users').select('id, name').eq('role', 'engineer').is('deactivated_at', null).order('name'))
  return rows.map(u => ({ id: u.id, name: u.name }))
}

export interface RfqOrderRow {
  id: string
  number: number
  cancelledOn: string | null
}

/** The orders an RFQ has produced (one RFQ may produce several). */
export async function listOrdersForRfq(rfqId: string): Promise<RfqOrderRow[]> {
  const rows = unwrap(await requireSupabase().from('orders').select('id, number, cancelled_on').eq('rfq_id', rfqId).order('number'))
  return rows.map(r => ({ id: r.id, number: r.number, cancelledOn: r.cancelled_on }))
}

/** The company's most recent order that has payment terms: the default for the next one (A3/O01). */
export async function getLastTerms(companyId: string): Promise<{ days: number; orderNumber: number } | null> {
  const rows = unwrap(
    await requireSupabase()
      .from('orders')
      .select('number, payment_terms_days')
      .eq('company_id', companyId)
      .not('payment_terms_days', 'is', null)
      .order('ordered_on', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1),
  )
  const r = rows[0]
  return r && r.payment_terms_days !== null ? { days: r.payment_terms_days, orderNumber: r.number } : null
}

// ---------------------------------------------------------------- writes

export interface ConvertInput {
  /** Client-generated: a second call with the same id returns the same order and writes nothing. */
  orderId: string
  rfqId: string
  items: ConvertPayloadLine[]
  customerPo: string | null
  paymentTermsDays: number | null
  /** orders.needs_commissioning: the plan-commissioning and engineer-done rules depend on it. */
  needsCommissioning?: boolean
}

export async function convertRfqToOrder(input: ConvertInput): Promise<string> {
  const { data, error } = await requireSupabase().rpc('convert_rfq_to_order', {
    p_order_id: input.orderId,
    p_rfq_id: input.rfqId,
    p_items: input.items as unknown as never,
    ...(input.customerPo ? { p_customer_po_number: input.customerPo } : {}),
    ...(input.paymentTermsDays !== null ? { p_payment_terms_days: input.paymentTermsDays } : {}),
    ...(input.needsCommissioning !== undefined ? { p_needs_commissioning: input.needsCommissioning } : {}),
  })
  if (error) {
    // 0077 (BUG-CONC-1): someone else already won this RFQ. Their order is the answer, so it is returned instead of an error.
    const existing = existingOrderOf(error)
    if (existing) return existing
    throw error
  }
  return (data as string | null) ?? input.orderId
}

/** The order id in convert_rfq_to_order's "This RFQ is already order ORD-…" refusal (hint "rfq_has_order:<uuid>"), else null. */
export function existingOrderOf(err: { hint?: string | null } | null | undefined): string | null {
  const m = /^rfq_has_order:([0-9a-f-]{36})$/i.exec(err?.hint ?? '')
  return m ? m[1] : null
}

export async function updateOrder(id: string, patch: TableUpdate<'orders'>): Promise<void> {
  const { error } = await requireSupabase().from('orders').update(patch).eq('id', id)
  if (error) throw error
}

/** The ranked quotes of an RFQ (rank_item_quotes), with supplier names. Selling price and spread come back NULL for an engineer (the database decides). */
export async function listRankedQuotes(rfqId: string): Promise<RankedQuote[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.rpc('rank_item_quotes', { p_rfq_id: rfqId })) ?? []
  const ids = [...new Set(rows.map(r => r.supplier_id))]
  const names = new Map<string, string>()
  if (ids.length > 0) for (const c of unwrap(await db.from('companies').select('id, name').in('id', ids))) names.set(c.id, c.name)
  // Imported quotes carry flags that the ranking does not: Mark won warns on them.
  const lineIds = rows.map(r => r.quote_line_id)
  const flagged = new Map<string, string[]>()
  if (lineIds.length > 0) {
    for (const l of unwrap(await db.from('supplier_quote_lines').select('id, legacy_flags').in('id', lineIds))) {
      if (l.legacy_flags?.length) flagged.set(l.id, l.legacy_flags)
    }
  }
  // The ranking rules (rfqs/lib/ranking) come with the first ranked list, not with every page that reads orders (perf/lcp).
  const { mapRankRows } = await import('@/features/orders/lib/ranking')
  return mapRankRows(rows as unknown as RankRow[], names).map(q => (flagged.has(q.lineId) ? { ...q, legacyFlags: flagged.get(q.lineId) } : q))
}

export interface SplitInput {
  itemId: string
  qty: number
  /** Exactly one of legId / (supplierId + currency). */
  legId?: string
  supplierId?: string
  currency?: string
  supplierUnitPrice?: number | null
}

/** Moves part of an order line to another leg (split_order_item). Returns the new line's id. */
export async function splitOrderItem(i: SplitInput): Promise<string> {
  const { data, error } = await requireSupabase().rpc('split_order_item', {
    p_item_id: i.itemId,
    p_qty: i.qty,
    ...(i.legId ? { p_supplier_order_id: i.legId } : { p_supplier_id: i.supplierId, p_currency: i.currency }),
    ...(i.supplierUnitPrice !== null && i.supplierUnitPrice !== undefined ? { p_supplier_unit_price: i.supplierUnitPrice } : {}),
  })
  if (error) throw error
  return data as string
}

/** One selling price for every part of a split item, in one statement so the parts can never disagree. */
export async function setGroupPrice(ids: readonly string[], unitPriceNet: number): Promise<void> {
  const { error } = await requireSupabase().from('order_items').update({ unit_price_net: unitPriceNet }).in('id', [...ids])
  if (error) throw error
}

export async function updateItem(id: string, patch: { gst_rate?: number; is_service?: boolean; supplier_order_id?: string | null }): Promise<void> {
  const { error } = await requireSupabase().from('order_items').update(patch).eq('id', id)
  if (error) throw error
}

/** Sets the GST rate of several lines at once (the exempt-all toggle and its Undo); each line keeps its own value. */
export async function setItemRates(rates: ReadonlyArray<{ id: string; gstRate: number }>): Promise<void> {
  const db = requireSupabase()
  const results = await Promise.all(rates.map(r => db.from('order_items').update({ gst_rate: r.gstRate }).eq('id', r.id)))
  const failed = results.find(r => r.error)
  if (failed?.error) throw failed.error
}

export async function updateLeg(id: string, patch: LegPatch & { reference?: string | null }): Promise<void> {
  const { error } = await requireSupabase().from('supplier_orders').update(patch).eq('id', id)
  if (error) throw error
}

export async function addOrderEngineer(orderId: string, userId: string): Promise<void> {
  const { error } = await requireSupabase().from('order_engineers').insert({ order_id: orderId, user_id: userId })
  if (error && error.code !== '23505') throw error
}

export async function removeOrderEngineer(orderId: string, userId: string): Promise<void> {
  const { error } = await requireSupabase().from('order_engineers').delete().eq('order_id', orderId).eq('user_id', userId)
  if (error) throw error
}

// ---------------------------------------------------------------- palette search

/** Orders whose number or customer PO matches what is typed (the command palette's Orders source). */
export interface OrderHit {
  id: string
  number: number
  customerPo: string | null
  companyName: string
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`)

/**
 * Admin and sales match the number and any part of the customer PO. An engineer matches the number only: the R12 rule is that the
 * palette shows an engineer no PO or invoice number, so the PO column is neither searched nor read for them.
 */
export async function searchOrders(text: string, signal?: AbortSignal, limit = 6, includePo = true): Promise<OrderHit[]> {
  const q = text.trim()
  if (!q) return []
  const db = requireSupabase()
  const digits = /^(ord[-\s]*)?(\d{1,9})$/i.exec(q)
  const filters: string[] = []
  if (includePo) filters.push(`customer_po_number.ilike.%${escapeLike(q).replace(/[,()]/g, ' ')}%`)
  if (digits) filters.push(`number.eq.${Number(digits[2])}`)
  if (filters.length === 0) return []
  let req = db
    .from('orders')
    .select(includePo ? 'id, number, customer_po_number, companies(name)' : 'id, number, companies(name)')
    .or(filters.join(','))
    .order('number', { ascending: false })
    .limit(limit)
  if (signal) req = req.abortSignal(signal)
  const { data, error } = await req
  if (error) throw new Error(error.message)
  type Row = { id: string; number: number; customer_po_number?: string | null; companies: { name: string } | { name: string }[] | null }
  return ((data ?? []) as unknown as Row[]).map(r => {
    const c = Array.isArray(r.companies) ? r.companies[0] : r.companies
    return { id: r.id, number: r.number, customerPo: includePo ? (r.customer_po_number ?? null) : null, companyName: c?.name ?? 'Unknown company' }
  })
}

/** The signed-in person's job title, for the sign-off of a chase message. */
export async function getMyJobTitle(userId: string): Promise<string | null> {
  const rows = unwrap(await requireSupabase().from('users').select('id, job_title').eq('id', userId))
  return rows[0]?.job_title ?? null
}

// ---------------------------------------------------------------- money shown on the order page (admin and sales only)

export interface OrderMoney {
  grossTarget: number
  settled: number
  balance: number
  /** Received beyond the gross (v_order_money / order_receivables overpaid_by); 0 when not overpaid (HW-50). */
  overpaidBy?: number
  paymentState: string
  dueOn: string | null
  /** Admin only: the rest of v_order_money. Null for sales, who read order_receivables() and so get a balance and nothing else. */
  netSale: number | null
  actualCost: number | null
  expectedCost: number | null
  costsState: string | null
  margin: number | null
  marginState: string | null
}

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v))

/** Admin: v_order_money. Sales: order_receivables() (a balance, no payment rows, no cost, no margin). Never called for an engineer. */
export async function getOrderMoney(orderId: string, role: 'admin' | 'sales'): Promise<OrderMoney | null> {
  const db = requireSupabase()
  if (role === 'admin') {
    const m = unwrap(await db.from('v_order_money').select('order_id, gross_target, settled, receivable, overpaid_by, payment_state, due_on, net_sale, actual_cost, expected_cost, costs_state, margin, margin_state').eq('order_id', orderId).maybeSingle()) as unknown as Record<string, unknown> | null
    if (!m) return null
    return {
      grossTarget: num(m.gross_target) ?? 0,
      settled: num(m.settled) ?? 0,
      balance: num(m.receivable) ?? 0,
      overpaidBy: num(m.overpaid_by) ?? 0,
      paymentState: (m.payment_state as string | null) ?? 'unpaid',
      dueOn: (m.due_on as string | null) ?? null,
      netSale: num(m.net_sale),
      actualCost: num(m.actual_cost),
      expectedCost: num(m.expected_cost),
      costsState: (m.costs_state as string | null) ?? null,
      margin: num(m.margin),
      marginState: (m.margin_state as string | null) ?? null,
    }
  }
  const rows = unwrap(await db.rpc('order_receivables', { p_order_id: orderId })) ?? []
  const r = rows[0]
  if (!r) return null
  return {
    grossTarget: num(r.gross_target) ?? 0,
    settled: num(r.settled) ?? 0,
    balance: num(r.balance) ?? 0,
    overpaidBy: num(r.overpaid_by) ?? 0,
    paymentState: r.payment_state ?? 'unpaid',
    dueOn: r.due_on,
    netSale: null,
    actualCost: null,
    expectedCost: null,
    costsState: null,
    margin: null,
    marginState: null,
  }
}

export interface LegPo {
  legId: string
  number: number
  revision: number
  issuedOn: string
  /** Revision 0's issue date: PO-YY-NNNN takes its year from the first issue (as the PDF prints it), not from this revision's. */
  firstIssuedOn: string
  /** What the latest revision listed (order line and quantity), to tell whether the leg's lines have changed since. */
  lines: Array<{ orderItemId: string; qty: number }>
}

function poLines(json: unknown): LegPo['lines'] {
  if (!Array.isArray(json)) return []
  return json.flatMap(l => {
    const o = l as { order_item_id?: unknown; qty?: unknown }
    return typeof o.order_item_id === 'string' ? [{ orderItemId: o.order_item_id, qty: Number(o.qty) }] : []
  })
}

/** The latest PO revision of each leg (the "PO-26-0017 · R1" chip). A leg with none has no entry. */
/** `money` is false for an engineer: the PO's lines carry unit prices, so they are not even requested for him (the leg then never shows "lines changed"). */
export async function listLegPos(legIds: readonly string[], money = false): Promise<LegPo[]> {
  if (legIds.length === 0) return []
  const db = requireSupabase()
  const rows: Array<{ supplier_order_id: string; number: number; revision: number; issued_on: string; lines?: unknown }> = money
    ? unwrap(await db.from('purchase_orders').select('supplier_order_id, number, revision, issued_on, lines').in('supplier_order_id', [...legIds]).order('revision', { ascending: false }))
    : unwrap(await db.from('purchase_orders').select('supplier_order_id, number, revision, issued_on').in('supplier_order_id', [...legIds]).order('revision', { ascending: false }))
  const seen = new Set<string>()
  const first = new Map<string, { revision: number; issuedOn: string }>()
  for (const r of rows) {
    const f = first.get(r.supplier_order_id)
    if (!f || r.revision < f.revision) first.set(r.supplier_order_id, { revision: r.revision, issuedOn: r.issued_on })
  }
  const out: LegPo[] = []
  for (const r of rows) {
    if (seen.has(r.supplier_order_id)) continue
    seen.add(r.supplier_order_id)
    const firstIssuedOn = first.get(r.supplier_order_id)?.issuedOn ?? r.issued_on
    out.push({ legId: r.supplier_order_id, number: r.number, revision: r.revision, issuedOn: r.issued_on, firstIssuedOn, lines: 'lines' in r ? poLines(r.lines) : [] })
  }
  return out
}

// ---------------------------------------------------------------- add a line, add a leg, resolve a legacy price basis

export interface NewLine {
  /** Made by the dialog once per opening, so a retry or a second tap can only ever write the same line (BUG-RV-07). */
  id: string
  orderId: string
  position: number
  description: string
  qty: number
  unit: string | null
  unitPriceNet: number
  gstRate: number
  isService: boolean
  legId: string | null
  supplierUnitPrice: number | null
}

export async function addOrderItem(l: NewLine): Promise<void> {
  const { error } = await requireSupabase()
    .from('order_items')
    .insert({
      id: l.id,
      order_id: l.orderId,
      position: l.position,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      unit_price_net: l.unitPriceNet,
      gst_rate: l.gstRate,
      is_service: l.isService,
      supplier_order_id: l.isService ? null : l.legId,
      supplier_unit_price: l.isService ? null : l.supplierUnitPrice,
    })
  // 23505 on the client id: the first try already wrote this line (its reply was lost). Same outcome, not an error.
  if (error && error.code !== '23505') throw error
}

/** The number the next order will most likely take (the highest so far plus one), for the convert dialog's "Creates order ORD-0043". The issued number is the database's. */
export async function getNextOrderNumber(): Promise<number> {
  const rows = unwrap(await requireSupabase().from('orders').select('number').order('number', { ascending: false }).limit(1))
  return (rows[0]?.number ?? 0) + 1
}

/** Median days from placed to delivered over the supplier's finished legs (null with fewer than two): the default expected date's second source. */
export async function getSupplierMedianDays(supplierId: string): Promise<number | null> {
  const rows = unwrap(
    await requireSupabase().from('supplier_orders').select('placed_on, delivered_on').eq('supplier_id', supplierId).not('placed_on', 'is', null).not('delivered_on', 'is', null).order('delivered_on', { ascending: false }).limit(50),
  )
  return medianDeliveryDays(rows.map(r => ({ placedOn: r.placed_on, deliveredOn: r.delivered_on })))
}

export async function addOrderLeg(input: { id: string; orderId: string; supplierId: string; currency: string }): Promise<void> {
  const { error } = await requireSupabase().from('supplier_orders').insert({ id: input.id, order_id: input.orderId, supplier_id: input.supplierId, currency: input.currency })
  if (error && error.code !== '23505') throw error
}

/** Admin: legacy orders flagged value_basis_unknown. 'gross' divides each price by 1 + GST; a second call is refused by the database. */
export async function resolveValueBasis(orderId: string, basis: 'net' | 'gross'): Promise<void> {
  const { error } = await requireSupabase().rpc('resolve_value_basis', { p_order_id: orderId, p_basis: basis })
  if (error) throw error
}

/** Companies that are suppliers (have an inquiry, a leg or a carried brand), for "Add leg", with the currency they last quoted or billed in. */
export async function listSupplierChoices(): Promise<Array<{ id: string; name: string; lastCurrency: string | null }>> {
  const db = requireSupabase()
  const stats = unwrap(await db.from('v_supplier_stats').select('supplier_id'))
  const ids = stats.map(s => s.supplier_id).filter((i): i is string => Boolean(i))
  if (ids.length === 0) return []
  // The ids go in the request URL, so ask in chunks: one `in (...)` with every supplier overflows the URL limit (a 400 and an empty
  // picker) once there are a few hundred suppliers.
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += 100) chunks.push(ids.slice(i, i + 100))
  const [companyRes, legRes] = await Promise.all([
    Promise.all(chunks.map(c => db.from('companies').select('id, name').in('id', c))),
    Promise.all(chunks.map(c => db.from('supplier_orders').select('supplier_id, currency, created_at').in('supplier_id', c).not('currency', 'is', null).order('created_at', { ascending: false }).limit(500))),
  ])
  const last = new Map<string, string>()
  for (const l of legRes.flatMap(r => unwrap(r)).sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''))) {
    if (l.currency && !last.has(l.supplier_id)) last.set(l.supplier_id, l.currency.trim())
  }
  return companyRes
    .flatMap(r => unwrap(r))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(c => ({ id: c.id, name: c.name, lastCurrency: last.get(c.id) ?? null }))
}

// ---------------------------------------------------------------- the orders list (O04)

export interface OrderListRow {
  id: string
  number: number
  customerPo: string | null
  orderedOn: string | null
  ownerId: string | null
  ownerName: string | null
  companyId: string
  companyName: string
  siteName: string | null
  /** Imported from the old CRM (orders.legacy_source is set). */
  imported: boolean
  /** v_order_state, which every staff role may read. */
  lifecycle: string
  goods: string
  commissioning: string
  dataTrust: string
  /** Admin and sales only: never requested for an engineer. */
  invoicing: string | null
  gross: number | null
  /** Admin (v_order_money) and sales (order_receivables()): the payment state and what is still owed. Null for an engineer. */
  payment: string | null
  balance: number | null
  /** The engineers assigned (order_engineers), so an engineer's "My jobs" view can be a filter. */
  engineerIds: string[]
  /** orders.commissioning_planned_on: the "Next step" column says when the job is. */
  plannedOn: string | null
  /** Admin and sales: when the balance falls due (v_order_money / order_receivables()). Null for an engineer. */
  dueOn: string | null
  /** Admin only (v_order_money): 'complete' once costs are marked complete. Null for sales and engineers. */
  costsState: string | null
  /** What was ordered, no prices: "Belimo actuator ×6, Memosens pH sensor ×2" and whether there are more lines. */
  what: string
  moreLines: boolean
  /** Every line's description, lower case, for the search ("an item on line 5" is found too). No price. */
  itemsText: string
  /** The supplier orders that supply a goods line (as v_order_state counts them): who to order from or chase, no price. */
  legs: StepLeg[]
  /** Our supplier POs on this order ("PO-26-0017"), every supplier order, delivered or not: the search finds an order by them. No price. */
  poNumbers: string[]
}

/**
 * Every order with its five state dimensions. Reads are role-shaped, not just hidden: an engineer's request has no invoicing, gross,
 * payment or balance column in it, and no receivables call is made for them (DATA_MODEL section 10). 1,000-row pages (PostgREST's cap).
 */
export async function listOrders(role: 'admin' | 'sales' | 'engineer'): Promise<OrderListRow[]> {
  const db = requireSupabase()
  const money = role !== 'engineer'
  const stateCols = money ? 'order_id, lifecycle, goods_state, commissioning_state, data_trust, invoicing_state, gross' : 'order_id, lifecycle, goods_state, commissioning_state, data_trust'
  const [orders, states, users, assigned, pay, pos, importedRows] = await Promise.all([
    fetchAll(
      (from, to) =>
        db
          .from('orders')
          // every line (description, quantity, its supplier order; never a price) and the supplier orders with their dates and supplier
          .select(
            'id, number, customer_po_number, ordered_on, owner_id, company_id, commissioning_planned_on, companies(name), company_sites(name), order_items(description, qty, position, supplier_order_id, is_service), supplier_orders(id, placed_on, expected_on, delivered_on, companies(name))',
          )
          // Only the supplier orders a Next step can name: not yet delivered, or never marked placed. One that is placed and
          // delivered never changes the step (orderSteps reads open = placed and not delivered, and to-place = not placed), so it
          // is left on the server; that is every finished supplier order in history.
          .or(LIST_LEG_FILTER, { referencedTable: 'supplier_orders' })
          .order('number', { ascending: false })
          .range(from, to) as unknown as PromiseLike<{ data: OrdersJoin[] | null; error: { code?: string; message: string } | null }>,
    ),
    fetchAll(
      (from, to) =>
        db
          .from('v_order_state')
          .select(stateCols)
          .range(from, to) as unknown as PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { code?: string; message: string } | null }>,
    ),
    db.from('users').select('id, name'),
    fetchAll((from, to) => db.from('order_engineers').select('order_id, user_id').range(from, to)),
    role === 'admin'
      ? fetchAll(
          (from, to) =>
            db.from('v_order_money').select('order_id, payment_state, receivable, due_on, costs_state').range(from, to) as unknown as PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { code?: string; message: string } | null }>,
        )
      : role === 'sales'
        ? // paged: the unpaged RPC was cut at 1,000 rows
          (fetchReceivablesList() as unknown as Promise<Array<Record<string, unknown>>>)
        : Promise.resolve([] as Array<Record<string, unknown>>),
    // Our supplier PO numbers for the search: revision 0 of each (a revision keeps the number; its issue date gives the year). Only
    // the number and date are read, never the lines (prices).
    fetchAll(
      (from, to) =>
        db
          .from('purchase_orders')
          .select('number, issued_on, supplier_orders(order_id)')
          .eq('revision', 0)
          .order('number')
          .range(from, to) as unknown as PromiseLike<{ data: ListPoRow[] | null; error: { code?: string; message: string } | null }>,
    ),
    // Which orders came from the old CRM: the ids only (legacy_source itself may hold old prices, so it is never read here).
    fetchAll((from, to) => db.from('orders').select('id').not('legacy_source', 'is', null).order('id').range(from, to)),
  ])
  const importedIds = new Set(importedRows.map(r => r.id))
  const names = new Map(unwrap(users).map(u => [u.id, u.name]))
  const posBy = new Map<string, string[]>()
  for (const p of pos) {
    const orderId = (Array.isArray(p.supplier_orders) ? p.supplier_orders[0] : p.supplier_orders)?.order_id
    if (orderId) posBy.set(orderId, [...(posBy.get(orderId) ?? []), poRef(p.number, p.issued_on)])
  }
  const stateBy = new Map(states.map(s => [s.order_id as string, s]))
  const payBy = new Map(pay.map(p => [p.order_id as string, p]))
  const engBy = new Map<string, string[]>()
  for (const a of assigned) engBy.set(a.order_id, [...(engBy.get(a.order_id) ?? []), a.user_id])
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
  return orders.map(o => {
    const s = stateBy.get(o.id)
    const p = payBy.get(o.id)
    return {
      id: o.id,
      number: o.number,
      customerPo: o.customer_po_number,
      orderedOn: o.ordered_on,
      ownerId: o.owner_id ?? null,
      ownerName: o.owner_id ? (names.get(o.owner_id) ?? null) : null,
      companyId: o.company_id,
      companyName: one(o.companies)?.name ?? 'Unknown company',
      siteName: one(o.company_sites)?.name ?? null,
      imported: importedIds.has(o.id),
      lifecycle: (s?.lifecycle as string | undefined) ?? 'active',
      goods: (s?.goods_state as string | undefined) ?? 'n_a',
      commissioning: (s?.commissioning_state as string | undefined) ?? 'n_a',
      dataTrust: (s?.data_trust as string | undefined) ?? 'ok',
      invoicing: money ? ((s?.invoicing_state as string | null | undefined) ?? null) : null,
      gross: money && s?.gross !== null && s?.gross !== undefined ? Number(s.gross) : null,
      payment: money ? ((p?.payment_state as string | null | undefined) ?? null) : null,
      balance: money && p ? Number(p.receivable ?? p.balance ?? 0) : null,
      engineerIds: engBy.get(o.id) ?? [],
      plannedOn: o.commissioning_planned_on ?? null,
      dueOn: money && p ? ((p.due_on as string | null | undefined) ?? null) : null,
      costsState: role === 'admin' && p ? ((p.costs_state as string | null | undefined) ?? null) : null,
      ...listWhat(o.order_items ?? []),
      itemsText: (o.order_items ?? []).map(l => l.description.toLowerCase()).join(' \n '),
      legs: goodsLegs(o.supplier_orders ?? [], o.order_items ?? []).map(l => ({
        id: l.id,
        supplierName: one(l.companies)?.name ?? 'Unknown supplier',
        placedOn: l.placed_on,
        expectedOn: l.expected_on,
        deliveredOn: l.delivered_on,
      })),
      poNumbers: posBy.get(o.id) ?? [],
    }
  })
}

type ListPoRow = { number: number; issued_on: string; supplier_orders: { order_id: string } | Array<{ order_id: string }> | null }

/** The orders list's server-side filter on the embedded supplier orders (PostgREST `or`): the ones a Next step can still name. */
export const LIST_LEG_FILTER = 'delivered_on.is.null,placed_on.is.null'

/** The orders list's leg filter, in JS: what LIST_LEG_FILTER keeps. */
export const listLegKept = (l: { placed_on: string | null; delivered_on: string | null }): boolean => l.delivered_on === null || l.placed_on === null

/** The supplier orders that supply at least one goods line, as v_order_state counts them (an empty one is not a step). */
function goodsLegs<L extends { id: string }>(legs: readonly L[], lines: ReadonlyArray<{ supplier_order_id?: string | null; is_service?: boolean | null }>): L[] {
  const used = new Set(lines.filter(l => !l.is_service && l.supplier_order_id).map(l => l.supplier_order_id as string))
  return legs.filter(l => used.has(l.id))
}

/** How many lines the orders list names per order; one more is read to know whether there are others. */
const LIST_LINES = 2

/** "Belimo actuator ×6, Memosens pH sensor ×2", and whether the order has more lines than that. */
export function listWhat(lines: ReadonlyArray<{ description: string; qty: number | string; position?: number | null }>): { what: string; moreLines: boolean } {
  const sorted = [...lines].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
  return {
    what: sorted
      .slice(0, LIST_LINES)
      .map(l => `${l.description} ×${Number(l.qty)}`)
      .join(', '),
    moreLines: sorted.length > LIST_LINES,
  }
}

type OrdersJoin = {
  id: string
  number: number
  customer_po_number: string | null
  ordered_on: string | null
  owner_id?: string | null
  company_id: string
  site_id?: string | null
  commissioning_planned_on?: string | null
  companies: { name: string } | { name: string }[] | null
  company_sites: { name: string } | { name: string }[] | null
  order_items?: Array<{ description: string; qty: number | string; position: number | null; supplier_order_id?: string | null; is_service?: boolean | null }> | null
  supplier_orders?: Array<{ id: string; placed_on: string | null; expected_on: string | null; delivered_on: string | null; companies: { name: string } | { name: string }[] | null }> | null
}

// ---------------------------------------------------------------- a repeat order, or an order that came in without an RFQ (O02)

export interface PastOrder {
  id: string
  number: number
  companyId: string
  companyName: string
  siteName: string | null
  orderedOn: string | null
  customerPo: string | null
  lineCount: number
  /** "Belimo NM24A-SR ×6, Cerabar PMC51 ×3 and 2 more": what the order was for. No prices. */
  summary: string
}

const likeSafe = (s: string) => escapeLike(s).replace(/[,()]/g, ' ')

/**
 * Past orders to start a new one from, found by company, site, item text, order number or customer PO. With nothing typed, the most
 * recent ones. Cancelled orders are left out. No price is read: the new order copies them in the database (create_repeat_order).
 */
export async function searchPastOrders(text: string, signal?: AbortSignal, limit = 12): Promise<PastOrder[]> {
  const db = requireSupabase()
  const q = text.trim()
  const orderCols = 'id, number, company_id, site_id, ordered_on, customer_po_number, companies(name), company_sites(name)'
  const base = () => {
    const req = db.from('orders').select(orderCols).is('cancelled_on', null).order('ordered_on', { ascending: false, nullsFirst: false }).order('number', { ascending: false }).limit(limit)
    return signal ? req.abortSignal(signal) : req
  }
  let rows: OrdersJoin[]
  if (!q) {
    rows = unwrap(await base()) as unknown as OrdersJoin[]
  } else {
    const like = `%${likeSafe(q)}%`
    const [companies, sites, items] = await Promise.all([
      db.from('companies').select('id').ilike('name', like).limit(30),
      db.from('company_sites').select('id').or(`name.ilike.${like},address.ilike.${like}`).limit(30),
      db.from('order_items').select('order_id').ilike('description', like).limit(60),
    ])
    const companyIds = unwrap(companies).map(c => c.id)
    const siteIds = unwrap(sites).map(s => s.id)
    const itemOrderIds = [...new Set(unwrap(items).map(i => i.order_id))]
    const digits = /^(ord[-\s]*)?0*(\d{1,9})$/i.exec(q)
    const filters: string[] = [`customer_po_number.ilike.${like}`]
    if (companyIds.length) filters.push(`company_id.in.(${companyIds.join(',')})`)
    if (siteIds.length) filters.push(`site_id.in.(${siteIds.join(',')})`)
    if (itemOrderIds.length) filters.push(`id.in.(${itemOrderIds.join(',')})`)
    if (digits) filters.push(`number.eq.${Number(digits[2])}`)
    rows = unwrap(await base().or(filters.join(','))) as unknown as OrdersJoin[]
  }
  return hydratePastOrders(rows)
}

async function hydratePastOrders(rows: OrdersJoin[]): Promise<PastOrder[]> {
  if (rows.length === 0) return []
  const db = requireSupabase()
  const lines = unwrap(
    await db
      .from('order_items')
      .select('order_id, description, qty, position')
      .in(
        'order_id',
        rows.map(r => r.id),
      )
      .order('position'),
  )
  const byOrder = new Map<string, Array<{ description: string; qty: number }>>()
  for (const l of lines) byOrder.set(l.order_id, [...(byOrder.get(l.order_id) ?? []), { description: l.description, qty: Number(l.qty) }])
  const one = <T,>(v: T | T[] | null): T | null => (Array.isArray(v) ? (v[0] ?? null) : v)
  return rows.map(r => {
    const ls = byOrder.get(r.id) ?? []
    const shown = ls.slice(0, 2).map(l => `${l.description} ×${l.qty}`)
    return {
      id: r.id,
      number: r.number,
      companyId: r.company_id,
      companyName: one(r.companies)?.name ?? 'Unknown company',
      siteName: one(r.company_sites)?.name ?? null,
      orderedOn: r.ordered_on,
      customerPo: r.customer_po_number,
      lineCount: ls.length,
      summary: `${shown.join(', ')}${ls.length > 2 ? ` and ${ls.length - 2} more` : ''}`,
    }
  })
}

/** One past order by id (the "Repeat order" button on a company's order history opens the dialog with it already chosen). */
export async function getPastOrder(id: string): Promise<PastOrder | null> {
  const rows = unwrap(
    await requireSupabase().from('orders').select('id, number, company_id, site_id, ordered_on, customer_po_number, companies(name), company_sites(name)').eq('id', id).limit(1),
  ) as unknown as OrdersJoin[]
  return (await hydratePastOrders(rows))[0] ?? null
}

/** Where an order came from: its RFQ and the quotation that was the latest when it was won (Mark won makes the order from it). */
export interface OrderSource {
  rfqId: string
  rfqNumber: number
  quotation: { number: number; revision: number; issuedOn: string } | null
}

/** The RFQ (and its quotation) of a Mark won order, for "From RFQ-0123 · QT-26-0007 R1". Admin and sales only: a quotation carries prices. */
export async function getOrderSource(rfqId: string, orderCreatedAt: string | undefined): Promise<OrderSource | null> {
  const db = requireSupabase()
  const [rfqs, quotes] = await Promise.all([
    db.from('rfqs').select('number').eq('id', rfqId).limit(1),
    db.from('quotations').select('number, revision, issued_on, created_at').eq('rfq_id', rfqId).order('revision', { ascending: false }),
  ])
  const rfq = unwrap(rfqs)[0]
  if (!rfq) return null
  const all = unwrap(quotes)
  const q = (orderCreatedAt ? all.find(x => x.created_at <= orderCreatedAt) : undefined) ?? all[all.length - 1] ?? null
  // issued_on of the first issue names the year (QT-YY-NNNN): revisions keep the number, so the first revision's date is used
  const first = all.length ? all.reduce((a, x) => (x.revision < a.revision ? x : a), all[0]) : null
  return { rfqId, rfqNumber: Number(rfq.number), quotation: q && first ? { number: q.number, revision: q.revision, issuedOn: first.issued_on } : null }
}

export interface RepeatInput {
  /** Client-generated: a second call with the same id returns the same order and writes nothing, so a double submit makes one order. */
  orderId: string
  fromOrderId: string
  customerPo: string | null
  orderedOn: string | null
  /** The person confirmed repeating an order that was cancelled (the database asks first). */
  repeatCancelled?: boolean
}

/** create_repeat_order: copies the source order's company, site, contact, terms, lines with their last prices, and the legs that supplied them. */
export async function createRepeatOrder(input: RepeatInput): Promise<string> {
  const { data, error } = await requireSupabase().rpc('create_repeat_order', {
    p_order_id: input.orderId,
    p_from_order_id: input.fromOrderId,
    ...(input.customerPo ? { p_customer_po_number: input.customerPo } : {}),
    ...(input.orderedOn ? { p_ordered_on: input.orderedOn } : {}),
    ...(input.repeatCancelled ? { p_repeat_cancelled: true } : {}),
  })
  if (error) throw error
  return (data as string | null) ?? input.orderId
}
