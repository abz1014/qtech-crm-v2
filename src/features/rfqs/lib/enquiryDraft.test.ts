import { describe, expect, it } from 'vitest'
import { computeReplyBy, generateEnquiryDraft, qtyText, type EnquiryInput, type EnquiryItem } from './enquiryDraft'

// Fri 27 Nov 2026 is "today" in the approved mockup; bid due Thu 3 Dec 2026.
const TODAY = '2026-11-27'
const signature = { name: 'Ayesha Rana', company: 'Q-Tech Solutions', jobTitle: 'Sales', phone: '+92 300 555 0188', email: 'ayesha@q-tech.example' }

const mockupItems: EnquiryItem[] = [
  { description: 'Endress+Hauser Proline Promag 400 electromagnetic flow meter, DN50', qty: 2, unit: 'nos' },
  { description: 'Hach HQ1110 portable pH/EC meter with probes', qty: 1, unit: 'no' },
  { description: 'Siemens SITRANS P320 pressure transmitter, 0-10 bar', qty: 4 },
  { description: '24V actuator for ball valve, DN40', qty: 2, unit: 'pcs' },
]

function input(over: Partial<EnquiryInput> = {}): EnquiryInput {
  return { rfqRef: 'RFQ-0185', items: mockupItems, dueOn: '2026-12-03', today: TODAY, signature, variant: 'whatsapp', ...over }
}

const ownerItems: EnquiryItem[] = [
  { description: 'SOFT STARTER - 30KW (MODEL:PSR60-600-70 ABB)', qty: 2, unit: 'nos' },
  { description: 'M-S DB (Size - 34" x 34" x 8" x 16-Swg,Power Coated)', qty: 1, unit: 'no' },
  { description: 'PLC MITSUBISHI - FX2N-128MR', qty: 1, unit: 'no' },
]

// The owner's own sample (2026-10-28), verbatim apart from the sender name.
const OWNER_TEXT = [
  'Hi hope you are doing well,',
  '',
  'Please quote your best price, availability and lead time for the following :',
  '',
  '1. SOFT STARTER - 30KW (MODEL:PSR60-600-70 ABB), 2 nos',
  '2. M-S DB (Size - 34" x 34" x 8" x 16-Swg,Power Coated), 1 no',
  '3. PLC MITSUBISHI - FX2N-128MR, 1 no',
  '',
  'Please include in your reply:',
  '* Unit price and currency',
  '* Lead time',
  '* Origin and authenticity (country of origin; original and genuine)',
  '* Stock position',
  '* MOQ, offer validity and payment terms',
  '* Please attach the data sheet and share pictures of the quoted items (these 2 requirements are very important)',
  '',
  'Kindly reply at your earliest convenience. If you cannot offer an item, please say so and we will look elsewhere.',
  '',
  'Thank you.',
  'Regards,',
  'Abdullah Sajid',
  'Q-Tech Solutions',
].join('\n')

const sender = { name: 'Abdullah Sajid', company: 'Q-Tech Solutions' }

describe('owner format (exact text)', () => {
  it('WhatsApp is the owner sample, blank specs omitted', () => {
    const d = generateEnquiryDraft(input({ items: ownerItems, signature: sender }))
    expect(d.body).toBe(OWNER_TEXT)
    expect(d.subject).toBeNull()
  })
  it('email has the same body and a neutral subject without the RFQ number', () => {
    const d = generateEnquiryDraft(input({ items: ownerItems, signature: sender, variant: 'email' }))
    expect(d.body).toBe(OWNER_TEXT)
    expect(d.subject).toBe('Request for quotation: SOFT STARTER - 30KW (MODEL:PSR60-600-70 ABB) and 2 more')
  })
  it('single-item subject has no "and N more"', () => {
    const d = generateEnquiryDraft(input({ items: [ownerItems[2]], signature: sender, variant: 'email' }))
    expect(d.subject).toBe('Request for quotation: PLC MITSUBISHI - FX2N-128MR')
  })
  it('a filled spec adds an indented Spec line; a blank spec adds none', () => {
    const its: EnquiryItem[] = [
      { description: 'Cable 4x1.5 mm2', qty: 150, unit: 'm', spec: 'Armoured, copper\n  600/1000 V' },
      { description: 'Valve', qty: 1, spec: '   ' },
      { description: 'Relay', qty: 3, spec: null },
    ]
    for (const variant of ['whatsapp', 'email'] as const) {
      const body = generateEnquiryDraft(input({ items: its, variant })).body
      expect(body).toContain('1. Cable 4x1.5 mm2, 150 m\n   Spec: Armoured, copper\n   600/1000 V\n2. Valve, 1 no\n3. Relay, 3 nos\n\nPlease include')
      expect(body).not.toMatch(/left blank/i)
    }
  })
  it('brand is added only when the description lacks it', () => {
    const its: EnquiryItem[] = [
      { description: 'LF24-SR actuator', brandName: 'Belimo', qty: 3 },
      { description: 'Belimo NM24A actuator', brandName: 'Belimo', qty: 1 },
    ]
    const body = generateEnquiryDraft(input({ items: its })).body
    expect(body).toContain('1. Belimo LF24-SR actuator, 3 nos\n2. Belimo NM24A actuator, 1 no\n')
  })
})

