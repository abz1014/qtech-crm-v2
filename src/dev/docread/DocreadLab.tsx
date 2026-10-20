import { useRef, useState } from 'react'
import { parseEnquiry } from '@/lib/docread/enquiryParse'
import { readImageText, type ImageTextResult } from '@/lib/docread/imageText'

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

  const items = result?.ok ? itemsOf(result.text) : null
  return (
    <main className="mx-auto max-w-3xl space-y-3 p-4">
      <h1 className="text-lg font-semibold">Read a picture</h1>
      <label className="block">
        Picture <input type="file" accept="image/*" onChange={e => void read(e.target.files?.[0])} />
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
