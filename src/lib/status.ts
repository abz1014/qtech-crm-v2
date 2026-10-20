import {
  Ban,
  CalendarClock,
  Circle,
  CircleAlert,
  CircleArrowRight,
  CircleCheck,
  CircleDashed,
  Clock,
  Hourglass,
  Landmark,
  Lock,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

/*
 * The status registry (U05, round 2 R2-01): the ONE place where a dimension and a value from a
 * database view become a label, a tone and a glyph (DATA_MODEL section 5, plus Amendment A6 and
 * the fx / user additions). Colour is never decided here: the chip reads --status-fg / --status-bg
 * from the [data-status="dimension:value"] map in docs/design/tokens.css. `tone` picks the glyph and
 * the StatusText colours, and a unit test (status.test.ts) fails if it disagrees with tokens.css, if a
 * token has no entry here, or if an entry has no token.
 *
 * Vocabulary (DESIGN_SYSTEM section 6): 34 visible labels; one label means one thing and has one tone
 * everywhere. The tone says who acts next: warning = we act (now), info = someone else acts (waiting),
 * success = finished (done), danger = past its date and still open (late), neutral = closed, not asked,
 * not needed (inert). The normal state never draws a chip: those keys carry `hidden: true`, StatusBadge
 * renders nothing for them, and their label is only used as text (StatusText, headings, filters).
 *
 * Dimension and value keys are the data-status slugs (kebab-case). Views emit snake_case
 * ("floated_awaiting"); resolveStatus() normalises and applies the aliases below, and THROWS on
 * anything unknown, so a new view value cannot silently render as an unstyled chip. The keys and the
 * view values never change; only the words and tones do.
 */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/** Who acts next, in words: the shared tone of every Next step (lists, board, Today). */
export type StepTone = 'late' | 'now' | 'waiting' | 'done' | 'inert'

export const TONE_OF_STEP = {
  late: 'danger',
  now: 'warning',
  waiting: 'info',
  done: 'success',
  inert: 'neutral',
} as const satisfies Record<StepTone, Tone>

export interface StatusDef {
  label: string
  tone: Tone
  /** Dashed edge: the data is not firm (data trust, prospect). Must match --status-border-style in tokens.css. */
  dashed?: boolean
  /** Overrides the glyph chosen from the tone (only CircleDashed, Ban, Lock and CalendarClock are allowed). */
  icon?: LucideIcon
  /** The normal state: never drawn as a chip (StatusBadge returns null); the label is text only. */
  hidden?: true
}

const def = (label: string, tone: Tone, extra: Partial<StatusDef> = {}): StatusDef => ({ label, tone, ...extra })
/** A normal-state key: no chip, the label is used only as text. */
const hid = (label: string, tone: Tone, extra: Partial<StatusDef> = {}): StatusDef => ({ label, tone, ...extra, hidden: true })

export const STATUS = {
  'rfq-outcome': { open: hid('Open', 'info'), won: def('Won', 'success'), closed: def('Closed', 'neutral') },
  // UI-only: the one stage of an RFQ (header chip, board and list Next step). Not a database value.
  'rfq-stage': {
    suppliers: def('Needs suppliers', 'warning'),
    prices: def('Waiting for prices', 'info'),
    ready: def('Ready to quote', 'warning'),
    sent: def('Quotation sent', 'info'),
    expired: def('Quotation expired', 'warning'),
  },
  sourcing: {
    'not-floated': def('Needs suppliers', 'warning'),
    awaiting: def('Waiting for prices', 'info'),
    'partly-covered': def('Waiting for prices', 'info'),
    covered: def('Ready to quote', 'warning'),
    'no-offer': def('Needs suppliers', 'warning'),
  },
  // Headings in the questions panel, never chips.
  clarification: {
    none: hid('No questions', 'neutral'),
    'to-ask': hid('To ask', 'warning'),
    asked: hid('Waiting on the customer', 'info'),
    'waiting-customer': hid('Waiting on the customer', 'info'),
    'answers-to-relay': hid('Answers to send', 'warning'),
    answered: hid('Answered', 'success'),
    withdrawn: hid('Withdrawn', 'neutral'),
  },
  bid: {
    'to-bid': hid('Ready to quote', 'warning'),
    'bid-sent': def('Quotation sent', 'info'),
    expired: def('Quotation expired', 'warning'),
  },
  // Due soon is always drawn with a time phrase from timeWords ("Due today", "Due in 2 days").
  deadline: { 'due-soon': def('Due soon', 'warning', { icon: CalendarClock }), overdue: def('Overdue', 'danger') },
  inquiry: {
    shortlisted: def('Not asked yet', 'neutral'),
    sent: def('Waiting for prices', 'info'),
    chased: def('Waiting for prices', 'info'),
    awaiting: def('Waiting for prices', 'info'),
    quoted: def('Priced', 'success'),
    'no-offer': def("Can't quote", 'neutral', { icon: Ban }),
  },
  // UI-only: an item's price state on the RFQ items panel. Not a database value.
  'item-price': {
    waiting: def('Waiting for prices', 'info'),
    priced: def('Priced', 'success'),
    none: def('No price yet', 'warning'),
  },
  'inquiry-blocked': {
    none: hid('Not blocked', 'neutral'),
    'open-questions': hid('Open questions', 'warning'),
    'answers-waiting': hid('Answers waiting', 'warning'),
  },
  order: { active: hid('Active', 'info'), cancelled: def('Cancelled', 'neutral', { icon: Ban }), done: def('Done', 'success') },
  goods: {
    na: hid('Not needed', 'neutral'),
    'to-source': def('To order', 'warning'),
    'to-place': def('To order', 'warning'),
    'on-order': def('On order', 'info'),
    late: def('Overdue', 'danger'),
    received: def('To deliver', 'warning'),
    'partly-delivered': def('To deliver', 'warning'),
    delivered: def('Delivered', 'success'),
  },
  commissioning: {
    na: hid('Not needed', 'neutral'),
    'to-plan': def('To plan', 'warning'),
    planned: def('Planned', 'info'),
    done: def('Done', 'success'),
  },
  invoicing: {
    'not-invoiced': def('To invoice', 'warning'),
    part: def('To invoice', 'warning'),
    full: def('Invoiced', 'success'),
  },
  payment: {
    unpaid: def('Awaiting payment', 'info'),
    part: def('Awaiting payment', 'info'),
    settled: def('Paid', 'success'),
    overdue: def('Overdue', 'danger'),
  },
  costs: { provisional: def('Not final', 'warning'), complete: hid('Complete', 'success') },
  trust: {
    ok: hid('Firm', 'neutral'),
    'basis-unknown': def('Is GST included?', 'warning', { dashed: true, icon: CircleDashed }),
    // Estimated dates are a dashed underline with an InfoTip in the order meta line, not a chip.
    estimated: hid('Estimated dates', 'neutral', { dashed: true, icon: CircleDashed }),
  },
  tcs: {
    'not-started': def('Not sent', 'warning'),
    'copy-received': def('Not sent', 'warning'),
    sent: def('Sent', 'info'),
    delivered: def('Delivered', 'success'),
  },
  fbr: {
    pending: def('To deposit', 'warning'),
    generated: def('To deposit', 'warning'),
    receipt: def('To deposit', 'warning'),
    deposited: def('Deposited', 'success'),
  },
  reminder: { none: hid('Not reminded', 'neutral'), reminded: hid('Reminded', 'info') },
  // Identity, not state: drawn as a Tag by RoleChip. The labels are the Tag words.
  'company-role': {
    customer: hid('Customer', 'info'),
    supplier: hid('Supplier', 'neutral'),
    both: hid('Customer & supplier', 'neutral'),
    prospect: hid('Prospect', 'neutral', { dashed: true, icon: CircleDashed }),
  },
  fx: { fresh: hid('Fresh', 'success'), stale: def('Old rate', 'warning'), unusable: def('No rate', 'warning') },
  'fx-capture': { captured: hid('Rate at the time', 'neutral'), none: def('No rate', 'warning') },
  user: { active: hid('Active', 'success'), deactivated: def('Deactivated', 'neutral', { icon: Ban }) },
  // Amendment A6: monthly bookkeeping. Only a closed month shows a chip.
  month: { open: hid('Open', 'info'), closed: def('Closed', 'neutral', { icon: Lock }) },
  // Report text from here down: no chips.
  aging: {
    '0-30': hid('0 to 30 days', 'neutral'),
    '31-60': hid('31 to 60 days', 'warning'),
    '61-90': hid('61 to 90 days', 'warning'),
    '90-plus': hid('Over 90 days', 'danger'),
    'advance-held': hid('Advance held', 'info'),
  },
  bank: { unticked: hid('Not on statement', 'warning'), ticked: hid('On statement', 'success') },
  'paid-via': { bank: hid('Bank', 'info', { icon: Landmark }), cash: hid('Cash', 'neutral', { icon: Wallet }) },
  // What we owe (Month-end): the state of a supplier leg against what was paid.
  payable: {
    owing: hid('Owed', 'info', { icon: Hourglass }),
    settled: hid('Settled (≈)', 'success'),
    'paid-over': hid('Paid over', 'warning'),
    unpriced: hid('No price yet', 'neutral'),
    'no-rate': hid('No rate', 'neutral'),
  },
  'expense-group': {
    overhead: hid('Overhead', 'neutral'),
    'order-cost': hid('Order cost', 'neutral'),
    'not-in-pnl': hid('Not in P&L', 'neutral'),
  },
  excluded: {
    'basis-unknown': def('Is GST included?', 'warning', { dashed: true, icon: CircleDashed }),
    'zero-value': hid('Zero value', 'neutral'),
    unattributed: hid('Unattributed', 'neutral'),
  },
} as const satisfies Record<string, Record<string, StatusDef>>

export type StatusDimension = keyof typeof STATUS
export type StatusValue<D extends StatusDimension = StatusDimension> = Extract<keyof (typeof STATUS)[D], string>
/** "goods:late": exactly the data-status attribute value. */
export type StatusKey = { [D in StatusDimension]: `${D}:${StatusValue<D>}` }[StatusDimension]

/**
 * View values that differ from the slug after snake_case to kebab-case.
 * Keyed by dimension, then by the normalised view value.
 */
const ALIASES: Partial<Record<StatusDimension, Record<string, string>>> = {
  sourcing: { 'floated-awaiting': 'awaiting', 'no-offer-anywhere': 'no-offer' },
  clarification: { 'waiting-on-customer': 'waiting-customer' },
  bid: { 'quotation-expired': 'expired' },
  invoicing: { 'fully-invoiced': 'full' },
  goods: { 'n-a': 'na' },
  commissioning: { 'n-a': 'na' },
  trust: { 'dates-estimated': 'estimated', 'estimated-dates': 'estimated', 'value-basis-unknown': 'basis-unknown' },
  excluded: { 'value-basis-unknown': 'basis-unknown' },
  tcs: { 'delivered-to-client': 'delivered' },
  fbr: { 'receipt-received': 'receipt' },
  reminder: { 'not-reminded': 'none' },
  'expense-group': { 'non-pnl': 'not-in-pnl' },
}

export class UnknownStatusError extends Error {
  constructor(
    public readonly dimension: string,
    public readonly value: string,
  ) {
    super(`Unknown status "${value}" in dimension "${dimension}". Add it to src/lib/status.ts and to the status map in docs/design/tokens.css.`)
    this.name = 'UnknownStatusError'
  }
}

export interface ResolvedStatus extends StatusDef {
  dimension: StatusDimension
  value: string
  /** The data-status attribute value. */
  key: StatusKey
  icon: LucideIcon
}

/** The glyph of each tone (DESIGN_SYSTEM section 6): warning says "you act", info says "waiting on someone". */
export const TONE_ICON: Record<Tone, LucideIcon> = {
  neutral: Circle,
  info: Clock,
  success: CircleCheck,
  warning: CircleArrowRight,
  danger: CircleAlert,
}

const normalise = (raw: string) => raw.trim().toLowerCase().replace(/[\s_]+/g, '-')

/** Look up a view output. Throws UnknownStatusError for an unknown dimension or value. */
export function resolveStatus(dimension: string, raw: string): ResolvedStatus {
  const table = (STATUS as Record<string, Record<string, StatusDef>>)[dimension]
  if (!table) throw new UnknownStatusError(dimension, raw)
  const n = normalise(raw)
  const value = ALIASES[dimension as StatusDimension]?.[n] ?? n
  const found = Object.prototype.hasOwnProperty.call(table, value) ? table[value] : undefined
  if (!found) throw new UnknownStatusError(dimension, raw)
  return {
    ...found,
    dimension: dimension as StatusDimension,
    value,
    key: `${dimension}:${value}` as StatusKey,
    icon: found.icon ?? TONE_ICON[found.tone],
  }
}

/** The deadline dimension is derived from the view's days_to_due and is_overdue: null means no chip. */
export function deadlineValue(daysToDue: number | null | undefined, isOverdue: boolean, dueSoonDays = 2): 'overdue' | 'due-soon' | null {
  if (isOverdue) return 'overdue'
  if (daysToDue !== null && daysToDue !== undefined && daysToDue <= dueSoonDays) return 'due-soon'
  return null
}

/** Aging bucket from days since invoice date (DATA_MODEL A6.3): 0-30, 31-60, 61-90, 90+. */
export function agingBucket(daysSinceInvoice: number): 'aging:0-30' | 'aging:31-60' | 'aging:61-90' | 'aging:90-plus' {
  if (daysSinceInvoice <= 30) return 'aging:0-30'
  if (daysSinceInvoice <= 60) return 'aging:31-60'
  if (daysSinceInvoice <= 90) return 'aging:61-90'
  return 'aging:90-plus'
}

export const STATUS_ENTRIES: ReadonlyArray<[StatusDimension, string, StatusDef]> = Object.entries(STATUS).flatMap(
  ([d, values]) => Object.entries(values).map(([v, s]) => [d as StatusDimension, v, s as StatusDef] as [StatusDimension, string, StatusDef]),
)
