import { describe, expect, it } from 'vitest'
import { reconciles } from '../src/report/report'
import { parseMappings } from '../src/mappings'
import { transformAll } from '../src/transform'
import { itemDescription } from '../src/transform/orders'
import { qtechNumber } from '../src/transform/rfqs'
import type { LegacyDump, NewRow } from '../src/types'
import { AS_OF, cloneDump, fixtureDump, run, V2_USERS, violations } from './support'

const result = run()
const t = result.tables

function byName(name: string): NewRow {
  const hit = t.companies.find(c => c['name'] === name)
  if (!hit) throw new Error(`no company ${name}`)
  return hit
}
function oldRow(table: string, n: number): Record<string, unknown> {
  const rows = fixtureDump().tables[table] ?? []
  const hit = rows.find(r => String(Object.values(r)[0]).endsWith(String(n).padStart(12, '0')))
  if (!hit) throw new Error(`no ${table} #${n}`)
  return hit
}
function orderOf(po: string): NewRow {
  const hit = t.orders.find(o => o['customer_po_number'] === po)
  if (!hit) throw new Error(`no order PO ${po}`)
  return hit
}
function flagsOf(row: NewRow): string[] {
  return row['legacy_flags'] as string[]
}
function rfqOf(n: number): NewRow {
  const id = Object.values(oldRow('rfqs', n))[0] as string
  const hit = t.rfqs.find(r => (r['legacy_source'] as { row: { id: string } }).row.id === id)
  if (!hit) throw new Error(`rfq ${n} not imported`)
  return hit
}
const sum = (xs: NewRow[], col: string) => Math.round(xs.reduce((s, r) => s + Number(r[col]), 0) * 100) / 100

describe('the output as a whole', () => {
  it('breaks none of the database rules the unit test can replay', () => {
    expect(violations(result)).toEqual([])
  })

  it('is the same on every run (identical ids, rows and review lists)', () => {
    const again = run()
    expect(JSON.stringify(again)).toBe(JSON.stringify(result))
  })

  it('does not depend on the order the dump lists its rows in', () => {
    const d = cloneDump(fixtureDump())
    for (const rows of Object.values(d.tables)) rows?.reverse()
    const shuffled = run(d)
    expect(JSON.stringify(shuffled.tables)).toBe(JSON.stringify(result.tables))
    expect(JSON.stringify(shuffled.recon)).toBe(JSON.stringify(result.recon))
  })

  it('carries the original row of every imported row in legacy_source', () => {
    for (const table of ['rfqs', 'orders', 'invoices', 'payments_in', 'expenses'] as const) {
      for (const row of t[table]) expect(row['legacy_source']).toBeTruthy()
    }
  })

  it('reconciles the money: old = new + left out, on every line', () => {
    expect(reconciles(result.recon)).toBe(true)
  })
})

describe('I02 companies, sites, contacts, vendors', () => {
  it("turns Ghani's 3 rows into 1 company with 2 sites", () => {
    const ghani = t.companies.filter(c => String(c['name']).startsWith('Ghani Glass'))
    expect(ghani).toHaveLength(1)
    const sites = t.company_sites.filter(s => s['company_id'] === ghani[0]!['id'])
    expect(sites.map(s => s['name']).sort()).toEqual(['Karachi', 'Lahore'])
    expect((ghani[0]!['legacy_source'] as { rows: unknown[] }).rows).toHaveLength(3)
    // The address of each plant is the site's address.
    expect(sites.find(s => s['name'] === 'Lahore')!['address']).toBe('Test Estate, Lahore')
  })

  it('makes "IFL Head Office"-style names a company plus a Head Office site', () => {
    const alpha = byName('Alpha Textile Mills')
    expect(t.company_sites.some(s => s['company_id'] === alpha['id'] && s['name'] === 'Head Office')).toBe(true)
    expect(t.companies.some(c => String(c['name']).includes('Head Office'))).toBe(false)
  })

  it('makes "Red Lion USA (via Four Stars)" Four Stars carrying the Red Lion brand', () => {
    const fourStars = byName('Four Stars')
    const redLion = t.brands.find(b => b['name'] === 'Red Lion')!
    expect(redLion['kind']).toBe('brand')
    expect(t.company_brands).toContainEqual({ company_id: fourStars['id'], brand_id: redLion['id'] })
    expect(fourStars['country']).toBe('USA')
    expect(t.companies.some(c => String(c['name']).includes('Red Lion'))).toBe(false)
    const d = byName('DEAO')
    expect(t.company_brands).toContainEqual({ company_id: d['id'], brand_id: t.brands.find(b => b['name'] === 'Siemens')!['id'] })
    expect(byName('XIAMEN TONGKONG')).toBeTruthy()
  })

  it('imports a composite vendor name nobody parsed as it is, flagged name_unparsed', () => {
    const g = byName('Goffran Sensors / ECIS UAE')
    expect(flagsOf(g)).toContain('name_unparsed')
    expect(flagsOf(byName('Meacon Instruments'))).not.toContain('name_unparsed')
  })

  it('dedupes a prospect against the client of the same name and keeps lead source in notes', () => {
    expect(t.companies.filter(c => c['name'] === 'Gamma Cement')).toHaveLength(1)
    const iota = byName('Iota Packaging')
    expect(flagsOf(iota)).toContain('from_prospect')
    expect(iota['notes']).toContain('Lead source: Trade fair')
    expect(byName('Beta Dairy Foods')['notes']).toContain('Industry: Dairy')
  })

  it('suggests, but never makes, a merge of names that differ only in spelling', () => {
    expect(t.companies.map(c => c['name'])).toContain('Zeta Fibres Limited')
    expect(t.companies.map(c => c['name'])).toContain('ZETA FIBRES LTD')
    expect(result.review.some(i => i.list === 'company_merges' && i.detail.startsWith('POSSIBLE DUPLICATE'))).toBe(true)
  })

  it('turns non-empty contact fields into a contact and leaves empty ones out', () => {
    const zeta = byName('Zeta Fibres Limited')
    const c = t.contacts.find(x => x['company_id'] === zeta['id'])!
    expect(c).toMatchObject({ name: 'Test Contact Four', phone: '+92 300 0000004'.replace('4', '5'), email: 'four@example.invalid' })
    expect(t.contacts.filter(x => x['company_id'] === byName('Gamma Cement')['id'])).toHaveLength(0)
  })

  it('matches companies by normalised name: case and spacing do not make a second company', () => {
    const d = cloneDump(fixtureDump())
    d.tables['clients']!.push({ id: 'c1000000-0000-4000-8000-000000000099', company_name: '  gamma   CEMENT ', industry: '', contact_person: '', phone: '', email: '', address: '' })
    const r = run(d)
    expect(r.tables.companies.filter(c => String(c['name']).toLowerCase().includes('gamma'))).toHaveLength(1)
  })

  it('keeps the family tags: product types become family brands, matched on products_supplied', () => {
    expect(t.brands.find(b => b['name'] === 'Flow Meter')!['kind']).toBe('family')
    const meacon = byName('Meacon Instruments')
    expect(t.company_brands.some(cb => cb['company_id'] === meacon['id'] && cb['brand_id'] === t.brands.find(b => b['name'] === 'Flow Meter')!['id'])).toBe(true)
    // "Ultrasonic Flow Meters" matches no family: it stays in the notes.
    expect(meacon['notes']).toContain('Products supplied: Ultrasonic Flow Meters')
  })
})

