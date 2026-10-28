// The customer clarification chase, in the approved wording (docs/design/mockups/g2-chase-texts.html: "Customer
// clarification chase", "Customer: bid is close", "Customer: third ask"). Pure and framework-free.
//
// Rules from the mockup:
//  - One message carries every open question, numbered, so the customer can answer by number. The questions are the ones
//    captured; the generator never invents a question, an answer or a spec.
//  - Always asks the customer to "kindly confirm by" a date: one working day before the bid is due, three working days
//    from today with no bid date, and never earlier than today ("5:00 pm today").
//  - The first message after the first ask is a "gentle reminder", never "overdue". The third ask offers a way out and sets
//    a last date. A bid due within three working days names the bid date. More than 30 days since the first ask is firmer.

import { addBusinessDays, businessDaysBetween, daysBetween, longDay, subtractBusinessDays } from './dateText'
import { boldFor, byDayText, greetingFor, isFirm, oneLine, signOff, timeText, twoDaysText, type ChaseSignature, type ChaseText } from './chaseCommon'
import type { EnquiryVariant } from './enquiryDraft'

export interface CustomerChaseInput {
  rfqRef: string
  /** The customer's own RFQ number, as stored. Null: the text names our reference instead. */
  customerRef: string | null
  contactName: string | null
  /** Every open question that has been asked and not answered, in the order they were captured. */
  questions: readonly string[]
  /** Asks already stamped (ask_count of the open questions, the highest). 0 means this is the first ask. */
  askCount: number
  /** Date of the first ask and of the latest one (YYYY-MM-DD), or null. */
  firstAskedOn: string | null
  lastAskedOn: string | null
  /** rfqs.due_on, or null. */
  dueOn: string | null
  /** rfqs.due_time ("17:00:00"), named in the "bid is close" text when known. */
  dueTime?: string | null
  /** The item each question is about (clarifications.rfq_item_id), aligned with `questions`; null for a question about nothing in particular. */
  itemTags?: ReadonlyArray<{ number: number; label?: string | null } | null>
  /** Today in the business timezone. */
  today: string
  signature: ChaseSignature
  variant: EnquiryVariant
  /** A date the person chose to be answered by (YYYY-MM-DD). Omitted: the default, one working day before the bid. */
  confirmByOverride?: string | null
}

export type CustomerChaseKind = 'first' | 'gentle' | 'bid_close' | 'third' | 'firm'

export interface CustomerChase extends ChaseText {
  kind: CustomerChaseKind
  /** YYYY-MM-DD the customer is asked to answer by. */
  confirmBy: string
}

/** The date to ask the customer to answer by. Never before today. */
export function customerConfirmBy(dueOn: string | null | undefined, today: string): string {
  if (!dueOn || !/^\d{4}-\d{2}-\d{2}/.test(dueOn)) return addBusinessDays(today, 3)
  const d = subtractBusinessDays(dueOn.slice(0, 10), 1)
  return d < today ? today : d
}

/** True when the bid is due within three working days (today counts), so the wait shortens and the text names the bid date. */
export function isBidClose(dueOn: string | null | undefined, today: string): boolean {
  if (!dueOn || !/^\d{4}-\d{2}-\d{2}/.test(dueOn)) return false
  const d = dueOn.slice(0, 10)
  return d >= today && businessDaysBetween(today, d) <= 3
}

function whenText(due: string, today: string, time?: string | null): string {
  const days = daysBetween(today, due)
  const at = timeText(time)
  if (days === 0) return at ? `today, ${at}` : 'today'
  if (days === 1) return `tomorrow, ${longDay(due)}${at ? `, ${at}` : ''}`
  return `${longDay(due)}${at ? `, ${at}` : ''}`
}

