import { CFB, utils, write, type CellObject, type WorkSheet } from 'xlsx'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import { longDay, splitDescription, type QuotedRow } from '@/features/statement/model'
import type { StatementPdfData } from '@/features/statement/pdf/StatementDocument'

/*
 * The Comparative Statement as an Excel file (owner, 2026-11-16: the statement is only downloaded, as Excel or PDF). One sheet, laid
 * out like the PDF: the letterhead and the job / RFQ, customer, date and preparer, then one grid row per supplier quote with the same
 * facts as the PDF (unit cost, total cost, lead time, unit weight, total weight, country of origin, note), then the totals by supplier.
 *
 * Every amount, quantity and weight is a number cell with a number format (thousands grouped, 2 decimals for money; "kg", "g" or "lb"
 * shown by the format, so the cell stays a number), so a person can sum, sort and filter. The grid's heading row is frozen and filtered.
 * Like the PDF it selects nothing: no "cheapest", no "recommended", rows in supplier-name order, and currencies are never added.
 *
 * SheetJS (community) writes no fonts or frozen panes, so the file it writes is opened as a zip (its own CFB) and two parts are
 * patched: styles.xml gains a bold font and two bold cell styles, sheet1.xml gains the frozen pane and the bold cells.
 *
 * This module imports xlsx, so it is only reached through generate.ts's dynamic import (its own chunk, never the main bundle).
 */

export const SHEET_NAME = 'Comparative statement'

/** The grid's columns, in order, with their width in characters. */
export const COLUMNS = [
  { label: 'No.', width: 6 },
  { label: 'Item', width: 34 },
  { label: 'Specification', width: 34 },
  { label: 'Qty', width: 9 },
  { label: 'Unit', width: 7 },
  { label: 'Supplier', width: 30 },
  { label: 'Currency', width: 10 },
  { label: 'Unit cost', width: 15 },
  { label: 'Total cost', width: 17 },
  { label: 'Lead time', width: 18 },
  { label: 'Unit weight', width: 13 },
  { label: 'Total weight', width: 14 },
  { label: 'Country of origin', width: 18 },
  { label: 'Note', width: 40 },
] as const

const MONEY = '#,##0.00'
const COL = Object.fromEntries(COLUMNS.map((c, i) => [c.label, i])) as Record<(typeof COLUMNS)[number]['label'], number>

type Cell = string | number | { v: number; z: string } | null
type Row = Cell[]

/** A weight as a number cell whose format shows its unit ("2.5 kg"), rounded to 3 decimals (no float noise from qty x weight). */
const weightCell = (value: number | null, unit: string): Cell => (value === null ? null : { v: Math.round(value * 1000) / 1000, z: `General" ${unit}"` })

function gridRow(r: QuotedRow, no: number, title: string, spec: string | null, qty: number, unit: string | null): Row {
  const row: Row = new Array(COLUMNS.length).fill(null)
  row[COL['No.']] = no
  row[COL.Item] = title
  row[COL.Specification] = spec
  row[COL.Qty] = qty
  row[COL.Unit] = unit
  row[COL.Supplier] = r.supplierName
  row[COL.Currency] = r.currency
  row[COL['Unit cost']] = { v: r.unitCost, z: MONEY }
  row[COL['Total cost']] = { v: Number(r.totalMinor) / 100, z: MONEY }
  row[COL['Lead time']] = r.leadTime
  row[COL['Unit weight']] = weightCell(r.weightEach, r.weightUnit)
  row[COL['Total weight']] = weightCell(r.totalWeight, r.weightUnit)
  row[COL['Country of origin']] = r.origin
  row[COL.Note] = r.note
  return row
}

export interface StatementSheet {
  rows: Row[]
  /** 1-based row of the grid's column headings (the frozen row). */
  headingRow: number
  /** 1-based last row of the grid (before the totals). */
  lastGridRow: number
  /** 1-based rows drawn in bold (the company, the title, the headings). */
  boldRows: number[]
}

