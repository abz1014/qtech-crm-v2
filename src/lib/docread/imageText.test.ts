import { describe, expect, it, vi } from 'vitest'
import {
  cleanPixels,
  imageFailureMessage,
  isImageFile,
  readImageText,
  removeRules,
  scaleFor,
  type OcrEngine,
  type PreparedImage,
} from './imageText'
import type { OcrLine } from './ocrLayout'

// The reader with its two outside parts replaced: `prepare` (the canvas work) and the OCR engine. The real engine runs in
// e2e/docread/ocr.spec.ts, in Chromium, under the production Content-Security-Policy.

const png = (bytes = 10) => new File([new Uint8Array(bytes)], 'shot.png', { type: 'image/png' })

/** Words 30 px tall at 16 px per character, one line per string, 40 px apart. */
function page(lines: string[], { conf = 95, rowHeight = 30 } = {}): OcrLine[] {
  return lines.map((t, i) => {
    let x = 40
    const y = 100 + 40 * i
    const words = t.split(' ').map(w => {
      const box = { x0: x, y0: y - 30, x1: x + 16 * w.length, y1: y }
      x = box.x1 + 10
      return { text: w, confidence: conf, bbox: box }
    })
    return { words, bbox: { x0: 40, y0: y - 30, x1: x - 10, y1: y }, baseline: { x0: 40, y0: y, x1: x - 10, y1: y }, rowHeight }
  })
}

const prepared = (scale = 1): PreparedImage => ({ image: new Blob(['x'], { type: 'image/png' }), width: 1000, height: 800, scale })

function engine(...reads: OcrLine[][]): OcrEngine & { calls: number } {
  const e = {
    calls: 0,
    read: vi.fn(async (_img: unknown, { onProgress }: { onProgress: (f: number) => void }) => {
      onProgress(0.5)
      onProgress(1)
      return reads[Math.min(e.calls++, reads.length - 1)] as OcrLine[]
    }),
  }
  return e
}

describe('readImageText', () => {
  it('reads a screenshot into text lines, with progress as it goes', async () => {
    const seen: string[] = []
    const r = await readImageText(png(), {
      prepare: async () => prepared(),
      engine: engine(page(['Please quote:', 'Contactor 3RT2026 24VDC - 4 nos'])),
      onProgress: p => seen.push(p.message),
    })
    expect(r).toMatchObject({ ok: true, text: 'Please quote:\nContactor 3RT2026 24VDC - 4 nos', confidence: 95 })
    expect(seen[0]).toBe('Reading the image… 0%')
    expect(seen[seen.length - 1]).toBe('Reading the image… 100%')
    const pct = seen.map(s => Number(/(\d+)%/.exec(s)![1]))
    expect(pct).toEqual([...pct].sort((a, b) => a - b))
  })

  it('reads small letters a second time from a larger copy', async () => {
    const prepare = vi.fn(async (_f: Blob, scale?: number) => prepared(scale ?? 1))
    const e = engine(page(['Valve 2 nos'], { rowHeight: 14 }), page(['Valve DN50 2 nos'], { rowHeight: 32 }))
    const r = await readImageText(png(), { prepare, engine: e })
    expect(prepare).toHaveBeenCalledTimes(2)
    expect(prepare.mock.calls[1]![1]).toBeCloseTo(34 / 14)
    expect(r.ok && r.text).toBe('Valve DN50 2 nos')
  })

  it('reads again, on its own, a cell the page reading skipped', async () => {
    // "10" sits far right of the read words, on their row; the engine is asked for it as a piece ('line' mode).
    const W = 400
    const H = 160
    const px = new Uint8ClampedArray(W * H * 4).fill(255)
    for (let y = 72; y < 100; y++) for (let x = 330; x < 362; x++) px.fill(0, 4 * (y * W + x), 4 * (y * W + x) + 3)
    const words = page(['CAPACITOR 100UF'])
    const lines: OcrLine[] = [{ words: [{ text: '10', confidence: 96, bbox: { x0: 16, y0: 16, x1: 80, y1: 72 } }], bbox: { x0: 16, y0: 16, x1: 80, y1: 72 }, rowHeight: 56 }]
    const read = vi.fn(async (_i: unknown, o: { mode?: string }) => (o.mode === 'line' ? lines : words))
    const crop = vi.fn(() => new Blob(['c']))
    const r = await readImageText(png(), { prepare: async () => ({ ...prepared(), width: W, height: H, pixels: px, crop }), engine: { read } })
    expect(read.mock.calls.map(c => (c[1] as { mode?: string }).mode ?? 'page')).toEqual(['page', 'line'])
    expect(r.ok && r.text).toBe('CAPACITOR 100UF\t10')
  })

  it('says plainly when it could not read the picture clearly, or found no text', async () => {
    const unsure = await readImageText(png(), { prepare: async () => prepared(), engine: engine(page(['Vavle 2 nso'], { conf: 40 })) })
    expect(unsure).toEqual({ ok: false, reason: 'unclear', message: "Couldn't read this clearly — type or paste the items." })
    const blank = await readImageText(png(), { prepare: async () => prepared(), engine: engine([]), subject: 'prices' })
    expect(blank).toEqual({ ok: false, reason: 'unclear', message: "Couldn't read this clearly — type or paste the prices." })
  })

  it('turns away what is not a picture, too big, or cannot be opened here, before the engine loads', async () => {
    const e = engine(page(['x']))
    expect(await readImageText(new File(['2 nos'], 'notes.txt', { type: 'text/plain' }), { engine: e })).toMatchObject({ ok: false, reason: 'not_image' })
    expect(await readImageText(png(2000), { engine: e, maxBytes: 1000 })).toMatchObject({ ok: false, reason: 'too_big' })
    expect(await readImageText(png(), { engine: e, prepare: async () => null })).toMatchObject({ ok: false, reason: 'unsupported' })
    expect(e.read).not.toHaveBeenCalled()
  })

  it('says the reader could not start when the engine fails (offline on a first use)', async () => {
    const r = await readImageText(png(), { prepare: async () => prepared(), engine: { read: async () => Promise.reject(new Error('fetch failed')) } })
    expect(r).toMatchObject({ ok: false, reason: 'unreadable' })
    expect(r.ok ? '' : r.message).toMatch(/could not start/)
  })

  it('stops when cancelled, with no message', async () => {
    const ctrl = new AbortController()
    const read = vi.fn(async () => {
      ctrl.abort()
      throw new DOMException('Aborted', 'AbortError')
    })
    expect(await readImageText(png(), { prepare: async () => prepared(), engine: { read }, signal: ctrl.signal })).toEqual({
      ok: false,
      reason: 'aborted',
      message: '',
    })
    expect(await readImageText(png(), { signal: ctrl.signal })).toMatchObject({ reason: 'aborted' })
  })
})

