import { useRef, useState } from 'react'
import type { ReplyItemRef } from '@/features/rfqs/lib/replyParse'
import { enquiryResult, quoteResult } from '@/lib/docread/corpus/results'
import { parseEnquiry } from '@/lib/docread/enquiryParse'
import { readImageText, type ImageTextResult } from '@/lib/docread/imageText'
import { readPdfText } from '@/lib/docread/pdfText'
import { readSheetText } from '@/lib/docread/sheetText'
import { parseSupplierQuote } from '@/lib/docread/supplierQuoteParse'

/*
 * /dev/docread: dev builds only (dead code in production). A bare page that reads a picture with readImageText and puts the
 * text and the items parseEnquiry finds on the page, so e2e/docread/ocr.spec.ts can drive the real reader (lazy chunk, worker,
 * engine and language data) under the production Content-Security-Policy before any screen uses it.
 */
const TODAY = '2026-10-20'
const itemsOf = (text: string) => {
  const r = parseEnquiry(text, { today: TODAY })
  return {
    items: r.items.map(i => ({ description: i.description, qty: i.qty, unit: i.unit })),
    customerRef: r.facts.customerRef?.value ?? null,
    domain: r.facts.company?.domain ?? null,
  }
}
// The spec compares what a picture gives with what the same text gives when pasted.
;(window as unknown as { __docreadItems?: typeof itemsOf }).__docreadItems = itemsOf

const bytes = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0))
/**
 * For e2e/docread/corpus.spec.ts: the real readers on a picture or a PDF given as base64 (scored in the spec against the
 * fictional corpus's truth), and the parsers' verdicts in the shape the scorer takes.
 */
const corpusApi = {
  async readImage(b64: string, type: string) {
    const t0 = performance.now()
    const r = await readImageText(new Blob([bytes(b64)], { type }))
    return { ok: r.ok, text: r.ok ? r.text : '', reason: r.ok ? null : r.reason, confidence: r.ok ? r.confidence : null, ms: Math.round(performance.now() - t0) }
  },
  async readPdf(b64: string) {
    const t0 = performance.now()
    const r = await readPdfText(bytes(b64))
    return { ok: r.ok, text: r.ok ? r.text : '', reason: r.ok ? null : r.reason, confidence: r.ok ? r.ocrConfidence : null, ms: Math.round(performance.now() - t0) }
  },
  parseEnquiry: (text: string) => enquiryResult(parseEnquiry(text, { today: TODAY })),
  parseQuote: (text: string, rfq: ReplyItemRef[]) => quoteResult(parseSupplierQuote(text, rfq, { today: TODAY })),
}
;(window as unknown as { __docread?: typeof corpusApi }).__docread = corpusApi

export default function DocreadLab() {
  const [progress, setProgress] = useState('')
  const [result, setResult] = useState<(ImageTextResult & { ms: number }) | null>(null)
  const ctrl = useRef<AbortController | null>(null)

  const read = async (file: File | undefined) => {
    if (!file) return
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    setResult(null)
    const t0 = performance.now()
    const r = await readImageText(file, {
      signal: c.signal,
      onProgress: p => setProgress(p.message),
      // The raw words and the cleaned picture, for looking into a bad reading from the browser console.
      onWords: (words, image) => {
        ;(window as unknown as { __docreadWords?: unknown }).__docreadWords = {
          words,
          rules: image.rules,
          picture: image.image instanceof HTMLCanvasElement ? image.image.toDataURL() : null,
        }
      },
    })
    if (ctrl.current === c) setResult({ ...r, ms: Math.round(performance.now() - t0) })
  }

  // A spreadsheet (.xlsx, .xls, .csv): its item table as text, shown the same way (e2e/docread/sheet.spec.ts).
  const readSheetFile = async (file: File | undefined) => {
    if (!file) return
    setResult(null)
    const t0 = performance.now()
    const r = await readSheetText(file)
    const shown: ImageTextResult = r.ok ? { ok: true, text: r.text, lines: [], confidence: 100, tableRows: 0 } : { ok: false, reason: 'unclear', message: r.message }
    setResult({ ...shown, ms: Math.round(performance.now() - t0) })
  }

  // A PDF (a scan is read page by page by the picture reader), shown the same way.
  const readPdfFile = async (file: File | undefined) => {
    if (!file) return
    ctrl.current?.abort()
    const c = new AbortController()
    ctrl.current = c
    setResult(null)
    const t0 = performance.now()
    const r = await readPdfText(file, { signal: c.signal, onProgress: p => setProgress(p.message) })
    const shown: ImageTextResult = r.ok ? { ok: true, text: r.text, lines: r.lines, confidence: r.ocrConfidence ?? 100, tableRows: r.tableRows } : { ok: false, reason: r.reason === 'aborted' ? 'aborted' : 'unclear', message: r.message }
    if (ctrl.current === c) setResult({ ...shown, ms: Math.round(performance.now() - t0) })
  }

  const items = result?.ok ? itemsOf(result.text) : null
  return (
    <main className="mx-auto max-w-3xl space-y-3 p-4">
      <h1 className="text-lg font-semibold">Read a picture</h1>
      <label className="block">
        Picture <input type="file" accept="image/*" onChange={e => void read(e.target.files?.[0])} />
      </label>
      <label className="block">
        PDF <input type="file" accept="application/pdf" onChange={e => void readPdfFile(e.target.files?.[0])} />
      </label>
      <label className="block">
        Spreadsheet <input type="file" accept=".xlsx,.xls,.csv" onChange={e => void readSheetFile(e.target.files?.[0])} />
      </label>
      <button type="button" className="underline" onClick={() => ctrl.current?.abort()}>
        Cancel
      </button>
      <p role="status" data-testid="ocr-progress">
        {progress}
      </p>
      {result ? (
        <section data-testid="ocr-result" data-ok={String(result.ok)} data-ms={result.ms} data-reason={result.ok ? '' : result.reason}>
          {result.ok ? (
            <>
              <p data-testid="ocr-confidence">Confidence {result.confidence}</p>
              <pre data-testid="ocr-text" className="whitespace-pre-wrap rounded border p-2">
                {result.text}
              </pre>
              <pre data-testid="ocr-items">{JSON.stringify(items)}</pre>
            </>
          ) : (
            <p data-testid="ocr-message">{result.message || 'Cancelled.'}</p>
          )}
        </section>
      ) : null}
    </main>
  )
}
