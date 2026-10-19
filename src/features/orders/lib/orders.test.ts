import { describe, expect, it } from 'vitest'
import { guessCommissioning } from '@/features/orders/lib/convert'
import { defaultExpected, leadTimeUpperDays, medianDeliveryDays, suggestExpected } from '@/features/orders/lib/leadTime'
import { before, editPatch, expectedAfterIssue, legLetter, legState, legSupplierTotal, nextStamp, stampPatch, type LegDates } from '@/features/orders/lib/legModel'
import { isExemptAll, lineGstPaisa, orderTotals } from '@/features/orders/lib/orderMath'
import { buildPayload, defaultChoices, unpricedItems, type ConvertItem, type ConvertQuote } from '@/features/orders/lib/convert'

const none: LegDates = { placedOn: null, expectedOn: null, receivedOn: null, deliveredOn: null }

describe('lead time (A3/O03: the upper bound)', () => {
  it.each([
    ['2 wks', 14],
    ['4-6 wks', 42],
    ['4 to 6 weeks', 42],
    ['10 to 14 days', 14],
    ['3 days', 3],
    ['1 month', 30],
    ['10', 10],
  ])('%s is %i days', (text, days) => expect(leadTimeUpperDays(text)).toBe(days))
  it.each([[''], [null], ['soon'], ['ex-stock']])('%s gives no date', text => {
    const d = leadTimeUpperDays(text as string | null)
    expect(d === null || d === 0).toBe(true)
  })
  it('suggests placed_on plus the longest lead time on the leg', () => {
    expect(suggestExpected('2026-11-06', ['2 wks', '10 days'])).toEqual({ on: '2026-11-20', from: '2 wks', days: 14 })
    expect(suggestExpected('2026-11-06', [null, 'soon'])).toBeNull()
    expect(suggestExpected(null, ['2 wks'])).toBeNull()
  })
})

