import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import { toBusinessDate } from '@/lib/dates'
import type { ViewRow } from '@/features/dbTypes'
import { previousMonthStart } from '@/features/today/rules'
import type {
  ClarificationFact,
  InquiryFact,
  LegFact,
  MonthEndFact,
  OrderFact,
  ReceivableFact,
  RfqFact,
  Role,
  SnoozeFact,
} from '@/features/today/types'

/*
 * Today (R11, R16): every database call for the Today screen. The only file in the feature that names a table, view or
 * RPC. Access is Row Level Security's job (DATA_MODEL section 10); a read a role may not make is not made at all
 * (`user.role` gates the receivables and the month-end checks), and the control is not rendered either.
 *
 * The reads feed the pure rules in rules.ts as plain facts. Nothing here decides what is due.
 */
type PgError = { code?: string; message: string }
type Page<T> = PromiseLike<{ data: T[] | null; error: PgError | null }>
const num = (v: number | string | null | undefined) => (v === null || v === undefined ? 0 : Number(v))

export interface TodayData {
  rfqs: RfqFact[]
  clarifications: ClarificationFact[]
  inquiries: InquiryFact[]
  legs: LegFact[]
  orders: OrderFact[]
  receivables: ReceivableFact[]
  monthEnd: MonthEndFact | null
  snoozes: SnoozeFact[]
  /** users.role by id (everyone is readable by every staff role). */
  roles: Record<string, Role>
  /** The caller's own job title and phone, for the email signature. */
  jobTitle: string | null
  phone: string | null
  /** users.name by id, for the collision line. */
  names: Record<string, string>
}

type RfqStateRow = ViewRow<'v_rfq_state'> & { companies: { name: string; city: string | null } | null }

/** "Indus Textile Mills — Faisalabad": a company with its city, as the mockups write it. */
export const withCity = (name: string, city: string | null | undefined): string => (city?.trim() ? `${name} — ${city.trim()}` : name)

async function loadRfqs(): Promise<{ rfqs: RfqFact[]; open: Set<string> }> {
  const db = requireSupabase()
  const [states, refs] = await Promise.all([
    fetchAll<RfqStateRow>((from, to) => db.from('v_rfq_state').select('*, companies(name, city)').eq('outcome', 'open').order('number').range(from, to) as unknown as Page<RfqStateRow>),
    fetchAll<{ id: string; customer_ref: string | null; due_time: string | null }>((from, to) => db.from('rfqs').select('id, customer_ref, due_time').is('closed_on', null).order('number').range(from, to)),
  ])
  const refBy = new Map(refs.map(r => [r.id, r.customer_ref]))
  const timeBy = new Map(refs.map(r => [r.id, r.due_time]))
  const rfqs = states.map<RfqFact>(r => ({
    id: r.rfq_id as string,
    number: num(r.number),
    ownerId: r.owner_id,
    companyName: r.companies ? withCity(r.companies.name, r.companies.city) : 'Unknown company',
    customerRef: refBy.get(r.rfq_id as string) ?? null,
    receivedOn: r.received_on as string,
    dueOn: r.due_on,
    dueTime: timeBy.get(r.rfq_id as string) ?? null,
    quotedOn: r.quoted_on,
    isPriority: Boolean(r.is_priority),
    bidState: (r.bid_state ?? 'to_bid') as RfqFact['bidState'],
    sourcingState: r.sourcing_state ?? 'not_floated',
    quotationValidUntil: r.quotation_valid_until ?? null,
  }))
  return { rfqs, open: new Set(rfqs.map(r => r.id)) }
}

async function loadClarifications(open: Set<string>): Promise<ClarificationFact[]> {
  const db = requireSupabase()
  const rows = await fetchAll((from, to) =>
    db
      .from('clarifications')
      .select('id, rfq_id, question, rfq_item_id, first_asked_at, last_asked_at, last_asked_by, ask_count')
      .is('answered_at', null)
      .is('withdrawn_at', null)
      .not('first_asked_at', 'is', null)
      .order('created_at')
      .range(from, to),
  )
  return rows
    .filter(c => open.has(c.rfq_id) && c.first_asked_at)
    .map(c => ({
      id: c.id,
      rfqId: c.rfq_id,
      question: c.question,
      rfqItemId: c.rfq_item_id,
      firstAskedOn: toBusinessDate(new Date(c.first_asked_at as string)),
      lastAskedOn: toBusinessDate(new Date((c.last_asked_at ?? c.first_asked_at) as string)),
      lastAskedAt: (c.last_asked_at ?? c.first_asked_at) as string,
      lastAskedBy: c.last_asked_by,
      askCount: num(c.ask_count),
    }))
}

