// Today (R11): the facts the rules read, and the items they produce. Plain data, no framework. The facts are shaped by
// api.ts from the views (v_rfq_state, v_inquiry_state, v_supplier_stats, v_order_state), the legs, order_receivables(),
// month_end_status() and the caller's own snoozes; the rules in rules.ts never touch the database.

export type Role = 'admin' | 'sales' | 'engineer'

export type RuleKey =
  | 'chase_customer'
  | 'relay_answers'
  | 'not_floated'
  | 'chase_supplier'
  | 'bid_due'
  | 'decision_overdue'
  | 'payment_overdue'
  | 'goods_late'
  | 'place_po'
  | 'plan_commissioning'
  | 'to_source'
  | 'delivered_not_invoiced'
  | 'close_month'
  | 'costs_incomplete'
  | 'fbr_attention'
  | 'tcs_not_sent'
  | 'recurring_due'
  | 'job_commissioning'
  | 'job_on_site'
  | 'weekly_review'
  | 'gst_fbr'
  | 'claims_to_approve'

/** The rule key written to snoozes.rule (DATA_MODEL 2.21 gives `chase_customer_clarification` as the example). */
export const SNOOZE_RULE: Record<RuleKey, string> = {
  chase_customer: 'chase_customer_clarification',
  relay_answers: 'relay_answers',
  not_floated: 'not_floated',
  chase_supplier: 'chase_supplier_quote',
  bid_due: 'bid_due',
  decision_overdue: 'decision_overdue',
  payment_overdue: 'payment_overdue',
  goods_late: 'goods_late',
  place_po: 'place_po',
  plan_commissioning: 'plan_commissioning',
  to_source: 'to_source',
  delivered_not_invoiced: 'delivered_not_invoiced',
  close_month: 'close_month',
  costs_incomplete: 'costs_incomplete',
  fbr_attention: 'fbr_attention',
  tcs_not_sent: 'tcs_not_sent',
  recurring_due: 'recurring_due',
  job_commissioning: 'job_commissioning',
  job_on_site: 'job_on_site',
  weekly_review: 'weekly_review',
  gst_fbr: 'gst_fbr',
  claims_to_approve: 'claims_to_approve',
}

export type TodayTab = 'bids' | 'sourcing' | 'money'
export type TodayGroup = 'now' | 'soon' | 'ready'

// ---------------------------------------------------------------- facts

export interface RfqFact {
  id: string
  number: number
  ownerId: string | null
  companyName: string
  customerRef: string | null
  receivedOn: string
  dueOn: string | null
  /** rfqs.due_time ("17:00:00"), when the bid has a deadline time. */
  dueTime: string | null
  quotedOn: string | null
  isPriority: boolean
  /** v_rfq_state.bid_state */
  bidState: 'to_bid' | 'bid_sent' | 'quotation_expired'
  /** v_rfq_state.sourcing_state */
  sourcingState: string
  /** Only open RFQs are loaded (outcome = open). */
  quotationValidUntil: string | null
}

/** One open, asked, unanswered question. */
export interface ClarificationFact {
  id: string
  rfqId: string
  question: string
  /** clarifications.rfq_item_id: the item the question is about. */
  rfqItemId: string | null
  firstAskedOn: string
  lastAskedOn: string
  /** The latest ask as a timestamp, for "copied at 14:32". */
  lastAskedAt: string
  /** Who made it (users.id), for the collision line. */
  lastAskedBy: string | null
  askCount: number
}

export interface InquiryFact {
  id: string
  rfqId: string
  supplierId: string
  supplierName: string
  sentOn: string | null
  lastChasedOn: string | null
  lastChasedBy?: string | null
  chaseCount: number
  /** v_inquiry_state.response_state: awaiting / quoted / no_offer */
  responseState: string
  answersToRelay: number
  /** The day the latest not-yet-relayed answer came in (clarifications.answered_at, business date), or null when none. */
  answeredOn: string | null
  /** v_supplier_stats: how many inquiries they answered, and the median days they took (null when not enough). */
  replied: number
  medianReplyDays: number | null
}

