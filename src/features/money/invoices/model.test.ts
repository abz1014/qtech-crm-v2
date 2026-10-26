import { gstReturnDueDay, gstReturnMayBeFiled, monthHasFbrRecord } from '@/features/money/invoices/model'
import { describe, expect, it } from 'vitest'
import {
  attentionReason,
  cleanPsid,
  dueOn,
  gstOn,
  gstRowLabel,
  invoiceNextStep,
  invoiceStart,
  matchesSearch,
  rangeLabel,
  registerTotals,
  rowMonth,
  stampable,
  type GstRow,
  type OrderAmounts,
} from '@/features/money/invoices/model'

const row = (over: Partial<GstRow> = {}): GstRow => ({
  invoiceId: 'i1',
  number: 'INV-2311',
  invoiceDate: '2026-11-25',
  orderId: 'o1',
  orderNumber: 41,
  companyId: 'c1',
  companyName: 'Hazara Paper Board',
  net: 860000,
  gst: 154800,
  gross: 1014800,
  courierState: 'not_started',
  fbrState: 'pending',
  fbrException: false,
  needsAttention: false,
  psid: null,
  taxDepositedOn: null,
  ...over,
})

describe('GST: 18% or exempt, never another rate', () => {
  it('18% is whole rupees, exempt is zero', () => {
    expect(gstOn(860000, '18')).toBe(154800)
    expect(gstOn(1949800, '18')).toBe(350964)
    expect(gstOn(100.5, '18')).toBe(18)
    expect(gstOn(860000, 'exempt')).toBe(0)
    expect(gstOn(0, '18')).toBe(0)
  })

  it('the GST row says which', () => {
    expect(gstRowLabel('18')).toBe('GST, 18%')
    expect(gstRowLabel('exempt')).toBe('GST, exempt')
    expect(gstRowLabel('mixed')).toBe('GST, from the lines')
  })
})

describe('what a new invoice opens with', () => {
  const base: OrderAmounts = { itemsNet: 1949800, itemsGst: 350964, lineCount: 8, exemptLineCount: 0, invoicedNet: 0, invoicedGst: 0, paymentTermsDays: 30 }

  it('the whole order from its lines: net, GST and gross pre-filled', () => {
    expect(invoiceStart(base)).toMatchObject({ net: 1949800, gst: 350964, gross: 2300764, option: '18', wholeOrder: true, fullyInvoiced: false })
  })

  it('what is left after an earlier invoice', () => {
    expect(invoiceStart({ ...base, invoicedNet: 860000, invoicedGst: 154800 })).toMatchObject({ net: 1089800, gst: 196164, wholeOrder: false })
  })

  it('an exempt order is exempt; a mix is "from the lines"', () => {
    expect(invoiceStart({ ...base, itemsGst: 0, exemptLineCount: 8 }).option).toBe('exempt')
    expect(invoiceStart({ ...base, exemptLineCount: 2 }).option).toBe('mixed')
  })

  it('knows when nothing is left to invoice', () => {
    expect(invoiceStart({ ...base, invoicedNet: 1949800, invoicedGst: 350964 })).toMatchObject({ net: 0, fullyInvoiced: true })
  })

  it('due date is the invoice date plus the order terms', () => {
    expect(dueOn('2026-11-27', 30)).toBe('2026-12-27')
    expect(dueOn('2026-12-20', 30)).toBe('2027-01-19')
    expect(dueOn('2026-11-27', null)).toBeNull()
  })
})

