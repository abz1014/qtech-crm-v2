/** Minimal RFC 4180 reader and writer. A line starting with # is a comment; a leading BOM is ignored. */

export function parseCsv(text: string): Record<string, string>[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let atLineStart = true
  let skipLine = false

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
    atLineStart = true
  }

  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    if (skipLine) {
      if (c === '\n') {
        skipLine = false
        atLineStart = true
      }
      continue
    }
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
      continue
    }
    if (atLineStart && c === '#') {
      skipLine = true
      continue
    }
    atLineStart = false
    if (c === '"' && field === '') inQuotes = true
    else if (c === ',') endField()
    else if (c === '\n') endRow()
    else if (c !== '\r') field += c
  }
  if (field !== '' || row.length > 0) endRow()

  const header = rows.shift()?.map(h => h.trim().toLowerCase())
  if (!header) return []
  return rows.map(r => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()])))
}

function cell(v: unknown): string {
  if (v === null || v === undefined) return ''
  let s = typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : JSON.stringify(v)
  // Review lists are opened in a spreadsheet: never let a text cell start a formula.
  if (typeof v === 'string' && /^[=+@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(columns: string[], rows: Record<string, unknown>[]): string {
  return [columns.join(','), ...rows.map(r => columns.map(c => cell(r[c])).join(','))].join('\n') + '\n'
}
