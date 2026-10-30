import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import { toBusinessDate } from '@/lib/dates'
import type { ViewRow } from '@/features/dbTypes'
import { previousMonthStart, today1 } from '@/features/today/rules'
import { getGstDeadlines } from '@/features/settings/gstApi'
import { getHealth } from '@/features/settings/healthApi'
import { gstDatesFor } from '@/features/settings/gstDeadlines'
import { addDays } from '@/features/rfqs/lib/dateText'
import { fetchReceivablesList, type ReceivablesListRow } from '@/features/money/payments/api'
import { billPeriod, billPeriods } from '@/features/money/expenses/forMonth'
import type {
  ClarificationFact,
  CostFact,
  InvoiceFact,
  RecurringFact,
  InquiryFact,
  JobFact,
  LegFact,
  MonthEndFact,
  OrderFact,
  ReceivableFact,
  RfqFact,
  Role,
  SnoozeFact,
  GstFact,
  ClaimsFact,
  HealthFact,
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
  /** P3-D. Admin only: last month's GST to FBR. Null otherwise. */
  gst: GstFact | null
  /** P3-D. Admin only: engineers' "I paid" claims waiting. Null otherwise. */
  claims: ClaimsFact | null
  /** 0120. Admin only: backup age, plan usage and the monthly key check. Null otherwise, and when the function cannot be read. */
  health: HealthFact | null
  /** M08. Admin only; empty otherwise. */
  costs: CostFact[]
  /** M08. Admin and sales only; empty for an engineer (the read is never made). */
  invoices: InvoiceFact[]
  /** M08. Admin only; empty otherwise. */
  recurring: RecurringFact[]
  /** Engineers only: the live orders they are assigned to (their jobs). Empty for everyone else (the read is never made). */
  jobs: JobFact[]
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

/**
 * Supplier enquiries on open RFQs that await a reply or have answers to relay: one today_inquiry_facts() call (0074) with the
 * chaser, the date the waiting answers came in (Karachi) and the supplier's reply stats. It replaces five reads, one of which
 * (who chased) was cut at 1,000 rows. `open` still narrows to the RFQs Today lists.
 */
async function loadInquiries(open: Set<string>): Promise<InquiryFact[]> {
  const db = requireSupabase()
  const rows = await fetchAll((from, to) => db.rpc('today_inquiry_facts').range(from, to))
  return rows.filter(r => r.rfq_id && open.has(r.rfq_id) && r.inquiry_id && r.supplier_id).map(toInquiryFact)
}

type InquiryFactRow = {
  inquiry_id: string
  rfq_id: string
  supplier_id: string
  supplier_name: string | null
  sent_on: string | null
  last_chased_on: string | null
  last_chased_by: string | null
  chase_count: number | null
  response_state: string | null
  answers_to_relay: number | null
  answered_on: string | null
  replied: number | null
  median_reply_days: number | string | null
}

export const toInquiryFact = (r: InquiryFactRow): InquiryFact => ({
  id: r.inquiry_id,
  rfqId: r.rfq_id,
  supplierId: r.supplier_id,
  supplierName: r.supplier_name ?? 'Unknown supplier',
  sentOn: r.sent_on,
  lastChasedOn: r.last_chased_on,
  lastChasedBy: r.last_chased_by ?? null,
  chaseCount: num(r.chase_count),
  responseState: r.response_state ?? 'awaiting',
  answersToRelay: num(r.answers_to_relay),
  answeredOn: r.answered_on ?? null,
  replied: num(r.replied),
  medianReplyDays: r.median_reply_days === null || r.median_reply_days === undefined ? null : Number(r.median_reply_days),
})

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

/**
 * Which of these orders came from the old CRM (owner decision 2026-10-22, 1b: their order tasks wait for Review imported). The ids
 * only: legacy_source itself is never read here. In chunks of 100, so a long list never makes a long address.
 */
async function importedOrderIds(orderIds: readonly string[]): Promise<Set<string>> {
  const db = requireSupabase()
  const ids = [...new Set(orderIds)]
  const out = new Set<string>()
  for (let i = 0; i < ids.length; i += 100) {
    const found = unwrap(await db.from('orders').select('id').in('id', ids.slice(i, i + 100)).not('legacy_source', 'is', null)) ?? []
    for (const o of found) out.add(o.id)
  }
  return out
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
  const imported = await importedOrderIds(rows.filter(l => l.orders).map(l => l.order_id))
  return rows
    .filter(l => l.orders)
    .map(l => ({
      id: l.id,
      legacy: imported.has(l.order_id),
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
        .or(money ? 'commissioning_state.eq.to_plan,goods_state.eq.to_source,invoicing_state.eq.not_invoiced,invoicing_state.eq.part' : 'commissioning_state.eq.to_plan,goods_state.eq.to_source')
        .order('number')
        .range(from, to),
  )
  const live = states.filter(r => r.order_id)
  const dates = new Map<string, { orderedOn: string | null; commissioningDoneOn: string | null; deliveredOn: string | null }>()
  const lastInvoiced = new Map<string, string>()
  const unsourced = new Map<string, number>()
  const toSourceIds = new Set(live.filter(r => r.goods_state === 'to_source').map(r => r.order_id as string))
  const partIds = new Set(live.filter(r => r.invoicing_state === 'part').map(r => r.order_id as string))
  const ids = live.map(r => r.order_id as string)
  const imported = await importedOrderIds(ids)
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const [orders, legs, invoices, lines] = await Promise.all([
      db.from('orders').select('id, ordered_on, commissioning_done_on').in('id', chunk),
      db.from('supplier_orders').select('order_id, delivered_on').in('order_id', chunk).not('delivered_on', 'is', null),
      // only part-invoiced orders need their last invoice date, and only admin and sales may read invoices
      money && chunk.some(id => partIds.has(id)) ? db.from('invoices').select('order_id, invoice_date').in('order_id', chunk.filter(id => partIds.has(id))) : Promise.resolve({ data: [], error: null }),
      chunk.some(id => toSourceIds.has(id))
        ? db.from('order_items').select('order_id').in('order_id', chunk.filter(id => toSourceIds.has(id))).eq('is_service', false).is('supplier_order_id', null)
        : Promise.resolve({ data: [], error: null }),
    ])
    for (const l of unwrap(lines) ?? []) unsourced.set(l.order_id, (unsourced.get(l.order_id) ?? 0) + 1)
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
      unsourced: r.goods_state === 'to_source' ? (unsourced.get(r.order_id as string) ?? 0) : 0,
      toInvoice: money && r.invoicing_state === 'part' ? Math.max(0, num(r.gross) - num(r.invoiced)) : null,
      lastInvoicedOn: lastInvoiced.get(r.order_id as string) ?? null,
      deliveredOn,
      legacy: imported.has(r.order_id as string),
    }
  })
}

