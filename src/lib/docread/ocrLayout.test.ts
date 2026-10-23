import { describe, expect, it } from 'vitest'
import { cleanWord, deskew, fixOcrWord, isChromeLine, layoutOcr, pageConfidence, snapUnitColumn, unwrapLines, type OcrLine, type OcrWord } from './ocrLayout'
import { linesToText } from './pdfLayout'

// Word boxes as an OCR engine gives them, in pixels: letters 30 px tall, about 16 px per character, a space about 9 px.
const H = 30
const CH = 16

/** One line of words starting at x, baseline y; `gap` (in characters) before each word after the first is 0.6 by default. */
function line(y: number, x: number, parts: Array<string | { t: string; gap?: number; conf?: number }>): OcrLine {
  let cx = x
  const words: OcrWord[] = parts.map((p, i) => {
    const t = typeof p === 'string' ? p : p.t
    const gap = typeof p === 'string' ? 0.6 : (p.gap ?? 0.6)
    if (i > 0) cx += gap * CH
    const w = { text: t, confidence: typeof p === 'string' ? 95 : (p.conf ?? 95), bbox: { x0: cx, y0: y - H, x1: cx + t.length * CH, y1: y } }
    cx += t.length * CH
    return w
  })
  const x1 = words[words.length - 1]!.bbox.x1
  return { words, bbox: { x0: x, y0: y - H, x1, y1: y + 6 }, baseline: { x0: x, y0: y, x1, y1: y }, rowHeight: H }
}

/** One row of cells, each starting at its own x. */
function cells(y: number, parts: Array<[number, string]>): OcrLine {
  const words = parts.flatMap(([x, t]) => line(y, x, t.split(' ')).words)
  return { words, bbox: { x0: parts[0]![0], y0: y - H, x1: words[words.length - 1]!.bbox.x1, y1: y + 6 }, baseline: null, rowHeight: H }
}

const text = (lines: OcrLine[]) => linesToText(layoutOcr(lines))

describe('cleanWord', () => {
  it('drops rules, specks and unsure words, and strips border bars and a stray quote before a word', () => {
    expect(cleanWord({ text: '|', confidence: 95, bbox: { x0: 0, y0: 0, x1: 2, y1: 30 } })).toBeNull()
    expect(cleanWord({ text: '—', confidence: 90, bbox: { x0: 0, y0: 0, x1: 2, y1: 30 } })).toBeNull()
    expect(cleanWord({ text: 'Siemens', confidence: 20, bbox: { x0: 0, y0: 0, x1: 2, y1: 30 } })).toBeNull()
    expect(cleanWord({ text: '|Siemens', confidence: 90, bbox: { x0: 0, y0: 0, x1: 2, y1: 30 } })).toBe('Siemens')
    expect(cleanWord({ text: '"RELAY', confidence: 90, bbox: { x0: 0, y0: 0, x1: 2, y1: 30 } })).toBe('RELAY')
    expect(cleanWord({ text: '4"', confidence: 90, bbox: { x0: 0, y0: 0, x1: 2, y1: 30 } })).toBe('4"')
    expect(cleanWord({ text: '-', confidence: 92, bbox: { x0: 0, y0: 0, x1: 2, y1: 30 } })).toBe('-')
  })
})

