import { describe, expect, it } from 'vitest'
import { generateCSV } from '@/lib/csvExport'
import { EXPORTS, expensesTable, invoicesTable, ordersTable, paymentsTable, rfqsTable } from './exportData'

describe('export data (process audit 8)', () => {
  it('offers the six kinds the admin asked for', () => {
    expect(EXPORTS.map(e => e.id)).toEqual(['companies', 'rfqs', 'orders', 'invoices', 'payments', 'expenses'])
  })

  it('an order row carries its money from the order view, and nothing is invented when there is none', () => {
    const t = ordersTable(
      [{ id: 'o1', number: 38, company_id: 'c1', customer_po_number: 'PO-7', ordered_on: '2026-10-01', owner_id: 'u1', cancelled_on: null }, { id: 'o2', number: 39, company_id: 'c1' }],
      new Map([['o1', { gross_target: 1180, settled: 500, receivable: 680, payment_state: 'part', due_on: '2026-10-31' }]]),
      new Map([['c1', 'Indus Textile Mills']]),
      new Map([['u1', 'Sana Sales']]),
    )
    expect(t.rows[0]).toEqual(['ORD-0038', 'Indus Textile Mills', 'PO-7', '2026-10-01', 'Sana Sales', '', 1180, 500, 680, 'part', '2026-10-31'])
    expect(t.rows[1].slice(6)).toEqual(['', '', '', '', ''])
    expect(t.headers.length).toBe(t.rows[0].length)
  })

  it('invoices keep their own stored net and GST and add the total', () => {
    const t = invoicesTable([{ number: 'INV-0001', invoice_date: '2026-10-02', company_id: 'c1', order_id: 'o1', net_amount: '1000.00', gst_amount: '180.00', psid: null, tax_deposited_on: null }], new Map([['o1', 'ORD-0038']]), new Map([['c1', 'Indus']]))
    expect(t.rows[0]).toEqual(['INV-0001', '2026-10-02', 'Indus', 'ORD-0038', 1000, 180, 1180, '', ''])
  })

  it('payments name the customer through the order and keep a voided one marked', () => {
    const t = paymentsTable([{ received_on: '2026-10-05', order_id: 'o1', amount: 500, paid_via: 'bank', reference: 'TT-9', voided_at: '2026-10-06T08:00:00Z', void_reason: 'wrong order' }], new Map([['o1', 'ORD-0038']]), new Map([['o1', 'Indus']]))
    expect(t.rows[0]).toEqual(['2026-10-05', 'Indus', 'ORD-0038', 500, 'bank', 'TT-9', '2026-10-06', 'wrong order'])
  })

  it('expenses and RFQs map ids to names and every row is as wide as its header', () => {
    const e = expensesTable([{ paid_on: '2026-10-03', category_id: 'k1', description: 'Petrol', payee_id: null, order_id: null, amount_pkr: 700, input_tax_pkr: 0, paid_via: 'cash', period: null }], new Map([['k1', 'Fuel and travel']]), new Map(), new Map())
    expect(e.rows[0]).toEqual(['2026-10-03', 'Fuel and travel', 'Petrol', '', '', 700, 0, 'cash', ''])
    const r = rfqsTable([{ number: 177, company_id: 'c1', customer_ref: 'RFQ/9', received_on: '2026-10-01', due_on: '2026-10-08', quoted_on: null, closed_on: null, close_reason: null, owner_id: 'u1', is_priority: true }], new Map([['c1', 'Indus']]), new Map([['u1', 'Sana']]))
    expect(r.rows[0][0]).toBe('RFQ-0177')
    for (const t of [e, r]) expect(t.rows.every(row => row.length === t.headers.length)).toBe(true)
  })

  it('a text cell that starts like a formula is neutralised in the file', () => {
    const csv = generateCSV(['Name'], [['=HYPERLINK("http://x")']])
    expect(csv.split('\n')[1]).toBe('"\'=HYPERLINK(""http://x"")"')
  })
})
