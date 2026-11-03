import { formatShortDate } from '@/lib/formatDay'

/*
 * The three facts the Job page header always shows for a job that has an order: the customer's PO (admin and sales only), the
 * supplier(s), and where the goods are. A value of null means "still loading" (the header draws a skeleton). Pure, so the wording is
 * tested without drawing the page.
 */
export interface KeyFactLeg {
  supplierName: string
  placedOn: string | null
  expectedOn: string | null
  deliveredOn: string | null
  cancelledWithSupplierOn?: string | null
}

export interface KeyFact {
  key: 'po' | 'supplier' | 'delivery'
  label: string
  value: string | null
}

export function jobKeyFacts(input: {
  order: { customerPo: string | null } | null | undefined
  legs: readonly KeyFactLeg[] | null | undefined
  money: boolean
  cancelled: boolean
  /** The order has lines and every one is a service: no goods, so no supplier. */
  servicesOnly?: boolean
  today?: string
}): KeyFact[] {
  const { order, legs, money, cancelled, servicesOnly = false, today } = input
  const facts: KeyFact[] = []
  if (money) {
    facts.push({ key: 'po', label: 'Customer PO', value: order === undefined || order === null ? null : order.customerPo?.trim() || 'Not recorded' })
  }
  // A leg the supplier agreed to cancel is no longer a supplier order of this job.
  const live = legs ? legs.filter(l => !l.cancelledWithSupplierOn) : null

  let supplier: string | null = null
  if (live) {
    const names = [...new Set(live.map(l => l.supplierName).filter(Boolean))]
    supplier = names.length === 0 ? (servicesOnly ? 'No goods' : 'Not chosen yet') : names.length > 2 ? `${names[0]}, ${names[1]} +${names.length - 2} more` : names.join(', ')
  }
  facts.push({ key: 'supplier', label: 'Supplier', value: supplier })

  let delivery: string | null = null
  if (cancelled) delivery = 'Order cancelled'
  else if (live) {
    const placed = live.filter(l => l.placedOn)
    const delivered = live.filter(l => l.deliveredOn)
    if (placed.length === 0) delivery = servicesOnly && live.length === 0 ? 'No goods' : 'Not ordered from the supplier yet'
    else if (delivered.length === 0) {
      const expected = live.map(l => l.expectedOn).filter((d): d is string => Boolean(d)).sort()[0]
      delivery = expected ? `Ordered, expected ${formatShortDate(expected, today)}` : 'Ordered'
    } else if (delivered.length < live.length) delivery = `${delivered.length} of ${live.length} delivered`
    else delivery = `Delivered ${formatShortDate(delivered.map(l => l.deliveredOn as string).sort().at(-1) as string, today)}`
  }
  facts.push({ key: 'delivery', label: 'Delivery', value: delivery })
  return facts
}