async function loadInquiries(open: Set<string>, names: Map<string, string>): Promise<InquiryFact[]> {
  const db = requireSupabase()
  const [rows, stats] = await Promise.all([
    fetchAll((from, to) =>
      db
        .from('v_inquiry_state')
        .select('inquiry_id, rfq_id, supplier_id, sent_on, last_chased_on, chase_count, response_state, answers_to_relay')
        .or('response_state.eq.awaiting,answers_to_relay.gt.0')
        .range(from, to),
    ),
    fetchAll((from, to) => db.from('v_supplier_stats').select('supplier_id, replied, median_reply_days').range(from, to)),
  ])
  const statBy = new Map(stats.map(s => [s.supplier_id, s]))
  // v_inquiry_state does not carry who chased; the table does (0048).
  const actors = unwrap(await db.from('supplier_inquiries').select('id, last_chased_by').not('last_chased_by', 'is', null))
  const actorBy = new Map(actors.map(a => [a.id, a.last_chased_by]))
  // When did the answers that wait to be relayed come in? Answered after the inquiry's last relay.
  const relayIds = rows.filter(r => num(r.answers_to_relay) > 0 && r.inquiry_id).map(r => r.inquiry_id as string)
  const answeredOn = new Map<string, string>()
  if (relayIds.length > 0) {
    const [inqs, answered] = await Promise.all([
      db.from('supplier_inquiries').select('id, last_relayed_at').in('id', relayIds),
      db.from('clarifications').select('raised_by_inquiry_id, answered_at').in('raised_by_inquiry_id', relayIds).not('answered_at', 'is', null).is('withdrawn_at', null),
    ])
    const relayedAt = new Map(unwrap(inqs).map(i => [i.id, i.last_relayed_at]))
    for (const a of unwrap(answered)) {
      const id = a.raised_by_inquiry_id as string
      const at = a.answered_at as string
      const last = relayedAt.get(id)
      if (last && at <= last) continue
      const day = toBusinessDate(new Date(at))
      if (!answeredOn.has(id) || day > (answeredOn.get(id) as string)) answeredOn.set(id, day)
    }
  }
  return rows
    .filter(r => r.rfq_id && open.has(r.rfq_id) && r.inquiry_id && r.supplier_id)
    .map(r => {
      const s = statBy.get(r.supplier_id)
      return {
        id: r.inquiry_id as string,
        rfqId: r.rfq_id as string,
        supplierId: r.supplier_id as string,
        supplierName: names.get(r.supplier_id as string) ?? 'Unknown supplier',
        sentOn: r.sent_on,
        lastChasedOn: r.last_chased_on,
        lastChasedBy: actorBy.get(r.inquiry_id as string) ?? null,
        chaseCount: num(r.chase_count),
        responseState: r.response_state ?? 'awaiting',
        answersToRelay: num(r.answers_to_relay),
        answeredOn: answeredOn.get(r.inquiry_id as string) ?? null,
        replied: num(s?.replied),
        medianReplyDays: s?.median_reply_days === null || s?.median_reply_days === undefined ? null : Number(s.median_reply_days),
      }
    })
}

type LegRow = {
  id: string
  order_id: string
  supplier_id: string
  reference: string | null
  placed_on: string | null
  expected_on: string | null
  received_on: string | null
  delivered_on: string | null
  last_chased_on: string | null
  last_chased_by: string | null
  chase_count: number
  orders: { number: number; owner_id: string | null; ordered_on: string | null; company_id: string } | null
}

