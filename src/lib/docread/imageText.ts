// Reads the text of a picture in the browser (owner priority 2026-10-20): customer enquiries that arrive as a phone screenshot
// of a WhatsApp chat or an email, or as a screenshot of an Excel range, become text for the same parser a paste goes through.
// Free, and nothing is uploaded or sent anywhere: the picture is read on the device by tesseract.js, loaded only now (a lazy
// chunk, a same-origin worker, engine and language data, see ocrRuntime.ts and vite.config.ts).
//
// The result has the shape readPdfText gives (pdfText.ts): either the text (lines in reading order, table rows with their
// cells joined by a tab, ocrLayout.ts) or a plain reason it could not be read, worded for the screen:
//  - a picture read with low confidence, or with no text at all: "Couldn't read this clearly — type or paste the items.";
//  - a picture format this browser cannot open (an iPhone HEIC photo outside Safari), a file that is not a picture, a file
//    over the size limit, the reader failing to load (offline on a first use).
// Progress is reported as it goes ("Reading the image… 40%") and an AbortSignal cancels it. Nothing here throws for a bad file.
//
// Before reading, the picture is scaled to about 2000 px on its long edge (a small one is scaled up), made grey, turned
// dark-on-light when it is a dark-mode screenshot, and its contrast stretched. The engine reads best with letters about 30 px
// tall: when the first reading finds them much smaller (a laptop screenshot of an email at 100% zoom), the picture is scaled
// up to that size and read once more.

import { linesToText, type LaidLine } from './pdfLayout'
import {
  layoutOcr,
  MIN_PAGE_CONFIDENCE,
  MIN_PAGE_LETTERS,
  pageConfidence,
  skewAngle,
  typicalRowHeight,
  type OcrBox,
  type OcrLine,
  type TableRules,
} from './ocrLayout'
import { findMissedBoxes, mergeRecovered, padBox } from './ocrRecover'
import type { PdfSubject } from './pdfText'

export const IMAGE_MAX_BYTES = 25 * 1024 * 1024
/** The long edge the picture is scaled to (down for a big photo, up for a small crop). */
export const IMAGE_TARGET_EDGE = 2000
/** A picture whose long edge is under this is scaled up to it (at most 2.5 times). */
export const IMAGE_MIN_EDGE = 1400
/** Letters (the engine's row height) smaller than this, in px, are read a second time from a larger copy. */
export const MIN_ROW_HEIGHT = 24
/** The row height the second reading scales to. */
export const TARGET_ROW_HEIGHT = 34
/** The second reading's long edge stays under this (memory on a phone). */
export const MAX_EDGE = 4800
/** White margin, in px, round a piece read again on its own. */
const CROP_MARGIN = 16
/** The row height, in px, a piece read again on its own is enlarged to. */
const CROP_ROW_HEIGHT = 48
/**
 * A word read again counts only when read at least this sure: in a cell nothing was read from (a lone "25"), or over a word
 * the page reading was unsure of, which it replaces (a smudge read alone can come out as anything, so the bar is higher).
 */
const RECOVERED_CONFIDENCE = { empty: 60, replacing: 80 }

export type ImageReadFailure = 'not_image' | 'too_big' | 'unsupported' | 'unclear' | 'unreadable' | 'aborted'

export interface ImageTextOk {
  ok: true
  /** The text, ready for a paste box: one line per line, table rows with cells joined by a tab, a blank line between blocks. */
  text: string
  lines: LaidLine[]
  /** Mean word confidence, 0 to 100, weighted by letters. */
  confidence: number
  /** Table rows found (header rows not counted). */
  tableRows: number
}

export interface ImageTextFail {
  ok: false
  reason: ImageReadFailure
  /** One sentence for the screen. Empty for `aborted`. */
  message: string
}

export type ImageTextResult = ImageTextOk | ImageTextFail

export interface ImageProgress {
  /** 0 to 100, never going back. */
  percent: number
  /** "Reading the image… 40%" */
  message: string
}

/** The picture after scaling and clean-up, ready for the engine. */
export interface PreparedImage {
  image: HTMLCanvasElement | Blob
  width: number
  height: number
  /** The factor the original was scaled by. */
  scale: number
  /** The angle (radians) the original was turned by, to level a slanted photo. */
  angle?: number
  /** The cleaned pixels (RGBA, grey), for the second look at skipped ink (ocrRecover.ts). */
  pixels?: Uint8ClampedArray
  /** The table rules wiped off the picture, in its pixels. */
  rules?: Rules
  /** A piece of the cleaned picture, enlarged `scale` times. */
  crop?: (box: OcrBox, scale: number) => HTMLCanvasElement | Blob
}

