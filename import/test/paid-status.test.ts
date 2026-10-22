import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadMappings, parseMappings } from '../src/mappings'
import { reconciles, writeReport } from '../src/report/report'
import { transformAll } from '../src/transform'
import { poFromNotes, poTokens } from '../src/transform/money'
import type { LegacyDump, NewRow, TransformResult } from '../src/types'
import { AS_OF, cloneDump, FIXTURE_MAPPINGS, fixtureDump, run, V2_USERS, violations } from './support'

// Owner decisions 2026-10-19: the GST register wins over a bookkeeping invoice of the same sale; the old paid STATUS becomes
// a payment received; everything else old and unpaid is listed (still_owed.csv), answered in legacy_invoice_status.csv.

const result = run()
const t = result.tables

const flagsOf = (row: NewRow) => row['legacy_flags'] as string[]
const orderOf = (r: TransformResult, po: string) => r.tables.orders.find(o => o['customer_po_number'] === po)!
const invoiceOf = (r: TransformResult, no: string) => r.tables.invoices.find(i => i['number'] === no)
const paymentsOn = (r: TransformResult, po: string) => r.tables.payments_in.filter(p => p['order_id'] === orderOf(r, po)['id'])
const derived = (r: TransformResult) => r.tables.payments_in.filter(p => (p['legacy_source'] as Record<string, unknown>)['derived_from'])
const review = (r: TransformResult, list: string) => r.review.filter(i => i.list === list)
const owed = (r: TransformResult, label: string) => review(r, 'still_owed').find(i => i.label === label)

function edit(fn: (d: LegacyDump) => void): LegacyDump {
  const d = cloneDump(fixtureDump())
  fn(d)
  return d
}
function oldInvoice(d: LegacyDump, no: string): Record<string, unknown> {
  return d.tables['invoices']!.find(i => i['invoice_number'] === no)!
}
function oldOrder(d: LegacyDump, po: string): Record<string, unknown> {
  return d.tables['orders']!.find(o => o['customer_po_number'] === po)!
}
function withStatusList(csv: string, dump: LegacyDump = fixtureDump()): TransformResult {
  const maps = loadMappings(FIXTURE_MAPPINGS)
  maps.legacyInvoiceStatus = parseMappings({ legacyInvoiceStatus: csv }).legacyInvoiceStatus
  return transformAll(dump, maps, { asOf: AS_OF, v2Users: V2_USERS })
}

describe('reading PO numbers', () => {
  it('takes the PO out of free text, but not out of "Position"', () => {
    expect(poFromNotes('PO 251809. Level sensors.')).toBe('251809')
    expect(poFromNotes('PO# 251809 (Unit A). Moxa')).toBe('251809')
    expect(poFromNotes('PO# 253074 & 252993. Two orders')).toBe('253074 & 252993')
    expect(poFromNotes('Position sensors x6.')).toBeNull()
    expect(poFromNotes(null)).toBeNull()
  })

  it('splits a register cell into PO tokens, ignoring "PO", "#", spaces and case', () => {
    expect(poTokens('253074 & 252993 & 254040')).toEqual(['253074', '252993', '254040'])
    expect(poTokens(' po 7001 &7002 & 7003')).toEqual(['7001', '7002', '7003'])
    expect(poTokens('  po#7002  ')).toEqual(['7002'])
    expect(poTokens('PO250105')).toEqual(poTokens('250105'))
    expect(poTokens('tf-7788')).toEqual(['TF-7788'])
    expect(poTokens(null)).toEqual([])
  })
})

