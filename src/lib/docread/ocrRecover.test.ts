import { describe, expect, it } from 'vitest'
import type { OcrBox, OcrLine } from './ocrLayout'
import { findMissedBoxes, mergeRecovered, padBox } from './ocrRecover'

const W = 600
const H = 200

/** A white grey RGBA picture with black rectangles of "ink". */
function picture(ink: OcrBox[]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * H * 4).fill(255)
  for (const b of ink) {
    for (let y = b.y0; y < b.y1; y++) {
      for (let x = b.x0; x < b.x1; x++) {
        const i = 4 * (y * W + x)
        px[i] = px[i + 1] = px[i + 2] = 0
      }
    }
  }
  return px
}

const word = (text: string, b: OcrBox, confidence = 95) => ({ text, confidence, bbox: b })
const lineOf = (words: ReturnType<typeof word>[]): OcrLine => ({
  words,
  bbox: { x0: words[0]!.bbox.x0, y0: words[0]!.bbox.y0, x1: words[words.length - 1]!.bbox.x1, y1: words[0]!.bbox.y1 },
  rowHeight: 24,
})

describe('findMissedBoxes', () => {
  // A row: "CAPACITOR 100UF" read; "10" and "EA" in the right-hand cells skipped. An icon far below, on no row.
  const read = [word('CAPACITOR', { x0: 20, y0: 40, x1: 160, y1: 64 }), word('100UF', { x0: 175, y0: 40, x1: 250, y1: 64 })]
  const qty = { x0: 420, y0: 42, x1: 444, y1: 64 }
  const unit = { x0: 500, y0: 42, x1: 532, y1: 64 }
  const icon = { x0: 300, y0: 150, x1: 330, y1: 175 }
  const px = picture([...read.map(w => w.bbox), qty, unit, icon])

  it('finds the skipped cells on a row that was read, one box each, and not the icon on no row', () => {
    const boxes = findMissedBoxes(px, W, H, [lineOf(read)])
    expect(boxes).toHaveLength(2)
    expect(boxes[0]!.x0).toBeLessThanOrEqual(qty.x0)
    expect(boxes[0]!.x1).toBeGreaterThanOrEqual(qty.x1)
    expect(boxes[0]!.x1).toBeLessThan(unit.x0)
    expect(boxes[1]!.x0).toBeLessThanOrEqual(unit.x0)
  })

  it('looks again at ink under an unsure word, and finds nothing when every word is read', () => {
    const unsure = [read[0]!, { ...read[1]!, confidence: 30 }]
    expect(findMissedBoxes(px, W, H, [lineOf(unsure)])).toHaveLength(3)
    const all = [...read, word('10', qty), word('EA', unit)]
    expect(findMissedBoxes(px, W, H, [lineOf(all)])).toEqual([])
  })
})

describe('mergeRecovered', () => {
  it('adds what was read again and drops the unsure words it overlaps', () => {
    const page = [lineOf([word('IGBT', { x0: 20, y0: 40, x1: 80, y1: 64 }), word('a', { x0: 420, y0: 42, x1: 444, y1: 64 }, 40)])]
    const again = [lineOf([word('4', { x0: 421, y0: 42, x1: 443, y1: 64 })])]
    const merged = mergeRecovered(page, again)
    expect(merged.flatMap(l => l.words.map(w => w.text))).toEqual(['IGBT', '4'])
  })

  it('pads a box inside the picture', () => {
    expect(padBox({ x0: 5, y0: 5, x1: 595, y1: 100 }, 10, W, H)).toEqual({ x0: 0, y0: 0, x1: 600, y1: 110 })
  })
})
