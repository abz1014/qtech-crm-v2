// R05: turns what the customer sent (a pasted email or item list) into item rows. Pure and framework-free.
//
// One paste, no typing: each line becomes an item with a quantity, a unit and the brand and family it names.
// Greetings, sign-offs and email headers are skipped and shown as skipped, so the split can be trusted at a glance
// (g2-intake-float frame 3). Every cell stays editable on screen: this is a first guess, never a decision.
//
// Rules:
//  - If any line carries a list marker ("1)", "2.", "- ", "#3"), only marked lines are items. Otherwise every line that
//    is not a greeting, a sign-off or an email header is an item.
//  - Quantity is read from the END of the line ("- 2 nos", "x 4", "qty 2", "2 pcs") or from its START ("2 x Pump",
//    "10 nos cable"). A model code or a size ("DN50", "0-10 bar", "24V") is never taken for a quantity.
//  - No quantity found: 1, and no unit (the screen says qty defaults to 1; DATA_MODEL rfq_items.qty).

export interface ParsedItem {
  description: string
  qty: number
  unit: string | null
}

export interface PastedLine {
  text: string
  /** item: became a row. skipped: greeting, sign-off or header. */
  kind: 'item' | 'skipped'
  /** The list marker at the start of an item line ("1)"), shown highlighted. */
  marker: string | null
}

export interface ParseResult {
  items: ParsedItem[]
  lines: PastedLine[]
  /** Non-empty lines in the paste. */
  lineCount: number
}

