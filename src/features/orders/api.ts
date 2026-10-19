import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import type { TableUpdate, ViewRow } from '@/features/dbTypes'
import type { ConvertPayloadLine } from '@/features/orders/lib/convert'
import { mapRankRows, type RankedQuote, type RankRow } from '@/features/orders/lib/ranking'
import type { LegPatch } from '@/features/orders/lib/legModel'

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

type Maybe<T> = { data: T | null; error: { code?: string; message: string } | null }
const none = Promise.resolve({ data: null, error: null })

const STATE_NO_MONEY = 'order_id, lifecycle, goods_state, commissioning_state, data_trust'
const STATE_WITH_MONEY = 'order_id, lifecycle, goods_state, commissioning_state, invoicing_state, data_trust, net, gst, gross, invoiced'

/** The order, its people and its derived states. Null when there is no such order. `money` is false for an engineer. */
export async function getOrderHeader(id: string, money: boolean): Promise<OrderHeader | null> {
  const db = requireSupabase()
  const [orderRes, stateRes] = await Promise.all([
    db.from('orders').select('*').eq('id', id).maybeSingle(),
    db
      .from('v_order_state')
      .select(money ? STATE_WITH_MONEY : STATE_NO_MONEY)
      .eq('order_id', id)
      .maybeSingle(),
  ])
  const o = unwrap(orderRes)
  if (!o) return null
  const [company, site, contact, owner] = await Promise.all([
    db.from('companies').select('name').eq('id', o.company_id).maybeSingle(),
    o.site_id ? db.from('company_sites').select('name, address').eq('id', o.site_id).maybeSingle() : none,
    o.contact_id ? db.from('contacts').select('name, phone').eq('id', o.contact_id).maybeSingle() : none,
    o.owner_id ? db.from('users').select('id, name').eq('id', o.owner_id).maybeSingle() : none,
  ])
  const s = unwrap(stateRes) as Partial<OrderStateRow> | null
  return {
    id: o.id,
    number: o.number,
    companyId: o.company_id,
    companyName: unwrap(company)?.name ?? 'Unknown company',
    rfqId: o.rfq_id,
    customerPo: o.customer_po_number,
    orderedOn: o.ordered_on,
    paymentTermsDays: o.payment_terms_days,
    needsCommissioning: o.needs_commissioning,
    plannedOn: o.commissioning_planned_on,
    doneOn: o.commissioning_done_on,
    cancelledOn: o.cancelled_on,
    cancelReason: o.cancel_reason,
    imported: o.legacy_source !== null,
    notes: o.notes,
    site: unwrap(site as Maybe<NonNullable<OrderHeader["site"]>>),
    contact: unwrap(contact as Maybe<NonNullable<OrderHeader["contact"]>>),
    owner: unwrap(owner as Maybe<NonNullable<OrderHeader["owner"]>>),
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
  qty: number
  unit: string | null
  isService: boolean
  legId: string | null
  rfqItemId: string | null
  /** Null for an engineer: the column is never requested. */
  unitPriceNet: number | null
  gstRate: number | null
  supplierUnitPrice: number | null
}

export async function listOrderItems(orderId: string, money: boolean): Promise<OrderItemRow[]> {
  const db = requireSupabase()
  const base = 'id, position, description, brand_id, qty, unit, is_service, supplier_order_id, rfq_item_id, created_at'
  const rows = unwrap(
    await db
      .from('order_items')
      .select(money ? `${base}, unit_price_net, gst_rate, supplier_unit_price` : base)
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
    qty: Number(r.qty),
    unit: (r.unit as string | null) ?? null,
    isService: Boolean(r.is_service),
    legId: (r.supplier_order_id as string | null) ?? null,
    rfqItemId: (r.rfq_item_id as string | null) ?? null,
    unitPriceNet: money ? num(r.unit_price_net) : null,
    gstRate: money ? num(r.gst_rate) : null,
    supplierUnitPrice: money ? num(r.supplier_unit_price) : null,
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

export async function listOrderLegs(orderId: string, itemRows: readonly Pick<OrderItemRow, 'legId' | 'rfqItemId' | 'number'>[]): Promise<OrderLegRow[]> {
  const db = requireSupabase()
  const legs = unwrap(await db.from('supplier_orders').select('*').eq('order_id', orderId).order('created_at').order('id'))
  if (legs.length === 0) return []
  const supplierIds = [...new Set(legs.map(l => l.supplier_id))]
  const inquiryIds = [...new Set(legs.map(l => l.inquiry_id).filter((i): i is string => Boolean(i)))]
  const [companies, lines] = await Promise.all([
    db.from('companies').select('id, name').in('id', supplierIds),
    inquiryIds.length
      ? db.from('supplier_quote_lines').select('inquiry_id, rfq_item_id, lead_time').in('inquiry_id', inquiryIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  const names = new Map(unwrap(companies).map(c => [c.id, c.name]))
  const quoteLines = unwrap(lines) ?? []
  // Leg letters (A, B, ...) must not depend on the order the database happens to return rows in: a leg comes in the order of its
  // first line on the order, then by its creation time.
  const firstLine = (legId: string) => Math.min(...itemRows.filter(i => i.legId === legId).map(i => i.number), Number.MAX_SAFE_INTEGER)
  const ordered = [...legs].sort((a, b) => firstLine(a.id) - firstLine(b.id) || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
  return ordered.map(l => {
    const itemIds = new Set(itemRows.filter(i => i.legId === l.id && i.rfqItemId).map(i => i.rfqItemId as string))
    return {
      id: l.id,
      supplierId: l.supplier_id,
      supplierName: names.get(l.supplier_id) ?? 'Unknown supplier',
      currency: l.currency ? l.currency.trim() : null,
      reference: l.reference,
      placedOn: l.placed_on,
      expectedOn: l.expected_on,
      receivedOn: l.received_on,
      deliveredOn: l.delivered_on,
      lastChasedOn: l.last_chased_on,
      chaseCount: l.chase_count,
      inquiryId: l.inquiry_id,
      leadTimes: quoteLines.filter(q => q.inquiry_id === l.inquiry_id && itemIds.has(q.rfq_item_id) && q.lead_time).map(q => q.lead_time as string),
    }
  })
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
}

export async function convertRfqToOrder(input: ConvertInput): Promise<string> {
  const { data, error } = await requireSupabase().rpc('convert_rfq_to_order', {
    p_order_id: input.orderId,
    p_rfq_id: input.rfqId,
    p_items: input.items as unknown as never,
    ...(input.customerPo ? { p_customer_po_number: input.customerPo } : {}),
    ...(input.paymentTermsDays !== null ? { p_payment_terms_days: input.paymentTermsDays } : {}),
  })
  if (error) throw error
  return (data as string | null) ?? input.orderId
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
  return mapRankRows(rows as unknown as RankRow[], names)
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
    const m = unwrap(await db.from('v_order_money').select('order_id, gross_target, settled, receivable, payment_state, due_on, net_sale, actual_cost, expected_cost, costs_state, margin, margin_state').eq('order_id', orderId).maybeSingle()) as unknown as Record<string, unknown> | null
    if (!m) return null
    return {
      grossTarget: num(m.gross_target) ?? 0,
      settled: num(m.settled) ?? 0,
      balance: num(m.receivable) ?? 0,
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
  const out: LegPo[] = []
  for (const r of rows) {
    if (seen.has(r.supplier_order_id)) continue
    seen.add(r.supplier_order_id)
    out.push({ legId: r.supplier_order_id, number: r.number, revision: r.revision, issuedOn: r.issued_on, lines: 'lines' in r ? poLines(r.lines) : [] })
  }
  return out
}

// ---------------------------------------------------------------- add a line, add a leg, resolve a legacy price basis

export interface NewLine {
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
  if (error) throw error
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
}

/**
 * Every order with its five state dimensions. Reads are role-shaped, not just hidden: an engineer's request has no invoicing, gross,
 * payment or balance column in it, and no receivables call is made for them (DATA_MODEL section 10). 1,000-row pages (PostgREST's cap).
 */
export async function listOrders(role: 'admin' | 'sales' | 'engineer'): Promise<OrderListRow[]> {
  const db = requireSupabase()
  const money = role !== 'engineer'
  const stateCols = money ? 'order_id, lifecycle, goods_state, commissioning_state, data_trust, invoicing_state, gross' : 'order_id, lifecycle, goods_state, commissioning_state, data_trust'
  const [orders, states, users, assigned, pay] = await Promise.all([
    fetchAll(
      (from, to) =>
        db
          .from('orders')
          .select('id, number, customer_po_number, ordered_on, owner_id, company_id, companies(name), company_sites(name)')
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
            db.from('v_order_money').select('order_id, payment_state, receivable').range(from, to) as unknown as PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { code?: string; message: string } | null }>,
        )
      : role === 'sales'
        ? db.rpc('order_receivables').then(r => {
            if (r.error) throw r.error
            return (r.data ?? []) as Array<Record<string, unknown>>
          })
        : Promise.resolve([] as Array<Record<string, unknown>>),
  ])
  const names = new Map(unwrap(users).map(u => [u.id, u.name]))
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
      lifecycle: (s?.lifecycle as string | undefined) ?? 'active',
      goods: (s?.goods_state as string | undefined) ?? 'n_a',
      commissioning: (s?.commissioning_state as string | undefined) ?? 'n_a',
      dataTrust: (s?.data_trust as string | undefined) ?? 'ok',
      invoicing: money ? ((s?.invoicing_state as string | null | undefined) ?? null) : null,
      gross: money && s?.gross !== null && s?.gross !== undefined ? Number(s.gross) : null,
      payment: money ? ((p?.payment_state as string | null | undefined) ?? null) : null,
      balance: money && p ? Number(p.receivable ?? p.balance ?? 0) : null,
      engineerIds: engBy.get(o.id) ?? [],
    }
  })
}

type OrdersJoin = {
  id: string
  number: number
  customer_po_number: string | null
  ordered_on: string | null
  owner_id?: string | null
  company_id: string
  site_id?: string | null
  companies: { name: string } | { name: string }[] | null
  company_sites: { name: string } | { name: string }[] | null
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

export interface RepeatInput {
  /** Client-generated: a second call with the same id returns the same order and writes nothing, so a double submit makes one order. */
  orderId: string
  fromOrderId: string
  customerPo: string | null
  orderedOn: string | null
}

/** create_repeat_order: copies the source order's company, site, contact, terms, lines with their last prices, and the legs that supplied them. */
export async function createRepeatOrder(input: RepeatInput): Promise<string> {
  const { data, error } = await requireSupabase().rpc('create_repeat_order', {
    p_order_id: input.orderId,
    p_from_order_id: input.fromOrderId,
    ...(input.customerPo ? { p_customer_po_number: input.customerPo } : {}),
    ...(input.orderedOn ? { p_ordered_on: input.orderedOn } : {}),
  })
  if (error) throw error
  return (data as string | null) ?? input.orderId
}
