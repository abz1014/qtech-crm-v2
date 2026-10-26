import { describe, expect, it } from 'vitest'
import { ENQUIRY_CORPUS } from '@/features/rfqs/lib/__fixtures__/enquiryCorpus'
import { parsePaste } from '@/features/rfqs/lib/parseItems'
import { ENQUIRY_HOLDOUT } from './__fixtures__/enquiryHoldout'
import { ENQUIRY_FULL_EMAILS } from './__fixtures__/enquiryFullEmails'
import { ENQUIRY_EMAIL_TABLES } from './__fixtures__/enquiryEmailTables'
import { CORPUS_TODAY, ENQUIRY_EMAILS, type EnquiryCase } from './__fixtures__/enquiryEmails'
import { norm, pct, scoreFact, scoreItems, type FactScore } from './__fixtures__/score'
import { unitFamily } from './corpus/units'
import { asParseResult, findDate, parseEnquiry, unitOf } from './enquiryParse'

const parse = (text: string) => parseEnquiry(text, { today: CORPUS_TODAY })

describe('parseEnquiry: what is not an item', () => {
  it('drops the signature, phone, email and address lines, and the disclaimer', () => {
    const r = parse(`Please quote 2 nos gate valve 4 inch class 150

Regards,
Bilal Khan
Purchase Officer
Tel: 042-35761234
bilal@northerncement.com.pk
DISCLAIMER: This e-mail is confidential.`)
    expect(r.items).toEqual([{ description: 'gate valve 4 inch class 150', qty: 2, unit: 'nos' }])
    expect(r.lines.filter(l => l.kind === 'skipped').map(l => l.reason)).toEqual(['signature', 'signature', 'signature', 'signature', 'signature', 'disclaimer'])
  })

  it('keeps only the new message of a reply, but a forward is read below its separator', () => {
    const reply = parse('1) Cable gland M20 - 20 Nos\nRegards\n-----Original Message-----\nFrom: x@qtech.example\n1) MCB 16A - 10 Nos')
    expect(reply.items.map(i => i.description)).toEqual(['Cable gland M20'])
    const fwd = parse('FYI\n---------- Forwarded message ---------\nFrom: a@b.com\nPlease quote 3 nos proximity sensor M18')
    expect(fwd.items).toEqual([{ description: 'proximity sensor M18', qty: 3, unit: 'nos' }])
  })

  it('strips WhatsApp export prefixes', () => {
    const r = parse('[20/10/2026, 10:13:02 AM] Bilal: Please quote 2 nos limit switch D4N\n20/10/26, 11:05 am - Kashif: Fluke 87V x2')
    expect(r.items).toEqual([
      { description: 'limit switch D4N', qty: 2, unit: 'nos' },
      { description: 'Fluke 87V', qty: 2, unit: null },
    ])
  })

  it('does not turn an "Our Ref" line, a date line or a note into an item', () => {
    const r = parse('Our Ref: NCL/PUR/0418\nRFQ Date: 14.10.2026\nNote: please mention origin\nBearing 6205 - 4 Nos')
    expect(r.items).toEqual([{ description: 'Bearing 6205', qty: 4, unit: 'nos' }])
    expect(r.lines.map(l => l.reason)).toEqual(['reference', 'date', 'instruction', null])
  })
})

describe('parseEnquiry: items over several lines and quantity shapes', () => {
  it('folds Make, Size and Qty lines into the item above', () => {
    const r = parse('1. Flow meter\n   Size: DN80\n   Make: Krohne\n   Qty: 2 Nos\n2. Level transmitter\n   Qty: 1 No')
    expect(r.items).toEqual([
      { description: 'Flow meter, Size: DN80, Make: Krohne', qty: 2, unit: 'nos' },
      { description: 'Level transmitter', qty: 1, unit: 'nos' },
    ])
    expect(r.lines.map(l => l.kind)).toEqual(['item', 'joined', 'joined', 'joined', 'item', 'joined'])
  })

  it('joins a wrapped line so its quantity is kept', () => {
    const r = parse('1. Pressure transmitter, 0-40 bar,\n   1/2" NPT - 3 Nos')
    expect(r.items).toEqual([{ description: 'Pressure transmitter, 0-40 bar, 1/2" NPT', qty: 3, unit: 'nos' }])
  })

  it.each([
    ['Cable tray 300mm, Qty : 03 NOS', 'Cable tray 300mm', 3, 'nos'],
    ['Solenoid valve 24VDC QTY REQUIRED: 01', 'Solenoid valve 24VDC', 1, null],
    ['Safety relay REQ QTY 5', 'Safety relay', 5, null],
    ['Encoder 1024 PPR Qty-2', 'Encoder 1024 PPR', 2, null],
    ['Bearing 6205 2.000 EA', 'Bearing 6205', 2, 'EA'],
    ['Proximity sensor M30 x2', 'Proximity sensor M30', 2, null],
    ['Flame scanner (2 Nos)', 'Flame scanner', 2, 'nos'],
    ['Hydraulic oil ISO VG 68 - 4 Drums', 'Hydraulic oil ISO VG 68', 4, 'Drums'],
    ['Gear motor 1.5kW, Qty: 2 Nos, Make: SEW', 'Gear motor 1.5kW, Make: SEW', 2, 'nos'],
    ['Siemens 6ES7 231-4HD32-0XB0 – 2', 'Siemens 6ES7 231-4HD32-0XB0', 2, null],
    ['Ultrasonic level transmitter 0-10m qty 3', 'Ultrasonic level transmitter 0-10m', 3, null],
  ])('%s', (line, description, qty, unit) => {
    expect(parse(line).items).toEqual([{ description, qty, unit }])
  })

  it('reads a table by its header, adds the part number and leaves out an internal material code', () => {
    const r = parse('Item\tMaterial\tDescription\tPart No\tQty\tUOM\n00010\t1000012345\tSafety relay 24VDC\tG9SA-301\t2.000\tEA')
    expect(r.items).toEqual([{ description: 'Safety relay 24VDC, Part No: G9SA-301', qty: 2, unit: 'EA' }])
  })

  it('normalises units as the intake does', () => {
    expect([unitOf('EA'), unitOf("No's"), unitOf('Mtr'), unitOf('No.'), unitOf('Kgs'), unitOf(null)]).toEqual(['EA', 'nos', 'm', 'nos', 'kg', null])
  })
})

