// A fictional, imported-style Today data set (redesign phase 0, "stop the noise"). It has the SHAPE of the owner's live data the
// day after the legacy import (two years of finished business that came in looking like live work), but every name, number and
// amount is made up: the repo is public. Used by the counter tests (needsYou.test.ts) to measure the Today count before and
// after the one "needs you" definition, and to prove that no two counters disagree.
//
// What is in it (admin's view on Thu 22 Oct 2026):
//   - 22 imported RFQs, ownerless (so they route to admin), months or years old: not floated, quotation due long ago with the
//     supplier enquiries sent long ago, quotation sent with no decision, quotation expired.
//   - 2 fresh v2 RFQs: one with its quotation due today, one received today with no supplier asked yet.
//   - imported orders: one to plan commissioning (ordered 700 days ago), five part-invoiced and delivered 757 days ago, and 18
//     settled ones whose costs were never marked complete (one roll-up row).
//   - one fresh v2 order delivered yesterday and not invoiced.
//   - 3 late payments on real invoices (due 1, 9 and 40 days ago): late money, never hidden.
//   - imported invoices: 26 FBR steps out of order (deposit with no receipt) and 3 with tax not deposited (one roll-up row).
import { addDays } from '@/features/rfqs/lib/dateText'
import type { CostFact, InquiryFact, InvoiceFact, OrderFact, ReceivableFact, RfqFact, Role, TodayInputs } from './types'

export const FIXTURE_TODAY = '2026-10-22'
export const FIXTURE_ADMIN = 'u-admin'
const SALES = 'u-sales'
const roles: Record<string, Role> = { [FIXTURE_ADMIN]: 'admin', [SALES]: 'sales' }

const ago = (n: number) => addDays(FIXTURE_TODAY, -n) as string
const uuid = (prefix: string, n: number) => `${prefix}-${String(n).padStart(4, '0')}`

const rfq = (n: number, o: Partial<RfqFact>): RfqFact => ({
  id: uuid('rfq', n),
  number: n,
  ownerId: null,
  companyName: `Fictional Customer ${n}`,
  customerRef: null,
  receivedOn: ago(400),
  dueOn: null,
  dueTime: null,
  quotedOn: null,
  isPriority: false,
  bidState: 'to_bid',
  sourcingState: 'not_floated',
  quotationValidUntil: null,
  ...o,
})

const inquiry = (n: number, rfqId: string, sentOn: string): InquiryFact => ({
  id: uuid('inq', n),
  rfqId,
  supplierId: uuid('sup', n),
  supplierName: `Fictional Supplier ${n}`,
  sentOn,
  lastChasedOn: null,
  lastChasedBy: null,
  chaseCount: 0,
  responseState: 'awaiting',
  answersToRelay: 0,
  answeredOn: null,
  replied: 0,
  medianReplyDays: null,
})

const order = (n: number, o: Partial<OrderFact>): OrderFact => ({
  id: uuid('ord', n),
  number: n,
  ownerId: null,
  customerName: `Fictional Customer ${n}`,
  orderedOn: ago(760),
  goodsState: 'delivered',
  commissioningState: 'n_a',
  invoicingState: 'fully_invoiced',
  unsourced: 0,
  toInvoice: null,
  lastInvoicedOn: null,
  deliveredOn: null,
  ...o,
})

export function importedStyleInputs(): TodayInputs {
  const rfqs: RfqFact[] = []
  const inquiries: InquiryFact[] = []
  // 8 imported RFQs nobody floated, received 70 to 640 days ago
  for (let i = 0; i < 8; i++) rfqs.push(rfq(100 + i, { receivedOn: ago(70 + i * 80) }))
  // 6 imported RFQs still "to bid", their quotation due 400 to 995 days ago, suppliers asked long ago and never answered
  for (let i = 0; i < 6; i++) {
    const r = rfq(110 + i, { receivedOn: ago(636 + i), dueOn: ago(400 + i * 119), sourcingState: 'floated_awaiting' })
    rfqs.push(r)
    inquiries.push(inquiry(110 + i, r.id, ago(630 + i)))
  }
  // 6 imported RFQs with the quotation sent 100 to 458 days ago and no decision
  for (let i = 0; i < 6; i++) rfqs.push(rfq(120 + i, { receivedOn: ago(470), quotedOn: ago(100 + i * 71), bidState: 'bid_sent', sourcingState: 'covered' }))
  // 2 imported RFQs whose quotation expired long ago
  for (let i = 0; i < 2; i++) rfqs.push(rfq(130 + i, { receivedOn: ago(500), quotedOn: ago(480), bidState: 'quotation_expired', sourcingState: 'covered', quotationValidUntil: ago(450 - i) }))
  // 2 fresh v2 RFQs owned by nobody yet (admin picks them up): quotation due today, and one received today
  rfqs.push(rfq(201, { ownerId: FIXTURE_ADMIN, receivedOn: ago(6), dueOn: FIXTURE_TODAY, sourcingState: 'covered' }))
  rfqs.push(rfq(202, { ownerId: FIXTURE_ADMIN, receivedOn: FIXTURE_TODAY }))

  const orders: OrderFact[] = [
    // imported: commissioning never planned
    order(10, { orderedOn: ago(700), goodsState: 'delivered', commissioningState: 'to_plan', invoicingState: 'fully_invoiced' }),
    // imported: part-invoiced, delivered 757 days ago
    ...Array.from({ length: 5 }, (_, i) =>
      order(11 + i, { invoicingState: 'part', deliveredOn: ago(757), lastInvoicedOn: ago(757 - i), toInvoice: 150_000 + i * 1_000 }),
    ),
    // v2: delivered yesterday, not invoiced
    order(301, { ownerId: FIXTURE_ADMIN, orderedOn: ago(20), invoicingState: 'not_invoiced', deliveredOn: ago(1) }),
  ]

  const receivables: ReceivableFact[] = [1, 9, 40].map((late, i) => ({
    orderId: uuid('ord', 401 + i),
    orderNumber: 401 + i,
    ownerId: FIXTURE_ADMIN,
    customerName: `Fictional Customer ${401 + i}`,
    balance: 100_000 + i * 50_000,
    settled: 0,
    dueOn: ago(late),
    isOverdue: true,
    lastRemindedOn: null,
    reminderCount: 0,
  }))

  const costs: CostFact[] = Array.from({ length: 18 }, (_, i) => ({
    orderId: uuid('ord', 20 + i),
    orderNumber: 20 + i,
    expectedCost: null,
    actualCost: 0,
    paymentState: 'settled',
    costsState: 'provisional',
    basisUnknown: false,
    cancelled: false,
    legacy: true,
  }))

  const invoices: InvoiceFact[] = Array.from({ length: 29 }, (_, i) => ({
    id: uuid('inv', i),
    number: String(100 + i),
    orderId: null,
    invoiceDate: ago(400 + i * 10),
    courierState: 'delivered_to_client',
    fbrState: i < 26 ? 'deposited' : 'pending',
    // 0088 (D8): the "deposit without a receipt" exception no longer applies to an imported invoice, so the view says false.
    fbrException: false,
    needsFbrAttention: i >= 26,
  }))

  return {
    today: FIXTURE_TODAY,
    user: { id: FIXTURE_ADMIN, role: 'admin' },
    roleOf: id => (id ? (roles[id] ?? null) : null),
    rfqs,
    clarifications: [],
    inquiries,
    legs: [],
    orders,
    receivables,
    monthEnd: null,
    costs,
    invoices,
    recurring: [],
    jobs: [],
    snoozes: [],
  }
}
