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

import { inferCategory } from '@/lib/categories/dictionary'

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
  /^(?:dear\b|hi\b|hello\b|hey\b|salam\b|assalam|asalam|aoa\b|good (?:morning|afternoon|evening)\b|regards\b|best regards\b|kind regards\b|warm regards\b|thanks\b|thank you\b|thankyou\b|sincerely\b|yours\b|sent from\b|from:|to:|cc:|bcc:|subject:|sent:|date:|on .{3,80} wrote:)/i

// Audit E1: polite openers ("Please quote 2 nos ...", "Sir plz send rate for ...") are stripped, not skipped. What is left is an
// item when it carries a number or reads like a product; pure courtesy ("Please reply soon") is skipped.
const POLITE =
  /^(?:(?:assalam[a-z ]{0,20}|asalam[a-z ]{0,20}|aoa|salam|hi|hello|hey|dear(?: sir| madam)?|good (?:morning|afternoon|evening)|sir|madam|bhai|sahib|janab|boss|we request you to|i request you to|request you to|can you|could you|please|plz+|pls|kindly)\b[\s,.:!-]*)+/i
const ASK_VERB =
  /^(?:(?:provide|send|share|arrange|give)\s+(?:us\s+)?(?:the\s+)?)?(?:(?:best\s+)?(?:quotation|quote|rates?|prices?|offer)\b\s*)*(?:(?:for|of)\b)?\s*/i
const COURTESY =
  /^(?:the following|following|the below|below|the items|our |reply|revert|respond|confirm|let me|let us|at the earliest|asap|today|soon|urgent|find|note|acknowledge|check|call|advise|update|do the needful|share|send|provide|bata|batao|thanks|thank)/i

/** The line without its polite opener, or null when nothing item-like is left (a courtesy line). Lines with no opener pass through. */
function stripPolite(line: string): string | null {
  const m = POLITE.exec(line)
  if (!m) return line
  const rest0 = line.slice(m[0].length)
  const rest = rest0.slice(ASK_VERB.exec(rest0)![0].length).replace(/^[\s,.:!-]+/, '').trim()
  if (!rest) return null
  if (/\d/.test(rest)) return COURTESY.test(rest) && !/\d\s*(?:x|×|nos|pcs?)\b/i.test(rest) ? null : rest
  if (COURTESY.test(rest) || rest.split(' ').length < 2) return null
  return rest
}

/** Rows pasted from Excel (tab separated) become "description qty N unit"; a header row is dropped. */
function fromSheetRow(line: string): string | null {
  if (!line.includes('\t')) return line
  let cells = line.split('\t').map(c => c.trim()).filter(Boolean)
  if (cells.length < 2) return cells[0] ?? null
  if (!cells.some(c => /\d/.test(c)) && cells.some(c => /^(?:desc\w*|qty|quantity|item\w*|s\.?\s?no\.?|sr\.?\s?no\.?|unit)$/i.test(c))) return null
  if (/^\d{1,3}\.?$/.test(cells[0]) && cells.length > 2) cells = cells.slice(1)
  let unit = ''
  const last = cells[cells.length - 1].toLowerCase()
  if (cells.length > 2 && (last in SAFE_UNITS || last in AMBIGUOUS_UNITS) && /^\d[\d,.]*$/.test(cells[cells.length - 2])) {
    unit = ` ${last}`
    cells = cells.slice(0, -1)
  }
  const q = cells[cells.length - 1]
  if (cells.length > 1 && /^\d[\d,.]*$/.test(q)) return `${cells.slice(0, -1).join(' ')} qty ${q}${unit}`
  return cells.join(' ')
}

