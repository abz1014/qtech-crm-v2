// Reads the text of a PDF in the browser (owner decision 2026-10-20, item 3): customer enquiries and supplier quotes that
// arrive as a PDF become text for the same parsers a paste goes through. Free, nothing is uploaded or sent anywhere: the file
// is read on the device by pdf.js, which is loaded only now (a lazy chunk and a same-origin worker, see pdfjsRuntime.ts).
//
// What comes back is either the text (lines in reading order, table rows with their cells joined by a tab, pdfLayout.ts) or
// a plain reason it could not be read, worded for the screen:
//  - a scan (pages with no text layer, a photo saved as a PDF, a copier's scan): each such page is drawn on a canvas by
//    pdf.js and read by the picture reader (imageText.ts, tesseract.js, lazy) with progress ("Reading the scan… 40%") and
//    cancel; only when that reading is unclear is the person asked to type or paste instead;
//  - a password-protected PDF, a file that is not a PDF, a file over the size limit, a damaged file.
// Long files are read up to a page limit; `truncated` says so. Nothing here throws for a bad file.

import type { ImageProgress, ImageTextResult } from './imageText'
import { layoutPages, linesToText, type LaidLine, type TextRun } from './pdfLayout'

type Pdfjs = (typeof import('./pdfjsRuntime'))['pdfjs']
type PdfPage = Awaited<ReturnType<Awaited<ReturnType<Pdfjs['getDocument']>['promise']>['getPage']>>

export const PDF_MAX_BYTES = 15 * 1024 * 1024
export const PDF_MAX_PAGES = 20

export type PdfReadFailure = 'not_pdf' | 'too_big' | 'password' | 'scan' | 'unreadable' | 'aborted'

export interface PdfTextOk {
  ok: true
  /** The text, ready for a paste box: one line per line, table rows with cells joined by a tab, a blank line between blocks. */
  text: string
  lines: LaidLine[]
  /** Pages in the file. */
  pageCount: number
  /** Pages read (at most the page limit). */
  pagesRead: number
  /** The file has more pages than were read. */
  truncated: boolean
  /** Read pages with no text of their own (scanned pages inside an otherwise digital PDF). 1-based. */
  pagesWithoutText: number[]
  /** Table rows found (header rows not counted). */
  tableRows: number
  /** Scanned pages read by the picture reader. 1-based. */
  ocrPages: number[]
  /** The picture reader's confidence over those pages (0 to 100), when there were any. */
  ocrConfidence: number | null
}

export interface PdfTextFail {
  ok: false
  reason: PdfReadFailure
  /** One sentence for the screen. Empty for `aborted`. */
  message: string
  pageCount: number | null
}

export type PdfTextResult = PdfTextOk | PdfTextFail

/** What the person is asked to type instead: the items of an enquiry, or the prices of a supplier quote. */
export type PdfSubject = 'items' | 'prices'

export interface ReadPdfOptions {
  maxBytes?: number
  maxPages?: number
  subject?: PdfSubject
  signal?: AbortSignal
  /** Where pdf.js comes from. Default: the lazy chunk (pdfjsRuntime.ts). Tests pass their own. */
  load?: () => Promise<Pdfjs>
  /** Progress while scanned pages are read ("Reading the scan… 40%"), never going back. */
  onProgress?: (p: ImageProgress) => void
  /** Scanned pages are read by the picture reader. false: report a scan instead. Default: on wherever a canvas can be drawn. */
  ocr?: boolean
  /** Draws one page as a picture. Default: a canvas in this document. Tests pass their own. */
  renderPage?: (page: PdfPage, scale: number) => Promise<Blob | null>
  /** Reads one drawn page. Default: the picture reader (imageText.ts, lazy). Tests pass their own. */
  readImage?: (picture: Blob, opts: { subject: PdfSubject; signal?: AbortSignal; onProgress: (p: ImageProgress) => void }) => Promise<ImageTextResult>
}

/** The long edge, in px, a scanned page is drawn at for the picture reader (it scales to about 2000 px itself). */
const SCAN_RENDER_EDGE = 2400

