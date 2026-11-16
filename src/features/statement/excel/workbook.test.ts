import { CFB, read, utils, type WorkSheet } from 'xlsx'
import { describe, expect, it } from 'vitest'
import { buildStatement } from '@/features/statement/model'
import { buildStatementWorkbook, COLUMNS, SHEET_NAME, statementSheet } from '@/features/statement/excel/workbook'
import { PROFILE, sampleData } from '@/features/statement/testFixture'

/*
 * The comparative statement Excel file, read back with SheetJS: one sheet, the letterhead and job facts, the column headings, one row
 * per supplier quote with numbers as numbers, the totals per supplier per currency, column widths, and the frozen, bold heading row.
 * Synthetic data only. Setting STATEMENT_SAMPLE_XLSX to a path also writes the file there, for looking at.
 */
const HEADINGS = ['No.', 'Item', 'Specification', 'Qty', 'Unit', 'Supplier', 'Currency', 'Unit cost', 'Total cost', 'Lead time', 'Unit weight', 'Total weight', 'Country of origin', 'Note']

function open(bytes: Uint8Array): WorkSheet {
  const wb = read(bytes, { type: 'array', cellNF: true, cellStyles: true })
  expect(wb.SheetNames).toEqual([SHEET_NAME])
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
    const sheetXml = xmlPart(bytes, 'xl/worksheets/sheet1.xml')
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
