// A table copied from a web page or a phone app as one cell per line ("Sr. No" / "Particulars" / "QTY" / "UOM", then "1" /
// "Silicone sealant 300 ml" / "12" / "Nos." ...) put back into tab rows, the shape a spreadsheet paste has, so the enquiry and
// supplier-quote parsers read it as they read any table. Pure and framework-free.
//
// The header is a run of three or more header words, one per line (it must name a description and a quantity, or a price).
// Each row starts at its serial number when the first column is "S.No" / "#" / "Item"; empty cells are not written by most
// copies, so a row's cells are placed by what they are: a number under Qty or Price, a unit under UOM, a code under Part No,
// "-" anywhere. The next serial number starts the next row once this row has its quantity (a quantity can equal the next
// serial: "5" / "Float switch" / "6" / "PC" / "6" / ...).

import { isHeaderCell } from './pdfLayout'

type Kind = 'number' | 'desc' | 'qty' | 'unit' | 'code' | 'make' | 'date' | 'money' | 'text'

const UNIT = /^(?:nos's|nos?\.?|no's|numbers?|pcs?\.?|pieces?|ea|each|units?|sets?|lots?|pairs?|prs?|rolls?|mtrs?|meters?|metres?|m|rmt?|ltrs?|litres?|l|kgs?|ft|lengths?|boxe?s?|pkts?|packets?|bags?|drums?|cans?|sheets?|coils?|cartons?|adad)$/i
const NUM = /^\d[\d,]*(?:\.\d+)?$/
const MONEY = /^(?:[A-Za-z$€¥￥£₨.]{0,4}\s?)?\d[\d,.]*(?:\/-)?(?:\s?[A-Za-z$€]{0,4})?$/
const PLACEHOLDER = /^[-–—]$|^n\/?a$/i

/** A unit of measure on its own ("Nos", "PCS", "Mtr"). */
export const isUnitWord = (t: string): boolean => UNIT.test(t.trim())

const STOCK_QTY = /stock|on\s*hand|available|balance|issued|received|consum/i

