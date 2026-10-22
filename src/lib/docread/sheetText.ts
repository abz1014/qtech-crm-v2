// Reads a customer's spreadsheet (.xlsx, .xls, .csv) on this device into the text a paste of it would give, for the same parser
// a paste goes through (enquiryParse, or the quote parser for a supplier's price sheet). SheetJS is loaded only when a sheet is
// read (sheetRuntime.ts, its own lazy chunk); nothing is uploaded.
//
// The item table is found by its header row (the first row with a description column and a quantity column, after any title,
// address, RFQ number or date rows above it), and its columns are mapped: S.No, Description, Specification, Part No, Make, Qty
// and Unit are kept under their plain names; store codes, rates, amounts, dates and remarks are left out, so the parser sees one
// clean table. Rows above the table (RFQ No, due date, company) and below it (terms) come through as text lines. A sheet with no
// such header row comes through cell by cell, tab-separated, as Excel copies it. Nothing is saved: the person checks the items.

export const SHEET_MAX_BYTES = 15 * 1024 * 1024
/** Rows read from one sheet: an enquiry is never longer; a price list exported whole would be. */
const MAX_ROWS = 2000

export const SHEET_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
] as const

export type SheetReadFailure = 'not_sheet' | 'too_big' | 'password' | 'empty' | 'unreadable' | 'unavailable'
export type SheetSubject = 'items' | 'prices'

export interface SheetTextOk {
  ok: true
  text: string
  /** The sheet the text came from. */
  sheet: string
  /** True when an item table was found by its header row (and its columns mapped). */
  table: boolean
}

export interface SheetTextFail {
  ok: false
  reason: SheetReadFailure
  message: string
}

export type SheetTextResult = SheetTextOk | SheetTextFail

/** .xlsx, .xls or .csv, by type or, when the type is missing or generic, by name. */
export function isSheetFile(file: { type?: string; name?: string }): boolean {
  if (file.type && (SHEET_TYPES as readonly string[]).includes(file.type)) return true
  if (file.type === 'application/csv') return true
  return /\.(?:xlsx|xlsm|xls|csv)$/i.test(file.name ?? '')
}

export function sheetFailureMessage(reason: SheetReadFailure, subject: SheetSubject, size?: number): string {
  const what = subject === 'prices' ? 'the prices' : 'the items'
  switch (reason) {
    case 'not_sheet':
      return `This file is not a spreadsheet. Copy ${what} and paste them.`
    case 'too_big':
      return `This spreadsheet is ${size ? `${Math.round(size / (1024 * 1024))} MB` : 'too big'}; the limit is 15 MB. Copy ${what} in Excel and paste them.`
    case 'password':
      return `This spreadsheet is locked with a password. Open it in Excel, copy ${what} and paste them.`
    case 'empty':
      return `This spreadsheet has nothing to read. Copy ${what} and paste them.`
    case 'unavailable':
      return `The spreadsheet reader could not start (it needs the internet the first time). Try again, or copy ${what} and paste them.`
    case 'unreadable':
      return `This spreadsheet could not be read. Copy ${what} in Excel and paste them.`
  }
}

// ------------------------------------------------------------------------------------------------ the item table

type Role = 'sno' | 'desc' | 'spec' | 'part' | 'make' | 'qty' | 'unit' | 'code'

const NAME: Record<Exclude<Role, 'code'>, string> = { sno: 'S.No', desc: 'Description', spec: 'Specification', part: 'Part No', make: 'Make', qty: 'Qty', unit: 'Unit' }

