// Today (R16): the prepared draft for a chase item, both channels at once, from the facts already on screen.
// Pure: no database, no clock (today comes in). The generators live in features/rfqs/lib (one source of truth).

import { daysBetween } from '@/features/rfqs/lib/dateText'
import {
  generateCustomerChase,
  generateGoodsChase,
  generatePaymentReminder,
  generateSupplierChase,
  type ChaseSignature,
  type ChaseText,
  type CustomerChase,
  type GoodsChase,
  type PaymentReminder,
  type SupplierChase,
} from '@/features/rfqs/lib'
import type { InquiryRow, RfqItemRow } from '@/features/rfqs/api'
import type { LegDraftData, PaymentDraftData } from '@/features/today/api'
import type { ClarificationFact, LegFact, ReceivableFact, RfqFact } from '@/features/today/types'

export interface Draft {
  kind: 'customer' | 'supplier' | 'goods' | 'payment'
  contact: { name: string; phone: string | null } | null
  whatsapp: ChaseText
  email: ChaseText
  /** What the stamp will change: used to word the footer ("asked ×2", "chase 1 for this supplier"). */
  countAfter: number
  /** The date this chase asks the other side to answer by, YYYY-MM-DD. */
  answerBy: string | null
  /** True when the text is the firmer wording. */
  firm: boolean
}

const both = <T extends ChaseText>(make: (variant: 'whatsapp' | 'email') => T): { whatsapp: T; email: T } => ({ whatsapp: make('whatsapp'), email: make('email') })

export function buildCustomerDraft(input: {
  rfq: RfqFact
  /** The RFQ's contact (name and phone), when one is set. */
  contact: { name: string; phone: string | null } | null
  questions: readonly ClarificationFact[]
  /** The RFQ's items, to tag each question with its item ("(item 2)"). */
  items?: ReadonlyArray<{ id: string; number: number; description: string; brandName: string | null }>
  today: string
  signature: ChaseSignature
}): Draft | null {
  const { rfq, questions } = input
  if (questions.length === 0) return null
  const askCount = Math.max(...questions.map(q => q.askCount))
  const first = questions.map(q => q.firstAskedOn).reduce((a, b) => (a < b ? a : b))
  const last = questions.map(q => q.lastAskedOn).reduce((a, b) => (a > b ? a : b))
  const t = both<CustomerChase>(variant =>
    generateCustomerChase({
      rfqRef: `RFQ-${String(rfq.number).padStart(4, '0')}`,
      customerRef: rfq.customerRef,
      contactName: input.contact?.name ?? null,
      questions: questions.map(q => q.question),
      askCount,
      firstAskedOn: first,
      lastAskedOn: last,
      dueOn: rfq.dueOn,
      dueTime: rfq.dueTime,
      itemTags: questions.map(q => {
        const it = q.rfqItemId ? input.items?.find(i => i.id === q.rfqItemId) : undefined
        return it ? { number: it.number, label: `${it.brandName && !it.description.toLowerCase().includes(it.brandName.toLowerCase()) ? `${it.brandName} ` : ''}${it.description}` } : null
      }),
      today: input.today,
      signature: input.signature,
      variant,
    }),
  )
  return { kind: 'customer', contact: input.contact, ...t, countAfter: askCount + 1, answerBy: t.whatsapp.confirmBy, firm: t.whatsapp.kind === 'firm' }
}

export function buildSupplierDraft(input: {
  rfq: RfqFact
  inquiry: InquiryRow
  items: readonly RfqItemRow[]
  today: string
  signature: ChaseSignature
}): Draft | null {
  const { inquiry, items } = input
  const priced = items.filter(it => inquiry.lines.some(l => l.itemId === it.id))
  const outstanding = items.filter(it => !inquiry.lines.some(l => l.itemId === it.id) && !inquiry.itemDeclines[it.id])
  if (!inquiry.sentOn || inquiry.noOfferOn || outstanding.length === 0) return null
  const t = both<SupplierChase>(variant =>
    generateSupplierChase({
      rfqRef: `RFQ-${String(input.rfq.number).padStart(4, '0')}`,
      sentOn: inquiry.sentOn,
      dueOn: input.rfq.dueOn,
      today: input.today,
      chaseCount: inquiry.chaseCount,
      contactName: inquiry.contactName,
      pricedNumbers: priced.map(it => it.number),
      items: outstanding.map(it => ({ number: it.number, description: it.description, brandName: it.brandName, qty: it.qty, unit: it.unit })),
      signature: input.signature,
      variant,
      ageDays: inquiry.sentOn ? daysBetween(inquiry.sentOn, input.today) : null,
    }),
  )
  return {
    kind: 'supplier',
    contact: inquiry.contactName ? { name: inquiry.contactName, phone: inquiry.contactPhone } : null,
    ...t,
    countAfter: inquiry.chaseCount + 1,
    answerBy: t.whatsapp.replyBy,
    firm: inquiry.sentOn ? daysBetween(inquiry.sentOn, input.today) > 30 : false,
  }
}

export function buildGoodsDraft(input: { leg: LegFact; data: LegDraftData; today: string; signature: ChaseSignature }): Draft | null {
  const { leg, data } = input
  if (!leg.expectedOn) return null
  const t = both<GoodsChase>(variant =>
    generateGoodsChase({
      reference: leg.reference,
      placedOn: leg.placedOn,
      expectedOn: leg.expectedOn as string,
      today: input.today,
      chaseCount: leg.chaseCount,
      contactName: data.contact?.name ?? null,
      items: data.items,
      signature: input.signature,
      variant,
    }),
  )
  return { kind: 'goods', contact: data.contact, ...t, countAfter: leg.chaseCount + 1, answerBy: t.whatsapp.confirmBy, firm: t.whatsapp.daysLate > 30 }
}

export function buildPaymentDraft(input: { receivable: ReceivableFact; data: PaymentDraftData; today: string; signature: ChaseSignature }): Draft | null {
  const { receivable, data } = input
  if (!receivable.dueOn) return null
  const t = both<PaymentReminder>(variant =>
    generatePaymentReminder({
      invoiceNumber: data.invoiceNumber,
      invoiceDate: data.invoiceDate,
      customerPo: data.customerPo,
      balance: receivable.balance,
      settled: receivable.settled,
      dueOn: receivable.dueOn as string,
      today: input.today,
      reminderCount: receivable.reminderCount,
      lastRemindedOn: receivable.lastRemindedOn,
      contactName: data.contact?.name ?? null,
      signature: input.signature,
      variant,
    }),
  )
  return { kind: 'payment', contact: data.contact, ...t, countAfter: receivable.reminderCount + 1, answerBy: t.whatsapp.confirmBy, firm: t.whatsapp.firm }
}
