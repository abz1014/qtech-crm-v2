import { describe, expect, it } from 'vitest'
import { renderChecklist, runChecklist } from '../src/i06/checklist'
import type { LegacyDump } from '../src/types'
import { cloneDump, fixtureDump } from './support'

const items = runChecklist(fixtureDump())
const item = (n: number) => items.find(i => i.n === n)!

describe('the I06 checklist', () => {
  it('answers all 25 section 8 assumptions, each with a verdict and evidence', () => {
    expect(items.map(i => i.n)).toEqual(Array.from({ length: 25 }, (_, k) => k + 1))
    for (const i of items) {
      expect(['confirmed', 'adjusted', 'unknown']).toContain(i.verdict)
      expect(i.evidence.length).toBeGreaterThan(10)
    }
  })

  it('reads the fixture the way the data is built', () => {
    expect(item(2).verdict).toBe('adjusted') // garbage dates and a day-first one
    expect(item(2).evidence).toMatch(/unparseable/)
    expect(item(6).evidence).toMatch(/payment_received 6/)
    expect(item(7).verdict).toBe('adjusted') // supplier payments + Inventory/Procurement
    expect(item(9).evidence).toMatch(/11 rows, 7 linked/)
    expect(item(11).verdict).toBe('adjusted') // one receipt path is not in the listing
    expect(item(15).verdict).toBe('confirmed') // GST = round(amount x 18/118)
    expect(item(16).verdict).toBe('confirmed')
    expect(item(20).verdict).toBe('confirmed') // exactly two PO 000001 orders
    expect(item(20).evidence).toMatch(/2 order\(s\) carry PO 000001/)
    expect(item(21).evidence).toMatch(/2025 Q1/)
    expect(item(22).verdict).toBe('adjusted')
    expect(item(25).evidence).toMatch(/not PKR/)
  })

  it('says unknown, not confirmed, for what a dump cannot tell', () => {
    for (const n of [17, 18, 24]) expect(item(n).verdict).toBe('unknown')
    expect(item(13).verdict).toBe('unknown') // no auth catalog in the fixture
    expect(item(12).verdict).toBe('unknown') // no catalog
  })

  it('uses the catalog when the dump has one', () => {
    const d: LegacyDump = cloneDump(fixtureDump())
    d.meta['postgres'] = 'PostgreSQL 15.8 on x86_64'
    d.catalog = {
      counts: { follow_up_actions: 552 },
      details: {
        auth_providers: { email: 4 },
        triggers: [{ table: 'public.orders', name: 'trg_x' }],
        functions: ['current_user_role', 'mystery_fn'],
        columns: { orders: [{ column: 'confirmed_date', type: 'timestamp with time zone' }] },
      },
    }
    const r = runChecklist(d)
    const get = (n: number) => r.find(i => i.n === n)!
    expect(get(13).verdict).toBe('confirmed')
    expect(get(12).verdict).toBe('adjusted') // a trigger and a function to compare with the old repo
    expect(get(12).evidence).toMatch(/trg_x/)
    expect(get(17).evidence).toMatch(/PostgreSQL 15/)
    d.catalog.details!['auth_providers'] = { email: 3, google: 1 }
    expect(runChecklist(d).find(i => i.n === 13)!.verdict).toBe('adjusted')
  })

  it('flags a GST invoice that is not 18% and a PO 000001 that is not exactly two orders', () => {
    const d = cloneDump(fixtureDump())
    d.tables['gst_invoices']![0]!['gst_amount'] = 10000
    expect(runChecklist(d).find(i => i.n === 16)!.verdict).toBe('adjusted')
    d.tables['orders'] = d.tables['orders']!.filter(o => o['id'] !== d.tables['orders']!.find(x => x['customer_po_number'] === '000001')!['id'])
    expect(runChecklist(d).find(i => i.n === 20)!.verdict).toBe('adjusted')
  })

  it('does not fall over on an empty dump: everything it cannot read is unknown', () => {
    const r = runChecklist({ tables: {}, storage: [], meta: {} })
    expect(r).toHaveLength(25)
    expect(r.filter(i => i.verdict === 'confirmed').length).toBeLessThanOrEqual(3)
  })

  it('renders a readable report with the tally', () => {
    const text = renderChecklist(items)
    expect(text).toMatch(/\d+ confirmed, \d+ adjusted, \d+ unknown/)
    expect(text).toContain('[ADJUSTED] Text date columns')
  })
})
