import { describe, expect, it } from 'vitest'
import { buildSupplierRecord, type SupplierRecordRaw } from '@/features/companies/supplierRecord'

const TODAY = '2026-11-27'
const ME = 'sup-1'

const raw = (over: Partial<SupplierRecordRaw> = {}): SupplierRecordRaw => ({ supplierId: ME, inquiries: [], lines: [], items: [], rfqs: [], orderItems: [], legs: [], ...over })
const inq = (id: string, rfqId: string, over: object = {}) => ({ id, rfqId, sentOn: '2026-11-24', lastChasedOn: null, chaseCount: 0, noOfferOn: null, noOfferReason: null, legacy: false, ...over })
const item = (id: string, rfqId: string, over: object = {}) => ({ id, rfqId, position: 1, description: `Item ${id}`, qty: 2, unit: null, brandName: 'Belimo', ...over })
const line = (id: string, inquiryId: string, itemId: string, over: object = {}) => ({
  id,
  inquiryId,
  itemId,
  unitPrice: 214,
  currency: 'EUR',
  leadTime: '2 to 3 weeks ex stock',
  fxRatePkr: 326.8,
  fxRateOn: '2026-10-11',
  enteredOn: '2026-10-11',
  hidden: false,
  legacy: false,
  ...over,
})
const rfq = (id: string, number: number, closedOn: string | null = null) => ({ id, number, closedOn })
const leg = (id: string, orderNumber: number, over: object = {}) => ({ id, orderNumber, cancelled: false, placedOn: null, expectedOn: null, receivedOn: null, legacy: false, currency: null, po: null, ...over })

