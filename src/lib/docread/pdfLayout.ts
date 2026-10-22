// Layout-aware text from the positioned text runs of a PDF page (pdf.js getTextContent). Pure and framework-free: no pdf.js
// here, so it is tested with plain objects (pdfLayout.test.ts) as well as through real PDFs (pdfText.test.ts).
//
// A PDF has no lines, only runs of text placed at x, y. This module puts them back together the way a person reads the page:
//  - runs on the same baseline make one line, left to right; a wide gap splits the line into cells;
//  - a table is found by its header row (Description, Qty, Unit price ...): every line under it is laid out on the header's
//    columns and written as ONE row with the cells joined by a tab, the shape a spreadsheet paste has, so the enquiry and
//    supplier-quote parsers read a PDF table and a pasted Excel range the same way. Empty cells are kept, so every row of a
//    table has the same number of cells;
//  - a description that wraps onto more lines is folded back into its row (top-aligned or vertically centred cells);
//  - a table that runs onto the next page is picked up again when its rows line up with the same columns;
//  - a line with far-apart parts that is not a table row (a letterhead with the RFQ number on the right) becomes one line per
//    part, so each fact stands on its own line; "Qty:      2" stays one line;
//  - "Page 1 of 2" lines are dropped, and a blank line marks a paragraph break or a new page.

export interface TextRun {
  str: string
  /** Left edge, in page units. */
  x: number
  /** Baseline, in page units, from the TOP of the page (y grows downwards). */
  y: number
  /** Advance width in page units. */
  w: number
  /** Font size in page units. */
  size: number
}

export type LineKind = 'text' | 'header' | 'row'

export interface LaidLine {
  /** The line as text. A table header or row has its cells joined by a tab; other lines are plain text. */
  text: string
  cells: string[]
  kind: LineKind
  /** 1-based page number. */
  page: number
}

interface Cell {
  text: string
  /** Estimated left edge of each character of `text`. */
  xs: number[]
  x0: number
  x1: number
  size: number
}

interface RawLine {
  y: number
  size: number
  cells: Cell[]
  page: number
}

/** A gap wider than this many font sizes splits a line into cells (a word space is about a quarter of one). */
const CELL_GAP = 1.0

// ------------------------------------------------------------------------------------------------ runs to lines

/** A run with three or more spaces inside (columns typed as spaces) is cut there; x is shared out by character. */
function splitRun(r: TextRun): TextRun[] {
  if (!/\S\s{3,}\S/.test(r.str)) return [r]
  const per = r.w / Math.max(1, r.str.length)
  const out: TextRun[] = []
  const re = /\S+(?:\s{1,2}\S+)*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(r.str))) out.push({ str: m[0], x: r.x + m.index * per, y: r.y, w: m[0].length * per, size: r.size })
  return out
}

const sizeOf = (r: { size: number }) => (r.size > 0.5 ? r.size : 10)

/** The text lines of one page, top to bottom, each split into cells at wide gaps. */
export function pageLines(runs: readonly TextRun[], page = 1): RawLine[] {
  const sorted = runs
    .filter(r => r.str.trim() !== '')
    .flatMap(splitRun)
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const groups: Array<{ y: number; size: number; runs: TextRun[] }> = []
  for (const r of sorted) {
    const last = groups[groups.length - 1]
    if (last && Math.abs(r.y - last.y) <= 0.45 * Math.min(sizeOf(r), last.size)) {
      last.runs.push(r)
      last.size = Math.max(last.size, sizeOf(r))
    } else groups.push({ y: r.y, size: sizeOf(r), runs: [r] })
  }
  return groups.map(g => ({ y: g.y, size: g.size, page, cells: toCells(g.runs.sort((a, b) => a.x - b.x)) }))
}

/** Appends a run's text, spreading its width over its characters (pdf.js gives one width per run, not per glyph). */
function append(c: Cell, str: string, x: number, w: number): void {
  const s = str.replace(/\s+/g, ' ')
  const per = w / Math.max(1, s.length)
  for (let i = 0; i < s.length; i++) {
    const ch = s[i] as string
    if (ch === ' ' && (c.text === '' || c.text.endsWith(' '))) continue
    c.text += ch
    c.xs.push(x + i * per)
  }
  c.x1 = Math.max(c.x1, x + w)
}