describe('leg stamps (one next-step button)', () => {
  it('goes placed, delivered, then nothing (there is no receiving step)', () => {
    expect(nextStamp(none)).toEqual({ step: 'place', label: 'Mark placed' })
    expect(nextStamp({ ...none, placedOn: '2026-11-01' })).toEqual({ step: 'deliver', label: 'Delivered today' })
    // an imported leg that only has a received date still offers delivery, never a receiving step
    expect(nextStamp({ ...none, placedOn: '2026-11-01', receivedOn: '2026-11-05' })).toEqual({ step: 'deliver', label: 'Delivered today' })
    expect(nextStamp({ placedOn: 'a', expectedOn: null, receivedOn: 'b', deliveredOn: 'c' })).toBeNull()
  })
  it('marking placed suggests expected_on from the lead time, once', () => {
    expect(stampPatch('place', none, '2026-11-06', ['2 wks'])).toEqual({ placed_on: '2026-11-06', expected_on: '2026-11-20' })
    expect(stampPatch('place', { ...none, expectedOn: '2026-12-01' }, '2026-11-06', ['2 wks'])).toEqual({ placed_on: '2026-11-06' })
    // no lead time and no delivery record: 30 days assumed, so goods late can still fire
    expect(stampPatch('place', none, '2026-11-06', [])).toEqual({ placed_on: '2026-11-06', expected_on: '2026-12-06' })
    expect(stampPatch('place', none, '2026-11-06', ['soon'], 18)).toEqual({ placed_on: '2026-11-06', expected_on: '2026-11-24' })
  })
  it('delivering sets received_on to the same day, editing delivered moves received with it, clearing clears both', () => {
    expect(stampPatch('deliver', { ...none, placedOn: 'x' }, '2026-11-20', [])).toEqual({ delivered_on: '2026-11-20', received_on: '2026-11-20' })
    expect(stampPatch('deliver', { ...none, placedOn: 'x', receivedOn: '2026-11-19' }, '2026-11-20', [])).toEqual({ delivered_on: '2026-11-20', received_on: '2026-11-20' })
    expect(editPatch('deliveredOn', '2026-11-22', { ...none, placedOn: 'x', receivedOn: '2026-11-20', deliveredOn: '2026-11-20' }, [])).toEqual({ delivered_on: '2026-11-22', received_on: '2026-11-22' })
    expect(editPatch('deliveredOn', null, { ...none, receivedOn: 'y', deliveredOn: 'y' }, [])).toEqual({ delivered_on: null, received_on: null })
  })
  it('a typed placed date suggests expected too; clearing a date clears only it', () => {
    expect(editPatch('placedOn', '2026-11-02', none, ['1 week'])).toEqual({ placed_on: '2026-11-02', expected_on: '2026-11-09' })
    expect(editPatch('expectedOn', null, { ...none, expectedOn: '2026-11-09' }, [])).toEqual({ expected_on: null })
  })
  it('remembers exactly what a patch overwrites, for Undo', () => {
    const d = { ...none, placedOn: '2026-11-01' }
    expect(before(d, { received_on: '2026-11-05', delivered_on: '2026-11-05' })).toEqual({ received_on: null, delivered_on: null })
    expect(before(d, { placed_on: 'x' })).toEqual({ placed_on: '2026-11-01' })
  })
  it('states', () => {
    const today = '2026-11-27'
    expect(legState(none, today)).toBe('to-place')
    expect(legState({ ...none, placedOn: '2026-11-01', expectedOn: '2026-11-28' }, today)).toBe('on-order')
    expect(legState({ ...none, placedOn: '2026-11-01', expectedOn: '2026-11-26' }, today)).toBe('late')
    expect(legState({ ...none, placedOn: '2026-11-01', expectedOn: '2026-11-26', receivedOn: '2026-11-26' }, today)).toBe('received')
    expect(legState({ placedOn: 'a', expectedOn: null, receivedOn: 'b', deliveredOn: 'c' }, today)).toBe('delivered')
  })
  it('totals a leg in its own currency and counts the unpriced goods lines', () => {
    expect(legSupplierTotal([{ qty: 6, supplierUnitPrice: 214, isService: false }, { qty: 4, supplierUnitPrice: 286.5, isService: false }, { qty: 1, supplierUnitPrice: null, isService: false }, { qty: 1, supplierUnitPrice: null, isService: true }])).toEqual({
      total: 2430,
      priced: 2,
      of: 3,
    })
  })
  it('letters legs A, B, ... Z, AA', () => {
    expect([0, 1, 25, 26, 27].map(legLetter)).toEqual(['A', 'B', 'Z', 'AA', 'AB'])
  })
})

describe('order arithmetic mirrors the view', () => {
  it('rounds GST to whole rupees per line', () => {
    expect(lineGstPaisa({ qty: 1, unitPriceNet: 450.5, gstRate: 18 })).toBe(8100)
    expect(orderTotals([{ qty: 6, unitPriceNet: 48500, gstRate: 18 }, { qty: 4, unitPriceNet: 62750, gstRate: 18 }])).toEqual({ net: 542000, gst: 97560, gross: 639560 })
  })
  it('exempt means every line at 0, and an empty order is not exempt', () => {
    expect(isExemptAll([{ gstRate: 0 }, { gstRate: 0 }])).toBe(true)
    expect(isExemptAll([{ gstRate: 0 }, { gstRate: 18 }])).toBe(false)
    expect(isExemptAll([])).toBe(false)
  })
})

