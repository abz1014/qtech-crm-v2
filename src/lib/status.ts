import {
  Ban,
  Circle,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleDot,
  Clock,
  Hourglass,
  Landmark,
  Layers,
  Wallet,
  type LucideIcon,
} from 'lucide-react'

/*
 * The status registry (U05): the ONE place where a dimension and a value from a
 * database view become a label, a tone and a glyph (DATA_MODEL section 5, plus
 * Amendment A6 and the fx / user additions). Colour is never decided here: the
 * chip reads --status-fg / --status-bg from the [data-status="dimension:value"]
 * map in docs/design/tokens.css. `tone` is only used to pick the glyph, and a
 * unit test (status.test.ts) fails if it disagrees with tokens.css, if a token
 * has no entry here, or if an entry has no token.
 *
 * Dimension and value keys are the data-status slugs (kebab-case). Views emit
 * snake_case ("floated_awaiting"); resolveStatus() normalises and applies the
 * aliases below, and THROWS on anything unknown, so a new view value cannot
 * silently render as an unstyled chip.
 */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'ink'

export interface StatusDef {
  label: string
  tone: Tone
  /** Dashed edge: the data is not firm (data trust, prospect). Must match --status-border-style in tokens.css. */
  dashed?: boolean
  /** Position on a three-step track (TCS and FBR): 0 to 3 steps filled. */
  step?: 0 | 1 | 2 | 3
  /** Overrides the glyph chosen from the tone. */
  icon?: LucideIcon
}

const def = (label: string, tone: Tone, extra: Partial<StatusDef> = {}): StatusDef => ({ label, tone, ...extra })

