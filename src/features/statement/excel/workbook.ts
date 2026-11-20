import { CFB, utils, write, type CellObject, type Range, type WorkSheet } from 'xlsx'
import { formatPaisa, productPaisa } from '@/lib/money'
import type { InquiryRow, RfqItemRow } from '@/features/rfqs/api'
import { modelTokens } from '@/features/rfqs/lib/parseItems'
import type { CompanyProfile } from '@/features/settings/companyProfile'
import { byName, longDay, splitDescription, wasAsked, type QuotedRow } from '@/features/statement/model'
import type { StatementGrid, StatementPdfData } from '@/features/statement/pdf/StatementDocument'

/*
 * The Comparative Statement as an Excel file (owner, 2026-11-16: the statement is only downloaded, as Excel or PDF). Two sheets.
 *
 * "Side by side" (first; the layout the engineers made by hand): one row per item, and for each supplier asked a pair of columns,
 * Unit cost and Lead time, under the supplier's name (suppliers A to Z). A cell with no price says why in a few words ("Quoting later",
 * "Cannot quote", "No reply", "Not quoted"). Under the items, each supplier's total of the items it quoted (never added across
 * currencies). Frozen below the headings and to the right of the Unit column. It is only made when the raw RFQ (data.grid) is given.
 *
 * "Details": laid out like the PDF: the letterhead and the job / RFQ, customer, date and preparer, then one grid row per supplier quote with the same
 * facts as the PDF (unit cost, total cost, lead time, unit weight, total weight, country of origin, note), then the totals by supplier.
 *
 * Every amount, quantity and weight is a number cell with a number format (thousands grouped, 2 decimals for money; "kg", "g" or "lb"
 * shown by the format, so the cell stays a number), so a person can sum, sort and filter. The grid's heading row is frozen and filtered.
 * Like the PDF it selects nothing: no "cheapest", no "recommended", rows in supplier-name order, and currencies are never added.
 *
 * SheetJS (community) writes no fonts or frozen panes, so the file it writes is opened as a zip (its own CFB) and two parts are
 * patched: styles.xml gains a bold font and two bold cell styles, and each sheet's xml gains its frozen pane and its bold cells.
 *
 * This module imports xlsx, so it is only reached through generate.ts's dynamic import (its own chunk, never the main bundle).
 */

/** The long list, one row per supplier quote (the second sheet when the side-by-side sheet is made). */
export const SHEET_NAME = 'Details'
export const SIDE_SHEET_NAME = 'Side by side'

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

/** The six columns of the side-by-side sheet before the suppliers, with their widths; then each supplier's pair. */
export const SIDE_COLUMNS = [
  { label: 'No.', width: 6 },
  { label: 'Item', width: 40 },
  { label: 'Brand', width: 18 },
  { label: 'Part / model', width: 22 },
  { label: 'Qty', width: 7 },
  { label: 'Unit', width: 7 },
] as const
export const SIDE_PAIR = [
  { label: 'Unit cost', width: 16 },
  { label: 'Lead time', width: 14 },
] as const

export const SIDE_NOTE = "Unit cost is each supplier's price for one unit. Totals add only the items that supplier quoted. Different currencies are never added together."

export interface SideBySideSheet {
  rows: Row[]
  /** The suppliers asked, A to Z: supplier i has its Unit cost in column 6 + 2i and its Lead time in 7 + 2i (0-based). */
  suppliers: string[]
  /** 1-based rows of the two column headings; the pane is frozen under the second. */
  headingRow: number
  subHeadingRow: number
  /** 1-based first and last item rows (last < first when the RFQ has no items). */
  firstItemRow: number
  lastItemRow: number
  /** 1-based rows drawn in bold, and the title (larger). */
  boldRows: number[]
  titleRow: number
  /** 0-based merged ranges (the six headings down both heading rows, each supplier's name across its pair). */
  merges: Range[]
  widths: number[]
}

/** A money cell showing its currency: 1234.5 in USD is shown "USD 1,234.50", and stays a number. */
const moneyCell = (value: number, currency: string): Cell => ({ v: value, z: `"${currency} "#,##0.00` })

/** Why a supplier asked gives no price for an item, in a few words (the order of the checks matters). */
export function noPriceText(inq: InquiryRow, item: RfqItemRow): string {
  // 0145: the supplier said it will quote this item later.
  if (inq.itemWaits?.[item.id]) return 'Quoting later'
  if (inq.itemDeclines[item.id] || (inq.lines.length === 0 && inq.noOfferOn)) return 'Cannot quote'
  if (inq.lines.length === 0) return 'No reply'
  return 'Not quoted'
}

/** The first model-shaped word of the description, the item's own brand left out ("" when there is none). */
export function partModel(item: RfqItemRow): string {
  const token = modelTokens(item.description, item.brandName ? [item.brandName] : [])[0]
  if (!token) return ''
  // modelTokens compares in a folded form (no dashes, dots or spaces, upper case). The sheet shows the part as the description writes
  // it ("6AV2124-0QC02-0AX0", "MT8102iE"), so the folded token is found back in the description.
  const chars = [...token].map(c => (/[A-Za-z0-9]/.test(c) ? c : `\\${c}`))
  const found = new RegExp(chars.join('[-./ ]?'), 'i').exec(item.description)
  return found ? found[0] : token
}