describe('recent quotes', () => {
  it('shows the price in its own currency and the PKR value at the rate captured on the day, not today\'s', () => {
    const r = buildSupplierRecord(
      raw({ inquiries: [inq('i1', 'r1', { sentOn: '2026-10-10' })], items: [item('t1', 'r1')], rfqs: [rfq('r1', 162)], lines: [line('l1', 'i1', 't1')] }),
      TODAY,
    )
    const q = r.quotes[0]
    expect(q.rfqRef).toBe('RFQ-0162')
    expect(q.price.amount).toBe('EUR 214')
    expect(q.price.pkr).toBe('69,935')
    expect(q.price.rate).toBe('326.80 · 11 Oct')
    expect(q.dateText).toBe('11 Oct')
    expect(q.leadTime).toBe('2 to 3 weeks ex stock')
  })

  it('an imported line has no captured rate: original currency only, marked Imported, dated by the enquiry', () => {
    const r = buildSupplierRecord(
      raw({
        inquiries: [inq('i1', 'r1', { sentOn: '2025-04-20', legacy: true })],
        items: [item('t1', 'r1')],
        rfqs: [rfq('r1', 73)],
        lines: [line('l1', 'i1', 't1', { unitPrice: 96, fxRatePkr: null, fxRateOn: null, enteredOn: '2026-09-01', legacy: true })],
      }),
      TODAY,
    )
    const q = r.quotes[0]
    expect(q.price.pkr).toBeNull()
    expect(q.price.note).toBe('PKR value not captured at the time')
    expect(q.imported).toBe(true)
    expect(q.dateText).toBe('Apr 2025')
    expect(q.ago).toBe('19 months ago')
  })

  it('hides a price whose currency is unverified', () => {
    const r = buildSupplierRecord(
      raw({ inquiries: [inq('i1', 'r1')], items: [item('t1', 'r1')], rfqs: [rfq('r1', 1)], lines: [line('l1', 'i1', 't1', { hidden: true, legacy: true })] }),
      TODAY,
    )
    expect(r.quotes[0].price.state).toBe('hidden')
    expect(r.quotes[0].price.amount).toBeNull()
  })

  it('says what became of each quoted item: ordered here, elsewhere, or not at all', () => {
    const r = buildSupplierRecord(
      raw({
        inquiries: [inq('i1', 'r1')],
        items: [item('t1', 'r1', { position: 1 }), item('t2', 'r1', { position: 2 }), item('t3', 'r1', { position: 3 }), item('t4', 'r1', { position: 4 })],
        rfqs: [rfq('r1', 5, '2026-11-20')],
        lines: [line('l1', 'i1', 't1'), line('l2', 'i1', 't2'), line('l3', 'i1', 't3'), line('l4', 'i1', 't4')],
        orderItems: [
          { itemId: 't1', orderNumber: 38, cancelled: false, supplierId: ME },
          { itemId: 't2', orderNumber: 40, cancelled: false, supplierId: 'other' },
          { itemId: 't3', orderNumber: 41, cancelled: true, supplierId: ME },
        ],
      }),
      TODAY,
    )
    const by = Object.fromEntries(r.quotes.map(q => [q.key, q]))
    expect(by['q-l1']).toMatchObject({ outcome: 'ordered-here', orderRef: 'ORD-0038' })
    expect(by['q-l2']).toMatchObject({ outcome: 'ordered-elsewhere', orderRef: null })
    expect(by['q-l3'].outcome).toBe('not-ordered') // a cancelled order does not count
    expect(by['q-l4'].outcome).toBe('not-ordered')
  })

  it('a quote on an RFQ that is still open, not ordered anywhere, reads "Quoted, RFQ open"', () => {
    const r = buildSupplierRecord(raw({ inquiries: [inq('i1', 'r1')], items: [item('t1', 'r1')], rfqs: [rfq('r1', 5)], lines: [line('l1', 'i1', 't1')] }), TODAY)
    expect(r.quotes[0].outcome).toBe('quoted-open')
  })

  it('lists an enquiry with no price as waiting, no reply or declined, never as a price', () => {
    const r = buildSupplierRecord(
      raw({
        inquiries: [
          inq('w', 'r1', { sentOn: '2026-11-24' }),
          inq('n', 'r2', { sentOn: '2026-06-02' }),
          inq('d', 'r3', { sentOn: '2026-06-16', noOfferOn: '2026-06-17', noOfferReason: 'no_brand' }),
        ],
        items: [item('a', 'r1'), item('b', 'r2'), item('c', 'r3'), item('c2', 'r3', { position: 2 })],
        rfqs: [rfq('r1', 171), rfq('r2', 88), rfq('r3', 104)],
      }),
      TODAY,
    )
    const by = Object.fromEntries(r.quotes.map(q => [q.rfqRef, q]))
    expect(by['RFQ-0171']).toMatchObject({ outcome: 'waiting', itemNote: 'Sent 24 Nov, 3 days ago', pkrNote: 'Awaiting a quote' })
    expect(by['RFQ-0088']).toMatchObject({ outcome: 'no-reply', itemNote: null, pkrNote: 'Sent 2 Jun, never answered' })
    expect(by['RFQ-0104']).toMatchObject({ outcome: 'declined', pkrNote: "Doesn't carry this brand", qty: '+ 1 more item' })
    expect(by['RFQ-0171'].price.state).toBe('none')
  })

  it('is newest first and shows at most ten rows, with the full count', () => {
    const inquiries = Array.from({ length: 13 }, (_, i) => inq(`i${i}`, `r${i}`, { sentOn: `2026-0${(i % 9) + 1}-1${i % 9}` }))
    const r = buildSupplierRecord(raw({ inquiries, rfqs: inquiries.map((q, i) => rfq(q.rfqId, i + 1)) }), TODAY)
    expect(r.quotes).toHaveLength(10)
    expect(r.quoteCount).toBe(13)
    const dates = r.quotes.map(q => q.date)
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('never prints a percentage or a score', () => {
    const r = buildSupplierRecord(
      raw({ inquiries: [inq('i1', 'r1')], items: [item('t1', 'r1')], rfqs: [rfq('r1', 1)], lines: [line('l1', 'i1', 't1')], legs: [leg('g', 1, { expectedOn: '2026-11-01', receivedOn: '2026-11-05' })] }),
      TODAY,
    )
    expect(JSON.stringify(r)).not.toMatch(/%|score|rating/i)
  })
})

describe('deliveries', () => {
  it('compares expected with received, in days', () => {
    const r = buildSupplierRecord(
      raw({
        legs: [
          leg('a', 38, { expectedOn: '2026-11-20', receivedOn: '2026-11-19', po: { number: 17, revision: 1, issuedOn: '2026-11-01' } }),
          leg('b', 34, { expectedOn: '2026-10-08', receivedOn: '2026-10-14', po: { number: 4, revision: 0, issuedOn: '2026-09-20' } }),
          leg('c', 21, { expectedOn: '2026-06-12', receivedOn: '2026-06-12', legacy: true }),
        ],
      }),
      TODAY,
    )
    const by = Object.fromEntries(r.deliveries.map(d => [d.orderRef, d]))
    expect(by['ORD-0038']).toMatchObject({ po: 'PO-26-0017 · R1', result: { kind: 'ontime', days: 1 } })
    expect(by['ORD-0034']).toMatchObject({ po: 'PO-26-0004', result: { kind: 'late', days: 6, text: 'Late 6 days' } })
    expect(by['ORD-0021']).toMatchObject({ po: null, estimated: true, result: { kind: 'ontime', days: 0 } })
    expect(r.deliveries.map(d => d.orderRef)).toEqual(['ORD-0038', 'ORD-0034', 'ORD-0021'])
  })

  it('leaves out cancelled orders and legs with no date at all; an overdue leg says so', () => {
    const r = buildSupplierRecord(
      raw({ legs: [leg('a', 1, { cancelled: true, expectedOn: '2026-10-01' }), leg('b', 2), leg('c', 3, { expectedOn: '2026-11-20' }), leg('d', 4, { expectedOn: '2026-12-10' })] }),
      TODAY,
    )
    expect(r.deliveryCount).toBe(2)
    expect(r.deliveries.find(d => d.orderRef === 'ORD-0003')?.result).toMatchObject({ kind: 'overdue', days: 7 })
    expect(r.deliveries.find(d => d.orderRef === 'ORD-0004')?.result).toMatchObject({ kind: 'expected', days: 13 })
  })
})

describe('open with them', () => {
  it('lists unanswered enquiries on open RFQs and order legs not yet received', () => {
    const r = buildSupplierRecord(
      raw({
        inquiries: [
          inq('open', 'r1', { sentOn: '2026-11-24' }),
          inq('closed', 'r2', { sentOn: '2026-11-20' }),
          inq('answered', 'r3', { sentOn: '2026-11-10' }),
          inq('declined', 'r4', { sentOn: '2026-11-10', noOfferOn: '2026-11-11' }),
        ],
        rfqs: [rfq('r1', 171), rfq('r2', 160, '2026-11-25'), rfq('r3', 150), rfq('r4', 140)],
        items: [item('t3', 'r3')],
        lines: [line('l', 'answered', 't3')],
        legs: [leg('g1', 38, { receivedOn: null, expectedOn: '2026-11-30' }), leg('g2', 20, { receivedOn: '2026-10-01' }), leg('g3', 39, { cancelled: true })],
      }),
      TODAY,
    )
    expect(r.open.enquiries).toEqual([{ inquiryId: 'open', rfqId: 'r1', rfqRef: 'RFQ-0171', waitingDays: 3 }])
    expect(r.open.legs).toEqual([{ legId: 'g1', orderRef: 'ORD-0038', text: 'expected 30 Nov' }])
  })

  it('names the currency they last quoted in, else the one on their last leg, else nothing', () => {
    const base = { inquiries: [inq('i1', 'r1')], items: [item('t1', 'r1')], rfqs: [rfq('r1', 1)] }
    expect(buildSupplierRecord(raw({ ...base, lines: [line('l1', 'i1', 't1', { currency: 'USD' })] }), TODAY).open.currency).toBe('USD')
    expect(buildSupplierRecord(raw({ legs: [leg('g', 1, { currency: 'EUR' })] }), TODAY).open.currency).toBe('EUR')
    expect(buildSupplierRecord(raw(), TODAY).open.currency).toBeNull()
  })

  it('says what the last contact was', () => {
    const r = buildSupplierRecord(raw({ inquiries: [inq('open', 'r1', { sentOn: '2026-11-24' })], rfqs: [rfq('r1', 171)] }), TODAY)
    expect(r.lastContact).toEqual(['Enquiry sent for ', { rfqId: 'r1', ref: 'RFQ-0171' }, '. No reply yet.'])
  })

  it('says how often it was chased and when, and marks an imported leg', () => {
    const chased = buildSupplierRecord(
      raw({ inquiries: [inq('i1', 'r1', { sentOn: '2026-11-12', lastChasedOn: '2026-11-19', chaseCount: 1 })], rfqs: [rfq('r1', 165)] }),
      TODAY,
    )
    expect(chased.lastContact).toEqual(['Enquiry sent for ', { rfqId: 'r1', ref: 'RFQ-0165' }, '. Chased once on 19 Nov.'])
    const imported = buildSupplierRecord(raw({ legs: [leg('g', 20, { placedOn: '2026-09-07', legacy: true })] }), TODAY)
    expect(imported.lastContact).toEqual(['Supplier order for ORD-0020. Imported.'])
  })

  it('names how long it went unanswered, with the chases', () => {
    const r = buildSupplierRecord(raw({ inquiries: [inq('i1', 'r1', { sentOn: '2026-10-09', chaseCount: 1 })], items: [item('a', 'r1')], rfqs: [rfq('r1', 152)] }), TODAY)
    expect(r.quotes[0].pkrNote).toBe('Sent 9 Oct, chased once, never answered')
  })

  it('counts delivery squares from the legs: an imported on-time delivery is drawn as estimated', () => {
    const r = buildSupplierRecord(
      raw({
        legs: [
          leg('a', 1, { expectedOn: '2026-11-20', receivedOn: '2026-11-19' }),
          leg('b', 2, { expectedOn: '2026-10-08', receivedOn: '2026-10-14' }),
          leg('c', 3, { expectedOn: '2026-06-12', receivedOn: '2026-06-12', legacy: true }),
        ],
      }),
      TODAY,
    )
    expect(r.deliveryUnits).toEqual({ ontime: 1, late: 1, estimatedOntime: 1 })
    expect(r.span).toEqual({ from: '2026-06-12', to: '2026-11-20' })
  })
})
