import { describe, expect, it } from 'vitest'
import type { ReplyItemRef } from '@/features/rfqs/lib/replyParse'
import { parseSupplierQuote } from './supplierQuoteParse'

const TODAY = '2026-10-28'
const ITEMS: ReplyItemRef[] = [
  { id: 'a', description: 'Safety relay PSR60-600-70', qty: 2 },
  { id: 'b', description: 'PLC base unit FX2N-128MR', qty: 1 },
  { id: 'c', description: 'Overload relay 3RU5156-3JB2', qty: 4 },
]

// As the picture reader renders a ruled grid quote (tab-separated cells), synthetic supplier.
const OCR = `Hangzhou Demo Controls Co., Ltd
https://demo-controls.example/
Unit 12, Example Road, Hangzhou, China
No.	Product/Service Name	Unit Price (USD)	Quantity	Total Price (USD)
1	PSR60-600-70	378	2	756
2	FX2N-128MR	302	1	302
3	3RU5156-3JB2	151	4	604
Total (USD)		1662
Delivery time: 5 - 7 days
Warranty:1 year
Shipping method: DHL
FedEx/TNT/UPS
Payment methods:TT, Western Union
Offer validity period:1 month

WhatsApp: +86 18000000000
WeChat: +86 18000000000
Quote Date:2026-10-26`

const check = (text: string, items = ITEMS, currency = true) => {
  const r = parseSupplierQuote(text, items, { today: TODAY })
  const by = (id: string) => r.offers.find(o => o.rfqItemId === id)
  expect(r.offers.filter(o => o.unitPrice !== null)).toHaveLength(3)
  expect([by('a')?.unitPrice, by('b')?.unitPrice, by('c')?.unitPrice]).toEqual([378, 302, 151])
  expect([by('a')?.qty, by('b')?.qty, by('c')?.qty]).toEqual([2, 1, 4])
  if (currency) expect(r.replyCurrency).toBe('USD')
  return r
}

describe('grid quote with a No. column', () => {
  it('reads the OCR text of a ruled grid', () => {
    const r = check(OCR)
    expect(r.facts.leadTime?.daysMax).toBe(7)
    expect(r.facts.validity?.days).toBe(30)
  })
  it('reads the same grid when the item order differs from the RFQ (match by part number)', () => {
    check(OCR, [ITEMS[2]!, ITEMS[0]!, ITEMS[1]!])
  })
  it('reads a pasted grid without OCR noise', () => {
    check(`No.\tDescription\tUnit Price (USD)\tQty\tAmount (USD)\n1\tPSR60-600-70\t378\t2\t756\n2\tFX2N-128MR\t302\t1\t302\n3\t3RU5156-3JB2\t151\t4\t604\nTotal\t\t1662`)
  })
  it('reads a grid with no heading either way round (quantity and price cannot swap)', () => {
    const rows = '1\tPSR60-600-70\t378\t2\t756\n2\tFX2N-128MR\t302\t1\t302\n3\t3RU5156-3JB2\t151\t4\t604'
    check(rows, ITEMS, false)
    check(rows.replace(/\t(\d+)\t(\d+)\t(\d+)$/gm, '\t$2\t$1\t$3'), ITEMS, false)
    // Generic RFQ wording: matched by the row's position, the serial number never becomes a price or quantity.
    check(rows, [
      { id: 'a', description: 'Safety relay', qty: 2 },
      { id: 'b', description: 'PLC base unit', qty: 1 },
      { id: 'c', description: 'Overload relay', qty: 4 },
    ], false)
  })
  it('reads rows with single spaces between the cells', () => {
    check('No. Product Name Unit Price (USD) Quantity Total Price (USD)\n1 PSR60-600-70 378 2 756\n2 FX2N-128MR 302 1 302\n3 3RU5156-3JB2 151 4 604\nTotal (USD) 1662')
  })
  it('reads a low-resolution picture: heading cells on separate lines and misread, a garbled price left empty', () => {
    const r = parseSupplierQuote(
      `Hangzhou
Demo Controls Co, Ltd
Xo.
Product/Service Nase
Unie Price (USD)
Quantity
Total Price (USD)
1\tmeen\t7s\t2\t756
2\tFION-\t02\t1\t02
3\t3RUS156-3782\t151\t4\tos
Total USD)\t1662
Delivery time: 5\t7 days
8\tWelhat: +86\tQuote Date:2026-10-26`,
      ITEMS,
      { today: TODAY },
    )
    const got = r.offers.filter(o => o.unitPrice !== null).map(o => [o.rfqItemId, o.unitPrice, o.qty])
    // The serial numbers (1, 2, 3) and the phone row are never prices; the unreadable price of item 2 is left blank, not guessed.
    expect(got).toEqual([['a', 378, 2], ['c', 151, 4]])
    expect(r.offers.every(o => o.rfqItemId !== null)).toBe(true)
  })
})