describe('layoutOcr', () => {
  it('reads plain lines in order, top to bottom', () => {
    expect(text([line(140, 40, ['Please', 'quote:']), line(100, 40, ['Dear', 'Sir,'])])).toBe('Dear Sir,\nPlease quote:')
  })

  it('lays a table with a header out as tab rows, the shape a pasted Excel range has', () => {
    const rows = [
      cells(100, [[40, 'S.No'], [160, 'Description'], [600, 'Qty'], [720, 'Unit']]),
      cells(150, [[40, '1'], [160, 'Pressure gauge 0-16 bar'], [616, '4'], [720, 'Nos']]),
      cells(200, [[40, '2'], [160, 'Thermocouple type K'], [616, '6'], [720, 'Nos']]),
    ]
    expect(text(rows)).toBe('S.No\tDescription\tQty\tUnit\n1\tPressure gauge 0-16 bar\t4\tNos\n2\tThermocouple type K\t6\tNos')
  })

  it('takes a rule read as "|" between two words as a cell border', () => {
    expect(text([line(100, 40, ['Valve', { t: '|', gap: 0.4 }, { t: 'Brass', gap: 0.4 }])])).toBe('Valve\nBrass')
    expect(text([line(100, 40, ['Valve', { t: 'Brass', gap: 1.2 }])])).toBe('Valve Brass')
  })

  it('keeps an unsure word between two sure ones, so the line is not cut in two', () => {
    expect(text([line(100, 40, ['Level', 'switch', { t: 'SS316', conf: 21 }, '-', '2', 'Nos'])])).toBe('Level switch SS316 - 2 Nos')
  })

  it('drops the phone and chat chrome: status bar, contact over "online", day marker, bubble times, the message box', () => {
    const lines = [
      line(40, 30, ['9:41', { t: '4G', gap: 30 }, '87%']),
      line(110, 120, ['Kamran', 'Fictional', 'Foods']),
      line(150, 120, ['online']),
      line(220, 400, ['Today']),
      line(290, 30, ['Solenoid', 'valve', '24VDC', 'qty', '3']),
      line(330, 600, ['10:42', 'am']),
      line(1900, 50, ['Message']),
    ]
    expect(text(lines)).toBe('Solenoid valve 24VDC qty 3')
  })

  it("drops a spreadsheet's column letters", () => {
    const letters = line(40, 60, ['A', { t: 'B', gap: 10 }, { t: 'C', gap: 10 }, { t: 'D', gap: 10 }])
    expect(text([letters, line(100, 40, ['Relay', '24VDC', '-', '20', 'Nos'])])).toBe('Relay 24VDC - 20 Nos')
  })
})

describe('unwrapLines', () => {
  it('joins a tail that wrapped in a chat bubble back onto its line', () => {
    const lines = [
      line(100, 40, ['Solenoid', 'valve', '1/2', 'inch', 'qty', '3']),
      line(140, 40, ['Temperature', 'gauge', '0-150', 'C', 'dial', 'qty']),
      line(180, 40, ['5']),
      line(220, 40, ['Cable', 'gland', 'PG16', 'qty', '50']),
    ]
    // The joined line keeps its own place; the blank line is the gap the tail left (a paragraph break to the parser, harmless).
    expect(text(lines).replace(/\n\n/g, '\n')).toBe('Solenoid valve 1/2 inch qty 3\nTemperature gauge 0-150 C dial qty 5\nCable gland PG16 qty 50')
  })

  it('does not join a new item, a list marker, a line after a full stop, or a smaller line', () => {
    const long = ['Please', 'send', 'your', 'best', 'price', 'for']
    expect(unwrapLines([line(100, 40, long), line(140, 40, ['Contactor', '3RT2026'])])).toHaveLength(2)
    expect(unwrapLines([line(100, 40, long), line(140, 40, ['2.', 'contactor'])])).toHaveLength(2)
    expect(unwrapLines([line(100, 40, [...long.slice(0, 5), 'items.']), line(140, 40, ['and', 'more'])])).toHaveLength(2)
    const small = { ...line(140, 40, ['online']), rowHeight: 18 }
    expect(unwrapLines([line(100, 40, long), small])).toHaveLength(2)
  })
})

describe('deskew', () => {
  it('turns a slanted photo level, so a row lines up across its columns', () => {
    const level = [
      line(100, 40, ['CAPACITOR', '100UF', '450', 'V-01', { t: '10', gap: 12 }, { t: 'EA', gap: 4 }]),
      line(150, 40, ['FUSE', 'GLASS', '5X20', '2A-01', { t: '200', gap: 12 }, { t: 'EA', gap: 4 }]),
    ]
    const a = (2 * Math.PI) / 180
    const tilt = (x: number, y: number) => ({ x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) })
    const box = (b: { x0: number; y0: number; x1: number; y1: number }) => {
      const c = tilt((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)
      return { x0: c.x - (b.x1 - b.x0) / 2, x1: c.x + (b.x1 - b.x0) / 2, y0: c.y - (b.y1 - b.y0) / 2, y1: c.y + (b.y1 - b.y0) / 2 }
    }
    const slanted = level.map(l => {
      const p = tilt(l.baseline!.x0, l.baseline!.y0)
      const q = tilt(l.baseline!.x1, l.baseline!.y1)
      return { ...l, bbox: box(l.bbox), baseline: { x0: p.x, y0: p.y, x1: q.x, y1: q.y }, words: l.words.map(w => ({ ...w, bbox: box(w.bbox) })) }
    })
    expect(text(slanted)).toBe('CAPACITOR 100UF 450 V-01\t10\tEA\nFUSE GLASS 5X20 2A-01\t200\tEA')
    const back = deskew(slanted)[0]!
    expect(Math.abs(back.words[0]!.bbox.y1 - back.words[5]!.bbox.y1)).toBeLessThan(1)
  })
})