/** The sheet as rows (pure: the unit test reads it, and the workbook is made from it). */
export function statementSheet(data: StatementPdfData, profile: CompanyProfile): StatementSheet {
  const rows: Row[] = []
  const bold: number[] = []
  const push = (r: Row, isBold = false) => {
    rows.push(r)
    if (isBold) bold.push(rows.length)
  }
  const contact = [profile.address, profile.phone, profile.email, profile.website].filter(Boolean).join('   ')

  push([profile.legal_name ?? ''], true)
  if (contact) push([contact])
  push([])
  push(['Comparative statement'], true)
  push([`Job / RFQ: ${data.reference}`])
  push([`Customer: ${data.customer}`])
  push([`Date: ${longDay(data.date)}`])
  push([`Prepared by: ${data.preparedBy || '—'}`])
  push([])
  push(COLUMNS.map(c => c.label), true)
  const headingRow = rows.length

  for (const sec of data.statement.sections) {
    const { title, spec } = splitDescription(sec.item.description)
    const base = (note: string): Row => {
      const r: Row = new Array(COLUMNS.length).fill(null)
      r[COL['No.']] = sec.item.number
      r[COL.Item] = title
      r[COL.Specification] = spec
      r[COL.Qty] = sec.item.qty
      r[COL.Unit] = sec.item.unit
      r[COL.Note] = note
      return r
    }
    if (sec.rows.length === 0) push(base('No supplier has quoted this item yet.'))
    for (const q of sec.rows) push(gridRow(q, sec.item.number, title, spec, sec.item.qty, sec.item.unit))
    if (data.showNoReply && sec.noQuote.length > 0) push(base(sec.noQuote.map(g => `${g.label}: ${g.names.join(', ')}`).join('. ')))
  }
  if (data.statement.sections.length === 0) push(['This RFQ has no items.'])
  const lastGridRow = rows.length

  push([])
  if (data.statement.totals.length > 0) {
    const t: Row = new Array(COLUMNS.length).fill(null)
    t[COL.Item] = 'Totals by supplier'
    push(t, true)
    const h: Row = new Array(COLUMNS.length).fill(null)
    h[COL.Supplier] = 'Supplier'
    h[COL.Currency] = 'Currency'
    h[COL['Total cost']] = 'Total cost'
    h[COL['Lead time']] = 'Items quoted'
    push(h, true)
    for (const s of data.statement.totals) {
      s.byCurrency.forEach((c, i) => {
        const r: Row = new Array(COLUMNS.length).fill(null)
        r[COL.Supplier] = s.supplierName
        r[COL.Currency] = c.currency
        r[COL['Total cost']] = { v: Number(c.totalMinor) / 100, z: MONEY }
        r[COL['Lead time']] = i === 0 ? `${s.itemsQuoted} of ${s.itemCount}` : null
        push(r)
      })
    }
    push([])
    push(['Cost is what each supplier quoted: quantity times unit cost. A total covers only the items that supplier quoted, and different currencies are never added together.'])
  } else {
    push(['No supplier has quoted yet.'])
  }
  return { rows, headingRow, lastGridRow, boldRows: bold }
}

function toWorksheet(sheet: StatementSheet): WorkSheet {
  const ws: WorkSheet = {}
  let maxCol = 0
  sheet.rows.forEach((row, r) => {
    row.forEach((v, c) => {
      if (v === null || v === undefined || v === '') return
      const cell: CellObject = typeof v === 'string' ? { t: 's', v } : typeof v === 'number' ? { t: 'n', v } : { t: 'n', v: v.v, z: v.z }
      ws[utils.encode_cell({ r, c })] = cell
      maxCol = Math.max(maxCol, c)
    })
  })
  ws['!ref'] = utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(sheet.rows.length - 1, 0), c: Math.max(maxCol, COLUMNS.length - 1) } })
  ws['!cols'] = COLUMNS.map(c => ({ wch: c.width }))
  ws['!autofilter'] = { ref: utils.encode_range({ s: { r: sheet.headingRow - 1, c: 0 }, e: { r: sheet.lastGridRow - 1, c: COLUMNS.length - 1 } }) }
  return ws
}

const dec = new TextDecoder()
const enc = new TextEncoder()