describe('parseEnquiry: header facts', () => {
  it('prefers the RFQ number over a collective number, and keeps a reference written as one word', () => {
    expect(parse('Collective No.: 6000004512\nRFQ No.: 4500012345').facts.customerRef).toMatchObject({ value: '4500012345', label: 'RFQ' })
    expect(parse('Subject: RFQ-ST-2026-118 Pressure gauges').facts.customerRef?.value).toBe('RFQ-ST-2026-118')
    expect(parse('Your Ref: QT-RFQ-0118\nPlease quote 2 nos valve').facts.customerRef).toBeNull()
  })

  it('reads the quotation due date and never a delivery date', () => {
    expect(parse('Material required at site by 30/11/2026.\nPlease send quotation by 27-10-2026.').facts.dueDate?.iso).toBe('2026-10-27')
    expect(parse('Quotations must reach us before 11-NOV-26').facts.dueDate?.iso).toBe('2026-11-11')
    expect(parse('Due 22/10').facts.dueDate?.iso).toBe('2026-10-22')
    expect(parse('Due 05/01').facts.dueDate?.iso).toBe('2027-01-05') // no year and already past: next January
    expect(parse('Required delivery date: 30/11/2026').facts.dueDate).toBeNull()
  })

  it('never reads a size or a fraction as a date', () => {
    expect(findDate('Ball valve 1/2" and gauge 2.5 inch', CORPUS_TODAY)).toBeNull()
    expect(findDate('23rd October 2026', CORPUS_TODAY)?.iso).toBe('2026-10-23')
    expect(findDate('11-JUL-26', CORPUS_TODAY)?.iso).toBe('2026-07-11')
  })

  it('offers the signature company and the sender domain, never our own or a free mail domain', () => {
    const r = parse('Please quote 1 no PLC\nRegards\nAsad\nIndus Fibres Ltd.\nasad@gmail.com\nFrom: sales@qtech.example')
    expect(r.facts.company).toMatchObject({ name: 'Indus Fibres Ltd.', domain: null })
    const d = parse('From: Waqas <waqas@sialkottanneries.com>\nPlease quote 2 nos gauge')
    expect(d.facts.company).toMatchObject({ name: null, domain: 'sialkottanneries.com', emails: ['waqas@sialkottanneries.com'] })
  })

  it('gives the intake its own ParseResult shape for the paste panel', () => {
    const r = asParseResult(parse('Hi\n1. Flow meter\n   Qty: 2 Nos'))
    expect(r).toEqual({
      items: [{ description: 'Flow meter', qty: 2, unit: 'nos' }],
      lines: [
        { text: 'Hi', kind: 'skipped', marker: null },
        { text: '1. Flow meter', kind: 'item', marker: '1.' },
        { text: 'Qty: 2 Nos', kind: 'item', marker: null },
      ],
      lineCount: 3,
    })
  })

  it('keeps the text as given, for the RFQ notes', () => {
    const text = 'Dear Sir,\r\nPlease quote 2 nos valve'
    expect(parse(text).raw).toBe(text)
  })
})

describe('the enquiry corpus (realistic emails, WhatsApp exports, PDF text)', () => {
  it('has at least 25 cases', () => {
    expect(ENQUIRY_EMAILS.length).toBeGreaterThanOrEqual(25)
  })

  it.each(ENQUIRY_EMAILS.map(c => [c.name, c] as const))('%s', (_n, c) => {
    const r = parse(c.text)
    expect(r.items).toEqual(c.items)
    expect(r.facts.customerRef?.value ?? undefined).toBe(c.ref)
    expect(r.facts.dueDate?.iso ?? undefined).toBe(c.due)
    if (c.company?.name) expect(norm(r.facts.company?.name)).toBe(norm(c.company.name))
    if (c.company?.domain) expect(r.facts.company?.domain).toBe(c.company.domain)
  })

  it('still reads every case of the intake corpus exactly as the old parser does', () => {
    // Same items; the unit is the customer's own now ("pcs" stays pcs), so it is compared by family (corpus/units.ts).
    const fam = (xs: Array<{ description: string; qty: number; unit: string | null }>) => xs.map(x => ({ ...x, unit: unitFamily(x.unit) === 'pcs' || unitFamily(x.unit) === 'ea' ? 'nos' : unitFamily(x.unit) }))
    for (const c of ENQUIRY_CORPUS) expect(fam(parse(c.text).items), c.name).toEqual(fam(c.items))
  })
})