describe('the register', () => {
  it('flags tax not deposited for an earlier month, and a step recorded without the one before it', () => {
    expect(attentionReason(row())).toBeNull()
    expect(attentionReason(row({ needsAttention: true, invoiceDate: '2026-10-16', fbrState: 'receipt_received', psid: 'P1' }))).toBe('October invoice, tax not deposited')
    expect(attentionReason(row({ fbrException: true, fbrState: 'deposited', psid: null }))).toBe('Deposit recorded without a PSID')
    expect(attentionReason(row({ fbrException: true, fbrState: 'receipt_received', psid: null }))).toBe('Receipt recorded without a PSID')
  })

  it('groups by invoice month and totals what is shown', () => {
    expect(rowMonth(row())).toBe('November 2026')
    expect(rowMonth(row({ invoiceDate: null }))).toBe('No date')
    expect(registerTotals([row(), row({ net: 100, gst: 18, gross: 118 })])).toEqual({ count: 2, net: 860100, gst: 154818, gross: 1014918 })
  })

  it('searches the invoice number, the customer and the order number', () => {
    expect(matchesSearch(row(), 'inv-2311')).toBe(true)
    expect(matchesSearch(row(), 'hazara board')).toBe(true)
    expect(matchesSearch(row(), 'ord-0041')).toBe(true)
    expect(matchesSearch(row(), 'margalla')).toBe(false)
    expect(matchesSearch(row(), '  ')).toBe(true)
  })

  it('says ONE next step per invoice: out-of-order step, late GST, send to customer, deposit GST, done', () => {
    expect(invoiceNextStep(row()).label).toBe('Send to customer')
    expect(invoiceNextStep(row({ courierState: 'sent' }))).toEqual({ tone: 'now', label: 'Deposit GST' })
    expect(invoiceNextStep(row({ courierState: 'sent', fbrState: 'deposited', psid: 'P1' }))).toEqual({ tone: 'done', label: 'Done' })
    expect(invoiceNextStep(row({ needsAttention: true, invoiceDate: '2026-09-02', courierState: 'sent' }))).toEqual({ tone: 'late', label: 'Deposit GST', detail: 'September invoice, tax not deposited' })
    expect(invoiceNextStep(row({ fbrException: true, fbrState: 'deposited', psid: 'P1', courierState: 'sent' })).label).toBe('Add deposit receipt')
    expect(invoiceNextStep(row({ fbrException: true, fbrState: 'deposited', psid: null })).label).toBe('Add the PSID')
  })

  it('names the months the register covers', () => {
    expect(rangeLabel([row({ invoiceDate: '2026-09-11' }), row({ invoiceDate: '2026-11-25' })])).toBe('Sep to Nov 2026')
    expect(rangeLabel([row({ invoiceDate: '2026-11-25' })])).toBe('November 2026')
    expect(rangeLabel([row({ invoiceDate: '2025-12-01' }), row({ invoiceDate: '2026-02-01' })])).toBe('Dec 2025 to Feb 2026')
  })
})

describe('month stamping', () => {
  const rows = [row({ invoiceId: 'a' }), row({ invoiceId: 'b', courierState: 'sent', fbrState: 'deposited' }), row({ invoiceId: 'c', courierState: 'copy_received' })]

  it('a date stamp never touches an invoice that already has it', () => {
    expect(stampable(rows, 'tcs').map(r => r.invoiceId)).toEqual(['a', 'c'])
    expect(stampable(rows, 'deposit').map(r => r.invoiceId)).toEqual(['a', 'c'])
    expect(stampable(rows, 'psid').map(r => r.invoiceId)).toEqual(['a', 'b', 'c'])
  })

  it('a pasted PSID loses its stray spaces and line breaks', () => {
    expect(cleanPsid('  1234 5678\n')).toBe('1234 5678')
  })
})

describe('is the month\'s GST return perhaps in? (W11)', () => {
  it('a PSID or a deposit on any invoice of that month says yes', () => {
    const rows = [{ invoiceDate: '2026-10-03', psid: null, taxDepositedOn: null }, { invoiceDate: '2026-10-20', psid: ' 123 ', taxDepositedOn: null }]
    expect(monthHasFbrRecord(rows, '2026-10-12')).toBe(true)
    expect(monthHasFbrRecord(rows, '2026-09-30')).toBe(false)
    expect(monthHasFbrRecord([{ invoiceDate: '2026-10-03', psid: '', taxDepositedOn: '2026-11-15' }], '2026-10-01')).toBe(true)
    expect(monthHasFbrRecord(rows, null)).toBe(false)
  })
  it('past the 18th of the following month says yes, the 18th itself does not', () => {
    expect(gstReturnDueDay('2026-10-12')).toBe('2026-11-18')
    expect(gstReturnMayBeFiled('2026-10-12', '2026-11-18', false)).toBe(false)
    expect(gstReturnMayBeFiled('2026-10-12', '2026-11-19', false)).toBe(true)
    expect(gstReturnMayBeFiled('2026-12-02', '2027-01-10', false)).toBe(false)
    expect(gstReturnMayBeFiled('2026-12-02', '2027-01-19', false)).toBe(true)
  })
  it('a recorded FBR payment says yes whatever the day, and no date says no', () => {
    expect(gstReturnMayBeFiled('2026-10-12', '2026-10-13', true)).toBe(true)
    expect(gstReturnMayBeFiled(null, '2026-12-31', true)).toBe(false)
  })
})
