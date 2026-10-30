import { afterEach, describe, expect, it } from 'vitest'
import { installFakeDb, opArgs, type FakeCall } from '@/test/fakeSupabase'
import { convertRfqToOrder, existingOrderOf, getOrderHeader, listLegPos, listOrderItems, ORDER_CHANGED, searchOrders, updateOrder } from '@/features/orders/api'

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

describe('orders api: the header in one round', () => {
  it('reads the customer, site, contact and owner embedded in the order, not in a second round (perf/lcp)', async () => {
    const order = { id: 'o1', number: 38, company_id: 'c1', site_id: 's1', contact_id: null, owner_id: 'u1', legacy_source: null, needs_commissioning: false }
    const db = installFakeDb(call =>
      call.target === 'orders' ? { data: { ...order, company: { name: 'Punjab Cement' }, site: { name: 'Plant 2', address: 'Wah' }, contact: null, owner: { id: 'u1', name: 'Asad' } } } : { data: null },
    )
    uninstall = db.uninstall
    const h = await getOrderHeader('o1', true)
    expect(db.calls.map(c => c.target).filter(t => ['companies', 'company_sites', 'contacts', 'users'].includes(t))).toEqual([])
    expect(h).toMatchObject({ companyName: 'Punjab Cement', site: { name: 'Plant 2', address: 'Wah' }, contact: null, owner: { id: 'u1', name: 'Asad' } })
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

describe('orders api: updateOrder is conditional on updated_at (optimistic locking)', () => {
  it('writes only if the row still has the updated_at the screen loaded', async () => {
    const db = installFakeDb(() => ({ data: [{ id: 'o1' }] }))
    uninstall = db.uninstall
    await updateOrder('o1', { notes: 'x' }, '2026-10-30T10:00:00.123456+00:00')
    const write = db.calls.find(c => c.verb === 'update') as FakeCall
    expect(write.ops).toContainEqual(['eq', ['id', 'o1']])
    expect(write.ops).toContainEqual(['eq', ['updated_at', '2026-10-30T10:00:00.123456+00:00']])
  })

  it('when someone else saved first nothing matches and a plain message says so', async () => {
    const db = installFakeDb(() => ({ data: [] }))
    uninstall = db.uninstall
    await expect(updateOrder('o1', { notes: 'x' }, 'T1')).rejects.toMatchObject({ message: ORDER_CHANGED, code: 'order_changed' })
    expect(ORDER_CHANGED).toBe('Someone else changed this order. Reload to see their changes.')
  })

  it('without a version (an undo) the write is unconditional', async () => {
    const db = installFakeDb(() => ({ data: null }))
    uninstall = db.uninstall
    await updateOrder('o1', { notes: 'x' })
    const write = db.calls.find(c => c.verb === 'update') as FakeCall
    expect(write.ops.some(([n, a]) => n === 'eq' && a[0] === 'updated_at')).toBe(false)
  })

  it('a database error is thrown as it is', async () => {
    const db = installFakeDb(() => ({ error: { message: 'boom' } }))
    uninstall = db.uninstall
    await expect(updateOrder('o1', { notes: 'x' }, 'T1')).rejects.toMatchObject({ message: 'boom' })
  })
})