/**
 * Reads the words of a prepared picture. `onProgress` gets 0 to 1 over the whole read, loading the engine included. `mode`:
 * a whole page (the default), or one line on its own (a box the page reading skipped).
 */
export interface OcrEngine {
  read(
    image: PreparedImage['image'],
    opts: { signal?: AbortSignal; onProgress: (fraction: number) => void; mode?: 'page' | 'line' },
  ): Promise<OcrLine[]>
}

export interface ReadImageOptions {
  subject?: PdfSubject
  signal?: AbortSignal
  onProgress?: (p: ImageProgress) => void
  maxBytes?: number
  /** Scales and cleans the picture. Default: a canvas in this page. Tests pass their own. */
  prepare?: (file: Blob, scale?: number, angle?: number) => Promise<PreparedImage | null>
  /** The words as the engine read them and the picture they were read from, before layout (the dev page shows them). */
  onWords?: (words: OcrLine[], image: PreparedImage) => void
  /** The OCR engine. Default: tesseract.js in a worker (ocrRuntime.ts). Tests pass their own. */
  engine?: OcrEngine
}

const mb = (n: number) => `${Number((n / (1024 * 1024)).toFixed(1))} MB`

export function imageProgressMessage(percent: number): string {
  return `Reading the image… ${Math.round(percent)}%`
}

export function imageFailureMessage(reason: ImageReadFailure, subject: PdfSubject = 'items', size?: number, maxBytes = IMAGE_MAX_BYTES): string {
  const what = `type or paste the ${subject}`
  switch (reason) {
    case 'unclear':
      return `Couldn't read this clearly — ${what}.`
    case 'unsupported':
      return `This picture could not be opened on this device. Take a screenshot of it and use that, or ${what}.`
    case 'too_big':
      return `This picture is ${size !== undefined ? mb(size) : 'too big'}; the limit is ${mb(maxBytes)}. Take a screenshot of it and use that, or ${what}.`
    case 'not_image':
      return `This file is not a picture. Paste the text, or ${what}.`
    case 'unreadable':
      return `The picture reader could not start (it needs the internet the first time). Try again, or ${what}.`
    case 'aborted':
      return ''
  }
}

const IMAGE_NAME = /\.(?:png|jpe?g|jfif|webp|gif|bmp|heic|heif|avif|tiff?)$/i

/** A file the share sheet, a drop, a paste or a picker handed over that is a picture (some phones send no type). SVG is not. */
export function isImageFile(file: { type?: string; name?: string }): boolean {
  if (file.type) return file.type.startsWith('image/') && file.type !== 'image/svg+xml'
  return IMAGE_NAME.test(file.name ?? '')
}

// ------------------------------------------------------------------------------------------------ preparing the picture

async function decode(blob: Blob): Promise<CanvasImageSource & { width: number; height: number; close?: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(blob)
    } catch {
      // Some browsers open more formats through <img> than through createImageBitmap (Safari and HEIC).
    }
  }
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    return Object.assign(img, { width: img.naturalWidth, height: img.naturalHeight })
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * Evens out the light of a photo, in place on grey values (0 dark, 255 light): each pixel is divided by the paper's
 * brightness around it (the bright end of its block, blocks blended smoothly), so a shadow across the page, a dim corner or
 * a grey photo of a screen becomes white paper with dark text, and a desk round the page turns white as well.
 */