export const STATUS = {
  'rfq-outcome': { open: def('Open', 'info'), won: def('Won', 'success'), closed: def('Closed', 'neutral') },
  sourcing: {
    'not-floated': def('Not floated', 'warning'),
    awaiting: def('Awaiting offers', 'info'),
    'partly-covered': def('Partly covered', 'info'),
    covered: def('Covered', 'success'),
    'no-offer': def('No offer anywhere', 'danger'),
  },
  clarification: {
    none: def('No questions', 'neutral'),
    'to-ask': def('To ask', 'warning'),
    asked: def('Asked', 'info'),
    'waiting-customer': def('Waiting on customer', 'info'),
    'answers-to-relay': def('Answers to relay', 'warning'),
    answered: def('Answered', 'success'),
    withdrawn: def('Withdrawn', 'neutral'),
  },
  bid: {
    'to-bid': def('To bid', 'warning'),
    'bid-sent': def('Bid sent', 'success'),
    expired: def('Quotation expired', 'warning'),
  },
  deadline: { 'due-soon': def('Due soon', 'warning'), overdue: def('Overdue', 'danger') },
  inquiry: {
    shortlisted: def('Shortlisted', 'neutral'),
    sent: def('Sent', 'info'),
    chased: def('Chased', 'warning'),
    awaiting: def('Awaiting reply', 'info'),
    quoted: def('Quoted', 'success'),
    'no-offer': def('No offer', 'danger'),
  },
  'inquiry-blocked': {
    none: def('Not blocked', 'neutral'),
    'open-questions': def('Open questions', 'warning'),
    'answers-waiting': def('Answers waiting', 'warning'),
  },
  order: { active: def('Active', 'info'), cancelled: def('Cancelled', 'neutral'), done: def('Done', 'success') },
  goods: {
    na: def('n/a', 'neutral'),
    'to-source': def('To source', 'warning'),
    'to-place': def('To place', 'warning'),
    'on-order': def('On order', 'info'),
    late: def('Late', 'danger'),
    received: def('Received', 'info'),
    'partly-delivered': def('Partly delivered', 'info'),
    delivered: def('Delivered', 'success'),
  },
  commissioning: {
    na: def('n/a', 'neutral'),
    'to-plan': def('To plan', 'warning'),
    planned: def('Planned', 'info'),
    done: def('Done', 'success'),
  },
  invoicing: {
    'not-invoiced': def('Not invoiced', 'warning'),
    part: def('Part invoiced', 'info'),
    full: def('Fully invoiced', 'success'),
  },
  payment: {
    unpaid: def('Unpaid', 'neutral'),
    part: def('Part paid', 'info'),
    settled: def('Settled', 'success'),
    overdue: def('Overdue', 'danger'),
  },
  costs: { provisional: def('Provisional', 'warning'), complete: def('Complete', 'success') },
  trust: {
    ok: def('Firm', 'neutral'),
    'basis-unknown': def('Basis unknown', 'warning', { dashed: true, icon: CircleDashed }),
    estimated: def('Estimated dates', 'neutral', { dashed: true, icon: CircleDashed }),
  },
  tcs: {
    'not-started': def('Not started', 'neutral', { step: 0 }),
    'copy-received': def('Copy received', 'info', { step: 1 }),
    sent: def('Sent', 'info', { step: 2 }),
    delivered: def('Delivered', 'success', { step: 3 }),
  },
  fbr: {
    pending: def('Pending', 'warning', { step: 0 }),
    generated: def('Generated', 'info', { step: 1 }),
    receipt: def('Receipt received', 'info', { step: 2 }),
    deposited: def('Deposited', 'success', { step: 3 }),
  },
  reminder: { none: def('Not reminded', 'neutral'), reminded: def('Reminded', 'info') },
  'company-role': {
    customer: def('Customer', 'info'),
    supplier: def('Supplier', 'neutral'),
    both: def('Both', 'ink', { icon: Layers }),
    prospect: def('Prospect', 'neutral', { dashed: true, icon: CircleDashed }),
  },
  fx: { fresh: def('Fresh', 'success'), stale: def('Stale', 'warning'), unusable: def('Unusable', 'danger') },
  'fx-capture': { captured: def('Rate at the time', 'neutral'), none: def('No rate captured', 'neutral') },
  user: { active: def('Active', 'success'), deactivated: def('Deactivated', 'neutral', { icon: Ban }) },
  // Amendment A6: monthly bookkeeping.
  month: { open: def('Open', 'info'), closed: def('Closed', 'success') },
  aging: {
    '0-30': def('0 to 30 days', 'neutral'),
    '31-60': def('31 to 60 days', 'warning'),
    '61-90': def('61 to 90 days', 'warning'),
    '90-plus': def('Over 90 days', 'danger'),
    'advance-held': def('Advance held', 'info'),
  },
  bank: { unticked: def('Not on statement', 'warning'), ticked: def('On statement', 'success') },
  'paid-via': { bank: def('Bank', 'info', { icon: Landmark }), cash: def('Cash', 'neutral', { icon: Wallet }) },
  // What we owe (Month-end): the state of a supplier leg against what was paid (g2-month-end "leg:owed", "leg:settled", "leg:flag").
  payable: {
    owing: def('Owed', 'info', { icon: Hourglass }),
    settled: def('Settled (≈)', 'success', { icon: CircleCheck }),
    'paid-over': def('Paid over', 'warning', { icon: CircleAlert }),
    unpriced: def('No price yet', 'neutral'),
    'no-rate': def('No rate', 'neutral'),
  },
  'expense-group': {
    overhead: def('Overhead', 'neutral'),
    'order-cost': def('Order cost', 'neutral'),
    'not-in-pnl': def('Not in P&L', 'neutral'),
  },
  excluded: {
    'basis-unknown': def('Basis unknown', 'warning', { dashed: true, icon: CircleDashed }),
    'zero-value': def('Zero value', 'neutral'),
    unattributed: def('Unattributed', 'neutral'),
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

const TONE_ICON: Record<Tone, LucideIcon> = {
  neutral: Circle,
  info: CircleDot,
  success: CircleCheck,
  warning: Clock,
  danger: CircleAlert,
  ink: Layers,
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