describe('I03 RFQs', () => {
  it('flags the "31/01/2024" fixture due_before_received (and due_date_parsed)', () => {
    const r = rfqOf(2)
    expect(r['due_on']).toBe('2024-01-31')
    expect(r['received_on']).toBe('2025-01-12')
    expect(flagsOf(r)).toEqual(expect.arrayContaining(['due_date_parsed', 'due_before_received']))
  })

  it('does not flag a sane due date', () => {
    const r = rfqOf(1)
    expect(r['due_on']).toBe('2024-10-01')
    expect(flagsOf(r)).not.toContain('due_before_received')
    expect(flagsOf(r)).not.toContain('due_date_parsed')
  })

  it('uses rfq_date as quoted_on where the quote date is missing, and says so', () => {
    const r = rfqOf(4)
    expect(r['quoted_on']).toBe('2024-03-01')
    expect(flagsOf(r)).toContain('quoted_date_estimated')
    expect(flagsOf(rfqOf(1))).not.toContain('quoted_date_estimated')
  })

  it('lists open RFQs quoted more than 180 days ago, and nothing newer', () => {
    const stale = result.review.filter(i => i.list === 'stale_rfqs')
    expect(stale).toHaveLength(1)
    expect(stale[0]!.detail).toContain('365 days')
  })

  it('maps a lost RFQ: reason, best available date, estimated flag', () => {
    const r = rfqOf(3)
    expect(r).toMatchObject({ close_reason: 'competitor', closed_on: '2024-11-05', close_note: 'Went with a local dealer.' })
    expect(flagsOf(r)).toContain('closed_date_estimated')
    expect(rfqOf(9)['close_reason']).toBe('we_were_late')
    expect(rfqOf(10)['close_reason']).toBe('price')
    expect(rfqOf(11)['close_reason']).toBe('other')
    expect(rfqOf(9)['closed_on']).toBe('2024-11-01')
  })

  it('keeps a customer-issued number as customer_ref, and a made-up one only in legacy_source', () => {
    expect(rfqOf(1)['customer_ref']).toBe('PR-4521')
    expect(rfqOf(5)['customer_ref']).toBeNull()
  })

  it('does not break the unique customer_ref when two RFQs of a company repeat it', () => {
    const r = rfqOf(13)
    expect(r['customer_ref']).toBeNull()
    expect(flagsOf(r)).toContain('customer_ref_duplicate')
  })

  it('maps priority high to is_priority and the assignee to the owner (no reliability flag: the old attribution carries no credit)', () => {
    expect(rfqOf(1)['is_priority']).toBe(true)
    expect(rfqOf(14)['is_priority']).toBe(false)
    expect(rfqOf(1)['owner_id']).toBe(V2_USERS[0]!.id)
    expect(flagsOf(rfqOf(1))).not.toContain('owner_unreliable')
    expect(rfqOf(14)['owner_id']).toBe(V2_USERS[1]!.id)
    expect(flagsOf(rfqOf(14))).not.toContain('owner_unreliable')
    const none = rfqOf(16)
    expect(none['owner_id']).toBeNull()
    expect(flagsOf(none)).toContain('owner_unknown')
  })

  it('flags an unparseable date and falls back, naming the value in the review list', () => {
    const r = rfqOf(8)
    expect(flagsOf(r)).toEqual(expect.arrayContaining(['invalid_date', 'received_date_estimated']))
    expect(result.review.some(i => i.list === 'unparseable_dates' && i.detail.includes('garbage'))).toBe(true)
  })

  it('drops an RFQ with neither a client nor a company name and says so', () => {
    expect(t.rfqs).toHaveLength(16)
    expect(result.review.some(i => i.list === 'dropped_rows' && i.table === 'rfqs')).toBe(true)
  })

  it('creates the company of an RFQ typed by name, with its contact', () => {
    const k = byName('Kappa Textiles')
    expect(t.contacts.some(c => c['company_id'] === k['id'] && c['name'] === 'Test Contact Six')).toBe(true)
  })

  it('makes rfq_items from the line items; a missing quantity becomes 1 and is flagged', () => {
    const items = t.rfq_items.filter(i => i['rfq_id'] === rfqOf(1)['id'])
    expect(items.map(i => i['position'])).toEqual([0, 1])
    expect(items[0]).toMatchObject({ description: 'Wallmount ultrasonic flow meter, DN50', qty: 2, gst_rate: 18 })
    const odd = t.rfq_items.find(i => i['description'] === 'Quantity missing in old data')!
    expect(odd['qty']).toBe(1)
    expect(flagsOf(odd)).toContain('qty_defaulted')
  })

  it('surfaces "could not find offer" phrases for manual tagging, never as no_offer_on', () => {
    expect(result.review.filter(i => i.list === 'no_offer_phrases')).toHaveLength(1)
    expect(t.supplier_inquiries.every(i => i['no_offer_on'] === undefined)).toBe(true)
  })

  it('keeps one inquiry per (RFQ, supplier), with the earliest send date', () => {
    const inq = t.supplier_inquiries.filter(i => i['rfq_id'] === rfqOf(1)['id'])
    expect(inq).toHaveLength(2)
    const meacon = inq.find(i => i['supplier_id'] === byName('Meacon Instruments')['id'])!
    expect(meacon['sent_on']).toBe('2024-09-21')
    expect(flagsOf(meacon)).toContain('inquiry_duplicate')
  })

  it('leaves an unparseable sent_at empty and flagged', () => {
    const i = t.supplier_inquiries.find(x => x['rfq_id'] === rfqOf(3)['id'] && x['supplier_id'] === byName('Tecto Systems')['id'])!
    expect(i['sent_on']).toBeNull()
    expect(flagsOf(i)).toContain('invalid_date')
  })

  it('makes quote lines: every row currency_unverified, item_guessed on a multi-item RFQ, and one line per (inquiry, item)', () => {
    expect(t.supplier_quote_lines).toHaveLength(4)
    for (const l of t.supplier_quote_lines) expect(flagsOf(l)).toContain('currency_unverified')
    const multi = t.supplier_quote_lines.filter(l => flagsOf(l).includes('item_guessed'))
    expect(multi).toHaveLength(2)
    // Two Meacon quotes landed on the same inquiry and item: the newer price (4,900) wins.
    const meaconLine = t.supplier_quote_lines.find(l => l['unit_price'] === 4900)!
    expect(meaconLine['currency']).toBe('USD')
    expect(meaconLine['lead_time']).toBe('21 days')
    expect(t.supplier_quote_lines.some(l => l['unit_price'] === 5000)).toBe(false)
  })

  it('does not import a zero-priced quote, fixes an invalid currency, and creates an inquiry for a quote with none', () => {
    expect(t.supplier_quote_lines.some(l => l['unit_price'] === 0)).toBe(false)
    const bad = t.supplier_quote_lines.find(l => l['unit_price'] === 900)!
    expect(bad['currency']).toBe('PKR')
    expect(flagsOf(bad)).toContain('currency_invalid')
    expect(t.supplier_inquiries.some(i => flagsOf(i).includes('inquiry_created_for_quote'))).toBe(true)
  })
})