describe('old parser (parsePaste) against the new one', () => {
  interface Row {
    corpus: string
    parser: string
    precision: string
    recall: string
    ref: string
    due: string
    company: string
    p: number
    r: number
  }

  function measure(corpus: string, cases: EnquiryCase[]): Row[] {
    return (['old', 'new'] as const).map(parser => {
      let expected = 0
      let predicted = 0
      let correct = 0
      const ref: FactScore = { expected: 0, predicted: 0, correct: 0 }
      const due: FactScore = { expected: 0, predicted: 0, correct: 0 }
      const company: FactScore = { expected: 0, predicted: 0, correct: 0 }
      for (const c of cases) {
        const r = parser === 'old' ? { items: parsePaste(c.text).items, facts: null } : parse(c.text)
        const s = scoreItems(c.items, r.items)
        expected += s.expected
        predicted += s.predicted
        correct += s.correct
        scoreFact(c.ref, r.facts?.customerRef?.value, ref)
        scoreFact(c.due, r.facts?.dueDate?.iso, due)
        const want = c.company?.name ?? c.company?.domain
        const got = c.company?.name ? r.facts?.company?.name : r.facts?.company?.domain
        scoreFact(want, got, company)
      }
      const f = (x: FactScore) => `${x.correct}/${x.expected}`
      return {
        corpus,
        parser,
        precision: `${pct(correct, predicted)} (${correct}/${predicted})`,
        recall: `${pct(correct, expected)} (${correct}/${expected})`,
        ref: f(ref),
        due: f(due),
        company: f(company),
        p: predicted ? correct / predicted : 1,
        r: expected ? correct / expected : 1,
      }
    })
  }

  const rows = [
    ...measure(`emails (${ENQUIRY_EMAILS.length})`, ENQUIRY_EMAILS),
    ...measure(`held-out (${ENQUIRY_HOLDOUT.length})`, ENQUIRY_HOLDOUT),
    ...measure(
      `intake corpus (${ENQUIRY_CORPUS.length})`,
      ENQUIRY_CORPUS.map(c => ({ ...c })),
    ),
  ]

  it('reports item precision and recall, and the facts read', () => {
    // A row is right when its description is the expected item's (word overlap of 0.7 or more) and its quantity is equal.
    console.log(
      ['ENQUIRY_PARSER_ACCURACY', 'corpus | parser | item precision | item recall | ref | due date | company']
        .concat(rows.map(x => `${x.corpus} | ${x.parser} | ${x.precision} | ${x.recall} | ${x.ref} | ${x.due} | ${x.company}`))
        .join('\n'),
    )
    for (let k = 0; k < rows.length; k += 2) {
      const [old, neu] = [rows[k] as Row, rows[k + 1] as Row]
      expect(neu.p, `${neu.corpus} precision`).toBeGreaterThanOrEqual(old.p)
      expect(neu.r, `${neu.corpus} recall`).toBeGreaterThanOrEqual(old.r)
    }
    expect(rows[1]?.r).toBe(1)
    expect(rows[1]?.p).toBe(1)
    expect(rows[3]?.r).toBeGreaterThanOrEqual(0.9)
  })
})

describe('parseEnquiry: whole emails as the owner pastes them (held-out set, owner test 2026-10-20)', () => {
  it('only the real items come out: item precision 95% or more, every case listed when it is not', () => {
    let expected = 0
    let predicted = 0
    let correct = 0
    const misses: string[] = []
    for (const c of ENQUIRY_FULL_EMAILS) {
      const r = parse(c.text)
      const s = scoreItems(c.items, r.items)
      expected += s.expected
      predicted += s.predicted
      correct += s.correct
      if (s.correct !== s.expected || s.predicted !== s.expected) misses.push(`${c.name}: ${JSON.stringify(r.items.map(x => [x.description, x.qty]))}`)
    }
    console.log(`FULL_EMAILS precision ${pct(correct, predicted)} (${correct}/${predicted}) recall ${pct(correct, expected)} (${correct}/${expected})\n${misses.join('\n')}`)
    expect(ENQUIRY_FULL_EMAILS.length).toBeGreaterThanOrEqual(15)
    expect(correct / predicted).toBeGreaterThanOrEqual(0.95)
    expect(correct / expected).toBeGreaterThanOrEqual(0.9)
  })
})

describe('parseEnquiry: the shapes the sales verification found (BUG-SALES-1, BUG-SALES-2; fictional)', () => {
  const rows = (text: string) => parse(text).items.map(i => [i.description, i.qty, i.unit])

  it('a WhatsApp Web copy of several messages: prefixes, the greeting and the sign-off go, a range stays in the description', () => {
    const text = [
      '[10:41, 19/10/2026] Bilal Ahmed: Assalam o Alaikum',
      '[10:42, 19/10/2026] Bilal Ahmed: Please quote 2 nos radar level transmitter 0-10 m',
      '[10:42, 19/10/2026] Bilal Ahmed: 4 pcs pressure gauge 0-16 bar',
      '[10:43, 19/10/2026] Bilal Ahmed: Regards',
    ].join('\n')
    expect(rows(text)).toEqual([
      ['radar level transmitter 0-10 m', 2, 'nos'],
      ['pressure gauge 0-16 bar', 4, 'pcs'],
    ])
  })

  it('a spreadsheet block with a header row counts its rows only: "2 items found in 2 lines"', () => {
    const r = asParseResult(parse(['S.No\tDescription\tQty\tUnit', '1\tBall valve 1 inch SS316\t6\tnos', '2\tSignal cable 4 core\t150\tm'].join('\n')))
    expect([r.items.length, r.lineCount]).toEqual([2, 2])
  })

  it('an unmarked email: nothing after "Regards," is an item (name, job title, phone)', () => {
    const text = ['Dear Sir,', 'Please quote the following:', 'Turbine flow meter DN80 - 2 nos', 'Float level switch 1000 mm - 1 no', 'Best regards,', 'Usman Tariq', 'Senior Purchase Officer', '0321-7654321'].join('\n')
    expect(rows(text)).toEqual([
      ['Turbine flow meter DN80', 2, 'nos'],
      ['Float level switch 1000 mm', 1, 'nos'],
    ])
  })
})

describe('parseEnquiry: an Outlook table with no header row (held-out set, owner case 2026-10-20)', () => {
  for (const c of ENQUIRY_EMAIL_TABLES) {
    it(c.name, () => {
      const r = parse(c.text)
      // Every row: the description as written (a "-01" suffix and dashed part numbers kept), the quantity and the customer's unit.
      expect(r.items.map(x => [x.description, x.qty, x.unit])).toEqual(c.items.map(x => [x.description, x.qty, x.unit]))
      expect(r.facts.customerRef?.value ?? null).toBe(c.ref ?? null)
      expect(r.facts.company?.name ?? null).toBe(c.company?.name ?? null)
    })
  }
})

