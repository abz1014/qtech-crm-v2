import { describe, expect, it } from 'vitest'
import { guessBrandFamily, modelTokens, normaliseUnit, parseItemLine, parsePaste, type BrandRef } from './parseItems'

// The email of the approved mockup (g2-intake-float frame 3): six lines, four items.
const EMAIL = `Dear Sir, please quote the following for our Mianwali plant:
1) Endress+Hauser Proline Promag 400 electromagnetic flow meter DN50 - 2 nos
2) Hach HQ1110 portable pH/EC meter with probes - 1 no
3) Siemens SITRANS P320 pressure transmitter 0-10 bar x 4
4) 24V actuator for ball valve DN40, qty 2
Regards, Kamran Zafar`

describe('parsePaste: the mockup email', () => {
  const r = parsePaste(EMAIL)

  it('finds four items in six lines', () => {
    expect(r.lineCount).toBe(6)
    expect(r.items).toHaveLength(4)
  })

  it('reads quantity and unit from the end of each line and keeps the description clean', () => {
    expect(r.items).toEqual([
      { description: 'Endress+Hauser Proline Promag 400 electromagnetic flow meter DN50', qty: 2, unit: 'nos' },
      { description: 'Hach HQ1110 portable pH/EC meter with probes', qty: 1, unit: 'nos' },
      { description: 'Siemens SITRANS P320 pressure transmitter 0-10 bar', qty: 4, unit: null },
      { description: '24V actuator for ball valve DN40', qty: 2, unit: null },
    ])
  })

  it('marks the greeting and the sign-off as skipped, and keeps the list markers for highlighting', () => {
    expect(r.lines.map(l => l.kind)).toEqual(['skipped', 'item', 'item', 'item', 'item', 'skipped'])
    expect(r.lines.filter(l => l.kind === 'item').map(l => l.marker)).toEqual(['1)', '2)', '3)', '4)'])
  })
})

describe('parseItemLine: quantity is never a model code or a size', () => {
  it.each([
    ['24V actuator for ball valve DN40', 1, null, '24V actuator for ball valve DN40'],
    ['Hach HQ1110 portable meter', 1, null, 'Hach HQ1110 portable meter'],
    ['Pressure transmitter 0-10 bar', 1, null, 'Pressure transmitter 0-10 bar'],
    ['Cable 2x4 mm', 1, null, 'Cable 2x4 mm'],
    ['Valve DN50 PN16', 1, null, 'Valve DN50 PN16'],
  ])('%s has no quantity', (line, qty, unit, description) => {
    expect(parseItemLine(line)).toEqual({ description, qty, unit })
  })

  it.each([
    ['Pump 2 nos', 2, 'nos', 'Pump'],
    ['Pump - 3 pcs', 3, 'nos', 'Pump'],
    ['Pump (5 pcs)', 5, 'nos', 'Pump'],
    ['Pump x2', 2, null, 'Pump'],
    ['Pump × 12', 12, null, 'Pump'],
    ['Pump, Qty: 7', 7, null, 'Pump'],
    ['Pump quantity 8 sets', 8, 'set', 'Pump'],
    ['Cable, 150 m', 150, 'm', 'Cable'],
    ['Cable - 1,000 mtrs', 1000, 'm', 'Cable'],
    ['2 x Pump', 2, null, 'Pump'],
    ['10 nos Gasket', 10, 'nos', 'Gasket'],
    ['3x Siemens relay', 3, null, 'Siemens relay'],
  ])('%s', (line, qty, unit, description) => {
    expect(parseItemLine(line)).toEqual({ description, qty, unit })
  })

  it('reads a decimal quantity', () => {
    expect(parseItemLine('Cable - 2.5 m').qty).toBe(2.5)
  })

  // feat/reader-gaps: these used to come out as "1", no unit.
  it.each([
    ['Bearing 6205 ZZ 4 عدد', 4, 'nos', 'Bearing 6205 ZZ'],
    ['Bearing 6205 ZZ ۴ عدد', 4, 'nos', 'Bearing 6205 ZZ'],
    ['Silicone tube 8mm 0.5 m', 0.5, 'm', 'Silicone tube 8mm'],
    ['Copper wire 2.5 kg', 2.5, 'kg', 'Copper wire'],
    ['Welding rod 2.5 kgs', 2.5, 'kg', 'Welding rod'],
    ['Cable tie 200mm 1,000 nos', 1000, 'nos', 'Cable tie 200mm'],
    ['0.5 m PU tube 6mm', 0.5, 'm', 'PU tube 6mm'],
    ['2.5 kg grease EP2', 2.5, 'kg', 'grease EP2'],
    ['Level sensor range 20 m', 1, null, 'Level sensor range 20 m'],
  ])('%s', (line, qty, unit, description) => {
    expect(parseItemLine(line)).toEqual({ description, qty, unit })
  })

  it('reads a row pasted from Excel whose unit is the Urdu word for pieces', () => {
    expect(parsePaste('Fuse 10A\t4\tعدد').items).toEqual([{ description: 'Fuse 10A', qty: 4, unit: 'nos' }])
  })
})

