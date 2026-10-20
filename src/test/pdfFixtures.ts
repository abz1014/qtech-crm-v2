// Small PDFs made on the fly for the PDF reader's tests (src/lib/docread). pdf-lib draws text at exact positions, so a
// fixture is a letter, a table quote or a scan without shipping binary files. No real customer data.
import { PDFDocument, PDFHexString, StandardFonts, type PDFFont } from 'pdf-lib'

export interface Placed {
  text: string
  x: number
  /** From the TOP of the page. */
  y: number
  size?: number
  bold?: boolean
  /** Right-align at x instead of starting there (numbers in a table). */
  right?: boolean
}

const A4: [number, number] = [595, 842]

/** One PDF page per array of placed texts. */
export async function placedPdf(pages: Placed[][]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const regular = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  for (const items of pages) {
    const page = doc.addPage(A4)
    for (const it of items) {
      const font: PDFFont = it.bold ? bold : regular
      const size = it.size ?? 9
      const x = it.right ? it.x - font.widthOfTextAtSize(it.text, size) : it.x
      page.drawText(it.text, { x, y: A4[1] - it.y, size, font })
    }
  }
  return doc.save({ useObjectStreams: false })
}

/** A plain letter: one line of text per entry, top to bottom; '' leaves a blank line. */
export function letterPdf(lines: string[], size = 10): Promise<Uint8Array> {
  const items: Placed[] = []
  lines.forEach((text, i) => {
    if (text) items.push({ text, x: 56, y: 70 + i * size * 1.4, size })
  })
  return placedPdf([items])
}

/** Columns as [x, header, align]: the table rows are drawn under the header, numbers right-aligned at their column's right edge. */
export interface TableSpec {
  columns: Array<{ x: number; header: string; right?: number }>
  rows: string[][]
  /** Extra lines under a row's description (wrapped text), keyed by row index. */
  wraps?: Record<number, string[]>
  top: number
  size?: number
  /** Column index of the description, for wrapped lines. */
  descColumn: number
}

export function tableItems(t: TableSpec): { items: Placed[]; bottom: number } {
  const size = t.size ?? 9
  const pitch = size * 1.35
  const items: Placed[] = []
  t.columns.forEach(c => items.push({ text: c.header, x: c.right ?? c.x, y: t.top, size, bold: true, right: c.right !== undefined }))
  let y = t.top + pitch * 1.6
  t.rows.forEach((row, r) => {
    row.forEach((cell, i) => {
      const c = t.columns[i]
      if (!c || !cell) return
      items.push({ text: cell, x: c.right ?? c.x, y, size, right: c.right !== undefined })
    })
    for (const w of t.wraps?.[r] ?? []) {
      y += pitch
      items.push({ text: w, x: (t.columns[t.descColumn] as { x: number }).x, y, size })
    }
    y += pitch * 1.5
  })
  return { items, bottom: y }
}

/** A supplier quotation laid out as a table: letterhead, header, a wrapped description, right-aligned numbers, a total, terms. */
export async function quotationPdf(): Promise<Uint8Array> {
  const head: Placed[] = [
    { text: 'QUOTATION', x: 40, y: 50, size: 16, bold: true },
    { text: 'Bright Automation Trading Co., Ltd.', x: 40, y: 72, size: 10 },
    { text: 'Quotation No: BAT-Q-2026-0412', x: 40, y: 100 },
    { text: 'Date: 15/10/2026', x: 400, y: 100 },
    { text: 'To: Q-Tech Engineering', x: 40, y: 113 },
    { text: 'Your Ref: QT-RFQ-0118', x: 400, y: 113 },
  ]
  const table = tableItems({
    top: 150,
    descColumn: 2,
    columns: [
      { x: 40, header: 'No.' },
      { x: 66, header: 'Part No.' },
      { x: 160, header: 'Description' },
      { x: 360, header: 'Qty', right: 378 },
      { x: 392, header: 'Unit' },
      { x: 425, header: 'Unit Price (USD)', right: 495 },
      { x: 505, header: 'Amount (USD)', right: 560 },
    ],
    rows: [
      ['1', '6ES7214-1AG40-0XB0', 'SIMATIC S7-1200 CPU 1214C', '2', 'PCS', '285.00', '570.00'],
      ['2', '6EP1334-2BA20', 'SITOP PSU100S 24 V/10 A', '1', 'PCS', '142.50', '142.50'],
      ['3', '3RT2026-1BB40', 'Contactor 24VDC coil', '4', 'PCS', '38.20', '152.80'],
    ],
    wraps: { 0: ['DC/DC/DC, 14 DI / 10 DO'] },
  })
  const tail: Placed[] = [
    { text: 'Sub Total', x: 425, y: table.bottom + 4, bold: true },
    { text: '865.30', x: 560, y: table.bottom + 4, right: true },
    { text: 'Delivery: 3-4 weeks after PO', x: 40, y: table.bottom + 40 },
    { text: 'Validity: 30 days', x: 40, y: table.bottom + 53 },
    { text: 'Payment: 100% advance T/T', x: 40, y: table.bottom + 66 },
  ]
  return placedPdf([[...head, ...table.items, ...tail]])
}