describe('helpers', () => {
  it('knows a picture by its type, or by its name when there is no type; SVG is not one', () => {
    expect(isImageFile({ type: 'image/heic' })).toBe(true)
    expect(isImageFile({ type: '', name: 'IMG_0042.HEIC' })).toBe(true)
    expect(isImageFile({ type: 'image/svg+xml', name: 'logo.svg' })).toBe(false)
    expect(isImageFile({ type: 'application/pdf', name: 'rfq.png' })).toBe(false)
  })

  it('scales big pictures down to 2000 px and small ones up', () => {
    expect(scaleFor(4000)).toBe(0.5)
    expect(scaleFor(1600)).toBe(1)
    expect(scaleFor(700)).toBe(2)
    expect(scaleFor(200)).toBe(2.5)
  })

  it('words the messages for the screen', () => {
    expect(imageFailureMessage('too_big', 'items', 30 * 1024 * 1024)).toBe(
      'This picture is 30 MB; the limit is 25 MB. Take a screenshot of it and use that, or type or paste the items.',
    )
    expect(imageFailureMessage('aborted')).toBe('')
  })

  it('makes a dark-mode screenshot dark-on-light, and stretches the contrast', () => {
    // 90% dark background (20), 10% light text (230).
    const px = new Uint8ClampedArray(100 * 4)
    for (let i = 0; i < 100; i++) px.fill(i < 90 ? 20 : 230, 4 * i, 4 * i + 3)
    cleanPixels(px)
    expect(px[0]).toBe(255)
    expect(px[4 * 95]).toBe(0)
  })

  it('wipes the rules of a table, not the letters or a filled block', () => {
    const W = 200
    const H = 60
    const px = new Uint8ClampedArray(W * H * 4).fill(255)
    const ink = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) px.fill(0, 4 * (y * W + x), 4 * (y * W + x) + 3)
    }
    ink(0, 5, 200, 7) // a rule, 2 px thick
    ink(20, 20, 23, 45) // a letter stroke
    ink(100, 20, 190, 50) // a filled block (a logo), 30 px thick
    removeRules(px, W, H)
    expect(px[4 * (6 * W + 50)]).toBe(255)
    expect(px[4 * (30 * W + 21)]).toBe(0)
    expect(px[4 * (30 * W + 150)]).toBe(0)
  })
})