export function flattenLight(grey: Uint8Array, width: number, height: number): void {
  const B = Math.max(24, Math.round(Math.max(width, height) / 40))
  const bw = Math.ceil(width / B)
  const bh = Math.ceil(height / B)
  const bg = new Float32Array(bw * bh)
  const hist = new Uint32Array(256)
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      hist.fill(0)
      let count = 0
      for (let y = by * B; y < Math.min(height, (by + 1) * B); y += 2) {
        for (let x = bx * B; x < Math.min(width, (bx + 1) * B); x += 2) {
          ;(hist[grey[y * width + x] as number] as number)++
          count++
        }
      }
      // The paper: the brightness 90% of the block is at or under (text covers far less than a tenth of a block).
      let seen = 0
      let v = 255
      for (let k = 0; k < 256; k++) {
        seen += hist[k] as number
        if (seen >= 0.9 * count) {
          v = k
          break
        }
      }
      bg[by * bw + bx] = Math.max(24, v)
    }
  }
  // A block filled with text (a dense table cell, a bold heading) reads darker than its paper: when it is much darker than
  // the blocks round it, it takes their middle value. A shadow changes slowly and is left as it is.
  const smooth = new Float32Array(bw * bh)
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const around: number[] = []
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const yy = by + dy
          const xx = bx + dx
          if ((dx || dy) && yy >= 0 && yy < bh && xx >= 0 && xx < bw) around.push(bg[yy * bw + xx] as number)
        }
      }
      around.sort((a, b) => a - b)
      const mid = around[Math.floor(around.length / 2)] ?? 255
      const own = bg[by * bw + bx] as number
      smooth[by * bw + bx] = own < 0.75 * mid ? mid : own
    }
  }
  for (let y = 0; y < height; y++) {
    const fy = Math.min(bh - 1, Math.max(0, (y - B / 2) / B))
    const y0 = Math.floor(fy)
    const y1 = Math.min(bh - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < width; x++) {
      const fx = Math.min(bw - 1, Math.max(0, (x - B / 2) / B))
      const x0 = Math.floor(fx)
      const x1 = Math.min(bw - 1, x0 + 1)
      const tx = fx - x0
      const b =
        (smooth[y0 * bw + x0] as number) * (1 - tx) * (1 - ty) +
        (smooth[y0 * bw + x1] as number) * tx * (1 - ty) +
        (smooth[y1 * bw + x0] as number) * (1 - tx) * ty +
        (smooth[y1 * bw + x1] as number) * tx * ty
      const i = y * width + x
      grey[i] = Math.min(255, Math.round(((grey[i] as number) * 255) / b))
    }
  }
}

/**
 * The slant of the text in a cleaned picture (RGBA, grey), in radians, from the picture itself: the angle at which the dark
 * pixels, counted row by row, stack into the sharpest lines (a projection profile). Used before the first reading, so a photo
 * taken 8 degrees off is read level from the start; the engine reads a slanted page badly or not at all. 0 under 0.5 degrees.
 */
export function estimateSkew(px: Uint8ClampedArray, width: number, height: number): number {
  // About 500 px across is plenty to see the lines.
  const step = Math.max(1, Math.round(Math.max(width, height) / 500))
  const pts: number[] = []
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if ((px[4 * (y * width + x)] as number) < 128) pts.push(x / step, y / step)
    }
  }
  if (pts.length < 200) return 0
  const rows = Math.ceil(Math.hypot(width, height) / step) + 2
  const hist = new Float64Array(2 * rows)
  const score = (a: number) => {
    hist.fill(0)
    const s = Math.sin(a)
    const c = Math.cos(a)
    for (let i = 0; i < pts.length; i += 2) {
      const r = Math.round((pts[i + 1] as number) * c - (pts[i] as number) * s) + rows
      if (r >= 0 && r < hist.length) (hist[r] as number)++
    }
    let sum = 0
    for (let i = 0; i < hist.length; i++) sum += (hist[i] as number) ** 2
    return sum
  }
  const deg = Math.PI / 180
  let best = 0
  let bestScore = score(0)
  for (let d = -12; d <= 12; d += 0.5) {
    const sc = score(d * deg)
    if (sc > bestScore * 1.0001) {
      bestScore = sc
      best = d
    }
  }
  for (let d = best - 0.4; d <= best + 0.4; d += 0.1) {
    const sc = score(d * deg)
    if (sc > bestScore) {
      bestScore = sc
      best = d
    }
  }
  return Math.abs(best) < 0.5 ? 0 : best * deg
}

/**
 * Whitens the dark that reaches the picture's edge (the desk round a photographed page, a phone's black bars): it holds no
 * text, and left in, a big dark wedge makes the engine take the page for a picture. Text never touches the edge. In place.
 */