/** What a header cell names, or null for a column the parser does not need (rate, amount, date, remarks, stock...). */
export function columnRole(header: string): Role | null {
  const h = header.toLowerCase().replace(/\s+/g, ' ').replace(/[:.]+$/, '').trim()
  if (!h) return null
  if (/\b(?:stock|on hand|available|balance|issued|received|consum|last|previous)\b/.test(h)) return null
  if (/^(?:s\.? ?no|sr\.? ?(?:no|#)?|sl\.? ?no|#|no|item ?(?:no|#)|line(?: no)?|pos(?:ition)?|s ?#)$/.test(h)) return 'sno'
  if (/^(?:item ?code|material(?: ?(?:no|code|number))?|code|stock ?code|sap ?code|erp ?code|article(?: ?no)?|store ?code)$/.test(h)) return 'code'
  if (/part ?(?:no|number|#)|^model|cat(?:alogue|alog)?\.? ?(?:no|number)|order ?code|mfr\.? ?part|^p\/n$|make ?\/ ?model/.test(h)) return 'part'
  if (/^(?:make|brand|manufacturer|mfr|oem|origin ?\/ ?make)$/.test(h)) return 'make'
  if (/spec|technical|details/.test(h)) return 'spec'
  if (/desc|particular|item ?name|product|goods|short ?text|^items?$|^material description$|^name$/.test(h)) return 'desc'
  if (/\b(?:unit ?(?:price|rate|cost)|rate|price|amount|value|total)\b/.test(h)) return null
  if (/^(?:qty|quantity|q'ty|qnty|req(?:uired)?\.? ?qty|qty ?req(?:uired|d)?|required ?(?:qty|quantity)|order ?qty|nos)$/.test(h) || /\bqty\b|\bquantity\b/.test(h)) return 'qty'
  if (/^(?:uom|u\/m|unit|units|unit of measure(?:ment)?|measure)$/.test(h)) return 'unit'
  return null
}

interface Found {
  row: number
  cols: Array<{ i: number; role: Exclude<Role, 'code'> }>
}

/** The header row of the item table: the first row (of the first 60) naming a description and a quantity. */
export function findHeader(rows: string[][]): Found | null {
  for (let r = 0; r < Math.min(rows.length, 60); r++) {
    const cells = rows[r] as string[]
    let roles = cells.map(c => (c && !/\d{3,}/.test(c) ? columnRole(c) : null))
    // "Item | Description | ...": a bare "Item" beside a description column numbers the rows.
    const bare = (c: string) => /^items?$/i.test(c.trim())
    if (cells.some((c, i) => roles[i] === 'desc' && !bare(c))) roles = roles.map((ro, i) => (ro === 'desc' && bare(cells[i] as string) ? 'sno' : ro))
    if (!roles.includes('desc') || !roles.includes('qty')) continue
    const cols: Found['cols'] = []
    const taken = new Set<Role>()
    roles.forEach((role, i) => {
      if (!role || role === 'code') return
      // One column per role; a second description column ("Item" and "Description") is kept as the specification.
      const r2 = taken.has(role) ? (role === 'desc' && !taken.has('spec') ? 'spec' : null) : role
      if (!r2) return
      taken.add(r2)
      cols.push({ i, role: r2 })
    })
    return { row: r, cols }
  }
  return null
}

/** A sheet's rows as text: each cell trimmed, numbers without float noise, dates as YYYY-MM-DD. */
function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Date) {
    const p = (n: number) => String(n).padStart(2, '0')
    return `${v.getFullYear()}-${p(v.getMonth() + 1)}-${p(v.getDate())}`
  }
  if (typeof v === 'number') return Number.isFinite(v) ? String(Number(v.toFixed(6))) : ''
  return String(v).replace(/\s+/g, ' ').trim()
}

const END_ROW = /^(?:sub\s*-?\s*total|grand\s+total|total|terms|terms\s*(?:and|&)\s*conditions|note|notes|remarks|prepared\s+by|approved\s+by|checked\s+by)\b/i

/** One sheet's rows as the text a paste would give: the table's columns mapped by its header row, or every row as it is. */
export function sheetRowsText(rows: string[][], subject: SheetSubject): { text: string; table: boolean } {
  const trimmed = rows.map(r => {
    const out = [...r]
    while (out.length && !out[out.length - 1]) out.pop()
    return out
  })
  const plain = (r: string[]) => r.filter(Boolean).join(' ')
  const found = subject === 'items' ? findHeader(trimmed) : null
  if (!found) {
    // No item table to map (or a supplier's price sheet, read with every column): the rows as Excel copies them.
    return { text: trimmed.map(r => r.join('\t')).join('\n').replace(/\n{3,}/g, '\n\n').trim(), table: false }
  }
  const out: string[] = []
  for (const r of trimmed.slice(0, found.row)) out.push(plain(r))
  out.push('')
  // Always in one order, the quantity and then its unit at the end of the row ("... 12.5 MTR"), so the customer's unit word is
  // kept as written whichever order the sheet had.
  const ORDER: Array<Exclude<Role, 'code'>> = ['sno', 'desc', 'spec', 'part', 'make', 'qty', 'unit']
  const cols = [...found.cols].sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role))
  out.push(cols.map(c => NAME[c.role]).join('\t'))
  const at = (r: string[], role: Role) => {
    const c = found.cols.find(x => x.role === role)
    return c ? (r[c.i] ?? '') : ''
  }
  let blanks = 0
  let k = found.row + 1
  for (; k < trimmed.length; k++) {
    const r = trimmed[k] as string[]
    if (r.every(c => !c)) {
      if (++blanks >= 2) break
      continue
    }
    blanks = 0
    const first = r.find(Boolean) ?? ''
    if (END_ROW.test(first) && !at(r, 'qty')) break
    const desc = [at(r, 'desc'), at(r, 'spec')].filter(Boolean).join(' ')
    if (!desc && !at(r, 'qty')) continue
    out.push(cols.map(c => r[c.i] ?? '').join('\t'))
  }
  const after = trimmed.slice(k).map(plain).filter(Boolean)
  if (after.length) out.push('', ...after)
  return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), table: true }
}

// ------------------------------------------------------------------------------------------------ the file

async function bytesOf(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') return new Uint8Array(await file.arrayBuffer())
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(new Uint8Array(fr.result as ArrayBuffer))
    fr.onerror = () => reject(fr.error)
    fr.readAsArrayBuffer(file)
  })
}