describe('content', () => {
  const wa = generateEnquiryDraft(input()).body
  const em = generateEnquiryDraft(input({ variant: 'email' })).body

  it('lists item, qty and unit for every item', () => {
    expect(wa).toContain('1. Endress+Hauser Proline Promag 400 electromagnetic flow meter, DN50, 2 nos')
    expect(wa).toContain('2. Hach HQ1110 portable pH/EC meter with probes, 1 no')
    expect(wa).toContain('3. Siemens SITRANS P320 pressure transmitter, 0-10 bar, 4 nos')
  })

  it('has no religious greeting, no RFQ number and no date, in either variant or the subject', () => {
    const d = generateEnquiryDraft(input({ variant: 'email' }))
    for (const t of [wa, em, d.subject ?? '']) {
      expect(t).not.toMatch(/assalam|salam|jazak|inshaallah|insha|\bAoA\b/i)
      expect(t).not.toMatch(/RFQ|our ref/i)
      expect(t).not.toContain('*RFQ')
    }
    expect(wa).toContain('Kindly reply at your earliest convenience.')
    expect(wa).toContain('(these 2 requirements are very important)')
  })

  it('signs with the sender name and company only', () => {
    expect(wa.endsWith('Thank you.\nRegards,\nAyesha Rana\nQ-Tech Solutions')).toBe(true)
    expect(em.endsWith('Thank you.\nRegards,\nAyesha Rana\nQ-Tech Solutions')).toBe(true)
  })

  it('never names the customer or any price of ours (it has no such input)', () => {
    expect(wa + em).not.toMatch(/mianwali|customer|budget|margin/i)
  })

  it('is deterministic', () => {
    expect(generateEnquiryDraft(input())).toEqual(generateEnquiryDraft(input()))
  })

  it('refuses an enquiry with no items', () => {
    expect(() => generateEnquiryDraft(input({ items: [] }))).toThrow(RangeError)
  })
})

describe('Spec is never invented', () => {
  const specLines = (body: string) => body.split('\n').filter((l) => l.startsWith('   '))

  it('items without a spec get no Spec line, even when the description is full of spec-like text', () => {
    const its: EnquiryItem[] = [
      { description: 'Pressure transmitter 0-10 bar, 4-20 mA, 24 VDC, IP67, SS316', brandName: 'Siemens', qty: 1 },
      { description: 'x', qty: 1, spec: '   ' },
      { description: 'y', qty: 1, spec: '' },
      { description: 'z', qty: 1, spec: null },
    ]
    expect(specLines(generateEnquiryDraft(input({ items: its })).body)).toEqual([])
  })

  it('an item that carries a spec gets exactly that text; the others get no line', () => {
    const its: EnquiryItem[] = [
      { description: 'A', qty: 1, spec: 'DN50, PN16, flanged' },
      { description: 'B', qty: 1 },
    ]
    expect(specLines(generateEnquiryDraft(input({ items: its })).body)).toEqual(['   Spec: DN50, PN16, flanged'])
  })
})