function trimCell(c: Cell): Cell {
  let a = 0
  let b = c.text.length
  while (a < b && c.text[a] === ' ') a++
  while (b > a && c.text[b - 1] === ' ') b--
  return { ...c, text: c.text.slice(a, b), xs: c.xs.slice(a, b), x0: c.xs[a] ?? c.x0 }
}

function toCells(runs: TextRun[]): Cell[] {
  const cells: Cell[] = []
  let cur: Cell | null = null
  let lastRun: TextRun | null = null
  for (const r of runs) {
    // Fake bold: the same text drawn twice, a fraction of a point apart. Keep one.
    if (lastRun && r.str === lastRun.str && Math.abs(r.x - lastRun.x) < 0.3 * sizeOf(r)) continue
    lastRun = r
    const em = cur ? Math.max(cur.size, sizeOf(r)) : sizeOf(r)
    const gap = cur ? r.x - cur.x1 : 0
    if (!cur || gap > CELL_GAP * em) {
      if (cur) cells.push(cur)
      cur = { text: '', xs: [], x0: r.x, x1: r.x, size: sizeOf(r) }
    } else if (gap > 0.15 * em && !cur.text.endsWith(' ')) {
      cur.text += ' '
      cur.xs.push(cur.x1)
    }
    append(cur, r.str, r.x, r.w)
    cur.size = Math.max(cur.size, sizeOf(r))
  }
  if (cur) cells.push(cur)
  return cells.map(trimCell).filter(c => c.text !== '')
}

/**
 * pdf.js joins two runs into one when they are less than about half a character apart, so two table cells can arrive as
 * one ("6ES7214-1AG40-0XB0 SIMATIC S7-1200"). Cut a cell at a space whose next word starts inside [lo, hi] and fits the
 * column it would start, the one nearest `at` (that column's left edge).
 */
function cutAt(c: Cell, at: number, lo: number, hi: number, fits: (word: string) => boolean): [Cell, Cell] | null {
  let best = -1
  let bestD = Infinity
  for (let i = 1; i < c.text.length - 1; i++) {
    if (c.text[i] !== ' ') continue
    const x = c.xs[i + 1] as number
    if (x < lo || x > hi || !fits(c.text.slice(i + 1).split(' ')[0] ?? '')) continue
    const d = Math.abs(x - at)
    if (d < bestD) {
      bestD = d
      best = i
    }
  }
  if (best < 0) return null
  const left = trimCell({ ...c, text: c.text.slice(0, best), xs: c.xs.slice(0, best), x1: c.xs[best] as number })
  const right = trimCell({ ...c, text: c.text.slice(best + 1), xs: c.xs.slice(best + 1), x0: c.xs[best + 1] as number })
  return left.text && right.text ? [left, right] : null
}

// ------------------------------------------------------------------------------------------------ tables

