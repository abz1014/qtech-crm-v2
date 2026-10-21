// A corpus document as a PDF, drawn with pdf-lib the way office software prints one: a letterhead on every page, a table whose
// description wraps inside its column, ruled cells, a table running over pages (with or without its header repeated), totals,
// "Page 1 of 3" footers, a two-column header block, a page turned with /Rotate. Also a scan: pictures as the only content.

import { degrees, PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib'
import type { Block, Doc } from './model'

const MARGIN = 42

interface Ctx {
  doc: PDFDocument
  regular: PDFFont
  bold: PDFFont
  size: number
  pageW: number
  pageH: number
  rotate: boolean
  sideways: boolean
  watermark?: string
  pages: PDFPage[]
  page: PDFPage
  y: number
  letterhead: Block[]
}

/** `breakWords`: 'any' breaks a word too wide for the column anywhere (after punctuation when it can), 'punct' only after a dash, slash, comma or semicolon (a part number in a narrow column), 'none' never. */
function wrap(text: string, font: PDFFont, size: number, width: number, breakWords: 'any' | 'punct' | 'none' = 'any'): string[] {
  const out: string[] = []
  let line = ''
  const fits = (s: string) => font.widthOfTextAtSize(s, size) <= width
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word
    if (fits(next)) {
      line = next
      continue
    }
    if (line) out.push(line)
    if (fits(word) || breakWords === 'none' || (breakWords === 'punct' && !/[-/,;]./.test(word))) {
      line = word
      continue
    }
    // A word wider than the column (a long part number): broken after a dash, else anywhere.
    let rest = word
    while (!fits(rest)) {
      let cut = rest.length - 1
      while (cut > 1 && !fits(rest.slice(0, cut))) cut--
      // Report writers break a long word after a comma, a semicolon or a dash when they can.
      const punct = Math.max(rest.lastIndexOf(',', cut - 1), rest.lastIndexOf(';', cut - 1), rest.lastIndexOf('-', cut - 1), rest.lastIndexOf('/', cut - 1))
      if (punct > 2) cut = punct + 1
      out.push(rest.slice(0, cut))
      rest = rest.slice(cut)
    }
    line = rest
  }
  if (line) out.push(line)
  return out.length ? out : ['']
}

function draw(c: Ctx, text: string, x: number, yTop: number, size: number, bold = false): void {
  const font = bold ? c.bold : c.regular
  const clean = text.replace(/[^\x20-\x7e\u00a0-\u00ff]/g, '')
  if (!clean.trim()) return
  if (c.rotate) {
    // Shown turned a quarter clockwise: page x is the shown y, page y is the shown x.
    c.page.drawText(clean, { x: yTop, y: x, size, font, rotate: degrees(90) })
  } else c.page.drawText(clean, { x, y: c.pageH - yTop, size, font })
}

function rule(c: Ctx, x0: number, y0: number, x1: number, y1: number): void {
  const t = 0.6
  if (c.rotate) c.page.drawLine({ start: { x: y0, y: x0 }, end: { x: y1, y: x1 }, thickness: t, color: rgb(0.2, 0.2, 0.2) })
  else c.page.drawLine({ start: { x: x0, y: c.pageH - y0 }, end: { x: x1, y: c.pageH - y1 }, thickness: t, color: rgb(0.2, 0.2, 0.2) })
}

function shade(c: Ctx, x: number, yTop: number, w: number, h: number): void {
  const color = rgb(0.88, 0.91, 0.95)
  if (c.rotate) c.page.drawRectangle({ x: yTop, y: x, width: h, height: w, color })
  else c.page.drawRectangle({ x, y: c.pageH - yTop - h, width: w, height: h, color })
}