describe('parsePaste: other shapes', () => {
  it('without markers, every line that is not a greeting or sign-off is an item', () => {
    const r = parsePaste('Hi team\nHach HQ1110 meter\nSiemens P320 transmitter x 2\nThanks')
    expect(r.items.map(i => i.description)).toEqual(['Hach HQ1110 meter', 'Siemens P320 transmitter'])
    expect(r.items[1].qty).toBe(2)
  })

  it('with markers, an unmarked line in the middle is not an item', () => {
    const r = parsePaste('1. Pump - 2 nos\nsome remark about delivery\n2. Valve - 1 no')
    expect(r.items).toHaveLength(2)
    expect(r.lines[1].kind).toBe('skipped')
  })

  it('handles bullets, numbered lines and Windows line endings', () => {
    expect(parsePaste('- Pump 2 nos\r\n- Valve 3 nos\r\n').items.map(i => i.qty)).toEqual([2, 3])
    expect(parsePaste('1. A pump\n2. A valve').items).toHaveLength(2)
  })

  it('skips email headers', () => {
    const r = parsePaste('From: a@b.com\nSubject: RFQ\nSent: Monday\nPump 2 nos')
    expect(r.items).toEqual([{ description: 'Pump', qty: 2, unit: 'nos' }])
  })

  it('an empty paste finds nothing', () => {
    expect(parsePaste('  \n\n').items).toEqual([])
  })
})

describe('normaliseUnit', () => {
  it('folds the spellings people use', () => {
    expect(normaliseUnit('PCS')).toBe('nos')
    expect(normaliseUnit('Meters')).toBe('m')
    expect(normaliseUnit(' ')).toBeNull()
    expect(normaliseUnit(undefined)).toBeNull()
  })
})

describe('guessBrandFamily', () => {
  const list: BrandRef[] = [
    { id: 'b-eh', name: 'Endress+Hauser', kind: 'brand' },
    { id: 'b-endress', name: 'Endress', kind: 'brand' },
    { id: 'b-hach', name: 'Hach', kind: 'brand' },
    { id: 'b-sie', name: 'Siemens', kind: 'brand' },
    { id: 'f-flow', name: 'Flow meters', kind: 'family' },
    { id: 'f-press', name: 'Pressure', kind: 'family' },
    { id: 'f-act', name: 'Actuators', kind: 'family' },
  ]

  it('picks the brand and family the description names', () => {
    expect(guessBrandFamily('Endress+Hauser Proline Promag 400 electromagnetic flow meter DN50', list)).toEqual({
      brandId: 'b-eh',
      familyId: 'f-flow',
    })
    expect(guessBrandFamily('Siemens SITRANS P320 pressure transmitter 0-10 bar', list)).toEqual({ brandId: 'b-sie', familyId: 'f-press' })
  })

  it('matches a plural family name in the singular', () => {
    expect(guessBrandFamily('24V actuator for ball valve DN40', list)).toEqual({ brandId: null, familyId: 'f-act' })
  })

  it('does not invent a brand that is not on file, and needs a whole word', () => {
    expect(guessBrandFamily('Generic pump', list)).toEqual({ brandId: null, familyId: null })
    expect(guessBrandFamily('Hachette binder', list).brandId).toBeNull()
  })

  it('an empty list guesses nothing', () => {
    expect(guessBrandFamily('Hach HQ1110', [])).toEqual({ brandId: null, familyId: null })
  })
})