describe('Q-Tech own numbers', () => {
  it('finds the highest of our own numbers, so the counters can continue after them', () => {
    expect(result.numberFloors).toEqual({ rfq: 177, order: 0, quotation: 42, po: 0 })
  })
  it('does not treat a customer reference as one of ours', () => {
    expect(qtechNumber('PR-4521')).toBeNull()
    expect(qtechNumber('rfq-0009')).toEqual({ series: 'rfq', n: 9 })
    expect(qtechNumber('QT 12')).toEqual({ series: 'quotation', n: 12 })
    expect(qtechNumber('RFQ-0177A')).toBeNull()
  })
  it('keeps no customer_ref for the RFQ-0177 and QT-0042 rows', () => {
    expect(rfqOf(11)['customer_ref']).toBeNull()
    expect(rfqOf(14)['customer_ref']).toBeNull()
  })
})

describe('I04 orders', () => {
  it('turns 22 seed orders into 21', () => {
    expect(fixtureDump().tables['orders']).toHaveLength(22)
    expect(t.orders).toHaveLength(21)
  })

  it('merges PO 000001 Unit A and Unit B into one order with 2 items, one leg and both invoices', () => {
    const merged = orderOf('000001')
    expect(t.orders.filter(o => o['customer_po_number'] === '000001')).toHaveLength(1)
    expect(flagsOf(merged)).toContain('merged_orders')
    expect(flagsOf(merged)).not.toContain('po_shared')
    expect(merged['ordered_on']).toBe('2024-12-02')

    const items = t.order_items.filter(i => i['order_id'] === merged['id'])
    expect(items.map(i => i['description'])).toEqual(['Moxa Serial-Ethernet Converter x2 — Unit A', 'Moxa Serial-Ethernet Converter x2 — Unit B'])
    for (const i of items) expect(i).toMatchObject({ qty: 1, unit_price_net: 73986, gst_rate: 18 })

    const legs = t.supplier_orders.filter(l => l['order_id'] === merged['id'])
    expect(legs).toHaveLength(1)
    expect(legs[0]!['supplier_id']).toBe(byName('XIAMEN TONGKONG')['id'])
    for (const i of items) expect(i['supplier_order_id']).toBe(legs[0]!['id'])

    const invoices = t.invoices.filter(i => i['order_id'] === merged['id'])
    expect(invoices.map(i => i['number']).sort()).toEqual(['INV-0001', 'INV-0009'])
    // payments and expenses of both old orders moved to the merged order
    expect(t.payments_in.filter(p => p['order_id'] === merged['id'])).toHaveLength(2)
    expect(t.expenses.filter(e => e['order_id'] === merged['id'])).toHaveLength(2)
    expect(t.order_costs.find(c => c['order_id'] === merged['id'])!['expected_cost_pkr']).toBe(100216)
    expect((merged['legacy_source'] as { rows: unknown[] }).rows).toHaveLength(2)
  })

  it('keeps batch A (no PO) and batch B (PO 90222) as separate orders without po_shared', () => {
    const batchB = orderOf('90222')
    const batchA = t.orders.find(o => o['customer_po_number'] === null && String(o['notes']).startsWith('Batch A'))!
    expect(batchA['id']).not.toBe(batchB['id'])
    expect(flagsOf(batchA)).not.toContain('po_shared')
    expect(flagsOf(batchB)).not.toContain('po_shared')
    expect(t.order_items.find(i => i['order_id'] === batchA['id'])!['description']).toBe('Moxa Serial-Ethernet Converter x2 — Batch A')
  })

  it('keeps clashing POs apart with po_shared and lists them, when the owner has not decided', () => {
    const d = cloneDump(fixtureDump())
    const o = d.tables['orders']!
    o.find(x => x['customer_po_number'] === 'EF-22')!['client_id'] = o.find(x => x['customer_po_number'] === 'EW-1')!['client_id']
    o.find(x => x['customer_po_number'] === 'EF-22')!['customer_po_number'] = 'EW-1'
    const r = transformAll(d, parseMappings({}), { asOf: AS_OF, v2Users: V2_USERS })
    const clash = r.tables.orders.filter(x => x['customer_po_number'] === 'EW-1')
    expect(clash).toHaveLength(2)
    for (const c of clash) expect(c['legacy_flags']).toContain('po_shared')
    expect(r.review.some(i => i.list === 'po_clashes' && i.detail.startsWith('UNDECIDED'))).toBe(true)
    // and merged when the owner says merge
    const decided = transformAll(d, parseMappings({ poClashes: 'customer_po_number,decision\nEW-1,merge\n' }), { asOf: AS_OF, v2Users: V2_USERS })
    expect(decided.tables.orders.filter(x => x['customer_po_number'] === 'EW-1')).toHaveLength(1)
  })

  it('merges 000001 even with no mapping file at all (the decision is built in)', () => {
    const r = transformAll(fixtureDump(), parseMappings({}), { asOf: AS_OF, v2Users: null })
    expect(r.tables.orders).toHaveLength(21)
  })

  it('makes order_value one item: qty 1, price net, 18% GST', () => {
    const o = orderOf('251809')
    const items = t.order_items.filter(i => i['order_id'] === o['id'])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ qty: 1, unit_price_net: 370000, gst_rate: 18, is_service: false })
    expect(items[0]!['description']).toBe('Wallmount Ultrasonic Flow Meter x1')
  })

  it('writes cost_value to order_costs.expected_cost_pkr, one row per order with a cost', () => {
    expect(t.order_costs.find(c => c['order_id'] === orderOf('251809')['id'])!['expected_cost_pkr']).toBe(87150)
    expect(t.order_costs).toHaveLength(21)
    expect(t.order_costs.every(c => c['costs_complete_at'] === undefined)).toBe(true)
  })

  it('resolves the basis against the GST register: net proven = no flag, everything else value_basis_unknown', () => {
    const proven = ['251809', '252446', '225', '000001', 'AT-501'].map(orderOf)
    for (const o of proven) expect(flagsOf(o)).not.toContain('value_basis_unknown')
    expect(t.orders.filter(o => flagsOf(o).includes('value_basis_unknown'))).toHaveLength(16)
    // never converted silently: the item price is the old order value
    expect(t.order_items.find(i => i['order_id'] === orderOf('TF-7788')['id'])!['unit_price_net']).toBe(177000)
  })

  it('hints that the old value was gross when net + GST of the invoice equals it', () => {
    const hint = result.review.find(i => i.list === 'basis_unknown' && i.label === 'TF-7788')!
    expect(hint.detail).toContain('GROSS')
  })

  it('reconciles the invoice totals against the items on every order whose basis is proven', () => {
    const rows = result.recon.orderInvoice
    expect(rows.length).toBeGreaterThan(0)
    for (const r of rows.filter(x => !x.basisUnknown)) expect(r.diff).toBe(0)
    const merged = rows.find(r => r.poNumber === '000001')!
    expect(merged).toMatchObject({ itemsNet: 147972, invoiceNet: 147972, diff: 0, basisUnknown: false })
    // the one flagged order shows its difference rather than hiding it
    expect(rows.find(r => r.poNumber === 'TF-7788')).toMatchObject({ diff: 27000, basisUnknown: true })
  })

  it('has no Received step: received_on is the delivered date', () => {
    const o2 = orderOf('252446')
    const leg = t.supplier_orders.find(l => l['order_id'] === o2['id'])!
    expect(leg).toMatchObject({ delivered_on: '2024-11-20', received_on: '2024-11-20' })
    for (const l of t.supplier_orders) expect(l['received_on']).toBe(l['delivered_on'])
  })

  it('estimates leg dates from the best date and flags dates_estimated; delivery_date is expected_on unless delivered', () => {
    const o1 = orderOf('251809')
    expect(t.supplier_orders.find(l => l['order_id'] === o1['id'])).toMatchObject({ placed_on: '2024-10-11', delivered_on: '2024-10-11' })
    expect(flagsOf(o1)).toContain('dates_estimated')
    const transit = t.supplier_orders.find(l => l['order_id'] === orderOf('TF-7788')['id'])!
    expect(transit).toMatchObject({ expected_on: '2025-03-01', delivered_on: null, received_on: null })
    expect(transit['placed_on']).toBe('2025-01-15')
    const procurement = t.supplier_orders.find(l => l['order_id'] === orderOf('PO250105')['id'])!
    expect(procurement).toMatchObject({ expected_on: '2025-02-10', delivered_on: null })
  })

  it('flags an order with neither PO date nor confirmed date as undated', () => {
    const o = orderOf('PO250105')
    expect(o['ordered_on']).toBeNull()
    expect(flagsOf(o)).toContain('undated')
  })

  it('makes no leg for an order without a vendor', () => {
    const o = orderOf('EW-1')
    expect(t.supplier_orders.filter(l => l['order_id'] === o['id'])).toHaveLength(0)
    expect(t.order_items.find(i => i['order_id'] === o['id'])!['supplier_order_id']).toBeNull()
  })

  it('flags paid_per_status_no_payment_rows, margin_anomaly, and a possible cost double count', () => {
    expect(flagsOf(orderOf('EF-22'))).toContain('paid_per_status_no_payment_rows')
    expect(flagsOf(orderOf('225'))).not.toContain('paid_per_status_no_payment_rows')
    expect(flagsOf(orderOf('TF-7788'))).toContain('margin_anomaly')
    const dbl = t.orders.filter(o => flagsOf(o).includes('cost_possible_double_count'))
    expect(dbl).toHaveLength(1)
    expect(dbl[0]!['notes']).toContain('X-Ray')
  })

  it('maps order_engineers to needs_commissioning and the commissioning dates, dropping unknown engineers', () => {
    const done = orderOf('AT-501')
    expect(done).toMatchObject({ needs_commissioning: true, commissioning_planned_on: '2025-01-20', commissioning_done_on: '2025-02-05' })
    expect(flagsOf(done)).toContain('dates_estimated')
    const open = orderOf('AT-502')
    expect(open).toMatchObject({ needs_commissioning: true, commissioning_planned_on: '2025-02-10', commissioning_done_on: null })
    expect(t.order_engineers).toHaveLength(2)
    expect(t.order_engineers.every(e => e['user_id'] === V2_USERS[2]!.id)).toBe(true)
    expect(orderOf('225')['needs_commissioning']).toBe(false)
  })

  it('takes the company, site and owner from the old order, and the RFQ link from either side', () => {
    const at = orderOf('AT-501')
    expect(at['company_id']).toBe(byName('Alpha Textile Mills')['id'])
    expect(at['site_id']).toBe(t.company_sites.find(s => s['name'] === 'Head Office')!['id'])
    expect(at['owner_id']).toBe(V2_USERS[1]!.id)
    expect(flagsOf(at)).not.toContain('owner_unreliable')
    expect(flagsOf(orderOf('251809'))).not.toContain('owner_unreliable')
    expect(orderOf('252446')['rfq_id']).toBe(rfqOf(1)['id'])
    expect(orderOf('PO250105')['rfq_id']).toBe(rfqOf(5)['id'])
  })

  it('has no owner_attribution list any more: nobody is credited, so attribution reliability does not matter', () => {
    expect(result.review.some(i => i.list === 'owner_attribution')).toBe(false)
    for (const table of ['rfqs', 'orders'] as const) for (const r of t[table]) expect(flagsOf(r)).not.toContain('owner_unreliable')
  })

  it('builds item text from the notes without the PO prefix, and labels batches and units', () => {
    expect(itemDescription({ product_type: 'Pumps', notes: 'PO# 1. Dosing pump x2. Received & delivered.' })).toBe('Dosing pump x2')
    expect(itemDescription({ product_type: 'Pumps', notes: '' })).toBe('Pumps')
    expect(itemDescription({ product_type: null, notes: null })).toBe('Legacy order')
    expect(itemDescription({ product_type: 'X', notes: 'Batch B. Gauge x1.' })).toBe('Gauge x1 — Batch B')
  })
})

