// Reads the text of a PDF in the browser (owner decision 2026-10-20, item 3): customer enquiries and supplier quotes that
// arrive as a PDF become text for the same parsers a paste goes through. Free, nothing is uploaded or sent anywhere: the file
// is read on the device by pdf.js, which is loaded only now (a lazy chunk and a same-origin worker, see pdfjsRuntime.ts).
//
// What comes back is either the text (lines in reading order, table rows with their cells joined by a tab, pdfLayout.ts) or
// a plain reason it could not be read, worded for the screen:
//  - a scan (pages with no text layer, a photo saved as a PDF): "This PDF is a scan; type or paste the items." Photo OCR
//    comes later, after PDFs work well;
//  - a password-protected PDF, a file that is not a PDF, a file over the size limit, a damaged file.
// Long files are read up to a page limit; `truncated` says so. Nothing here throws for a bad file.

import { layoutPages, linesToText, type LaidLine, type TextRun } from './pdfLayout'

type Pdfjs = (typeof import('./pdfjsRuntime'))['pdfjs']

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
}

const mb = (n: number) => `${Number((n / (1024 * 1024)).toFixed(1))} MB`

export function pdfFailureMessage(reason: PdfReadFailure, subject: PdfSubject = 'items', size?: number, maxBytes = PDF_MAX_BYTES): string {
  const what = `type or paste the ${subject}`
  switch (reason) {
    case 'scan':
      return `This PDF is a scan; ${what}.`
    case 'password':
      return `This PDF is locked with a password. Open it, copy the text and paste it here, or ${what}.`
    case 'too_big':
      return `This PDF is ${size !== undefined ? mb(size) : 'too big'}; the limit is ${mb(maxBytes)}. Copy the text from it and paste it here, or ${what}.`
    case 'not_pdf':
      return `This file is not a PDF. Paste the text, or ${what}.`
    case 'unreadable':
      return `This PDF could not be read. Paste the text, or ${what}.`
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
    // The CSP has no 'unsafe-eval': pdf.js must not even probe for it.
    isEvalSupported: false,
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
    for (let p = 1; p <= pagesRead; p++) {
      if (opts.signal?.aborted) return fail('aborted', pageCount)
      const page = await doc.getPage(p)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const runs: TextRun[] = []
      for (const item of content.items) {
        if (!('str' in item) || item.str.trim() === '') continue
        const m = pdfjs.Util.transform(viewport.transform, item.transform) as number[]
        const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = m
        // Turned text (a watermark across the page, a label up the margin) is not part of the reading order.
        if (Math.abs(b) > Math.abs(a) * 0.2) continue
        runs.push({ str: item.str, x: e, y: f, w: item.width, size: Math.hypot(c, d) })
      }
      if (pageChars(runs) < MIN_PAGE_CHARS) pagesWithoutText.push(p)
      pages.push(runs)
      page.cleanup()
    }
    if (pagesWithoutText.length === pagesRead) return fail('scan', pageCount)
    const lines = layoutPages(pages)
    return {
      ok: true,
      text: linesToText(lines),
      lines,
      pageCount,
      pagesRead,
      truncated: pageCount > pagesRead,
      pagesWithoutText,
      tableRows: lines.filter(l => l.kind === 'row').length,
    }
  } catch (e) {
    if (opts.signal?.aborted) return fail('aborted', pageCount)
    return fail(isPasswordError(e) ? 'password' : 'unreadable', pageCount)
  } finally {
    opts.signal?.removeEventListener('abort', onAbort)
    await task.destroy().catch(() => undefined)
  }
}
