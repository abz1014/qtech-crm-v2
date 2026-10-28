// R07: the supplier chase text, in the approved wording (docs/design/mockups/g2-chase-texts.html, "Supplier chase" and
// "Supplier: second chase"). Pure and framework-free.
//
// Rules from the mockup:
//  - Lists only the items this supplier has not priced and has not declined. Items already priced are thanked, not listed.
//  - Never names the customer, a budget or our price.
//  - Reply-by defaults to two working days before our bid; with no bid date, three working days from today. Never earlier than tomorrow.
//  - The first chase asks for price and lead time and invites a short "cannot offer". From the second chase it asks for a
//    "cannot offer" today if that is the answer.
//  - WhatsApp is short, with *bold* markers; email adds a subject and repeats the item lines.

import { addDays, isWeekend, longDay } from './dateText'
import { qtyText, type EnquiryVariant } from './enquiryDraft'
import { isFirm } from './chaseCommon'

export interface ChaseItem {
  /** The item's number on the RFQ (1-based). */
  number: number
  description: string
  brandName?: string | null
  qty: number
  unit?: string | null
}

export interface SupplierChaseInput {
  /** Not written into the supplier text (DECISIONS 2026-10-28). Kept optional so callers need not change. */
  rfqRef?: string
  /** supplier_inquiries.sent_on, YYYY-MM-DD. */
  sentOn: string | null
  /** rfqs.due_on, or null. */
  dueOn: string | null
  /** Today in the business timezone. */
  today: string
  /** Chases already stamped for this inquiry (0 means this is the first). */
  chaseCount: number
  /** The supplier contact's name, as stored. Null: a plain greeting. */
  contactName: string | null
  /** Numbers of items this supplier has already priced. */
  pricedNumbers: readonly number[]
  /** The items still without a price or a "cannot offer". */
  items: readonly ChaseItem[]
  signature: { name: string; company: string; jobTitle?: string | null; phone?: string | null }
  variant: EnquiryVariant
  /** Calendar days since the enquiry went out. More than 30 (FIRM_AFTER_DAYS) switches to the firmer wording. Omitted: never firm. */
  ageDays?: number | null
  /** A reply-by date the person chose (YYYY-MM-DD). Omitted: two working days before the bid. */
  replyByOverride?: string | null
}

export interface SupplierChase {
  variant: EnquiryVariant
  subject: string | null
  body: string
  /** YYYY-MM-DD, or null when no date could be set. */
  replyBy: string | null
}

/** The working day `n` days before `date`, stepping over Saturdays and Sundays. */
export function workingDaysBefore(date: string, n: number): string {
  let d = date
  for (let i = 0; i < n; i++) {
    d = addDays(d, -1) as string
    while (isWeekend(d)) d = addDays(d, -1) as string
  }
  return d
}

export function workingDaysAfter(date: string, n: number): string {
  let d = date
  for (let i = 0; i < n; i++) {
    d = addDays(d, 1) as string
    while (isWeekend(d)) d = addDays(d, 1) as string
  }
  return d
}

/** Two working days before our bid; three working days from today when there is none. Never earlier than the next working day. */
export function supplierReplyBy(dueOn: string | null | undefined, today: string): string | null {
  const tomorrow = workingDaysAfter(today, 1)
  if (!dueOn || !/^\d{4}-\d{2}-\d{2}/.test(dueOn)) return workingDaysAfter(today, 3)
  const date = workingDaysBefore(dueOn.slice(0, 10), 2)
  return date < tomorrow ? tomorrow : date
}

function numbersText(nums: readonly number[]): string {
  const n = [...nums].sort((a, b) => a - b)
  if (n.length === 1) return `item ${n[0]}`
  if (n.length === 2) return `items ${n[0]} and ${n[1]}`
  return `items ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim().replace(/[\s,;.]+$/, '')
}

function itemLine(i: ChaseItem): string {
  let d = oneLine(i.description)
  const brand = oneLine(i.brandName ?? '')
  if (brand && !d.toLowerCase().includes(brand.toLowerCase())) d = `${brand} ${d}`
  const q = qtyText(i.qty, i.unit)
  return `${i.number}. ${d}${q ? `, ${q}` : ''}`
}

const ordinal = (n: number) => (n === 1 ? 'second' : n === 2 ? 'third' : 'further')

export function generateSupplierChase(input: SupplierChaseInput): SupplierChase {
  const { variant, items, chaseCount } = input
  const replyBy = input.replyByOverride && /^\d{4}-\d{2}-\d{2}$/.test(input.replyByOverride) ? input.replyByOverride : supplierReplyBy(input.dueOn, input.today)
  const by = replyBy ? longDay(replyBy) : null
  const sent = input.sentOn ? longDay(input.sentOn) : null
  const email = variant === 'email'
  const firm = isFirm(input.ageDays)
  const bold = (t: string) => (email ? t : `*${t}*`)
  // Owner format (DECISIONS 2026-10-28): plain greeting, no religious greeting, no RFQ number.
  const greeting = input.contactName ? `Hi ${input.contactName}, hope you are doing well,` : 'Hi hope you are doing well,'

  const list = items.map(itemLine).join('\n')
  const thanks = input.pricedNumbers.length > 0 ? ` Thank you for pricing ${numbersText(input.pricedNumbers)}.` : ''
  const enquiry = sent ? `our enquiry of ${bold(sent)}` : 'our enquiry'
  const reminder = 'Please attach the data sheet and share pictures of the quoted items (these 2 requirements are very important).'

  const lines: string[] = [greeting, '']
  if (firm) {
    lines.push(`It is now over a month since ${enquiry}, and we have still not received your price for:`)
  } else if (chaseCount === 0) {
    lines.push(`Following up on ${enquiry}.${thanks} We are still awaiting your price for:`)
  } else {
    lines.push(`A ${ordinal(chaseCount)} reminder on ${enquiry}. We have not yet received your price for:`)
  }
  lines.push(list, '')
  if (firm) {
    lines.push(
      by
        ? `Please send your price, availability and lead time by ${bold(by)}, or tell us today that you cannot offer these items. Without a reply we will take it that you cannot offer them and move on.`
        : 'Please send your price, availability and lead time, or tell us today that you cannot offer these items. Without a reply we will take it that you cannot offer them and move on.',
    )
  } else if (chaseCount === 0) {
    lines.push(
      by
        ? `Kindly send your price, availability and lead time by ${bold(by)}. If you cannot offer an item, a short note will help us approach others.`
        : 'Kindly send your price, availability and lead time. If you cannot offer an item, a short note will help us approach others.',
    )
  } else {
    lines.push(
      by
        ? `Could you please reply by ${bold(by)}? If these items are not available, kindly let us know today so that we can move on.`
        : 'Could you please reply? If these items are not available, kindly let us know today so that we can move on.',
    )
  }
  lines.push(reminder, '', 'Thank you.', 'Regards,', input.signature.name, input.signature.company)

  const n = items.length
  const subject = email ? `Request for quotation: reminder for ${n} ${n === 1 ? 'item' : 'items'}` : null
  return { variant, subject, body: lines.join('\n'), replyBy }
}
