// The words an OCR engine found in a picture, put back into lines and table rows. Pure and framework-free (no tesseract here),
// so it is tested with plain objects (ocrLayout.test.ts).
//
// Each word comes with its box in pixels. They become the same positioned text runs a PDF page gives (pdfLayout.ts), so a
// screenshot of an Excel range or an email table is laid out by the very same row and column logic as a PDF: a table comes
// back as one line per row, cells joined by a tab, the shape parseEnquiry reads. What a picture adds on top of a PDF:
//  - every word has a confidence; noise (a table rule read as "|", an icon read as "©") is dropped, and the page's confidence
//    says whether the reading can be trusted at all. A rule read between two words still marks a cell border;
//  - a line that wrapped in a chat bubble or a narrow email ("... dial qty" / "5") is joined back;
//  - a phone screenshot carries the phone's own chrome: the clock and battery in the status bar, the contact's name over
//    "online", the time and ticks under each chat bubble, "Type a message". Those lines are dropped, so they never reach the
//    parser as items.

import { layoutPages, type LaidLine, type TextRun } from './pdfLayout'

export interface OcrBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

export interface OcrWord {
  text: string
  /** 0 to 100. */
  confidence: number
  bbox: OcrBox
}

export interface OcrLine {
  words: OcrWord[]
  bbox: OcrBox
  /** The baseline, from its left end to its right end. All zero when the engine found none. */
  baseline?: OcrBox | null
  /** The engine's row height in pixels (top of an ascender to the foot of a descender): about one font size. */
  rowHeight?: number | null
}

/** The rules of a table, wiped off the picture before reading (imageText.ts removeRules): its cell borders. */
export interface TableRules {
  horizontal: OcrBox[]
  vertical: OcrBox[]
}

/** A word read with less confidence than this is noise (a rule, an icon, a speck). */
export const MIN_WORD_CONFIDENCE = 30
/** Below this mean confidence (weighted by letters) the reading is not trusted: the person is asked to type the items. */
export const MIN_PAGE_CONFIDENCE = 55
/** Fewer letters than this is no text at all (a photo of a machine, a blank screenshot). */
export const MIN_PAGE_LETTERS = 6