describe('parseEnquiry: a printed form whose part number breaks at a dash (fictional)', () => {
  it('joins "6ES7000-1AA00-" and "0AB0" back into one part number', () => {
    const r = parse(['PR.#', 'Item Description', 'UOM', 'Quantity', '700991\t2XY OPERATOR PANEL\tOPERATOR PANEL ,MAKE\tNO\t2', 'EXAMPLE,TYPE KP700 6ES7000-1AA00-', '0AB0'].join('\n'))
    expect(r.items).toHaveLength(1)
    expect(r.items[0]?.description).toContain('6ES7000-1AA00-0AB0')
    expect(r.items[0]?.qty).toBe(2)
  })
})

describe('parseEnquiry: edge cases from the bug hunt (2026-10-22)', () => {
  const rows = (t: string) => parse(t).items.map(i => [i.description, i.qty, i.unit])

  it('keeps a list pasted with leading spaces as one item per line, and still joins a wrapped line', () => {
    expect(rows('Pressure gauge 0-10 bar - 2 Nos\n    Ball valve 1 inch - 4 Nos\n    Cable gland PG16 - 10 Nos')).toEqual([
      ['Pressure gauge 0-10 bar', 2, 'nos'],
      ['Ball valve 1 inch', 4, 'nos'],
      ['Cable gland PG16', 10, 'nos'],
    ])
    expect(rows('Solenoid valve 1/2 inch 24VDC\n    brass body, NC - 2 Nos')).toEqual([['Solenoid valve 1/2 inch 24VDC brass body, NC', 2, 'nos']])
  })

  it('reads Urdu quantities and request words, and decimal quantities', () => {
    expect(rows('1. Relay 24VDC - 4 عدد\n2. Thermocouple type K 300mm  ۲ عدد بھیج دیں')).toEqual([
      ['Relay 24VDC', 4, 'nos'],
      ['Thermocouple type K 300mm', 2, 'nos'],
    ])
    expect(rows('Silicone tube 8mm 0.5 m\nCable 4 core 2.5mm2 - 0.5 m\nTeflon tape 0.5 kg')).toEqual([
      ['Silicone tube 8mm', 0.5, 'm'],
      ['Cable 4 core 2.5mm2', 0.5, 'm'],
      ['Teflon tape', 0.5, 'kg'],
    ])
  })
})

describe('parseEnquiry: corpus batches 12 and 13 (fictional)', () => {
  const rows = (t: string) => parse(t).items.map(i => [i.description, i.qty, i.unit])

  it('skips section rows inside a table', () => {
    const text = [
      'S.No\tDescription of Material\tUOM\tQty',
      '\tA. ELECTRICAL\t\t',
      '1\tBearing 6205 ZZ\tPCS\t5',
      'INSTRUMENTATION ITEMS',
      '2\tPressure gauge 0-10 bar\tNOS\t2',
    ].join('\n')
    expect(rows(text)).toEqual([
      ['Bearing 6205 ZZ', 5, 'PCS'],
      ['Pressure gauge 0-10 bar', 2, 'nos'],
    ])
  })

  it('does not pull an item with its own quantity onto a line ending in "type"', () => {
    expect(rows('5 x Butterfly valve DN50, wafer type\n2 x Flow meter DN25')).toEqual([
      ['Butterfly valve DN50, wafer type', 5, null],
      ['Flow meter DN25', 2, null],
    ])
  })

  it('reads a portal line with labelled fields, a quantity in square brackets and running metres', () => {
    const r = parse('Buyer: Example Mills Ltd\nLine 1 | Short text: Relay 24VDC 2 CO | Quantity: 4 EA | Need by: 29/11/2026')
    expect(r.items).toEqual([{ description: 'Relay 24VDC 2 CO', qty: 4, unit: 'EA' }])
    expect(r.facts.company?.name).toBe('Example Mills Ltd')
    expect(rows('1) Fuse glass 5x20 [Qty: 150 Nos.]\n2) Cable 4 core 2.5 mm2, armoured - 25 RM')).toEqual([
      ['Fuse glass 5x20', 150, 'nos'],
      ['Cable 4 core 2.5 mm2, armoured', 25, 'm'],
    ])
  })

  it('reads "1NO" at the end of an item as its contacts, and takes the quantity from the next line', () => {
    expect(rows('• Push button red, 1NO\n   Qty: 10 Pcs\n• Relay 24VDC 2NO+2NC - 4 Nos')).toEqual([
      ['Push button red, 1NO', 10, 'Pcs'],
      ['Relay 24VDC 2NO+2NC', 4, 'nos'],
    ])
  })

  it('ends the table at a signature laid over its columns', () => {
    expect(rows('SR\tDESCRIPTION\tQTY\tUNIT\n01\tCONTACTOR 9A 220VAC\t5\tPCS\nSTORE\tKEEPER\t\t')).toEqual([['CONTACTOR 9A 220VAC', 5, 'PCS']])
  })

  it('reads the closing date written just above the signature', () => {
    const r = parse('1. Relay 24VDC = 4 Nos\n\nQuotations are required before 29 October 2026.\nExample Mills Limited, Maintenance Department')
    expect(r.facts.dueDate?.iso).toBe('2026-10-29')
  })
})

describe('parseEnquiry: corpus batches 16 and 17 (fictional)', () => {
  const rows = (t: string) => parse(t).items.map(i => [i.description, i.qty, i.unit])

  it('reads the item from the subject when the body points at it', () => {
    const r = parse('From: A Buyer <buyer@example-mills.example>\nSubject: RFQ: Butterfly valve DN200, wafer type - 5 Sets\n\nDear Sir,\nPlease quote for the item in the subject.\nRegards')
    expect(r.items).toEqual([{ description: 'Butterfly valve DN200, wafer type', qty: 5, unit: 'set' }])
    expect(r.facts.customerRef).toBeNull()
  })

  it('splits "Also add: 2 sets ..., 1 each ..." into its items', () => {
    expect(rows('Also add: 2 sets Gasket set for pump 50-200, 1 each Flow meter DN100, 4-20mA')).toEqual([
      ['Gasket set for pump 50-200', 2, 'set'],
      ['Flow meter DN100, 4-20mA', 1, 'each'],
    ])
  })

  it('skips a document title, the customer\'s own item code and the name under a table', () => {
    const text = [
      'Enquiry - Stores & Spares',
      'Item Code\tItem Name\tRequired Qty',
      'IC-4100\tButterfly valve DN100 wafer type\t2 Each',
      'Naveed Example',
      'Example Sugar Mills (Pvt) Ltd',
    ].join('\n')
    expect(rows(text)).toEqual([['Butterfly valve DN100 wafer type', 2, 'Each']])
  })
})