export function clearBorderDark(grey: Uint8Array, width: number, height: number): void {
  const DARK = 140
  const seen = new Uint8Array(width * height)
  const stack: number[] = []
  const push = (i: number) => {
    if (!seen[i] && (grey[i] as number) < DARK) {
      seen[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < width; x++) {
    push(x)
    push((height - 1) * width + x)
  }
  for (let y = 0; y < height; y++) {
    push(y * width)
    push(y * width + width - 1)
  }
  const filled: number[] = []
  while (stack.length) {
    const i = stack.pop() as number
    filled.push(i)
    const x = i % width
    if (x > 0) push(i - 1)
    if (x < width - 1) push(i + 1)
    if (i >= width) push(i - width)
    if (i < (height - 1) * width) push(i + width)
  }
  // Only a dark area of some size: a table rule that runs to the edge of a tight screenshot stays.
  if (filled.length < 0.01 * width * height) return
  for (const i of filled) grey[i] = 255
}

/**
 * Grey, light background, contrast stretched between the 1st and the 99th percentile. In place. Given the picture's size, the
 * light is evened out first (flattenLight): photos with a shadow, a desk round the page or low contrast.
 */
export function cleanPixels(px: Uint8ClampedArray, width?: number, height?: number): void {
  const n = px.length / 4
  const grey = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    grey[i] = Math.round(0.299 * (px[4 * i] as number) + 0.587 * (px[4 * i + 1] as number) + 0.114 * (px[4 * i + 2] as number))
  }
  const histOf = () => {
    const h = new Uint32Array(256)
    for (let i = 0; i < n; i++) (h[grey[i] as number] as number)++
    return h
  }
  let hist = histOf()
  const percentile = (p: number) => {
    let seen = 0
    for (let v = 0; v < 256; v++) {
      seen += hist[v] as number
      if (seen >= p * n) return v
    }
    return 255
  }
  // Most of a screenshot is its background: a dark one means a dark-mode screen with light text.
  const darkMode = percentile(0.5) < 110
  if (width && height && width * height === n) {
    if (darkMode) for (let i = 0; i < n; i++) grey[i] = 255 - (grey[i] as number)
    flattenLight(grey, width, height)
    clearBorderDark(grey, width, height)
    if (darkMode) for (let i = 0; i < n; i++) grey[i] = 255 - (grey[i] as number)
    hist = histOf()
  }
  const invert = darkMode
  let lo = percentile(0.01)
  let hi = percentile(0.99)
  if (invert) [lo, hi] = [255 - hi, 255 - lo]
  const span = hi - lo > 24 ? hi - lo : 255
  const base = hi - lo > 24 ? lo : 0
  for (let i = 0; i < n; i++) {
    const g = invert ? 255 - (grey[i] as number) : (grey[i] as number)
    const v = Math.max(0, Math.min(255, Math.round(((g - base) * 255) / span)))
    px[4 * i] = v
    px[4 * i + 1] = v
    px[4 * i + 2] = v
    px[4 * i + 3] = 255
  }
}

/** Darker than this (after cleanPixels) can be a rule: a 1 px line scaled up turns grey, so the bar is lower than for ink. */
const RULE_INK = 200
/** A table rule is at most this thick, in px. Thicker dark areas (a filled header, a logo) are left alone. */
const RULE_THICKNESS = 8

/** Pieces of one rule found pixel row by pixel row (or column by column), joined into one box. */
function joinSegments(segs: OcrBox[], across: 'x' | 'y'): OcrBox[] {
  const out: OcrBox[] = []
  const sorted = [...segs].sort((a, b) => (across === 'y' ? a.y0 - b.y0 || a.x0 - b.x0 : a.x0 - b.x0 || a.y0 - b.y0))
  for (const s of sorted) {
    const hit = out.find(o =>
      across === 'y'
        ? s.y0 - o.y1 <= 1 && Math.min(o.x1, s.x1) - Math.max(o.x0, s.x0) > 0.5 * Math.min(o.x1 - o.x0, s.x1 - s.x0)
        : s.x0 - o.x1 <= 1 && Math.min(o.y1, s.y1) - Math.max(o.y0, s.y0) > 0.5 * Math.min(o.y1 - o.y0, s.y1 - s.y0),
    )
    if (hit) {
      hit.x0 = Math.min(hit.x0, s.x0)
      hit.x1 = Math.max(hit.x1, s.x1)
      hit.y0 = Math.min(hit.y0, s.y0)
      hit.y1 = Math.max(hit.y1, s.y1)
    } else out.push({ ...s })
  }
  return out
}

/** The rules a picture had: they mark a table's cells, so the layout uses them after they are wiped (ocrLayout.ts). */
export type Rules = TableRules

/**
 * Wipes the rules of a table (cell borders, underlines) off a cleaned grey picture, in place: a straight dark run longer than
 * any letter stroke and at most a few pixels thick. Left in, they make the engine take a bordered cell for a picture and drop
 * the number in it (the quantity column of an Outlook table). Returns where they were.
 */
export function removeRules(px: Uint8ClampedArray, width: number, height: number): Rules {
  const hSegs: OcrBox[] = []
  const vSegs: OcrBox[] = []
  const min = Math.max(70, Math.round(0.035 * Math.max(width, height)))
  const dark = (x: number, y: number) => (px[4 * (y * width + x)] as number) < RULE_INK
  const white = (x: number, y: number) => {
    const i = 4 * (y * width + x)
    px[i] = 255
    px[i + 1] = 255
    px[i + 2] = 255
  }
  // Each pass collects first, then wipes, so a crossing of two rules is seen by both.
  const wipe: number[] = []
  for (let y = 0; y < height; y++) {
    let x = 0
    while (x < width) {
      if (!dark(x, y)) {
        x++
        continue
      }
      const start = x
      while (x < width && dark(x, y)) x++
      if (x - start < min) continue
      for (let xi = start; xi < x; xi++) {
        let up = 0
        while (up <= RULE_THICKNESS && y - up - 1 >= 0 && dark(xi, y - up - 1)) up++
        let down = 0
        while (down <= RULE_THICKNESS && y + down + 1 < height && dark(xi, y + down + 1)) down++
        if (up + down + 1 <= RULE_THICKNESS) wipe.push(xi, y)
      }
      hSegs.push({ x0: start, x1: x, y0: y, y1: y + 1 })
    }
  }
  for (let x = 0; x < width; x++) {
    let y = 0
    while (y < height) {
      if (!dark(x, y)) {
        y++
        continue
      }
      const start = y
      while (y < height && dark(x, y)) y++
      if (y - start < min) continue
      for (let yi = start; yi < y; yi++) {
        let left = 0
        while (left <= RULE_THICKNESS && x - left - 1 >= 0 && dark(x - left - 1, yi)) left++
        let right = 0
        while (right <= RULE_THICKNESS && x + right + 1 < width && dark(x + right + 1, yi)) right++
        if (left + right + 1 <= RULE_THICKNESS) wipe.push(x, yi)
      }
      vSegs.push({ x0: x, x1: x + 1, y0: start, y1: y })
    }
  }
  for (let i = 0; i < wipe.length; i += 2) white(wipe[i] as number, wipe[i + 1] as number)
  // A thick dark area (a logo, a filled header) gives many long runs too: only thin ones are rules.
  const thin = (b: OcrBox) => Math.min(b.x1 - b.x0, b.y1 - b.y0) <= RULE_THICKNESS
  const rules = { horizontal: joinSegments(hSegs, 'y').filter(thin), vertical: joinSegments(vSegs, 'x').filter(thin) }
  // Then each rule whole, a pixel wider on each side: its grey edges and the dots where two rules cross go too.
  for (const b of [...rules.horizontal, ...rules.vertical]) {
    for (let y = Math.max(0, b.y0 - 1); y < Math.min(height, b.y1 + 1); y++) for (let x = Math.max(0, b.x0 - 1); x < Math.min(width, b.x1 + 1); x++) white(x, y)
  }
  return rules
}

/** The scale factor for a picture whose long edge is `edge` px. */
export function scaleFor(edge: number): number {
  if (edge > IMAGE_TARGET_EDGE) return IMAGE_TARGET_EDGE / edge
  if (edge < IMAGE_MIN_EDGE) return Math.min(2.5, IMAGE_MIN_EDGE / edge)
  return 1
}

/** Decodes, scales and cleans the picture on a canvas. Null when this browser cannot open the format. */
export async function prepareImage(blob: Blob, scaleOverride?: number, angle = 0): Promise<PreparedImage | null> {
  let src: Awaited<ReturnType<typeof decode>>
  try {
    src = await decode(blob)
  } catch {
    return null
  }
  try {
    if (!src.width || !src.height) return null
    const scale = scaleOverride ?? scaleFor(Math.max(src.width, src.height))
    const width = Math.max(1, Math.round(src.width * scale))
    const height = Math.max(1, Math.round(src.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, width, height)
    if (angle) {
      // Turned about the centre, the opposite way to the slant; the corners that leave the canvas hold no text in practice.
      ctx.translate(width / 2, height / 2)
      ctx.rotate(-angle)
      ctx.drawImage(src, -width / 2, -height / 2, width, height)
      ctx.setTransform(1, 0, 0, 1, 0, 0)
    } else ctx.drawImage(src, 0, 0, width, height)
    const data = ctx.getImageData(0, 0, width, height)
    cleanPixels(data.data, width, height)
    const rules = removeRules(data.data, width, height)
    ctx.putImageData(data, 0, 0)
    const crop = (box: OcrBox, by: number) => {
      const c = document.createElement('canvas')
      const bw = box.x1 - box.x0
      const bh = box.y1 - box.y0
      const w = Math.max(1, Math.round(bw * by))
      const h = Math.max(1, Math.round(bh * by))
      // A white margin round the piece: the engine reads a word touching the edge badly.
      c.width = w + 2 * CROP_MARGIN
      c.height = h + 2 * CROP_MARGIN
      const cc = c.getContext('2d')
      if (cc) {
        cc.fillStyle = '#fff'
        cc.fillRect(0, 0, c.width, c.height)
        cc.imageSmoothingQuality = 'high'
        cc.drawImage(canvas, box.x0, box.y0, bw, bh, CROP_MARGIN, CROP_MARGIN, w, h)
      }
      return c
    }
    return { image: canvas, width, height, scale, angle, pixels: data.data, crop, rules }
  } finally {
    src.close?.()
  }
}

// ------------------------------------------------------------------------------------------------ the engine

type Runtime = typeof import('./ocrRuntime')

/** One worker, kept for a minute after a read so a second screenshot does not load the engine again. */
let shared: { worker: Promise<import('./ocrRuntime').OcrWorker>; runtime: Runtime } | null = null
let idle: ReturnType<typeof setTimeout> | null = null
let listener: ((fraction: number) => void) | null = null
const IDLE_MS = 60_000

/** Loading the engine (its first use downloads it) is the first 30% of the bar; reading the words the rest. */
function onLog(m: { status: string; progress: number }): void {
  if (!listener) return
  const p = Math.max(0, Math.min(1, m.progress || 0))
  if (m.status === 'recognizing text') listener(0.3 + 0.7 * p)
  else if (m.status === 'loading tesseract core') listener(0.02 + 0.1 * p)
  else if (m.status === 'initializing tesseract') listener(0.12 + 0.03 * p)
  else if (m.status === 'loading language traineddata') listener(0.15 + 0.12 * p)
  else if (m.status === 'initializing api') listener(0.27 + 0.03 * p)
}

function dropShared(): void {
  const s = shared
  shared = null
  if (idle) clearTimeout(idle)
  idle = null
  if (s) void s.worker.then(w => w.terminate()).catch(() => undefined)
}

/** Ends the shared worker now (tests; a screen being left). */
export function releaseImageReader(): void {
  dropShared()
}

const tesseractEngine: OcrEngine = {
  async read(image, { signal, onProgress, mode = 'page' }) {
    if (idle) clearTimeout(idle)
    idle = null
    if (!shared) {
      const runtime = await import('./ocrRuntime')
      shared = { runtime, worker: runtime.createOcrWorker(onLog) }
    }
    const mine = shared
    listener = onProgress
    let aborted = false
    let stop: (e: unknown) => void = () => undefined
    // Settles only when the read is cancelled: a terminated worker never answers the job it was given.
    const stopped = new Promise<never>((_, reject) => {
      stop = reject
    })
    stopped.catch(() => undefined)
    const onAbort = () => {
      aborted = true
      // A running read cannot be stopped inside the worker: the worker itself goes, and the next read starts a new one.
      if (shared === mine) dropShared()
      stop(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    if (signal?.aborted) onAbort()
    try {
      const worker = await Promise.race([mine.worker, stopped])
      // A page: one column of text of any size (screenshots, emails, tables; it finds lone cells better than full auto).
      // A piece read again: one block (a lone "4" or "EA" is read right as a block, often wrong as a single line).
      const psm = mode === 'line' ? mine.runtime.PSM.SINGLE_BLOCK : mine.runtime.PSM.SINGLE_COLUMN
      await Promise.race([worker.setParameters({ tessedit_pageseg_mode: psm, preserve_interword_spaces: '0' }), stopped])
      const { data } = await Promise.race([worker.recognize(image, {}, { text: false, blocks: true }), stopped])
      const lines: OcrLine[] = []
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            lines.push({
              words: line.words.map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox })),
              bbox: line.bbox,
              baseline: line.baseline,
              rowHeight: line.rowAttributes?.rowHeight ?? null,
            })
          }
        }
      }
      return lines
    } catch (e) {
      // A worker that failed to start is not kept: the next read tries again (the network may be back).
      if (shared === mine && !aborted) dropShared()
      throw e
    } finally {
      signal?.removeEventListener('abort', onAbort)
      if (listener === onProgress) listener = null
      if (shared === mine) idle = setTimeout(dropShared, IDLE_MS)
    }
  },
}

