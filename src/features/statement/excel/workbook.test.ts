import { CFB, read, utils, type WorkSheet } from 'xlsx'
import { describe, expect, it } from 'vitest'
import { formatPaisa, productPaisa } from '@/lib/money'
import type { InquiryRow } from '@/features/rfqs/api'
import { buildStatement } from '@/features/statement/model'
import { buildStatementWorkbook, COLUMNS, partModel, SHEET_NAME, SIDE_NOTE, SIDE_SHEET_NAME, sideBySideSheet, statementSheet } from '@/features/statement/excel/workbook'
import { PROFILE, sampleData } from '@/features/statement/testFixture'

/*
 * The comparative statement Excel file, read back with SheetJS. Two sheets: "Side by side" (items as rows, a column pair per supplier)
 * and "Details": the letterhead and job facts, the column headings, one row
 * per supplier quote with numbers as numbers, the totals per supplier per currency, column widths, and the frozen, bold heading row.
 * Synthetic data only. Setting STATEMENT_SAMPLE_XLSX to a path also writes the file there, for looking at.
 */
const HEADINGS = ['No.', 'Item', 'Specification', 'Qty', 'Unit', 'Supplier', 'Currency', 'Unit cost', 'Total cost', 'Lead time', 'Unit weight', 'Total weight', 'Country of origin', 'Note']

function open(bytes: Uint8Array): WorkSheet {
  const wb = read(bytes, { type: 'array', cellNF: true, cellStyles: true })
  expect(wb.SheetNames).toEqual([SIDE_SHEET_NAME, SHEET_NAME])
  return wb.Sheets[SHEET_NAME]
}

const rowsOf = (ws: WorkSheet) => utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: true, defval: null })

function xmlPart(bytes: Uint8Array, name: string): string {
  const zip = CFB.read(bytes, { type: 'array' }) as { FullPaths: string[]; FileIndex: { content: Uint8Array }[] }
  const i = zip.FullPaths.findIndex(p => p.endsWith(`/${name}`))
  return new TextDecoder().decode(zip.FileIndex[i].content)
}