async function canvasPage(page: PdfPage, scale: number): Promise<Blob | null> {
  if (typeof document === 'undefined') return null
  const viewport = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(viewport.width)
  canvas.height = Math.ceil(viewport.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  await page.render({ canvasContext: ctx, canvas, viewport }).promise
  return new Promise(resolve => canvas.toBlob(b => resolve(b), 'image/png'))
}

export function scanProgressMessage(percent: number): string {
  return `Reading the scan… ${Math.round(percent)}%`
}

const mb = (n: number) => `${Number((n / (1024 * 1024)).toFixed(1))} MB`

export function pdfFailureMessage(reason: PdfReadFailure, subject: PdfSubject = 'items', size?: number, maxBytes = PDF_MAX_BYTES): string {
  const what = `type or paste the ${subject}`
  switch (reason) {
    case 'scan':
      // A scan is a picture: the picture reader can read a screenshot or a photo of it (imageText.ts).
      return `This PDF is a scan. Take a screenshot or photo of it and choose that instead, or ${what}.`
    case 'password':
      return `This PDF is locked with a password. Open it, copy the text and paste it here, or ${what}.`
    case 'too_big':
      return `This PDF is ${size !== undefined ? mb(size) : 'too big'}; the limit is ${mb(maxBytes)}. Copy the text from it and paste it here, or ${what}.`
    case 'not_pdf':
      return `This file is not a PDF. Choose a PDF, a screenshot or a photo, or ${what}.`
    case 'unreadable':
      return `This PDF could not be read. Take a screenshot of it and choose that instead, or ${what}.`
    case 'aborted':
      return ''
  }
}

/** A file the share sheet, a drop or a picker handed over that is a PDF (some phones send no type). */
export function isPdfFile(file: { type?: string; name?: string }): boolean {
  return file.type === 'application/pdf' || /\.pdf$/i.test(file.name ?? '')
}

type Input = Blob | ArrayBuffer | Uint8Array

// Bytes may come from another realm (a worker, a test DOM), where `instanceof` fails: tell them apart by shape.
const isView = (x: Input): x is Uint8Array => ArrayBuffer.isView(x)
const isBuffer = (x: Input): x is ArrayBuffer => Object.prototype.toString.call(x) === '[object ArrayBuffer]'

function sizeOf(input: Input): number {
  return isView(input) || isBuffer(input) ? input.byteLength : input.size
}

async function bytesOf(input: Input): Promise<Uint8Array> {
  // A copy every time: pdf.js hands the bytes to its worker, which detaches the buffer it was given.
  if (isView(input)) return new Uint8Array(input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength))
  if (isBuffer(input)) return new Uint8Array(input.slice(0))
  if (typeof input.arrayBuffer === 'function') return new Uint8Array(await input.arrayBuffer())
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer))
    fr.onerror = () => reject(fr.error)
    fr.readAsArrayBuffer(input)
  })
}

/** "%PDF-" in the first kilobyte (the format allows a little junk before it). */
function looksLikePdf(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024)
  for (let i = 0; i + 4 < head.length; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) return true
  }
  return false
}

/** Scanner apps stamp a line of text on an image-only page; it does not make the page readable. */
const SCANNER_STAMP = /camscanner|scanned\s+(?:with|by)|adobe\s+scan|genius\s+scan|microsoft\s+lens|office\s+lens/i
const MIN_PAGE_CHARS = 8

function pageChars(runs: TextRun[]): number {
  return runs.filter(r => !SCANNER_STAMP.test(r.str)).reduce((n, r) => n + r.str.replace(/\s/g, '').length, 0)
}

const isPasswordError = (e: unknown) => (e as { name?: string } | null)?.name === 'PasswordException'

