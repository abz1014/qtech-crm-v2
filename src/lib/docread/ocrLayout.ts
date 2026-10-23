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

import { isUnitWord } from './cellTable'
import { isHeaderCell, layoutPages, type LaidLine, type TextRun } from './pdfLayout'

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
  return fixOcrWord(text)
}

/** A part or model number: letters and digits mixed, maybe with dashes or slashes ("6ES7717-3EX68-0LC0", "P098A8460"). */
const CODE = /^(?=[A-Za-z0-9/.-]*\d[A-Za-z0-9/.-]*\d)(?=[A-Za-z0-9/.-]*[A-Za-z])[A-Za-z0-9][A-Za-z0-9/.-]{3,}$/
/** Sizes and ratings that look like codes; their letters are never digits ("24VDC", "100MM", "PT100"). */
const SPEC = /^(?:\d+(?:\.\d+)?(?:[xX]\d+)*(?:V|VDC|VAC|A|KA|KW|W|MM|M|BAR|MA|UF|HZ|RPM|PPR|DI|DO|CO|I\/O)?|PT\d+|DN\d+|PN\d+|M\d+|PG\d+(?:\.\d+)?|IP\d+|IEC\d+|ISO\d+|[0-9.-]+(?:BAR|MA|MM|C))$/i

/**
 * Letters and digits the engine takes for each other, put right where the domain says which it must be: inside a part number
 * an O or an I next to a digit is a 0 or a 1 (catalogues avoid O and I there for this reason), "INO+INC" is the contact
 * arrangement 1NO+1NC, "141/0" is "14I/O", a company's "Lid" is "Ltd", "§" is S and "«" is the + of a phone number.
 */
export function fixOcrWord(text: string): string {
  let t = text.replace(/§/g, 'S').replace(/^«(?=\d)/, '+')
  // Contacts: 1NO, 1NC, 2NO+1NC.
  t = t.replace(/(^|[^A-Za-z0-9])[Il|T]N([OC])(?=$|[^A-Za-z])/g, '$11N$2').replace(/(\d)[Il|]N([OC])\b/g, '$1N$2')
  // I/O count: "141/0" or "14 1/0" for 14I/O.
  t = t.replace(/(\d)1\/0(?![0-9])/g, '$1I/O').replace(/^1\/0$/, 'I/O')
  if (/^L[il1]d\.?$/.test(t)) t = t.replace(/^L[il1]d/, 'Ltd')
  // Sizes and ratings: DN50, NH00, SS316, M12.
  t = t.replace(/^(DN|PN|NH)([0-9OSs]{2,4})(?=$|[^A-Za-z0-9])/, (_, a: string, b: string) => a + b.replace(/[Oo]/g, '0').replace(/[Ss]/g, '5'))
  t = t.replace(/^(?:S5|5S|\$5|\$S|55)(3\d\d)/, 'SS$1')
  if (/^Mode[!|1l]$/.test(t)) t = 'Model'
  // Unit words with one letter misread: "Picces", "Pleces", "MIR", "Nas".
  const unit = /^(P[il1][ec]c[ec]s|P[il1]eces|Pi[ec]ccs)$/.test(t) ? 'Pieces' : /^(?:P[il1][ec]c[ec]s|P[il1]eces)$/i.test(t) ? 'pieces' : /^M[I1l]R(S?)$/.test(t) ? `MTR${t.endsWith('S') ? 'S' : ''}` : null
  if (unit) t = unit
  // A date with the month in letters ("19-OCT-26", "0CT" read for OCT): the month, not a code.
  t = t.replace(/^(\d{1,2}[-./]?)0(CT)([-./]?\d{2,4}[.,]?)$/i, '$1O$2$3')
  const date = /^\d{1,2}[-./]?(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*[-./]?\d{2,4}[.,]?$/i.test(t)
  if (CODE.test(t) && !SPEC.test(t) && !date) {
    const chars = [...t]
    const isDigit = (c: string | undefined) => c !== undefined && /\d/.test(c)
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i] as string
      if (!/[OoIl]/.test(c)) continue
      // Next to a digit, or at the edge of a dash-separated part ("-OETO", "UMY4HO"): a digit.
      const edge = chars[i - 1] === '-' || chars[i + 1] === '-' || i === chars.length - 1
      // A capital O or I inside a part number (not its first letter): catalogues leave them out for this very reason.
      // (Only in a dash-separated part that has digits itself: "QUO-2026725" keeps its O.)
      const segStart = Math.max(t.lastIndexOf('-', i), t.lastIndexOf('/', i)) + 1
      const segEnd = [t.indexOf('-', i), t.indexOf('/', i)].filter(x => x >= 0).reduce((a, b) => Math.min(a, b), t.length)
      const inside = i > 0 && /[OI]/.test(c) && (t.match(/\d/g) ?? []).length >= 3 && /\d/.test(t.slice(segStart, segEnd))
      if (isDigit(chars[i - 1]) || isDigit(chars[i + 1]) || inside || (edge && ((segStart > 0 && segEnd - segStart >= 4) || /\d/.test(t.slice(segStart, segEnd))) && /[Oo]/.test(c) && (t.match(/\d/g) ?? []).length >= 3)) chars[i] = /[Oo]/.test(c) ? '0' : '1'
    }
    t = chars.join('')
  }
  return t
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

