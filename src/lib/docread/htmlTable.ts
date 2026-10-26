// What a paste really holds. Outlook, Gmail and Excel put a table on the clipboard as HTML (text/html) and as plain text, but the
// plain text of an Outlook table is one cell per line with no tabs. This turns the HTML's tables into tab rows (the shape a
// spreadsheet paste has) and keeps the text around them, so the enquiry and reply readers see the columns. No dependency:
// a small walk over the DOM the browser parses. A paste with no table in it is read as plain text, exactly as before.

const BLOCK = new Set(['P', 'DIV', 'LI', 'UL', 'OL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HR', 'TR', 'DL', 'DT', 'DD', 'FORM', 'ADDRESS'])
const SKIP = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'META', 'LINK', 'NOSCRIPT', 'TEMPLATE'])

const clean = (s: string) => s.replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/\s+/g, ' ').trim()

/** The text of one table cell: its words on one line (a cell's own paragraphs and line breaks become spaces). */
function cellText(cell: Element): string {
  let out = ''
  const go = (n: Node): void => {
    if (n.nodeType === 3) out += n.nodeValue ?? ''
    else if (n.nodeType === 1) {
      const el = n as Element
      if (SKIP.has(el.tagName)) return
      const gap = el.tagName === 'BR' || BLOCK.has(el.tagName) || el.tagName === 'TD' || el.tagName === 'TH' || el.tagName === 'TABLE'
      if (gap) out += ' '
      for (const c of Array.from(el.childNodes)) go(c)
      if (gap) out += ' '
    }
  }
  go(cell)
  return clean(out)
}

/** The rows of a table, one tab-joined line each, nested tables flattened into their cell's text. Empty rows are left out. */
function tableLines(table: Element): string[] {
  const lines: string[] = []
  for (const tr of Array.from(table.querySelectorAll('tr'))) {
    // A row of a table nested in a cell is that cell's text, not a row of this table.
    if (tr.closest('table') !== table) continue
    const cells = Array.from(tr.children).filter(c => c.tagName === 'TD' || c.tagName === 'TH')
    const texts = cells.map(cellText)
    if (texts.some(Boolean)) lines.push(texts.join('\t').replace(/\t+$/, ''))
  }
  return lines
}

/**
 * The text of a pasted HTML fragment with its tables as tab rows; null when the HTML holds no table (the caller then reads the
 * plain text). Block elements and line breaks end a line; inline text runs together.
 */
export function htmlTableText(html: string): string | null {
  if (!html || !/<table[\s>]/i.test(html) || typeof DOMParser === 'undefined') return null
  const doc = new DOMParser().parseFromString(html, 'text/html')
  if (!doc.querySelector('table')) return null
  const lines: string[] = []
  let cur = ''
  const flush = () => {
    const t = clean(cur)
    if (t) lines.push(t)
    cur = ''
  }
  const walk = (node: Node): void => {
    if (node.nodeType === 3) {
      cur += node.nodeValue ?? ''
      return
    }
    if (node.nodeType !== 1) return
    const el = node as Element
    if (SKIP.has(el.tagName)) return
    if (el.tagName === 'TABLE') {
      flush()
      lines.push(...tableLines(el))
      return
    }
    if (el.tagName === 'BR') {
      flush()
      return
    }
    const block = BLOCK.has(el.tagName)
    if (block) flush()
    for (const c of Array.from(el.childNodes)) walk(c)
    if (block) flush()
  }
  walk(doc.body)
  flush()
  return lines.length ? lines.join('\n') : null
}

/** The clipboard's text for the readers: the HTML's tables as tab rows when it has any, else the plain text. */
export function pastedText(data: Pick<DataTransfer, 'getData'> | null | undefined): string {
  if (!data) return ''
  let html = ''
  try {
    html = data.getData('text/html')
  } catch {
    html = ''
  }
  const fromHtml = html ? htmlTableText(html) : null
  if (fromHtml?.trim()) return fromHtml
  return data.getData('text/plain') ?? ''
}

/** The same for the Paste buttons that read the clipboard themselves: the HTML's tables when the browser lets it be read, else the plain text. */
export async function readClipboardText(): Promise<string> {
  const clip = typeof navigator === 'undefined' ? undefined : navigator.clipboard
  if (clip?.read) {
    try {
      for (const item of await clip.read()) {
        if (!item.types.includes('text/html')) continue
        const fromHtml = htmlTableText(await (await item.getType('text/html')).text())
        if (fromHtml?.trim()) return fromHtml
      }
    } catch {
      // not allowed or not supported: the plain text below
    }
  }
  return clip?.readText ? await clip.readText() : ''
}