/** A customer's SAP-style RFQ printout: letterhead, RFQ number and deadline on the right, an item table with long text. */
export async function sapEnquiryPdf(): Promise<Uint8Array> {
  const head: Placed[] = [
    { text: 'Margalla Sugar Mills Limited', x: 40, y: 50, size: 13, bold: true },
    { text: 'Request for Quotation', x: 40, y: 70, size: 11 },
    { text: 'Collective No.: 6000004512', x: 360, y: 90 },
    { text: 'RFQ No.: 4500012345', x: 360, y: 103 },
    { text: 'Plot 14, Industrial Estate, Rawalpindi', x: 40, y: 90 },
    { text: 'Quotations must reach us before 11-NOV-26', x: 40, y: 125 },
  ]
  const table = tableItems({
    top: 160,
    descColumn: 2,
    columns: [
      { x: 40, header: 'Item' },
      { x: 75, header: 'Material' },
      { x: 135, header: 'Description' },
      { x: 360, header: 'Quantity', right: 400 },
      { x: 410, header: 'Unit' },
      { x: 440, header: 'Delivery Date' },
    ],
    rows: [
      ['00010', '1000012345', 'TRANSMITTER,PRESSURE;0-16BAR', '2.000', 'EA', '15.12.2026'],
      ['00020', '1000067890', 'GAUGE,PRESSURE;0-10BAR,4" DIAL', '6.000', 'EA', '15.12.2026'],
    ],
    wraps: { 0: ['Make: Rosemount, Model: 3051TG'] },
  })
  const tail: Placed[] = [{ text: 'Please quote on your letterhead with validity and delivery period.', x: 40, y: table.bottom + 30 }]
  return placedPdf([[...head, ...table.items, ...tail]])
}

// A 1x1 grey PNG, stretched over the page: what a phone "scan to PDF" looks like to a text reader.
const PIXEL_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

export async function scanPdf(pages = 1, stamp?: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const png = await doc.embedPng(Uint8Array.from(atob(PIXEL_PNG), ch => ch.charCodeAt(0)))
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage(A4)
    page.drawImage(png, { x: 0, y: 0, width: A4[0], height: A4[1] })
    if (stamp) page.drawText(stamp, { x: 400, y: 20, size: 7, font })
  }
  return doc.save({ useObjectStreams: false })
}

/** A PDF that asks for a password: a standard-security /Encrypt entry whose user password is not the empty one. */
export async function lockedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  doc.addPage(A4).drawText('Confidential price list', { x: 56, y: 780, size: 12, font })
  const ctx = doc.context
  ctx.trailerInfo.Encrypt = ctx.obj({
    Filter: 'Standard',
    V: 1,
    R: 2,
    Length: 40,
    O: PDFHexString.of('5a'.repeat(32)),
    U: PDFHexString.of('a5'.repeat(32)),
    P: -44,
  })
  ctx.trailerInfo.ID = ctx.obj([PDFHexString.of('0123456789abcdef'.repeat(2)), PDFHexString.of('0123456789abcdef'.repeat(2))])
  return doc.save({ useObjectStreams: false })
}