/** The side-by-side sheet as rows (pure: the unit test reads it, and the workbook is made from it). */
export function sideBySideSheet(data: StatementPdfData, grid: StatementGrid, profile: CompanyProfile): SideBySideSheet {
  const rows: Row[] = []
  const bold: number[] = []
  const push = (r: Row, isBold = false) => {
    rows.push(r)
    if (isBold) bold.push(rows.length)
  }
  const asked = grid.inquiries.filter(wasAsked).sort(byName)
  const width = SIDE_COLUMNS.length + asked.length * SIDE_PAIR.length
  const blankRow = (): Row => new Array(width).fill(null)
  const at = (i: number) => SIDE_COLUMNS.length + i * SIDE_PAIR.length

  push([profile.legal_name ?? ''], true)
  push([])
  push(['Comparative statement'], true)
  const titleRow = rows.length
  push([`Customer: ${data.customer}`])
  push([`Contact: ${grid.contact?.trim() || '—'}`])
  push([`Customer ref: ${grid.customerRef?.trim() || '—'}`])
  push([`Job / RFQ: ${data.reference}`])
  push([`Date: ${longDay(data.date)}`])
  push([`Prepared by: ${data.preparedBy || '—'}`])
  push([])

  const h1 = blankRow()
  const h2 = blankRow()
  SIDE_COLUMNS.forEach((c, i) => (h1[i] = c.label))
  asked.forEach((inq, i) => {
    h1[at(i)] = inq.supplierName
    SIDE_PAIR.forEach((p, k) => (h2[at(i) + k] = p.label))
  })
  push(h1, true)
  const headingRow = rows.length
  push(h2, true)
  const subHeadingRow = rows.length

  for (const item of grid.items) {
    const r = blankRow()
    r[0] = item.number
    r[1] = splitDescription(item.description).title
    r[2] = item.brandName ?? ''
    r[3] = partModel(item)
    r[4] = item.qty
    r[5] = item.unit ?? ''
    asked.forEach((inq, i) => {
      const line = inq.lines.find(l => l.itemId === item.id)
      if (line) {
        r[at(i)] = moneyCell(line.unitPrice, line.currency)
        r[at(i) + 1] = line.leadTime?.trim() || null
      } else {
        r[at(i)] = noPriceText(inq, item)
      }
    })
    push(r)
  }
  const lastItemRow = rows.length

  push([])
  const total = blankRow()
  total[1] = 'Total'
  asked.forEach((inq, i) => {
    const sums = new Map<string, bigint>()
    let quoted = 0
    for (const item of grid.items) {
      const l = inq.lines.find(x => x.itemId === item.id)
      if (!l) continue
      quoted += 1
      sums.set(l.currency, (sums.get(l.currency) ?? 0n) + productPaisa(item.qty, l.unitPrice))
    }
    const byCur = [...sums.entries()].sort(([a], [b]) => a.localeCompare(b))
    if (byCur.length === 1) total[at(i)] = moneyCell(Number(byCur[0][1]) / 100, byCur[0][0])
    else if (byCur.length > 1) total[at(i)] = byCur.map(([cur, minor]) => `${cur} ${formatPaisa(minor, 'always')}`).join(' + ')
    total[at(i) + 1] = `${quoted} of ${grid.items.length} items`
  })
  push(total, true)
  push([SIDE_NOTE])

  const merges: Range[] = [
    ...SIDE_COLUMNS.map((_, c) => ({ s: { r: headingRow - 1, c }, e: { r: subHeadingRow - 1, c } })),
    ...asked.map((_, i) => ({ s: { r: headingRow - 1, c: at(i) }, e: { r: headingRow - 1, c: at(i) + SIDE_PAIR.length - 1 } })),
  ]
  const widths = [...SIDE_COLUMNS.map(c => c.width), ...asked.flatMap(() => SIDE_PAIR.map(p => p.width))]
  return {
    rows,
    suppliers: asked.map(i => i.supplierName),
    headingRow,
    subHeadingRow,
    firstItemRow: subHeadingRow + 1,
    lastItemRow,
    boldRows: bold,
    titleRow,
    merges,
    widths,
  }
}

function toWorksheet(rows: Row[], widths: number[], filter: Range | null, merges: Range[] = []): WorkSheet {
  const ws: WorkSheet = {}
  let maxCol = 0
  rows.forEach((row, r) => {
    row.forEach((v, c) => {
      if (v === null || v === undefined || v === '') return
      const cell: CellObject = typeof v === 'string' ? { t: 's', v } : typeof v === 'number' ? { t: 'n', v } : { t: 'n', v: v.v, z: v.z }
      ws[utils.encode_cell({ r, c })] = cell
      maxCol = Math.max(maxCol, c)
    })
  })
  ws['!ref'] = utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(rows.length - 1, 0), c: Math.max(maxCol, widths.length - 1) } })
  ws['!cols'] = widths.map(wch => ({ wch }))
  if (filter) ws['!autofilter'] = { ref: utils.encode_range(filter) }
  if (merges.length > 0) ws['!merges'] = merges
  return ws
}

