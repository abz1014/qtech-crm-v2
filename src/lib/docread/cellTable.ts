// A table copied from a web page or a phone app as one cell per line ("Sr. No" / "Particulars" / "QTY" / "UOM", then "1" /
// "Silicone sealant 300 ml" / "12" / "Nos." ...) put back into tab rows, the shape a spreadsheet paste has, so the enquiry and
// supplier-quote parsers read it as they read any table. Pure and framework-free.
//
// The header is a run of three or more header words, one per line (it must name a description and a quantity, or a price).
// Each row starts at its serial number when the first column is "S.No" / "#" / "Item"; empty cells are not written by most
// copies, so a row's cells are placed by what they are: a number under Qty or Price, a unit under UOM, a code under Part No,
// "-" anywhere. The next serial number starts the next row once this row has its quantity (a quantity can equal the next
// serial: "5" / "Limit switch" / "6" / "PC" / "6" / ...).

import { isHeaderCell } from './pdfLayout'

type Kind = 'number' | 'desc' | 'qty' | 'unit' | 'code' | 'make' | 'date' | 'money' | 'text'

const UNIT = /^(?:nos?\.?|no's|numbers?|pcs?\.?|pieces?|ea|each|units?|sets?|lots?|pairs?|prs?|rolls?|mtrs?|meters?|metres?|m|rmt?|ltrs?|litres?|l|kgs?|ft|lengths?|boxe?s?|pkts?|packets?|bags?|drums?|cans?|sheets?|coils?|cartons?|adad)$/i
const NUM = /^\d[\d,]*(?:\.\d+)?$/
const MONEY = /^(?:[A-Za-z$€¥￥£₨.]{0,4}\s?)?\d[\d,]*(?:\.\d+)?(?:\/-)?(?:\s?[A-Za-z$€]{0,4})?$/
const PLACEHOLDER = /^[-–—]$|^n\/?a$/i

function headerKind(label: string, hasDesc: boolean): Kind {
  if (/^(?:s\.?\s*no|s\.?\s*#|sr|sl|#|no\.?$|pos|line|itm)/i.test(label) || (hasDesc && /^item(?:\s*no\.?)?$/i.test(label))) return 'number'
  if (/desc|particular|specification|product|item\s*name|short\s*text|goods|^item$/i.test(label)) return 'desc'
  if (/qty|quantity/i.test(label)) return 'qty'
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
      return NUM.test(c)
    case 'unit':
      return UNIT.test(c)
    case 'code':
      return !/\s/.test(c) && /\d/.test(c) && /[A-Za-z]/.test(c) && c.length >= 3
    case 'date':
      return /\d{1,4}[./-]\d{1,2}[./-]\d{1,4}|\d{1,2}\s+[A-Za-z]{3}/.test(c)
    case 'money':
      return MONEY.test(c)
    case 'make':
      return !/\d/.test(c) && c.split(' ').length <= 3
    default:
      return true
  }
}

/** Each cell goes to the first column from the last placed one on that it fits; a cell that fits none goes on the text before. */
function place(cells: string[], kinds: Kind[]): { out: string[]; col: number } {
  const out: string[] = kinds.map(() => '')
  let col = 0
  for (const c of cells) {
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
export function rebuildCellTables<T extends CellLine>(src: T[], stop: (t: string) => boolean = () => false): boolean {
  let changed = false
  for (let k = 0; k < src.length; k++) {
    let e = k
    while (e < src.length) {
      const t = (src[e] as T).t
      if (/\d|\t/.test(t.replace(/\(.*?\)/g, '')) || t.split(' ').length > 4 || !isHeaderCell(t) || (e > k && (src[e] as T).blankBefore)) break
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
      if ((numbered && first.replace(/\.$/, '') !== String(serial)) || first.includes('\t')) break
      const cells: string[] = numbered ? [first] : []
      let q = numbered ? j + 1 : j
      const width = numbered ? Infinity : labels.length
      const hasNeed = () => cells.some((c, x) => x > (numbered ? 1 : 0) && (need === 'qty' ? NUM.test(c) : MONEY.test(c)))
      while (q < src.length && cells.length < width && !(src[q] as T).blankBefore) {
        const t = (src[q] as T).t
        // The next serial number starts the next row (followed by its description, not by another number: a last cell can
        // equal the next serial, "... 6240.00 / 2 / 2 / Amerix ...").
        const after = (src[q + 1] as T | undefined)?.t ?? ''
        if (numbered && hasNeed() && t.replace(/\.$/, '') === String(serial + step) && !NUM.test(after)) break
        // A row that already has its cells (tab separated) is a table of its own: the header words above are stacked headings.
        if (stop(t) || t.includes('\t')) break
        // A sentence under a complete row is the text after the table ("Last date for submission: 3 November").
        if (hasNeed() && (/[A-Za-z]:\s/.test(t) || t.split(' ').length >= 7)) break
        // With no serial column, empty cells at the end of a row ("4" / "NO" / "Panel meter" / "" under Part No) are not
        // written either: a cell that fits no column from here on but fits the first one (a quantity) starts the next row.
        if (!numbered && cells.length && kinds[0] !== 'desc' && kinds[0] !== 'text' && !PLACEHOLDER.test(t)) {
          const { out, col } = place(cells, kinds)
          if (out.some((v, x) => v && kinds[x] === 'desc') && fits(kinds[0] as Kind, t) && kinds.slice(col).every(k => !fits(k, t))) break
        }
        cells.push(t)
        q++
        if (numbered && cells.length >= labels.length) break
      }
      const { out } = place(cells, kinds)
      if (!out.some((v, x) => v && kinds[x] === 'desc')) break
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