function headerKind(label: string, hasDesc: boolean): Kind {
  if (/^(?:s\.?\s*no|s\.?\s*#|sr|sl|#|no\.?$|pos|line|itm)/i.test(label) || (hasDesc && /^item(?:\s*no\.?)?$/i.test(label))) return 'number'
  if (/desc|particular|specification|product|item\s*name|short\s*text|goods|^item$/i.test(label)) return 'desc'
  // "Qty in Stock" is what the store holds, not what is asked for.
  if (/qty|quantity/i.test(label) && !STOCK_QTY.test(label)) return 'qty'
  // "Unit EUR" is a price per unit; "Unit" and "UOM" alone are the unit.
  if (/\b(?:usd|eur|rmb|cny|pkr|aed|gbp|rs)\b|[$€¥￥£]/i.test(label)) return 'money'
  if (/^(?:uom|units?|u\/m|a\s*\/\s*u)\.?$/i.test(label)) return 'unit'
  if (/part|model|cat|code|material/i.test(label)) return 'code'
  if (/make|brand/i.test(label)) return 'make'
  if (/date/i.test(label)) return 'date'
  if (/price|rate|amount|total|value|cost/i.test(label)) return 'money'
  return 'text'
}

function fits(kind: Kind, c: string): boolean {
  if (PLACEHOLDER.test(c)) return true
  switch (kind) {
    case 'number':
      return /^\d{1,4}\.?$/.test(c)
    case 'qty':
      // "6 Numbers": the quantity and its unit in one cell.
      return NUM.test(c) || (/^\d[\d,]*(?:\.\d+)?\s*\S+$/.test(c) && UNIT.test(c.replace(/^\d[\d,]*(?:\.\d+)?\s*/, '')))
    case 'unit':
      return UNIT.test(c)
    case 'code':
      return !/\s/.test(c) && /\d/.test(c) && /[A-Za-z]/.test(c) && c.length >= 3
    case 'date':
      return /\d{1,4}[./-]\d{1,2}[./-]\d{1,4}|\d{1,2}\s+[A-Za-z]{3}/.test(c)
    case 'money':
      return MONEY.test(c) || NO_PRICE_WORD.test(c)
    case 'make':
      return !/\d/.test(c) && c.split(' ').length <= 3
    default:
      return true
  }
}

/** Each cell goes to the first column from the last placed one on that it fits; a cell that fits none goes on the text before. */
function place(cells: string[], kinds: Kind[], stackDesc = false): { out: string[]; col: number } {
  const out: string[] = kinds.map(() => '')
  let col = 0
  // A description that runs over several lines ("Float switch" / "QX-77 AV" / "Make: Acme") before the quantity: while
  // the quantity column is still empty, a cell that is no quantity belongs to the description (nothing sits between the two
  // but free-text columns, which an item's own lines fill in the same way).
  const di = kinds.indexOf('desc')
  const qi = kinds.indexOf('qty')
  const stacked = stackDesc && di >= 0 && qi > di && kinds.slice(di + 1, qi).every(k => k === 'text' || k === 'desc')
  for (const c of cells) {
    if (stacked && col > di && col <= qi && !fits('qty', c)) {
      out[di] = out[di] ? `${out[di]} ${c}` : c
      continue
    }
    if (stacked && col > di && col <= qi) {
      out[qi] = c
      col = qi + 1
      continue
    }
    let at = -1
    for (let x = col; x < kinds.length; x++) {
      // An order or material code before the description can be all digits ("10" / "9248471" / "Butterfly valve ...").
      const numericCode = kinds[x] === 'code' && /^\d{5,}$/.test(c) && kinds.indexOf('desc') > x
      if (numericCode || fits(kinds[x] as Kind, c)) {
        at = x
        break
      }
    }
    if (at < 0) {
      const lastText = out.reduce((a, v, x) => (v && (kinds[x] === 'desc' || kinds[x] === 'text') ? x : a), -1)
      if (lastText >= 0) out[lastText] = `${out[lastText]} ${c}`
      continue
    }
    out[at] = PLACEHOLDER.test(c) ? '' : c
    col = at + 1
  }
  return { out, col }
}

export interface CellLine {
  t: string
  blankBefore: boolean
}

/**
 * Rebuilds one-cell-per-line tables in place. `stop` ends a row early (a sign-off, a disclaimer). Lines that are not such a
 * table are left as they are.
 */
export function rebuildCellTables<T extends CellLine>(src: T[], stop: (t: string) => boolean = () => false, opts: { ignoreBlank?: boolean } = {}): boolean {
  // A mail client that puts a blank line after every cell (an Outlook copy): the blank lines say nothing about where a row ends.
  const bb = (s: T) => !opts.ignoreBlank && s.blankBefore
  let changed = false
  for (let k = 0; k < src.length; k++) {
    let e = k
    while (e < src.length) {
      const t = (src[e] as T).t
      if (/\d|\t/.test(t.replace(/\(.*?\)/g, '')) || t.replace(/\(.*?\)/g, '').trim().split(' ').length > 4 || !isHeaderCell(t) || (e > k && bb(src[e] as T))) break
      e++
    }
    const labels = src.slice(k, e).map(s => s.t)
    if (labels.length < 3) continue
    // A description heading other than a bare "Item" (then "Item" is the serial-number column).
    const hasDesc = labels.some(l => headerKind(l, false) === 'desc' && !/^item$/i.test(l))
    const kinds = labels.map(l => headerKind(l, hasDesc))
    if (!kinds.includes('desc') || !(kinds.includes('qty') || kinds.includes('money'))) continue
    const numbered = kinds[0] === 'number'
    const need: Kind = kinds.includes('qty') ? 'qty' : 'money'
    const rows: string[][] = []
    let j = e
    // Positions count 1, 2, 3 or 10, 20, 30 (a German or SAP quotation).
    const step = numbered && /^10\.?$/.test((src[e] as T | undefined)?.t ?? '') ? 10 : 1
    let serial = step
    while (j < src.length) {
      const first = (src[j] as T).t
      if ((numbered && !(/^\d{1,4}\.?$/.test(first) && Number(first.replace(/\.$/, '')) === serial)) || first.includes('\t')) break
      const cells: string[] = numbered ? [first] : []
      let q = numbered ? j + 1 : j
      const width = numbered ? Infinity : labels.length
      // The row has its quantity (or price) once a cell has landed in that column ("0" under Qty in Stock is not it).
      const hasNeed = () => {
        const { out } = place(cells, kinds, !!opts.ignoreBlank)
        return out.some((v, x) => v && kinds[x] === need)
      }
      while (q < src.length && cells.length < width && !bb(src[q] as T)) {
        const t = (src[q] as T).t
        // The next serial number starts the next row (followed by its description, not by another number: a last cell can
        // equal the next serial, "... 6240.00 / 2 / 2 / Amerix ...").
        const after = (src[q + 1] as T | undefined)?.t ?? ''
        if (numbered && hasNeed() && /^\d{1,4}\.?$/.test(t) && Number(t.replace(/\.$/, '')) === serial + step && !NUM.test(after)) break
        // A row that already has its cells (tab separated) is a table of its own: the header words above are stacked headings.
        if (stop(t) || t.includes('\t')) break
        // A sentence under a complete row is the text after the table ("Last date for submission: 3 November").
        // (Complete means its description too: with the description column last, a long description follows the quantity.)
        const hasDesc = () => place(cells, kinds, !!opts.ignoreBlank).out.some((v, x) => v && kinds[x] === 'desc')
        if (hasNeed() && hasDesc() && (/[A-Za-z]:\s/.test(t) || t.split(' ').length >= 7)) break
        // With no serial column, empty cells at the end of a row ("4" / "NO" / "Panel meter" / "" under Part No) are not
        // written either: a cell that fits no column from here on but fits the first one (a quantity) starts the next row.
        if (!numbered && cells.length && kinds[0] !== 'desc' && kinds[0] !== 'text' && !PLACEHOLDER.test(t)) {
          const { out, col } = place(cells, kinds, !!opts.ignoreBlank)
          if (out.some((v, x) => v && kinds[x] === 'desc') && fits(kinds[0] as Kind, t) && kinds.slice(col).every(k => !fits(k, t))) break
        }
        cells.push(t)
        q++
        if (numbered && !opts.ignoreBlank && cells.length >= labels.length) break
      }
      const { out } = place(cells, kinds, !!opts.ignoreBlank)
      if (!out.some((v, x) => v && kinds[x] === 'desc')) break
      // With no serial numbers to go by, a row with no quantity is the text after the table (the sender's name).
      if (!numbered && need === 'qty' && !out.some((v, x) => v && kinds[x] === 'qty')) break
      rows.push(out)
      serial += step
      j = q
    }
    if (rows.length === 0) continue
    const base = src[k] as T
    const rebuilt = [{ ...base, t: labels.join('\t') }, ...rows.map(r => ({ ...base, t: r.join('\t'), blankBefore: false }))]
    src.splice(k, j - k, ...rebuilt)
    k += rebuilt.length - 1
    changed = true
  }
  return changed
}

/**
 * Columns lined up with spaces (a table copied from a PDF viewer or a plain-text email) as tab rows that keep their empty
 * cells: under a header line, each piece of a row goes to the header column it sits under, so a row with no Part No still
 * has its quantity in the Qty column. Lines before any such header, and other lines, are left as they are.
 */
export function alignSpacedRows(lines: string[]): string[] {
  const pieces = (l: string) => [...l.matchAll(/\S+(?: {1,2}\S+)*/g)].map(m => ({ t: m[0], a: m.index, b: m.index + m[0].length }))
  const wide = (l: string) => !l.includes('\t') && (l.match(/\S {3,}(?=\S)/g) ?? []).length >= 2
  let head: Array<{ t: string; a: number; b: number }> | null = null
  return lines.map(l => {
    if (!l.trim()) {
      head = null
      return l
    }
    if (!wide(l)) return l
    const s = pieces(l)
    if (s.length >= 3 && s.every(x => isHeaderCell(x.t))) {
      head = s
      return s.map(x => x.t).join('\t')
    }
    if (!head) return l
    const h = head as Array<{ t: string; a: number; b: number }>
    const cells = h.map(() => '')
    for (const x of s) {
      let best = 0
      let bestOverlap = -Infinity
      h.forEach((c, i) => {
        const end = i + 1 < h.length ? (h[i + 1] as { a: number }).a : Infinity
        const start = i === 0 ? -Infinity : c.a
        const overlap = Math.min(x.b, end) - Math.max(x.a, start)
        if (overlap > bestOverlap) {
          bestOverlap = overlap
          best = i
        }
      })
      // A second piece in a column already filled, with an empty column after it, is that column's: a right-aligned
      // "5 Each" wider than its "Qty" heading starts under the description.
      if (cells[best] && best + 1 < h.length && !cells[best + 1] && x.a > (h[best + 1] as { a: number }).a - x.t.length) best++
      cells[best] = cells[best] ? `${cells[best]} ${x.t}` : x.t
    }
    return cells.join('\t')
  })
}

/** The same, on plain text lines (a blank line between blocks). */
export function rebuildCellText(text: string, stop?: (t: string) => boolean): string {
  const src: CellLine[] = []
  let blank = false
  for (const l of text.split('\n')) {
    if (!l.trim()) {
      blank = true
      continue
    }
    src.push({ t: l.trim(), blankBefore: blank })
    blank = false
  }
  if (!rebuildCellTables(src, stop)) return text
  return src.map((s, i) => `${s.blankBefore && i > 0 ? '\n' : ''}${s.t}`).join('\n')
}

// ------------------------------------------------------------------------------------------------ tables copied with cells that wrap

const cellsOf = (l: string) => l.split('\t').map(c => c.trim()).filter(Boolean)
const isRowStart = (l: string, n: number) => new RegExp(String.raw`^\s*${n}\s*[.)]?\t`).test(l)
const NO_PRICE_WORD = /^(?:n\.?\/?a\.?|nil|not\s+available|unavailable|the\s+model\s+is\s+(?:incorrect|wrong)\.?)$/i

/**
 * A table copied from a mail client whose cells wrap onto further lines ("Unit Price" / "(RMB)" in the heading; a description
 * of "Model: X" / "Brand: Y" in a row; a price with a note under it): one tab row per item again, so the table reader sees
 * the columns it knows. Only a table whose heading wraps is touched; a table with one line per row is left as it is.
 */
export function foldWrappedTables(lines: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const head = cellsOf(lines[i] ?? '')
    const startsTable = head.length >= 3 && (lines[i] ?? '').includes('\t') && head.filter(isHeaderCell).length >= 3 && headerKind(head[0] as string, true) === 'number'
    if (!startsTable) {
      out.push(lines[i] as string)
      continue
    }
    // The heading goes on until the line that starts row 1.
    let j = i + 1
    const tokens = [...head]
    while (j < lines.length && j <= i + 6 && !isRowStart(lines[j] ?? '', 1)) {
      tokens.push(...cellsOf(lines[j] ?? ''))
      j++
    }
    if (j >= lines.length || j === i + 1 || !isRowStart(lines[j] ?? '', 1)) {
      out.push(lines[i] as string)
      continue
    }
    // "(RMB)" under "Unit Price" is part of that heading.
    const labels: string[] = []
    for (const t of tokens) {
      if (/^[(（]/.test(t) && labels.length) labels[labels.length - 1] = `${labels[labels.length - 1]} ${t}`
      else labels.push(t)
    }
    const hasDesc = labels.some(l => headerKind(l, false) === 'desc')
    const kinds = labels.map(l => headerKind(l, hasDesc))
    if (!kinds.includes('desc') || !(kinds.includes('qty') || kinds.includes('money'))) {
      out.push(lines[i] as string)
      continue
    }
    const rows: string[] = []
    let serial = 1
    while (j < lines.length && isRowStart(lines[j] ?? '', serial)) {
      const toks = cellsOf(lines[j] as string)
      let k = j + 1
      let seenData = false
      while (k < lines.length && !isRowStart(lines[k] ?? '', serial + 1)) {
        const t = lines[k] as string
        if (!t.trim()) {
          k++
          continue
        }
        // The sentence under the table ("If you have any questions, feel free to reach out.") ends the last row.
        if (t.trim().split(/\s+/).length >= 6 && !t.includes('\t')) break
        if (seenData && !t.includes('\t') && toks.length >= labels.length) break
        toks.push(...cellsOf(t))
        if (t.includes('\t')) seenData = true
        k++
      }
      // serial, then the description (as many lines as it takes: up to the first number), then the other cells.
      const [no, first, ...rest] = toks
      const descParts = [first ?? '']
      while (rest.length && !/^\d[\d,.]*$/.test(rest[0] as string) && !NO_PRICE_WORD.test(rest[0] as string)) descParts.push(rest.shift() as string)
      const cells: string[] = []
      for (const t of rest) {
        // A note under a price ("(Validity: 1 week)") goes with the description: the row reader finds it there.
        if (/^[(（]/.test(t)) descParts.push(t)
        else cells.push(t)
      }
      const placed = place([no ?? '', descParts.join(' '), ...cells], kinds).out
      rows.push(placed.join('\t'))
      serial++
      j = k
    }
    if (rows.length === 0) {
      out.push(lines[i] as string)
      continue
    }
    out.push(labels.join('\t'), ...rows)
    i = j - 1
  }
  return out
}

/**
 * A list copied with one cell per line and no heading: "SOLDERING IRON TQ95-01" / "2" / "EA", repeated. Each run of
 * description, quantity (and unit) lines becomes tab rows, so the unit is read and is not a junk item of its own. A run needs
 * at least two rows, every description with letters and a quantity line of its own; anything else is left as it is.
 */
export function rebuildHeaderlessLists<T extends CellLine>(src: T[], opts: { ignoreBlank?: boolean } = {}): boolean {
  const bb = (s: T) => !opts.ignoreBlank && s.blankBefore
  const isText = (t: string) => /[A-Za-z]{3}/.test(t) && !NUM.test(t) && !UNIT.test(t) && !t.includes('\t') && t.length <= 160
  let changed = false
  for (let k = 0; k < src.length; k++) {
    const rows: string[] = []
    let j = k
    let withUnit = 0
    while (j + 1 < src.length) {
      const d = (src[j] as T).t
      const q = (src[j + 1] as T).t
      if (!isText(d) || !/^\d[\d,]*(?:\.\d+)?$/.test(q) || (j > k && bb(src[j] as T) && !opts.ignoreBlank)) break
      const u = (src[j + 2] as T | undefined)?.t
      if (u !== undefined && UNIT.test(u)) {
        rows.push(`${d}\t${q}\t${u}`)
        withUnit++
        j += 3
      } else {
        rows.push(`${d}\t${q}`)
        j += 2
      }
    }
    // A plain description/quantity list is read as it is already; the rows are rebuilt only when a unit line is there to place.
    if (rows.length < 2 || withUnit === 0) continue
    const base = src[k] as T
    src.splice(k, j - k, ...rows.map((r, i) => ({ ...base, t: r, blankBefore: i === 0 ? base.blankBefore : false })))
    k += rows.length - 1
    changed = true
  }
  return changed
}

// ------------------------------------------------------------------------------------------------ grids a picture reader broke

const HEAD_VOCAB = ['product', 'service', 'name', 'description', 'quantity', 'unit', 'price', 'total', 'amount', 'item', 'model', 'brand', 'currency', 'delivery']

const editWithin1 = (a: string, b: string): boolean => {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/** A header cell as a picture reader may have misread it ("Product/Service Nase", "Unie Price (USD)", "Xo."), put right; null when it is not one. */
function fuzzyHeaderCell(raw: string): string | null {
  const t = raw.trim()
  if (!t || t.length > 40 || /\d{2,}/.test(t.replace(/\([^)]*\)/g, ''))) return null
  // The serial-number heading, one letter off ("Xo.", "Ne", "N0.").
  if (/^[A-Za-z][Oo0]\.?$/.test(t)) return 'No.'
  const words = t.split(/(\W+)/)
  let hit = 0
  const fixed = words.map(w => {
    if (!/^[A-Za-z]{4,}$/.test(w)) return w
    const lw = w.toLowerCase()
    const v = HEAD_VOCAB.find(x => x === lw || (x.length >= 4 && editWithin1(lw, x)))
    if (!v) return w
    hit++
    return w[0] === w[0]?.toUpperCase() ? v[0]!.toUpperCase() + v.slice(1) : v
  })
  return hit > 0 || isHeaderCell(t) ? fixed.join('') : null
}

/**
 * A grid whose heading a picture reader gave one cell per line ("No." / "Product/Service Name" / "Unit Price (USD)" / "Quantity" /
 * "Total Price (USD)"), with the rows under it as tab rows of that many cells: the heading is put back as one tab row, its
 * misread words ("Nase", "Unie") put right, so a reader maps the columns by what they are called.
 */
export function joinSplitHeader(lines: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < lines.length; i++) {
    let n = 0
    while (i + n < lines.length && n < 12 && !(lines[i + n] ?? '').includes('\t') && fuzzyHeaderCell(lines[i + n] ?? '') !== null) n++
    const row = lines[i + n] ?? ''
    if (n >= 3 && row.includes('\t') && cellsOf(row).length === n) {
      const cells = lines.slice(i, i + n).map(l => fuzzyHeaderCell(l) as string)
      if (cells.filter(isHeaderCell).length >= 2) {
        out.push(cells.join('\t'))
        i += n - 1
        continue
      }
    }
    out.push(lines[i] as string)
  }
  return out
}

/**
 * Grid rows a reader gave with single spaces between the cells ("1 PSR60-600-70 378 2 756"): a serial number, the item, then three
 * amounts, on two or more lines running, become tab rows so the serial number is a column of its own and never a price.
 */
export function tabulateSpacedRows(lines: string[]): string[] {
  const ROW = /^(\d{1,3})[ ]+(\S.*?)[ ]+(\d[\d,]*(?:\.\d+)?)[ ]+(\d[\d,]*(?:\.\d+)?)[ ]+(\d[\d,]*(?:\.\d+)?)\s*$/
  const ok = (l: string | undefined) => {
    const m = l !== undefined && !l.includes('\t') ? ROW.exec(l.trim()) : null
    // (An item that ends in a plain number is one more column than three amounts: "1 Pump 5 48.00 240.00 4".)
    return m !== null && /[A-Za-z]/.test(m[2] as string) && !/\s\d[\d,.]*$/.test(m[2] as string)
  }
  return lines.map((l, i) => {
    if (!ok(l) || !(ok(lines[i - 1]) || ok(lines[i + 1]))) return l
    return (ROW.exec(l.trim()) as RegExpExecArray).slice(1, 6).join('\t')
  })
}