async function loadLegs(names: Map<string, string>, labels: Map<string, string>): Promise<LegFact[]> {
  const db = requireSupabase()
  const rows = await fetchAll<LegRow>(
    (from, to) =>
      db
        .from('supplier_orders')
        .select('id, order_id, supplier_id, reference, placed_on, expected_on, received_on, delivered_on, last_chased_on, last_chased_by, chase_count, orders!inner(number, owner_id, ordered_on, company_id, cancelled_on)')
        .is('orders.cancelled_on', null)
        .is('delivered_on', null)
        .order('created_at')
        .range(from, to) as unknown as Page<LegRow>,
  )
  return rows
    .filter(l => l.orders)
    .map(l => ({
      id: l.id,
      orderId: l.order_id,
      orderNumber: num(l.orders?.number),
      ownerId: l.orders?.owner_id ?? null,
      customerName: labels.get(l.orders?.company_id as string) ?? 'Unknown company',
      supplierName: names.get(l.supplier_id) ?? 'Unknown supplier',
      reference: l.reference,
      orderedOn: l.orders?.ordered_on ?? null,
      placedOn: l.placed_on,
      expectedOn: l.expected_on,
      receivedOn: l.received_on,
      deliveredOn: l.delivered_on,
      lastChasedOn: l.last_chased_on,
      lastChasedBy: l.last_chased_by,
      chaseCount: num(l.chase_count),
    }))
}

/**
 * The live orders the two order rules read (O05): needs planning, or fully delivered and not invoiced. States come from
 * v_order_state, which hides invoicing from an engineer (the column is null for them), so an engineer's list is the
 * to-plan orders only and no invoicing read is asked for. The dates (ordered, last delivery, commissioning done) are
 * read in a second step, for just those orders.
 */
async function loadOrders(role: Role, names: Map<string, string>): Promise<OrderFact[]> {
  const db = requireSupabase()
  const money = role === 'admin' || role === 'sales'
  const states = await fetchAll(
    (from, to) =>
      db
        .from('v_order_state')
        // invoicing_state is money-gated: an engineer's request never names it
        .select((money ? 'order_id, number, company_id, owner_id, lifecycle, goods_state, commissioning_state, invoicing_state, gross, invoiced' : 'order_id, number, company_id, owner_id, lifecycle, goods_state, commissioning_state') as 'order_id, number, company_id, owner_id, lifecycle, goods_state, commissioning_state, invoicing_state, gross, invoiced')
        .eq('lifecycle', 'active')
        .or(money ? 'commissioning_state.eq.to_plan,invoicing_state.eq.not_invoiced,invoicing_state.eq.part' : 'commissioning_state.eq.to_plan')
        .order('number')
        .range(from, to),
  )
  const live = states.filter(r => r.order_id)
  const dates = new Map<string, { orderedOn: string | null; commissioningDoneOn: string | null; deliveredOn: string | null }>()
  const lastInvoiced = new Map<string, string>()
  const partIds = new Set(live.filter(r => r.invoicing_state === 'part').map(r => r.order_id as string))
  const ids = live.map(r => r.order_id as string)
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const [orders, legs, invoices] = await Promise.all([
      db.from('orders').select('id, ordered_on, commissioning_done_on').in('id', chunk),
      db.from('supplier_orders').select('order_id, delivered_on').in('order_id', chunk).not('delivered_on', 'is', null),
      // only part-invoiced orders need their last invoice date, and only admin and sales may read invoices
      money && chunk.some(id => partIds.has(id)) ? db.from('invoices').select('order_id, invoice_date').in('order_id', chunk.filter(id => partIds.has(id))) : Promise.resolve({ data: [], error: null }),
    ])
    for (const v of unwrap(invoices) ?? []) {
      if (v.order_id && v.invoice_date && (!lastInvoiced.has(v.order_id) || v.invoice_date > (lastInvoiced.get(v.order_id) as string))) lastInvoiced.set(v.order_id, v.invoice_date)
    }
    for (const o of unwrap(orders)) dates.set(o.id, { orderedOn: o.ordered_on, commissioningDoneOn: o.commissioning_done_on, deliveredOn: null })
    for (const l of unwrap(legs)) {
      const d = dates.get(l.order_id)
      if (d && l.delivered_on && (!d.deliveredOn || l.delivered_on > d.deliveredOn)) d.deliveredOn = l.delivered_on
    }
  }
  return live.map(r => {
    const d = dates.get(r.order_id as string)
    const deliveredOn = [d?.deliveredOn ?? null, d?.commissioningDoneOn ?? null].filter((x): x is string => Boolean(x)).sort().at(-1) ?? null
    return {
      id: r.order_id as string,
      number: num(r.number),
      ownerId: r.owner_id,
      customerName: names.get(r.company_id as string) ?? 'Unknown company',
      orderedOn: d?.orderedOn ?? null,
      goodsState: r.goods_state ?? 'n_a',
      commissioningState: r.commissioning_state ?? 'n_a',
      invoicingState: money ? (r.invoicing_state ?? null) : null,
      toInvoice: money && r.invoicing_state === 'part' ? Math.max(0, num(r.gross) - num(r.invoiced)) : null,
      lastInvoicedOn: lastInvoiced.get(r.order_id as string) ?? null,
      deliveredOn,
    }
  })
}