function newPage(c: Ctx): void {
  // A turned page: the MediaBox is portrait, the viewer shows it landscape.
  const size: [number, number] = c.rotate ? [c.pageH, c.pageW] : [c.pageW, c.pageH]
  c.page = c.doc.addPage(size)
  if (c.rotate && !c.sideways) c.page.setRotation(degrees(90))
  c.pages.push(c.page)
  if (c.watermark) c.page.drawText(c.watermark, { x: c.pageW * 0.2, y: c.pageH * 0.3, size: 110, font: c.bold, color: rgb(0.85, 0.85, 0.85), rotate: degrees(40) })
  c.y = MARGIN + 6
  for (const b of c.letterhead) block(c, b, null)
}

function textWidth(c: Ctx): number {
  return c.pageW - 2 * MARGIN
}

function ensure(c: Ctx, h: number): boolean {
  if (c.y + h > c.pageH - MARGIN - 18) {
    newPage(c)
    return true
  }
  return false
}

function tableBlock(c: Ctx, b: Extract<Block, { k: 'table' }>, repeatHead: boolean, rowsPerPage: number | null): void {
  const size = b.size ?? c.size
  const lh = size * 1.3
  const W = textWidth(c)
  const xs: number[] = []
  let acc = MARGIN
  for (const w of b.widths) {
    xs.push(acc)
    acc += w * W
  }
  xs.push(acc)
  const padX = 4
  const drawRow = (cells: string[], bold: boolean, bg: boolean) => {
    // Every cell wraps inside its column (Excel's "wrap text", a report writer's cell): a header over a narrow column takes
    // two lines, a long description three.
    const wrapped = cells.map((t, i) => {
      const cw = (xs[i + 1] as number) - (xs[i] as number) - 2 * padX
      return wrap(t, bold ? c.bold : c.regular, size, cw, bold ? 'none' : i === b.descCol ? 'any' : 'punct')
    })
    const n = Math.max(...wrapped.map(w => w.length))
    const h = n * lh + 4
    ensure(c, h)
    if (bg) shade(c, xs[0] as number, c.y, (xs[xs.length - 1] as number) - (xs[0] as number), h)
    wrapped.forEach((lines, i) => {
      lines.forEach((t, k) => {
        const x0 = (xs[i] as number) + padX
        const x1 = (xs[i + 1] as number) - padX
        const font = bold ? c.bold : c.regular
        const w = font.widthOfTextAtSize(t, size)
        const al = b.align[i] ?? 'l'
        const x = al === 'r' ? x1 - w : al === 'c' ? (x0 + x1 - w) / 2 : x0
        draw(c, t, x, c.y + 2 + size + k * lh, size, bold)
      })
    })
    if (b.ruled) {
      rule(c, xs[0] as number, c.y, xs[xs.length - 1] as number, c.y)
      rule(c, xs[0] as number, c.y + h, xs[xs.length - 1] as number, c.y + h)
      for (const x of xs) rule(c, x, c.y, x, c.y + h)
    }
    c.y += h
  }
  if (b.head) drawRow(b.head, true, true)
  let onPage = 0
  b.rows.forEach((r, i) => {
    if (rowsPerPage && onPage >= rowsPerPage) {
      newPage(c)
      onPage = 0
      if (repeatHead && b.head) drawRow(b.head, true, true)
    }
    const before = c.pages.length
    drawRow(r, false, Boolean(b.shaded && i % 2 === 1))
    if (c.pages.length !== before) onPage = 0
    onPage++
  })
  for (const f of b.foot ?? []) drawRow(f, true, false)
  c.y += lh * 0.6
}