const MARKER = /^\s*(?:\(?\d{1,3}\)\s*|\d{1,3}[.:]\s+|[-•*·–]\s+|#\s*\d{1,3}[.:)]?\s+)/

const SKIP =
  /^(?:dear\b|hi\b|hello\b|hey\b|salam\b|assalam|asalam|aoa\b|good (?:morning|afternoon|evening)\b|regards\b|best regards\b|kind regards\b|warm regards\b|thanks\b|thank you\b|thankyou\b|sincerely\b|yours\b|please\b|kindly\b|sent from\b|from:|to:|cc:|bcc:|subject:|sent:|date:|on .{3,80} wrote:)/i

/** Units as written -> the unit stored. Safe units may follow a number after a space; ambiguous ones need a separator. */
const SAFE_UNITS: Record<string, string> = {
  no: 'nos', nos: 'nos', pc: 'nos', pcs: 'nos', piece: 'nos', pieces: 'nos', unit: 'nos', units: 'nos', each: 'nos', ea: 'nos',
  set: 'set', sets: 'set', lot: 'lot', lots: 'lot', pair: 'pair', pairs: 'pair', roll: 'roll', rolls: 'roll',
  mtr: 'm', mtrs: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm',
  ltr: 'l', ltrs: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
}
const AMBIGUOUS_UNITS: Record<string, string> = { m: 'm', kg: 'kg', g: 'g', l: 'l', ft: 'ft', km: 'km' }

const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)`
const SAFE = Object.keys(SAFE_UNITS).join('|')
const AMBIG = Object.keys(AMBIGUOUS_UNITS).join('|')
const ANY_UNIT = `${SAFE}|${AMBIG}`

const LEADING = new RegExp(String.raw`^${NUM}\s*(?:x|×|(${SAFE}))\b\.?\s*[-:,]?\s*(.+)$`, 'i')
const TRAIL_QTY = new RegExp(String.raw`(?:^|[\s,;(–-])(?:qty|quantity|q'ty)\s*[:=]?\s*${NUM}\s*(${ANY_UNIT})?\s*\)?\s*[.;]?\s*$`, 'i')
const TRAIL_X = new RegExp(String.raw`(?:^|\s)[x×]\s*${NUM}\s*(${ANY_UNIT})?\s*\)?\s*[.;]?\s*$`, 'i')
const TRAIL_SAFE = new RegExp(String.raw`(?:^|[\s,;(–-])\s*${NUM}\s*(${SAFE})\s*\)?\s*[.;]?\s*$`, 'i')
const TRAIL_AMBIG = new RegExp(String.raw`[,;(–-]\s*${NUM}\s*(${AMBIG})\s*\)?\s*[.;]?\s*$`, 'i')

function toQty(raw: string): number {
  const n = Number(raw.replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function normaliseUnit(raw: string | null | undefined): string | null {
  const u = (raw ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!u) return null
  return SAFE_UNITS[u] ?? AMBIGUOUS_UNITS[u] ?? u
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/[\s\-–,;:(]+$/, '').trim()

/** One item line (marker already removed) into description, quantity and unit. */
export function parseItemLine(line: string): ParsedItem {
  const text = line.trim()
  const lead = LEADING.exec(text)
  if (lead && lead[3]) {
    return { description: tidy(lead[3]), qty: toQty(lead[1]), unit: lead[2] ? normaliseUnit(lead[2]) : null }
  }
  for (const re of [TRAIL_QTY, TRAIL_X, TRAIL_SAFE, TRAIL_AMBIG]) {
    const m = re.exec(text)
    if (m && m.index !== undefined) {
      const rest = tidy(text.slice(0, m.index))
      if (rest) return { description: rest, qty: toQty(m[1]), unit: normaliseUnit(m[2]) }
    }
  }
  return { description: tidy(text), qty: 1, unit: null }
}

export function parsePaste(raw: string): ParseResult {
  const lines = raw
    .split(/\r?\n/)
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const looksSkipped = (l: string) => SKIP.test(l.replace(MARKER, '')) || /:$/.test(l)
  const marked = lines.filter(l => MARKER.test(l) && !looksSkipped(l))
  const useMarkers = marked.length > 0

  const out: PastedLine[] = []
  const items: ParsedItem[] = []
  for (const l of lines) {
    const m = MARKER.exec(l)
    const isItem = useMarkers ? Boolean(m) && !looksSkipped(l) : !looksSkipped(l)
    if (!isItem) {
      out.push({ text: l, kind: 'skipped', marker: null })
      continue
    }
    const body = m ? l.slice(m[0].length) : l
    const parsed = parseItemLine(body)
    if (!parsed.description) {
      out.push({ text: l, kind: 'skipped', marker: null })
      continue
    }
    items.push(parsed)
    out.push({ text: body, kind: 'item', marker: m ? m[0].trim() : null })
  }
  return { items, lines: out, lineCount: lines.length }
}

// ------------------------------------------------------------------------------------------------ brand and family

export interface BrandRef {
  id: string
  name: string
  kind: 'brand' | 'family'
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function mentions(description: string, name: string): boolean {
  const n = name.trim()
  if (n.length < 2) return false
  return new RegExp(`(?:^|[^a-z0-9])${esc(n)}(?:$|[^a-z0-9])`, 'i').test(description)
}

/** Singular and plural spellings of a family name ("Flow meters" also matches "flow meter"). */
function familyForms(name: string): string[] {
  const n = name.trim()
  const forms = new Set([n])
  if (/ies$/i.test(n)) forms.add(n.replace(/ies$/i, 'y'))
  if (/(?:ses|xes|ches|shes)$/i.test(n)) forms.add(n.replace(/es$/i, ''))
  if (/s$/i.test(n) && !/ss$/i.test(n)) forms.add(n.replace(/s$/i, ''))
  return [...forms]
}

/**
 * The brand and the family the description names, from the lists already on file. The longest name wins, so
 * "Endress+Hauser" is preferred over a brand called "Endress". Nothing is invented: a name that is not on file
 * is not guessed. Both are optional and editable.
 */
export function guessBrandFamily(
  description: string,
  brands: readonly BrandRef[],
): { brandId: string | null; familyId: string | null } {
  let brand: BrandRef | null = null
  let family: BrandRef | null = null
  for (const b of brands) {
    if (b.kind === 'brand') {
      if (mentions(description, b.name) && (!brand || b.name.length > brand.name.length)) brand = b
    } else if (familyForms(b.name).some(f => mentions(description, f)) && (!family || b.name.length > family.name.length)) {
      family = b
    }
  }
  return { brandId: brand?.id ?? null, familyId: family?.id ?? null }
}

// ------------------------------------------------------------------------------------------------ model codes

const UNIT_LIKE = /^\d+(?:V|VAC|VDC|MA|MM|CM|M|KV|KW|W|HZ|BAR|PSI|C)$/

/**
 * The model codes in a description, as the database computes rfq_items.model_tokens (DATA_MODEL 2.8, A2b): upper-case,
 * split on spaces and commas, strip - . /, keep a token of 4 or more characters with a letter and a digit, drop
 * quantity-and-unit shapes ("24V", "420MA"). Used only to name the model in a supplier's reason.
 */
export function modelTokens(text: string): string[] {
  const out: string[] = []
  for (const raw of text.toUpperCase().split(/[\s,]+/)) {
    const t = raw.replace(/[-./]/g, '')
    if (t.length >= 4 && /[A-Z]/.test(t) && /\d/.test(t) && !UNIT_LIKE.test(t) && !out.includes(t)) out.push(t)
  }
  return out
}