async function loadReceivables(names: Map<string, string>): Promise<ReceivableFact[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.rpc('order_receivables')) ?? []
  return rows
    .filter(r => r.is_overdue)
    .map(r => ({
      orderId: r.order_id,
      orderNumber: num(r.order_number),
      ownerId: r.owner_id ?? null,
      customerName: names.get(r.company_id) ?? 'Unknown company',
      balance: num(r.balance),
      settled: num(r.settled),
      dueOn: r.due_on ?? null,
      isOverdue: Boolean(r.is_overdue),
      lastRemindedOn: r.last_reminded_on ?? null,
      reminderCount: num(r.reminder_count),
    }))
}

/** The close-month item reads only on the 1st to the 10th: one RPC and one tiny read, admin only. */
async function loadMonthEnd(today: string): Promise<MonthEndFact | null> {
  const day = Number(today.slice(8, 10))
  if (day > 10) return null
  const db = requireSupabase()
  const month = previousMonthStart(today)
  const [checks, closed] = await Promise.all([db.rpc('month_end_status', { p_month: month }), db.from('closed_months').select('month').eq('month', month).maybeSingle()])
  const rows = unwrap(checks) ?? []
  const closedRow = unwrap(closed)
  return { month, checks: rows.reduce((n, r) => n + num(r.n), 0), closed: Boolean(closedRow) }
}

async function loadSnoozes(today: string): Promise<SnoozeFact[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('snoozes').select('rule, subject_id, until_on').gt('until_on', today))
  return rows.map(r => ({ rule: r.rule, subjectId: r.subject_id, untilOn: r.until_on }))
}

/** Everything the rules read, in one go. `today` is the business date; `role` gates the money reads. */
export async function loadTodayData(user: { id: string; role: Role }, today: string): Promise<TodayData> {
  const role = user.role
  const db = requireSupabase()
  const [{ rfqs, open }, companies, users, snoozes] = await Promise.all([
    loadRfqs(),
    fetchAll((from, to) => db.from('companies').select('id, name, city').order('name').range(from, to)),
    db.from('users').select('id, role, name, job_title, phone'),
    loadSnoozes(today),
  ])
  const names = new Map(companies.map(c => [c.id, c.name]))
  /** Customers read "Name — City"; suppliers stay plain. */
  const labels = new Map(companies.map(c => [c.id, withCity(c.name, c.city)]))
  const money = role === 'admin' || role === 'sales'
  const [clarifications, inquiries, legs, orders, receivables, monthEnd] = await Promise.all([
    loadClarifications(open),
    loadInquiries(open, names),
    loadLegs(names, labels),
    loadOrders(role, names),
    money ? loadReceivables(labels) : Promise.resolve<ReceivableFact[]>([]),
    role === 'admin' ? loadMonthEnd(today) : Promise.resolve<MonthEndFact | null>(null),
  ])
  const userRows = unwrap(users)
  return {
    rfqs,
    clarifications,
    inquiries,
    legs,
    orders,
    receivables,
    monthEnd,
    snoozes,
    roles: Object.fromEntries(userRows.map(u => [u.id, u.role as Role])),
    jobTitle: userRows.find(u => u.id === user.id)?.job_title ?? null,
    phone: userRows.find(u => u.id === user.id)?.phone ?? null,
    names: Object.fromEntries(userRows.map(u => [u.id, u.name])),
  }
}

