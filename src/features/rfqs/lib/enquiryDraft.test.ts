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

describe('snapshots', () => {
  it('WhatsApp, the four mockup items', () => {
    expect(generateEnquiryDraft(input()).body).toMatchSnapshot()
  })
  it('email, the four mockup items', () => {
    const d = generateEnquiryDraft(input({ variant: 'email' }))
    expect(d.subject).toMatchSnapshot()
    expect(d.body).toMatchSnapshot()
  })
  it('single item, WhatsApp and email', () => {
    const one = [mockupItems[1]]
    expect(generateEnquiryDraft(input({ items: one })).body).toMatchSnapshot()
    const e = generateEnquiryDraft(input({ items: one, variant: 'email' }))
    expect(e.subject).toMatchSnapshot()
    expect(e.body).toMatchSnapshot()
  })
  it('no due date, WhatsApp and email', () => {
    expect(generateEnquiryDraft(input({ dueOn: null })).body).toMatchSnapshot()
    const e = generateEnquiryDraft(input({ dueOn: null, variant: 'email' }))
    expect(e.subject).toMatchSnapshot()
    expect(e.body).toMatchSnapshot()
  })
  it('20 items, WhatsApp', () => {
    const many: EnquiryItem[] = Array.from({ length: 20 }, (_, i) => ({ description: `Pressure gauge model PG-${100 + i}`, qty: i + 1, unit: i % 4 === 0 ? 'm' : 'pcs' }))
    expect(generateEnquiryDraft(input({ items: many })).body).toMatchSnapshot()
  })
  it('missing brand, brand given separately, and a spec carried by the item', () => {
    const its: EnquiryItem[] = [
      { description: 'Ball valve DN40, PN16', qty: 6 },
      { description: 'LF24-SR actuator', brandName: 'Belimo', qty: 3 },
      { description: 'Belimo NM24A actuator', brandName: 'Belimo', qty: 1 },
      { description: 'Cable 4x1.5 mm2', qty: 150, unit: 'm', spec: 'Armoured, copper\n  600/1000 V' },
    ]
    expect(generateEnquiryDraft(input({ items: its })).body).toMatchSnapshot()
  })
})

describe('content', () => {
  const wa = generateEnquiryDraft(input()).body
  const em = generateEnquiryDraft(input({ variant: 'email' })).body

  it('lists item, qty, unit and spec for every item', () => {
    expect(wa).toContain('1. Endress+Hauser Proline Promag 400 electromagnetic flow meter, DN50, 2 nos')
    expect(wa).toContain('2. Hach HQ1110 portable pH/EC meter with probes, 1 no')
    expect(wa).toContain('3. Siemens SITRANS P320 pressure transmitter, 0-10 bar, 4 nos')
    expect(wa.match(/ {3}Spec: left blank/g)).toHaveLength(4)
  })

  it('asks for price + currency, lead time, origin/authenticity, stock, MOQ/validity/payment terms (both variants)', () => {
    for (const t of [wa, em]) {
      expect(t).toContain('Unit price and currency')
      expect(t).toContain('Lead time')
      expect(t).toContain('Origin and authenticity')
      expect(t).toContain('Stock position')
      expect(t).toContain('MOQ, offer validity and payment terms')
    }
  })

  it('WhatsApp uses *bold* markers and the mockup greeting; email does not and has a subject', () => {
    expect(wa.startsWith('Assalam o Alaikum,\n')).toBe(true)
    expect(wa).toContain('(our ref *RFQ-0185*)')
    expect(wa).toContain('Kindly reply by *Monday 30 November*.')
    expect(em).not.toContain('*')
    expect(em).toContain('Dear Sir / Madam,\nAssalam o Alaikum.')
    expect(generateEnquiryDraft(input({ variant: 'email' })).subject).toBe('RFQ-0185: quotation requested for 4 items, reply by Monday 30 November')
    expect(generateEnquiryDraft(input()).subject).toBeNull()
  })

  it('signs with the sender; email adds role, phone and email address', () => {
    expect(wa.endsWith('Regards,\nAyesha Rana\nQ-Tech Solutions')).toBe(true)
    expect(wa).not.toContain('+92')
    expect(em.endsWith('With best regards,\nAyesha Rana\nSales, Q-Tech Solutions\n+92 300 555 0188\nayesha@q-tech.example')).toBe(true)
  })

  it('email signature copes with no role, phone or email', () => {
    const e = generateEnquiryDraft(input({ variant: 'email', signature: { name: 'Ayesha Rana', company: 'Q-Tech Solutions' } })).body
    expect(e.endsWith('With best regards,\nAyesha Rana\nQ-Tech Solutions')).toBe(true)
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
  const specLines = (body: string) => body.split('\n').filter((l) => l.startsWith('   Spec: '))

  it('items without a spec get "left blank", even when the description is full of spec-like text', () => {
    const its: EnquiryItem[] = [
      { description: 'Pressure transmitter 0-10 bar, 4-20 mA, 24 VDC, IP67, SS316', brandName: 'Siemens', qty: 1 },
      { description: 'x', qty: 1, spec: '   ' },
      { description: 'y', qty: 1, spec: '' },
      { description: 'z', qty: 1, spec: null },
    ]
    expect(specLines(generateEnquiryDraft(input({ items: its })).body)).toEqual(Array(4).fill('   Spec: left blank'))
  })

  it('an item that carries a spec gets exactly that text; the others stay blank', () => {
    const its: EnquiryItem[] = [
      { description: 'A', qty: 1, spec: 'DN50, PN16, flanged' },
      { description: 'B', qty: 1 },
    ]
    expect(specLines(generateEnquiryDraft(input({ items: its })).body)).toEqual(['   Spec: DN50, PN16, flanged', '   Spec: left blank'])
  })

  it('every Spec value is the item\'s own spec or "left blank" (nothing else can appear)', () => {
    const its: EnquiryItem[] = [
      { description: 'Flow meter DN50 PN16 316L', brandName: 'Endress+Hauser', qty: 2, unit: 'nos' },
      { description: 'Cable', qty: 100, unit: 'm', spec: 'Armoured' },
      { description: 'Valve', qty: 1 },
    ]
    for (const variant of ['whatsapp', 'email'] as const) {
      const d = generateEnquiryDraft(input({ items: its, variant }))
      const allowed = new Set(its.map((i) => `   Spec: ${i.spec ?? 'left blank'}`))
      for (const l of specLines(d.body)) expect(allowed.has(l)).toBe(true)
    }
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

  it('the draft states the date and the no-date wording', () => {
    expect(generateEnquiryDraft(input({ dueOn: '2026-12-03' })).replyBy.date).toBe('2026-11-30')
    const noDue = generateEnquiryDraft(input({ dueOn: null }))
    expect(noDue.replyBy.date).toBeNull()
    expect(noDue.body).toContain('Kindly reply at your earliest convenience.')
    expect(noDue.body).not.toMatch(/\*(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day/)
    expect(generateEnquiryDraft(input({ dueOn: null, variant: 'email' })).subject).toBe('RFQ-0185: quotation requested for 4 items')
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