/** Three or more letters, digits and the punctuation of a part description, at least two of them letters. */
const PLAUSIBLE = /^(?=(?:[^\p{L}]*\p{L}){2})[\p{L}\p{N}][\p{L}\p{N},;:./()+&'-]{2,}$/u
const LIST_MARKER =/^(?:\(?\d{1,3}[.)]|[a-z][.)]|[-•*·–+»]|[il]?tem)$/i
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
    // The engine can give a well-read word no confidence at all when it is unusual ("VALVE,BALL;FLANGED" in an ERP row): a
    // word shaped like a word or a code, on a line with sure words, is kept.
    const plausible = PLAUSIBLE.test(w.text.replace(EDGE_BARS, '').trim())
    if (text === null && (w.confidence >= 10 || plausible) && /[\p{L}\p{N}]{2}/u.test(w.text)) {
      const before = sure.slice(0, i).some(t => t !== null)
      const after = sure.slice(i + 1).some(t => t !== null)
      if ((before && after) || (plausible && (before || after))) text = fixOcrWord(w.text.replace(EDGE_BARS, '').trim())
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
      // A tail: lower case, a lone quantity or unit, a size or a part number ("150mm with head", "PMC72-EWG6B2 - 03 Each"),
      // or anything after a line that stops on a word that needs more ("..., Model" / "729B0969 Qty 2").
      const prevText = prevWords.map(w => cleanWord(w) ?? '').join(' ')
      const dangling = /(?:[/:-]|\b(?:model|type|qty\.?|quantity|p\/n|part\s*no\.?|make|brand|size|range|code))$/i.test(prevText)
      const sizeOrCode = /^\d+(?:[.,]\d+)?[A-Za-z"]/.test(firstText) || (/^[A-Z0-9][A-Z0-9/.-]{3,}[,.]?$/.test(firstText) && /\d/.test(firstText) && /[A-Z]/.test(firstText))
      // A line that already ends with its quantity ("... pvc 100 m") is complete: what follows is a new item.
      const complete = /\d+(?:[.,]\d+)?\s*(?:nos?|no's|pcs?|pieces?|sets?|ea|each|m|mtrs?|meters?|kgs?|rolls?|box(?:es)?|pairs?|lots?|units?|numbers?)\.?\s*(?:bhi|urgent|chahiye|bhej\s+dein)?$/i.test(prevText)
      const tail = !LIST_MARKER.test(firstText) && !(complete && !dangling) && (/^\p{Ll}/u.test(firstText) || (words.length === 1 && LONE_TAIL.test(firstText)) || dangling || sizeOrCode)
      const sentenceEnd = /[.:;!?]$/.test(cleanWord(prevLast) ?? '') && !/\bqty\.?:$|quantity:$/i.test(cleanWord(prevLast) ?? '')
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
    // The line's own baseline from its words' bottoms, for when the engine's is unusable: a robust slope (Theil-Sen) and the
    // lower third of the bottoms (letters with a descender, "y" or ",", sit lower), so one line's words keep one baseline.
    const pts = line.words.filter(w => keep.has(w)).map(w => ({ x: (w.bbox.x0 + w.bbox.x1) / 2, y: w.bbox.y1 }))
    let fit: ((x: number) => number) | null = null
    if (pts.length >= 3) {
      const slopes: number[] = []
      for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (Math.abs(pts[j]!.x - pts[i]!.x) > size) slopes.push((pts[j]!.y - pts[i]!.y) / (pts[j]!.x - pts[i]!.x))
      const slope = Math.max(-0.1, Math.min(0.1, median(slopes) ?? 0))
      const icpt = pts.map(p => p.y - slope * p.x).sort((a, b) => a - b)
      const base = icpt[Math.floor((icpt.length - 1) / 3)] as number
      fit = x => base + slope * x
    }
    for (const w of line.words) {
      const text = keep.get(w) ?? null
      if (text === null) {
        if (last && BAR.test(w.text.trim()) && w.confidence >= 50) last.w = Math.max(1, Math.min(last.w, w.bbox.x0 - last.x - 1.1 * size))
        continue
      }
      const cx = (w.bbox.x0 + w.bbox.x1) / 2
      // A word whose bottom is far from the line's fitted baseline (a lone digit, a mark) keeps its own place.
      const fitted = fit && Math.abs(fit(cx) - w.bbox.y1) < 0.5 * size ? fit(cx) : null
      last = { str: text, x: w.bbox.x0, y: fitted ?? baselineAt(line, cx, w.bbox.y1, size), w: Math.max(1, w.bbox.x1 - w.bbox.x0), size }
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
    if (!Number.isFinite(above) || !Number.isFinite(below) || below - above > 2 * r.size) continue
    const key = `${above}:${below}`
    bands.set(key, [...(bands.get(key) ?? []), r])
  }
  for (const band of bands.values()) {
    // A band holding two lines of a wrapped cell (tight line spacing) is not one line: its words keep their own baselines,
    // or the two lines' words would be read in one, interleaved ("CYLINDER83DWITHTEST...").
    // (Two words one above the other: their x ranges overlap and their baselines differ.)
    const stacked = band.some(a => band.some(b => a !== b && Math.abs(a.y - b.y) > 0.4 * a.size && overlap(a.x, a.x + a.w, b.x, b.x + b.w) > 0))
    if (stacked) continue
    const y = median(band.map(r => r.y)) as number
    for (const r of band) r.y = y
  }
}

// ------------------------------------------------------------------------------------------------ ruled grids

/** One border of a ruled grid: where it lies (y for a row border, x for a column border) and how much of the grid it spans. */
interface Divider {
  pos: number
  cover: number
  from: number
  to: number
}

/** The rules lying on one line (within `tol` of each other, a double rule being one) joined into borders, with what they span. */
function dividersOf(boxes: readonly OcrBox[], across: 'x' | 'y', tol: number): Divider[] {
  const at = (b: OcrBox) => (across === 'y' ? (b.y0 + b.y1) / 2 : (b.x0 + b.x1) / 2)
  const sorted = [...boxes].sort((a, b) => at(a) - at(b))
  const groups: OcrBox[][] = []
  let lastPos = -Infinity
  for (const b of sorted) {
    const p = at(b)
    if (groups.length && p - lastPos <= tol) (groups[groups.length - 1] as OcrBox[]).push(b)
    else groups.push([b])
    lastPos = p
  }
  return groups.map(g => {
    const spans = g.map(b => (across === 'y' ? [b.x0, b.x1] : [b.y0, b.y1]) as [number, number]).sort((a, b) => a[0] - b[0])
    let cover = 0
    let cur = spans[0] as [number, number]
    for (const s of spans.slice(1)) {
      // A rule broken where it crosses another (a few px) is one rule.
      if (s[0] - cur[1] <= Math.max(10, 0.4 * tol)) cur = [cur[0], Math.max(cur[1], s[1])]
      else {
        cover += cur[1] - cur[0]
        cur = s
      }
    }
    cover += cur[1] - cur[0]
    return { pos: g.reduce((a, b) => a + at(b), 0) / g.length, cover, from: Math.min(...spans.map(s => s[0])), to: Math.max(...spans.map(s => s[1])) }
  })
}

export interface RuledGrid {
  /** Row borders (y), top to bottom. */
  rows: number[]
  /** Column borders (x), left to right. */
  cols: number[]
  top: number
  bottom: number
}

/**
 * The cell grids of the ruled tables of a picture (a screenshot of an Excel range, a Word table, an Outlook table with borders, a
 * printed form with several tables), one per table: the borders that run across most of the table, as they were found on the picture
 * (imageText.ts removeRules). A table is a stretch of column borders that run on without a gap, so two tables one under the other
 * (a form's item table and its signature table, the page break between) are two. Nothing for rules that are no grid (an underline,
 * one divider, a box round a paragraph): at least two column borders and two row borders are needed.
 */
export function ruledGrids(rules: TableRules, typical: number | null): RuledGrid[] {
  const size = typical ?? 24
  const tol = Math.max(6, 0.5 * size)
  const keep = (ds: Divider[]) => {
    const widest = Math.max(0, ...ds.map(d => d.cover))
    return ds.filter(d => d.cover >= 0.6 * widest)
  }
  const spans: Array<[number, number]> = []
  for (const v of [...rules.vertical].sort((a, b) => a.y0 - b.y0)) {
    const last = spans[spans.length - 1]
    if (last && v.y0 - last[1] <= 1.5 * size) last[1] = Math.max(last[1], v.y1)
    else spans.push([v.y0, v.y1])
  }
  const out: RuledGrid[] = []
  for (const [y0, y1] of spans) {
    const cols = keep(dividersOf(rules.vertical.filter(v => v.y1 > y0 && v.y0 < y1), 'x', tol))
    const rows = keep(dividersOf(rules.horizontal.filter(h => (h.y0 + h.y1) / 2 >= y0 - tol && (h.y0 + h.y1) / 2 <= y1 + tol), 'y', tol))
    // (Two column borders only are the frame of a page or a box, not a table of columns.)
    if (cols.length < 3 || rows.length < 2) continue
    // The grid reaches from the top of its column borders to the bottom of them.
    out.push({ rows: rows.map(r => r.pos), cols: cols.map(c => c.pos), top: Math.min(...cols.map(c => c.from), ...rows.map(r => r.pos)), bottom: Math.max(...cols.map(c => c.to), ...rows.map(r => r.pos)) })
  }
  return out
}

/** A cell's words in reading order: its lines top to bottom, each left to right. A part number cut at a hyphen is rejoined. */
function cellText(words: ReadonlyArray<{ text: string; box: OcrBox }>, size: number): string {
  return joinLines(cellLines(words, size))
}

/** A cell's lines, top to bottom, each its words left to right. */
function cellLines(words: ReadonlyArray<{ text: string; box: OcrBox }>, size: number): string[] {
  const sorted = [...words].sort((a, b) => a.box.y0 + a.box.y1 - (b.box.y0 + b.box.y1))
  const rowsOfWords: Array<{ y: number; words: typeof sorted }> = []
  for (const w of sorted) {
    const y = (w.box.y0 + w.box.y1) / 2
    const last = rowsOfWords[rowsOfWords.length - 1]
    if (last && Math.abs(y - last.y) <= 0.6 * size) {
      last.words.push(w)
      last.y = (last.y * (last.words.length - 1) + y) / last.words.length
    } else rowsOfWords.push({ y, words: [w] })
  }
  return rowsOfWords.map(row =>
    row.words
      .sort((a, b) => a.box.x0 - b.box.x0)
      .map(w => w.text)
      .join(' '),
  )
}

function joinLines(lines: readonly string[]): string {
  let out = ''
  for (const line of lines) {
    // "FX2N-" then "128MR.": a part number cut at its hyphen at the end of a line (a hyphen with a space before it is a dash).
    out = out === '' ? line : /\S-$/.test(out) && /^[A-Za-z0-9]/.test(line) && !/\s-$/.test(out) ? out + line : out + ' ' + line
  }
  return out
}

type Cells = Map<string, Array<{ text: string; box: OcrBox }>>

/**
 * The table rows of the ruled grids, one per row of a grid: every word goes to the cell its centre lies in, so a description that
 * wraps over two or three lines stays in its cell and the neighbouring cells' lines (the same pixel rows) are not read across it.
 * A row's cells are in column order, empty cells kept so they line up with the header. The words outside the grids come back apart,
 * still as lines, for the ordinary layout: the result is the page from top to bottom, those lines and the rows of each grid in turn.
 * Null when the picture holds no usable grid.
 */
function gridRows(lines: readonly OcrLine[], grids: readonly RuledGrid[], typical: number | null): Array<{ lines: OcrLine[] } | { rows: LaidLine[] }> | null {
  const size = typical ?? 24
  const slack = 0.4 * size
  const tableOf = (cy: number) => grids.findIndex(g => cy >= g.top - slack && cy <= g.bottom + slack)
  const cells: Cells[] = grids.map(() => new Map())
  const between: OcrLine[][] = Array.from({ length: grids.length + 1 }, () => [])
  const inside = grids.map(() => 0)
  let outside = 0
  for (const l of lines) {
    const out: OcrWord[][] = Array.from({ length: grids.length + 1 }, () => [])
    for (const k of lineWords(l)) {
      const w = k.word
      const cx = (w.bbox.x0 + w.bbox.x1) / 2
      const cy = (w.bbox.y0 + w.bbox.y1) / 2
      const t = tableOf(cy)
      if (t >= 0) {
        const g = grids[t] as RuledGrid
        const key = `${g.rows.filter(y => y < cy).length}:${g.cols.filter(x => x < cx).length}`
        const m = cells[t] as Cells
        m.set(key, [...(m.get(key) ?? []), { text: k.text, box: w.bbox }])
        inside[t] = (inside[t] as number) + 1
      } else {
        // Which stretch of the page between the tables it lies in.
        ;(out[grids.filter(g => g.bottom + slack < cy).length] as OcrWord[]).push(w)
        outside++
      }
    }
    out.forEach((ws, i) => ws.length && (between[i] as OcrLine[]).push({ ...l, words: ws }))
  }
  // Grids that hold few of the picture's words are boxes round something else, not tables.
  const total = inside.reduce((a, b) => a + b, 0)
  if (total < 4 || total < outside) return null
  const tables = grids.map((_, i) => ((inside[i] as number) >= 4 ? tableRows(cells[i] as Cells, size) : null))
  // A grid that is no table (its words are read as the rest of the page is) is left out, and the page divided again without it.
  if (tables.some(t => !t)) {
    const valid = grids.filter((_, i) => tables[i])
    return valid.length ? gridRows(lines, valid, typical) : null
  }
  const parts: Array<{ lines: OcrLine[] } | { rows: LaidLine[] }> = []
  for (let i = 0; i <= grids.length; i++) {
    parts.push({ lines: between[i] as OcrLine[] })
    if (i < grids.length) parts.push({ rows: tables[i] as LaidLine[] })
  }
  return parts
}

/** The rows of one table from its cells (keyed "row:column" by the grid's borders), or null when it is no table. */
function tableRows(cell: Cells, size: number): LaidLine[] | null {
  splitHeaderBand(cell, size)
  const used = [...cell.keys()].map(k => k.split(':').map(Number) as [number, number])
  const rowIds = [...new Set(used.map(u => u[0]))].sort((a, b) => a - b)
  const colIds = [...new Set(used.map(u => u[1]))].sort((a, b) => a - b)
  if (rowIds.length < 2 || colIds.length < 2) return null
  // Rows the rules did not separate (a table with its row rules faint or missing) come out as one band holding a column of serial
  // numbers or quantities, a line each: no table cell wraps a number onto three lines. Such a grid is not trusted.
  for (const r of rowIds) {
    for (const c of colIds) {
      const lines = cellLines(cell.get(`${r}:${c}`) ?? [], size)
      if (lines.length >= 3 && lines.every(l => /^(?:\d[\d.,]*|[A-Za-z]{1,6}\.?)$/.test(l))) return null
    }
  }
  const fixCell = (c: string) => c.split(' ').map(fixOcrWord).join(' ')
  const rows: LaidLine[] = []
  for (const r of rowIds) {
    const cells = repairHeader(colIds.map(c => fixCell(cellText(cell.get(`${r}:${c}`) ?? [], size))))
    while (cells.length > 1 && cells[cells.length - 1] === '') cells.pop()
    const filled = cells.filter(Boolean)
    if (filled.length === 0) continue
    const header = filled.length >= 2 && !filled.some(c => /\d{2,}/.test(c.replace(/\(.*?\)/g, ''))) && filled.filter(isHeaderCell).length >= Math.ceil(filled.length * 0.6)
    // One filled cell is a heading or a stray line of the sheet, not a table row.
    const kind = header ? 'header' : filled.length >= 2 ? 'row' : 'text'
    rows.push({ cells, kind, page: 1, text: kind === 'text' ? (filled[0] as string) : cells.join('\t') })
  }
  snapUnitColumn(rows)
  return rows
}

/**
 * A heading row on a filled band (grey, blue) has no rule of its own under it that can be told from the fill: its words come in the
 * first row of the grid with the first row of the table. When the first line of the first band is made of heading words only, and
 * more lines follow it, it is a row of its own (the band is cut at the line: row -1).
 */
function splitHeaderBand(cell: Cells, size: number): void {
  const keys = [...cell.keys()]
  const first = Math.min(...keys.map(k => Number(k.split(':')[0])))
  const inBand = keys.filter(k => Number(k.split(':')[0]) === first)
  const all = inBand.flatMap(k => (cell.get(k) ?? []).map(w => ({ k, w, y: (w.box.y0 + w.box.y1) / 2 })))
  if (all.length < 4) return
  const top = Math.min(...all.map(x => x.y))
  const head = all.filter(x => Math.abs(x.y - top) <= 0.6 * size)
  const rest = all.filter(x => !head.includes(x))
  if (!rest.length || Math.min(...rest.map(x => x.y)) - top < 0.9 * size) return
  const cols = [...new Set(head.map(x => x.k))]
  if (cols.length < 2) return
  const texts = cols.map(k => head.filter(x => x.k === k).sort((u, v) => u.w.box.x0 - v.w.box.x0).map(x => x.w.text).join(' '))
  const repaired = repairHeader(texts.length >= 3 ? texts : [...texts, '', ''])
  if (!repaired.filter(Boolean).every(t => isHeaderCell(t))) return
  for (const x of head) {
    const [, c] = x.k.split(':')
    const nk = `-1:${c}`
    cell.set(x.k, (cell.get(x.k) ?? []).filter(w => w !== x.w))
    cell.set(nk, [...(cell.get(nk) ?? []), x.w])
  }
}

/** Header words a table reader needs to find its columns by, as a heading is written. */
const HEADINGS = ['QTY', 'QUANTITY', 'UOM', 'UNIT', 'DESCRIPTION', 'PARTICULARS', 'MATERIAL', 'SPECIFICATION']

/**
 * A heading row the engine misread by a letter ("Qry" for "Qty", "Uom" for "UOM", "Descriptlon"): each word of it that is one letter
 * off a heading a table has is put right, so the table's columns are found. Only a row of three or more cells that already holds
 * a heading word and no number, and only a single word of letters.
 */
export function repairHeader(cells: string[]): string[] {
  const filled = cells.filter(Boolean)
  if (filled.length < 3 || filled.some(c => /\d/.test(c)) || !filled.some(isHeaderCell)) return cells
  return cells.map(c => {
    if (!/^[A-Za-z]{2,13}$/.test(c) || isHeaderCell(c)) return c
    const hit = HEADINGS.find(h => Math.abs(h.length - c.length) <= 1 && editDistance(c.toUpperCase(), h) <= (h.length > 5 ? 2 : 1))
    if (!hit) return c
    return c === c.toUpperCase() ? hit : hit.charAt(0) + hit.slice(1).toLowerCase()
  })
}

/** The number of single-letter edits (insert, delete, change) between two words. */
function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min((prev[j] as number) + 1, (cur[j - 1] as number) + 1, (prev[j - 1] as number) + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return prev[b.length] as number
}

/**
 * A unit column of a grid (most of its cells are units: "PCS", "Nos") whose cell the engine misread ("PG" for "PCS") takes the
 * unit the column says: the unit it is nearest to (two letters off at most), written the way the column writes it. A cell that
 * is nothing like a unit of the column is left alone. In place.
 */
export function snapUnitColumn(rows: LaidLine[]): void {
  const body = rows.filter(r => r.kind === 'row')
  const width = Math.max(0, ...body.map(r => r.cells.length))
  for (let c = 0; c < width; c++) {
    const cells = body.map(r => r.cells[c] ?? '').filter(Boolean)
    const units = cells.filter(isUnitWord)
    if (cells.length < 4 || units.length < 0.6 * cells.length) continue
    const seen = new Map<string, number>()
    for (const u of units) seen.set(u, (seen.get(u) ?? 0) + 1)
    for (const r of body) {
      const t = r.cells[c]
      if (!t || isUnitWord(t) || !/^[\p{L}]{1,5}\.?$/u.test(t)) continue
      const caps = t === t.toUpperCase()
      const near = [...seen.entries()]
        .map(([u, n]) => ({ u, n, d: editDistance(t.toLowerCase(), u.toLowerCase()), same: caps === (u === u.toUpperCase()) }))
        .filter(x => x.d <= 2 && x.d < Math.max(t.length, x.u.length))
        .sort((x, y) => x.d - y.d || Number(y.same) - Number(x.same) || y.n - x.n)[0]
      if (!near) continue
      r.cells[c] = near.u
      r.text = r.cells.join('\t')
    }
  }
}

/** Mean confidence of the kept words, weighted by their letters; and how many letters there are. */
export function pageConfidence(lines: readonly OcrLine[]): { confidence: number; letters: number } {
  let sum = 0
  let letters = 0
  for (const l of lines) {
    for (const w of kept(l).filter(x => x.confidence >= MIN_WORD_CONFIDENCE)) {
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
  // A part number broken over two lines of a cell is whole again only now ("PMC33-" / "UMY4HO"): its words are fixed again.
  const fixCell = (c: string) => c.split(' ').map(fixOcrWord).join(' ')
  const plain = (ls: readonly OcrLine[]): LaidLine[] =>
    ls.length === 0
      ? []
      : layoutPages([wordsToRuns(unwrapLines(deskew(ls, typical), typical), typical, level ? rules : undefined)]).map(l => {
          const cells = l.cells.map(fixCell)
          return { ...l, cells, text: l.kind === 'text' && cells.length <= 1 ? fixCell(l.text) : cells.join('\t') }
        })
  // A ruled grid (borders found on the picture): its cells are read by their borders, not by where the lines of text fall.
  const grids = level && rules ? ruledGrids(rules, typical) : []
  const table = grids.length ? gridRows(lines, grids, typical) : null
  const laid = table ? table.flatMap(part => ('rows' in part ? part.rows : plain(part.lines))) : plain(lines)
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
