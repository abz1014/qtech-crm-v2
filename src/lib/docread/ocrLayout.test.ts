import { describe, expect, it } from 'vitest'
import { cleanWord, deskew, isChromeLine, layoutOcr, pageConfidence, unwrapLines, type OcrLine, type OcrWord } from './ocrLayout'
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