// ------------------------------------------------------------------------------------------------ skipped ink

/** A line read from a crop, moved back to where the crop came from. */
function placeLine(l: OcrLine, box: OcrBox, by: number): OcrLine {
  const m = CROP_MARGIN
  const map = (b: OcrBox): OcrBox => ({
    x0: box.x0 + (b.x0 - m) / by,
    y0: box.y0 + (b.y0 - m) / by,
    x1: box.x0 + (b.x1 - m) / by,
    y1: box.y0 + (b.y1 - m) / by,
  })
  return {
    words: l.words.map(w => ({ ...w, bbox: map(w.bbox) })),
    bbox: map(l.bbox),
    baseline: l.baseline ? map(l.baseline) : null,
    rowHeight: l.rowHeight ? l.rowHeight / by : null,
  }
}

/** Reads again, one by one, the boxes of ink the page reading skipped (ocrRecover.ts), and puts what it reads in place. */
async function recoverSkipped(
  words: OcrLine[],
  image: PreparedImage,
  engine: OcrEngine,
  signal: AbortSignal | undefined,
  onProgress: (fraction: number) => void,
): Promise<OcrLine[]> {
  if (!image.pixels || !image.crop) return words
  const rh = typicalRowHeight(words)
  if (!rh) return words
  const boxes = findMissedBoxes(image.pixels, image.width, image.height, words)
  if (!boxes.length) return words
  // Enlarged so its letters are about 48 px tall: a lone digit read small is easily taken for a letter ("4" as "a").
  const by = Math.max(1, Math.min(4, CROP_ROW_HEIGHT / rh))
  const recovered: OcrLine[] = []
  for (const [i, b] of boxes.entries()) {
    if (signal?.aborted) return words
    const box = padBox(b, Math.round(0.4 * rh), image.width, image.height)
    const cropped = image.crop(box, by)
    const got = await engine.read(cropped, { signal, mode: 'line', onProgress: () => onProgress(i / boxes.length) })
    const replacing = words.some(l => l.words.some(w => w.bbox.x1 > b.x0 && w.bbox.x0 < b.x1 && w.bbox.y1 > b.y0 && w.bbox.y0 < b.y1))
    const bar = replacing ? RECOVERED_CONFIDENCE.replacing : RECOVERED_CONFIDENCE.empty
    for (const l of got) {
      const sure = l.words.filter(w => w.confidence >= bar && /[\p{L}\p{N}]/u.test(w.text))
      if (sure.length) recovered.push(placeLine({ ...l, words: sure }, box, by))
    }
  }
  return mergeRecovered(words, recovered)
}