describe('pageConfidence and isChromeLine', () => {
  it('weighs confidence by letters, leaving noise out', () => {
    const l = line(100, 40, [{ t: 'Valve', conf: 90 }, { t: '|', conf: 99 }, { t: 'DN50', conf: 70 }])
    const { confidence, letters } = pageConfidence([l])
    expect(letters).toBe(9)
    expect(confidence).toBeCloseTo((90 * 5 + 70 * 4) / 9)
  })

  it('knows the chrome lines', () => {
    for (const t of ['9:41', '10:42 am', '4:05 pm VV', '4G 87%', 'LTE 56%', 'online', 'last seen today at 10:02', 'Type a message', 'Today'])
      expect(isChromeLine(t), t).toBe(true)
    for (const t of ['Valve 2 nos', 'Need by 10:30 tomorrow', '87% humidity sensor']) expect(isChromeLine(t), t).toBe(false)
  })
})

describe('fixOcrWord: letters and digits the engine swaps', () => {
  it.each([
    ['INO+INC', '1NO+1NC'],
    ['PLUNGERTYPE,INO+INC', 'PLUNGERTYPE,1NO+1NC'],
    ['TNO+1NC', '1NO+1NC'],
    ['141/0,24VDC', '14I/O,24VDC'],
    ['PO98A8460', 'P098A8460'],
    ['6ES7853-8WM79-OETO', '6ES7853-8WM79-0ET0'],
    ['Lid', 'Ltd'],
    ['INCH', 'INCH'],
    ['24VDC', '24VDC'],
    ['Pressure', 'Pressure'],
    ['QUO-2026725', 'QUO-2026725'],
    ['86794-RFQ-OC', '86794-RFQ-OC'],
    ['$5304', 'SS304'],
    ['Mode!', 'Model'],
    ['19-OCT-26', '19-OCT-26'],
    ['LCID33G1', 'LC1D33G1'],
    ['Picces', 'Pieces'],
    ['MIR', 'MTR'],
    ['Pieces', 'Pieces'],
  ])('%s -> %s', (from, to) => {
    expect(fixOcrWord(from)).toBe(to)
  })

  it('keeps a well-read word the engine gave no confidence, between sure words', () => {
    expect(text([line(100, 40, ['10', { t: 'VALVE,BALL;FLANGED', conf: 0 }, 'MODEL', 'FX4U-16MR'])])).toBe('10 VALVE,BALL;FLANGED MODEL FX4U-16MR')
  })
})

/** A line moved down by dy pixels. */
const shift = (l: OcrLine, dy: number): OcrLine => ({ ...l, bbox: { ...l.bbox, y0: l.bbox.y0 + dy, y1: l.bbox.y1 + dy }, words: l.words.map(w => ({ ...w, bbox: { ...w.bbox, y0: w.bbox.y0 + dy, y1: w.bbox.y1 + dy } })) })

