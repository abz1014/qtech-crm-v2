import { describe, expect, it } from 'vitest'
import { layoutPages, linesToText, type TextRun } from './pdfLayout'

/** A run as pdf.js would give it: width about half the font size per character. */
const run = (str: string, x: number, y: number, size = 9): TextRun => ({ str, x, y, w: str.length * size * 0.5, size })
/** A number right-aligned at x. */
const rnum = (str: string, right: number, y: number, size = 9): TextRun => run(str, right - str.length * size * 0.5, y, size)

const text = (pages: TextRun[][]) => linesToText(layoutPages(pages))

describe('layoutPages: lines', () => {
  it('orders runs by baseline then x, and joins words of one line', () => {
    expect(text([[run('world', 80, 100), run('Hello', 50, 100.4), run('Second line', 50, 112)]])).toBe('Hello world\nSecond line')
  })

  it('splits a letterhead line into its far-apart parts, but keeps "label:   value" together', () => {
    const page = [run('Eastfield Cement Company Ltd', 40, 60), run('RFQ No: 6000012345', 400, 60), run('Qty:', 40, 72), run('2 Nos', 120, 72)]
    expect(text([page])).toBe('Eastfield Cement Company Ltd\nRFQ No: 6000012345\nQty: 2 Nos')
  })

  it('drops page numbers, keeps one copy of fake-bold text and marks paragraph breaks with a blank line', () => {
    const page = [run('Dear Sir,', 40, 60), run('Dear Sir,', 40.2, 60), run('Please quote the following.', 40, 90), run('Page 1 of 3', 280, 800)]
    expect(text([page])).toBe('Dear Sir,\n\nPlease quote the following.')
  })

  it('writes a spreadsheet-like line with no header as a tab row', () => {
    expect(text([[run('1', 40, 100), run('Gate valve 4 inch class 150', 70, 100), run('10', 380, 100), run('Nos', 420, 100)]])).toBe(
      '1\tGate valve 4 inch class 150\t10\tNos',
    )
  })
})