/** At most this many doubtful words are read again on their own (each takes a few tens of milliseconds). */
const MAX_REREAD = 30
/** A word read less sure than this is read again, enlarged, on its own. */
const DOUBTFUL = 60

/**
 * Reads again, one by one and enlarged, the words the page reading was unsure of (a part number in a photo, a smudged
 * quantity), and keeps the second reading when it is clearly surer and about as long. Per-cell re-reads: the page reading
 * sees each word among its neighbours and table rules; on its own and larger it is often read right.
 */
async function rereadDoubtful(
  words: OcrLine[],
  image: PreparedImage,
  engine: OcrEngine,
  signal: AbortSignal | undefined,
  onProgress: (fraction: number) => void,
): Promise<OcrLine[]> {
  if (!image.crop) return words
  const rh = typicalRowHeight(words)
  if (!rh) return words
  const doubtful = words
    .flatMap(l => l.words)
    .filter(w => w.confidence < DOUBTFUL && /[\p{L}\p{N}]{2}/u.test(w.text) && w.bbox.x1 - w.bbox.x0 > 0.5 * rh)
    .sort((a, b) => a.confidence - b.confidence)
    .slice(0, MAX_REREAD)
  if (!doubtful.length) return words
  const by = Math.max(1, Math.min(4, CROP_ROW_HEIGHT / rh))
  const better = new Map<OcrLine['words'][number], { text: string; confidence: number }>()
  for (const [i, w] of doubtful.entries()) {
    if (signal?.aborted) return words
    const box = padBox(w.bbox, Math.round(0.3 * rh), image.width, image.height)
    const got = await engine.read(image.crop(box, by), { signal, mode: 'line', onProgress: () => onProgress(i / doubtful.length) })
    const read = got.flatMap(l => l.words).filter(x => /[\p{L}\p{N}]/u.test(x.text))
    if (!read.length) continue
    const text = read.map(x => x.text).join(' ')
    const confidence = Math.min(...read.map(x => x.confidence))
    // Surer by a margin, and about the same length (not a neighbour's letters taken in, not half the word).
    if (confidence >= Math.max(w.confidence + 15, DOUBTFUL) && Math.abs(text.length - w.text.length) <= Math.max(2, 0.25 * w.text.length)) better.set(w, { text, confidence })
  }
  if (!better.size) return words
  return words.map(l => ({ ...l, words: l.words.map(w => (better.has(w) ? { ...w, ...(better.get(w) as { text: string; confidence: number }) } : w)) }))
}

