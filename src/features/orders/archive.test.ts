import { afterEach, describe, expect, it } from 'vitest'
import { installFakeDb, opArgs, type FakeCall, type FakeResult } from '@/test/fakeSupabase'
import { convertRfqToOrder, createRepeatOrder, friendlyDuplicatePo, getLastTerms, getNextOrderNumber, getPastOrder, getOrderHeader, listOrders, searchOrders, searchPastOrders, updateOrder } from '@/features/orders/api'

/*
 * Archive (migration 0141) in the orders api: LIST reads drop archived rows, NUMBER and DETAIL reads never do, an engineer never
 * touches `archived` on the orders table (42501), and a PO clash with an archived order gets its own sentence.
 */
let uninstall: (() => void) | undefined
afterEach(() => uninstall?.())

const hidesArchived = (c: FakeCall) => c.ops.some(([n, a]) => n === 'eq' && a[0] === 'archived' && a[1] === false)
const touchesArchived = (c: FakeCall) => c.ops.some(([, a]) => a[0] === 'archived' || (typeof a[0] === 'string' && /archived/.test(a[0] as string)))
const callsOn = (calls: FakeCall[], target: string) => calls.filter(c => c.target === target)

const listFake = (extra?: (c: FakeCall) => FakeResult | undefined) =>
  installFakeDb(c => {
    const own = extra?.(c)
    if (own) return own
    if (c.target === 'orders' && opArgs(c, 'select')?.[0] === 'id') return { data: [] }
    if (c.target === 'orders') return { data: [{ id: 'o1', number: 1, company_id: 'c1', companies: { name: 'A' } }, { id: 'o2', number: 2, company_id: 'c1', companies: { name: 'A' } }] }
    if (c.target === 'v_order_state') return { data: [{ order_id: 'o1', lifecycle: 'active' }] }
    return { data: [] }
  })

describe('orders api archive: list reads', () => {
  it('listOrders for admin and sales filters the orders and the state view', async () => {
    for (const role of ['admin', 'sales'] as const) {
      const db = listFake()
      uninstall = db.uninstall
      await listOrders(role)
      const main = callsOn(db.calls, 'orders').find(c => String(opArgs(c, 'select')?.[0]).includes('order_items'))!
      expect(hidesArchived(main)).toBe(true)
      expect(hidesArchived(callsOn(db.calls, 'v_order_state')[0])).toBe(true)
      uninstall()
    }
  })

  it('listOrders for an engineer never names `archived` on the orders table: it filters through v_order_state and cuts to it', async () => {
    const db = listFake()
    uninstall = db.uninstall
    const rows = await listOrders('engineer')
    for (const c of callsOn(db.calls, 'orders')) expect(touchesArchived(c)).toBe(false)
    expect(hidesArchived(callsOn(db.calls, 'v_order_state')[0])).toBe(true)
    expect(rows.map(r => r.id)).toEqual(['o1'])
  })

  it('searchOrders (admin and sales) filters on the table; an engineer filters through v_order_state', async () => {
    const db = installFakeDb(c => (c.target === 'orders' ? { data: [{ id: 'o1', number: 38, companies: { name: 'A' } }, { id: 'o2', number: 38, companies: { name: 'B' } }] } : { data: [{ order_id: 'o1' }] }))
    uninstall = db.uninstall
    await searchOrders('ORD-0038')
    expect(hidesArchived(db.calls[0])).toBe(true)
    const hits = await searchOrders('ORD-0038', undefined, 6, false)
    const eng = callsOn(db.calls, 'orders')[1]
    expect(touchesArchived(eng)).toBe(false)
    expect(hidesArchived(callsOn(db.calls, 'v_order_state')[0])).toBe(true)
    expect(hits.map(h => h.id)).toEqual(['o1'])
  })

  it('searchPastOrders (the repeat-order picker) filters archived orders, with or without text', async () => {
    const db = installFakeDb(() => ({ data: [] }))
    uninstall = db.uninstall
    await searchPastOrders('')
    await searchPastOrders('pump')
    for (const c of callsOn(db.calls, 'orders')) expect(hidesArchived(c)).toBe(true)
  })
})

describe('orders api archive: number and detail reads are never filtered', () => {
  it('getNextOrderNumber and getLastTerms (numbers and defaults) ignore the archive', async () => {
    const db = installFakeDb(() => ({ data: [{ number: 9, payment_terms_days: 30 }] }))
    uninstall = db.uninstall
    await getNextOrderNumber()
    await getLastTerms('c1')
    expect(db.calls.some(touchesArchived)).toBe(false)
  })

  it('getOrderHeader and getPastOrder (one record) ignore the archive, so an archived order still opens', async () => {
    const db = installFakeDb(() => ({ data: [{ id: 'o1', number: 1, company_id: 'c1', needs_commissioning: false }] }))
    uninstall = db.uninstall
    await getOrderHeader('o1', true).catch(() => null)
    await getPastOrder('o1')
    expect(db.calls.some(touchesArchived)).toBe(false)
  })
})

describe('orders api archive: a customer PO held by an archived order', () => {
  const clash = (hint: string | null = 'po_has_order:11111111-1111-1111-1111-111111111111') => ({
    code: '23505',
    message: 'PO 4500 is already on order ORD-0042. Open that order instead of adding a second.',
    hint,
  })

  it('says so, naming the order and the way out, when the clashing order is archived (looked up without the filter)', async () => {
    const db = installFakeDb(c => (c.target === 'orders' ? { data: [{ number: 42, archived: true }] } : { data: null, error: clash() }))
    uninstall = db.uninstall
    await expect(convertRfqToOrder({ orderId: 'o9', rfqId: 'r1', items: [], customerPo: '4500', paymentTermsDays: null })).rejects.toMatchObject({
      message: 'PO 4500 already exists on ORD-0042 (in Archive). Unarchive it or use another PO number.',
    })
    const lookup = callsOn(db.calls, 'orders')[0]
    expect(hidesArchived(lookup)).toBe(false)
    expect(lookup.ops).toContainEqual(['eq', ['id', '11111111-1111-1111-1111-111111111111']])
  })

  it('keeps the existing error for a visible order, another error code, and a failed lookup', async () => {
    const visible = installFakeDb(c => (c.target === 'orders' ? { data: [{ number: 42, archived: false }] } : { data: null, error: clash() }))
    uninstall = visible.uninstall
    await expect(createRepeatOrder({ orderId: 'o9', fromOrderId: 'o1', customerPo: '4500', orderedOn: null })).rejects.toMatchObject({ code: '23505', message: expect.stringContaining('Open that order') })
    uninstall()
    const other = { code: '23503', message: 'PO 4500 is already on order ORD-0042.' }
    expect(await friendlyDuplicatePo(other)).toBe(other)
    const failing = installFakeDb(() => ({ data: null, error: { code: '42501', message: 'denied' } }))
    uninstall = failing.uninstall
    const err = clash()
    expect(await friendlyDuplicatePo(err)).toBe(err)
  })

  it('maps an edit of the PO too, and falls back to the order number when there is no hint', async () => {
    const db = installFakeDb(c => (c.target === 'orders' && c.verb === 'select' ? { data: [{ number: 42, archived: true }] } : { data: null, error: clash(null) }))
    uninstall = db.uninstall
    await expect(updateOrder('o1', { customer_po_number: '4500' })).rejects.toMatchObject({ message: expect.stringContaining('(in Archive)') })
    const lookup = db.calls.find(c => c.verb === 'select')!
    expect(lookup.ops).toContainEqual(['eq', ['number', 42]])
  })
})