describe('convert: supplier per line from the lowest comparable quote (O01)', () => {
  const items: ConvertItem[] = [
    { id: 'i1', description: 'Actuator', qty: 2, unit: 'ea', quotedUnitPriceNet: 1000 },
    { id: 'i2', description: 'Sensor', qty: 1, unit: 'ea', quotedUnitPriceNet: 500 },
    { id: 'i3', description: 'Cable', qty: 5, unit: 'ea', quotedUnitPriceNet: null },
    { id: 'i4', description: 'Odd', qty: 1, unit: null, quotedUnitPriceNet: 10 },
  ]
  const q = (lineId: string, itemId: string, supplierName: string, unitPrice: number, currency: string): ConvertQuote => ({ lineId, itemId, supplierName, unitPrice, currency })
  const rates = { USD: { rate: 280, ageDays: 1 }, EUR: { rate: 330, ageDays: 1 } }
  const quotes = [
    q('a1', 'i1', 'Alpenmark', 214, 'EUR'), // 70,620 PKR
    q('b1', 'i1', 'Dubai', 250, 'USD'), // 70,000 PKR: the lowest
    q('b2', 'i2', 'Dubai', 40, 'USD'),
    q('a4', 'i4', 'Alpenmark', 9, 'EUR'),
    q('c4', 'i4', 'Local', 8, 'XYZ'), // no rate: not comparable
  ]
  const choices = defaultChoices(items, quotes, rates)
  const by = (id: string) => choices.find(c => c.itemId === id)!

  it('picks the lowest at today rates and says so', () => {
    expect(by('i1')).toMatchObject({ choice: 'b1', fromLowest: true })
    expect(by('i1').options.find(o => o.value === 'b1')?.lowest).toBe(true)
  })
  it('a lone quote is taken; a line nobody quoted is not sourced; an uncomparable pair is left for the person', () => {
    expect(by('i2')).toMatchObject({ choice: 'b2', fromLowest: false })
    expect(by('i3').choice).toBe('none')
    expect(by('i4')).toMatchObject({ choice: 'none' })
  })
  it('every line may be changed to the other quotes or to a service', () => {
    expect(by('i1').options.map(o => o.value)).toEqual(['a1', 'b1', 'none', 'service'])
    expect(by('i2').options.map(o => o.value)).toEqual(['b2', 'service'])
  })
  it('builds the RPC payload: quote ids, the service flag, and typed prices only for unpriced lines', () => {
    const payload = buildPayload(items, { i1: 'a1', i2: 'service', i3: 'none', i4: 'none' }, { i3: 125, i1: 9999 })
    expect(payload).toEqual([
      { rfq_item_id: 'i1', quote_line_id: 'a1' },
      { rfq_item_id: 'i2', is_service: true },
      { rfq_item_id: 'i3', unit_price_net: 125 },
      { rfq_item_id: 'i4' },
    ])
  })
  it('a line without a selling price blocks until one above zero is typed', () => {
    expect(unpricedItems(items, {}).map(i => i.id)).toEqual(['i3'])
    expect(unpricedItems(items, { i3: 0 }).map(i => i.id)).toEqual(['i3'])
    expect(unpricedItems(items, { i3: 125 })).toEqual([])
  })
})

describe('cancel reasons are fixed keys (migration 0040)', () => {
  it('has exactly the keys the database accepts, each with a plain phrase', async () => {
    const { CANCEL_REASONS, cancelReasonLabel } = await import('@/features/orders/lib/cancel')
    expect(CANCEL_REASONS.map(r => r.value)).toEqual(['customer_cancelled', 'lost_to_competitor', 'supplier_cannot_supply', 'price_or_terms', 'duplicate_or_mistake', 'other'])
    expect(cancelReasonLabel('customer_cancelled')).toBe('The customer cancelled the PO')
    expect(cancelReasonLabel(null)).toBeNull()
    expect(cancelReasonLabel('something_old')).toBe('Another reason')
  })
})

describe('resolve price basis preview (admin, legacy orders)', () => {
  it('shows what each choice would do: prices include GST, or are before it', async () => {
    const { basisChoices } = await import('@/features/orders/lib/basis')
    const lines = [{ qty: 2, unitPriceNet: 590000, gstRate: 18 }]
    const c = basisChoices(lines, 640000)
    expect(c.net).toMatchObject({ net: 1180000, gst: 212400, gross: 1392400, margin: 540000 })
    expect(c.gross).toMatchObject({ net: 1000000, gst: 180000, gross: 1180000, margin: 360000 })
    expect(basisChoices(lines, null).net.margin).toBeNull()
  })
})