describe('the GST register wins: bookkeeping invoices that repeat it are not imported', () => {
  it('matches a multi-PO register row, through the company merge, whatever the case and spacing', () => {
    // INV-B-701 (Northgate Glass Lahore, "PO 7001.") and INV-B-702 (Northgate Glass Karachi, "  po#7002  ") repeat INV-2025-0301
    expect(invoiceOf(result, 'INV-B-701')).toBeUndefined()
    expect(invoiceOf(result, 'INV-B-702')).toBeUndefined()
    expect(invoiceOf(result, 'INV-2025-0301')).toBeTruthy()
    const dropped = review(result, 'dropped_rows').filter(i => i.detail === 'duplicate of GST invoice INV-2025-0301')
    expect(dropped.map(i => i.label).sort()).toEqual(['INV-B-701', 'INV-B-702'])
  })

  it('does not match the same PO of another customer, and lists it for the owner', () => {
    // INV-B-703 is Delta's PO 7003; the register row's 7003 belongs to Northgate Glass
    expect(invoiceOf(result, 'INV-B-703')).toBeTruthy()
    const near = review(result, 'invoice_duplicates').find(i => i.label === 'INV-B-703')!
    expect(near.fields).toMatchObject({ match: 'not matched: customer differs', gst_invoice: 'INV-2025-0301' })
  })

  it('lists every match with the PO, both amounts and their ratio', () => {
    const dups = review(result, 'invoice_duplicates').filter(i => i.fields?.['match'] === 'duplicate')
    // INV-B-01 repeats INV-2024-0101 through its order's PO (it used to be caught only by the order link)
    expect(dups.map(i => i.label).sort()).toEqual(['INV-B-01', 'INV-B-701', 'INV-B-702', 'INV-B-810'])
    expect(dups.find(i => i.label === 'INV-B-810')!.fields).toEqual({
      bookkeeping_invoice: 'INV-B-810',
      po: '8100',
      amount: 80000,
      gst_invoice: 'INV-2025-0302',
      gst_gross: 94400,
      ratio: 0.8475,
      match: 'duplicate',
    })
  })

  it('puts a register row with no order on the order of its single twin; one spanning several orders stays with the company', () => {
    const single = invoiceOf(result, 'INV-2025-0302')!
    expect(single['order_id']).toBe(orderOf(result, '8100')['id'])
    expect(flagsOf(single)).toContain('order_from_bookkeeping_twin')
    const multi = invoiceOf(result, 'INV-2025-0301')!
    expect(multi['order_id']).toBeNull()
    expect(multi['company_id']).toBe(t.companies.find(c => c['name'] === 'Northgate Glass')!['id'])
  })

  it('does not match a different customer even when the PO is the only one on the register row', () => {
    const r = run(edit(d => (oldInvoice(d, 'INV-B-810')['client_id'] = oldInvoice(d, 'INV-B-703')['client_id'])))
    // the order still says Theta, so the invoice's customers are Theta and Delta: still a match through the order
    expect(invoiceOf(r, 'INV-B-810')).toBeUndefined()
    const r2 = run(edit(d => {
      const inv = oldInvoice(d, 'INV-B-810')
      inv['client_id'] = oldInvoice(d, 'INV-B-703')['client_id']
      inv['order_id'] = null
    }))
    expect(invoiceOf(r2, 'INV-B-810')).toBeTruthy()
    expect(reconciles(r2.recon)).toBe(true)
  })

  it('counts the duplicates as left out on the invoice net line, so the money still reconciles', () => {
    expect(reconciles(result.recon)).toBe(true)
    expect(result.recon.invoiceNet.diff).toBe(0)
    // left out = the 4 duplicates (INV-B-701, -702, -810, -01) + INV-B-05 (its order has an invoice number) + INV-0099 (linked to nothing)
    expect(result.recon.invoiceNet.excluded).toBe(100000 + 50000 + 80000 + 370000 + 650163 + 1000)
    expect(review(result, 'dropped_rows').filter(i => i.detail.startsWith('duplicate of GST invoice'))).toHaveLength(4)
  })
})