export interface TargetProgress {
  year: number
  quarter: number
  quarterEnd: string
  /** Null when no target is set for this quarter. */
  targetNet: number | null
  achievedNet: number
  gap: number
  onPaceNet: number
  behindPace: number
  excludedCount: number
}

/** my_target_progress(): always the caller's own row for the current quarter. */
export async function getMyTarget(): Promise<TargetProgress | null> {
  const db = requireSupabase()
  const rows = unwrap(await db.rpc('my_target_progress')) ?? []
  const r = rows[0]
  if (!r) return null
  return {
    year: num(r.year),
    quarter: num(r.quarter),
    quarterEnd: r.quarter_end,
    targetNet: r.target_net === null || r.target_net === undefined ? null : Number(r.target_net),
    achievedNet: num(r.achieved_net),
    gap: num(r.gap),
    onPaceNet: num(r.on_pace_net),
    behindPace: num(r.behind_pace),
    excludedCount: num(r.excluded_count),
  }
}

// ================================================================ drafts: what the generators need beyond the Today facts

export interface LegDraftData {
  contact: { name: string; phone: string | null } | null
  items: Array<{ description: string; brandName: string | null; qty: number; unit: string | null }>
}

/** The goods lines on one supplier leg, and the supplier's first contact. */
export async function getLegDraft(legId: string): Promise<LegDraftData> {
  const db = requireSupabase()
  const [items, leg] = await Promise.all([
    db.from('order_items').select('description, qty, unit, brand_id, position').eq('supplier_order_id', legId).eq('is_service', false).order('position'),
    db.from('supplier_orders').select('supplier_id').eq('id', legId).maybeSingle(),
  ])
  const rows = unwrap(items)
  const supplierId = unwrap(leg)?.supplier_id
  const brandIds = [...new Set(rows.map(r => r.brand_id).filter((b): b is string => Boolean(b)))]
  const [brands, contacts] = await Promise.all([
    brandIds.length ? db.from('brands').select('id, name').in('id', brandIds) : Promise.resolve({ data: [], error: null }),
    supplierId ? db.from('contacts').select('name, phone').eq('company_id', supplierId).order('created_at').limit(1) : Promise.resolve({ data: [], error: null }),
  ])
  const brandBy = new Map((unwrap(brands) ?? []).map(b => [b.id, b.name]))
  const contact = (unwrap(contacts) ?? [])[0] ?? null
  return {
    contact: contact ? { name: contact.name, phone: contact.phone } : null,
    items: rows.map(r => ({ description: r.description, brandName: r.brand_id ? (brandBy.get(r.brand_id) ?? null) : null, qty: num(r.qty), unit: r.unit })),
  }
}

export interface PaymentDraftData {
  customerPo: string | null
  contact: { name: string; phone: string | null } | null
  /** The earliest invoice that is still open, and every invoice of the order with the reminder fields before a stamp. */
  invoiceNumber: string | null
  invoiceDate: string | null
  invoices: Array<{ id: string; lastRemindedOn: string | null; reminderCount: number }>
}

/** The order's PO number and contact, and its invoices (admin and sales only; RLS refuses an engineer). */
export async function getPaymentDraft(orderId: string): Promise<PaymentDraftData> {
  const db = requireSupabase()
  const [order, invoices] = await Promise.all([
    db.from('orders').select('customer_po_number, contact_id').eq('id', orderId).maybeSingle(),
    db.from('invoices').select('id, number, invoice_date, last_reminded_on, reminder_count').eq('order_id', orderId).order('invoice_date'),
  ])
  const o = unwrap(order)
  const inv = unwrap(invoices) ?? []
  const contactRes = o?.contact_id ? await db.from('contacts').select('name, phone').eq('id', o.contact_id).maybeSingle() : null
  const contactRow = contactRes ? unwrap<{ name: string; phone: string | null } | null>(contactRes) : null
  const contact: { name: string; phone: string | null } | null = contactRow ? { name: contactRow.name, phone: contactRow.phone } : null
  const first = inv[0]
  return {
    customerPo: o?.customer_po_number ?? null,
    contact,
    invoiceNumber: first?.number ?? null,
    invoiceDate: first?.invoice_date ?? null,
    invoices: inv.map(i => ({ id: i.id, lastRemindedOn: i.last_reminded_on, reminderCount: num(i.reminder_count) })),
  }
}