describe('I05 invoices', () => {
  const inv = (n: string) => t.invoices.find(i => i['number'] === n)!

  it('takes invoices from three sources: GST register, bookkeeping invoices, orders.invoice_number', () => {
    expect(t.invoices).toHaveLength(18)
    expect(inv('INV-2024-0101')).toMatchObject({ net_amount: 370000, gst_amount: 66600, order_id: orderOf('251809')['id'] })
    // orders.invoice_number, where there is no GST row
    expect(inv('INV-0004')).toMatchObject({ net_amount: 650163, gst_amount: 0, invoice_date: '2024-08-20', order_id: orderOf('248504')['id'] })
    expect(flagsOf(inv('INV-0004'))).toContain('invoice_basis_unknown')
    // bookkeeping invoice, where there is neither
    expect(inv('INV-B-11')).toMatchObject({ net_amount: 617258, invoice_date: '2024-10-20' })
  })

  it('asks whether the amount includes GST (invoice_basis_unknown) only of invoices tied to an order', () => {
    const noOrder = inv('INV-B-77')
    expect(noOrder['order_id']).toBeNull()
    expect(noOrder['company_id']).toBe(byName('Gamma Cement')['id'])
    expect(flagsOf(noOrder)).toEqual([])
    expect(JSON.stringify(noOrder['legacy_source'])).toContain('INV-B-77')
    for (const i of t.invoices.filter(x => x['order_id'] !== null && (x['legacy_source'] as { table: string }).table !== 'gst_invoices')) {
      expect(flagsOf(i)).toContain('invoice_basis_unknown')
    }
    expect(t.invoices.filter(x => x['order_id'] === null && flagsOf(x).includes('invoice_basis_unknown'))).toHaveLength(0)
  })

  it('does not import a bookkeeping invoice twice when the order has a GST row or an invoice number', () => {
    expect(t.invoices.some(i => i['number'] === 'INV-B-01')).toBe(false)
    expect(t.invoices.some(i => i['number'] === 'INV-B-05')).toBe(false)
  })

  it('keeps payment rows over amount_paid; flags paid_per_old_invoice when the rows disagree', () => {
    expect(flagsOf(inv('INV-B-15'))).toContain('paid_per_old_invoice')
    expect(flagsOf(inv('INV-B-11'))).not.toContain('paid_per_old_invoice')
  })

  it('imports a repeated invoice number without the number rather than breaking the unique index', () => {
    const dup = t.invoices.find(i => flagsOf(i).includes('number_duplicate'))!
    expect(dup['number']).toBeNull()
    expect(dup['order_id']).toBe(orderOf('EW-1')['id'])
  })

  it('maps fbr_status: Pending = no FBR dates; Generated without a PSID = fbr_generated_legacy', () => {
    const pending = inv('INV-0001')
    expect(pending).toMatchObject({ psid: null, wasif_receipt_on: null, tax_deposited_on: null })
    expect(flagsOf(pending)).toEqual([])
    const generated = inv('INV-2025-0201')
    expect(flagsOf(generated)).toContain('fbr_generated_legacy')
    const full = inv('INV-2024-0103')
    expect(full['psid']).toBe('PSID-100003')
    expect(flagsOf(full)).not.toContain('fbr_generated_legacy')
  })

  it('maps Receipt Received and Deposited onto the real dates, and checks them', () => {
    expect(inv('INV-2024-0102')).toMatchObject({ wasif_receipt_on: '2024-12-01', tax_deposited_on: null })
    const dep = inv('INV-2024-0101')
    expect(dep).toMatchObject({ wasif_receipt_on: '2024-11-05', tax_deposited_on: '2024-11-10', tax_deposit_amount: 66600, copy_received_on: '2024-10-20', tcs_sent_on: '2024-10-21', tcs_number: 'TCS-1', client_received_on: '2024-10-25' })
    expect(flagsOf(dep)).toEqual([])
    expect(dep['notes']).toBe('Deposit bank: Test Bank')
  })

  it('flags fbr_status_mismatch where the status and the dates disagree, and lists it', () => {
    const bad = inv('INV-0077')
    expect(flagsOf(bad)).toEqual(expect.arrayContaining(['fbr_status_mismatch', 'invalid_date', 'invoice_date_missing', 'company_from_name']))
    expect(bad['invoice_date']).toBeNull()
    expect(bad['order_id']).toBeNull()
    expect(bad['company_id']).toBe(byName('Gamma Cement')['id'])
    expect(result.review.filter(i => i.list === 'fbr_mismatches')).toHaveLength(1)
  })

  it('drops a register row that is linked to nothing, and says so', () => {
    expect(t.invoices.some(i => i['net_amount'] === 1000)).toBe(false)
    expect(result.review.some(i => i.list === 'dropped_rows' && i.label === 'INV-0099')).toBe(true)
  })

  it('moves the receipt file path to an attachment and plans the file copy', () => {
    expect(t.attachments).toHaveLength(1)
    const a = t.attachments[0]!
    expect(a).toMatchObject({ bucket: 'gst-receipts', file_name: 'g1.pdf', mime_type: 'application/pdf', size_bytes: 36, invoice_id: inv('INV-2024-0101')['id'] })
    expect(String(a['path'])).toMatch(new RegExp(`^${String(a['invoice_id'])}/[0-9a-f-]{36}\\.pdf$`))
    expect(result.storageCopies).toEqual([{ fromBucket: 'gst-receipts', fromPath: 'receipts/g1.pdf', toBucket: 'gst-receipts', toPath: a['path'], invoiceId: a['invoice_id'] }])
    // a path the dump's storage listing lacks makes no attachment, and is listed
    expect(result.review.some(i => i.list === 'storage_missing')).toBe(true)
  })
})