function block(c: Ctx, b: Block, opts: { repeatHead: boolean; rowsPerPage: number | null } | null): void {
  const lh = c.size * 1.4
  switch (b.k) {
    case 'text': {
      const size = b.size ?? c.size
      const font = b.bold ? c.bold : c.regular
      const indent = (b.indent ?? 0) * size * 0.5
      for (const line of wrap(b.text, font, size, textWidth(c) - indent)) {
        ensure(c, size * 1.4)
        const w = font.widthOfTextAtSize(line, size)
        const x = b.align === 'right' ? c.pageW - MARGIN - w : b.align === 'center' ? (c.pageW - w) / 2 : MARGIN + indent
        draw(c, line, x, c.y + size, size, b.bold)
        c.y += size * 1.4
      }
      break
    }
    case 'gap':
      c.y += lh * 0.7
      break
    case 'pair':
      ensure(c, lh)
      draw(c, b.left, MARGIN, c.y + c.size, c.size)
      draw(c, b.right, MARGIN + textWidth(c) * 0.58, c.y + c.size, c.size)
      c.y += lh
      break
    case 'table':
      tableBlock(c, b, opts?.repeatHead ?? true, opts?.rowsPerPage ?? null)
      break
    case 'chat':
      for (const m of b.msgs) block(c, { k: 'text', text: `${m.name} (${m.time}): ${m.lines.join(' ')}` }, opts)
      break
    case 'pagebreak':
      newPage(c)
      break
  }
}

/** The document as a PDF with a text layer. */
export async function docPdf(doc: Doc): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const fam = doc.page?.font ?? 'helvetica'
  const regular = await pdf.embedFont(fam === 'times' ? StandardFonts.TimesRoman : fam === 'courier' ? StandardFonts.Courier : StandardFonts.Helvetica)
  const bold = await pdf.embedFont(fam === 'times' ? StandardFonts.TimesRomanBold : fam === 'courier' ? StandardFonts.CourierBold : StandardFonts.HelveticaBold)
  const landscape = Boolean(doc.page?.landscape || doc.page?.rotate || doc.page?.sideways)
  const c = {
    doc: pdf,
    regular,
    bold,
    size: doc.page?.size ?? 9.5,
    pageW: landscape ? 842 : 595,
    pageH: landscape ? 595 : 842,
    rotate: doc.page?.rotate === 90 || Boolean(doc.page?.sideways),
    sideways: Boolean(doc.page?.sideways),
    watermark: doc.page?.watermark,
    pages: [],
    y: 0,
    letterhead: doc.page?.letterhead ?? [],
  } as unknown as Ctx
  newPage(c)
  if (doc.email) {
    for (const [k, v] of [
      ['From:', doc.email.from],
      ['Sent:', doc.email.sent],
      ['To:', doc.email.to],
      ['Subject:', doc.email.subject],
    ] as const) {
      draw(c, k, MARGIN, c.y + c.size, c.size, true)
      draw(c, v, MARGIN + 50, c.y + c.size, c.size)
      c.y += c.size * 1.4
    }
    c.y += c.size
  }
  const opts = { repeatHead: doc.page?.repeatHead ?? true, rowsPerPage: doc.page?.rowsPerPage ?? null }
  for (const b of doc.blocks) block(c, b, opts)
  if (doc.page?.footer) {
    const m = c.pages.length
    c.pages.forEach((p, i) => {
      c.page = p
      const t = (doc.page?.footer as string).replace('{n}', String(i + 1)).replace('{m}', String(m))
      const w = regular.widthOfTextAtSize(t, 8)
      draw(c, t, (c.pageW - w) / 2, c.pageH - 22, 8)
    })
  }
  return pdf.save({ useObjectStreams: false })
}

/** A scan: one picture per page and no text (what a phone's "scan to PDF" or an office copier makes). */
export async function scanPdf(pages: Array<{ bytes: Uint8Array; type: 'png' | 'jpeg'; width: number; height: number }>, stamp?: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const font = await pdf.embedFont(StandardFonts.Helvetica)
  for (const p of pages) {
    const img = p.type === 'png' ? await pdf.embedPng(p.bytes) : await pdf.embedJpg(p.bytes)
    // A4 width, the picture's own proportions.
    const w = 595
    const h = Math.round((595 * p.height) / p.width)
    const page = pdf.addPage([w, h])
    page.drawImage(img, { x: 0, y: 0, width: w, height: h })
    if (stamp) page.drawText(stamp, { x: 10, y: 6, size: 6, font, color: rgb(0.5, 0.5, 0.5) })
  }
  return pdf.save({ useObjectStreams: false })
}