describe('parseEnquiry: corpus batches 18 and 19 (fictional)', () => {
  const rows = (t: string) => parse(t).items.map(i => [i.description, i.qty, i.unit])

  it('reads "Brand: X / Qty: 5 Each" and a "- Qty:" sub-bullet under an item', () => {
    expect(rows('1. Encoder 1024 PPR\n   Brand: Polaron / Qty: 4 Each\n• Relay 24VDC\n    - Qty: 3 Nos')).toEqual([
      ['Encoder 1024 PPR, Brand: Polaron', 4, 'Each'],
      ['Relay 24VDC', 3, 'nos'],
    ])
  })

  it('reads a one-cell-per-line table with the quantity and unit in one cell, and stops at the name under it', () => {
    const text = ['Item Code', 'Item Name', 'Required Qty', 'IC-4100', 'Proximity sensor M30', '6 Numbers', 'Hira Example', 'Example Steel Industries Limited'].join('\n')
    expect(rows(text)).toEqual([['Proximity sensor M30', 6, 'nos']])
  })
})

describe('parseEnquiry: corpus batches 20 and 21 (fictional)', () => {
  const rows = (t: string) => parse(t).items.map(i => [i.description, i.qty, i.unit])

  it('skips an external-email caution banner above the request and reads what follows', () => {
    const text = 'CAUTION: This email originated from outside of the organization. Do not click links.\nDear Sir,\nPlease quote:\n- Timing belt HTD 571: 10 Pieces'
    expect(rows(text)).toEqual([['Timing belt HTD 571', 10, 'Pieces']])
  })

  it('reads "(2) 100 Numbers - item" and "item -- Nos. 10"', () => {
    expect(rows('(1) 100 Numbers - Silicone sealant 280 ml\n(2) 03 Kg - Lubricating grease EP2\n3. Bearing 6308 C3 -- Nos. 10')).toEqual([
      ['Silicone sealant 280 ml', 100, 'nos'],
      ['Lubricating grease EP2', 3, 'kg'],
      ['Bearing 6308 C3', 10, 'nos'],
    ])
  })
})

describe('parseEnquiry: corpus batches 22 and 23 (fictional)', () => {
  const rows = (t: string) => parse(t).items.map(i => [i.description, i.qty, i.unit])

  it('takes Qty Required, not Qty in Stock', () => {
    const text = ['S.No', 'Description', 'UOM', 'Qty in Stock', 'Qty Required', '1', 'Butterfly valve DN100, wafer type', 'EA', '0', '2'].join('\n')
    expect(rows(text)).toEqual([['Butterfly valve DN100, wafer type', 2, 'EA']])
    expect(rows('S.No\tDescription\tUOM\tQty in Stock\tQty Required\n1\tLimit switch roller lever\tNO\t3\t8')).toEqual([['Limit switch roller lever', 8, 'nos']])
  })

  it('reads "Item: 12" in a chat and "need 10 item", but not "need 3 phase motor" as three', () => {
    expect(rows('Sir please share rates\nPressure gauge 0-6 bar 150mm dial: 12\nneed 10 butterfly valve dn150 wafer type')).toEqual([
      ['Pressure gauge 0-6 bar 150mm dial', 12, null],
      ['butterfly valve dn150 wafer type', 10, null],
    ])
    expect(rows('need 3 phase motor 5.5 kW')[0]?.[1]).toBe(1)
  })
})

describe('parseEnquiry: an Outlook table read from a screenshot (fictional OCR text)', () => {
  const rows = (t: string) => parse(t).items.map(i => [i.description, i.qty, i.unit])

  it('splits a row whose quantity the picture lost from the row above, and keeps its unit', () => {
    const text = [
      'Kindly quote your most competitive rates for the following material.',
      '',
      'SAFETY RELAY 24VDC DIN RAIL 3RT9889-4FB57-02\t1\tEA',
      'PRESSURE GAUGE 0-10 BAR 63MM DIAL BOTTOM ENTRY AA632-10P -01',
      'PCS',
      'BALL VALVE PN16-01\t6\tNO',
    ].join('\n')
    expect(rows(text)).toEqual([
      ['SAFETY RELAY 24VDC DIN RAIL 3RT9889-4FB57-02', 1, 'EA'],
      ['PRESSURE GAUGE 0-10 BAR 63MM DIAL BOTTOM ENTRY AA632-10P -01', 1, 'PCS'],
      ['BALL VALVE PN16-01', 6, 'NO'],
    ])
  })

  it('joins a part number broken over two lines and reads its O as 0', () => {
    const text = 'Please quote:\n\nTEMPERATURE\t5\tNO\nTRANSMITTER HEAD\n6ES7853-8WM79-\nOETO'
    expect(parse(text).items[0]?.description).toBe('TEMPERATURE TRANSMITTER HEAD 6ES7853-8WM79-0ET0')
  })

  it('reads the reference from a mail app\'s subject line, also when it wrapped', () => {
    expect(parse('Enquiry 1000083843 for maintenance spares\nA Buyer <a@example-mills.example>\nDear Sir').facts.customerRef?.value).toBe('1000083843')
    expect(parse('Request for Quotation\nT-2026-11A\nA Buyer <a@example-mills.example>\nDear Sir').facts.customerRef?.value).toBe('T-2026-11A')
  })
})