type JobOrderRow = {
  id: string
  number: number
  owner_id: string | null
  company_id: string
  commissioning_planned_on: string | null
  visit_type?: string | null
  company_sites: { name: string } | { name: string }[] | null
}

/**
 * An engineer's jobs: the live orders they are assigned to (order_engineers), with the goods and commissioning states, the
 * planned date and the last delivery to site. Every read here is one the engineer already makes on the Orders list and the
 * order page (RLS lets every staff role read orders, order_engineers, v_order_state without its money columns, and
 * supplier_orders), so no new grant and no migration is needed. Three small reads, all filtered to the assigned orders.
 */
async function loadJobs(userId: string, names: Map<string, string>): Promise<JobFact[]> {
  const db = requireSupabase()
  const mine = unwrap(await db.from('order_engineers').select('order_id').eq('user_id', userId)) ?? []
  const ids = [...new Set(mine.map(r => r.order_id))]
  if (ids.length === 0) return []
  const jobs: JobFact[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const chunk = ids.slice(i, i + 100)
    const [states, orders, legs, imported] = await Promise.all([
      db.from('v_order_state').select('order_id, lifecycle, goods_state, commissioning_state, data_trust').in('order_id', chunk).eq('lifecycle', 'active'),
      db.from('orders').select('id, number, owner_id, company_id, commissioning_planned_on, visit_type, company_sites(name)').in('id', chunk) as unknown as PromiseLike<{ data: JobOrderRow[] | null; error: PgError | null }>,
      db.from('supplier_orders').select('order_id, delivered_on').in('order_id', chunk).not('delivered_on', 'is', null),
      // which of them came from the old CRM: the ids only (legacy_source itself may hold old prices, so it is never read here)
      db.from('orders').select('id').in('id', chunk).not('legacy_source', 'is', null),
    ])
    const legacy = new Set((unwrap(imported) ?? []).map(o => o.id))
    const orderBy = new Map((unwrap(orders) ?? []).map(o => [o.id, o]))
    const delivered = new Map<string, string>()
    for (const l of unwrap(legs) ?? []) {
      if (l.delivered_on && (!delivered.has(l.order_id) || l.delivered_on > (delivered.get(l.order_id) as string))) delivered.set(l.order_id, l.delivered_on)
    }
    for (const s of unwrap(states) ?? []) {
      const o = orderBy.get(s.order_id as string)
      if (!o) continue
      const site = Array.isArray(o.company_sites) ? o.company_sites[0] : o.company_sites
      jobs.push({
        orderId: o.id,
        orderNumber: num(o.number),
        ownerId: o.owner_id,
        customerName: names.get(o.company_id) ?? 'Unknown company',
        siteName: site?.name ?? null,
        goodsState: s.goods_state ?? 'n_a',
        commissioningState: s.commissioning_state ?? 'n_a',
        plannedOn: o.commissioning_planned_on,
        visitType: o.visit_type ?? null,
        deliveredOn: delivered.get(o.id) ?? null,
        legacy: legacy.has(o.id) || s.data_trust === 'estimated_dates',
      })
    }
  }
  return jobs.sort((a, b) => a.orderNumber - b.orderNumber)
}