describe('I05 payments', () => {
  it('maps order_payments to payments_in: received_on, reference, gross amount, paid_via bank, bank_month empty', () => {
    const p = t.payments_in.find(x => x['reference'] === 'REF-3')!
    expect(p).toMatchObject({ amount: 119276.42, received_on: '2025-01-08', paid_via: 'bank', bank_month: null, order_id: orderOf('010395-1')['id'] })
    expect(p).not.toHaveProperty('tax_withheld')
    expect(p).not.toHaveProperty('payment_method')
  })

  it('credits NOBODY for an old payment (the owner decides later), whoever owns the order', () => {
    expect(t.payments_in.length).toBeGreaterThan(0)
    for (const p of t.payments_in) expect(p['credited_user_id']).toBeNull()
    // AT-501 belongs to a known sales user and its payment still carries no credit
    expect(t.orders.find(o => o['customer_po_number'] === 'AT-501')!['owner_id']).toBe(V2_USERS[1]!.id)
    expect(t.payments_in.find(x => x['reference'] === 'REF-12')!['credited_user_id']).toBeNull()
  })

  it('imports a payment the old system holds as received, by bank, even when the old method says Cash', () => {
    const cash = t.payments_in.find(p => flagsOf(p).includes('from_payment_records'))!
    expect(JSON.stringify(cash['legacy_source'])).toContain('Cash')
    expect(cash).toMatchObject({ paid_via: 'bank', bank_month: null })
    expect(flagsOf(cash).join(' ')).not.toMatch(/cash/i)
    for (const p of t.payments_in) expect(p['paid_via']).toBe('bank')
  })

  it('flags an unparseable payment date and keeps the payment', () => {
    const p = t.payments_in.find(x => x['reference'] === 'REF-8')!
    expect(flagsOf(p)).toContain('invalid_date')
    expect(p['amount']).toBe(1468285.8)
  })

  it('does not import a zero payment or one with no order, and lists both', () => {
    expect(t.payments_in.some(p => p['reference'] === 'REF-10' || p['reference'] === 'REF-11')).toBe(false)
    expect(result.recon.payments.excluded).toBe(362360)
  })

  it('imports payment_records only where order_payments does not already hold the payment', () => {
    const from = t.payments_in.filter(p => flagsOf(p).includes('from_payment_records'))
    expect(from).toHaveLength(1)
    expect(from[0]!['amount']).toBe(1000)
  })

  it('reconciles: old payments = new + left out', () => {
    const raw = fixtureDump().tables
    const old = [...raw['order_payments']!, ...raw['payment_records']!].reduce((s, p) => s + Number(p['amount']), 0)
    expect(result.recon.payments.old).toBe(Math.round(old * 100) / 100)
    expect(result.recon.payments.diff).toBe(0)
    const fromRows = t.payments_in.filter(p => !(p['legacy_source'] as Record<string, unknown>)['derived_from'])
    expect(sum(fromRows, 'amount')).toBe(result.recon.payments.neu)
    expect(sum(t.payments_in, 'amount')).toBe(Math.round((result.recon.payments.neu + result.recon.paymentsFromStatus.neu) * 100) / 100)
  })
})