const detailsWorksheet = (sheet: StatementSheet): WorkSheet =>
  toWorksheet(
    sheet.rows,
    COLUMNS.map(c => c.width),
    { s: { r: sheet.headingRow - 1, c: 0 }, e: { r: sheet.lastGridRow - 1, c: COLUMNS.length - 1 } },
  )

const sideWorksheet = (sheet: SideBySideSheet): WorkSheet =>
  toWorksheet(
    sheet.rows,
    sheet.widths,
    // the filter buttons sit on the second heading row, over the item rows only (not the totals)
    sheet.lastItemRow >= sheet.firstItemRow ? { s: { r: sheet.subHeadingRow - 1, c: 0 }, e: { r: sheet.lastItemRow - 1, c: sheet.widths.length - 1 } } : null,
    sheet.merges,
  )

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

/** How one sheet is patched: frozen above ySplit rows and left of xSplit columns (0: none), these rows bold, the title larger. */
interface SheetPatch {
  xSplit: number
  ySplit: number
  boldRows: number[]
  titleRow: number
}

function paneXml(xSplit: number, ySplit: number): string {
  const top = `${utils.encode_col(xSplit)}${ySplit + 1}`
  if (xSplit === 0) return `<pane ySplit="${ySplit}" topLeftCell="${top}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="${top}" sqref="${top}"/>`
  const right = `${utils.encode_col(xSplit)}1`
  const below = `A${ySplit + 1}`
  return (
    `<pane xSplit="${xSplit}" ySplit="${ySplit}" topLeftCell="${top}" activePane="bottomRight" state="frozen"/>` +
    `<selection pane="topRight" activeCell="${right}" sqref="${right}"/><selection pane="bottomLeft" activeCell="${below}" sqref="${below}"/>` +
    `<selection pane="bottomRight" activeCell="${top}" sqref="${top}"/>`
  )
}

/** Freezes the sheet's pane and draws the given rows' text cells in bold. */
function patchSheet(xml: string, sheet: SheetPatch, bold: number, title: number): string {
  const view = `<sheetView workbookViewId="0">${paneXml(sheet.xSplit, sheet.ySplit)}</sheetView>`
  const withPane = xml.replace(/<sheetView workbookViewId="0"\s*\/>/, view)
  if (withPane === xml) throw new Error('The Excel sheet view could not be set')
  const titleRow = sheet.titleRow
  const rows = new Set(sheet.boldRows)
  return withPane.replace(/<c r="([A-Z]+)(\d+)"([^>]*?)(\/?)>/g, (all, col: string, row: string, attrs: string, close: string) => {
    const n = Number(row)
    if (!rows.has(n) || /\ss="/.test(attrs)) return all
    return `<c r="${col}${row}"${attrs} s="${n === titleRow ? title : bold}"${close}>`
  })
}

/** The .xlsx file's bytes. */
export function buildStatementWorkbook(data: StatementPdfData, profile: CompanyProfile): Uint8Array {
  const details = statementSheet(data, profile)
  const side = data.grid ? sideBySideSheet(data, data.grid, profile) : null
  const wb = utils.book_new()
  // In the order of the tabs: sheet1.xml is the first sheet appended, sheet2.xml the second.
  const patches: SheetPatch[] = []
  if (side) {
    utils.book_append_sheet(wb, sideWorksheet(side), SIDE_SHEET_NAME)
    patches.push({ xSplit: SIDE_COLUMNS.length, ySplit: side.subHeadingRow, boldRows: side.boldRows, titleRow: side.titleRow })
  }
  utils.book_append_sheet(wb, detailsWorksheet(details), SHEET_NAME)
  patches.push({ xSplit: 0, ySplit: details.headingRow, boldRows: details.boldRows, titleRow: details.boldRows[1] })
  wb.Props = { Title: `Comparative statement ${data.reference}`, Subject: `Comparative statement ${data.reference} for ${data.customer}`, Author: profile.legal_name ?? '' }
  const raw = write(wb, { type: 'array', bookType: 'xlsx', compression: true }) as ArrayBuffer
  const zip = CFB.read(new Uint8Array(raw), { type: 'array' }) as Zip
  const styles = part(zip, 'xl/styles.xml')
  const s = patchStyles(text(styles))
  put(styles, s.xml)
  patches.forEach((p, i) => {
    const ws = part(zip, `xl/worksheets/sheet${i + 1}.xml`)
    put(ws, patchSheet(text(ws), p, s.bold, s.title))
  })
  const out = CFB.write(zip, { fileType: 'zip', type: 'array', compression: true }) as ArrayBuffer | number[]
  return out instanceof ArrayBuffer ? new Uint8Array(out) : Uint8Array.from(out)
}