describe('comparative statement workbook', () => {
  it('has the letterhead, the job facts and the column headings, in the order of the PDF', () => {
    const data = sampleData(3)
    const ws = open(buildStatementWorkbook(data, PROFILE))
    const rows = rowsOf(ws)
    expect(rows[0][0]).toBe('Q-Tech Engineering (Pvt) Ltd')
    expect(rows[1][0]).toBe('Office 5, Block 7, Clifton, Karachi   +92 21 0000000   sales@example.com   example.com')
    expect(rows[3][0]).toBe('Comparative statement')
    expect(rows.slice(4, 8).map(r => r[0])).toEqual(['Job / RFQ: Job 139 (RFQ-0139)', 'Customer: Acme Cement Ltd', 'Date: 29 Oct 2026', 'Prepared by: Sana Sales'])
    expect(rows[9]).toEqual(HEADINGS)
    expect(COLUMNS.map(c => c.label)).toEqual(HEADINGS)
    expect(ws['!cols']?.map(c => c.wch)).toEqual(COLUMNS.map(c => c.width))
  })

  it('has one row per supplier quote per item, the same rows as the statement, with numbers as numbers', () => {
    const data = sampleData(3)
    const bytes = buildStatementWorkbook(data, PROFILE)
    const ws = open(bytes)
    const rows = rowsOf(ws)
    const sheet = statementSheet(data, PROFILE)
    const grid = rows.slice(sheet.headingRow, sheet.lastGridRow)
    const quotes = grid.filter(r => r[5] !== null)
    expect(quotes).toHaveLength(data.statement.sections.reduce((n, s) => n + s.rows.length, 0))
    // item 1 (12.5 m), suppliers in name order, every currency its own code
    const first = data.statement.sections[0]
    expect(grid.filter(r => r[0] === 1 && r[5] !== null).map(r => r[5])).toEqual(first.rows.map(r => r.supplierName))
    const [alpha] = first.rows
    const row = grid[0]
    expect(row.slice(0, 9)).toEqual([1, 'Pressure transmitter 1', 'Range 0-10 bar, 4-20 mA, IP67, stainless wetted parts', 12.5, 'm', 'Alpha Instruments GmbH', 'EUR', alpha.unitCost, Number(alpha.totalMinor) / 100])
    expect(row[9]).toBe('4-6 weeks')
    expect(row[10]).toBe(0.4)
    expect(row[11]).toBe(5) // 12.5 m x 0.4 kg
    expect(row[12]).toBe('Germany')
    // number cells carry a number format: money with thousands and 2 decimals, weights showing their unit
    const r = sheet.headingRow + 1
    expect(ws[`H${r}`]).toMatchObject({ t: 'n', z: '#,##0.00' })
    expect(ws[`I${r}`]).toMatchObject({ t: 'n', z: '#,##0.00' })
    expect(ws[`D${r}`]).toMatchObject({ t: 'n', v: 12.5 })
    expect(ws[`K${r}`]).toMatchObject({ t: 'n', v: 0.4 })
    expect(String(ws[`K${r}`].z)).toContain('kg')
    expect(ws[`L${r}`]).toMatchObject({ t: 'n', v: 5, z: 'General" kg"' })
    // the suppliers that did not reply are one line under the item, not quote rows
    expect(grid.filter(x => x[0] === 1 && x[5] === null).map(x => x[13])).toEqual(['No reply: Epsilon Automation'])
    expect(grid.find(x => x[0] === 2 && x[5] === null)?.[13]).toBe('No reply: Epsilon Automation. Did not quote: Delta Trading')
    // it selects nothing
    expect(JSON.stringify(rows)).not.toMatch(/cheap|lowest|best|recommend|winner|preferred/i)
  })

  it('ends with the totals per supplier per currency, never added across currencies', () => {
    const data = sampleData(3)
    const rows = rowsOf(open(buildStatementWorkbook(data, PROFILE)))
    const at = rows.findIndex(r => r[1] === 'Totals by supplier')
    expect(at).toBeGreaterThan(9)
    expect([rows[at + 1][5], rows[at + 1][6], rows[at + 1][8], rows[at + 1][9]]).toEqual(['Supplier', 'Currency', 'Total cost', 'Items quoted'])
    const totals = rows.slice(at + 2, at + 2 + data.statement.totals.length)
    expect(totals.map(r => [r[5], r[6], r[8], r[9]])).toEqual(
      data.statement.totals.map(t => [t.supplierName, t.byCurrency[0].currency, Number(t.byCurrency[0].totalMinor) / 100, `${t.itemsQuoted} of ${t.itemCount}`]),
    )
    expect(rows.at(-1)?.[0]).toMatch(/^Cost is what each supplier quoted/)
  })

  it('freezes the rows down to the column headings, filters the grid and draws the headings in bold', () => {
    const data = sampleData(3)
    const bytes = buildStatementWorkbook(data, PROFILE)
    const sheetXml = xmlPart(bytes, 'xl/worksheets/sheet2.xml')
    expect(sheetXml).toContain('<pane ySplit="10" topLeftCell="A11" activePane="bottomLeft" state="frozen"/>')
    expect(sheetXml).toMatch(/<autoFilter ref="A10:N\d+"\/>/)
    const styles = xmlPart(bytes, 'xl/styles.xml')
    const xfs = /<cellXfs count="(\d+)">/.exec(styles)
    const bold = Number(xfs?.[1]) - 2
    expect(styles).toContain('<font><b/><sz val="12"/>')
    for (const col of 'ABCDEFGHIJKLMN') expect(sheetXml).toMatch(new RegExp(`<c r="${col}10"[^>]* s="${bold}"`))
    expect(sheetXml).toMatch(new RegExp(`<c r="A4"[^>]* s="${bold + 1}"`)) // the title, larger
    if (process.env.STATEMENT_SAMPLE_XLSX) {
      return import('node:fs').then(fs => fs.writeFileSync(process.env.STATEMENT_SAMPLE_XLSX as string, bytes))
    }
  })

  it('an RFQ with nothing quoted still makes a file that says so', () => {
    const data = sampleData(2, false)
    data.statement = buildStatement([], [])
    const rows = rowsOf(open(buildStatementWorkbook(data, PROFILE)))
    expect(rows.flat()).toContain('This RFQ has no items.')
    expect(rows.flat()).toContain('No supplier has quoted yet.')
  })
})

