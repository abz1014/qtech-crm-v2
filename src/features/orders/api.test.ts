import { afterEach, describe, expect, it } from 'vitest'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { convertRfqToOrder, existingOrderOf, getOrderHeader, listLegPos, listOrderItems, searchOrders } from '@/features/orders/api'

let uninstall: (() => void) | undefined
afterEach(() => uninstall?.())

const selects = (calls: FakeCall[], target: string) => calls.filter(c => c.target === target && c.verb === 'select').map(c => String(opArgs(c, 'select')?.[0] ?? ''))

describe('orders api: an engineer is never sent a price', () => {
  it('lists the lines without any price column, and with them for admin and sales', async () => {
    const db = installFakeDb(() => ({ data: [] }))
    uninstall = db.uninstall
    await listOrderItems('o1', false)
    await listOrderItems('o1', true)
    const [engineer, money] = selects(db.calls, 'order_items')
    expect(engineer).not.toMatch(/unit_price_net|gst_rate|supplier_unit_price/)
    expect(money).toMatch(/unit_price_net/)
    expect(money).toMatch(/gst_rate/)
    expect(money).toMatch(/supplier_unit_price/)
  })

  it('reads v_order_state without net, gst, gross or invoicing for an engineer', async () => {
    const db = installFakeDb(call => (call.target === 'orders' ? { data: { id: 'o1', number: 38, company_id: 'c1', needs_commissioning: false } } : { data: null }))
    uninstall = db.uninstall
    await getOrderHeader('o1', false)
    await getOrderHeader('o1', true)
    const [engineer, money] = selects(db.calls, 'v_order_state')
    expect(engineer).not.toMatch(/net|gst|gross|invoic/)
    expect(money).toMatch(/gross/)
    expect(money).toMatch(/invoicing_state/)
  })
})

describe('orders api: convert and search', () => {
  it('sends the client-made order id, only the PO and terms that were given, and returns the order id', async () => {
    const db = installFakeDb(() => ({ data: 'order-1' }))
    uninstall = db.uninstall
    const id = await convertRfqToOrder({ orderId: 'order-1', rfqId: 'r1', items: [{ rfq_item_id: 'i1' }], customerPo: null, paymentTermsDays: null })
    expect(id).toBe('order-1')
    const call = db.calls.find(c => c.target === 'rpc:convert_rfq_to_order') as FakeCall
    expect(opArgs(call, 'args')?.[0]).toEqual({ p_order_id: 'order-1', p_rfq_id: 'r1', p_items: [{ rfq_item_id: 'i1' }] })
    await convertRfqToOrder({ orderId: 'order-2', rfqId: 'r1', items: [], customerPo: 'PO-9', paymentTermsDays: 45 })
    const second = db.calls.filter(c => c.target === 'rpc:convert_rfq_to_order')[1]
    expect(opArgs(second, 'args')?.[0]).toMatchObject({ p_customer_po_number: 'PO-9', p_payment_terms_days: 45 })
  })

  it('returns the existing order when the RFQ was already won by someone else (0077)', async () => {
    const other = '0b6c1f2e-1111-4222-8333-444455556666'
    const db = installFakeDb(() => ({ data: null, error: { code: 'P0001', message: 'This RFQ is already order ORD-0038.', hint: `rfq_has_order:${other}` } }))
    uninstall = db.uninstall
    expect(await convertRfqToOrder({ orderId: 'order-3', rfqId: 'r1', items: [], customerPo: null, paymentTermsDays: null })).toBe(other)
    expect(existingOrderOf({ hint: 'something else' })).toBeNull()
  })

  it('finds an order by number and by customer PO, with the typed text escaped', async () => {
    const db = installFakeDb(() => ({ data: [{ id: 'o1', number: 38, customer_po_number: '253074', companies: { name: 'Punjab Cement' } }] }))
    uninstall = db.uninstall
    const hits = await searchOrders('ORD-0038')
    expect(hits).toEqual([{ id: 'o1', number: 38, customerPo: '253074', companyName: 'Punjab Cement' }])
    const filter = String(opArgs(db.calls[0], 'or')?.[0])
    expect(filter).toContain('number.eq.38')
    expect(filter).toContain('customer_po_number.ilike.%ORD-0038%')
    await searchOrders('50%_x')
    // an engineer: the number only, and the PO column is neither filtered nor selected
    await searchOrders('ORD-0038', undefined, 6, false)
    expect(String(opArgs(db.calls[2], 'or')?.[0])).toBe('number.eq.38')
    expect(String(opArgs(db.calls[2], 'select')?.[0])).not.toMatch(/po/)
    expect(await searchOrders('253074', undefined, 6, false)).toBeDefined()
    expect(String(opArgs(db.calls[1], 'or')?.[0])).toContain('50\\%\\_x')
    expect(String(opArgs(db.calls[1], 'or')?.[0])).not.toContain('number.eq')
  })
})

describe('orders api: the PO chip carries the year of the first issue', () => {
  it('listLegPos keeps revision 0\'s issue date for PO-YY-NNNN when a later revision crosses a year end', async () => {
    const db = installFakeDb(() => ({
      data: [
        { supplier_order_id: 'leg1', number: 17, revision: 1, issued_on: '2027-01-05', lines: [] },
        { supplier_order_id: 'leg1', number: 17, revision: 0, issued_on: '2026-12-28', lines: [] },
      ],
    }))
    uninstall = db.uninstall
    const [po] = await listLegPos(['leg1'], true)
    expect(po.revision).toBe(1)
    expect(po.issuedOn).toBe('2027-01-05')
    // the PDF prints poRef(number, first issue): the chip must say the same PO-26-0017
    expect(po.firstIssuedOn).toBe('2026-12-28')
  })
})
