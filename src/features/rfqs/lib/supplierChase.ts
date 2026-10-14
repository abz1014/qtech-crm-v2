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

export interface ChaseItem {
  /** The item's number on the RFQ (1-based). */
  number: number
  description: string
  brandName?: string | null
  qty: number
  unit?: string | null
}

export interface SupplierChaseInput {
  rfqRef: string
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
  signature: { name: string; company: string; jobTitle?: string | null }
  variant: EnquiryVariant
}

export interface SupplierChase {
  variant: EnquiryVariant
  subject: string | null
  body: string
  /** YYYY-MM-DD, or null when no date could be set. */
  replyBy: string | null
}

/** The working day `n` days before `date`, stepping over Saturdays and Sundays. */
function workingDaysBefore(date: string, n: number): string {
  let d = date
  for (let i = 0; i < n; i++) {
    d = addDays(d, -1) as string
    while (isWeekend(d)) d = addDays(d, -1) as string
  }
  return d
}

function workingDaysAfter(date: string, n: number): string {
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
  const { variant, rfqRef, items, chaseCount } = input
  const replyBy = supplierReplyBy(input.dueOn, input.today)
  const by = replyBy ? longDay(replyBy) : null
  const sent = input.sentOn ? longDay(input.sentOn) : null
  const email = variant === 'email'
  const bold = (t: string) => (email ? t : `*${t}*`)
  const greeting = input.contactName
    ? email
      ? `Dear ${input.contactName},\nAssalam o Alaikum.`
      : `Assalam o Alaikum ${input.contactName},`
    : email
      ? 'Dear Sir or Madam,\nAssalam o Alaikum.'
      : 'Assalam o Alaikum,'

  const list = items.map(itemLine).join('\n')
  const thanks = input.pricedNumbers.length > 0 ? ` Thank you for pricing ${numbersText(input.pricedNumbers)}.` : ''
  const sentRef = sent ? `our enquiry of ${bold(sent)} (ref ${bold(rfqRef)})` : `our enquiry ${bold(rfqRef)}`
  const sentRefPlain = sent ? `our enquiry of ${sent} (our ref. ${rfqRef})` : `our enquiry ${rfqRef}`
  const pricedEmail = input.pricedNumbers.length > 0 ? ` Thank you for your quotation on ${numbersText(input.pricedNumbers)}.` : ''

  const lines: string[] = []
  if (!email) {
    lines.push(greeting, '')
    if (chaseCount === 0) {
      lines.push(`Following up on ${sentRef}.${thanks} We are still awaiting your price for:`)
    } else {
      lines.push(`A ${ordinal(chaseCount)} reminder on ${sentRef}. We have not yet received your price for:`)
    }
    lines.push(list, '')
    if (chaseCount === 0) {
      lines.push(
        by
          ? `Kindly send your price and lead time by ${bold(by)}. If you cannot offer an item, a short note will help us approach others.`
          : 'Kindly send your price and lead time. If you cannot offer an item, a short note will help us approach others.',
      )
    } else {
      lines.push(
        by
          ? `Could you please reply by ${bold(by)}? If these items are not available, kindly let us know today so that we can move on.`
          : 'Could you please reply? If these items are not available, kindly let us know today so that we can move on.',
      )
    }
    lines.push('', 'Thank you.', 'Regards,', input.signature.name, input.signature.company)
  } else {
    lines.push(greeting, '')
    if (chaseCount === 0) {
      lines.push(`We refer to ${sentRefPlain}.${pricedEmail} We have not yet received your price for the following items:`)
    } else {
      lines.push(`This is a ${ordinal(chaseCount)} reminder on ${sentRefPlain}. We have not yet received your price for:`)
    }
    lines.push(list, '')
    if (chaseCount === 0) {
      lines.push(
        by
          ? `Kindly send your price, availability and lead time by ${by}, ahead of our own submission date. If you are unable to offer an item, a short note to that effect would be appreciated so that we can approach other sources.`
          : 'Kindly send your price, availability and lead time. If you are unable to offer an item, a short note to that effect would be appreciated so that we can approach other sources.',
      )
      lines.push('', 'Thank you for your continued support.')
    } else {
      lines.push(
        by
          ? `Could you please reply by ${by}? If these items are not available, kindly let us know today so that we can move on.`
          : 'Could you please reply? If these items are not available, kindly let us know today so that we can move on.',
      )
      lines.push('', 'Thank you.')
    }
    lines.push('With best regards,', input.signature.name, input.signature.jobTitle ? `${input.signature.jobTitle}, ${input.signature.company}` : input.signature.company)
  }

  const n = items.length
  const subject = email
    ? by
      ? `${rfqRef}: price needed for ${n} ${n === 1 ? 'item' : 'items'} by ${by}`
      : `${rfqRef}: price needed for ${n} ${n === 1 ? 'item' : 'items'}`
    : null
  return { variant, subject, body: lines.join('\n'), replyBy }
}