export function generateCustomerChase(input: CustomerChaseInput): CustomerChase {
  const { variant, rfqRef, today, questions, askCount } = input
  const email = variant === 'email'
  const bold = boldFor(variant)
  const confirmBy = input.confirmByOverride && /^\d{4}-\d{2}-\d{2}$/.test(input.confirmByOverride) ? input.confirmByOverride : customerConfirmBy(input.dueOn, today)
  const by = byDayText(confirmBy, today)
  const refText = input.customerRef?.replace(/^\s*(?:RFQ\s*)?#?\s*/i, '').trim()
  const ref = refText ? `#${refText}` : null
  const yourRfq = ref ? `your RFQ ${bold(ref)}` : `your enquiry (our ref ${bold(rfqRef)})`
  const yourRfqPlain = ref ? `your RFQ ${ref}` : `your enquiry (our ref ${rfqRef})`
  const dueLong = input.dueOn ? longDay(input.dueOn.slice(0, 10)) : null
  const sinceFirst = input.firstAskedOn ? daysBetween(input.firstAskedOn, today) : null
  const asked = input.firstAskedOn ? longDay(input.firstAskedOn) : null
  const priorDates = input.firstAskedOn && input.lastAskedOn ? ` from our messages of ${twoDaysText(input.firstAskedOn, input.lastAskedOn)}` : ''

  let kind: CustomerChaseKind
  if (askCount >= 1 && isFirm(sinceFirst)) kind = 'firm'
  else if (askCount >= 2) kind = 'third'
  else if (askCount >= 1 && isBidClose(input.dueOn, today)) kind = 'bid_close'
  else if (askCount >= 1) kind = 'gentle'
  else kind = 'first'

  const tag = (i: number): string => {
    const t = input.itemTags?.[i]
    if (!t) return ''
    return email && t.label ? ` (item ${t.number}, ${oneLine(t.label)})` : ` (item ${t.number})`
  }
  const list = questions.map((q, i) => `${i + 1}. ${oneLine(q)}${tag(i)}`).join('\n')
  const lines: string[] = [greetingFor(variant, input.contactName), '']

  if (!email) {
    switch (kind) {
      case 'first':
        lines.push(`To complete our quotation for ${yourRfq} we need your confirmation on:`)
        break
      case 'gentle':
        lines.push(`A gentle reminder about ${yourRfq}. To complete our quotation we still need your confirmation on:`)
        break
      case 'bid_close':
        lines.push(`Our quotation for ${yourRfq} is due ${bold(input.dueOn ? whenText(input.dueOn.slice(0, 10), today, input.dueTime) : 'soon')}. To include these items we still need:`)
        break
      case 'third':
        lines.push(`We are writing once more about ${yourRfq}. The points below are still open${priorDates}:`)
        break
      case 'firm':
        lines.push(`It is now over a month since we first asked about ${yourRfq}, and the points below are still open:`)
        break
    }
    lines.push(list, '')
    if (kind === 'third') {
      lines.push(`If these items are no longer required, please let us know and we will close the enquiry. Otherwise, kindly confirm by ${bold(by)}.`)
    } else if (kind === 'firm') {
      lines.push(`Without your reply by ${bold(by)} we will close the enquiry. If it is still live, please confirm the points above.`)
    } else if (kind === 'first' || kind === 'gentle') {
      lines.push(`Kindly confirm by ${bold(by)}${dueLong ? `; our quotation is due on ${dueLong}` : ''}.`)
    } else {
      lines.push(`Kindly confirm by ${bold(by)}.`)
    }
    lines.push('', 'Thank you.', ...signOff(variant, input.signature))
  } else {
    switch (kind) {
      case 'first':
        lines.push(`Thank you for ${yourRfqPlain}. We are preparing our quotation and need your confirmation on the following points:`)
        break
      case 'gentle':
        lines.push(
          `Thank you for ${yourRfqPlain}. We are preparing our quotation and, further to our message of ${asked ?? 'earlier'}, still need your confirmation on the following points:`,
        )
        break
      case 'bid_close':
        lines.push(`Our quotation for ${yourRfqPlain} is due ${input.dueOn ? whenText(input.dueOn.slice(0, 10), today, input.dueTime) : 'soon'}. To include these items we still need your confirmation on:`)
        break
      case 'third':
        lines.push(`We are writing once more about ${yourRfqPlain}. The points below are still open${priorDates}:`)
        break
      case 'firm':
        lines.push(`It is now more than a month since we first wrote to you about ${yourRfqPlain}. The following points are still open:`)
        break
    }
    lines.push(list, '')
    if (kind === 'third') {
      lines.push(`If these items are no longer required, please let us know and we will close the enquiry. Otherwise, kindly confirm by ${by}.`)
    } else if (kind === 'firm') {
      lines.push(`Unless we hear from you by ${by}, we will close the enquiry. If it is still live, please confirm the points above and we will complete our quotation at once.`)
    } else if (kind === 'bid_close') {
      lines.push(`Kindly confirm by ${by}.`)
    } else {
      lines.push(
        `Kindly confirm by ${by}.${dueLong ? ` Our quotation is due on ${dueLong}, and a reply by then will allow us to hold the supplier's price.` : ''}`,
        '',
        'If it is easier to discuss these over a call, please let me know a convenient time.',
      )
    }
    if (kind === 'bid_close' || kind === 'third' || kind === 'firm') lines.push('', 'Thank you.')
    lines.push(...signOff(variant, input.signature))
  }

  const byShort = by === '5:00 pm today' ? 'today' : by
  const subject = email
    ? kind === 'third' || kind === 'firm'
      ? `${ref ? `RFQ ${ref}` : rfqRef}: reply needed by ${byShort}`
      : `${ref ? `RFQ ${ref}` : rfqRef}: your confirmation needed by ${byShort}`
    : null
  return { variant, subject, body: lines.join('\n'), kind, confirmBy }
}