describe('the old paid status becomes a payment received', () => {
  it('pays each Paid twin of a register row that spans several orders on its own order, at the old due date', () => {
    const p18 = paymentsOn(result, '7001')
    expect(p18).toHaveLength(1)
    expect(p18[0]).toMatchObject({ amount: 100000, received_on: '2025-02-10', reference: 'INV-2025-0301', paid_via: 'bank', bank_month: null, credited_user_id: null })
    expect(flagsOf(p18[0]!)).toEqual(['paid_per_old_invoice_status', 'payment_date_estimated', 'payment_on_twin_order'])
    // no due date on INV-B-702: invoice date + the order's 30 days
    expect(paymentsOn(result, '7002')[0]).toMatchObject({ amount: 50000, received_on: '2025-02-19' })
  })

  it('pays a register row in full (its gross) when all its twins are Paid', () => {
    const r = run(edit(d => Object.assign(oldInvoice(d, 'INV-B-810'), { payment_status: 'Paid', amount_paid: 80000 })))
    const p = paymentsOn(r, '8100')
    expect(p).toHaveLength(1)
    expect(p[0]!['amount']).toBe(94400)
    expect(flagsOf(p[0]!)).not.toContain('payment_partial_legacy')
    expect(owed(r, 'INV-2025-0302')).toBeUndefined()
  })

  it('pays a Partial twin as recorded, capped at the register gross, flagged payment_partial_legacy', () => {
    const p = paymentsOn(result, '8100')
    expect(p).toHaveLength(1) // the order is also payment_received, but the invoice already has a payment
    expect(p[0]).toMatchObject({ amount: 50000 })
    expect(flagsOf(p[0]!)).toContain('payment_partial_legacy')
    const capped = run(edit(d => (oldInvoice(d, 'INV-B-810')['amount_paid'] = 200000)))
    expect(paymentsOn(capped, '8100')[0]!['amount']).toBe(94400)
  })

  it('pays a bookkeeping invoice that is itself Paid or Partial', () => {
    const r = run(
      edit(d => {
        Object.assign(oldInvoice(d, 'INV-B-703'), { payment_status: 'Partial', amount_paid: 12000, due_date: '2025-02-01' })
      }),
    )
    const p = paymentsOn(r, '7003')
    expect(p).toHaveLength(1)
    expect(p[0]).toMatchObject({ amount: 12000, received_on: '2025-02-01', reference: 'INV-B-703' })
    expect(flagsOf(p[0]!)).toEqual(['paid_per_old_invoice_status', 'payment_date_estimated', 'payment_partial_legacy'])
    expect(owed(r, 'INV-B-703')!.fields).toMatchObject({ gross: 30000, open: 18000 })
  })

  it('pays every invoice of an order marked payment_received that has no payment yet, in full', () => {
    const p = paymentsOn(result, 'EW-9')
    expect(p).toHaveLength(1)
    // no due dates anywhere: invoice date 2025-01-10 + the order's 45 days
    expect(p[0]).toMatchObject({ amount: 60000, received_on: '2025-02-24', reference: 'INV-B-22' })
    expect(flagsOf(p[0]!)).toEqual(['paid_per_order_status', 'payment_date_estimated'])
  })

  it('never adds a payment where payment rows exist', () => {
    // the fixture orders 225, 010395-1 and EF-22 are payment_received and have rows; INV-B-15 is Paid and has a payment record
    for (const po of ['225', '010395-1', 'EF-22']) expect(paymentsOn(result, po).every(p => !(p['legacy_source'] as Record<string, unknown>)['derived_from'])).toBe(true)
    const r = run(
      edit(d => {
        const order = oldOrder(d, 'EW-9')
        d.tables['order_payments']!.push({ ...d.tables['order_payments']![0]!, id: '05000000-0000-4000-8000-000000000099', order_id: order['id'], amount: 1000, reference: 'REF-99' })
      }),
    )
    expect(paymentsOn(r, 'EW-9').map(p => p['amount'])).toEqual([1000])
    expect(reconciles(r.recon)).toBe(true)
  })

  it('dates a payment: old due date, else the order payment due date, else invoice date + terms, else invoice date; never after asOf', () => {
    // INV-B-810's due date 2025-04-15 is after asOf
    expect(paymentsOn(result, '8100')[0]!['received_on']).toBe(AS_OF)
    const orderDue = run(edit(d => (oldInvoice(d, 'INV-B-810')['due_date'] = '')))
    expect(paymentsOn(orderDue, '8100')[0]!['received_on']).toBe('2025-02-20')
    const noTerms = run(edit(d => (oldOrder(d, 'EW-9')['payment_terms_days'] = null)))
    expect(paymentsOn(noTerms, 'EW-9')[0]!['received_on']).toBe('2025-01-10')
    for (const p of derived(result)) {
      expect(String(p['received_on']) <= AS_OF).toBe(true)
      expect(flagsOf(p)).toContain('payment_date_estimated')
    }
  })

  it('settles a paid invoice with no order before cutover: no payment, no fake order, listed, and the money reconciles', () => {
    // INV-B-31: Paid 7000 of 7000, linked to a client only (a payment needs an order)
    const inv = invoiceOf(result, 'INV-B-31')!
    expect(inv['order_id']).toBeNull()
    expect(inv['settled_before_cutover']).toBe(true)
    expect(t.invoices.filter(i => i['settled_before_cutover'] === true).map(i => i['number'])).toEqual(['INV-B-31'])
    expect(t.invoices.every(i => typeof i['settled_before_cutover'] === 'boolean')).toBe(true)
    expect(review(result, 'payments_not_placed')).toEqual([])
    expect(review(result, 'settled_before_cutover').map(i => [i.label, i.fields])).toEqual([
      ['INV-B-31', { invoice_number: 'INV-B-31', customer: 'Alpha Textile Mills', invoice_date: '2025-01-15', gross: 7000, reason: 'status' }],
    ])
    expect(result.recon.paymentsFromStatus).toEqual({ key: 'paymentsFromStatus', old: 267000, neu: 260000, excluded: 0, settled: 7000, diff: 0 })
    expect(result.recon.settledBeforeCutover).toEqual({ count: 1, gross: 7000 })
    expect(result.recon.paymentsFromStatusCount).toBe(4)
    expect(derived(result)).toHaveLength(4)
    expect(t.payments_in.some(p => p['reference'] === 'INV-B-31')).toBe(false)
    expect(owed(result, 'INV-B-31')).toBeUndefined()
    expect(reconciles(result.recon)).toBe(true)
    // only an imported row with no order may carry it (the database CHECK)
    expect(t.invoices.filter(i => i['settled_before_cutover'] === true).every(i => i['order_id'] === null && i['legacy_source'])).toBe(true)
  })

  it('settles an invoice with no order that the owner marks paid (reason owner_list)', () => {
    // INV-B-77: 5000, no order, no old status: open until the owner's list says paid
    const r = withStatusList('invoice_number,status\nINV-B-77,paid\n')
    expect(invoiceOf(r, 'INV-B-77')!['settled_before_cutover']).toBe(true)
    expect(review(r, 'settled_before_cutover').find(i => i.label === 'INV-B-77')!.fields).toMatchObject({ gross: 5000, reason: 'owner_list' })
    expect(owed(r, 'INV-B-77')).toBeUndefined()
    expect(r.recon.paymentsFromStatus).toMatchObject({ settled: 12000, excluded: 0, diff: 0 })
    expect(r.recon.settledBeforeCutover).toEqual({ count: 2, gross: 12000 })
    expect(reconciles(r.recon)).toBe(true)
  })

  it('keeps an invoice with no order that is paid only in part open: listed in payments_not_placed, the rest still owed', () => {
    const r = run(edit(d => Object.assign(oldInvoice(d, 'INV-B-31'), { payment_status: 'Partial', amount_paid: 3000 })))
    expect(invoiceOf(r, 'INV-B-31')!['settled_before_cutover']).toBe(false)
    expect(review(r, 'settled_before_cutover')).toEqual([])
    expect(review(r, 'payments_not_placed').map(i => i.label)).toEqual(['INV-B-31'])
    expect(owed(r, 'INV-B-31')!.fields).toMatchObject({ gross: 7000, open: 4000, linked_to_order: 'no' })
    expect(r.recon.paymentsFromStatus).toEqual({ key: 'paymentsFromStatus', old: 263000, neu: 260000, excluded: 3000, diff: 0 })
    expect(reconciles(r.recon)).toBe(true)
    // the owner's list then settles it: the part (status) and the rest (list) together
    const both = withStatusList('invoice_number,status\nINV-B-31,paid\n', edit(d => Object.assign(oldInvoice(d, 'INV-B-31'), { payment_status: 'Partial', amount_paid: 3000 })))
    expect(invoiceOf(both, 'INV-B-31')!['settled_before_cutover']).toBe(true)
    expect(review(both, 'payments_not_placed')).toEqual([])
    expect(review(both, 'settled_before_cutover')[0]!.fields).toMatchObject({ reason: 'owner_list' })
    expect(both.recon.paymentsFromStatus).toMatchObject({ old: 267000, neu: 260000, excluded: 0, settled: 7000, diff: 0 })
  })

  it('still pays an invoice that has an order (settled before cutover is for invoices with no order only)', () => {
    expect(t.invoices.filter(i => i['order_id'] !== null).every(i => i['settled_before_cutover'] === false)).toBe(true)
    expect(paymentsOn(result, 'EW-9')).toHaveLength(1)
  })

  it('gives the same ids on every run and breaks no database rule', () => {
    expect(derived(run()).map(p => p['id'])).toEqual(derived(result).map(p => p['id']))
    expect(violations(result)).toEqual([])
  })
})

