// R04: enquiry-draft generator for the intake float screen. Pure and framework-free.
//
// One text goes to every ticked supplier, so it names no supplier, no customer and no price of ours. Wording is the
// owner's own format (DECISIONS 2026-10-28): plain greeting, numbered items, a bullet list of what to include, the
// data-sheet and pictures request, "Regards," and the sender. WhatsApp and email carry the same body; email adds a subject.
//
// Rules:
//  - Each item lists description, qty and unit. An item that carries a spec gets an indented `Spec:` line; with no
//    spec the line is left out. The generator never writes anything into Spec that the item did not carry.
//  - No religious greeting and no RFQ number anywhere in the text or the subject (the app's own records still link the RFQ).
//  - The text never states a reply-by date. computeReplyBy stays for the screens that show one.
//  - Brand is shown only if the item has one and its description does not already say it.

import { addDays, isWeekend, parseDay, weekdayOf } from './dateText'

// ------------------------------------------------------------------------------------------------ types

export type EnquiryVariant = 'whatsapp' | 'email'

export interface EnquiryItem {
  /** rfq_items.description, as written. */
  description: string
  /** Optional brand name; added in front only when the description does not already contain it. */
  brandName?: string | null
  qty: number
  unit?: string | null
  /** Spec text the item really carries. There is no spec column today; when R05 adds one it flows through here. */
  spec?: string | null
}

export interface EnquirySignature {
  /** The signed-in salesperson, e.g. "Ayesha Rana". */
  name: string
  /** e.g. "Q-Tech Solutions". */
  company: string
  /** e.g. "Sales" (users.job_title). Email only. */
  jobTitle?: string | null
  /** Email only. */
  phone?: string | null
  /** Email only. */
  email?: string | null
}

export interface EnquiryInput {
  /** Not written into the supplier text (DECISIONS 2026-10-28). Kept optional so callers need not change. */
  rfqRef?: string
  items: readonly EnquiryItem[]
  /** rfqs.due_on (YYYY-MM-DD) or null. */
  dueOn?: string | null
  /** Today in the business timezone (YYYY-MM-DD). Passed in so the function stays pure. */
  today: string
  signature: EnquirySignature
  variant: EnquiryVariant
}

export interface ReplyBy {
  /** YYYY-MM-DD, or null when there is no (valid) due date. */
  date: string | null
  /** Which rule produced the date. */
  rule: 'due_minus_3' | 'weekend_to_friday' | 'not_before_tomorrow' | 'no_due_date'
  /** True when the date falls after the bid due date (due date is today, past, or nearer than tomorrow). */
  afterDue: boolean
}

export interface EnquiryDraft {
  variant: EnquiryVariant
  /** Email only; null for WhatsApp. */
  subject: string | null
  body: string
  replyBy: ReplyBy
}

// ------------------------------------------------------------------------------------------------ reply-by

export const REPLY_BY_LEAD_DAYS = 3

/**
 * Reply-by rule (BUILD_PLAN R04: "due - 3 days, never earlier than tomorrow"). The plan is silent on weekends, so:
 *  1. candidate = due - 3 calendar days.
 *  2. A Saturday or Sunday candidate moves BACK to the Friday before (a deadline moves earlier, never later).
 *  3. The date is never earlier than tomorrow. If tomorrow is a weekend it moves forward to Monday, because a
 *     reply is not expected over the weekend. If that lands after the bid due date, `afterDue` is true so the
 *     screen can warn; the date is still given.
 *  No due date (or an unreadable one): no reply-by date.
 */
export function computeReplyBy(dueOn: string | null | undefined, today: string): ReplyBy {
  const due = parseDay(dueOn) ? (dueOn as string).slice(0, 10) : null
  if (!due) return { date: null, rule: 'no_due_date', afterDue: false }

  let tomorrow = addDays(today, 1)
  if (!tomorrow) throw new RangeError(`today is not a date: ${today}`)
  while (isWeekend(tomorrow)) tomorrow = addDays(tomorrow, 1) as string

  let date = addDays(due, -REPLY_BY_LEAD_DAYS) as string
  let rule: ReplyBy['rule'] = 'due_minus_3'
  if (isWeekend(date)) {
    date = addDays(date, weekdayOf(date) === 6 ? -1 : -2) as string
    rule = 'weekend_to_friday'
  }
  if (date < tomorrow) {
    date = tomorrow
    rule = 'not_before_tomorrow'
  }
  return { date, rule, afterDue: date > due }
}

// ------------------------------------------------------------------------------------------------ text pieces

const NOS_UNITS = new Set(['', 'no', 'nos', 'pc', 'pcs', 'piece', 'pieces', 'each', 'ea', 'unit', 'units'])

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** "2 nos", "1 no", "150 m". Null when the quantity is unusable (never guessed). */
export function qtyText(qty: number, unit?: string | null): string | null {
  if (!Number.isFinite(qty) || qty <= 0) return null
  const n = qty.toLocaleString('en-US', { maximumFractionDigits: 3 })
  const u = oneLine(unit ?? '')
  if (NOS_UNITS.has(u.toLowerCase())) return `${n} ${qty === 1 ? 'no' : 'nos'}`
  return `${n} ${u}`
}

function itemTitle(item: EnquiryItem): string {
  let d = oneLine(item.description).replace(/[\s,;.]+$/, '')
  const brand = oneLine(item.brandName ?? '')
  if (brand && !d.toLowerCase().includes(brand.toLowerCase())) d = `${brand} ${d}`
  return d
}

function specText(spec: string | null | undefined): string | null {
  const lines = (spec ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.length > 0 ? lines.join('\n   ') : null
}

function itemLines(items: readonly EnquiryItem[]): string[] {
  return items.flatMap((it, i) => {
    const q = qtyText(it.qty, it.unit)
    const spec = specText(it.spec)
    return [`${i + 1}. ${itemTitle(it)}${q ? `, ${q}` : ''}`, ...(spec ? [`   Spec: ${spec}`] : [])]
  })
}

const ASKS = [
  'Unit price and currency',
  'Lead time',
  'Origin and authenticity (country of origin; original and genuine)',
  'Stock position',
  'MOQ, offer validity and payment terms',
  'Please attach the data sheet and share pictures of the quoted items (these 2 requirements are very important)',
]

/** "Request for quotation: <first item>" plus "and N more"; no RFQ number. */
export function enquirySubject(items: readonly EnquiryItem[]): string {
  const first = itemTitle(items[0])
  const short = first.length > 60 ? `${first.slice(0, 59).trimEnd()}…` : first
  return `Request for quotation: ${short}${items.length > 1 ? ` and ${items.length - 1} more` : ''}`
}

// ------------------------------------------------------------------------------------------------ main

export function generateEnquiryDraft(input: EnquiryInput): EnquiryDraft {
  const { items, signature, variant } = input
  if (items.length === 0) throw new RangeError('An enquiry needs at least one item')

  const replyBy = computeReplyBy(input.dueOn, input.today)
  const body = [
    'Hi hope you are doing well,',
    '',
    'Please quote your best price, availability and lead time for the following :',
    '',
    ...itemLines(items),
    '',
    'Please include in your reply:',
    ...ASKS.map((a) => `* ${a}`),
    '',
    'Kindly reply at your earliest convenience. If you cannot offer an item, please say so and we will look elsewhere.',
    '',
    'Thank you.',
    'Regards,',
    signature.name,
    signature.company,
  ].join('\n')

  return { variant, subject: variant === 'email' ? enquirySubject(items) : null, body, replyBy }
}