/** Table rules, cell borders and specks that an engine reads as characters. */
const RULE_ONLY = /^[|¦!_=~`'".,:;\-–—[\]{}()<>/\\]+$/
/** Leading and trailing bars of a word that touches a cell border ("|Siemens", "2|"). */
const EDGE_BARS = /^[|¦[\]]+|[|¦[\]]+$/g
const BAR = /^[|¦[\]]+$/

/** A word's text without border bars, or null when it is noise. */
export function cleanWord(w: OcrWord): string | null {
  // A rule's remnant before a word reads as a quote mark ("RELAY): dropped. An inch mark after a size (4") is kept.
  const text = w.text.replace(EDGE_BARS, '').replace(/^["'‘’“”]+(?=[\p{L}\p{N}])/u, '').trim()
  if (text === '') return null
  if (w.confidence < MIN_WORD_CONFIDENCE) return null
  if (RULE_ONLY.test(text) && !(text === '-' && w.confidence >= 80)) return null
  return text
}

/** Where the baseline is under x (the line may be slightly tilted). Falls back to the word's own bottom. */
function baselineAt(line: OcrLine, x: number, fallback: number, size: number): number {
  const b = line.baseline
  if (!b || (b.x0 === 0 && b.x1 === 0 && b.y0 === 0 && b.y1 === 0)) return fallback
  // A "line" running down the page (a column of single digits read as one line) has no usable baseline.
  if (b.x1 === b.x0 || Math.abs(b.y1 - b.y0) > 0.2 * Math.abs(b.x1 - b.x0)) return fallback
  const y = b.y0 + ((b.y1 - b.y0) * (x - b.x0)) / (b.x1 - b.x0)
  // A lone digit read on its own can come with a baseline at its top: the word's own bottom is the better guess then.
  return Math.abs(y - fallback) > 0.5 * size ? fallback : y
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] as number
}

/** The page's usual row height in pixels (lines with real words in them), or null when there are none. */
export function typicalRowHeight(lines: readonly OcrLine[]): number | null {
  return median(
    lines
      .filter(l => (l.rowHeight ?? 0) > 0 && l.words.some(w => w.confidence >= 60 && /\p{L}{2}/u.test(w.text)))
      .map(l => l.rowHeight as number),
  )
}

/**
 * The font size of a line in pixels: its row height, kept near the page's typical one (a rule read as "|" makes a row look
 * taller than its letters), or its box when the engine gave no row height.
 */
function lineSize(line: OcrLine, typical: number | null): number {
  const own = line.rowHeight && line.rowHeight > 0 ? line.rowHeight : Math.max(1, (line.bbox.y1 - line.bbox.y0) * 0.95)
  return typical ? Math.min(own, 1.25 * typical) : own
}

const LIST_MARKER = /^(?:\(?\d{1,3}[.)]|[a-z][.)]|[-•*·–])$/i
const LONE_TAIL = /^(?:\d+(?:[.,]\d+)?|nos?\.?|pcs?\.?|ea|each|sets?|units?|lots?|pairs?|meters?|mtrs?|m|kgs?|ltrs?)$/i

/**
 * The words of a line worth keeping, with their text. A word read unsure but made of letters and digits, between two kept
 * words of the same line ("float type SS316 - 2 Nos"), is kept: dropping it would cut the line in two.
 */
export function lineWords(l: OcrLine): Array<{ word: OcrWord; text: string }> {
  const sure = l.words.map(w => cleanWord(w))
  const out: Array<{ word: OcrWord; text: string }> = []
  l.words.forEach((w, i) => {
    let text = sure[i] ?? null
    if (text === null && w.confidence >= 10 && /[\p{L}\p{N}]{2}/u.test(w.text)) {
      const before = sure.slice(0, i).some(t => t !== null)
      const after = sure.slice(i + 1).some(t => t !== null)
      if (before && after) text = w.text.replace(EDGE_BARS, '').trim()
    }
    if (text) out.push({ word: w, text })
  })
  return out
}

const kept = (l: OcrLine) => lineWords(l).map(k => k.word)

/**
 * A photo of a screen or of paper is seldom level. The page's slant, from the baselines of its longer lines, is turned back
 * (every box moved by the opposite rotation), so a table row lines up again across its columns. Under 0.3 degrees: unchanged.
 */
/** The page's slant in radians, from the baselines of its longer lines; 0 when it is level (under 0.3 degrees). */
export function skewAngle(lines: readonly OcrLine[], typical: number | null = typicalRowHeight(lines)): number {
  const minLength = 6 * (typical ?? 20)
  const angles = lines
    .map(l => l.baseline)
    .filter((b): b is OcrBox => !!b && b.x1 - b.x0 > minLength)
    .map(b => Math.atan2(b.y1 - b.y0, b.x1 - b.x0))
    .filter(a => Math.abs(a) < 0.15)
  const angle = median(angles)
  return angle === null || Math.abs(angle) < (0.3 * Math.PI) / 180 ? 0 : angle
}

export function deskew(lines: readonly OcrLine[], typical: number | null = typicalRowHeight(lines)): OcrLine[] {
  const angle = skewAngle(lines, typical)
  if (angle === 0) return [...lines]
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const turn = (x: number, y: number) => ({ x: x * cos + y * sin, y: -x * sin + y * cos })
  const box = (b: OcrBox): OcrBox => {
    const c = turn((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2)
    const hw = (b.x1 - b.x0) / 2
    const hh = (b.y1 - b.y0) / 2
    return { x0: c.x - hw, x1: c.x + hw, y0: c.y - hh, y1: c.y + hh }
  }
  const ends = (b: OcrBox): OcrBox => {
    const p = turn(b.x0, b.y0)
    const q = turn(b.x1, b.y1)
    return { x0: p.x, y0: p.y, x1: q.x, y1: q.y }
  }
  return lines.map(l => ({ ...l, bbox: box(l.bbox), baseline: l.baseline ? ends(l.baseline) : l.baseline, words: l.words.map(w => ({ ...w, bbox: box(w.bbox) })) }))
}

/**
 * Joins a line that wrapped (in a chat bubble, a narrow email) back onto the line it came from: the first line runs to the
 * right edge of the lines around it, the next line starts at the same left edge right under it, its first word would not have
 * fitted on the first line, and it is a tail ("5", "nos", "and gaskets") rather than a new item ("2. Contactor", "Cable gland").
 */
export function unwrapLines(lines: readonly OcrLine[], typical: number | null = typicalRowHeight(lines)): OcrLine[] {
  const sorted = [...lines].sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)
  const out: OcrLine[] = []
  for (const l of sorted) {
    const prev = out[out.length - 1]
    const words = kept(l)
    const first = words[0]
    const prevWords = prev ? kept(prev) : []
    const prevLast = prevWords[prevWords.length - 1]
    if (prev && first && prevLast && prevWords.length >= 2) {
      const size = lineSize(prev, typical)
      const right = Math.max(
        ...sorted.filter(o => Math.abs(o.bbox.x0 - prev.bbox.x0) < size && Math.abs(o.bbox.y0 - prev.bbox.y0) < 8 * size).map(o => o.bbox.x1),
      )
      const firstText = cleanWord(first) as string
      const under = Math.abs(l.bbox.x0 - prev.bbox.x0) < 0.8 * size && l.bbox.y0 > prev.bbox.y0 && l.bbox.y0 - prev.bbox.y1 < 0.7 * size
      const full = prev.bbox.x1 + 0.3 * size + (first.bbox.x1 - first.bbox.x0) > right - 0.3 * size
      const tail = !LIST_MARKER.test(firstText) && (/^\p{Ll}/u.test(firstText) || (words.length === 1 && LONE_TAIL.test(firstText)))
      const sentenceEnd = /[.:;!?]$/.test(cleanWord(prevLast) ?? '')
      // The same size of letters: a smaller line under a name ("online", a caption) is not its tail.
      const sameSize = !l.rowHeight || !prev.rowHeight || Math.abs(l.rowHeight - prev.rowHeight) <= 0.2 * prev.rowHeight
      if (under && full && tail && sameSize && !sentenceEnd && !isChromeLine(kept(l).map(w => w.text).join(' '))) {
        // The tail goes on the end of the first line, a space after it, on its baseline.
        let x = prev.bbox.x1 + 0.3 * size
        const moved = l.words.map(w => {
          const width = w.bbox.x1 - w.bbox.x0
          const bbox = { x0: x, x1: x + width, y0: prevLast.bbox.y0, y1: prevLast.bbox.y1 }
          x += width + 0.3 * size
          return { ...w, bbox }
        })
        out[out.length - 1] = { ...prev, words: [...prev.words, ...moved], bbox: { ...prev.bbox, x1: x - 0.3 * size } }
        continue
      }
    }
    out.push(l)
  }
  return out
}

/**
 * The words of the page as positioned text runs (pdfLayout.ts TextRun), `size` being the line's font size in pixels. A rule
 * read as "|" between two words, or a wiped table rule (`rules`), is a cell border: the word before it is shortened so the gap
 * reads as a new cell. Words between the same two horizontal rules are one table row: they get one baseline.
 */
export function wordsToRuns(lines: readonly OcrLine[], typical: number | null = typicalRowHeight(lines), rules?: TableRules): TextRun[] {
  const runs: TextRun[] = []
  for (const line of lines) {
    const size = lineSize(line, typical)
    let last: TextRun | null = null
    const keep = new Map(lineWords(line).map(k => [k.word, k.text]))
    for (const w of line.words) {
      const text = keep.get(w) ?? null
      if (text === null) {
        if (last && BAR.test(w.text.trim()) && w.confidence >= 50) last.w = Math.max(1, Math.min(last.w, w.bbox.x0 - last.x - 1.1 * size))
        continue
      }
      const cx = (w.bbox.x0 + w.bbox.x1) / 2
      last = { str: text, x: w.bbox.x0, y: baselineAt(line, cx, w.bbox.y1, size), w: Math.max(1, w.bbox.x1 - w.bbox.x0), size }
      runs.push(last)
    }
  }
  if (rules) applyRules(runs, rules)
  return runs
}

const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0)

/** Cell borders and row bands from the wiped rules of a table (see wordsToRuns). In place. */
function applyRules(runs: TextRun[], rules: TableRules): void {
  for (const r of runs) {
    const end = r.x + r.w
    const border = rules.vertical.find(
      v => v.x0 >= end - 0.3 * r.size && v.x0 <= end + 2.5 * r.size && overlap(v.y0, v.y1, r.y - 0.8 * r.size, r.y) >= 0.5 * r.size,
    )
    if (border) r.w = Math.max(1, Math.min(r.w, border.x0 - r.x - 1.1 * r.size))
  }
  const bands = new Map<string, TextRun[]>()
  for (const r of runs) {
    const cx = r.x + r.w / 2
    const across = rules.horizontal.filter(h => h.x0 <= cx && h.x1 >= cx)
    const above = Math.max(...across.filter(h => h.y1 <= r.y - 0.5 * r.size).map(h => h.y1))
    const below = Math.min(...across.filter(h => h.y0 >= r.y - 0.2 * r.size).map(h => h.y0))
    if (!Number.isFinite(above) || !Number.isFinite(below) || below - above > 3 * r.size) continue
    const key = `${above}:${below}`
    bands.set(key, [...(bands.get(key) ?? []), r])
  }
  for (const band of bands.values()) {
    const y = median(band.map(r => r.y)) as number
    for (const r of band) r.y = y
  }
}

/** Mean confidence of the kept words, weighted by their letters; and how many letters there are. */
export function pageConfidence(lines: readonly OcrLine[]): { confidence: number; letters: number } {
  let sum = 0
  let letters = 0
  for (const l of lines) {
    for (const w of kept(l)) {
      const n = w.text.replace(/[^\p{L}\p{N}]/gu, '').length
      sum += w.confidence * n
      letters += n
    }
  }
  return { confidence: letters ? sum / letters : 0, letters }
}

// ------------------------------------------------------------------------------------------------ phone chrome

const TIME = String.raw`\d{1,2}[:.]\d{2}(?:\s*[ap]\.?\s?m\.?)?`
/** A line that is only a clock time, maybe with the chat ticks or an "edited" mark read as letters ("10:42 am VV", "9:41"). */
const TIME_ONLY = new RegExp(String.raw`^(?:edited\s+)?${TIME}(?:\s+\S{1,3})?$`, 'i')
/** A status bar: a clock, signal, network and battery read as text ("9:41 4G 87%", "LTE 56%"). */
const STATUS_BAR = new RegExp(String.raw`^(?:${TIME}\s*)?(?:(?:[2-5]G\+?|LTE\+?|VoLTE|wi-?fi|\d{1,3}\s?%)\s*){1,4}\S{0,2}$`, 'i')
/** Under a chat's contact name: the line above it is the contact, not the customer's words. */
const PRESENCE = /^(?:online|typing\.*|last seen.*|(?:click|tap) here for (?:contact|group) info)$/i
/** The chat app's own words, not the customer's. */
const CHAT_CHROME =
  /^(?:type a message|message|reply|forward(?:ed)?|today|yesterday|messages and calls are end-to-end encrypted.*|this message was deleted|you deleted this message|read more|reply all|\d+\s+unread messages?)$/i

/** True for a line that is the phone's or the chat app's, not the sender's. */
export function isChromeLine(text: string): boolean {
  const t = text.trim()
  return TIME_ONLY.test(t) || STATUS_BAR.test(t) || PRESENCE.test(t) || CHAT_CHROME.test(t)
}

/**
 * Lays out the words of one picture: reading-order lines, table rows with cells joined by a tab, wrapped lines joined, phone
 * chrome removed.
 */
export function layoutOcr(lines: readonly OcrLine[], rules?: TableRules): LaidLine[] {
  const typical = typicalRowHeight(lines)
  // The rules were found on the picture as it was: they only line up with the words when the page needed no turning.
  const level = skewAngle(lines, typical) === 0
  const laid = layoutPages([wordsToRuns(unwrapLines(deskew(lines, typical), typical), typical, level ? rules : undefined)])
  const kept: LaidLine[] = []
  for (const l of laid) {
    if (l.kind === 'text' && PRESENCE.test(l.text.trim())) {
      // The contact's name is the text line just above "online" / "last seen ...".
      while (kept.length && (kept[kept.length - 1] as LaidLine).text === '') kept.pop()
      if (kept.length && (kept[kept.length - 1] as LaidLine).kind === 'text') kept.pop()
      continue
    }
    if (l.kind === 'text' && isChromeLine(l.text)) continue
    kept.push(l)
  }
  // A spreadsheet's column letters (A, B, C ... over the sheet) come out as a run of one- or two-letter lines.
  const letter = (l: LaidLine) => l.kind === 'text' && /^[A-Za-z]{1,2}$/.test(l.text.trim())
  const sheetless = kept.filter((l, i) => {
    if (!letter(l)) return true
    let a = i
    while (a > 0 && letter(kept[a - 1] as LaidLine)) a--
    let b = i
    while (b < kept.length - 1 && letter(kept[b + 1] as LaidLine)) b++
    return b - a + 1 < 3
  })
  // Removing chrome can leave two blank lines in a row, or one at an end.
  const out: LaidLine[] = []
  for (const l of sheetless) {
    const prev = out[out.length - 1]
    if (l.text === '' && (!prev || prev.text === '')) continue
    out.push(l)
  }
  while (out.length && (out[out.length - 1] as LaidLine).text === '') out.pop()
  return out
}