/** The two fields of SheetJS's CFB zip container this module uses (xlsx types CFB as any). */
interface ZipEntry {
  content: Uint8Array | number[]
  size: number
}
interface Zip {
  FullPaths: string[]
  FileIndex: ZipEntry[]
}

function part(zip: Zip, name: string): ZipEntry {
  const i = zip.FullPaths.findIndex(p => p.endsWith(`/${name}`))
  if (i < 0) throw new Error(`The Excel file has no ${name}`)
  return zip.FileIndex[i]
}

const text = (e: ZipEntry) => dec.decode(e.content instanceof Uint8Array ? e.content : Uint8Array.from(e.content))
const put = (e: ZipEntry, xml: string) => {
  e.content = enc.encode(xml)
  e.size = e.content.length
}

/** Adds the bold font and its cell styles to styles.xml; returns the style index of a bold cell and of the bold title. */
function patchStyles(xml: string): { xml: string; bold: number; title: number } {
  const fonts = /<fonts count="(\d+)">([\s\S]*?)<\/fonts>/.exec(xml)
  const xfs = /<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/.exec(xml)
  if (!fonts || !xfs) throw new Error('The Excel styles could not be read')
  const nFonts = Number(fonts[1])
  const nXfs = Number(xfs[1])
  const font = (size: number) => `<font><b/><sz val="${size}"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>`
  const xf = (fontId: number) => `<xf numFmtId="0" fontId="${fontId}" fillId="0" borderId="0" xfId="0" applyFont="1"/>`
  const out = xml
    .replace(fonts[0], `<fonts count="${nFonts + 2}">${fonts[2]}${font(12)}${font(14)}</fonts>`)
    .replace(xfs[0], `<cellXfs count="${nXfs + 2}">${xfs[2]}${xf(nFonts)}${xf(nFonts + 1)}</cellXfs>`)
  return { xml: out, bold: nXfs, title: nXfs + 1 }
}

/** Freezes the rows down to the grid's headings and draws the given rows' text cells in bold. */
function patchSheet(xml: string, sheet: StatementSheet, bold: number, title: number): string {
  const top = `A${sheet.headingRow + 1}`
  const view = `<sheetView workbookViewId="0"><pane ySplit="${sheet.headingRow}" topLeftCell="${top}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${top}" sqref="${top}"/></sheetView>`
  const withPane = xml.replace(/<sheetView workbookViewId="0"\s*\/>/, view)
  if (withPane === xml) throw new Error('The Excel sheet view could not be set')
  const titleRow = sheet.boldRows[1]
  const rows = new Set(sheet.boldRows)
  return withPane.replace(/<c r="([A-Z]+)(\d+)"([^>]*?)(\/?)>/g, (all, col: string, row: string, attrs: string, close: string) => {
    const n = Number(row)
    if (!rows.has(n) || /\ss="/.test(attrs)) return all
    return `<c r="${col}${row}"${attrs} s="${n === titleRow ? title : bold}"${close}>`
  })
}

/** The .xlsx file's bytes. */
export function buildStatementWorkbook(data: StatementPdfData, profile: CompanyProfile): Uint8Array {
  const sheet = statementSheet(data, profile)
  const wb = utils.book_new()
  utils.book_append_sheet(wb, toWorksheet(sheet), SHEET_NAME)
  wb.Props = { Title: `Comparative statement ${data.reference}`, Subject: `Comparative statement ${data.reference} for ${data.customer}`, Author: profile.legal_name ?? '' }
  const raw = write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer
  const zip = CFB.read(new Uint8Array(raw), { type: 'array' }) as Zip
  const styles = part(zip, 'xl/styles.xml')
  const ws = part(zip, 'xl/worksheets/sheet1.xml')
  const s = patchStyles(text(styles))
  put(styles, s.xml)
  put(ws, patchSheet(text(ws), sheet, s.bold, s.title))
  const out = CFB.write(zip, { fileType: 'zip', type: 'array', compression: true }) as ArrayBuffer | number[]
  return out instanceof ArrayBuffer ? new Uint8Array(out) : Uint8Array.from(out)
}