describe('comparative statement, side by side sheet', () => {
  const NAMES = ['Alpha Instruments GmbH', 'Beta Controls Ltd', 'Delta Trading', 'Epsilon Automation', 'Gamma Supply Co']
  const setUp = () => {
    const data = sampleData(3)
    const grid = structuredClone(data.grid!)
    const inq = (name: string) => grid.inquiries.find(i => i.supplierName === name) as InquiryRow
    return { data, grid, inq }
  }
  /** Column of supplier i's Unit cost (0-based); its Lead time is the next one. */
  const col = (i: number) => 6 + 2 * i

  it('has the job facts, two heading rows and one column pair per supplier asked, A to Z', () => {
    const { data, grid } = setUp()
    const s = sideBySideSheet(data, grid, PROFILE)
    expect(s.rows.slice(0, 10).map(r => r[0] ?? null)).toEqual([
      'Q-Tech Engineering (Pvt) Ltd',
      null,
      'Comparative statement',
      'Customer: Acme Cement Ltd',
      'Contact: Imran Ali',
      'Customer ref: ACM-REQ-77',
      'Job / RFQ: Job 139 (RFQ-0139)',
      'Date: 29 Oct 2026',
      'Prepared by: Sana Sales',
      null,
    ])
    expect(s.suppliers).toEqual(NAMES)
    const h1 = s.rows[s.headingRow - 1]
    const h2 = s.rows[s.subHeadingRow - 1]
    expect(h1.slice(0, 6)).toEqual(['No.', 'Item', 'Brand', 'Part / model', 'Qty', 'Unit'])
    expect(NAMES.map((_, i) => h1[col(i)])).toEqual(NAMES)
    expect(NAMES.map((_, i) => [h2[col(i)], h2[col(i) + 1]])).toEqual(NAMES.map(() => ['Unit cost', 'Lead time']))
    expect(s.boldRows).toEqual(expect.arrayContaining([1, 3, s.headingRow, s.subHeadingRow]))
    expect(s.merges).toContainEqual({ s: { r: s.headingRow - 1, c: 0 }, e: { r: s.subHeadingRow - 1, c: 0 } })
    expect(s.merges).toContainEqual({ s: { r: s.headingRow - 1, c: 6 }, e: { r: s.headingRow - 1, c: 7 } })
    expect(s.widths).toEqual([6, 40, 18, 22, 7, 7, ...NAMES.flatMap(() => [16, 14])])
    // a supplier only on the shortlist (never asked) has no columns
    grid.inquiries[0] = { ...grid.inquiries[0], sentOn: null, noOfferOn: null, lines: [] }
    expect(sideBySideSheet(data, grid, PROFILE).suppliers).toEqual(NAMES.slice(1))
    // missing contact and reference show a dash
    const bare = sideBySideSheet(data, { ...grid, contact: null, customerRef: '  ' }, PROFILE)
    expect([bare.rows[4][0], bare.rows[5][0]]).toEqual(['Contact: —', 'Customer ref: —'])
  })

  it('one row per item: number, title, brand, part / model, qty, unit, and each quote as a number in its currency', () => {
    const { data, grid, inq } = setUp()
    grid.items[0] = { ...grid.items[0], description: 'Pressure transmitter\nRosemount 3051TG2A, 4-20 mA', brandName: 'Rosemount' }
    grid.items[1] = { ...grid.items[1], description: 'Valve ABC123 X200Y', brandName: 'ABC123' }
    const s = sideBySideSheet(data, grid, PROFILE)
    const items = s.rows.slice(s.firstItemRow - 1, s.lastItemRow)
    expect(items).toHaveLength(3)
    expect(items.map(r => r.slice(0, 6))).toEqual([
      [1, 'Pressure transmitter', 'Rosemount', '3051TG2A', 12.5, 'm'],
      [2, 'Valve ABC123 X200Y', 'ABC123', 'X200Y', 2, 'pcs'],
      [3, 'Cable gland M20 type 3', '', '', 12.5, 'm'],
    ])
    const alpha = inq('Alpha Instruments GmbH').lines[0]
    expect(items[0][col(0)]).toEqual({ v: alpha.unitPrice, z: '"EUR "#,##0.00' })
    expect(items[0][col(0) + 1]).toBe('4-6 weeks')
    expect(items[0][col(1)]).toMatchObject({ z: '"USD "#,##0.00' })
    expect(items[0][col(2)]).toMatchObject({ z: '"PKR "#,##0.00' })
    // it selects nothing
    expect(JSON.stringify(s.rows)).not.toMatch(/cheap|lowest|best|recommend|winner|preferred/i)
  })

  it('a cell with no price says why: quoting later, cannot quote, no reply, not quoted', () => {
    const { data, grid, inq } = setUp()
    const base = sideBySideSheet(data, grid, PROFILE)
    const row2 = (s: typeof base) => s.rows[s.firstItemRow] // item 2 (i1)
    expect(row2(base)[col(2)]).toBe('Not quoted') // Delta quoted items 1 and 3 only
    expect(row2(base)[col(2) + 1]).toBeNull()
    expect(row2(base)[col(3)]).toBe('No reply') // Epsilon sent nothing
    const gamma = inq('Gamma Supply Co')
    gamma.lines = gamma.lines.filter(l => l.itemId !== 'i1')
    Object.assign(gamma, { itemWaits: { i1: true } })
    inq('Delta Trading').itemDeclines = { i1: 'obsolete' }
    inq('Epsilon Automation').noOfferOn = '2026-10-25'
    const s = sideBySideSheet(data, grid, PROFILE)
    expect(row2(s)[col(4)]).toBe('Quoting later')
    expect(row2(s)[col(2)]).toBe('Cannot quote')
    const items = s.rows.slice(s.firstItemRow - 1, s.lastItemRow)
    expect(items.map(r => r[col(3)])).toEqual(['Cannot quote', 'Cannot quote', 'Cannot quote'])
  })

  it('ends with each supplier total of the items it quoted, never adding currencies, and the note', () => {
    const { data, grid, inq } = setUp()
    const alpha = inq('Alpha Instruments GmbH')
    alpha.lines[2] = { ...alpha.lines[2], currency: 'USD' }
    const s = sideBySideSheet(data, grid, PROFILE)
    const total = s.rows[s.lastItemRow + 1]
    expect(s.rows[s.lastItemRow]).toEqual([])
    expect(total[1]).toBe('Total')
    expect(s.boldRows).toContain(s.lastItemRow + 2)
    const sum = (inquiry: InquiryRow, cur: string) =>
      inquiry.lines.filter(l => l.currency === cur).reduce((n, l) => n + productPaisa(grid.items.find(it => it.id === l.itemId)!.qty, l.unitPrice), 0n)
    expect(total[col(1)]).toEqual({ v: Number(sum(inq('Beta Controls Ltd'), 'USD')) / 100, z: '"USD "#,##0.00' })
    expect(total[col(1) + 1]).toBe('3 of 3 items')
    expect(total[col(2) + 1]).toBe('2 of 3 items')
    expect(total[col(0)]).toBe(`EUR ${formatPaisa(sum(alpha, 'EUR'), 'always')} + USD ${formatPaisa(sum(alpha, 'USD'), 'always')}`)
    expect(total[col(3)]).toBeNull()
    expect(total[col(3) + 1]).toBe('0 of 3 items')
    expect(s.rows.at(-1)).toEqual([SIDE_NOTE])
  })

  it('is the first sheet of the file, merged, filtered over the items, bold, and frozen right of Unit and under the headings', () => {
    const data = sampleData(3)
    const bytes = buildStatementWorkbook(data, PROFILE)
    const wb = read(bytes, { type: 'array', cellNF: true, cellStyles: true })
    expect(wb.SheetNames).toEqual(['Side by side', 'Details'])
    const ws = wb.Sheets['Side by side']
    const s = sideBySideSheet(data, data.grid!, PROFILE)
    expect(s.subHeadingRow).toBe(12)
    expect(ws['!merges']).toHaveLength(6 + 5)
    expect(ws.G13).toMatchObject({ t: 'n', z: '"EUR "#,##0.00' })
    expect(ws['!cols']?.map(c => c.wch)).toEqual(s.widths)
    const xml = xmlPart(bytes, 'xl/worksheets/sheet1.xml')
    expect(xml).toContain('<pane xSplit="6" ySplit="12" topLeftCell="G13" activePane="bottomRight" state="frozen"/>')
    expect(xml).toMatch(/<autoFilter ref="A12:P15"\/>/)
    const styles = xmlPart(bytes, 'xl/styles.xml')
    const bold = Number(/<cellXfs count="(\d+)">/.exec(styles)?.[1]) - 2
    expect(xml).toMatch(new RegExp(`<c r="A11"[^>]* s="${bold}"`))
    expect(xml).toMatch(new RegExp(`<c r="G12"[^>]* s="${bold}"`))
    expect(xml).toMatch(new RegExp(`<c r="A3"[^>]* s="${bold + 1}"`))
    expect(xmlPart(bytes, 'xl/worksheets/sheet2.xml')).toContain('<pane ySplit="10" topLeftCell="A11" activePane="bottomLeft" state="frozen"/>')
  })

  it('without the raw RFQ the file has the details sheet only', () => {
    const data = sampleData(2)
    delete data.grid
    const wb = read(buildStatementWorkbook(data, PROFILE), { type: 'array' })
    expect(wb.SheetNames).toEqual([SHEET_NAME])
  })
})

describe('partModel: the part as the description writes it (owner, 20 Nov 2026)', () => {
  const it0 = (description: string, brandName: string | null = null) => ({ id: 'x', number: 1, description, brandId: null, brandName, familyId: null, qty: 1, unit: null })
  it('keeps dashes and the case of the original', () => {
    expect(partModel(it0('HMI Touch Panel Siemens 6AV2124-0QC02-0AX0 SIMATIC HMI TP1500', 'Siemens'))).toBe('6AV2124-0QC02-0AX0')
    expect(partModel(it0('HMI Touch Panel Weintek MT8102iE 10.1" TFT', 'Weintek'))).toBe('MT8102iE')
    expect(partModel(it0('Phase Monitoring Relay ABB CM-PVS.41S 3-phase', 'ABB'))).toBe('CM-PVS.41S')
  })
  it('is empty when the description names no model', () => {
    expect(partModel(it0('Inverter power card for a 37kW drive'))).toBe('')
  })
})