/** Overdue orders only, filtered on the server (receivables_list 'overdue' = is_overdue) and paged, so none is lost past 1,000 rows. */
async function loadReceivables(names: Map<string, string>): Promise<ReceivableFact[]> {
  const rows = await fetchReceivablesList({ p_state: 'overdue' })
  // owner decision 2026-10-22 (1): a late payment on an imported order waits in the Imported fold (ids only are read)
  const imported = await importedOrderIds(rows.map(r => r.order_id))
  return rows.map(r => ({ ...toReceivableFact(r, names), legacy: imported.has(r.order_id) }))
}

export const toReceivableFact = (r: Omit<ReceivablesListRow, 'company_name' | 'invoice_numbers'>, names: Map<string, string>): ReceivableFact => ({
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
})

/**
 * P3-D, admin only: how much of last month's GST is still to pay. The invoices dated last month that carry GST (not imported, not
 * settled before the cutover), and how many of them have no tax deposit recorded. One small read.
 */
async function loadGst(today: string): Promise<GstFact> {
  const db = requireSupabase()
  const month = previousMonthStart(today)
  const rows =
    unwrap(
      await db
        .from('invoices')
        .select('id, tax_deposited_on')
        .gte('invoice_date', month)
        .lt('invoice_date', today1(today))
        .gt('gst_amount', 0)
        .is('legacy_source', null)
        .eq('settled_before_cutover', false),
    ) ?? []
  // the dates are the admin's settings (0110), not a fixed 15th and 18th
  const { payBy, returnBy } = gstDatesFor(await getGstDeadlines(), month)
  return { month, invoices: rows.length, undeposited: rows.filter(r => !r.tax_deposited_on).length, payBy, returnBy }
}

/**
 * 0120, admin only: the backup and plan-usage facts. A failure here must never take the whole list down (the function may not exist yet on
 * an older database), so it returns null and the three health rows are simply absent.
 */
async function loadHealth(): Promise<HealthFact | null> {
  try {
    const h = await getHealth()
    if (!h) return null
    return {
      backupOn: toBusinessDate(new Date(h.lastBackupAt ?? h.trackingSince)),
      backupRecorded: h.lastBackupAt !== null,
      decryptOn: toBusinessDate(new Date(h.lastDecryptTestAt ?? h.trackingSince)),
      dbBytes: h.dbBytes,
      storageBytes: h.storageBytes,
    }
  } catch {
    return null
  }
}

/** P3-D, admin only: engineers' pending "I paid" claims (0087): how many, and the day the oldest was made. */
async function loadClaims(): Promise<ClaimsFact> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('expense_claims').select('created_at').eq('status', 'pending').order('created_at').limit(500)) ?? []
  return claimsFactFrom(rows)
}