describe('layoutOcr: a ruled grid (a table screenshot with a border on every cell)', () => {
  // Columns: Sr (to x 100), Description (to 520), Required for (to 760), Qty (to 840), Unit. Rows: header (to y 60), then bands of 120.
  const bar = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 })
  const rules = {
    horizontal: [60, 180, 300, 420].map(y => bar(0, y, 940, y + 2)),
    vertical: [100, 520, 760, 840].map(x => bar(x, 0, x + 2, 420)),
  }
  const head = cells(40, [[20, 'SR.'], [200, 'DESCRIPTION'], [540, 'REQUIRED FOR'], [770, 'QTY'], [850, 'UOM']])
  // The engine reads a line straight across the cells that share a pixel row, so the rows of neighbouring cells run together.
  const first = [
    cells(110, [[120, 'MOTOR STARTER - 22KW'], [540, 'Most Urgent']]),
    cells(135, [[40, '1'], [790, '2'], [855, 'NOS']]),
    cells(150, [[120, '(MODEL:XK40-300 ZENTAR).'], [540, 'Demand For']]),
    cells(175, [[560, 'Deptt.']]),
  ]
  const second = [cells(230, [[120, 'LEVEL TX LX9Y-'], [540, 'For Boiler House']]), cells(255, [[40, '2'], [790, '1'], [855, 'NOS']]), cells(270, [[120, '204KR.'], [560, 'Deptt.']])]

  it('keeps a wrapped description and its neighbours in their cells, one row per grid row', () => {
    const out = linesToText(layoutOcr([head, ...first, ...second], rules))
    expect(out).toBe(
      [
        'SR.\tDESCRIPTION\tREQUIRED FOR\tQTY\tUOM',
        '1\tMOTOR STARTER - 22KW (MODEL:XK40-300 ZENTAR).\tMost Urgent Demand For Deptt.\t2\tNOS',
        '2\tLEVEL TX LX9Y-204KR.\tFor Boiler House Deptt.\t1\tNOS',
      ].join('\n'),
    )
  })

  it('leaves the words above and below the grid to the ordinary layout', () => {
    const out = linesToText(layoutOcr([line(-40, 20, ['Please', 'quote', 'the', 'items', 'below:']), head, ...first, ...second, line(500, 20, ['Thank', 'you'])], rules))
    expect(out.split('\n')[0]).toBe('Please quote the items below:')
    expect(out.split('\n').at(-1)).toBe('Thank you')
    expect(out).toContain('2\tLEVEL TX LX9Y-204KR.\tFor Boiler House Deptt.\t1\tNOS')
  })

  it('cuts a heading row off the first row when a filled band left no rule under it, and puts right a heading read a letter off', () => {
    const noHeadRule = { horizontal: [200, 320].map(y => bar(0, y, 940, y + 2)), vertical: rules.vertical }
    const out = linesToText(layoutOcr([cells(40, [[20, 'SR.'], [200, 'DESCRIPTION'], [540, 'REQUIRED FOR'], [770, 'QrY'], [850, 'UOM']]), ...first.map(l => shift(l, 20)), ...second.map(l => shift(l, 20))], noHeadRule))
    expect(out.split('\n')[0]).toBe('SR.\tDESCRIPTION\tREQUIRED FOR\tQty\tUOM')
    expect(out.split('\n')[1]).toBe('1\tMOTOR STARTER - 22KW (MODEL:XK40-300 ZENTAR).\tMost Urgent Demand For Deptt.\t2\tNOS')
  })

  it('does not trust a grid whose row rules were missed: a column of numbers, a line each, is not one cell', () => {
    const few = { horizontal: [60, 420].map(y => bar(0, y, 940, y + 2)), vertical: rules.vertical }
    const stacked = [1, 2, 3, 4].flatMap((n, i) => [cells(110 + 40 * i, [[40, String(n)], [120, 'Valve ' + n], [790, String(2 * n)], [855, 'NOS']])])
    const out = linesToText(layoutOcr([head, ...stacked], few))
    expect(out.split(String.fromCharCode(10))).toHaveLength(5)
    expect(out).toContain('2' + String.fromCharCode(9) + 'Valve 2')
  })

  it('is no grid when the rules are one underline or two lines', () => {
    expect(linesToText(layoutOcr([line(100, 40, ['Valve', 'Brass'])], { horizontal: [bar(0, 120, 400, 122)], vertical: [] }))).toBe('Valve Brass')
  })
})

describe('snapUnitColumn: a unit the engine misread in a column of units', () => {
  const row = (...cs: string[]) => ({ cells: cs, kind: 'row' as const, page: 1, text: cs.join('\t') })
  it('takes the unit the column writes, in the column\'s case', () => {
    const rows = [row('1', 'Thimble', 'PCS', '24'), row('2', 'Capacitor', 'Pcs', '12'), row('3', 'MCB', 'PCS', '6'), row('4', 'Thimble 8x25', 'PG', '12'), row('5', 'Relay', 'PCS', '4')]
    snapUnitColumn(rows)
    expect(rows.map(r => r.cells[2])).toEqual(['PCS', 'Pcs', 'PCS', 'PCS', 'PCS'])
    expect(rows[3]!.text).toBe('4\tThimble 8x25\tPCS\t12')
  })

  it('leaves a column that is not units, and a word that is nothing like a unit of the column', () => {
    const notUnits = [row('1', 'a', 'Boiler', '2'), row('2', 'b', 'Kiln', '2'), row('3', 'c', 'Utilities', '2'), row('4', 'd', 'Packing', '2')]
    snapUnitColumn(notUnits)
    expect(notUnits.map(r => r.cells[2])).toEqual(['Boiler', 'Kiln', 'Utilities', 'Packing'])
    const odd = [row('1', 'a', 'PCS', '2'), row('2', 'b', 'PCS', '2'), row('3', 'c', 'PCS', '2'), row('4', 'd', 'Urgent', '2')]
    snapUnitColumn(odd)
    expect(odd[3]!.cells[2]).toBe('Urgent')
  })
})