describe('what is still owed is listed, not assumed', () => {
  it('lists every imported invoice left with an open balance, with its customer, PO and order link', () => {
    expect(owed(result, 'INV-2025-0301')!.fields).toEqual({
      invoice_number: 'INV-2025-0301',
      customer: 'Northgate Glass',
      invoice_date: '2025-01-20',
      gross: 177000,
      open: 27000,
      po: 'po 7001 &7002 & 7003',
      linked_to_order: 'no',
    })
    expect(owed(result, 'INV-B-703')!.fields).toMatchObject({ customer: 'Delta Chemicals', gross: 30000, open: 30000, po: '7003', linked_to_order: 'yes' })
    expect(owed(result, 'INV-B-77')!.fields).toMatchObject({ linked_to_order: 'no', open: 5000 })
    // settled ones are not listed: by payment rows (INV-2024-0101) or by status (INV-B-22)
    expect(owed(result, 'INV-2024-0101')).toBeUndefined()
    expect(owed(result, 'INV-B-22')).toBeUndefined()
  })

  it('legacy_invoice_status.csv: paid makes a full payment, owed stays open and unlisted, an invoice with no line stays listed', () => {
    const r = withStatusList('invoice_number,status\ninv-b-703 ,PAID\nINV-2025-0105,owed\nINV-2025-0302,paid\nNO-SUCH-1,paid\n')
    const p = paymentsOn(r, '7003')
    expect(p).toHaveLength(1)
    // invoice date 2025-01-21 + 30 days
    expect(p[0]).toMatchObject({ amount: 30000, received_on: '2025-02-20' })
    expect(flagsOf(p[0]!)).toEqual(['paid_per_owner_list', 'payment_date_estimated'])
    expect(owed(r, 'INV-B-703')).toBeUndefined()
    // owed: no payment, not listed
    expect(owed(r, 'INV-2025-0105')).toBeUndefined()
    expect(paymentsOn(r, 'TF-7788')).toHaveLength(0)
    // paid on a part-paid invoice: what is open
    expect(paymentsOn(r, '8100').map(x => x['amount']).sort()).toEqual([44400, 50000])
    // unlisted: still listed
    expect(owed(r, 'INV-B-77')).toBeTruthy()
    expect(review(r, 'warnings').some(i => i.label === 'NO-SUCH-1')).toBe(true)
    expect(reconciles(r.recon)).toBe(true)
  })

  it('writes invoice_duplicates.csv and still_owed.csv with their own columns', () => {
    const dir = mkdtempSync(join(tmpdir(), 'paid-status-'))
    try {
      writeReport(dir, result)
      const head = (f: string) => readFileSync(join(dir, f), 'utf8').split('\n')[0]
      expect(head('invoice_duplicates.csv')).toBe('table,old_id,label,detail,bookkeeping_invoice,po,amount,gst_invoice,gst_gross,ratio,match')
      expect(head('still_owed.csv')).toBe('table,old_id,label,detail,invoice_number,customer,invoice_date,gross,open,po,linked_to_order')
      expect(head('dropped_rows.csv')).toBe('table,old_id,label,detail')
      expect(head('settled_before_cutover.csv')).toBe('table,old_id,label,detail,invoice_number,customer,invoice_date,gross,reason')
      expect(readFileSync(join(dir, 'report.md'), 'utf8')).toContain('Payments in, from paid status')
      expect(readFileSync(join(dir, 'report.md'), 'utf8')).toContain('Settled before cutover: 1 invoices (gross 7,000.00)')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