describe('parseEnquiry: reader gaps (feat/reader-gaps)', () => {
  const rows = (t: string) => parse(t).items.map(i => `${i.description} | ${i.qty} ${i.unit ?? '-'}`)

  it('a pasted line that starts with spaces is the next item, not the line above wrapping', () => {
    expect(rows('Pressure gauge 0-10 bar 100mm dial\n   Ball valve 2 inch SS316 - 4 Nos')).toEqual(['Pressure gauge 0-10 bar 100mm dial | 1 -', 'Ball valve 2 inch SS316 | 4 nos'])
    expect(rows('Pressure gauge 0-10 bar - 2 Nos\n   Ball valve 2 inch SS316')).toEqual(['Pressure gauge 0-10 bar | 2 nos', 'Ball valve 2 inch SS316 | 1 -'])
    expect(rows('Please quote:\nSiemens contactor 3RT2026-1BB40\n   Schneider MCB C16 2 pole\n   Omron relay MY2N 24VDC')).toEqual([
      'Siemens contactor 3RT2026-1BB40 | 1 -',
      'Schneider MCB C16 2 pole | 1 -',
      'Omron relay MY2N 24VDC | 1 -',
    ])
  })

  it('still joins a description that wraps onto an indented line', () => {
    expect(rows('Pressure transmitter Rosemount 3051 0-10 bar\n   with HART, 1/2" NPT - 2 Nos')).toEqual(['Pressure transmitter Rosemount 3051 0-10 bar with HART, 1/2" NPT | 2 nos'])
    expect(rows('Pressure transmitter 0-10 bar, 4-20mA,\n   SS316 diaphragm - 2 Nos')).toEqual(['Pressure transmitter 0-10 bar, 4-20mA, SS316 diaphragm | 2 nos'])
    expect(rows('1. PRESSURE TRANSMITTER 0-10 BAR 4-20MA\n   HART PROTOCOL SS316 - 2 NOS\n2. BALL VALVE 2" - 4 NOS')).toEqual(['PRESSURE TRANSMITTER 0-10 BAR 4-20MA HART PROTOCOL SS316 | 2 nos', 'BALL VALVE 2" | 4 nos'])
    expect(rows('Siemens PLC CPU S7-1200 1214C DC/DC/DC\n   6ES7214-1AG40-0XB0 - 1 No')).toEqual(['Siemens PLC CPU S7-1200 1214C DC/DC/DC 6ES7214-1AG40-0XB0 | 1 nos'])
    expect(rows('1) Electromagnetic flow meter DN50\n   Make: Endress+Hauser, Qty 2 Nos\n2) Level switch vibrating fork - 1 No')).toEqual(['Electromagnetic flow meter DN50, Make: Endress+Hauser | 2 nos', 'Level switch vibrating fork | 1 nos'])
  })

  it('reads 4 عدد, 0.5 m, 2.5 kg and 1,000 nos in every place a quantity goes', () => {
    const shapes = [
      (q: string) => `Silicone tube 8mm ${q}\nPressure gauge 0-10 bar 2 Nos`,
      (q: string) => `1. Silicone tube 8mm - ${q}\n2. Pressure gauge 0-10 bar - 2 Nos`,
      (q: string) => `${q} Silicone tube 8mm\n2 Nos Pressure gauge 0-10 bar`,
      (q: string) => `Silicone tube 8mm\t${q.replace(' ', '\t')}\nPressure gauge 0-10 bar\t2\tNos`,
      (q: string) => `S.No\tDescription\tUOM\tQty\n1\tSilicone tube 8mm\t${q.split(' ').reverse().join('\t')}\n2\tPressure gauge 0-10 bar\tNos\t2`,
      (q: string) => `20/10/2026, 10:42 am - Ali: Silicone tube 8mm ${q}\n20/10/2026, 10:43 am - Ali: Pressure gauge 0-10 bar 2 nos`,
    ]
    const want: Array<[string, number, string]> = [
      ['4 عدد', 4, 'nos'],
      ['۴ عدد', 4, 'nos'],
      ['0.5 m', 0.5, 'm'],
      ['2.5 kg', 2.5, 'kg'],
      ['1,000 nos', 1000, 'nos'],
      ['12.5 MTR', 12.5, 'm'],
    ]
    for (const shape of shapes)
      for (const [q, qty, unit] of want) {
        const r = parse(shape(q))
        expect(r.items, `${shape(q)}`).toHaveLength(2)
        const it0 = r.items.find(i => /silicone/i.test(i.description))
        expect([it0?.description, it0?.qty, unitFamily(it0?.unit)], `${shape(q)}`).toEqual(['Silicone tube 8mm', qty, unit])
      }
    expect(rows('Push button red عدد 4')).toEqual(['Push button red | 4 nos'])
  })

  it('a letter: "2 (Two) Nos", roman numbers, a list in one sentence, numbered terms after the items, a page mark', () => {
    const letter = [
      'Ref: No. ZPI/PROC/39/2026        Date: 17 October 2026',
      'Dear Sir,',
      'Please quote for the following: 1) Miniature circuit breaker 3 pole, B10, 6kA - 12 No and 2) Analog input module 4 AI - 1 No.',
      '',
      'Thanking you,',
    ].join('\n')
    const r = parse(letter)
    expect(r.items.map(i => `${i.description} | ${i.qty}`)).toEqual(['Miniature circuit breaker 3 pole, B10, 6kA | 12', 'Analog input module 4 AI | 1'])
    expect(r.facts.customerRef?.value).toBe('ZPI/PROC/39/2026')
    const list = [
      'Please quote your most competitive rates for the following material:',
      'i. PLC CPU 24 DI/16 DO 24VDC PROFINET - 2 (Two) EA',
      'ii. Control cable 7 core x 2.5 mm2, PVC/PVC - 50 Mtrs',
      'iii. pH sensor with temperature sensor - 12 (Twelve) No',
      'Contd. on next page',
      '',
      '1. Rates should be inclusive of all taxes.',
      '2. Incomplete quotations will not be considered.',
      '',
      'Kindly also mention the following in your quotation:',
      '1. Delivery period',
      '2. Country of origin',
    ].join('\n')
    expect(rows(list)).toEqual(['PLC CPU 24 DI/16 DO 24VDC PROFINET | 2 EA', 'Control cable 7 core x 2.5 mm2, PVC/PVC | 50 m', 'pH sensor with temperature sensor | 12 nos'])
  })

  it('an ERP form read from a picture: a department column with no header, a store code in front, a point read as a space', () => {
    const text = [
      'REQUEST FOR QUOTATION',
      '1\tELC-17175\tWelding electrode E7018 3.2 mm\tMECH\tKGS\t20 000\t23.12.2026',
      '2\tMEC-51117\tpH sensor 0-14 pH CPS92E-CJ0DZY7\tUTIL\tPC\t2.000\t25.12.2026',
      '3\tINS-85604\tCable tie 370 mm nylon black\tPROD\tNOS\t500.000\t28.11.2026',
      '4\tCON-37783\tInstrument cable 1 pair x 1.5 mm2\tPROD\tMTR\t12 500\t06.12.2026',
    ].join('\n')
    expect(rows(text)).toEqual([
      'Welding electrode E7018 3.2 mm | 20 kg',
      'pH sensor 0-14 pH CPS92E-CJ0DZY7 | 2 PC',
      'Cable tie 370 mm nylon black | 500 nos',
      'Instrument cable 1 pair x 1.5 mm2 | 12.5 m',
    ])
  })

  it('puts right the fixed shapes of catalogue numbers a picture misread, and leaves typed text alone', () => {
    expect(rows('1\tModule digital output BES7865-4XK94-0EP0\tEA\t1')[0]).toBe('Module digital output 6ES7865-4XK94-0EP0 | 1 EA')
    expect(rows('Timer relay 1SVRST0422R7038 - 4 Nos')[0]).toBe('Timer relay 1SVR570422R7038 | 4 nos')
    expect(rows('Drive 65L3210-1KE21-3UF1 - 1 No')[0]).toBe('Drive 6SL3210-1KE21-3UF1 | 1 nos')
    expect(rows('Relay 1SVR405613R3000 - 2 Nos')[0]).toBe('Relay 1SVR405613R3000 | 2 nos')
  })

  it('reads a reference whose label and number a boxed form put on two lines', () => {
    const r = parse('RFQ No.\nRFQ26602\nRFQ Date\n20-Oct-2026\nDue Date\n09-Nov-2026')
    expect(r.facts.customerRef?.value).toBe('RFQ26602')
    expect(r.facts.dueDate?.iso).toBe('2026-11-09')
  })
})