/** Units as written -> the unit stored. Safe units may follow a number after a space; ambiguous ones need a separator. */
const SAFE_UNITS: Record<string, string> = {
  no: 'nos', nos: 'nos', pc: 'nos', pcs: 'nos', piece: 'nos', pieces: 'nos', unit: 'nos', units: 'nos', each: 'nos', ea: 'nos',
  // Urdu "adad" (عدد, pieces), written in Latin letters or read from the Urdu word (see urduDigits).
  adad: 'nos',
  set: 'set', sets: 'set', lot: 'lot', lots: 'lot', pair: 'pair', pairs: 'pair', roll: 'roll', rolls: 'roll',
  mtr: 'm', mtrs: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm', kgs: 'kg',
  ltr: 'l', ltrs: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l',
}
const AMBIGUOUS_UNITS: Record<string, string> = { m: 'm', kg: 'kg', g: 'g', l: 'l', ft: 'ft', km: 'km' }

const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)`
const SAFE = Object.keys(SAFE_UNITS).join('|')
const AMBIG = Object.keys(AMBIGUOUS_UNITS).join('|')
const ANY_UNIT = `${SAFE}|${AMBIG}`

const LEADING = new RegExp(String.raw`^${NUM}\s*(?:x|×|(${SAFE}))\b\.?\s*[-:,]?\s*(.+)$`, 'i')
/** "0.5 m PU tube", "2.5 kg grease": a length or weight in front, then the item's words. */
const LEADING_MEASURE = /^(\d[\d,]*(?:\.\d+)?)\s*(m|kg|l|ft)\.?\s+(?=[A-Za-z])(.+)$/i
const TRAIL_QTY = new RegExp(String.raw`(?:^|[\s,;(–-])(?:qty|quantity|q'ty)\s*[:=]?\s*${NUM}\s*(${ANY_UNIT})?\s*\)?\s*[.;]?\s*$`, 'i')
const TRAIL_X = new RegExp(String.raw`(?:^|\s)[x×]\s*${NUM}\s*(${ANY_UNIT})?\s*\)?\s*[.;]?\s*$`, 'i')
const TRAIL_SAFE = new RegExp(String.raw`(?:^|[\s,;(–-])\s*${NUM}\s*(${SAFE})\s*\)?\s*[.;]?\s*$`, 'i')
const TRAIL_AMBIG = new RegExp(String.raw`[,;(–-]\s*${NUM}\s*(${AMBIG})\s*\)?\s*[.;]?\s*$`, 'i')
/**
 * "Silicone tube 8mm 0.5 m", "Copper wire 2.5 kg": a length or weight at the end after a plain space. Decimals are allowed (a
 * length or a weight can be part of one); not the end of a range ("0-10 m", "0 to 10 m") or a measurement ("range 20 m").
 */
const TRAIL_MEASURE = /\s(\d[\d,]*(?:\.\d+)?)\s*(m|kg|l|ft)\.?\s*$/i
const MEASURE_BEFORE = /(?:[-–]|\bto|\brange|\blength|\bdepth|\bheight|\bdia(?:meter)?|\bhead|\bstroke)\s*$/i

/** Urdu and Arabic-Indic digits as ASCII, and the Urdu word for pieces (عدد) as "adad". */
export function urduDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 48))
    .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
    .replace(/[‎‏؜]/g, '')
    .replace(/ *عدد/g, ' adad')
}