describe('modelTokens (mirrors the database function)', () => {
  it('reads the documented examples', () => {
    expect(modelTokens('Hach HQ1110 portable meter')).toEqual(['HQ1110'])
    expect(modelTokens('Position transmitter PMA-18-F0200-X')).toEqual(['PMA18F0200X'])
    expect(modelTokens('24V actuator')).toEqual([])
    expect(modelTokens('Relay 420MA, 24VDC')).toEqual([])
  })

  it('leaves out a word that is really a brand or family name (migration 0035)', () => {
    expect(modelTokens('XYZ2000 ultrasonic level transmitter')).toEqual(['XYZ2000'])
    expect(modelTokens('XYZ2000 ultrasonic level transmitter', ['XYZ2000'])).toEqual([])
    expect(modelTokens('XYZ2000 QX9100 flow meter', ['XYZ2000'])).toEqual(['QX9100'])
    expect(modelTokens('EH2000 pressure switch', ['E+H 2000'])).toEqual([])
    expect(modelTokens('Siemens S7-1200 PLC', ['S7-1200 Series', 'Siemens'])).toEqual([])
    expect(modelTokens('Hach HQ1110 portable meter', ['Hach'])).toEqual(['HQ1110'])
  })
})

describe('parsePaste: ranges and plural units (R-W6b)', () => {
  it('"0-10 m" and "0 to 10 m" are a range in the description, not ten metres', () => {
    expect(parsePaste('Pressure transmitter 0-10 m').items[0]).toMatchObject({ description: 'Pressure transmitter 0-10 m', qty: 1, unit: null })
    expect(parsePaste('Level probe 0 to 10 m').items[0]).toMatchObject({ qty: 1, unit: null })
    expect(parsePaste('Silicone tube 8mm, 10 m').items[0]).toMatchObject({ qty: 10, unit: 'm' })
  })

  it('"nos\'s" and "no\'s" are nos', () => {
    expect(parsePaste("Ball valve 1 inch - 4 nos's").items[0]).toMatchObject({ qty: 4, unit: 'nos' })
    expect(parsePaste("Ball valve 1 inch - 4 no's").items[0]).toMatchObject({ qty: 4, unit: 'nos' })
  })
})

describe('parsePaste: a curly apostrophe (R-W6b)', () => {
  it('"4 no\u2019s" is 4 nos', () => {
    expect(parsePaste('Capacitive sensor M18 - 4 no\u2019s').items[0]).toMatchObject({ qty: 4, unit: 'nos' })
  })
})

describe('guessBrandFamily with the category dictionary', () => {
  const list: BrandRef[] = [
    { id: 'f-mcb', name: 'mcb', kind: 'family' },
    { id: 'f-lvl', name: 'Level switches', kind: 'family' },
    { id: 'f-ltx', name: 'Level transmitters', kind: 'family' },
  ]
  it('finds a family by its canonical name, ignoring case', () => {
    expect(guessBrandFamily('MCB S/P 32A (Schneider)', list).familyId).toBe('f-mcb')
  })
  it('an unsure inference falls back to the exact-name match', () => {
    expect(guessBrandFamily('WATER LEVEL SWITCH RADAR ST-70AB', list).familyId).toBe('f-lvl')
  })
  it('a sure inference with no such family on file guesses nothing', () => {
    expect(guessBrandFamily('SOFT STARTER - 30KW', list).familyId).toBeNull()
  })
})