describe('reply-by = due - 3 days', () => {
  it('plain case', () => {
    expect(computeReplyBy('2026-12-03', TODAY)).toEqual({ date: '2026-11-30', rule: 'due_minus_3', afterDue: false })
  })

  it('a Saturday or Sunday candidate moves back to Friday', () => {
    // due Tue 1 Dec -> Sat 28 Nov -> Fri 27 Nov; but today is Fri 27 Nov so use an earlier today
    expect(computeReplyBy('2026-12-01', '2026-11-20')).toEqual({ date: '2026-11-27', rule: 'weekend_to_friday', afterDue: false })
    // due Wed 2 Dec -> Sun 29 Nov -> Fri 27 Nov
    expect(computeReplyBy('2026-12-02', '2026-11-20')).toEqual({ date: '2026-11-27', rule: 'weekend_to_friday', afterDue: false })
  })

  it('never earlier than tomorrow', () => {
    // due in 2 days -> candidate yesterday -> tomorrow (Sat 28 Nov rolls to Mon 30 Nov)
    expect(computeReplyBy('2026-11-29', TODAY).date).toBe('2026-11-30')
    // mid-week: today Mon 2 Nov, due Wed 4 Nov -> candidate Sun 1 Nov -> tomorrow Tue 3 Nov
    expect(computeReplyBy('2026-11-04', '2026-11-02')).toEqual({ date: '2026-11-03', rule: 'not_before_tomorrow', afterDue: false })
  })

  it('a due date of today or in the past still gives tomorrow (flagged as after the due date)', () => {
    expect(computeReplyBy('2026-11-27', '2026-11-27')).toEqual({ date: '2026-11-30', rule: 'not_before_tomorrow', afterDue: true })
    expect(computeReplyBy('2026-11-01', '2026-11-27').afterDue).toBe(true)
    expect(computeReplyBy('2026-11-03', '2026-11-02')).toEqual({ date: '2026-11-03', rule: 'not_before_tomorrow', afterDue: false })
  })

  it('tomorrow on a weekend rolls forward to Monday', () => {
    expect(computeReplyBy('2026-11-30', '2026-11-27').date).toBe('2026-11-30') // Fri -> Sat -> Mon
    expect(computeReplyBy('2026-11-30', '2026-11-28').date).toBe('2026-11-30') // Sat -> Sun -> Mon
  })

  it('exactly 3 days: due Fri, candidate Tue', () => {
    expect(computeReplyBy('2026-12-04', '2026-11-27').date).toBe('2026-12-01')
  })

  it('no, empty or unreadable due date: no date', () => {
    for (const d of [null, undefined, '', 'next week', '2026-13-45']) {
      expect(computeReplyBy(d, TODAY)).toEqual({ date: null, rule: 'no_due_date', afterDue: false })
    }
  })

  it('a timestamp is accepted as its date', () => {
    expect(computeReplyBy('2026-12-03T00:00:00Z', TODAY).date).toBe('2026-11-30')
  })

  it('crosses month and year ends', () => {
    expect(computeReplyBy('2027-01-02', '2026-12-20').date).toBe('2026-12-30')
    expect(computeReplyBy('2026-03-02', '2026-02-20').date).toBe('2026-02-27')
  })

  it('the draft reports the date but never prints one', () => {
    expect(generateEnquiryDraft(input({ dueOn: '2026-12-03' })).replyBy.date).toBe('2026-11-30')
    const noDue = generateEnquiryDraft(input({ dueOn: null }))
    expect(noDue.replyBy.date).toBeNull()
    expect(generateEnquiryDraft(input({ dueOn: '2026-12-03' })).body).toBe(noDue.body)
  })
})

describe('qtyText', () => {
  it.each([
    [1, undefined, '1 no'],
    [2, 'nos', '2 nos'],
    [2, 'pcs', '2 nos'],
    [1, 'pc', '1 no'],
    [3, null, '3 nos'],
    [150, 'm', '150 m'],
    [1500, 'm', '1,500 m'],
    [2.5, 'kg', '2.5 kg'],
    [0.125, 'm', '0.125 m'],
  ])('%s %s -> %s', (q, u, want) => expect(qtyText(q, u)).toBe(want))

  it('a missing or unusable quantity is left out, never guessed', () => {
    expect(qtyText(0, 'm')).toBeNull()
    expect(qtyText(Number.NaN)).toBeNull()
    const d = generateEnquiryDraft(input({ items: [{ description: 'Odd item', qty: 0 }] }))
    expect(d.body).toContain('1. Odd item\n')
  })
})