export async function readPdfText(input: Input, opts: ReadPdfOptions = {}): Promise<PdfTextResult> {
  const maxBytes = opts.maxBytes ?? PDF_MAX_BYTES
  const maxPages = opts.maxPages ?? PDF_MAX_PAGES
  const subject = opts.subject ?? 'items'
  const fail = (reason: PdfReadFailure, pageCount: number | null = null, size?: number): PdfTextFail => ({
    ok: false,
    reason,
    message: pdfFailureMessage(reason, subject, size, maxBytes),
    pageCount,
  })

  const size = sizeOf(input)
  if (size > maxBytes) return fail('too_big', null, size)
  if (opts.signal?.aborted) return fail('aborted')
  let bytes: Uint8Array
  try {
    bytes = await bytesOf(input)
  } catch {
    return fail('unreadable')
  }
  if (!looksLikePdf(bytes)) return fail('not_pdf')

  let pdfjs: Pdfjs
  try {
    pdfjs = await (opts.load ?? (async () => (await import('./pdfjsRuntime')).pdfjs))()
  } catch {
    // The chunk could not be fetched (offline on a first use): the file itself is fine.
    return fail('unreadable')
  }
  if (opts.signal?.aborted) return fail('aborted')

  const task = pdfjs.getDocument({
    data: bytes,
    // pdf.js 6 has no eval path (the isEvalSupported option is gone), so the CSP needs no 'unsafe-eval'.
    disableFontFace: true,
    useSystemFonts: false,
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
    disableRange: true,
    stopAtErrors: false,
    verbosity: pdfjs.VerbosityLevel.ERRORS,
  })
  const onAbort = () => void task.destroy()
  opts.signal?.addEventListener('abort', onAbort, { once: true })
  let pageCount: number | null = null
  try {
    let doc: Awaited<typeof task.promise>
    try {
      doc = await task.promise
    } catch (e) {
      if (opts.signal?.aborted) return fail('aborted')
      return fail(isPasswordError(e) ? 'password' : 'unreadable')
    }
    pageCount = doc.numPages
    const pagesRead = Math.min(pageCount, maxPages)
    const pages: TextRun[][] = []
    const pagesWithoutText: number[] = []
    const ocrOn = opts.ocr ?? (typeof document !== 'undefined' || Boolean(opts.renderPage))
    const drawn: Array<{ page: number; picture: Blob }> = []
    for (let p = 1; p <= pagesRead; p++) {
      if (opts.signal?.aborted) return fail('aborted', pageCount)
      const page = await doc.getPage(p)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const straight: TextRun[] = []
      const turned: TextRun[] = []
      for (const item of content.items) {
        if (!('str' in item) || item.str.trim() === '') continue
        const m = pdfjs.Util.transform(viewport.transform, item.transform) as number[]
        const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = m
        const size = Math.hypot(c, d)
        if (Math.abs(b) <= Math.abs(a) * 0.2) {
          straight.push({ str: item.str, x: e, y: f, w: item.width, size })
          continue
        }
        // Turned text: read in its own direction (u along the line, v to the next line), so a page printed on its side reads
        // as if it had been turned upright.
        const n = Math.hypot(a, b) || 1
        const u = { x: a / n, y: b / n }
        const v = { x: -u.y, y: u.x }
        turned.push({ str: item.str, x: e * u.x + f * u.y, y: e * v.x + f * v.y, w: item.width, size })
      }
      // Mostly turned: the page lies on its side. Otherwise turned text is a watermark or a label up the margin: left out.
      const chars = (rs: TextRun[]) => rs.reduce((k, r) => k + r.str.length, 0)
      const runs = chars(turned) > chars(straight) ? turned : straight
      if (pageChars(runs) < MIN_PAGE_CHARS) {
        pagesWithoutText.push(p)
        if (ocrOn) {
          const [w, h] = [viewport.width, viewport.height]
          const picture = await (opts.renderPage ?? canvasPage)(page, Math.min(4, Math.max(1.5, SCAN_RENDER_EDGE / Math.max(w, h)))).catch(() => null)
          if (picture) drawn.push({ page: p, picture })
        }
      }
      pages.push(runs)
      page.cleanup()
    }
    // Scanned pages: read as pictures, page by page, on this device.
    const ocrLines = new Map<number, LaidLine[]>()
    const confidences: number[] = []
    if (drawn.length) {
      let shown = -1
      const progress = (fraction: number) => {
        const percent = Math.floor(Math.max(0, Math.min(1, fraction)) * 100)
        if (percent <= shown) return
        shown = percent
        opts.onProgress?.({ percent, message: scanProgressMessage(percent) })
      }
      progress(0)
      const read = opts.readImage ?? (async (picture: Blob, o: { subject: PdfSubject; signal?: AbortSignal; onProgress: (p: ImageProgress) => void }) => (await import('./imageText')).readImageText(picture, o))
      for (const [i, d] of drawn.entries()) {
        if (opts.signal?.aborted) return fail('aborted', pageCount)
        const r = await read(d.picture, { subject, signal: opts.signal, onProgress: p => progress((i + p.percent / 100) / drawn.length) })
        if (opts.signal?.aborted || (!r.ok && r.reason === 'aborted')) return fail('aborted', pageCount)
        if (r.ok) {
          ocrLines.set(d.page, r.lines.map(l => ({ ...l, page: d.page })))
          confidences.push(r.confidence)
        }
      }
      progress(1)
    }
    if (pagesWithoutText.length === pagesRead && ocrLines.size === 0) return fail('scan', pageCount)
    const laid = layoutPages(pages)
    // The pictures' lines go in at their own page, between the pages that had text.
    const lines: LaidLine[] = []
    const pending = [...ocrLines.entries()].sort((a, b) => a[0] - b[0])
    const flushUpTo = (page: number) => {
      while (pending.length && (pending[0] as [number, LaidLine[]])[0] <= page) {
        const [p, ls] = pending.shift() as [number, LaidLine[]]
        if (lines.length && (lines[lines.length - 1] as LaidLine).text !== '') lines.push({ text: '', cells: [], kind: 'text', page: p })
        lines.push(...ls)
      }
    }
    for (const l of laid) {
      flushUpTo(l.page - 1)
      lines.push(l)
    }
    flushUpTo(Infinity)
    return {
      ok: true,
      text: linesToText(lines),
      lines,
      pageCount,
      pagesRead,
      truncated: pageCount > pagesRead,
      pagesWithoutText,
      tableRows: lines.filter(l => l.kind === 'row').length,
      ocrPages: [...ocrLines.keys()].sort((a, b) => a - b),
      ocrConfidence: confidences.length ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) : null,
    }
  } catch (e) {
    if (opts.signal?.aborted) return fail('aborted', pageCount)
    return fail(isPasswordError(e) ? 'password' : 'unreadable', pageCount)
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
    await task.destroy().catch(() => undefined)
  }
}
