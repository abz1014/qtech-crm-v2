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
  | 'delivered_not_invoiced'
  | 'close_month'

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
  delivered_not_invoiced: 'delivered_not_invoiced',
  close_month: 'close_month',
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
  /** The latest leg delivered_on, or the commissioning done date: the day the order became deliverable-complete. Null when unknown. */
  deliveredOn: string | null
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
}

export interface MonthEndFact {
  /** First day of the month being closed, YYYY-MM-01. */
  month: string
  /** Sum of the month_end_status() counts. */
  checks: number
  /** closed_months has a row for it. */
  closed: boolean
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
  /** Right-hand chip: "12d late", "today", "3d", "3d old". */
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
}

export interface TodayView {
  /** Active items, already grouped and sorted. */
  now: TodayItem[]
  soon: TodayItem[]
  ready: TodayItem[]
  waiting: TodayItem[]
  /** All active items in list order (now, soon, ready). */
  active: TodayItem[]
}
