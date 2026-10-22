import { describe, expect, it } from 'vitest'
import { utils, write } from 'xlsx'
import { parseEnquiry } from './enquiryParse'
import { columnRole, findHeader, isSheetFile, readSheetText, sheetRowsText } from './sheetText'

// Fictional workbooks made here with SheetJS itself: every name, number and part is invented.
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function workbook(sheets: Record<string, unknown[][]>, bookType: 'xlsx' | 'xls' = 'xlsx'): File {
  const wb = utils.book_new()
  for (const [name, rows] of Object.entries(sheets)) utils.book_append_sheet(wb, utils.aoa_to_sheet(rows, { cellDates: true }), name)
  const bytes = write(wb, { type: 'array', bookType }) as ArrayBuffer
  return new File([bytes], `enquiry.${bookType}`, { type: bookType === 'xls' ? 'application/vnd.ms-excel' : XLSX_TYPE })
}

const today = '2026-10-20'

describe('spreadsheet enquiries', () => {
  it('finds the item table under the title rows by its header row, maps its columns and keeps the facts above it', async () => {
    const file = workbook({
      RFQ: [
        ['Zarvan Polymer Industries (Pvt) Ltd'],
        ['Plot 12-A, Industrial Estate, Hattar'],
        [],
        ['RFQ No:', 'ZPI/PUR/2026/118', '', 'Date:', new Date(2026, 9, 19)],
        ['Quotation Due Date:', '02/11/2026'],
        [],
        ['S.No', 'Item Code', 'Description', 'Make', 'Part No.', 'UOM', 'Qty', 'Last Rate', 'Amount', 'Remarks'],
        [1, 'ELC-00231', 'Pressure transmitter 0-16 bar, 4-20mA HART', 'Voltreg', '7MF4033-1EA00-2AB1', 'Nos', 2, 41000, 82000, 'Urgent'],
        [2, 'INS-10233', 'Control cable 4 core x 1.5 mm2, shielded', '', '', 'Mtr', 12.5, 250, 3125, ''],
        [3, 'MEC-00045', 'Cable tie 300 mm, nylon black', '', '', 'Nos', 1000, 3, 3000, ''],
        [4, 'GEN-77812', 'Lithium grease NLGI 2', '', '', 'Kg', 0.5, 1200, 600, ''],
        [],
        ['Total', '', '', '', '', '', '', '', 88725],
        [],
        ['Prepared by: Haris Bajwa, Purchase Officer'],
      ],
    })
    const r = await readSheetText(file)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.table).toBe(true)
    expect(r.text).toContain('S.No\tDescription\tPart No\tMake\tQty\tUnit')
    expect(r.text).not.toMatch(/ELC-00231|41000|Urgent/)
    const p = parseEnquiry(r.text, { today })
    expect(p.items.map(i => [i.qty, i.unit])).toEqual([
      [2, 'nos'],
      [12.5, 'm'],
      [1000, 'nos'],
      [0.5, 'kg'],
    ])
    expect(p.items[0]?.description).toContain('7MF4033-1EA00-2AB1')
    expect(p.items[0]?.description).toContain('Voltreg')
    expect(p.facts.customerRef?.value).toBe('ZPI/PUR/2026/118')
    expect(p.facts.dueDate?.iso).toBe('2026-11-02')
    expect(p.facts.company?.name).toBe('Zarvan Polymer Industries (Pvt) Ltd')
  })

  it('reads the sheet with the items when a workbook has a cover sheet, and an old .xls too', async () => {
    const rows = [
      ['Item', 'Description', 'Specification', 'Qty', 'Unit'],
      [1, 'Ball valve', '2 inch SS316 flanged', 4, 'Nos'],
      [2, 'Solenoid valve', '1/2" BSP 24VDC', 6, 'EA'],
    ]
    for (const type of ['xlsx', 'xls'] as const) {
      const r = await readSheetText(workbook({ Cover: [['Enquiry for valves'], ['Please quote']], Items: rows }, type))
      expect(r.ok && r.sheet).toBe('Items')
      const p = parseEnquiry(r.ok ? r.text : '', { today })
      expect(p.items).toEqual([
        { description: 'Ball valve, 2 inch SS316 flanged', qty: 4, unit: 'nos' },
        { description: 'Solenoid valve, 1/2" BSP 24VDC', qty: 6, unit: 'EA' },
      ])
    }
  })

  it('reads a CSV as typed: the Urdu word for pieces, thousands with a comma, a day-first date', async () => {
    const csv = 'Description,Qty,Unit\nFuse 10A glass,4,عدد\n"Cable lug 6 mm2, ring type","1,000",Nos\nPU tube 8mm,0.5,m\n\nDue date: 05/11/2026\n'
    const r = await readSheetText(new File([csv], 'enquiry.csv', { type: 'text/csv' }))
    expect(r.ok).toBe(true)
    const p = parseEnquiry(r.ok ? r.text : '', { today })
    expect(p.items).toEqual([
      { description: 'Fuse 10A glass', qty: 4, unit: 'nos' },
      { description: 'Cable lug 6 mm2, ring type', qty: 1000, unit: 'nos' },
      { description: 'PU tube 8mm', qty: 0.5, unit: 'm' },
    ])
    expect(p.facts.dueDate?.iso).toBe('2026-11-05')
  })

  it('passes a sheet with no header row through cell by cell, as Excel copies it', async () => {
    const r = await readSheetText(workbook({ Sheet1: [['Proximity sensor M18 PNP NO', 6, 'PCS'], ['Limit switch roller lever', 2, 'EA']] }))
    expect(r.ok && r.table).toBe(false)
    const p = parseEnquiry(r.ok ? r.text : '', { today })
    expect(p.items.map(i => [i.description, i.qty, i.unit])).toEqual([
      ['Proximity sensor M18 PNP NO', 6, 'PCS'],
      ['Limit switch roller lever', 2, 'EA'],
    ])
  })

  it('gives a supplier price sheet every column, for the quote parser', () => {
    const rows = [['Item', 'Description', 'Qty', 'Unit Price (USD)', 'Total'], ['1', 'Encoder 1024 PPR', '2', '145.00', '290.00']]
    expect(sheetRowsText(rows, 'prices').text).toBe('Item\tDescription\tQty\tUnit Price (USD)\tTotal\n1\tEncoder 1024 PPR\t2\t145.00\t290.00')
  })

  it('says why a file cannot be read', async () => {
    expect(await readSheetText(new File(['x'], 'notes.txt', { type: 'text/plain' }))).toMatchObject({ ok: false, reason: 'not_sheet' })
    const broken = await readSheetText(new File([new Uint8Array([80, 75, 3, 4, 1, 2, 3])], 'broken.xlsx', { type: XLSX_TYPE }))
    expect(broken).toMatchObject({ ok: false })
    expect(broken.ok ? '' : broken.message).toMatch(/could not be read|nothing to read/)
    const big = new File([new Uint8Array(16 * 1024 * 1024)], 'huge.xlsx', { type: XLSX_TYPE })
    expect(await readSheetText(big)).toMatchObject({ ok: false, reason: 'too_big' })
    const empty = await readSheetText(workbook({ Sheet1: [[]] }))
    expect(empty).toMatchObject({ ok: false, reason: 'empty' })
  })

  it('knows a spreadsheet by its type or its name', () => {
    expect(isSheetFile({ type: XLSX_TYPE, name: 'a' })).toBe(true)
    expect(isSheetFile({ type: '', name: 'RFQ items.XLSX' })).toBe(true)
    expect(isSheetFile({ type: 'application/octet-stream', name: 'list.xls' })).toBe(true)
    expect(isSheetFile({ type: 'application/csv', name: 'list' })).toBe(true)
    expect(isSheetFile({ type: 'application/pdf', name: 'rfq.pdf' })).toBe(false)
  })

  it('names the columns it keeps and leaves out rates, amounts, stock and dates', () => {
    expect(['S.No', 'Item Code', 'Material Description', 'Make', 'Part No.', 'UOM', 'Req. Qty', 'Unit Price', 'Qty in Stock', 'Required Date'].map(columnRole)).toEqual([
      'sno',
      'code',
      'desc',
      'make',
      'part',
      'unit',
      'qty',
      null,
      null,
      null,
    ])
    expect(findHeader([['Enquiry'], ['Sr. No', 'Particulars', 'Quantity', 'Unit']])).toEqual({
      row: 1,
      cols: [
        { i: 0, role: 'sno' },
        { i: 1, role: 'desc' },
        { i: 2, role: 'qty' },
        { i: 3, role: 'unit' },
      ],
    })
  })
})