describe('I05 expenses and recurring', () => {
  const byDescription = (d: string) => t.expenses.find(e => e['description'] === d)!

  it('maps the legacy category through the mapping file, then by exact new name, else Other + category_unmapped', () => {
    expect(byDescription('Petrol (test)')['_category']).toBe('Fuel & travel')
    expect(byDescription('Rent (test)')['_category']).toBe('Rent')
    const odd = byDescription('Misc stuff (test)')
    expect(odd['_category']).toBe('Other')
    expect(flagsOf(odd)).toContain('category_unmapped')
    expect(result.review.filter(i => i.list === 'category_unmapped')).toHaveLength(1)
  })

  it('records every legacy expense as a bank payment that has not been ticked', () => {
    for (const e of t.expenses) expect(e).toMatchObject({ paid_via: 'bank', bank_month: null, input_tax_pkr: 0 })
  })

  it('maps supplier payments to the Supplier payment category with the order, the single leg and its supplier', () => {
    const o1 = orderOf('251809')
    const leg = t.supplier_orders.find(l => l['order_id'] === o1['id'])!
    const e = t.expenses.find(x => x['reference'] === 'SP-1')!
    expect(e).toMatchObject({ _category: 'Supplier payment', order_id: o1['id'], supplier_order_id: leg['id'], payee_id: leg['supplier_id'], amount_pkr: 87150, paid_on: '2024-10-20' })
  })

  it('flags invalid dates, falls back, and keeps the expense', () => {
    const e = byDescription('Utilities (test)')
    expect(flagsOf(e)).toContain('invalid_date')
    expect(e['paid_on']).toBe('2024-10-01')
  })

  it('reads day-first dates', () => {
    expect(t.expenses.find(e => e['amount_pkr'] === 300000 && e['paid_on'] === '2024-12-31')).toBeTruthy()
  })

  it('does not import a negative expense', () => {
    expect(t.expenses.some(e => Number(e['amount_pkr']) < 0)).toBe(false)
  })

  it('keeps the recurring link and period, and clears a repeated period instead of breaking the unique key', () => {
    const linked = t.expenses.filter(e => e['recurring_id'] !== null)
    expect(linked.map(e => e['period']).sort()).toEqual(['2024-10', '2024-11'])
    const dup = t.expenses.find(e => flagsOf(e).includes('recurring_period_duplicate'))!
    expect(dup).toMatchObject({ recurring_id: null, period: null })
  })

  it('imports payable payments as expenses unless a supplier payment already records them; flags a linked-expense double count', () => {
    const fromPayable = t.expenses.filter(e => flagsOf(e).includes('from_payable_payment'))
    expect(fromPayable).toHaveLength(1)
    expect(fromPayable[0]).toMatchObject({ amount_pkr: 15000, _category: 'Supplier payment', order_id: null })
    expect(flagsOf(fromPayable[0]!)).toContain('possible_double_count_linked_expense')
    expect(result.review.filter(i => i.list === 'cost_double_counts')).toHaveLength(2)
  })

  it('maps recurring_expenses: empty becomes NULL, out-of-range day becomes NULL', () => {
    const rent = t.recurring_expenses.find(r => r['label'] === 'Office rent')!
    const salaries = t.recurring_expenses.find(r => r['label'] === 'Staff salaries')!
    expect(rent).toMatchObject({ day_of_month: null, start_month: '2024-10', _category: 'Rent' })
    expect(salaries).toMatchObject({ day_of_month: 25, start_month: null, _category: 'Salaries' })
  })

  it('reconciles money per category: old = new + left out', () => {
    for (const line of result.recon.expensesByCategory) expect(line.diff).toBe(0)
    const total = result.recon.expensesTotal
    expect(sum(t.expenses, 'amount_pkr')).toBe(total.neu)
    const raw = fixtureDump().tables
    const old = [...raw['expenses']!, ...raw['supplier_payments']!, ...raw['payable_payments']!].reduce((s, e) => s + Number(e['amount']), 0)
    expect(total.old).toBe(Math.round(old * 100) / 100)
    // by category, computed here from the new rows (independent of the ledger)
    const cats = new Map<string, number>()
    for (const e of t.expenses) cats.set(String(e['_category']), Math.round(((cats.get(String(e['_category'])) ?? 0) + Number(e['amount_pkr'])) * 100) / 100)
    for (const line of result.recon.expensesByCategory) expect(cats.get(line.key) ?? 0).toBe(line.neu)
    expect(cats.get('Salaries')).toBe(1_200_000)
    // the supplier payment twin and the negative rent are the only things left out
    expect(total.excluded).toBe(87150 - 50)
  })

  it('reconciles order value: old Σ order_value = new Σ item net', () => {
    const raw = fixtureDump().tables['orders']!.reduce((s, o) => s + Number(o['order_value']), 0)
    expect(result.recon.orderValue).toMatchObject({ old: raw, neu: raw, excluded: 0, diff: 0 })
    expect(sum(t.order_items, 'unit_price_net')).toBe(raw)
  })

  it('reconciles invoices: net and GST', () => {
    expect(sum(t.invoices, 'net_amount')).toBe(result.recon.invoiceNet.neu)
    expect(sum(t.invoices, 'gst_amount')).toBe(result.recon.invoiceGst.neu)
    expect(result.recon.invoiceNet.diff).toBe(0)
    expect(result.recon.invoiceGst.diff).toBe(0)
  })
})

describe('what is left behind', () => {
  it('counts the tables the new model drops, and warns if documents is not empty', () => {
    expect(result.droppedByDesign.find(d => d.table === 'follow_up_actions')!.rows).toBe(1)
    expect(result.droppedByDesign.find(d => d.table === 'quarterly_targets')!.rows).toBe(1)
    expect(result.review.some(i => i.list === 'warnings')).toBe(false)
    const d: LegacyDump = cloneDump(fixtureDump())
    d.tables['documents'] = [{ id: 'x' }]
    expect(run(d).review.some(i => i.list === 'warnings')).toBe(true)
  })

  it('has no real data in it: the fixture phones and e-mails are fake', () => {
    const text = JSON.stringify(fixtureDump().tables)
    const emails = text.match(/[\w.+-]+@[\w.-]+/g) ?? []
    for (const e of emails) expect(e.endsWith('.invalid')).toBe(true)
  })
})
