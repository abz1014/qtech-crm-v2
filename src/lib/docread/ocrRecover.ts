// A second look at the ink the engine skipped. Pure (pixels in, boxes out), tested in ocrRecover.test.ts.
//
// Tesseract's page layout often drops a short word that stands alone in a table cell: the quantity "4" or the unit "EA" in
// the right-hand columns of an Outlook table, an "S.No" digit. The ink is there, on the same row as words it did read. This
// finds such ink (dark pixels no word box covers, grouped into word-sized boxes, on a row that has words), so imageText.ts can
// read each box again on its own as a single line, and put what it reads back in its place.

import { cleanWord, typicalRowHeight, type OcrBox, type OcrLine } from './ocrLayout'

/** Darker than this (on the cleaned grey picture) is ink: thin strokes of small text scaled up are grey, not black. */
const INK = 190
/** Words read at least this sure cover their ink; less sure ones are read again when a box overlaps them. */
const TRUSTED = 60
/** At most this many boxes are read again (time on a slow phone): a table of 30 rows has a serial number and a quantity to find in each. */
export const MAX_RECOVER_BOXES = 120

const overlapY = (a: OcrBox, b: OcrBox) => Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0))

/**
 * Word-sized boxes of ink no trusted word covers, each lying on a row that has words. `px` is RGBA, grey (cleanPixels).
 */
export function findMissedBoxes(px: Uint8ClampedArray, width: number, height: number, lines: readonly OcrLine[]): OcrBox[] {
  const rh = typicalRowHeight(lines)
  if (!rh) return []
  const g = Math.max(2, Math.round(rh / 8))
  const gw = Math.ceil(width / g)
  const gh = Math.ceil(height / g)
  const grid = new Uint8Array(gw * gh)
  const covered = new Uint8Array(width * height)
  const pad = Math.round(rh * 0.15)
  for (const l of lines) {
    for (const w of l.words) {
      if (w.confidence < TRUSTED && cleanWord(w) !== null) continue
      for (let y = Math.max(0, w.bbox.y0 - pad); y < Math.min(height, w.bbox.y1 + pad); y++) {
        covered.fill(1, y * width + Math.max(0, w.bbox.x0 - pad), y * width + Math.min(width, w.bbox.x1 + pad))
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!covered[i] && (px[4 * i] as number) < INK) grid[Math.floor(y / g) * gw + Math.floor(x / g)] = 1
    }
  }
  // Letters of one word are joined across their gaps (half a row height), not across a column gap.
  const reach = Math.max(1, Math.ceil((0.5 * rh) / g))
  const seen = new Uint8Array(gw * gh)
  const boxes: OcrBox[] = []
  for (let start = 0; start < grid.length; start++) {
    if (!grid[start] || seen[start]) continue
    const stack = [start]
    seen[start] = 1
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    while (stack.length) {
      const c = stack.pop() as number
      const cx = c % gw
      const cy = (c - cx) / gw
      x0 = Math.min(x0, cx)
      x1 = Math.max(x1, cx)
      y0 = Math.min(y0, cy)
      y1 = Math.max(y1, cy)
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          const nx = cx + dx
          const ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue
          const n = ny * gw + nx
          if (grid[n] && !seen[n]) {
            seen[n] = 1
            stack.push(n)
          }
        }
      }
    }
    const box = { x0: x0 * g, y0: y0 * g, x1: Math.min(width, (x1 + 1) * g), y1: Math.min(height, (y1 + 1) * g) }
    const h = box.y1 - box.y0
    const w = box.x1 - box.x0
    if (h < 0.45 * rh || h > 2.2 * rh || w < 0.3 * rh || w > 30 * rh) continue
    // Only on a row that has words: a cell beside cells that were read, not an icon in empty space.
    // (A cell centred in a tall row of a wrapped table sits between the lines of its neighbour: within half a row of one counts.)
    const mid = (box.y0 + box.y1) / 2
    const row = lines.some(
      l =>
        l.words.some(wd => wd.confidence >= TRUSTED) &&
        (overlapY(l.bbox, box) >= 0.5 * Math.min(h, l.bbox.y1 - l.bbox.y0) || (mid >= l.bbox.y0 - 0.6 * rh && mid <= l.bbox.y1 + 0.6 * rh)),
    )
    if (row) boxes.push(box)
  }
  return boxes.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0).slice(0, MAX_RECOVER_BOXES)
}

/**
 * Puts what was read again back in place: the new lines are added, and the unsure words they overlap are dropped (the box
 * was read on its own, which is the better reading).
 */
export function mergeRecovered(lines: readonly OcrLine[], recovered: readonly OcrLine[]): OcrLine[] {
  const boxes = recovered.map(l => l.bbox)
  const hits = (b: OcrBox) => boxes.some(r => Math.min(r.x1, b.x1) > Math.max(r.x0, b.x0) && Math.min(r.y1, b.y1) > Math.max(r.y0, b.y0))
  const kept = lines
    .map(l => ({ ...l, words: l.words.filter(w => w.confidence >= TRUSTED || !hits(w.bbox)) }))
    .filter(l => l.words.length > 0)
  return [...kept, ...recovered]
}

/** A box grown by `pad` px on every side, kept inside the picture. */
export function padBox(b: OcrBox, pad: number, width: number, height: number): OcrBox {
  return { x0: Math.max(0, b.x0 - pad), y0: Math.max(0, b.y0 - pad), x1: Math.min(width, b.x1 + pad), y1: Math.min(height, b.y1 + pad) }
}