// ================================================================ writes: stamps, taking them back, snoozes

export interface ClarificationBefore {
  id: string
  firstAskedAt: string | null
  lastAskedAt: string | null
  lastAskedBy: string | null
  askCount: number
}

/** stamp_clarification_ask: the questions in the message are now asked once more. Returns how many were stamped. */
export async function stampCustomerChase(ids: string[]): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('stamp_clarification_ask', { p_clarification_ids: ids })
  if (error) throw error
  return data ?? 0
}

/** The values a questions held before the stamp, read at the moment of the tap so an Undo restores exactly them. */
export async function readClarificationsBefore(ids: string[]): Promise<ClarificationBefore[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('clarifications').select('id, first_asked_at, last_asked_at, last_asked_by, ask_count').in('id', ids))
  return rows.map(r => ({ id: r.id, firstAskedAt: r.first_asked_at, lastAskedAt: r.last_asked_at, lastAskedBy: r.last_asked_by, askCount: num(r.ask_count) }))
}

export async function undoCustomerChase(before: readonly ClarificationBefore[]): Promise<void> {
  const db = requireSupabase()
  for (const b of before) {
    const { error } = await db.from('clarifications').update({ first_asked_at: b.firstAskedAt, last_asked_at: b.lastAskedAt, last_asked_by: b.lastAskedBy, ask_count: b.askCount }).eq('id', b.id)
    if (error) throw error
  }
}

export async function stampSupplierChaseOnToday(inquiryId: string): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('stamp_supplier_chase', { p_inquiry_id: inquiryId })
  if (error) throw error
  return data ?? 0
}

export async function undoSupplierChase(inquiryId: string, before: { lastChasedOn: string | null; lastChasedBy?: string | null; chaseCount: number }): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('supplier_inquiries').update({ last_chased_on: before.lastChasedOn, last_chased_by: before.lastChasedBy ?? null, chase_count: before.chaseCount }).eq('id', inquiryId)
  if (error) throw error
}

/** stamp_goods_chase (0033): last_chased_on = today, chase_count + 1 on the supplier leg. */
export async function stampGoodsChase(legId: string): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('stamp_goods_chase', { p_leg_id: legId })
  if (error) throw error
  return data ?? 0
}

export async function undoGoodsChase(legId: string, before: { lastChasedOn: string | null; lastChasedBy?: string | null; chaseCount: number }): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('supplier_orders').update({ last_chased_on: before.lastChasedOn, last_chased_by: before.lastChasedBy ?? null, chase_count: before.chaseCount }).eq('id', legId)
  if (error) throw error
}

/** stamp_payment_reminder: every invoice of the order is reminded today. */
export async function stampPaymentReminder(invoiceIds: string[]): Promise<number> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('stamp_payment_reminder', { p_invoice_ids: invoiceIds })
  if (error) throw error
  return data ?? 0
}

export async function undoPaymentReminder(before: ReadonlyArray<{ id: string; lastRemindedOn: string | null; reminderCount: number }>): Promise<void> {
  const db = requireSupabase()
  for (const b of before) {
    const { error } = await db.from('invoices').update({ last_reminded_on: b.lastRemindedOn, reminder_count: b.reminderCount }).eq('id', b.id)
    if (error) throw error
  }
}

/** Snooze one item until a date (own row; one snooze per rule and subject, replaced if it exists). */
export async function snoozeItem(input: { rule: string; subjectId: string; untilOn: string }): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.from('snoozes').upsert({ rule: input.rule, subject_id: input.subjectId, until_on: input.untilOn }, { onConflict: 'user_id,rule,subject_id' })
  if (error) throw error
}

/** Take a snooze back; with `previous`, put the earlier one back instead of deleting. */
export async function unsnoozeItem(input: { rule: string; subjectId: string; previousUntilOn?: string | null }): Promise<void> {
  const db = requireSupabase()
  if (input.previousUntilOn) {
    await snoozeItem({ rule: input.rule, subjectId: input.subjectId, untilOn: input.previousUntilOn })
    return
  }
  const { error } = await db.from('snoozes').delete().eq('rule', input.rule).eq('subject_id', input.subjectId)
  if (error) throw error
}

