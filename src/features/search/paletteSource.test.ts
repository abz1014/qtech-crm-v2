import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchHit } from '@/features/search/api'

const searchAll = vi.fn<(text: string, signal?: AbortSignal) => Promise<SearchHit[]>>()
vi.mock('@/features/search/api', () => ({ searchAll: (t: string, s?: AbortSignal) => searchAll(t, s) }))
vi.mock('@/app/palette/usePalette', () => ({ usePaletteSource: () => undefined }))

import { kindOrder, searchPaletteSource } from '@/features/search/paletteSource'

const hit = (kind: SearchHit['kind'], id: string, label: string, extra: Partial<SearchHit> = {}): SearchHit => ({
  kind, id, label, meta: null, companyId: null, orderId: null, role: null, score: 1, ...extra,
})

describe('search palette source (R12)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    searchAll.mockReset()
  })
  afterEach(() => vi.useRealTimers())

  it('waits for the keystroke burst to end, then makes exactly one request', async () => {
    searchAll.mockResolvedValue([])
    const src = searchPaletteSource(150)
    const ctls = ['i', 'in', 'ind', 'indu'].map(() => new AbortController())
    const runs = ['i', 'in', 'ind', 'indu'].map((q, i) => src.search!(q, ctls[i].signal))
    // each keystroke cancels the one before it, as the palette does
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(40)
      ctls[i].abort()
    }
    await vi.advanceTimersByTimeAsync(200)
    await Promise.all(runs)
    expect(searchAll).toHaveBeenCalledTimes(1)
    expect(searchAll.mock.calls[0][0]).toBe('indu')
  })

  it('a request that is replaced while in flight returns nothing', async () => {
    let release: (h: SearchHit[]) => void = () => undefined
    searchAll.mockReturnValue(new Promise(r => (release = r)))
    const ctl = new AbortController()
    const run = searchPaletteSource(10).search!('abc', ctl.signal)
    await vi.advanceTimersByTimeAsync(20)
    ctl.abort()
    release([hit('company', '1', 'Abc Ltd')])
    expect(await run).toEqual([])
  })

  it('groups companies, contacts and RFQs, contacts open their company, and a name not on file offers to add it', async () => {
    searchAll.mockResolvedValue([
      hit('rfq', 'r1', 'RFQ-0042 Abc Ltd', { meta: 'Open' }),
      hit('contact', 'k1', 'Abid Khan', { companyId: 'c1', meta: 'Abc Ltd · +92 300 1' }),
      hit('company', 'c1', 'Abc Ltd', { role: 'customer', meta: 'Pakistan' }),
    ])
    const p = searchPaletteSource(0).search!('ab', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5)
    const items = await p
    expect(items.map(i => [i.group, i.label])).toEqual([
      ['Companies', 'Abc Ltd'],
      ['Contacts', 'Abid Khan'],
      ['RFQs', 'RFQ-0042 Abc Ltd'],
      ['Actions', 'New RFQ for Abc Ltd'],
      ['Actions', 'Add “ab” as a new company'],
    ])
    expect(items[0]).toMatchObject({ href: '/companies/c1', meta: 'Customer · Pakistan' })
    expect(items[1].href).toBe('/companies/c1')
    expect(items[2].href).toBe('/rfqs/r1')
    expect(items[3]).toMatchObject({ href: '/rfqs/new?company=c1', meta: 'Go to intake' })
  })

  it('an RFQ number puts RFQs first', async () => {
    searchAll.mockResolvedValue([hit('company', 'c1', 'Co 42'), hit('rfq', 'r1', 'RFQ-0042 Co')])
    const p = searchPaletteSource(0).search!('RFQ-0042', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5)
    expect((await p).map(i => i.group)[0]).toBe('RFQs')
  })

  it('no company match means no New RFQ for action', async () => {
    searchAll.mockResolvedValue([hit('rfq', 'r1', 'RFQ-0042 Co')])
    const p = searchPaletteSource(0).search!('zzz', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5)
    expect((await p).some(i => i.label.startsWith('New RFQ for'))).toBe(false)
  })

  it('an exact company name does not offer to add it again', async () => {
    searchAll.mockResolvedValue([hit('company', 'c1', 'Abc Ltd')])
    const p = searchPaletteSource(0).search!('abc ltd', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5)
    expect((await p).some(i => i.id === 'company-new-typed')).toBe(false)
  })

  it('P02: orders, items, supplier POs and invoices open the order, the order, the order and the invoice', async () => {
    searchAll.mockResolvedValue([
      hit('invoice', 'v1', 'INV-2311', { meta: 'Hazara · ORD-0041', orderId: 'o1' }),
      hit('item', 'i1', 'Siemens 6ES7', { meta: 'ORD-0041 · Hazara', orderId: 'o1' }),
      hit('po', 'p1', 'PO-26-0017 Belimo', { orderId: 'o1' }),
      hit('order', 'o1', 'ORD-0041 Hazara', { meta: 'Customer PO 253074', orderId: 'o1' }),
    ])
    const p = searchPaletteSource(0).search!('zz1', new AbortController().signal)
    await vi.advanceTimersByTimeAsync(5)
    const items = (await p).filter(i => i.group !== 'Actions')
    expect(items.map(i => [i.group, i.href])).toEqual([
      ['Orders', '/orders/o1'],
      ['Invoices', '/money/gst-register?invoice=v1'],
      ['Purchase orders', '/orders/o1'],
      ['Order items', '/orders/o1'],
    ])
  })

  it('P02: a typed prefix puts what it names first', () => {
    expect(kindOrder('PO-26-0017')[0]).toBe('po')
    expect(kindOrder('po 17')[0]).toBe('po')
    expect(kindOrder('ORD-0041')[0]).toBe('order')
    expect(kindOrder('inv-23')[0]).toBe('invoice')
    expect(kindOrder('177').slice(0, 2)).toEqual(['rfq', 'order'])
    expect(kindOrder('indus')[0]).toBe('company')
    expect(new Set(kindOrder('x')).size).toBe(7)
  })
})
