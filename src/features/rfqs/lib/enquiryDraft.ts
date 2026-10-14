// R04: enquiry-draft generator for the intake float screen. Pure and framework-free.
//
// One text goes to every ticked supplier ("One text for all three. Each supplier skips what they cannot offer."),
// so the text names no supplier, no customer and no price of ours. Wording follows the approved mockup
// (g2-intake-float.html frame 5) and the chase texts (g2-chase-texts.html): WhatsApp is short, with *bold* markers;
// email adds a subject, a greeting and the sender's contact line.
//
// Rules:
//  - Each item lists description, qty, unit and a `Spec:` line. Spec is the item's own spec text, verbatim, or
//    "left blank". The generator never writes anything into Spec that the item did not carry.
//  - The text asks for: unit price and currency; lead time; origin and authenticity; stock; MOQ, offer validity
//    and payment terms.
//  - Reply-by = bid due date minus 3 days, with two guards (see computeReplyBy). No due date: no date is stated.
//  - Brand is shown only if the item has one and its description does not already say it. A missing brand is simply
//    not mentioned.

import { addDays, isWeekend, longDay, parseDay, weekdayOf } from './dateText'

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
  /** The RFQ number as shown to people, e.g. "RFQ-0185". */
  rfqRef: string
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

function specText(spec: string | null | undefined): string {
  const lines = (spec ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  return lines.length > 0 ? lines.join('\n   ') : 'left blank'
}

function itemLines(items: readonly EnquiryItem[]): string[] {
  return items.flatMap((it, i) => {
    const q = qtyText(it.qty, it.unit)
    return [`${i + 1}. ${itemTitle(it)}${q ? `, ${q}` : ''}`, `   Spec: ${specText(it.spec)}`]
  })
}

const ASKS = [
  'Unit price and currency',
  'Lead time',
  'Origin and authenticity (country of origin; original and genuine)',
  'Stock position',
  'MOQ, offer validity and payment terms',
]

const b = (variant: EnquiryVariant, s: string) => (variant === 'whatsapp' ? `*${s}*` : s)

function signatureLines(sig: EnquirySignature, variant: EnquiryVariant): string[] {
  if (variant === 'whatsapp') return ['Regards,', sig.name, sig.company]
  const role = sig.jobTitle?.trim()
  const lines = ['With best regards,', sig.name, role ? `${role}, ${sig.company}` : sig.company]
  if (sig.phone?.trim()) lines.push(sig.phone.trim())
  if (sig.email?.trim()) lines.push(sig.email.trim())
  return lines
}

// ------------------------------------------------------------------------------------------------ main

export function generateEnquiryDraft(input: EnquiryInput): EnquiryDraft {
  const { rfqRef, items, signature, variant } = input
  if (items.length === 0) throw new RangeError('An enquiry needs at least one item')

  const replyBy = computeReplyBy(input.dueOn, input.today)
  const by = replyBy.date ? longDay(replyBy.date) : null
  const out: string[] = []

  if (variant === 'whatsapp') {
    out.push('Assalam o Alaikum,')
    out.push(`Please quote your best price, availability and lead time for the following (our ref ${b(variant, rfqRef)}):`)
  } else {
    out.push('Dear Sir / Madam,', 'Assalam o Alaikum.', '')
    out.push(
      `We are preparing a quotation and would appreciate your best offer for the ${items.length === 1 ? 'item' : 'items'} below (our ref. ${rfqRef}):`,
    )
  }
  out.push(...itemLines(items))
  out.push('Please include in your reply:', ...ASKS.map((a) => `- ${a}`))

  const closing = by
    ? `Kindly reply by ${b(variant, by)}. If you cannot offer an item, please say so and we will look elsewhere.`
    : 'Kindly reply at your earliest convenience. If you cannot offer an item, please say so and we will look elsewhere.'
  out.push(closing)
  if (variant === 'whatsapp') out.push('Thank you.')
  else out.push('Thank you for your continued support.')
  out.push(...signatureLines(signature, variant))

  // Email gets a blank line between paragraphs; WhatsApp stays compact like the mockup.
  const body = variant === 'whatsapp' ? out.join('\n') : paragraphs(out)

  const subject =
    variant === 'email'
      ? `${rfqRef}: quotation requested for ${items.length} ${items.length === 1 ? 'item' : 'items'}${by ? `, reply by ${by}` : ''}`
      : null

  return { variant, subject, body, replyBy }
}

/** Email layout: blank lines before the asks, the closing and the sign-off; item lines stay together. */
function paragraphs(lines: string[]): string {
  const breakBefore = (l: string) =>
    l === 'Please include in your reply:' ||
    l.startsWith('Kindly reply') ||
    l === 'Thank you for your continued support.' ||
    l === 'With best regards,' ||
    l.startsWith('1. ')
  const res: string[] = []
  for (const l of lines) {
    if (breakBefore(l) && res.length > 0 && res[res.length - 1] !== '') res.push('')
    res.push(l)
  }
  return res.join('\n')
}