describe('expected date after a PO is issued (O07)', () => {
  it('counts the lead time from the day the leg was placed, not from the issue day, when the leg was placed before the PO', () => {
    // issue_purchase_order stamps placed_on only when it is empty: a leg marked placed on 1 Oct and given its PO on 19 Oct is still placed 1 Oct
    expect(expectedAfterIssue({ placedOn: '2026-10-01', expectedOn: null, leadTimes: ['2 weeks'] }, '2026-10-19')).toBe('2026-10-15')
  })
  it('counts from today when the issue is what places the leg', () => {
    expect(expectedAfterIssue({ placedOn: null, expectedOn: null, leadTimes: ['2 weeks'] }, '2026-10-19')).toBe('2026-11-02')
  })
  it('leaves an expected date that is already set, and suggests nothing without a lead time', () => {
    expect(expectedAfterIssue({ placedOn: null, expectedOn: '2026-12-01', leadTimes: ['2 weeks'] }, '2026-10-19')).toBeNull()
    expect(expectedAfterIssue({ placedOn: null, expectedOn: null, leadTimes: [] }, '2026-10-19')).toBeNull()
  })
})

describe('default expected date', () => {
  it('prefers the quoted lead time, then the supplier median, then 30 days', () => {
    expect(defaultExpected('2026-11-06', ['2 wks'], 18)).toMatchObject({ on: '2026-11-20', source: 'lead_time', label: 'from lead time 2 wks' })
    expect(defaultExpected('2026-11-06', ['ex-works, TBC'], 18)).toMatchObject({ on: '2026-11-24', source: 'supplier_median', label: 'this supplier usually takes 18 days' })
    expect(defaultExpected('2026-11-06', [], null)).toMatchObject({ on: '2026-12-06', source: 'fallback', days: 30 })
    expect(defaultExpected(null, ['2 wks'], 18)).toBeNull()
  })
  it('the supplier median needs two finished legs and ignores unfinished ones', () => {
    const leg = (a: string, b: string | null) => ({ placedOn: a, deliveredOn: b })
    expect(medianDeliveryDays([leg('2026-01-01', '2026-01-11')])).toBeNull()
    expect(medianDeliveryDays([leg('2026-01-01', '2026-01-11'), leg('2026-02-01', '2026-02-21'), leg('2026-03-01', null)])).toBe(15)
    expect(medianDeliveryDays([leg('2026-01-01', '2026-01-11'), leg('2026-02-01', '2026-02-21'), leg('2026-03-01', '2026-03-06')])).toBe(10)
  })
})

describe('commissioning guess for the convert toggle', () => {
  const ids = { 1: 'a', 2: 'b' }
  it('is on for a service line or a line that speaks of commissioning, and says why', () => {
    expect(guessCommissioning([{ number: 1, description: 'Flow meter' }, { number: 2, description: 'Loop check' }], { a: 'q1', b: 'service' }, ids)).toEqual({ needs: true, reason: 'line 2 is a service' })
    expect(guessCommissioning([{ number: 1, description: 'Flow meter' }, { number: 2, description: 'Installation and commissioning' }], { a: 'q1', b: 'q2' }, ids)).toEqual({ needs: true, reason: 'line 2 mentions commissioning or installation' })
  })
  it('is on for an item in an analyser or control-system family, and says which', () => {
    expect(guessCommissioning([{ number: 1, description: 'Hach HQ1110 meter', familyName: 'Process analysers' }], { a: 'q1' }, ids)).toEqual({ needs: true, reason: 'line 1 is in the Process analysers family' })
    expect(guessCommissioning([{ number: 1, description: 'Pressure transmitter', familyName: 'Pressure transmitters' }], { a: 'q1' }, ids)).toEqual({ needs: false, reason: null })
  })
  it('is off for plain goods', () => {
    expect(guessCommissioning([{ number: 1, description: 'Pressure transmitter 0 to 10 bar' }], { a: 'q1' }, ids)).toEqual({ needs: false, reason: null })
  })
})