export interface LegFact {
  id: string
  orderId: string
  orderNumber: number
  ownerId: string | null
  customerName: string
  supplierName: string
  /** supplier_orders.reference */
  reference: string | null
  orderedOn: string | null
  placedOn: string | null
  expectedOn: string | null
  receivedOn: string | null
  deliveredOn: string | null
  lastChasedOn: string | null
  lastChasedBy?: string | null
  chaseCount: number
  /**
   * Imported from the old CRM (orders.legacy_source is set). Owner decision 2026-10-22 (1b): its order and invoicing tasks are
   * not today's work until the one-off "Review imported" (phase 2) says the order is still live, because the imported invoices
   * are not linked to their orders yet (so "still to invoice" is not true). They sit in Today's grey "Imported, to review" fold,
   * never counted. A late payment on a v2 order is not one of them: it stays (on an imported order it waits in the fold, with its amount).
   */
  legacy?: boolean
}

/**
 * One live order, for the two order rules (O05). Read from v_order_state, so the states are the database's, not recomputed.
 * `invoicingState` is null for an engineer (the view hides it), and the invoicing rule never runs for one.
 */
export interface OrderFact {
  id: string
  number: number
  ownerId: string | null
  customerName: string
  orderedOn: string | null
  /** v_order_state.goods_state: n_a / to_source / to_place / on_order / late / received / partly_delivered / delivered. */
  goodsState: string
  /** v_order_state.commissioning_state: n_a / to_plan / planned / done. */
  commissioningState: string
  /** v_order_state.invoicing_state: not_invoiced / part / fully_invoiced; null when the caller is an engineer. */
  invoicingState: string | null
  /** Goods lines of the order that have no supplier leg yet (only counted when goodsState is to_source). */
  unsourced: number
  /** Gross still to invoice (order gross less invoiced gross) when the order is part-invoiced; otherwise null. Admin and sales only. */
  toInvoice: number | null
  /** The date of the latest invoice on a part-invoiced order, or null. */
  lastInvoicedOn: string | null
  /** The latest leg delivered_on, or the commissioning done date: the day the order became deliverable-complete. Null when unknown. */
  deliveredOn: string | null
  /**
   * Imported from the old CRM (orders.legacy_source is set). Owner decision 2026-10-22 (1b): its order and invoicing tasks are
   * not today's work until the one-off "Review imported" (phase 2) says the order is still live, because the imported invoices
   * are not linked to their orders yet (so "still to invoice" is not true). They sit in Today's grey "Imported, to review" fold,
   * never counted. A late payment on a v2 order is not one of them: it stays (on an imported order it waits in the fold, with its amount).
   */
  legacy?: boolean
}

export interface ReceivableFact {
  orderId: string
  orderNumber: number
  ownerId: string | null
  customerName: string
  balance: number
  /** What has been paid so far, for the reminder text. */
  settled: number
  dueOn: string | null
  isOverdue: boolean
  lastRemindedOn: string | null
  reminderCount: number
  /** The order was imported from the old CRM (owner decision 2026-10-22, 1): its late payment waits in the Imported fold, with its amount. v2 orders: false or absent. */
  legacy?: boolean
}

export interface MonthEndFact {
  /** First day of the month being closed, YYYY-MM-01. */
  month: string
  /** Sum of the month_end_status() counts. */
  checks: number
  /** closed_months has a row for it. */
  closed: boolean
}