describe('parseEnquiry: a buyer cover email around an attached form (R-W2)', () => {
  const cover = (body: string) => parse(body).items.map(i => i.description)

  it('reads the buyer terms bullets as instructions, not items', () => {
    expect(
      cover(
        [
          'Enclosed please find inquiry for your URGENT QUOTATION with shortest delivery time of required items.',
          'Note:',
          '*\tThe Quotation(s) “with ready stock” will be given preference for ordering.',
          '*\tPl share picture and datasheet of offered model(s)',
          '*\tPl mention origin country of offered item(s)',
          '*\tOrder will be issued in favor of the best competitive offered price(s) and sharp delivery time',
          'Regards,',
        ].join('\n'),
      ),
    ).toEqual([])
    expect(cover('Prices inclusive of GST\nValidity of the offer\nMention delivery period in weeks')).toEqual([])
  })

  it('a line that names a product or a quantity is still an item next to such terms', () => {
    const r = parse('Note:\n* Pl mention origin country\n2 nos proximity sensor M18\nPrices inclusive of GST')
    expect(r.items).toEqual([{ description: 'proximity sensor M18', qty: 2, unit: 'nos' }])
  })

  it('Outlook header blocks of a forward (From / Sent / To / Subject / Importance) and closing courtesy are no items', () => {
    const r = parse(
      [
        'From: Buyer Name [mailto:buyer@example-mills.example]',
        'Sent: Wednesday, June 10, 2026 11:27 AM',
        'To: Sales Desk <sales@example-sup.example>',
        'Subject: PURCHASE INQUIRY-12345',
        'Importance: High',
        '',
        'FYI/R',
        '',
        'We look forward to your valued order and continued business relationship',
        'Regards,',
      ].join('\n'),
    )
    expect(r.items).toEqual([])
  })
})

describe('parseEnquiry: a letter in the body of the email (R-W2)', () => {
  it('a long sentence about an order or a delivery is prose, not an item; a short item line with a code still is', () => {
    const r = parse(
      [
        'Upon detailed verification, we confirm that the supplied unit RX-4410 is exactly as specified in your order and the issue is not on our side.',
        'Valve actuator AX-210 - 2 nos',
      ].join('\n'),
    )
    expect(r.items).toEqual([{ description: 'Valve actuator AX-210', qty: 2, unit: 'nos' }])
  })
})