const HEADER_TERM = new RegExp(
  '^(?:' +
    [
      String.raw`s\.?\s*no\.?`,
      String.raw`s\.?\s*#`,
      'menge',
      String.raw`(?:price|rate|cost)\s*\/\s*(?:unit|pc|pcs|piece|each|ea|no)`,
      String.raw`unit\s*\/\s*price`,
      String.raw`qty\.?\s*(?:(?:in|on)\s*)?(?:stock|hand)`,
      String.raw`(?:stock|available|balance|on\s*hand)\s*qty\.?`,
      'anzahl',
      String.raw`(?:einzel|gesamt|stück)\s*-?\s*preis`,
      'gesamt',
      String.raw`(?:beschreibung|bezeichnung)(?:\s*\/\s*description)?`,
      String.raw`artikel(?:\s*-?\s*nr\.?)?`,
      'lieferzeit',
      String.raw`order\s*(?:code|no\.?)`,
      String.raw`art(?:icle|\.)?\s*(?:no\.?|code|#)`,
      String.raw`cat(?:alog(?:ue)?|\.)?\s*(?:no\.?|#)`,
      String.raw`sr\.?(?:\s*no\.?|\s*#)?`,
      String.raw`sl\.?(?:\s*no\.?)?`,
      '#',
      String.raw`no\.?`,
      String.raw`item(?:\s*(?:no\.?|#|code|description))?`,
      String.raw`pos(?:ition)?\.?`,
      'line',
      'description',
      String.raw`material(?:\s+(?:description|code|no\.?))?`,
      'particulars',
      'specifications?',
      String.raw`product(?:\s+(?:name|description))?`,
      String.raw`part\s*(?:no\.?|number|#)`,
      String.raw`model(?:\s*no\.?)?`,
      'make',
      'brand',
      String.raw`qty\.?`,
      'quantity',
      String.raw`req(?:uired|\.)?\s*qty\.?`,
      String.raw`qty\.?\s*req(?:uired|d)?\.?`,
      'uom',
      'units?',
      String.raw`u\/m`,
      String.raw`unit\s*(?:price|rate|cost)`,
      'rate',
      'price',
      'amount',
      String.raw`total(?:\s*(?:price|amount|value))?`,
      'value',
      String.raw`delivery(?:\s*(?:date|time|period))?`,
      String.raw`lead\s*time`,
      'remarks?',
      'currency',
      'origin',
      'moq',
      String.raw`hs\s*code`,
      String.raw`disc(?:ount)?\.?\s*%?`,
      String.raw`(?:list|gross)\s*(?:price|rate)`,
      String.raw`(?:estimated|est\.?|approx\.?|budget(?:ary)?|target|last\s*purchase)\s*(?:unit\s*)?(?:rate|price|cost|amount|value)`,
      'tax',
      'gst',
      String.raw`sales\s*tax`,
      String.raw`net(?:\s*(?:price|amount))?`,
      String.raw`ext(?:ended)?\.?\s*price`,
      'availability',
      String.raw`(?:short|long|item)\s*text`,
      'plant',
      String.raw`itm\.?`,
      String.raw`(?:req(?:uired|\.)?|del(?:ivery|\.)?|need|due)\s*(?:date|by)`,
      'code',
      String.raw`description\s+of\s+goods`,
      String.raw`tag\s*(?:no\.?)?`,
      String.raw`pr\.?\s*#`,
      String.raw`pur\.?\s*req\.?(?:\s*no\.?)?`,
      String.raw`org\.?`,
      String.raw`special\s+instructions?`,
      String.raw`rate\s*\/\s*unit`,
      String.raw`item\s*name(?:\s*\/\s*spec(?:ification)?s?)?`,
      String.raw`a\s*\/\s*u`,
      String.raw`wks?\.?`,
      String.raw`weeks?`,
    ].join('|') +
    ')$',
  'i',
)

/** A table header word or phrase ("S.No", "Item Description", "Unit Price (USD)", "REQ QTY"). Shared with the parsers. */
export function isHeaderCell(text: string): boolean {
  const core = text
    .replace(/\(.*?\)/g, ' ')
    .replace(/(?:^|\s)(?:usd|eur|rmb|cny|pkr|aed|gbp|us\$|rs\.?|in)(?=\s|$)|[$€¥￥£]/gi, ' ')
    .replace(/[:.\s]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()
  return core !== '' && (HEADER_TERM.test(core) || (/^\S+(?: \S{1,2})+$|^\S{1,2} \S+$/.test(core) && HEADER_TERM.test(core.replace(/\s+/g, ''))))
}

function isHeaderLine(cells: Cell[]): boolean {
  if (cells.length < 2) return false
  if (cells.some(c => /\d{2,}/.test(c.text.replace(/\(.*?\)/g, '')))) return false
  const hits = cells.filter(c => isHeaderCell(c.text)).length
  return hits >= 2 && hits >= Math.ceil(cells.length * 0.6)
}

/** A cell that is a number, a quantity with its unit, an amount or a date: "2", "2.000 EA", "USD 1,250.00", "15.08.2026". */
const NUMERIC_CELL =
  /^\(?(?:(?:usd|eur|rmb|cny|pkr|aed|gbp|us\$|rs\.?)\s*|[$€¥￥£]\s*)?-?\d[\d.,'/ -]*(?:\s*(?:%|nos?|no's|numbers?|pcs?|pieces?|ea|each|sets?|lots?|pairs?|prs?|rolls?|m|mtrs?|meters?|kgs?|ltrs?|l|ft|units?|boxe?s?|drums?|days?|weeks?|wks?|months?|usd|eur|rmb|cny|pkr|aed|gbp|[$€¥￥£])\.?)?\)?$/i

const isNumericCell = (t: string) => NUMERIC_CELL.test(t.trim())

