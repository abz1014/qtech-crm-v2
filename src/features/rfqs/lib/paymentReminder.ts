// The payment reminder, in the approved wording (docs/design/mockups/g2-money.html, "Payment reminder"). Pure and
// framework-free. For admin and sales only: engineers never receive this text, because the data behind it comes from
// order_receivables() and invoices, which they cannot call or read (DATA_MODEL decision L).
//
// Polite at first; firmer once the invoice is more than 30 days overdue (DECISIONS 2026-10-14). It states the balance,
// what has been paid, the due date and how many reminders came before. It never invents a figure.

import { formatAmount } from '@/lib/money'
import type { Amount } from '@/lib/money'
import { addBusinessDays, dayMonth, dayMonthYear, daysBetween } from './dateText'
import { isFirm, type ChaseSignature, type ChaseText } from './chaseCommon'
import type { EnquiryVariant } from './enquiryDraft'

export interface PaymentReminderInput {
  /** The invoice the reminder is about (the earliest one still open). Null: the order has no invoice yet. */
  invoiceNumber: string | null
  /** YYYY-MM-DD */
  invoiceDate: string | null
  /** The customer's own PO number, if recorded. */
  customerPo: string | null
  /** What is still owed, gross (GST included). */
  balance: Amount
  /** What has been paid so far; shown as "after your payment of" when above zero. */
  settled: Amount
  /** YYYY-MM-DD the payment fell due. */
  dueOn: string
  today: string
  /** Reminders already stamped for this order (0 means this is the first). */
  reminderCount: number
  lastRemindedOn: string | null
  contactName: string | null
  signature: ChaseSignature
  variant: EnquiryVariant
  /** Every invoice number on the order, oldest first. With two or more the text names them all (and drops the single invoice date). */
  invoiceNumbers?: readonly string[]
  /** The order's gross. When given, the email carries the small table of figures (invoice, total, received, outstanding, due, days overdue). */
  gross?: Amount
}

export interface PaymentReminder extends ChaseText {
  daysOverdue: number
  firm: boolean
  /** YYYY-MM-DD the customer is asked to confirm the payment date by. */
  confirmBy: string
}

const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)

export function generatePaymentReminder(input: PaymentReminderInput): PaymentReminder {
  const { variant, today } = input
  const email = variant === 'email'
  const daysOverdue = Math.max(0, daysBetween(input.dueOn, today))
  const firm = isFirm(daysOverdue)
  const confirmBy = addBusinessDays(today, firm ? 1 : 3)
  const balance = `PKR ${formatAmount(input.balance)}`
  const paid = Number(input.settled) > 0 ? ` (after your payment of PKR ${formatAmount(input.settled)})` : ''
  const many = (input.invoiceNumbers?.length ?? 0) > 1
  const po = input.customerPo ? ` (your PO ${input.customerPo})` : ''
  const invoice = many
    ? `Sales Tax Invoices ${(input.invoiceNumbers as readonly string[]).join(', ')}${po}`
    : input.invoiceNumber
      ? `Sales Tax Invoice ${input.invoiceNumber}${input.invoiceDate ? ` dated ${dayMonthYear(input.invoiceDate)}` : ''}${po}`
      : `our order${po}`
  const hello = input.contactName ? `Assalamu alaikum ${input.contactName},` : 'Assalamu alaikum,'
  const greeting = email ? (input.contactName ? `Dear ${input.contactName},\nAssalamu alaikum.` : 'Dear Sir or Madam,\nAssalamu alaikum.') : hello
  const reminded =
    input.reminderCount > 0
      ? ` We have reminded you ${times(input.reminderCount)}${input.lastRemindedOn ? `, most recently on ${dayMonth(input.lastRemindedOn)}` : ''}.`
      : ''

  const lines: string[] = [greeting, '', 'I hope you are well.']
  const facts = `${invoice} still has an outstanding balance of ${balance}${paid}.`
  // Sent before the due date (from the order page, "Customer owes ..."): a gentle note, not "fell due".
  const notDueYet = daysBetween(input.dueOn, today) < 0
  const due = firm
    ? `It was due on ${dayMonthYear(input.dueOn)} and is now ${daysOverdue} days overdue.${reminded}`
    : notDueYet
      ? `It is due on ${dayMonthYear(input.dueOn)}.${reminded}`
      : daysOverdue <= 1
      ? `It fell due on ${dayMonthYear(input.dueOn)}.${reminded}`
      : `It fell due on ${dayMonthYear(input.dueOn)}, ${daysOverdue} days ago.${reminded}`
  lines.push(`Our records show that ${facts} ${due}`, '')
  if (email && input.gross !== undefined) {
    const ref = many ? `Invoices: ${(input.invoiceNumbers as readonly string[]).join(', ')}` : `Invoice: ${input.invoiceNumber ?? 'our order'}${input.invoiceDate ? ` dated ${dayMonthYear(input.invoiceDate)}` : ''}`
    lines.push(
      ref,
      ...(input.customerPo ? [`Your PO: ${input.customerPo}`] : []),
      `Invoice total: PKR ${formatAmount(input.gross)}`,
      ...(Number(input.settled) > 0 ? [`Received: PKR ${formatAmount(input.settled)}`] : []),
      `Outstanding: ${balance}`,
      `Due date: ${dayMonthYear(input.dueOn)}`,
      `Days overdue: ${daysOverdue}`,
      '',
    )
  }
  if (firm) {
    lines.push(
      'We request you to treat this as a priority and confirm the payment date by return. If there is a query on the invoice, or a document you are waiting for from us, please tell us today so that we can resolve it at once.',
      '',
      'Thank you for your understanding.',
    )
  } else {
    lines.push(
      'We would be grateful if you could confirm when payment will be made. If there is a query on the invoice, or a document you are waiting for from us, please let us know so that we can sort it out.',
      '',
      'Thank you.',
    )
  }
  const sig = input.signature
  lines.push('', ...(email ? ['With best regards,', sig.name, sig.jobTitle ? `${sig.jobTitle}, ${sig.company}` : sig.company, ...(sig.phone ? [sig.phone] : [])] : ['Regards,', sig.name, sig.company]))

  const subject = email
    ? `${input.invoiceNumber ? `Invoice ${input.invoiceNumber}` : 'Our invoice'}: ${firm ? 'payment overdue' : 'payment due'}, PKR ${formatAmount(input.balance)} outstanding`
    : null
  return { variant, subject, body: lines.join('\n'), daysOverdue, firm, confirmBy }
}