describe('layoutPages: tables', () => {
  it('folds a top-aligned wrapped description into its row', () => {
    const page = [
      run('S.No', 40, 100), run('Description', 80, 100), run('Qty', 380, 100), run('Unit', 420, 100),
      run('1', 40, 115), run('Pressure transmitter, range 0-10 bar,', 80, 115), rnum('2', 395, 115), run('Nos', 420, 115),
      run('4-20mA with HART, SS316 wetted parts', 80, 126),
      run('2', 40, 141), run('Pressure gauge 4 inch dial', 80, 141), rnum('6', 395, 141), run('Nos', 420, 141),
    ]
    expect(text([page])).toBe(
      [
        'S.No\tDescription\tQty\tUnit',
        '1\tPressure transmitter, range 0-10 bar, 4-20mA with HART, SS316 wetted parts\t2\tNos',
        '2\tPressure gauge 4 inch dial\t6\tNos',
      ].join('\n'),
    )
  })

  it('folds description lines around a vertically centred row into that row', () => {
    // Excel-made PDFs centre the short cells: the number sits between the two description lines.
    const page = [
      run('Item', 40, 100), run('Description', 80, 100), run('Qty', 380, 100),
      run('Temperature transmitter PT100', 80, 114), run('1', 40, 119), rnum('4', 395, 119), run('head mounted, 4-20mA', 80, 124),
      run('Thermowell SS316 for the above', 80, 140), run('2', 40, 145), rnum('4', 395, 145), run('length 250 mm', 80, 150),
    ]
    expect(text([page])).toBe(
      [
        'Item\tDescription\tQty',
        '1\tTemperature transmitter PT100 head mounted, 4-20mA\t4',
        '2\tThermowell SS316 for the above length 250 mm\t4',
      ].join('\n'),
    )
  })

  it('reads a header written on two lines and an SAP-style table with item numbers, 3-decimal quantities and long text', () => {
    const page = [
      run('Item', 40, 200), run('Material', 80, 200), run('Description', 150, 200), run('Quantity', 360, 200), run('Unit', 410, 200), run('Delivery', 440, 200),
      run('Date', 440, 209),
      run('00010', 40, 225), run('1000012345', 80, 225), run('TRANSMITTER,PRESSURE;0-25BAR', 150, 225), rnum('2.000', 400, 225), run('EA', 410, 225), run('15.08.2026', 440, 225),
      run('Make: Rosemount, Model: 3051TG', 150, 236),
      run('00020', 40, 251), run('1000067890', 80, 251), run('GAUGE,PRESSURE;0-10BAR,4"', 150, 251), rnum('6.000', 400, 251), run('EA', 410, 251), run('15.08.2026', 440, 251),
      run('Terms and conditions apply.', 40, 300),
    ]
    expect(text([page])).toBe(
      [
        'Item\tMaterial\tDescription\tQuantity\tUnit\tDelivery Date',
        '00010\t1000012345\tTRANSMITTER,PRESSURE;0-25BAR Make: Rosemount, Model: 3051TG\t2.000\tEA\t15.08.2026',
        '00020\t1000067890\tGAUGE,PRESSURE;0-10BAR,4"\t6.000\tEA\t15.08.2026',
        '',
        'Terms and conditions apply.',
      ].join('\n'),
    )
  })

  it('cuts cells that pdf.js merged back at the column edges', () => {
    // pdf.js joins runs less than about half a character apart into one item, with a space.
    const merged = (parts: Array<[string, number]>, y: number): TextRun => {
      const first = parts[0] as [string, number]
      const last = parts[parts.length - 1] as [string, number]
      return { str: parts.map(p => p[0]).join(' '), x: first[1], y, w: last[1] + last[0].length * 4.5 - first[1], size: 9 }
    }
    const page = [
      run('No.', 40, 100), run('Part No.', 66, 100), run('Description', 160, 100), run('Qty', 363, 100),
      merged([['Unit Price (USD)', 405], ['Amount (USD)', 482]], 100),
      run('1', 40, 115), merged([['6ES7214-1AG40-0XB0', 66], ['SIMATIC S7-1200 CPU', 151]], 115), rnum('2', 378, 115),
      rnum('285.00', 477, 115), rnum('570.00', 536, 115),
      run('2', 40, 130), run('6EP1334-2BA20', 66, 130), merged([['SITOP PSU100S stabilized power supply 24V 10A', 160], ['1', 373.5]], 130),
      rnum('142.50', 477, 130), rnum('142.50', 536, 130),
    ]
    const lines = layoutPages([page])
    expect(lines.map(l => l.cells)).toEqual([
      ['No.', 'Part No.', 'Description', 'Qty', 'Unit Price (USD)', 'Amount (USD)'],
      ['1', '6ES7214-1AG40-0XB0', 'SIMATIC S7-1200 CPU', '2', '285.00', '570.00'],
      ['2', '6EP1334-2BA20', 'SITOP PSU100S stabilized power supply 24V 10A', '1', '142.50', '142.50'],
    ])
  })

  it('ends the table at the terms and picks it up again on the next page', () => {
    const p1 = [
      run('S.No', 40, 100), run('Description', 80, 100), run('Qty', 380, 100), run('Unit', 420, 100),
      run('1', 40, 115), run('Ball valve DN25', 80, 115), rnum('2', 395, 115), run('Nos', 420, 115),
      run('Page 1 of 2', 280, 800),
    ]
    const p2 = [
      run('Purchase Department', 40, 40),
      run('2', 40, 80), run('Ball valve DN50', 80, 80), rnum('3', 395, 80), run('Nos', 420, 80),
      run('Note: quote with origin', 40, 110),
    ]
    expect(text([p1, p2])).toBe(
      [
        'S.No\tDescription\tQty\tUnit',
        '1\tBall valve DN25\t2\tNos',
        '',
        'Purchase Department',
        'S.No\tDescription\tQty\tUnit',
        '2\tBall valve DN50\t3\tNos',
        '',
        'Note: quote with origin',
      ].join('\n'),
    )
  })

  it('skips nothing and invents nothing on an empty page', () => {
    expect(layoutPages([[], []])).toEqual([])
  })
})