/** A CSV's text: UTF-8 (with or without its byte-order mark), else the Windows code page Excel saves "CSV" in. */
function csvText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\s*/, m => m.replace(String.fromCharCode(0xfeff), ''))
  } catch {
    return new TextDecoder('windows-1252').decode(bytes)
  }
}

export interface ReadSheetOptions {
  subject?: SheetSubject
}

export async function readSheetText(file: File, opts: ReadSheetOptions = {}): Promise<SheetTextResult> {
  const subject = opts.subject ?? 'items'
  const fail = (reason: SheetReadFailure, size?: number): SheetTextFail => ({ ok: false, reason, message: sheetFailureMessage(reason, subject, size) })
  if (!isSheetFile(file)) return fail('not_sheet')
  if (file.size > SHEET_MAX_BYTES) return fail('too_big', file.size)
  let x: typeof import('./sheetRuntime')
  try {
    x = await import('./sheetRuntime')
  } catch {
    return fail('unavailable')
  }
  let wb: ReturnType<typeof x.read>
  try {
    const csv = /\.csv$/i.test(file.name) || file.type === 'text/csv' || file.type === 'application/csv'
    const bytes = await bytesOf(file)
    // A CSV is kept as typed (raw): "20/10/2026" is not turned into a US date, nor "1,000" into a number.
    wb = csv ? x.read(csvText(bytes), { type: 'string', raw: true, sheetRows: MAX_ROWS }) : x.read(bytes, { type: 'array', cellDates: true, sheetRows: MAX_ROWS })
  } catch (e) {
    return fail(/password|encrypt/i.test(String((e as Error)?.message ?? e)) ? 'password' : 'unreadable')
  }
  // The sheet with an item table (the most rows under its header), else the first sheet with anything in it.
  let best: { name: string; text: string; table: boolean; weight: number } | null = null
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    if (!ws) continue
    const raw = x.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '', blankrows: true })
    const rows = raw.map(r => (Array.isArray(r) ? r.map(cellText) : []))
    if (!rows.some(r => r.some(Boolean))) continue
    const r = sheetRowsText(rows, subject)
    const weight = (r.table ? 100_000 : 0) + r.text.split('\n').length
    if (!best || weight > best.weight) best = { name, text: r.text, table: r.table, weight }
  }
  if (!best || !best.text.trim()) return fail('empty')
  return { ok: true, text: best.text, sheet: best.name, table: best.table }
}