/** M08: one paid order whose costs are not marked complete (v_order_money: payment_state settled, costs_state provisional). Admin only. */
export interface CostFact {
  orderId: string
  orderNumber: number
  /** v_order_money.expected_cost; null when it was never entered. */
  expectedCost: number | null
  actualCost: number
  /** v_order_money.payment_state */
  paymentState: string
  /** v_order_money.costs_state: complete or provisional */
  costsState: string
  /** The order is flagged value_basis_unknown: its margin is excluded, so it is not chased for costs. */
  basisUnknown: boolean
  /** The order was cancelled. */
  cancelled: boolean
  /** Imported from the old CRM (orders.legacy_source is set): a settled imported order is history and raises nothing. */
  legacy?: boolean
}

/** M08: one invoice, as v_invoice_state describes it. Admin and sales only. */
export interface InvoiceFact {
  id: string
  number: string | null
  orderId: string | null
  invoiceDate: string | null
  /** v_invoice_state.courier_state */
  courierState: string
  /** v_invoice_state.fbr_state */
  fbrState: string
  fbrException: boolean
  needsFbrAttention: boolean
}

/**
 * One live order the engineer is assigned to (order_engineers), for their own jobs on Today (owner decision 2026-10-19: an
 * engineer's Today shows the jobs assigned to them, not only the orders they own). Engineers only; never a money column.
 */
export interface JobFact {
  orderId: string
  orderNumber: number
  ownerId: string | null
  customerName: string
  siteName: string | null
  /** v_order_state.goods_state */
  goodsState: string
  /** v_order_state.commissioning_state: n_a / to_plan / planned / done */
  commissioningState: string
  /** orders.commissioning_planned_on */
  plannedOn: string | null
  /** The latest supplier delivery to site (supplier_orders.delivered_on), or null. */
  deliveredOn: string | null
  /** Imported from the old CRM (orders.legacy_source) or with estimated dates (v_order_state.data_trust): never an engineer's job item. */
  legacy?: boolean
  /** orders.visit_type (0101): the engineer's list says "Install · customer · site". A visit has a date and a type, no time of day. */
  visitType?: string | null
}

/**
 * P3-D, admin only: last month's GST to FBR. `month` is the first of the month the GST is for (the previous one), `invoices` how many
 * of its invoices carry GST (not imported), `undeposited` how many of those have no tax deposit recorded yet. Paid = none left.
 */
export interface GstFact {
  month: string
  invoices: number
  undeposited: number
  /** The pay-by and file-by dates of this month's GST, from Settings > Tax deadlines (0110). Absent: the starting 15th and 18th. */
  payBy?: string
  returnBy?: string
  /** Older months (before `month`) whose GST is still not deposited, oldest first. Each stays on To do until it is done. */
  earlier?: GstFact[]
}

/** P3-D, admin only: engineers' "I paid" claims waiting for approval (0087), and the day the oldest was made. */
export interface ClaimsFact {
  pending: number
  oldestOn: string | null
}

/** M08: one recurring expense template and whether this month's expense exists. Admin only. */
export interface RecurringFact {
  id: string
  label: string
  dayOfMonth: number | null
  active: boolean
  /** YYYY-MM, or null for "from the beginning". */
  startMonth: string | null
  /** The month its bill is for today (billPeriod: last month for a day 1 to 10 template, except rent). Absent means this month. */
  period?: string
  /** An expense with (recurring_id, period) already exists for `period`. */
  recorded: boolean
}

export interface SnoozeFact {
  rule: string
  subjectId: string
  untilOn: string
}