// ------------------------------------------------------------------------------------------------ reading

export async function readImageText(file: Blob, opts: ReadImageOptions = {}): Promise<ImageTextResult> {
  const subject = opts.subject ?? 'items'
  const maxBytes = opts.maxBytes ?? IMAGE_MAX_BYTES
  const fail = (reason: ImageReadFailure, size?: number): ImageTextFail => ({
    ok: false,
    reason,
    message: imageFailureMessage(reason, subject, size, maxBytes),
  })
  let shown = -1
  const progress = (fraction: number) => {
    const percent = Math.floor(Math.max(0, Math.min(1, fraction)) * 100)
    if (percent <= shown) return
    shown = percent
    opts.onProgress?.({ percent, message: imageProgressMessage(percent) })
  }

  // A blob with neither a type nor a name (bytes from a paste) is tried: the decoder decides.
  const named = file as Blob & { name?: string }
  if ((named.type || named.name) && !isImageFile(named)) return fail('not_image')
  if (file.size > maxBytes) return fail('too_big', file.size)
  if (opts.signal?.aborted) return fail('aborted')
  progress(0)

  const prepare = opts.prepare ?? prepareImage
  const engine = opts.engine ?? tesseractEngine
  let prepared = await prepare(file).catch(() => null)
  if (opts.signal?.aborted) return fail('aborted')
  if (!prepared) return fail('unsupported')
  // A slanted photo is turned level before the first reading (the engine reads a page 5 or 8 degrees off badly or not at all).
  const tilt = prepared.pixels ? estimateSkew(prepared.pixels, prepared.width, prepared.height) : 0
  if (tilt !== 0) {
    const level = await prepare(file, prepared.scale, tilt).catch(() => null)
    if (opts.signal?.aborted) return fail('aborted')
    if (level) prepared = level
  }
  progress(0.02)

  let words: OcrLine[]
  let used = prepared
  try {
    // The first reading is most of the bar; a second one (letters small, or a slanted photo) is the rest.
    words = await engine.read(prepared.image, { signal: opts.signal, onProgress: f => progress(0.02 + 0.78 * f) })
    if (opts.signal?.aborted) return fail('aborted')
    const rh = typicalRowHeight(words)
    const longEdge = Math.max(prepared.width, prepared.height)
    const factor = rh && rh < MIN_ROW_HEIGHT ? Math.min(TARGET_ROW_HEIGHT / rh, MAX_EDGE / longEdge) : 1
    // A photo of a screen or of paper is seldom level: turned level, its table rules are straight again (and wiped) and its
    // rows line up across the columns.
    const residual = skewAngle(words, rh)
    const angle = tilt + residual
    if (factor > 1.2 || residual !== 0) {
      const larger = await prepare(file, prepared.scale * Math.max(1, factor), angle).catch(() => null)
      if (opts.signal?.aborted) return fail('aborted')
      if (larger) {
        const again = await engine.read(larger.image, { signal: opts.signal, onProgress: f => progress(0.8 + 0.2 * f) })
        if (pageConfidence(again).letters >= 0.8 * pageConfidence(words).letters) {
          words = again
          used = larger
        }
      }
    }
    if (opts.signal?.aborted) return fail('aborted')
    words = await recoverSkipped(words, used, engine, opts.signal, f => progress(0.9 + 0.05 * f))
    if (opts.signal?.aborted) return fail('aborted')
    words = await rereadDoubtful(words, used, engine, opts.signal, f => progress(0.95 + 0.05 * f))
  } catch {
    if (opts.signal?.aborted) return fail('aborted')
    return fail('unreadable')
  }
  if (opts.signal?.aborted) return fail('aborted')

  opts.onWords?.(words, used)
  const { confidence, letters } = pageConfidence(words)
  if (letters < MIN_PAGE_LETTERS || confidence < MIN_PAGE_CONFIDENCE) return fail('unclear')
  const lines = layoutOcr(words, used.rules)
  if (lines.length === 0) return fail('unclear')
  progress(1)
  return {
    ok: true,
    text: linesToText(lines),
    lines,
    confidence: Math.round(confidence),
    tableRows: lines.filter(l => l.kind === 'row').length,
  }
}