function toQty(raw: string): number {
  const n = Number(raw.replace(/,/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : 1 // HW-7: a written 0 stays 0 (the intake marks it); never read as 1
}

export function normaliseUnit(raw: string | null | undefined): string | null {
  const u = (raw ?? '').trim().toLowerCase().replace(/\.$/, '')
  if (!u) return null
  return SAFE_UNITS[u] ?? AMBIGUOUS_UNITS[u] ?? u
}

const tidy = (s: string) => s.replace(/\s+/g, ' ').replace(/[\s\-–,;:(]+$/, '').trim()

/** One item line (marker already removed) into description, quantity and unit. */
export function parseItemLine(line: string): ParsedItem {
  const text = urduDigits(line).trim()
  const lead = LEADING.exec(text)
  if (lead && lead[3]) {
    return { description: tidy(lead[3]), qty: toQty(lead[1]), unit: lead[2] ? normaliseUnit(lead[2]) : null }
  }
  const leadM = LEADING_MEASURE.exec(text)
  if (leadM && tidy(leadM[3])) return { description: tidy(leadM[3]), qty: toQty(leadM[1]), unit: normaliseUnit(leadM[2]) }
  for (const re of [TRAIL_QTY, TRAIL_X, TRAIL_SAFE, TRAIL_AMBIG]) {
    const m = re.exec(text)
    if (m && m.index !== undefined) {
      const rest = tidy(text.slice(0, m.index))
      if (rest) return { description: rest, qty: toQty(m[1]), unit: normaliseUnit(m[2]) }
    }
  }
  const meas = TRAIL_MEASURE.exec(text)
  if (meas) {
    const before = text.slice(0, meas.index)
    const rest = tidy(before)
    if (rest && !MEASURE_BEFORE.test(before) && !/\d\s*$/.test(before)) return { description: rest, qty: toQty(meas[1]), unit: normaliseUnit(meas[2]) }
  }
  return { description: tidy(text), qty: 1, unit: null }
}

export function parsePaste(raw: string): ParseResult {
  const lines = urduDigits(raw)
    .split(/\r?\n/)
    .map(fromSheetRow)
    .map(l => (l ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const looksSkipped = (l: string) => {
    const body = l.replace(MARKER, '')
    return SKIP.test(body) || /:$/.test(l) || stripPolite(body) === null
  }
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
    const body = stripPolite(m ? l.slice(m[0].length) : l) ?? ''
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
  // A confident dictionary hit ("MCB") is looked up by its canonical family name; otherwise the exact-name match below applies.
  const inferred = inferCategory(description)
  const canonical =
    inferred.confidence === 'sure' && inferred.name
      ? brands.find(b => b.kind === 'family' && b.name.trim().toLowerCase() === inferred.name!.toLowerCase())
      : undefined
  for (const b of brands) {
    if (b.kind === 'brand') {
      if (mentions(description, b.name) && (!brand || b.name.length > brand.name.length)) brand = b
    } else if (familyForms(b.name).some(f => mentions(description, f)) && (!family || b.name.length > family.name.length)) {
      family = b
    }
  }
  return { brandId: brand?.id ?? null, familyId: (canonical ?? family)?.id ?? null }
}

// ------------------------------------------------------------------------------------------------ model codes

const UNIT_LIKE = /^\d+(?:V|VAC|VDC|MA|MM|CM|M|KV|KW|W|HZ|BAR|PSI|C)$/

/**
 * The model codes in a description, as the database computes rfq_items.model_tokens (DATA_MODEL 2.8, A2b): upper-case,
 * split on spaces and commas, strip - . /, keep a token of 4 or more characters with a letter and a digit, drop
 * quantity-and-unit shapes ("24V", "420MA"). Used only to name the model in a supplier's reason.
 *
 * `brandNames` mirrors migration 0035: a word that is really a brand or family name ("XYZ2000", "S7-1200") is not a model
 * code, so it is left out. The database does this at comparison time (brand_tokens()); here the caller passes the names it
 * already loaded for the brand pickers.
 */
export function modelTokens(text: string, brandNames: readonly string[] = []): string[] {
  const own = (s: string): string[] => {
    const out: string[] = []
    for (const raw of s.toUpperCase().split(/[\s,]+/)) {
      const t = raw.replace(/[-./]/g, '')
      if (t.length >= 4 && /[A-Z]/.test(t) && /\d/.test(t) && !UNIT_LIKE.test(t) && !out.includes(t)) out.push(t)
    }
    return out
  }
  const drop = brandNames.length === 0 ? null : brandTokens(brandNames)
  return own(text).filter(t => !drop || !drop.has(t))
}

/** The tokens that come from brand or family names: their own model-shaped words, and the name squeezed to letters and digits ("E+H 2000" is EH2000). Mirrors brand_tokens(). */
export function brandTokens(names: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const name of names) {
    for (const t of modelTokens(name)) out.add(t)
    const squeezed = name.toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (squeezed.length >= 4 && /[A-Z]/.test(squeezed) && /\d/.test(squeezed)) out.add(squeezed)
  }
  return out
}