export interface TodayInputs {
  /** Today in the business timezone, YYYY-MM-DD. The only clock the rules read. */
  today: string
  user: { id: string; role: Role }
  /** users.role by id, to route a payment to the order owner (sales) or to admin (everyone else). */
  roleOf: (userId: string | null) => Role | null
  rfqs: readonly RfqFact[]
  clarifications: readonly ClarificationFact[]
  inquiries: readonly InquiryFact[]
  legs: readonly LegFact[]
  /** Live orders in the states the order rules read (needs planning, delivered and not invoiced). */
  orders: readonly OrderFact[]
  /** Admin and sales only; empty for an engineer (never requested). */
  receivables: readonly ReceivableFact[]
  /** Admin only; null otherwise. */
  monthEnd: MonthEndFact | null
  /** P3-D. Admin only: last month's GST to FBR. Absent or null for everyone else (never requested). */
  gst?: GstFact | null
  /** P3-D. Admin only: engineers' claims to approve. Absent or null for everyone else (never requested). */
  claims?: ClaimsFact | null
  /** M08. Admin only: paid orders whose costs are provisional. Absent or empty for everyone else (never requested). */
  costs?: readonly CostFact[]
  /** M08. Admin and sales only: the invoices the FBR and TCS rules read. Absent or empty for an engineer (never requested). */
  invoices?: readonly InvoiceFact[]
  /** M08. Admin only: recurring templates. Absent or empty for everyone else. */
  recurring?: readonly RecurringFact[]
  /** Engineers only: the live orders they are assigned to. Absent or empty for everyone else (never requested). */
  jobs?: readonly JobFact[]
  snoozes: readonly SnoozeFact[]
}

// ---------------------------------------------------------------- items

export type Tone = 'danger' | 'warning' | 'neutral'

export interface WaitingInfo {
  /** The day the item was chased (asked, reminded). */
  chasedOn: string
  /** The day it returns to the active list. */
  nextNudgeOn: string
}

export interface TodayItem {
  /** `${rule}:${subjectId}`: stable across reloads, so selection and snoozes follow the item. */
  key: string
  rule: RuleKey
  subjectId: string
  tab: TodayTab
  /** The row's first line: "Chase customer for clarifications". */
  title: string
  /** The Waiting row's first line: "Customer chased". Chase rules only. */
  waitingTitle?: string
  /** "RFQ-0177" or "ORD-0038". */
  ref: string
  /** Who it concerns: the customer, or the supplier for a supplier chase. */
  party: string
  /**
   * The day the rule fired: when the action became due (a chase's last ask plus its wait, a bid's date, an expected date).
   * The row is grouped, sorted and badged by it. The bid date is shown in the pane only. Null: no date (ready to move).
   */
  actionDueOn: string | null
  group: TodayGroup
  /** Right-hand words (src/lib/timeWords): "12 days overdue", "Due today", "Due in 3 days", "3 days old". */
  badge: { text: string; tone: Tone }
  isPriority: boolean
  rfqId?: string
  orderId?: string
  inquiryId?: string
  legId?: string
  /** Where "Open" goes. */
  href: string
  /** Escalation suggestion (never automatic). */
  escalation?: 'close_no_reply' | 'float_elsewhere'
  /** Present on Waiting items only. */
  waiting?: WaitingInfo
  /** A colleague made the last chase (O-3): who (users.id) and when (a timestamp or a date). The pane and the row say so. */
  collision?: { by: string; at: string }
  /** Number the list breaks ties with (RFQ or order number). */
  number: number
  /** About an order imported from the old CRM (OrderFact.legacy): listed in the "Imported, to review" fold, never counted. */
  imported?: boolean
  /** Money still owed, on a payment_overdue item only (the Imported fold header sums it). */
  amount?: number
  /** An engineer's job_commissioning item: the visit's type (0101) and where, for the day list's row (engineerDays.ts). */
  visit?: { type: string | null; customer: string; site: string | null }
}

export interface TodayView {
  /** Active items, already grouped and sorted. */
  now: TodayItem[]
  soon: TodayItem[]
  ready: TodayItem[]
  waiting: TodayItem[]
  /** All active items in list order (now, soon, ready). Never a stale item. */
  active: TodayItem[]
  /**
   * Older than 30 days (needsYou.ts, redesign phase 0): out of the active groups and never counted, but still listed for the
   * person, in a grey fold ("Older than 30 days"). A late payment is never stale.
   */
  stale: TodayItem[]
  /** Order tasks on imported orders (owner decision 2026-10-22, 1b): out of every group and every count, in a grey fold. */
  imported: TodayItem[]
}