/** The left column for row numbers ("S.No", "#", "Item" holding 1, 2, 3). */
const NUMBER_COLUMN = /^(?:s\.?\s*no|sr|sl|#|no\.?$|pos|line)/i
const END_OF_TABLE =
  /^(?:(?:bid|quotation|quote|offer)?\s*(?:due|closing|last)\s*(?:date|by)?\s*[:.-]|deadline|closing\s+date|due\s+date|(?:best|kind|warm|warmest)?\s*regards|thanks?\b|sincerely|yours\b|prepared\s+by|approved\s+by|checked\s+by|requested\s+by|terms|conditions|notes?\s*:|remarks?\s*:|payment|validity|valid\s+(?:for|till|until)|delivery\s*(?:terms|time|period)?\s*:|lead\s*time\s*:|incoterms?|price\s+basis|bank|account|iban|thank|regards|we\s+hope|for\s+and\s+on\s+behalf|authori[sz]ed|signature|amount\s+in\s+words|in\s+words|rupees|say\s*:|please\s|kindly\s|we\s)/i

interface Column {
  x0: number
  x1: number
  label: string
}

type ColumnKind = 'number' | 'qty' | 'unit' | 'money' | 'date' | 'text'

function columnKind(label: string): ColumnKind {
  if (NUMBER_COLUMN.test(label)) return 'number'
  if (/qty|quantity|moq/i.test(label)) return 'qty'
  if (/^(?:uom|units?|u\/m)\b/i.test(label)) return 'unit'
  if (/price|rate|amount|total|value|disc|tax|gst|^net|cost/i.test(label)) return 'money'
  if (/date/i.test(label)) return 'date'
  return 'text'
}

const UNIT_WORD = /^(?:nos?\.?|pcs?\.?|pieces?|ea|each|sets?|lots?|pairs?|prs?|rolls?|m|mtrs?|meters?|metres?|rmt?|kg|kgs|ltrs?|l|ft|units?|no's|numbers?|bags?|boxes|box|cans?|drums?|sheets?|coils?|pkts?|cartons?|lengths?|adad)\.?$/i

/** A header cell that pdf.js merged ("Unit Price (USD) Amount (USD)"), split back into its terms; else the cell itself. */
function segmentHeader(c: Cell): Cell[] {
  if (isHeaderCell(c.text)) return [c]
  const starts: number[] = [0]
  for (let i = 1; i < c.text.length; i++) if (c.text[i - 1] === ' ' && c.text[i] !== ' ') starts.push(i)
  const endOf = (e: number) => (e < starts.length ? (starts[e] as number) - 1 : c.text.length)
  const out: Cell[] = []
  let w = 0
  while (w < starts.length) {
    let found = -1
    for (let e = starts.length; e > w; e--) {
      if (isHeaderCell(c.text.slice(starts[w], endOf(e)))) {
        found = e
        break
      }
    }
    if (found < 0) return [c]
    const from = starts[w] as number
    const to = endOf(found)
    out.push(trimCell({ ...c, text: c.text.slice(from, to), xs: c.xs.slice(from, to), x0: c.xs[from] as number, x1: found < starts.length ? (c.xs[to] as number) : c.x1 }))
    w = found
  }
  return out
}

/** Cells that pdf.js merged across a column edge, cut back at that edge when the next word fits the column it starts. */
function splitToColumns(cells: Cell[], cols: Column[]): Cell[] {
  const out: Cell[] = []
  for (const c of cells) {
    let rest: Cell = c
    for (const col of cols.slice(1)) {
      if (!(col.x1 > rest.x0 + rest.size && col.x0 < rest.x1 - 0.3 * rest.size)) continue
      const kind = columnKind(col.label)
      const fits = (w: string) => kind === 'text' || (kind === 'unit' ? UNIT_WORD.test(w) : isNumericCell(w))
      // Text starts at its column's left edge; a number sits anywhere under its header (right-aligned or centred).
      const em = rest.size
      const hi = kind === 'text' || kind === 'number' ? col.x0 + 1.5 * em : col.x1
      const cut = cutAt(rest, col.x0, col.x0 - 1.5 * em, hi, fits)
      if (!cut) continue
      out.push(cut[0])
      rest = cut[1]
    }
    out.push(rest)
  }
  return out
}

/** The column whose region holds x. Regions meet halfway between one header's right edge and the next one's left edge. */
function regionOf(x: number, cols: Column[]): number {
  let i = 0
  for (let k = 1; k < cols.length; k++) {
    const a = cols[k - 1] as Column
    const b = cols[k] as Column
    const edge = a.x1 < b.x0 ? (a.x1 + b.x0) / 2 : b.x0
    if (x >= edge) i = k
  }
  return i
}

/**
 * The column a cell belongs to. A number or a short word goes by its centre (right-aligned or centred under its header); a
 * text that starts in a text column stays there even when it runs on under the next columns (a long description).
 */
function columnOf(c: Cell, cols: Column[]): number {
  const byCentre = regionOf((c.x0 + c.x1) / 2, cols)
  if (isNumericCell(c.text)) return byCentre
  const byStart = regionOf(c.x0 + 0.5 * c.size, cols)
  return columnKind((cols[byStart] as Column).label) === 'text' ? byStart : byCentre
}

/** Strict fit, used to pick a table up again on the next page: 3 or more cells, each in its own column, one of them a number. */
function fitsColumns(line: RawLine, cols: Column[]): boolean {
  if (line.cells.length < 3 || !line.cells.some(c => isNumericCell(c.text))) return false
  const seen = new Set<number>()
  for (const c of line.cells) {
    const i = columnOf(c, cols)
    const col = cols[i] as Column
    const near = c.x1 >= col.x0 - c.size && c.x0 <= col.x1 + c.size * 6
    if (seen.has(i) || !near) return false
    seen.add(i)
  }
  return true
}

interface TableRow {
  y: number
  page: number
  cells: string[][]
  anchor: boolean
  /** The anchor line itself carries text in a description-like column (the row's first line). */
  hasText: boolean
}

/** "A. ELECTRICAL", "B) Instruments", "INSTRUMENTATION ITEMS", "MECHANICAL / OTHERS": a heading over a group of rows. */
const SECTION_HEADING = /^(?=\D*$)(?:[A-Z][.)]\s+[A-Za-z][A-Za-z &/-]{2,30}|[A-Z][A-Z &/-]{0,30}\b(?:ITEMS?|SPARES|MATERIALS?|PARTS|OTHERS|CONSUMABLES|EQUIPMENTS?|INSTRUMENTS?))$/

const joinPart =(a: string, b: string) => (a === '' ? b : /[-/]$/.test(a) ? a + b : `${a} ${b}`)

/** Lays the lines of one table on its columns. Returns the rows; continuation lines are folded into their row. */
function buildRows(lines: RawLine[], cols: Column[]): string[][] {
  // "Item" over 1, 2, 3 beside a Description column is the row-number column.
  const hasDescription = cols.some(c => /desc|particular|specification|product|short\s*text|goods/i.test(c.label))
  const kinds = cols.map(c => (hasDescription && /^(?:item|itm)\.?(?:\s*(?:no\.?|#))?$/i.test(c.label) ? 'number' : columnKind(c.label)))
  // A number starts a row only in a column made for numbers (S.No, Qty, Price, Date); "186" under Part No is the end of a
  // part number that wrapped ("SN-69M-" / "186").
  const numberKinds = new Set<ColumnKind>(['number', 'qty', 'money', 'date'])
  const anyNumberColumn = kinds.some(k => numberKinds.has(k))
  const rows: TableRow[] = lines.map(l => {
    const cells: string[][] = cols.map(() => [])
    let anchor = false
    let hasText = false
    for (const c of splitToColumns(l.cells, cols)) {
      const i = columnOf(c, cols)
      ;(cells[i] as string[]).push(c.text)
      // A material code ("18561326") starts a row wherever it stands: a read picture can lose the serial number beside it.
      if ((isNumericCell(c.text) && (!anyNumberColumn || numberKinds.has(kinds[i] as ColumnKind) || /^\d{5,}$/.test(c.text))) || kinds[i] === 'number') anchor = true
      else if (kinds[i] === 'text') hasText = true
    }
    // A section heading inside the table ("INSTRUMENTATION ITEMS", "B. Mechanical") is a row of its own, not the row above
    // wrapping: the parsers skip it.
    const filled = cells.filter(p => p.length)
    if (!anchor && filled.length === 1 && SECTION_HEADING.test((filled[0] as string[]).join(' '))) anchor = true
    return { y: l.y + l.page * 100_000, page: l.page, cells, anchor, hasText }
  })
  const anchors = rows.filter(r => r.anchor)
  if (anchors.length === 0) return rows.map(r => r.cells.map(p => p.join(' ')))
  // Each continuation line goes to a row: under a top-aligned row (its first line carries text) it follows that row; beside a
  // row with no text of its own (cells centred vertically) it goes to the nearest one.
  const into = new Map<TableRow, TableRow[]>()
  for (const r of rows) {
    if (r.anchor) continue
    const prev = [...anchors].reverse().find(a => a.y < r.y) ?? null
    const next = anchors.find(a => a.y > r.y) ?? null
    let target: TableRow | null
    if (prev && prev.hasText) target = prev
    else if (next && !next.hasText && (!prev || Math.abs(next.y - r.y) < Math.abs(r.y - prev.y))) target = next
    else target = prev ?? next
    if (!target) continue
    into.set(target, [...(into.get(target) ?? []), r])
  }
  return anchors.map(a => {
    const parts = [a, ...(into.get(a) ?? [])].sort((p, q) => p.y - q.y)
    return cols.map((_, i) => parts.reduce((acc, p) => (p.cells[i]?.length ? joinPart(acc, (p.cells[i] as string[]).join(' ')) : acc), ''))
  })
}

// ------------------------------------------------------------------------------------------------ page to lines

const PAGE_NUMBER = /^(?:page\s*)?\d{1,3}\s*(?:of|\/)\s*\d{1,3}$|^page\s+\d{1,3}$|^-\s*\d{1,3}\s*-$/i

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)] ?? null
}

/** A line that is not in a table: one line, a spreadsheet-like row, or one line per far-apart part. */
function plainLines(l: RawLine): LaidLine[] {
  const cells = l.cells.map(c => c.text)
  if (cells.length === 1) return [{ text: cells[0] as string, cells, kind: 'text', page: l.page }]
  const numeric = cells.filter(isNumericCell).length
  if ((cells.length >= 3 && numeric >= 1) || (cells.length === 2 && isNumericCell(cells[1] as string) && !/:$/.test(cells[0] as string))) {
    return [{ text: cells.join('\t'), cells, kind: 'row', page: l.page }]
  }
  const out: LaidLine[] = []
  for (let i = 0; i < cells.length; i++) {
    let t = cells[i] as string
    while (/:$/.test(t) && i + 1 < cells.length) t = `${t} ${cells[++i]}`
    out.push({ text: t, cells: [t], kind: 'text', page: l.page })
  }
  return out
}

/**
 * Turns the text runs of each page into reading-order lines. `pages[i]` holds the runs of page i + 1.
 */
export function layoutPages(pages: ReadonlyArray<readonly TextRun[]>): LaidLine[] {
  const out: LaidLine[] = []
  let table: { cols: Column[]; lines: RawLine[]; lastY: number; pitch: number[]; page: number } | null = null
  let lastCols: Column[] | null = null
  /** Plain lines since the last table ended: a table is picked up again only soon after (past a footer and a letterhead). */
  let sinceTable = 0

  const flush = () => {
    if (!table) return
    for (const cells of buildRows(table.lines, table.cols)) {
      if (cells.every(c => c === '')) continue
      out.push({ text: cells.join('\t'), cells, kind: 'row', page: table.page })
    }
    lastCols = table.cols
    table = null
    sinceTable = 0
  }
  const blank = (page: number) => {
    const last = out[out.length - 1]
    if (last && last.text !== '') out.push({ text: '', cells: [], kind: 'text', page })
  }

  pages.forEach((runs, pi) => {
    const page = pi + 1
    const lines = pageLines(runs, page).filter(l => !(l.cells.length === 1 && PAGE_NUMBER.test((l.cells[0] as Cell).text)))
    // A paragraph break: a gap clearly wider than the usual line pitch (the median, at most single spacing).
    const pitch = median(lines.slice(1).map((l, i) => l.y - (lines[i] as RawLine).y).filter(d => d > 0)) ?? Infinity
    const isBreak = (gap: number, size: number) => gap > 1.75 * Math.min(pitch, 1.45 * size)
    let prevY: number | null = null
    if (table) flush()
    blank(page)
    for (let k = 0; k < lines.length; k++) {
      const l = lines[k] as RawLine
      const gap = prevY === null ? 0 : l.y - prevY
      prevY = l.y

      const headCells = l.cells.flatMap(segmentHeader)
      if (isHeaderLine(headCells)) {
        flush()
        if (isBreak(gap, l.size)) blank(page)
        const cols: Column[] = headCells.map(c => ({ x0: c.x0, x1: c.x1, label: c.text }))
        // A header written on two lines ("Unit" over "Price"): words only, each under a column.
        const nx = lines[k + 1]
        if (nx && nx.y - l.y < 1.8 * l.size && nx.cells.every(c => !/\d/.test(c.text) && c.text.split(' ').length <= 3)) {
          const extra = nx.cells.map(c => ({ c, i: columnOf(c, cols) }))
          if (extra.every(e => e.c.x1 >= (cols[e.i] as Column).x0 - e.c.size && e.c.x0 <= (cols[e.i] as Column).x1 + e.c.size)) {
            for (const e of extra) {
              const col = cols[e.i] as Column
              col.label = `${col.label} ${e.c.text}`
              col.x0 = Math.min(col.x0, e.c.x0)
              col.x1 = Math.max(col.x1, e.c.x1)
            }
            k++
            prevY = nx.y
          }
        }
        out.push({ text: cols.map(c => c.label).join('\t'), cells: cols.map(c => c.label), kind: 'header', page })
        table = { cols, lines: [], lastY: prevY ?? l.y, pitch: [], page }
        continue
      }

      if (table) {
        const t = table as { cols: Column[]; lines: RawLine[]; lastY: number; pitch: number[]; page: number }
        const typical = median(t.pitch) ?? 1.4 * l.size
        const single = l.cells.length === 1 ? (l.cells[0] as Cell) : null
        const first = t.cols[0] as Column
        const startsLeft = single !== null && !isNumericCell(single.text) && single.x0 < first.x0 - 2 * single.size
        // A sentence written from the table's left edge across two or more columns is a paragraph under the table, not a cell.
        const edgesCrossed = single ? t.cols.slice(1).filter(c => c.x0 > single.x0 + single.size && c.x0 < single.x1).length : 0
        // Under a serial-number column, words starting in it and running into the next column are a sentence too: a row's
        // wrapped text does not spill into the serial column ("Rates are in PKR. GST 18% extra.").
        const serialFirst = /^(?:s\.?\s*(?:no|#)|sr|sl|#|no\.?$|pos|item\s*(?:no|#))/i.test(first.label.trim())
        const paragraph =
          single !== null &&
          !isNumericCell(single.text) &&
          regionOf(single.x0 + 0.5 * single.size, t.cols) === 0 &&
          (edgesCrossed >= 2 || (serialFirst && edgesCrossed >= 1 && single.text.split(' ').length >= 3))
        // A line that starts with a closing word ("Bid due:", "Regards,", "Terms") and has no number in a cell of its own.
        const closing = END_OF_TABLE.test((l.cells[0] as Cell).text) && (single !== null || !l.cells.slice(1).some(c => isNumericCell(c.text)))
        // A numbered sentence written from the table's left edge ("1. Bid security 2% of the quoted amount."): the terms under it.
        const numberedNote = single !== null && /^\d{1,2}[.)]\s+[A-Za-z]+(?:\s+\S+){2,}/.test(single.text) && regionOf(single.x0 + 0.5 * single.size, t.cols) === 0
        const ends = l.y - t.lastY > Math.max(3.2 * typical, 4 * l.size) || startsLeft || paragraph || closing || numberedNote
        if (!ends) {
          t.pitch.push(l.y - t.lastY)
          t.lastY = l.y
          t.lines.push(l)
          continue
        }
        flush()
      } else if (lastCols && sinceTable < 12 && fitsColumns(l, lastCols)) {
        // The table goes on from the previous page with no header of its own: its header is written again, as a printed
        // table repeats it, so a parser that reads the header (supplier quotes) reads these rows too.
        const cols: Column[] = lastCols
        out.push({ text: cols.map(c => c.label).join('\t'), cells: cols.map(c => c.label), kind: 'header', page })
        table = { cols, lines: [l], lastY: l.y, pitch: [], page }
        continue
      }

      if (isBreak(gap, l.size)) blank(page)
      for (const p of plainLines(l)) out.push(p)
      sinceTable++
    }
  })
  flush()
  while (out.length && (out[out.length - 1] as LaidLine).text === '') out.pop()
  while (out.length && (out[0] as LaidLine).text === '') out.shift()
  return out
}

/** The laid-out lines as one text: what the paste box receives. */
export function linesToText(lines: readonly LaidLine[]): string {
  return lines.map(l => l.text).join('\n')
}
