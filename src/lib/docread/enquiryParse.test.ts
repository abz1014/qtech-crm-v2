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

  it('reads the closing date written just above the signature', () => {
    const r = parse('1. Relay 24VDC = 4 Nos\n\nQuotations are required before 29 October 2026.\nExample Mills Limited, Maintenance Department')
    expect(r.facts.dueDate?.iso).toBe('2026-10-29')
  })
})
