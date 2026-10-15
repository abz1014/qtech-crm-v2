import { requireSupabase, unwrap } from '@/lib/supabase'
import type { TableUpdate, ViewRow } from '@/features/dbTypes'
import type { ConvertPayloadLine } from '@/features/orders/lib/convert'
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
  } | null
}

type Maybe<T> = { data: T | null; error: { code?: string; message: string } | null }
const none = Promise.resolve({ data: null, error: null })

const STATE_NO_MONEY = 'order_id, lifecycle, goods_state, commissioning_state, data_trust'
const STATE_WITH_MONEY = 'order_id, lifecycle, goods_state, commissioning_state, invoicing_state, data_trust, net, gst, gross'

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

export async function listOrderLegs(orderId: string, itemRows: readonly Pick<OrderItemRow, 'legId' | 'rfqItemId'>[]): Promise<OrderLegRow[]> {
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
  return legs.map(l => {
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