describe('parseEnquiry: a ruled grid read from a screenshot', () => {
  const T = (cs: string[]) => cs.join('\t')
  const rows = (text: string) => parse(text).items.map(i => `${i.description} | ${i.qty} ${i.unit ?? ''}`.trim())

  it('takes a Required For column as no part of the description, and UOM after QTY as the unit', () => {
    const text = [
      T(['SR.', 'DESCRIPTION', 'REQUIRED FOR', 'QTY', 'UOM']),
      T(['1', 'MOTOR STARTER - 22KW (MODEL:XK40-300-60 ZENTAR).', 'Needed Soon For Kiln Section Deptt.', '2', 'NOS']),
      T(['2', 'JUNCTION BOX (Size - 12" x 12" x 6" x 18-Swg,Painted).', 'Needed Soon For Kiln Section Deptt.', '1', 'NOS']),
      T(['3', 'LEVEL TRANSMITTER VOLTREG - LX9Y-204KR.', 'For Boiler House Deptt.', '1', 'NOS']),
    ].join('\n')
    expect(rows(text)).toEqual(['MOTOR STARTER - 22KW (MODEL:XK40-300-60 ZENTAR) | 2 nos', 'JUNCTION BOX (Size - 12" x 12" x 6" x 18-Swg,Painted) | 1 nos', 'LEVEL TRANSMITTER VOLTREG - LX9Y-204KR | 1 nos'])
  })

  it('reads every row of a Sr. / Material Name / UOM / QTY grid, wrapped names on one row, though the header lost its UOM and QTY', () => {
    const text = [
      T(['Sr.', 'Material Name']),
      T(['1', 'Washer 12x30mm Zinc Plated', 'PCS', '24']),
      T(['2', 'FLOW CONTROLLER - 72 X 72 MM.(MODEL:QR20CR-501000-E 0~400C MULTI INPUT TAVIRA).', 'Pcs', '3']),
      T(['3', 'Breaker 1P 25A (Aurion)', 'PCS', '6']),
      T(['4', 'Capacitor 7.5Uf (Norvalt)', 'Pcs', '12']),
    ].join('\n')
    expect(rows(text)).toEqual(['Washer 12x30mm Zinc Plated | 24 PCS', 'FLOW CONTROLLER - 72 X 72 MM.(MODEL:QR20CR-501000-E 0~400C MULTI INPUT TAVIRA) | 3 Pcs', 'Breaker 1P 25A (Aurion) | 6 PCS', 'Capacitor 7.5Uf (Norvalt) | 12 Pcs'])
  })
})

describe('parseEnquiry: an ERP RFQ form that prints its header before every item (R-W3)', () => {
  const HEAD = 'S.No.\tMaterial Description\tPur. Req.\tPlant\tUOM\tQuantity\tRate/Unit\tAmount'
  const form = [
    'EXAMPLE CEMENT COMPANY LIMITED',
    'REQUEST FOR QUOTATION',
    'SUPPLIER:\t7700000\tRFQ # : 1000099001',
    'SUPPLIER NAME: COLLECTIVE NO.: 1000099000',
    'RFQ DATE:\t14.10.2026',
    'REPLY DUE DATE: 23.10.2026',
    HEAD,
    '1 .\tSOV TYP.AB-5-1/2,ACME\t1000099000\tPlant North\tEA\t12.00\t\t',
    'SOLENOID VALVE (5-port)',
    'Type: AB-5-1/2',
    'Art No. 310477',
    'Make ACME (Holland).',
    HEAD,
    '2 .\tFILTER SILENCER SIZE: 1/2",ACME\t1000099000\tPlant North\t***\t30.00\t\t',
    'FILTER SILENCER (Material:',
    'BRASS) FOR',
    'SOV AB-5-1/2, Art No. 310477,',
    'Make: ACME',
    HEAD,
    '3 .\tCPU XR30 7XY1 418-2QT55-1BB7,MAKER\t1000099000\tPlant\tEA\t2.00\t\t',
    'SMART\tCPU XR30,CPU,\t\tNorth',
    'AC/DC/relay, onboard I/O. Part # 7XY1',
    'TOTAL AMOUNT:',
    'Page: 1',
    'of 2',
    HEAD,
    '4 . LEVEL\tCONTROLLER TYPE: KZ-9021,\t1000099000\tPlant\tEA\t2.00\t\t',
    'MAKER\t\t\tNorth',
    'Type: Floatless Liquid Level Control Relay',
    'Make;MAKER',
    'TOTAL AMOUNT:',
    'Terms and Conditions',
    '1. Please reply within due date.',
  ].join('\n')

  it('keeps every wrapped line with its own item: four rows, no extra items, "***" is no unit', () => {
    const r = parse(form)
    expect(r.items.map(i => [i.qty, i.unit])).toEqual([[12, 'EA'], [30, null], [2, 'EA'], [2, 'EA']])
    expect(r.items).toHaveLength(4)
    expect(r.items[0]?.description).toContain('310477')
    expect(r.items[1]?.description).toContain('Art No. 310477')
    expect(r.items[3]?.description).toMatch(/^LEVEL CONTROLLER/)
  })
})

describe('parseEnquiry: reference rules (R-W4)', () => {
  const ref = (t: string) => {
    const f = parse(t).facts
    return [f.customerRef?.value ?? null, f.alsoRefs]
  }

  it('the printed form RFQ number wins; the collective number and the subject number are also-refs', () => {
    expect(ref('Subject: Collective No:7000123B, Due Date :23-10-2026\nREQUEST FOR QUOTATION\nSUPPLIER:\t5500000\tRFQ # : 7000456\nSUPPLIER NAME: COLLECTIVE NO.: 7000123')).toEqual(['7000456', ['7000123B', '7000123']])
  })

  it('strips punctuation at the edge of a number ("-41873" is 41873) and a label glued to a bare number', () => {
    expect(ref('Subject: RE: PO # 310288: PURCHASE INQUIRY-41873')[0]).toBe('41873')
    expect(ref('Dear Sir,\n(Inq-52390)\nPlease quote the items in the attached PDF.\nRegards')[0]).toBe('52390')
  })

  it('"PR # a, b & c" keeps all three', () => {
    expect(ref('Subject: Quotation required\nPR # 601001, 601002 & 601003\nPlease quote 4 nos ball valve 1 inch')).toEqual(['601001', ['601002', '601003']])
  })

  it('a subject that names a product has a model code in it, not a reference; a reference-shaped code still counts', () => {
    expect(ref('Subject: RFQ Inductive Sensor BES M18AB1-PSC10Z-S04G Maker\n\nPlease quote 4 nos')[0]).toBeNull()
    expect(ref('Subject: Urgent RFQ - Replacement for ABC010RB/8 Level Transmitter\n\n1 no')[0]).toBeNull()
    expect(ref('Subject: RFQ FOR THE DRIVE SPARES REQUIRED T-26-88A\n\nPlease quote 4 nos')[0]).toBe('T-26-88A')
    expect(ref('Subject: RFQ for PLC spares 40512-RFQ-OC\n\nPlease quote 4 nos')[0]).toBe('40512-RFQ-OC')
  })
})
