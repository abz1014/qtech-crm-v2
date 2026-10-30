import { describe, expect, it } from 'vitest'
import { creditGst } from '@/features/money/invoices/creditNotes'
import { invoiceNextStep, isCreditNote, isInert, registerTotals, stampable, tcsNotSent, type GstRow } from '@/features/money/invoices/model'
import { buildCreditNoteDoc, creditNoteFileName, type CreditNotePdfSource } from '@/features/money/invoices/pdf/creditNoteDoc'

const row = (o: Partial<GstRow> = {}): GstRow => ({
  invoiceId: 'i1',
  number: 'INV-1',
  invoiceDate: '2026-10-05',
  orderId: 'o1',
  orderNumber: 1,
  companyId: 'c1',
  companyName: 'Acme',
  net: 1000,
  gst: 180,
  gross: 1180,
  courierState: 'not_started',
  fbrState: 'pending',
  fbrException: false,
  needsAttention: false,
  psid: null,
  taxDepositedOn: null,
  ...o,
})

describe('creditGst (the GST a credit note carries, as create_credit_note works it out)', () => {
  const inv = { net: 500, gst: 90 }
  it('is the invoice GST in proportion', () => {
    expect(creditGst(inv, { net: 0, gst: 0 }, 200)).toBe(36)
  })
  it('is everything left when the credit completes the invoice', () => {
    expect(creditGst(inv, { net: 200, gst: 36 }, 300)).toBe(54)
  })
  it('never more than is left', () => {
    expect(creditGst({ net: 100, gst: 18 }, { net: 0, gst: 17 }, 50)).toBe(1)
  })
  it('is 0 for nothing to credit or an exempt invoice', () => {
    expect(creditGst(inv, { net: 0, gst: 0 }, 0)).toBe(0)
    expect(creditGst({ net: 500, gst: 0 }, { net: 0, gst: 0 }, 100)).toBe(0)
  })
})

describe('the register with credit notes and voids', () => {
  const credit = row({ invoiceId: 'cn1', number: 'CN-0001', rowKind: 'credit_note', net: -200, gst: -36, gross: -236, againstNumber: 'INV-1', againstInvoiceId: 'i1' })
  const voided = row({ invoiceId: 'v1', number: 'INV-2', net: 0, gst: 0, gross: 0, voided: true, voidReason: 'Wrong customer' })
  it('a credit note and a void line are not invoices to stamp or send', () => {
    expect(isCreditNote(credit)).toBe(true)
    expect(isInert(voided)).toBe(true)
    expect(stampable([row(), credit, voided], 'psid').map(r => r.invoiceId)).toEqual(['i1'])
    expect(stampable([row(), credit, voided], 'tcs').map(r => r.invoiceId)).toEqual(['i1'])
    expect(tcsNotSent(credit)).toBe(false)
    expect(tcsNotSent(voided)).toBe(false)
  })
  it('their Next step is done, with the why', () => {
    expect(invoiceNextStep(credit)).toMatchObject({ tone: 'done', label: 'Credit note', detail: 'Against INV-1' })
    expect(invoiceNextStep(voided)).toMatchObject({ tone: 'done', label: 'Void', detail: 'Wrong customer' })
  })
  it('the totals add the credit note as a negative line and count invoices only', () => {
    expect(registerTotals([row(), credit, voided])).toEqual({ count: 1, net: 800, gst: 144, gross: 944 })
  })
})

describe('the credit note PDF document', () => {
  const src: CreditNotePdfSource = {
    creditNote: { id: 'cn1', number: 'CN-0001', issuedOn: '2026-10-20', net: '200.00', gst: '36.00', reason: 'Part returned' },
    invoice: { number: 'INV-1', invoiceDate: '2026-10-05' },
    order: { number: 12, customerPo: 'PO-9' },
    buyer: { id: 'c1', name: 'Acme', ntn: '1234567-8', strn: null, salesTaxRegistered: false, invoiceAddress: 'Karachi' },
    siteAddress: null,
  }
  const profile = { legal_name: 'Q-Tech' } as never
  it('prints the stored figures, the invoice it credits and the amount in words', () => {
    const r = buildCreditNoteDoc(src, profile)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.doc).toMatchObject({ number: 'CN-0001', invoiceNumber: 'INV-1', reason: 'Part returned', net: 20000n, gst: 3600n, gross: 23600n, orderRef: 'ORD-0012' })
    expect(r.doc.words).toMatch(/rupees only\.$/i)
  })
  it('says what is missing instead of making a half document', () => {
    const r = buildCreditNoteDoc({ ...src, buyer: { ...src.buyer!, invoiceAddress: null } }, profile)
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.gaps.join(' ')).toMatch(/invoice address/)
  })
  it('names the file after the number', () => {
    expect(creditNoteFileName('CN-0001')).toBe('CN-0001.pdf')
  })
})
