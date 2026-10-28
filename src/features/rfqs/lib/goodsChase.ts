// The supplier goods chase: an order was placed, the expected date has passed and the goods have not arrived.
// Pure and framework-free. Amendment A3 / R16: the text includes supplier_orders.reference (our PO number, or the
// supplier's proforma) whenever it is set, so the supplier can find the order at once.
//
// Never names the customer, our price or the customer's deadline. Lists only what the leg holds (the goods lines
// attached to it); it does not invent a description or a quantity. More than 30 days late is firmer.

import { daysBetween, longDay } from './dateText'
import { addBusinessDays } from './dateText'
import { boldFor, byDayText, greetingFor, isFirm, oneLine, signOff, type ChaseSignature, type ChaseText } from './chaseCommon'
import { qtyText, type EnquiryVariant } from './enquiryDraft'

export interface GoodsChaseItem {
  description: string
  brandName?: string | null
  qty: number
  unit?: string | null
}

export interface GoodsChaseInput {
  /** supplier_orders.reference: Q-Tech's PO number or the supplier's PI. Null when not set. */
  reference: string | null
  /** supplier_orders.placed_on, YYYY-MM-DD. */
  placedOn: string | null
  /** supplier_orders.expected_on, YYYY-MM-DD. */
  expectedOn: string
  today: string
  /** Goods chases already stamped (0 means this is the first). */
  chaseCount: number
  contactName: string | null
  /** The goods lines on this leg. */
  items: readonly GoodsChaseItem[]
  signature: ChaseSignature
  variant: EnquiryVariant
}

export interface GoodsChase extends ChaseText {
  /** YYYY-MM-DD the supplier is asked to confirm dispatch by. */
  confirmBy: string
  daysLate: number
}

function itemLine(i: GoodsChaseItem, n: number): string {
  let d = oneLine(i.description)
  const brand = oneLine(i.brandName ?? '')
  if (brand && !d.toLowerCase().includes(brand.toLowerCase())) d = `${brand} ${d}`
  const q = qtyText(i.qty, i.unit)
  return `${n}. ${d}${q ? `, ${q}` : ''}`
}

export function generateGoodsChase(input: GoodsChaseInput): GoodsChase {
  const { variant, today, chaseCount } = input
  const email = variant === 'email'
  const bold = boldFor(variant)
  const daysLate = Math.max(0, daysBetween(input.expectedOn, today))
  const firm = isFirm(daysLate)
  const confirmBy = addBusinessDays(today, firm || chaseCount > 0 ? 1 : 2)
  const by = byDayText(confirmBy, today)
  const expected = longDay(input.expectedOn)
  const placed = input.placedOn ? longDay(input.placedOn) : null
  const ref = input.reference ? input.reference.trim() : null
  const order = ref
    ? `our order ${bold(ref)}${placed ? ` of ${placed}` : ''}`
    : placed
      ? `our order of ${bold(placed)}`
      : 'our order'
  const list = input.items.map((it, i) => itemLine(it, i + 1)).join('\n')
  const hasList = input.items.length > 0
  const lines: string[] = [greetingFor(variant, input.contactName), '']

  if (!email) {
    if (firm) lines.push(`It is now over a month since ${order} was due. It was expected on ${bold(expected)} and has still not been delivered${hasList ? ':' : '.'}`)
    else if (chaseCount === 0) lines.push(`Following up on ${order}. It was due on ${bold(expected)} and the goods have not yet been delivered${hasList ? ':' : '.'}`)
    else lines.push(`A further reminder on ${order}, due on ${bold(expected)}. The goods have still not been delivered${hasList ? ':' : '.'}`)
    if (hasList) lines.push(list)
    lines.push('')
    lines.push(
      firm
        ? `Please confirm a firm dispatch date by ${bold(by)}. If you cannot supply, kindly tell us so that we can make other arrangements.`
        : `Could you please confirm the dispatch date by ${bold(by)}?`,
    )
    lines.push('', 'Thank you.', ...signOff(variant, input.signature))
  } else {
    if (firm) lines.push(`It is now more than a month since ${order} was due. It was expected on ${expected} and has still not been delivered${hasList ? ':' : '.'}`)
    else if (chaseCount === 0) lines.push(`We refer to ${order}. The delivery was due on ${expected} and the goods have not yet been delivered${hasList ? ':' : '.'}`)
    else lines.push(`This is a further reminder on ${order}, due on ${expected}. The goods have still not been delivered${hasList ? ':' : '.'}`)
    if (hasList) lines.push(list)
    lines.push('')
    lines.push(
      firm
        ? `Please confirm a firm dispatch date by ${by}. If you are unable to supply, kindly let us know so that we can make other arrangements.`
        : `Could you please confirm the dispatch date, and the carrier and tracking details if the goods have already left, by ${by}?`,
    )
    lines.push('', 'Thank you.', ...signOff(variant, input.signature))
  }

  const subject = email ? `${ref ? `Order ${ref}` : 'Our order'}: delivery date needed by ${by === '5:00 pm today' ? 'today' : by}` : null
  return { variant, subject, body: lines.join('\n'), confirmBy, daysLate }
}