/** The pending count and the Pakistan day the oldest was made (created_at is a UTC timestamp: its first 10 characters can be the day before). */
export function claimsFactFrom(rows: readonly { created_at: string | null }[]): ClaimsFact {
  const first = rows[0]?.created_at
  return { pending: rows.length, oldestOn: first ? toBusinessDate(new Date(first)) : null }
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

/**
 * M08, admin only: paid orders whose costs are still provisional, from v_order_money (the margin contract: payment_state,
 * costs_state, expected_cost, actual_cost, data_trust). Cancelled orders are dropped with one read of `orders`.
 */
async function loadCosts(): Promise<CostFact[]> {
  const db = requireSupabase()
  const rows = await fetchAll((from, to) =>
    db
      .from('v_order_money')
      .select('order_id, order_number, expected_cost, actual_cost, payment_state, costs_state, data_trust')
      .eq('payment_state', 'settled')
      .eq('costs_state', 'provisional')
      .order('order_number')
      .range(from, to),
  )
  const ids = rows.map(r => r.order_id).filter((id): id is string => Boolean(id))
  const cancelled = new Set<string>()
  const imported = new Set<string>()
  for (let i = 0; i < ids.length; i += 150) {
    const slice = ids.slice(i, i + 150)
    const [found, old] = await Promise.all([
      db.from('orders').select('id').in('id', slice).not('cancelled_on', 'is', null),
      // which came from the old CRM: the ids only (legacy_source itself is never read here)
      db.from('orders').select('id').in('id', slice).not('legacy_source', 'is', null),
    ])
    for (const o of unwrap(found) ?? []) cancelled.add(o.id)
    for (const o of unwrap(old) ?? []) imported.add(o.id)
  }
  return rows
    .filter(r => r.order_id)
    .map(r => ({
      orderId: r.order_id as string,
      orderNumber: num(r.order_number),
      expectedCost: r.expected_cost === null || r.expected_cost === undefined ? null : Number(r.expected_cost),
      actualCost: num(r.actual_cost),
      paymentState: r.payment_state ?? '',
      costsState: r.costs_state ?? '',
      basisUnknown: r.data_trust === 'basis_unknown',
      cancelled: cancelled.has(r.order_id as string),
      legacy: imported.has(r.order_id as string),
    }))
}

/** M08, admin and sales: the invoices the FBR and TCS rules read (v_invoice_state), narrowed on the server to the ones that can raise an item. */
async function loadInvoiceFacts(today: string): Promise<InvoiceFact[]> {
  const db = requireSupabase()
  const earliest = addDays(today, -60) ?? today
  const rows = await fetchAll((from, to) =>
    db
      .from('v_invoice_state')
      .select('invoice_id, order_id, number, invoice_date, courier_state, fbr_state, fbr_exception, needs_fbr_attention')
      .or(`needs_fbr_attention.eq.true,fbr_exception.eq.true,and(courier_state.in.(not_started,copy_received),invoice_date.gte.${earliest})`)
      .order('invoice_date')
      .range(from, to),
  )
  return rows
    .filter(r => r.invoice_id)
    .map(r => ({
      id: r.invoice_id as string,
      number: r.number,
      orderId: r.order_id,
      invoiceDate: r.invoice_date,
      courierState: r.courier_state ?? 'not_started',
      fbrState: r.fbr_state ?? 'pending',
      fbrException: Boolean(r.fbr_exception),
      needsFbrAttention: Boolean(r.needs_fbr_attention),
    }))
}

/**
 * M08, admin only: the active recurring templates and whether an expense exists for each for the month its bill is for (0087
 * for-month: a template paid on day 1 to 10 pays last month's bill, the same rule as Expenses' Monthly bills).
 */
async function loadRecurringFacts(today: string): Promise<RecurringFact[]> {
  const db = requireSupabase()
  const periods = billPeriods(today)
  const [templates, recorded] = await Promise.all([
    db.from('recurring_expenses').select('id, label, day_of_month, active, start_month, category_id').eq('active', true).order('label'),
    db.from('expenses').select('recurring_id, period').in('period', periods).not('recurring_id', 'is', null),
  ])
  const done = new Set((unwrap(recorded) ?? []).map(r => `${r.recurring_id as string}|${r.period as string}`))
  return (unwrap(templates) ?? []).map(t => {
    const period = billPeriod({ dayOfMonth: t.day_of_month, categoryId: t.category_id }, today)
    return { id: t.id, label: t.label, dayOfMonth: t.day_of_month, active: t.active, startMonth: t.start_month, period, recorded: done.has(`${t.id}|${period}`) }
  })
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
  const [clarifications, inquiries, legs, orders, receivables, monthEnd, gst, claims, health, costs, invoices, recurring, jobs] = await Promise.all([
    loadClarifications(open),
    loadInquiries(open),
    loadLegs(names, labels),
    loadOrders(role, names),
    money ? loadReceivables(labels) : Promise.resolve<ReceivableFact[]>([]),
    role === 'admin' ? loadMonthEnd(today) : Promise.resolve<MonthEndFact | null>(null),
    role === 'admin' ? loadGst(today) : Promise.resolve<GstFact | null>(null),
    role === 'admin' ? loadClaims() : Promise.resolve<ClaimsFact | null>(null),
    role === 'admin' ? loadHealth() : Promise.resolve<HealthFact | null>(null),
    role === 'admin' ? loadCosts() : Promise.resolve<CostFact[]>([]),
    money ? loadInvoiceFacts(today) : Promise.resolve<InvoiceFact[]>([]),
    role === 'admin' ? loadRecurringFacts(today) : Promise.resolve<RecurringFact[]>([]),
    role === 'engineer' ? loadJobs(user.id, names) : Promise.resolve<JobFact[]>([]),
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
    gst,
    claims,
    health,
    costs,
    invoices,
    recurring,
    jobs,
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
  contact: { name: string; phone: string | null; email?: string | null } | null
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
    supplierId ? db.from('contacts').select('name, phone, email').eq('company_id', supplierId).order('created_at').limit(1) : Promise.resolve({ data: [], error: null }),
  ])
  const brandBy = new Map((unwrap(brands) ?? []).map(b => [b.id, b.name]))
  const contact = (unwrap(contacts) ?? [])[0] ?? null
  return {
    contact: contact ? { name: contact.name, phone: contact.phone, email: contact.email } : null,
    items: rows.map(r => ({ description: r.description, brandName: r.brand_id ? (brandBy.get(r.brand_id) ?? null) : null, qty: num(r.qty), unit: r.unit })),
  }
}

export interface PaymentDraftData {
  customerPo: string | null
  contact: { name: string; phone: string | null; email?: string | null; jobTitle?: string | null } | null
  /** The earliest invoice that is still open, and every invoice of the order with the reminder fields before a stamp. */
  invoiceNumber: string | null
  invoiceDate: string | null
  /** Every invoice number on the order, oldest first (the reminder names them all when there are two or more). */
  invoiceNumbers?: string[]
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
  const contactRes = o?.contact_id ? await db.from('contacts').select('name, phone, email, job_title').eq('id', o.contact_id).maybeSingle() : null
  const contactRow = contactRes ? unwrap<{ name: string; phone: string | null; email: string | null; job_title: string | null } | null>(contactRes) : null
  const contact: PaymentDraftData['contact'] = contactRow ? { name: contactRow.name, phone: contactRow.phone, email: contactRow.email, jobTitle: contactRow.job_title } : null
  const first = inv[0]
  return {
    customerPo: o?.customer_po_number ?? null,
    contact,
    invoiceNumber: first?.number ?? null,
    invoiceDate: first?.invoice_date ?? null,
    invoiceNumbers: inv.map(i => i.number).filter((n): n is string => Boolean(n)),
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

type ChaseStampRow = { last_chased_on: string | null; last_chased_by: string | null; chase_count: number }

/** A supplier inquiry's chase stamp as it is now, read at the tap so an Undo restores exactly it (the Today facts may be stale). */
export async function readSupplierChaseBefore(inquiryId: string): Promise<{ lastChasedOn: string | null; lastChasedBy: string | null; chaseCount: number } | null> {
  const db = requireSupabase()
  const r = unwrap<ChaseStampRow | null>(await db.from('supplier_inquiries').select('id, last_chased_on, last_chased_by, chase_count').eq('id', inquiryId).maybeSingle())
  return r ? { lastChasedOn: r.last_chased_on, lastChasedBy: r.last_chased_by, chaseCount: num(r.chase_count) } : null
}

/** A supplier leg's goods-chase stamp as it is now, read at the tap. */
export async function readGoodsChaseBefore(legId: string): Promise<{ lastChasedOn: string | null; lastChasedBy: string | null; chaseCount: number } | null> {
  const db = requireSupabase()
  const r = unwrap<ChaseStampRow | null>(await db.from('supplier_orders').select('id, last_chased_on, last_chased_by, chase_count').eq('id', legId).maybeSingle())
  return r ? { lastChasedOn: r.last_chased_on, lastChasedBy: r.last_chased_by, chaseCount: num(r.chase_count) } : null
}

/** The invoices' reminder stamps as they are now, read at the tap. */
export async function readPaymentRemindersBefore(invoiceIds: string[]): Promise<Array<{ id: string; lastRemindedOn: string | null; reminderCount: number }>> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('invoices').select('id, last_reminded_on, reminder_count').in('id', invoiceIds)) ?? []
  return rows.map(r => ({ id: r.id, lastRemindedOn: r.last_reminded_on, reminderCount: num(r.reminder_count) }))
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
export async function snoozeItem(input: { rule: string; subjectId: string; untilOn: string; untilChange?: boolean }): Promise<void> {
  const db = requireSupabase()
  // until_change (0097, "Not ours to chase"): the snooze ends when the record changes; until_on is then only a far-off ceiling.
  const { error } = await db
    .from('snoozes')
    .upsert({ rule: input.rule, subject_id: input.subjectId, until_on: input.untilOn, until_change: input.untilChange === true }, { onConflict: 'user_id,rule,subject_id' })
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

