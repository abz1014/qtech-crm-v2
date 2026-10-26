// R08: paste-to-parse for supplier replies. Pure and framework-free.
//
// The engineer pastes what a supplier sent back (an email, a WhatsApp message, a table copied from a spreadsheet). This
// module reads it and returns OFFERS per RFQ item: unit price, currency, lead time, stock, origin, MOQ, validity. Each
// offer carries a confidence and the source snippet it came from, so the screen can show "we read this from this line".
//
// Rules (BUILD_PLAN R08, DATA_MODEL 2.10, DECISIONS):
//  - It NEVER commits. Everything returned is a suggestion; the engineer accepts an offer and R07 writes the quote line.
//  - Currency is read from symbols and codes on the line. It is NEVER assumed. If the line has none, `currency` is null
//    and the screen pre-fills from the supplier. The one exception is the reply's own statement ("All prices in USD", or
//    the only currency used anywhere in the reply): that is marked in `inherited` and `currencySource` so it is visible.
//  - A reply line is matched to an RFQ item by model code first (`modelTokens`, the same rule as the database), then by
//    description similarity, then by an item number written in the reply ("2)", "Item 3"), then by position.
//  - Model numbers and sizes (DN50, 4-20mA, 0-10 bar, 24V, IP67) are never read as prices, quantities or lead times.
//  - A reply that declines ("regret, we cannot quote") sets `regret`; items declined individually are in `declined`.

import { modelTokens } from './parseItems'

// ------------------------------------------------------------------------------------------------ public types

export type ReplyCurrency = 'USD' | 'EUR' | 'CNY' | 'AED' | 'GBP' | 'PKR'
export type Confidence = 'high' | 'medium' | 'low'
export type MatchedBy = 'model' | 'description' | 'item-number' | 'single-item' | 'position' | 'none'
export type InheritedField = 'currency' | 'leadTime' | 'origin' | 'validity' | 'stock'
export type CurrencySource = 'line' | 'reply' | null
export type RegretKind = 'cannot_quote' | 'not_handled' | 'discontinued' | 'unavailable' | 'not_interested'

export type OfferFlag =
  | 'currency_missing'
  | 'price_missing'
  | 'bare_number'
  | 'ambiguous_separator'
  | 'multiple_prices'
  | 'derived_from_total'
  | 'match_by_position'
  | 'no_item_match'
  /** The supplier offers another model than the one asked for (`offeredPn`). */
  | 'substitute'

export interface ReplyItemRef {
  id: string
  description: string
  qty?: number | null
  unit?: string | null
  /** An explicit model or part number, when the item has one. Added to the codes found in the description. */
  model?: string | null
}

export interface ParseReplyOptions {
  /** Today as YYYY-MM-DD (business timezone). Only used to turn "valid till 30 Nov" into a number of days. */
  today?: string
  /** Fill gaps from the reply's own statements ("All prices in USD", "Origin: Germany"). Default true; marked in `inherited`. */
  inheritReplyLevel?: boolean
}

export interface ReplyOffer {
  /** The RFQ item this reply line is about, or null when no item could be told (assign it by hand). */
  rfqItemId: string | null
  matchedBy: MatchedBy
  /** 0 to 1: how sure the item match is. */
  matchScore: number
  /** The model or part number the supplier offers when it is not the one we asked for (a replacement or substitute), else null. */
  offeredPn: string | null
  unitPrice: number | null
  /** ISO 4217 code read from the text, or null. Never defaulted. */
  currency: ReplyCurrency | null
  currencySource: CurrencySource
  /** A total the supplier gave ("USD 600 for 5 pcs"), when there was one. */
  totalPrice: number | null
  /** The quantity the supplier priced, when the line said so. */
  qty: number | null
  /** Lead time as written ("4-6 weeks after PO", "ex-stock"). */
  leadTimeText: string | null
  /** Upper bound in calendar days (weeks x 7, months x 30, working days x 7/5). 0 for ex-stock / immediate. */
  leadTimeDaysMax: number | null
  leadTimeDaysMin: number | null
  /** true: ex-stock / in stock. false: out of stock / made to order. null: not said. */
  inStock: boolean | null
  origin: string | null
  moq: number | null
  validityText: string | null
  validityDays: number | null
  /** Further prices on the same line (price breaks, "was/now"); the first one is `unitPrice`. */
  otherPrices: Array<{ unitPrice: number; currency: ReplyCurrency | null }>
  /** Fields filled from the reply's own general statements, not from this item's line. */
  inherited: InheritedField[]
  flags: OfferFlag[]
  confidence: Confidence
  /** 0 to 1. */
  score: number
  /** The pasted text this came from (the item line plus any lines that continued it). */
  snippet: string
  /** 1-based pasted line numbers behind the snippet. */
  lineNumbers: number[]
}

export interface DeclinedItem {
  rfqItemId: string
  kind: RegretKind
  snippet: string
}

export interface ParsedReply {
  offers: ReplyOffer[]
  /** The reply declines: it says so and carries no price. */
  regret: boolean
  regretKind: RegretKind | null
  regretSnippet: string | null
  /** Items the reply declines. A reply-level regret declines every item. */
  declined: DeclinedItem[]
  /** The reply only asks something (which size? please confirm the quantity): no price, no regret. Nothing in it is an offer. */
  question: boolean
  /** The first question the reply asks, when `question` is set. */
  questionSnippet: string | null
  /** The currency the reply states in general, or the only one it uses. null when mixed or absent. */
  replyCurrency: ReplyCurrency | null
  /** Non-empty pasted lines. */
  lineCount: number
}

// ------------------------------------------------------------------------------------------------ numbers

export interface ParsedAmount {
  value: number
  /** "1.234" could be one point two three four or one thousand two hundred thirty-four. */
  ambiguous: boolean
}

/**
 * Reads a written amount: 1,234.50 / 1.234,50 / 1 234 / 1'234.50 / 12,5 / 1.2k. The last separator is the decimal point
 * when both kinds appear. A lone comma followed by three digits is a thousands comma. A lone dot followed by three digits
 * is ambiguous: it is read as thousands for EUR and as a decimal otherwise, and flagged.
 */
export function parseAmount(raw: string, currency?: string | null): ParsedAmount | null {
  let s = raw.trim()
  let mult = 1
  const k = /\s?([kK]|[lL]akhs?|[lL]acs?|[cC]rores?)$/.exec(s)
  if (k) {
    const word = (k[1] ?? '').toLowerCase()
    mult = word === 'k' ? 1000 : word.startsWith('c') ? 10_000_000 : 100_000
    s = s.slice(0, k.index)
  }
  s = s.replace(/[\s'’]/g, '')
  if (!/^\d[\d.,]*$/.test(s)) return null
  let ambiguous = false
  const dots = (s.match(/\./g) ?? []).length
  const commas = (s.match(/,/g) ?? []).length
  let norm: string
  if (dots && commas) {
    const dec = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ','
    const grp = dec === '.' ? ',' : '.'
    norm = s.split(grp).join('').replace(dec, '.')
  } else if (commas) {
    const parts = s.split(',')
    const last = parts[parts.length - 1] ?? ''
    if (commas > 1) norm = parts.join('')
    else if (last.length === 3 && (parts[0] ?? '').length >= 1 && (parts[0] ?? '').length <= 3 && parts[0] !== '0') norm = parts.join('')
    else norm = parts.join('.')
  } else if (dots) {
    const parts = s.split('.')
    const last = parts[parts.length - 1] ?? ''
    // "608.1171.325" is an article number, not 6,081,171,325: thousands groups are three digits each.
    if (dots > 1 && !parts.slice(1).every(p => p.length === 3)) return null
    if (dots > 1) norm = parts.join('')
    else if (last.length === 3 && (parts[0] ?? '').length >= 1 && (parts[0] ?? '').length <= 3 && parts[0] !== '0') {
      ambiguous = true
      norm = currency === 'EUR' ? parts.join('') : s
    } else norm = s
  } else norm = s
  const n = Number(norm) * mult
  if (!Number.isFinite(n)) return null
  return { value: Math.round(n * 10000) / 10000, ambiguous }
}

// ------------------------------------------------------------------------------------------------ currency

const CUR_MAP: Record<string, ReplyCurrency> = {
  USD: 'USD', US$: 'USD', $: 'USD', DOLLAR: 'USD', DOLLARS: 'USD', USDOLLAR: 'USD',
  EUR: 'EUR', '€': 'EUR', EURO: 'EUR', EUROS: 'EUR',
  CNY: 'CNY', RMB: 'CNY', 'CN¥': 'CNY', '¥': 'CNY', '￥': 'CNY', YUAN: 'CNY', '元': 'CNY', '块': 'CNY',
  AED: 'AED', DHS: 'AED', DH: 'AED', DIRHAM: 'AED', DIRHAMS: 'AED',
  GBP: 'GBP', '£': 'GBP', POUND: 'GBP', POUNDS: 'GBP',
  PKR: 'PKR', RS: 'PKR', '₨': 'PKR', RUPEE: 'PKR', RUPEES: 'PKR',
}

/** "US$", "rmb", "€" ... to a code. A bare "$" is read as USD. */
export function normaliseCurrency(raw: string | null | undefined): ReplyCurrency | null {
  if (!raw) return null
  const k = raw.trim().toUpperCase().replace(/[\s.]/g, '')
  return CUR_MAP[k] ?? null
}

const CUR_PREFIX_SRC = String.raw`(?<![A-Za-z])(US\s?\$|U\.S\.\s?\$|USD|\$|EUR|€|CNY|RMB|CN¥|¥|￥|AED|Dhs?\.?|GBP|£|PKR|₨|Rs\.?(?!-?\s?(?:485|232|422)\b))\s*`
const CUR_SUFFIX_SRC = String.raw`(?:[ ]*(USD|US\$|\$|EUR|€|CNY|RMB|¥|￥|AED|GBP|£|PKR|₨|dollars?|euros?|yuan|dirhams?|dhs|pounds?|rupees?|元|块)|(?:\/-)?\s+(Rs\.?))(?![A-Za-z])`
const CUR_CODE_SRC = String.raw`(US\s?\$|USD|\$|EUR|€|CNY|RMB|¥|￥|元|AED|GBP|£|PKR|₨|Rs\.?|dollars?|euros?|yuan|dirhams?|pounds?|rupees?)`
// An amount: with thousands groups (comma, dot, apostrophe, or space when SP) and up to four decimals, or plain; an optional k.
// Pakistani (lakh) grouping first: "1,25,000", "12,50,000", "1,00,00,000". A multiplier word may follow: k, lakh / lac, crore.
const LAKH_GROUPS = String.raw`\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d{1,4})?`
const MULT_WORD = String.raw`(\s?(?:[kK]|[lL]akhs?|[lL]acs?|[cC]rores?)(?![A-Za-z]))?`
const AMOUNT_SP = String.raw`(?<![A-Za-z0-9.,])(${LAKH_GROUPS}|\d{1,3}(?:[ ,.'’]\d{3})+(?:[.,]\d{1,4})?(?!\d)|\d+(?:[.,]\d{1,4})?(?!\d|[.,]\d))${MULT_WORD}`
/** The same amount right after a currency written in front of it ("Rs.182,000", "USD890"): no gap needed. */
const AMOUNT_AFTER_CUR = String.raw`(?<!\d|\d[.,])(${LAKH_GROUPS}|\d{1,3}(?:[ ,.'’]\d{3})+(?:[.,]\d{1,4})?(?!\d)|\d+(?:[.,]\d{1,4})?(?!\d|[.,]\d))${MULT_WORD}`
const AMOUNT = String.raw`(?<![A-Za-z0-9.,])(${LAKH_GROUPS}|\d{1,3}(?:[,.'’]\d{3})+(?:[.,]\d{1,4})?(?!\d)|\d+(?:[.,]\d{1,4})?(?!\d|[.,]\d))${MULT_WORD}`
// What may follow a price without making it a size or code ("USD 120pcs", "USD 24V" is not a price).
const AFTER_OK = /^(?:pc|pcs|piece|pieces|each|ea\b|per|only|net|ex\b|fob|cif|cfr|exw|ddp|dap|incl|excl|plus|vat|gst|unit|nos|no\b|set|lot|\/|\+)/i

// ------------------------------------------------------------------------------------------------ lead time, stock, validity, MOQ, origin

export interface LeadTime {
  text: string
  daysMin: number | null
  daysMax: number | null
  exStock: boolean
}

const UNIT_DAYS: Array<[RegExp, number]> = [
  [/^(?:working|business|work)\s+d/i, 7 / 5],
  [/^d/i, 1],
  [/^w/i, 7],
  [/^m/i, 30],
]
function unitDays(unit: string): number {
  for (const [re, d] of UNIT_DAYS) if (re.test(unit)) return d
  return 1
}

const DUR_UNIT = String.raw`((?:working\s+|business\s+|work\s+)?(?:days?|weeks?|wks?|months?|mths?|mos?)(?![A-Za-z])|[dw](?![A-Za-z0-9]))`
const DUR_RE = new RegExp(
  String.raw`(?<![A-Za-z0-9.])(?:within\s+|about\s+|approx\.?\s+|around\s+)?(\d+(?:\.\d+)?)(?:\s*(?:-|to|~)\s*(\d+(?:\.\d+)?))?(\s*)${DUR_UNIT}` +
    String.raw`(\s*(?:after|from|aro\b|upon|post|against)\s+(?:receipt\s+of\s+|date\s+of\s+)?(?:po|p\.o\.|order|payment|advance|l\/?c|confirmation|prepayment|down\s?payment|deposit|signing)\b(?:\s+(?:receipt|confirmation|payment))?|\s+aro\b)?`,
  'i',
)
const EXSTOCK_RE = /\b(?:ex[\s-]?stock|ex[\s-]?stk|from\s+stock|in[\s-]?stock|ready\s+stock|ready\s+to\s+ship|stock\s+available|off[\s-]the[\s-]shelf)\b|现货/i
const IMMEDIATE_RE = /\b(?:immediate(?:ly)?|same[\s-]day|ex[\s-]?works\s+immediate)\b/i
const NOSTOCK_RE =
  /\b(?:not\s+(?:available\s+)?(?:ex|in|from)[\s-]?stock|no\s+stock|out[\s-]of[\s-]stock|non[\s-]?stock|oos|stock[\s-]?out|made[\s-]to[\s-]order|build[\s-]to[\s-]order|to\s+be\s+ordered|mto)\b/i
// A duration that is something else: validity, payment terms, warranty.
const NOT_LEAD_BEFORE = /(?:valid(?:ity)?|payment|pay|warranty|guarantee|credit|terms|net|expires?|min(?:imum)?|moq)\s*[:=-]?\s*(?:for|of|is|within|period|time)?\s*$/i
const NOT_LEAD_AFTER = /^\s*(?:validity|valid|payment|warranty|guarantee|credit|net\b|terms)/i

interface Span {
  start: number
  end: number
}

function findLeadTime(w: string, raw: string): (LeadTime & Span) | null {
  const re = new RegExp(DUR_RE.source, 'gi')
  let m: RegExpExecArray | null
  const ex = EXSTOCK_RE.exec(w)
  const exOk = ex && !NOSTOCK_RE.test(w)
  let best: (LeadTime & Span) | null = null
  while ((m = re.exec(w))) {
    const gap = m[3] ?? ''
    const unit = m[4] ?? ''
    if (/^[dw]$/i.test(unit) && gap) continue
    if (/^[dw]$/i.test(unit) && (/[-/]/.test(w[m.index + m[0].length] ?? '') || /[A-Za-z0-9][-/]$/.test(w.slice(Math.max(0, m.index - 2), m.index)))) continue
    const before = w.slice(Math.max(0, m.index - 30), m.index)
    const cut = Math.max(before.lastIndexOf(','), before.lastIndexOf(';'), before.lastIndexOf('|'))
    const ctx = cut >= 0 ? before.slice(cut + 1) : before
    if (NOT_LEAD_BEFORE.test(ctx)) continue
    // "$18.00 - 8 weeks": the first number is a price, not the start of a range.
    if (/(?:[$€£¥￥₨]|\b(?:usd|eur|rmb|cny|aed|pkr|gbp|rs)\.?)\s*$/i.test(before)) {
      re.lastIndex = m.index + (m[1] ?? '').length + 1
      continue
    }
    if (NOT_LEAD_AFTER.test(w.slice(m.index + m[0].length, m.index + m[0].length + 14))) continue
    const mult = unitDays(unit)
    const lo = Number(m[1])
    const hi = m[2] !== undefined ? Number(m[2]) : lo
    best = {
      text: raw.slice(m.index, m.index + m[0].length).replace(/\s+/g, ' ').trim(),
      daysMin: Math.ceil(Math.min(lo, hi) * mult),
      daysMax: Math.ceil(Math.max(lo, hi) * mult),
      exStock: false,
      start: m.index,
      end: m.index + m[0].length,
    }
    break
  }
  if (exOk && ex && (!best || ex.index < best.start)) {
    return { text: raw.slice(ex.index, ex.index + ex[0].length).replace(/\s+/g, ' ').trim(), daysMin: 0, daysMax: 0, exStock: true, start: ex.index, end: ex.index + ex[0].length }
  }
  if (best) {
    return best
  }
  const im = IMMEDIATE_RE.exec(w)
  if (im) return { text: im[0], daysMin: 0, daysMax: 0, exStock: false, start: im.index, end: im.index + im[0].length }
  return null
}

/** The first lead-time expression in a text ("4–6 weeks", "30 days", "2 weeks after PO", "ex-stock", "immediate"). */
export function parseLeadTime(text: string): LeadTime | null {
  const w = text.replace(/[–—−]/g, '-').replace(/\u00a0/g, ' ')
  const r = findLeadTime(w, text)
  return r ? { text: r.text, daysMin: r.daysMin, daysMax: r.daysMax, exStock: r.exStock } : null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
function utc(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1)
}
function dateFromText(s: string, today?: string): string | null {
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return `${m[1]}-${m[2]}-${m[3]}`
  const yearNow = today ? Number(today.slice(0, 4)) : null
  m = /(\d{1,2})(?:st|nd|rd|th)?[\s\-/.]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:[\s\-/.,]*(\d{4}|\d{2}))?/i.exec(s)
  if (m) {
    const mon = MONTHS.indexOf((m[2] ?? '').toLowerCase()) + 1
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : yearNow
    if (y === null) return null
    const iso = `${y}-${String(mon).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
    // No year written and the date has already passed this year: the supplier means next year ("valid till 15 Jan" sent in December).
    return !m[3] && today && iso < today.slice(0, 10) ? `${y + 1}${iso.slice(4)}` : iso
  }
  m = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/.exec(s)
  if (m) return `${m[3]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[1])).padStart(2, '0')}`
  return null
}

const VALID_DUR_RE = /valid(?:ity)?(?:\s+(?:for|of|period|up\s*to|upto))?\s*[:=-]?\s*(\d+)\s*(days?|weeks?|wks?|months?)(?![A-Za-z])/i
const VALID_DUR_AFTER_RE = /(\d+)\s*(days?|weeks?|wks?|months?)\s+(?:validity|valid)\b/i
const VALID_UNTIL_RE = /valid(?:ity)?(?:\s+(?:until|till|upto|up\s*to|through|to))\s*[:=-]?\s*([0-9A-Za-z][0-9A-Za-z ,./-]{3,24})/i

function findValidity(w: string, raw: string, today?: string): { text: string; days: number | null } & Span | null {
  let m = VALID_DUR_RE.exec(w) ?? VALID_DUR_AFTER_RE.exec(w)
  if (m) {
    const days = Math.ceil(Number(m[1]) * unitDays(m[2] ?? 'd'))
    return { text: raw.slice(m.index, m.index + m[0].length).trim(), days, start: m.index, end: m.index + m[0].length }
  }
  m = VALID_UNTIL_RE.exec(w)
  if (m) {
    const iso = dateFromText(m[1] ?? '', today)
    const days = iso && today ? Math.round((utc(iso) - utc(today)) / 86400000) : null
    return { text: raw.slice(m.index, m.index + m[0].length).trim(), days: days !== null && days >= 0 ? days : null, start: m.index, end: m.index + m[0].length }
  }
  return null
}

const MOQ_RE = /\b(?:moq|min(?:imum)?\.?\s*(?:order\s*)?(?:qty|quantity|qnty|order)?)\s*[:=-]?\s*(\d[\d,]*)(?!\s*(?:-|to)\s*\d)(?!\s*(?:days?|weeks?|wks?|months?|mm|%|bar|v\b|usd|eur|\$))(?:\s*(?:pcs|pc|nos|units|sets|pieces))?/i

const COUNTRIES =
  'Germany|China|USA|U\\.S\\.A|United States|UK|United Kingdom|Italy|Japan|France|Switzerland|India|Korea|Taiwan|Turkey|Netherlands|Spain|Sweden|Denmark|Austria|UAE|Dubai|Malaysia|Singapore|Thailand|Czech|Poland|Finland|Belgium|Hungary|Brazil|Canada|Mexico|Pakistan|Vietnam|Indonesia|Hong Kong'
const ORIGIN_LABEL_RE = /\b(?:country\s+of\s+origin|origin|made\s+in|manufactured\s+in|coo)\s*[:=-]?\s*([A-Za-z][A-Za-z ./&-]{1,30}?)(?=\s*(?:[,;|(]|\band\b|\.\s|\.$|$|\d|usd|eur|\$))/i
const COUNTRY_MADE_RE = new RegExp(String.raw`\b(${COUNTRIES})\s+(?:made|origin|original)\b`, 'i')

const AUTH_RE = new RegExp(
  String.raw`\b(?:genuine|original|brand\s+new|authentic|oem|refurbished|used|compatible|clone|copy|china\s+copy)\b(?:\s+(?:and\s+)?(?:new|original|genuine))?(?:\s+[A-Z][A-Za-z+&-]{2,20})?(?:\s*,\s*(?:${COUNTRIES}))?`,
  'i',
)

function findOrigin(w: string, raw: string): ({ text: string } & Span) | null {
  const parts: string[] = []
  let start = Infinity
  let end = -1
  const mark = (m: RegExpExecArray, text: string) => {
    parts.push(text)
    start = Math.min(start, m.index)
    end = Math.max(end, m.index + m[0].length)
  }
  const auth = AUTH_RE.exec(w)
  if (auth) {
    const txt = raw.slice(auth.index, auth.index + auth[0].length).replace(/\s+/g, ' ').trim()
    // "Genuine Siemens": keep a capitalised brand word, but not a sentence word ("Genuine Price").
    const cleaned = txt.replace(/\s+(?:Price|Rate|Lead|Delivery|Origin|Stock|MOQ|Valid\w*|Item|Qty|Total)$/i, '')
    mark(auth, cleaned)
  }
  const lab = ORIGIN_LABEL_RE.exec(w)
  if (lab) {
    const v = raw.slice(lab.index + lab[0].length - (lab[1] ?? '').length, lab.index + lab[0].length).trim()
    if (v && !/^(?:price|rate|item)/i.test(v)) mark(lab, v)
  } else {
    const c = COUNTRY_MADE_RE.exec(w)
    if (c) mark(c, c[1] ?? '')
  }
  if (!parts.length) return null
  return { text: [...new Set(parts)].join(', '), start, end }
}

// ------------------------------------------------------------------------------------------------ regret

const REGRET_RE = new RegExp(
  [
    String.raw`\bregret(?:s|ted)?\b`,
    String.raw`\bunable\s+to\s+(?:quote|offer|supply|provide|participate|bid|support|do|help|give|make)\b`,
    String.raw`\b(?:can(?:'|’)?t|cannot|can\s+not|cant|won(?:'|’)?t|not\s+able\s+to|couldn(?:'|’)?t)\s+(?:quote|offer|supply|provide|participate|bid|support|do\b|help|give|make)`,
    String.raw`\bno\s+(?:quote|quotation|offer|bid)\b`,
    String.raw`\bnot\s+(?:quoting|offering|interested|participating|possible)\b`,
    String.raw`\b(?:do(?:es)?\s*not|don(?:'|’)?t|doesn(?:'|’)?t)\s+(?:have|carry|supply|handle|deal|stock|sell|offer|make|manufacture|quote|do)\b`,
    String.raw`\bnot\s+(?:our|in\s+our)\s+(?:scope|range|line|product|portfolio)`,
    String.raw`\bout\s+of\s+(?:our\s+)?scope\b`,
    String.raw`\b(?:discontinued|obsolete|end[\s-]of[\s-]life|eol|no\s+longer\s+(?:available|made|produced|supplied|manufactured))\b`,
    String.raw`\bpass\s+on\b`,
    String.raw`\bdeclin(?:e|ed|ing)\b`,
    String.raw`\b(?:not\s+available|unavailable)\b`,
    String.raw`\bnot\s+in\s+(?:the\s+)?position\s+to\s+(?:offer|quote|supply|provide)\b`,
    String.raw`\brefrain(?:ed|ing)?\s+(?:from\s+|in\s+)?(?:sending|quoting|offering|giving)\b`,
    String.raw`\bnot\s+deal(?:ing|t)?\b`,
    String.raw`\bexport\s+policy\b`,
    String.raw`\b(?:model|part|item|number)\s+(?:no\.?\s+)?(?:is\s+)?(?:incorrect|wrong|invalid)\b`,
    String.raw`\b(?:phased?[\s-]out|out\s+of\s+production|withdrawn\s+from|no\s+longer\s+in\s+(?:production|stock)|not\s+(?:in\s+production|produced|manufactured)\s*(?:any\s*more|anymore|any\s+longer)?)\b`,
    '没有货|无货|无法报价|不能报价|无法提供|不能提供|不能供货|无法供货|无法供应|不再供应|不供应|已?停产|停止生产|不再生产|已淘汰|被淘汰|无法满足|暂无法',
  ].join('|'),
  'i',
)

function regretKind(s: string): RegretKind {
  if (/discontinued|obsolete|end[\s-]of[\s-]life|eol|no\s+longer|phased?[\s-]out|out\s+of\s+production|not\s+(?:in\s+production|produced|manufactured)|停产|停止生产|不再生产|淘汰/i.test(s)) return 'discontinued'
  if (/scope|range|line|portfolio|carry|handle|deal|supply|sell|manufacture|product/i.test(s) && /not|don|doesn|out of/i.test(s) && !/unable|can(?:'|’)?t|cannot/i.test(s)) return 'not_handled'
  if (/not\s+interested|pass\s+on|declin/i.test(s)) return 'not_interested'
  if (/not\s+available|unavailable|无货|没有货/i.test(s)) return 'unavailable'
  return 'cannot_quote'
}

// ------------------------------------------------------------------------------------------------ line analysis

interface PriceCand extends Span {
  value: number
  currency: ReplyCurrency | null
  ambiguous: boolean
  anchored: boolean
  /** 'total' when the words around it say so. */
  kind: 'unit' | 'total' | 'unknown'
  /** Quantity the amount is for ("USD 600 for 5 pcs"). */
  forQty: number | null
}

interface LineFields {
  prices: PriceCand[]
  lead: LeadTime | null
  inStock: boolean | null
  origin: string | null
  moq: number | null
  validityText: string | null
  validityDays: number | null
  qty: number | null
  declaredCurrency: ReplyCurrency | null
  regret: { kind: RegretKind; text: string } | null
  /** The line asks something. */
  question: boolean
}

const blank = (w: string, s: Span) => w.slice(0, s.start) + ' '.repeat(s.end - s.start) + w.slice(s.end)

const PRICE_LABEL_RE = /\b(?:unit\s*)?(?:price|rate|cost|offer|quoted?|quotation|prc|each|ea)\b|@|\bp\/u\b/i
const TOTAL_BEFORE_RE = /(?:total|amount|sub\s?total|sum|ext(?:ended)?|=)\s*(?:price|amount|value|cost)?\s*[:=-]?\s*(?:is|of)?\s*$/i
const UNIT_AFTER_RE = /^\s*(?:\/\s*(?:pc|pcs|piece|unit|no|nos|ea|each|set|m|mtr|kg|l)\b|(?:per|a|each|ea\b|\/)\s*(?:pc|pcs|piece|unit|no|nos|set|m|mtr|kg|l)?)/i
const FOR_QTY_RE = /^\s*(?:for|x|×)\s*(\d+)\s*(?:pcs|pc|nos|no|units|sets|set|pieces)?\b/i

function findQty(w: string): { value: number } & Span | null {
  // "Qty: 1,000", "Qty 2.5", "1,000 pcs", "4 adad" (Urdu, pieces), and a length or weight with its point ("0.5 m", "2.5 kg").
  let m = /(?:\bqty|\bquantity|\bq'ty)\s*[:=]?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![\d,])/i.exec(w)
  if (!m) m = /(?<![A-Za-z0-9.,])(\d{1,3}(?:,\d{3})+|\d{1,5})\s*(?:pcs|pc|nos|units|sets|set|pieces|adad)\b/i.exec(w)
  if (!m) m = /(?<![A-Za-z0-9.,/-])(\d{1,4}\.\d{1,3}|\d{1,5})\s*(?:mtrs?|meters?|metres?|kgs?)\b/i.exec(w)
  if (!m) m = /(?<![A-Za-z0-9])[x×]\s*(\d{1,5})\b(?!\s*[x×\d])/i.exec(w)
  if (!m) return null
  return { value: Number((m[1] as string).replace(/,/g, '')), start: m.index, end: m.index + m[0].length }
}

/** Replaces codes, sizes, dates, phone numbers and percentages with spaces so their digits are not read as prices. */
function maskNonPrice(w: string): string {
  const masks: RegExp[] = [
    // item numbers: "Item 3", "#2", "Pos 4", and a leading "1)" / "2." / "3 - "
    /\b(?:item|pos|position|sr|line|s\/n)\.?\s*#?\s*\d{1,3}\b/gi,
    // "Part number: 482917", "QQ: 55500", "Post Code:210044", "Serial number 3105511": an identifier, not a price
    /\b(?:part|p\/n|serial|model|article|catalog(?:ue)?|cat|ref(?:erence)?|code|order|post|zip|qq|wechat|whatsapp|skype|tel|phone|mob(?:ile)?|fax|pin|id)\b\.?\s*(?:no\.?|number|#|code)?\s*[:#.-]?\s*[A-Z0-9][A-Z0-9-]*\d[A-Z0-9-]*/gi,
    /^\s*#?\d{1,3}\s*(?:[.):](?=\s|$)|\s-\s)/g,
    /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
    /(?:https?:\/\/|www\.)\S+/gi,
    /\+\d[\d\s()-]{8,}\d/g,
    /(?<![\d.,])0\d{2,3}[- ]?\d{7}(?!\d)/g,
    /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:[ap]m)?\b/gi,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b\d{4}[/.]\d{1,2}[/.]\d{1,2}\b/g,
    /\b(?:iso|din|en|iec|ul|ansi|astm|jis|nema|sae|api)[\s-]?\d+(?:[-/.]\d+)*/gi,
    /\bincoterms?\s*\(?\s*(?:20\d\d)?\s*\)?/gi,
    /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g,
    /\b\d{1,2}(?:st|nd|rd|th)?[\s-]+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:[\s,-]+\d{2,4})?/gi,
    /(?<![A-Za-z0-9])\d+(?:[.,]\d+)?\s?%/g,
    /(?<![A-Za-z0-9.,])\d+(?:\s*(?:-|to)\s*\d+)?\s*(?:working\s+|business\s+)?(?:days?|weeks?|wks?|months?|mths?|years?|yrs?)(?![A-Za-z])/gi,
    // ranges and values with a technical unit: 4-20mA, 0-10 bar, 24V, 100mm, 5 kW, 1/2", 12.5 kg
    /(?<![A-Za-z0-9.,])\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*(?:ma|v|vdc|vac|bar|psi|mpa|kpa|mbar|mm|cm|m|a|hz|°\s?c|c|kw|w|rpm|ohm|kohm|mtr|%)(?![A-Za-z])/gi,
    /(?<![A-Za-z0-9.,])\d+(?:[.,]\d+)?\s*(?:ma|vdc|vac|va|bar|psi|mpa|kpa|mbar|mm|cm|kw|hz|rpm|°\s?c|ohm|kohm|kg|inch|amps?|hp|kva|lpm|l\/min|m3\/h|nm|mtr|ltr|mhz|ghz|kb|mb|gb|awg|sqmm)(?![A-Za-z])/gi,
    /(?<![A-Za-z0-9.,])\d+(?:[.,]\d+)?(?:v|a|w|c|m|l)(?![A-Za-z0-9])/gi,
    /(?<![A-Za-z0-9.,])\d+(?:[.,]\d+)?\s?V\s?(?:DC|AC)(?![A-Za-z0-9])/gi,
    /(?<![A-Za-z0-9])(?:DN|PN|NPS|NB|BSP|NPT|SCH|IP|IE|G|M|R|Rc|Rp|Class|CL)\s?-?\d+(?:\/\d+)?(?![A-Za-z0-9])/g,
    /\b\d+\/\d+\s?["”]?/g,
    /(?<![A-Za-z0-9.,])\d+(?:[.,]\d+)?\s*["”](?!\w)/g,
    /(?<![A-Za-z0-9.,])\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?(?:\s*[x×]\s*\d+(?:\.\d+)?)?/gi,
    /(?<![A-Za-z0-9])(?=[A-Za-z0-9._/-]*[A-Za-z])(?=[A-Za-z0-9._/-]*\d)[A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9]/g,
  ]
  let out = w
  for (const re of masks) out = out.replace(re, s => ' '.repeat(s.length))
  return out
}

function findAnchoredPrices(w: string, hintCurrency: ReplyCurrency | null): PriceCand[] {
  const out: PriceCand[] = []
  const taken: Span[] = []
  const overlaps = (s: number, e: number) => taken.some(t => s < t.end && e > t.start)
  const accept = (m: RegExpExecArray, numIdx: number, kIdx: number, curRaw: string, start: number, end: number, endOfNumber: number) => {
    if (overlaps(start, end)) return
    const rest = w.slice(endOfNumber)
    if (/^[A-Za-z]/.test(rest) && !AFTER_OK.test(rest)) return
    // "RS756-56J", "USD-2400-B": the digits run on into a code, so they are not an amount.
    if (/^[-/][A-Za-z0-9]*[A-Za-z]/.test(rest) && !/^\/\s*(?:pc|pcs|piece|unit|no|nos|ea|each|set|m|mtr|kg|l|lot|pair|roll|box)\b/i.test(rest)) return
    const cur = normaliseCurrency(curRaw)
    const amt = parseAmount(`${m[numIdx] ?? ''}${m[kIdx] ?? ''}`, cur ?? hintCurrency)
    if (!amt || amt.value <= 0) return
    taken.push({ start, end })
    out.push({ ...amt, currency: cur, anchored: true, start, end, kind: 'unknown', forQty: null })
  }
  // currency first: "USD 1,234.50", "US$120", "Rs. 4 500", "RMB350"
  const pre = new RegExp(CUR_PREFIX_SRC + AMOUNT_AFTER_CUR, 'gi')
  let m: RegExpExecArray | null
  const found: Array<{ m: RegExpExecArray; numIdx: number; kIdx: number; cur: string; start: number; end: number; gap: number }> = []
  while ((m = pre.exec(w))) {
    const cur = m[1] ?? ''
    found.push({ m, numIdx: 2, kIdx: 3, cur, start: m.index, end: m.index + m[0].length, gap: (/^\s*/.exec(m[0].slice(cur.length))?.[0].length ?? 0) })
  }
  // amount first: "120 USD", "350元", "1.2k usd"
  const suf = new RegExp(AMOUNT_SP + CUR_SUFFIX_SRC, 'gi')
  while ((m = suf.exec(w))) {
    const cur = m[3] ?? m[4] ?? ''
    const amountEnd = (m[1] ?? '').length + (m[2] ?? '').length
    found.push({ m, numIdx: 1, kIdx: 2, cur, start: m.index, end: m.index + m[0].length, gap: m[0].slice(amountEnd, m[0].length - cur.length).replace(/[^ ]/g, '').length })
  }
  // Where the two readings overlap, the currency written right against its amount wins: "69,87USD 1 In stock" is 69.87 USD (and a
  // quantity 1), not "USD 1"; "70  $294" is $294 (and a 70), not "70 $".
  found.sort((x, y) => x.gap - y.gap || y.numIdx - x.numIdx || x.start - y.start)
  for (const f of found) accept(f.m, f.numIdx, f.kIdx, f.cur, f.start, f.end, f.end)
  out.sort((a, b) => a.start - b.start)
  // classify each by the words around it
  for (const c of out) {
    const before = w.slice(Math.max(0, c.start - 24), c.start)
    const cut = Math.max(before.lastIndexOf(','), before.lastIndexOf(';'), before.lastIndexOf('|'))
    const ctx = cut >= 0 ? before.slice(cut + 1) : before
    const after = w.slice(c.end, c.end + 22)
    const fq = FOR_QTY_RE.exec(after)
    if (TOTAL_BEFORE_RE.test(ctx) || /^\s*(?:total|in\s+total|ttl)\b/i.test(after)) c.kind = 'total'
    else if (fq && Number(fq[1]) > 1 && /(?:pcs|pc|nos|no|units|sets|set|pieces)/i.test(after)) {
      c.kind = 'total'
      c.forQty = Number(fq[1])
    } else if (UNIT_AFTER_RE.test(after) || /(?:unit|each|per|@|rate|price)\s*[:=-]?\s*$/i.test(ctx)) c.kind = 'unit'
  }
  return out
}

function findBarePrices(w: string, anchoredCount: number): PriceCand[] {
  const masked = maskNonPrice(w)
  const hasLabel = PRICE_LABEL_RE.test(w)
  const re = new RegExp(AMOUNT, 'g')
  const found: PriceCand[] = []
  let m: RegExpExecArray | null
  const lead = /^\s*/.exec(masked)?.[0].length ?? 0
  while ((m = re.exec(masked))) {
    const rest = masked.slice(m.index + m[0].length)
    if (/^[A-Za-z]/.test(rest) && !AFTER_OK.test(rest)) continue
    const amt = parseAmount(`${m[1] ?? ''}${m[2] ?? ''}`)
    if (!amt || amt.value <= 0) continue
    const plainInt = /^\d{4}$/.test(m[1] ?? '') && amt.value >= 2024 && amt.value <= 2035
    if (plainInt && !hasLabel) continue
    // "Input   1 [tab] USD [tab] USD": a quantity in front of the currency headings of the next columns, not an amount in that currency.
    if (/^\t\s*(?:USD|EUR|CNY|RMB|AED|GBP|PKR)\b/i.test(masked.slice(m.index + m[0].length))) continue
    found.push({ ...amt, currency: null, anchored: false, start: m.index, end: m.index + m[0].length, kind: 'unknown', forQty: null })
  }
  if (anchoredCount > 0) return []
  if (hasLabel) {
    const lab = PRICE_LABEL_RE.exec(w)
    const after = found.filter(f => lab && f.start >= lab.index)
    return (after.length ? after : found).slice(0, 1)
  }
  // "1 Flow Totalizer / Recorder": the only number, at the start of a line of words, is its serial number.
  const only = found[0]
  if (found.length === 1 && only && !hasLabel && only.start === lead && /^\d{1,3}$/.test(masked.slice(only.start, only.end).trim()) && /^\s+[A-Za-z][A-Za-z]+\s+[A-Za-z]/.test(masked.slice(only.end))) return []
  if (found.length === 1) return found
  // "208.00  208.00": a unit price and its total for one piece, written twice (a decimal point in both).
  const [a, b] = found
  if (found.length === 2 && a && b && a.value === b.value && /[.,]/.test(masked.slice(a.start, a.end)) && /[.,]/.test(masked.slice(b.start, b.end))) return [a]
  return []
}

const NO_PRICE_RE =
  /\b(?:price|prices|rate|cost)\s+(?:(?:on|upon)\s+(?:request|application|enquiry|inquiry)|to\s+(?:follow|be\s+(?:advised|confirmed|quoted))|tba|tbc|later)\b|(?:^|[-:|]\s*)(?:on\s+request|to\s+be\s+(?:advised|confirmed|quoted)|tba|tbc)\s*\.?\s*$|(?<![A-Za-z])P\.?\s?O\.?\s?R(?![A-Za-z])/i

const DECLARE_RE = new RegExp(String.raw`\b(?:prices?|rates?|quot(?:e|ed|ation)s?|currency|amounts?|offers?)\b[^.\n]{0,40}?${CUR_CODE_SRC}(?![A-Za-z])|${CUR_CODE_SRC}(?![A-Za-z])\s+(?:prices?|rates?|basis|only)\b`, 'i')

function analyse(raw: string, today: string | undefined, skipPrice = false): LineFields {
  const orig = raw.replace(/\u00a0/g, ' ')
  let w = orig.replace(/[–—−]/g, '-').replace(/×/g, 'x')
  const f: LineFields = {
    prices: [], lead: null, inStock: null, origin: null, moq: null, validityText: null, validityDays: null, qty: null, declaredCurrency: null, regret: null, question: false,
  }

  const v = findValidity(w, orig, today)
  if (v) {
    f.validityText = v.text
    f.validityDays = v.days
    w = blank(w, v)
  }
  const moq = MOQ_RE.exec(w)
  if (moq) {
    f.moq = Number((moq[1] ?? '').replace(/,/g, ''))
    w = blank(w, { start: moq.index, end: moq.index + moq[0].length })
  }
  const nostock = NOSTOCK_RE.exec(w)
  if (nostock) f.inStock = false
  const lt = findLeadTime(w, orig)
  if (lt) {
    f.lead = { text: lt.text, daysMin: lt.daysMin, daysMax: lt.daysMax, exStock: lt.exStock }
    if (lt.exStock) f.inStock = true
    w = blank(w, lt)
  } else if (!nostock && EXSTOCK_RE.test(w)) f.inStock = true
  if (nostock) w = blank(w, { start: nostock.index, end: nostock.index + nostock[0].length })
  const org = findOrigin(w, orig)
  if (org) {
    f.origin = org.text
    w = blank(w, org)
  }
  const q = findQty(w)
  if (q) {
    f.qty = q.value
    w = blank(w, q)
  }

  // A date written with the month's name and a clock time ("Wednesday, October 21, 2026 9:14 AM", a mail header in a
  // screenshot) holds no price.
  w = w.replace(
    /\b(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|\d{1,2}(?:st|nd|rd|th)?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?,?\s+\d{4})(?:,?\s+(?:at\s+)?\d{1,2}:\d{2}(?:\s*[ap]m)?)?/gi,
    m => ' '.repeat(m.length),
  )
  if (!skipPrice) {
    const anchored = findAnchoredPrices(w, null)
    for (const c of anchored) w = blank(w, c)
    // HW-5: "price on request" / "POR" / "TBA" says there is no price on this line, so a bare number on it ("2 core",
    // "3 way") is part of the item, never a price. A price written with its currency still counts.
    f.prices = anchored.length ? anchored : NO_PRICE_RE.test(w) ? [] : findBarePrices(w, 0)
  }

  // "Relay 12VDC, 2 CO, Model X: Sorry, not available": a regret with only a bare number in it quotes nothing.
  if (f.prices.length && f.prices.every(p => !p.anchored) && REGRET_RE.test(w)) f.prices = []
  // "Offer 6816 - prices in USD": a line that declares the currency, with only a bare number (the offer's number) in it.
  if (f.prices.length && f.prices.every(p => !p.anchored) && DECLARE_RE.test(w) && !/\t|\|/.test(w)) f.prices = []
  // A question is not an offer: "Is item 2 size 150 ok?" names a size, not a price. A price written with its currency still counts.
  f.question = asksQuestion(orig)
  if (f.question && f.prices.every(p => !p.anchored)) f.prices = []
  const priced = f.prices.length > 0
  if (!priced) {
    const d = DECLARE_RE.exec(w)
    if (d) f.declaredCurrency = normaliseCurrency(d[1] ?? d[2] ?? null)
    // A heading cell that is only a currency ("USD" under the price heading).
    else if (/^[\s|(]*(?:USD|EUR|CNY|RMB|AED|GBP|PKR)(?:[\s|)]+(?:USD|EUR|CNY|RMB|AED|GBP|PKR))*[\s|)]*$/i.test(w)) f.declaredCurrency = normaliseCurrency(/[A-Za-z]+/.exec(w)?.[0] ?? null)
  }
  const reg = REGRET_RE.exec(w)
  // "If you have no orders, we will be unable to quote again": a condition, not a refusal of this enquiry.
  const conditional = /^\s*(?:if|unless|in\s+case|should)\b/i.test(orig)
  if (reg && !priced && !conditional && !(f.lead && f.lead.daysMax !== null && !f.lead.exStock)) {
    f.regret = { kind: regretKind(orig), text: orig.trim() }
  }
  return f
}

const hasData = (f: LineFields): boolean =>
  f.prices.length > 0 || f.lead !== null || f.inStock !== null || f.origin !== null || f.moq !== null || f.validityText !== null

// ------------------------------------------------------------------------------------------------ item matching

const STOP = new Set([
  'the', 'and', 'for', 'with', 'of', 'to', 'in', 'on', 'type', 'model', 'item', 'pcs', 'nos', 'qty', 'spec', 'brand', 'new', 'original',
  'genuine', 'price', 'usd', 'eur', 'cny', 'rmb', 'aed', 'gbp', 'pkr', 'week', 'weeks', 'wks', 'day', 'days', 'stock', 'lead', 'time',
  'delivery', 'each', 'unit', 'total', 'rate', 'ex', 'moq', 'valid', 'validity', 'origin', 'made', 'is', 'are', 'will', 'be', 'our', 'you',
  'your', 'we', 'it', 'at', 'as', 'by', 'or', 'no', 'not', 'from', 'after', 'ready', 'quote', 'offer', 'please', 'dear', 'sir', 'regards',
])
const words = (s: string): string[] => {
  const out: string[] = []
  for (const t of s.toLowerCase().match(/[a-z]+|\d+/g) ?? []) {
    if (STOP.has(t)) continue
    if (/^\d$/.test(t)) continue
    out.push(t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t)
  }
  return out
}

/** Spec shapes that look like codes but are sizes or ratings; they must never identify an item. */
const SPEC_SHAPE = /^(?:DN|PN|NPS|NB|BSP|NPT|SCH|IP|IE|CL|CLASS|G|M|R|RC|RP)\d+$|^\d+(?:V|VAC|VDC|MA|MM|CM|M|KV|KW|W|HZ|BAR|PSI|C|A|VA|KG|MPA|KPA|RPM|HP)$|^\d+X\d+$|^\d+MM\d*$|^(?:SS|AISI|SUS)\d{3}L?$|^\d+(?:PPR|DI|DO|AI|AO|PIN|CORE|UF|NF|PF|NO|NC|CO|P|POLE)$/

interface ItemIndex {
  id: string
  qty: number | null
  tokens: string[]
  /** The codes of the item's own model field, when it has one. */
  own: string[]
  words: Set<string>
}

function indexItems(items: ReplyItemRef[]): ItemIndex[] {
  return items.map(it => {
    const toks = modelTokens(`${it.description} ${it.model ?? ''}`).filter(t => !SPEC_SHAPE.test(t))
    // A number the RFQ names as the item's model or part number ("482917") identifies it too.
    const own = (it.model ?? '').replace(/[\s./-]/g, '')
    if (/^\d{5,}$/.test(own) && !toks.includes(own)) toks.push(own)
    const ownToks = modelTokens(it.model ?? '').filter(t => !SPEC_SHAPE.test(t))
    if (/^\d{5,}$/.test(own) && !ownToks.includes(own)) ownToks.push(own)
    return { id: it.id, qty: it.qty ?? null, tokens: toks, own: ownToks, words: new Set(words(it.description)) }
  })
}

interface Match {
  idx: number
  by: MatchedBy
  score: number
  /** Items that match the line equally well (the same model on two RFQ lines): the caller picks by item number or by order. */
  tied?: number[]
}

function matchByContent(raw: string, idx: ItemIndex[]): Match | null {
  const norm = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const lineToks = new Set(raw.toUpperCase().split(/[\s,;|()[\]]+/).map(t => t.replace(/[-./_]/g, '')).filter(Boolean))
  // 1. model codes
  let best: Match | null = null
  let tied = false
  let tiedList: number[] = []
  idx.forEach((it, i) => {
    if (!it.tokens.length) return
    const found = (t: string) => (t.length >= 6 ? norm.includes(t) : lineToks.has(t))
    let hit = 0
    let total = 0
    for (const t of it.tokens) {
      total += t.length
      if (found(t)) hit += t.length
    }
    // The model the RFQ names for the item is what the supplier's line is compared with, not the other codes in its description.
    if (it.own.some(found)) {
      hit = it.own.filter(found).reduce((n, t) => n + t.length, 0)
      total = it.own.reduce((n, t) => n + t.length, 0)
    }
    if (!hit) return
    const score = 0.7 + 0.25 * (hit / total)
    if (best && Math.abs(score - best.score) < 1e-9) {
      tied = true
      tiedList.push(i)
    } else if (!best || score > best.score) {
      best = { idx: i, by: 'model', score }
      tied = false
      tiedList = [i]
    }
  })
  // A code that two items share in the same measure ("SS316" in a valve and a level switch) does not pick one: the wording does.
  if (best && !tied) return best
  // 2. description similarity: how much of the item's own wording the line repeats
  const lw = new Set(words(raw))
  let bestD: Match | null = null
  let bestCommon = 0
  idx.forEach((it, i) => {
    const n = it.words.size
    if (!n) return
    let common = 0
    for (const t of it.words) if (lw.has(t)) common++
    const cov = common / n
    const ok = (common >= 3 && cov >= 0.4) || (common >= 2 && cov >= 0.5) || (n === 1 && common === 1)
    if (!ok) return
    const score = 0.4 + 0.45 * cov
    if (!bestD || score > bestD.score || (score === bestD.score && common > bestCommon)) {
      bestD = { idx: i, by: 'description', score }
      bestCommon = common
    }
  })
  // Two items share the code: the line's own wording decides only when it says a lot (three or more of an item's words, and that item
  // is one of the two); else the caller tells them apart by the row's number or quantity.
  if (best && tied && (!bestD || !tiedList.includes((bestD as Match).idx) || bestCommon < 3)) return { ...(best as Match), tied: tiedList }
  if (bestD) return bestD
  // A short but telling wording ("the pressure transmitter, EUR 980"): two of an item's own plain words and no other item shares one.
  const plain = (xs: Iterable<string>) => [...xs].filter(t => t.length >= 4 && !/^\d/.test(t))
  const lp = new Set(plain(lw))
  let top = -1
  let topN = 0
  let second = 0
  idx.forEach((it, i) => {
    const c = plain(it.words).filter(t => lp.has(t)).length
    if (c > topN) {
      second = topN
      topN = c
      top = i
    } else if (c > second) second = c
  })
  if (top >= 0 && topN >= 2 && second === 0) return { idx: top, by: 'description', score: 0.5 }
  if (best && tied) return { ...(best as Match), tied: tiedList }
  // The supplier's own number for a part we named another way ("XCPL-4410" for our "B 4410"): the same run of four or more digits
  // inside a code, on exactly one item.
  const runs = (t: string) => t.match(/\d{4,}/g) ?? []
  const codeLike = (t: string) => /^[A-Z]{1,6}\d{4,}[A-Z0-9]{0,4}$/.test(t)
  const lineRuns = new Set([...lineToks].filter(codeLike).flatMap(runs))
  const core: number[] = []
  idx.forEach((it, i) => {
    if (it.tokens.filter(codeLike).some(t => runs(t).some(r => lineRuns.has(r)))) core.push(i)
  })
  if (core.length === 1) return { idx: core[0] as number, by: 'model', score: 0.55 }
  return null
}

/** Item numbers a line lists: "items 2 and 3", "Item 2, 3 & 4" (0-based). */
function listedItemNumbers(raw: string, max: number): number[] {
  const m = /\bitems?\s*(?:no\.?|#)?\s*(\d{1,2}(?:\s*(?:,|and|&|\/|\+|und)\s*\d{1,2})*)/i.exec(raw)
  if (!m) return []
  return [...new Set([...(m[1] ?? '').matchAll(/\d{1,2}/g)].map(x => Number(x[0]) - 1))].filter(n => n >= 0 && n < max)
}

/** An item number written in the reply: "2)", "Item 3", "#4:", "1 - ". */
function markerNumber(raw: string, max: number): number | null {
  const m = /^\s*(?:(?:item|pos|position|sr|s\/n|line|no)\.?\s*)?#?\s*(\d{1,3})\s*(?:[.):]|\s+-\s)/i.exec(raw) ?? /\bitem\s*#?\s*(\d{1,3})\b/i.exec(raw)
  if (!m) return null
  const n = Number(m[1])
  return n >= 1 && n <= max ? n - 1 : null
}

// ------------------------------------------------------------------------------------------------ tables

interface TableCols {
  n: number
  price: number
  total: number
  qty: number
  lead: number
  origin: number
  moq: number
  valid: number
  cur: number
  headCur: ReplyCurrency | null
  leadUnit: string | null
  num: number
}

function splitCells(line: string): string[] | null {
  let cells: string[]
  if (line.includes('\t')) cells = line.split('\t')
  else if (line.includes('|')) {
    cells = line.split('|')
    if ((cells[0] ?? '').trim() === '') cells.shift()
    if ((cells[cells.length - 1] ?? '').trim() === '') cells.pop()
  } else if (/\S {2,}\S/.test(line.trim())) cells = line.trim().split(/ {2,}/)
  else return null
  cells = cells.map(c => c.trim())
  return cells.length >= 2 ? cells : null
}

const HEADER_WORD = /^(?:#|no\.?|sr\.?|s\/n|sl|item|items|description|desc|product|particulars|qty|quantity|unit\s*price|price|rate|lead\s*time|lead|delivery|total|amount|origin|country|moq|currency|brand|make|model|part\s*(?:no|number)?|validity|remarks?|unit|uom|stock|availability|pos|menge|einzelpreis|gesamtpreis|beschreibung|bezeichnung|artikel|lieferzeit)\b/i

function tableHeader(cells: string[]): TableCols | null {
  if (cells.length < 3) return null
  if (cells.filter(c => HEADER_WORD.test(c)).length < 2) return null
  if (cells.some(c => /\d{2,}/.test(c.replace(/\([^)]*\)/g, '')))) return null
  const find = (re: RegExp, not?: RegExp) => cells.findIndex(c => re.test(c) && !(not && not.test(c)))
  const total = find(/total|amount|ext\b|line\s*value|gesamt/i)
  // With a list price and a discount, the price is the net one ("List Price | Disc. % | Net Price").
  const PRICE = /price|rate|u\/p|unit\s*cost|unit\s*value|einzelpreis|e-?preis|preis/i
  const net = find(/\bnet\b|after\s*disc|discounted/i, /total|amount/i)
  const notList = find(PRICE, /total|amount|gesamt|\blist\b|\bgross\b/i)
  const price = net >= 0 && PRICE.test(cells[net] ?? '') ? net : notList >= 0 ? notList : find(PRICE, /total|amount|gesamt/i)
  if (price < 0 && total < 0) return null
  const priceCell = cells[price] ?? cells[total] ?? ''
  const leadAt = find(/lead|delivery|dlv|availability|eta|lieferzeit|^(?:wks?|weeks?|days)\.?$/i)
  const leadCell = cells[leadAt] ?? ''
  return {
    n: cells.length,
    price,
    total,
    qty: find(/^(?:qty|quantity|q'ty|nos|menge|anzahl)\b/i),
    lead: leadAt,
    origin: find(/origin|country/i),
    moq: find(/moq/i),
    valid: find(/valid/i),
    cur: find(/^(?:currency|cur|ccy)$/i),
    headCur: (() => {
      const m = new RegExp(CUR_CODE_SRC + '(?![A-Za-z])', 'i').exec(priceCell)
      return m ? normaliseCurrency(m[1]) : null
    })(),
    leadUnit: /weeks?|wks/i.test(leadCell) ? 'weeks' : /days?/i.test(leadCell) ? 'days' : /months?/i.test(leadCell) ? 'months' : null,
    num: find(/^(?:#|no\.?|sr\.?|s\/n|sl)$/i),
  }
}

/**
 * Three cells of a row, left to right, where the first is a whole quantity and the third is it times the second: the unit
 * price ("50 | 480 | 24000.00"). Null when no such three are there.
 */
/**
 * A row that has fewer cells than the heading (a mail client does not write an empty cell: "6 | 265 | 0.1 kg | France" under
 * "Qty | Price | Delivery | Weight | Origin"): the empty cells are put back where the cells fit the columns best. Null when the
 * row is not short by one or two cells, or no placement is clearly best and gives the price column a number.
 */
function alignShortRow(cells: string[], cols: TableCols): string[] | null {
  const missing = cols.n - cells.length
  if (missing < 1 || missing > 2 || cols.n > 14) return null
  const isNum = (c: string) => /^[\D]{0,4}\d[\d,.]*\D{0,4}$/.test(c) && /\d/.test(c)
  const fit = (c: string, i: number): number => {
    const empty = c === ''
    if (i === cols.num) return /^\d{1,3}$/.test(c) ? 2 : -2
    if (i === cols.price || i === cols.total) return empty ? -1 : isNum(c) ? 2 : -2
    if (i === cols.qty) return empty ? -1 : /^\d+(?:\.\d+)?$/.test(c) ? 2 : -2
    if (i === cols.lead) return empty ? 0 : findLeadTime(c, c) ? 2 : -1
    if (i === cols.origin) return empty ? 0 : /^[A-Za-z][A-Za-z .&/-]*$/.test(c) && !/\d/.test(c) ? 1 : -1
    if (i === cols.moq) return empty ? 0 : /^\d+$/.test(c) ? 1 : -1
    if (i === cols.cur) return empty ? 0 : normaliseCurrency(c) ? 1 : -1
    return 0
  }
  let best: string[] | null = null
  let bestScore = -Infinity
  let ties = 0
  const place = (k: number, out: string[], from: number, score: number, left: number) => {
    if (k === cols.n) {
      if (left !== 0) return
      if (score > bestScore) {
        best = [...out]
        bestScore = score
        ties = 0
      } else if (score === bestScore) ties++
      return
    }
    const cellsLeft = cells.length - from
    // keep the next cell here
    if (cellsLeft > 0) place(k + 1, [...out, cells[from] as string], from + 1, score + fit(cells[from] as string, k), left)
    // or leave this column empty
    if (left > 0) place(k + 1, [...out, ''], from, score + fit('', k), left - 1)
  }
  place(0, [], 0, 0, missing)
  const filled = best as string[] | null
  if (!filled || ties > 0) return null
  const pc = cols.price >= 0 ? cols.price : cols.total
  return pc >= 0 && isNum(filled[pc] ?? '') ? filled : null
}

/**
 * A row that starts with the serial number, then the end of the row above ("3 | 380 0.3 kg India | 3 | | Model: X | Brand: Y | 6 265
 * 0.1 kg India"): the cells before the item's own cell are the previous item's (its price is the first number that is no weight),
 * and the last cell holds the quantity and price run together. Null for any other row.
 */
function spillRow(cells: string[] | null, cols: TableCols, idx: ItemIndex[]): { lead: string; price: number | null; row: string[] } | null {
  if (!cells || cells.length < 5 || cols.num < 0 || !/^\d{1,3}$/.test(cells[0] ?? '')) return null
  const at = cells.findIndex((c, i) => i >= 2 && matchByContent(c, idx) !== null)
  if (at < 2) return null
  const lead = cells.slice(1, at).filter(Boolean)
  if (!lead.length || lead.every(c => !/\d/.test(c))) return null
  const first = /(?<![\d.])(\d[\d,]*(?:\.\d+)?)(?!\s*(?:kg|g|mm|cm)\b)(?![\d.])/i.exec(lead.join(' '))
  const rest = cells.slice(at)
  const tail = rest[rest.length - 1] ?? ''
  const toks = tail.match(/\d[\d,]*(?:\.\d+)?(?:\s*(?:kg|g)\b)?|[A-Za-z][A-Za-z .&/-]*/g)
  if (!toks || toks.length < 3 || !/^\d+$/.test((toks[0] ?? '').trim()) || !/^\d[\d,]*(?:\.\d+)?$/.test((toks[1] ?? '').trim())) return null
  const desc = rest.slice(0, -1).filter(Boolean).join(' ')
  const row = [cells[0] as string, desc, (toks[0] as string).trim(), (toks[1] as string).trim(), '', ...toks.slice(2).map(t => t.trim())]
  return { lead: lead.join(' '), price: first ? Number((first[1] as string).replace(/,/g, '')) : null, row }
}

function qtyPriceTotal(cells: string[]): { qty: number; price: number } | null {
  const nums = cells.map((c, i) => {
    const t = c.trim().replace(/^(?:[A-Za-z$€£¥]{1,4}\.?\s?)/, '')
    if (!/^\d[\d,]*(?:\.\d+)?$/.test(t)) return null
    const a = parseAmount(t)
    return a && a.value > 0 ? { i, v: a.value, whole: /^\d{1,6}$/.test(t) } : null
  })
  const ns = nums.filter((n): n is { i: number; v: number; whole: boolean } => n !== null)
  for (let a = 0; a < ns.length; a++)
    for (let b = a + 1; b < ns.length; b++)
      for (let c = b + 1; c < ns.length; c++) {
        const q = ns[a]!
        const p = ns[b]!
        const t = ns[c]!
        if (!q.whole || q.v > 100000) continue
        if (Math.abs(q.v * p.v - t.v) <= Math.max(0.011, 0.002 * t.v)) return { qty: q.v, price: p.v }
      }
  return null
}

const SEPARATOR_ROW =/^[\s|:\-+=_*]{3,}$/

function analyseRow(cells: string[], cols: TableCols, today: string | undefined): LineFields {
  const f = analyse(cells.join(' | '), today, true)
  const cell = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '')
  const amount = (txt: string): PriceCand | null => {
    if (!txt || /^[-–—/n.a]+$/i.test(txt)) return null
    const anch = findAnchoredPrices(txt, null)[0]
    if (anch) return anch
    const m = new RegExp(AMOUNT_SP).exec(txt)
    if (!m) return null
    const amt = parseAmount(`${m[1] ?? ''}${m[2] ?? ''}`)
    if (!amt || amt.value <= 0) return null
    // a price column is an explicit statement, so a number in it counts as anchored (its currency may still be missing)
    return { ...amt, currency: null, anchored: true, start: 0, end: txt.length, kind: 'unknown', forQty: null }
  }
  const curCell = normaliseCurrency(cell(cols.cur)) ?? cols.headCur
  const p = amount(cell(cols.price))
  const t = amount(cell(cols.total))
  const prices: PriceCand[] = []
  if (p) prices.push({ ...p, kind: 'unit', currency: p.currency ?? curCell })
  if (t) prices.push({ ...t, kind: 'total', currency: t.currency ?? curCell })
  f.prices = prices
  // "NA." under the price heading: the supplier has no price for this item.
  if (prices.length === 0 && !f.regret && /^(?:n\.?\/?a\.?|nil|not\s+available|unavailable)$/i.test(cell(cols.price))) {
    f.regret = { kind: 'unavailable', text: cells.join(' ').trim() }
  }
  const q = cell(cols.qty)
  if (/^(?:\d{1,3}(?:,\d{3})+|\d+(?:\.\d{1,3})?)$/.test(q)) f.qty = Number(q.replace(/,/g, ''))
  if (cols.lead >= 0 && !f.lead) {
    const lc = cell(cols.lead)
    const direct = findLeadTime(lc.replace(/[–—−]/g, '-'), lc)
    if (direct) {
      f.lead = { text: direct.text, daysMin: direct.daysMin, daysMax: direct.daysMax, exStock: direct.exStock }
      if (direct.exStock) f.inStock = true
    } else if (cols.leadUnit && /^\d+(?:\s*[-–]\s*\d+)?$/.test(lc)) {
      const lt = parseLeadTime(`${lc} ${cols.leadUnit}`)
      if (lt) f.lead = lt
    }
  }
  if (cols.origin >= 0 && !f.origin && cell(cols.origin) && !/^[-–—]+$/.test(cell(cols.origin))) f.origin = cell(cols.origin)
  if (cols.moq >= 0 && f.moq === null && /^\d+$/.test(cell(cols.moq))) f.moq = Number(cell(cols.moq))
  if (cols.valid >= 0 && !f.validityText && cell(cols.valid)) {
    const vv = findValidity(`valid ${cell(cols.valid)}`, `valid ${cell(cols.valid)}`, today)
    f.validityText = cell(cols.valid)
    f.validityDays = vv ? vv.days : null
  }
  return f
}

// ------------------------------------------------------------------------------------------------ our own RFQ quoted below the reply

const HDR_FROM = /^\s*[*_>\s]*(?:from|von|de|da|发件人|寄件者)(?:\s*[:：]|\t)/i
const HDR_OTHER = /^\s*[*_>\s]*(?:sent|date|datum|gesendet|envoy[eé]|inviato|to|an|à|cc|bcc|subject|betreff|objet|oggetto|发送时间|发送日期|日期|收件人|抄送|主题|主旨)(?:\s*[:：]|\t)/i
const SEP_LINE = /^\s*(?:[-_=*~]{4,}|[-_=*~]{2,}\s*[^-_=*~\n]{3,40}?\s*[-_=*~]{2,})\s*$/
const ORIGINAL_MSG = /^\s*[-_=*~]{2,}\s*(?:original\s+(?:message|mail)|reply\s+message|原始邮件|原邮件|原始信息)\s*[-_=*~]{2,}\s*$|^\s*(?:original\s+message|原始邮件)\s*[:：]?\s*$/i
const FORWARDED_MSG = /^\s*[-_=*~]{2,}\s*(?:forwarded\s+(?:message|mail)|fwd?:|转发邮件|转发的邮件)/i
const WROTE_END = /(?:\bwrote|\bschrieb|a\s+[eé]crit|ha\s+scritto|escribi[oó]|写道|寫道)\s*[:：]?\s*$/i
/** A line that introduces a quote ("On Tue, 13 Oct at 09:12, X wrote:", "<x@y> 于2026年10月19日周一 09:41写道："). */
const WROTE_LINE = /^.{0,240}$/

/** Index of the first quoted line of the reply, or null. Our own RFQ is quoted below the supplier's answer, never above it. */
function quotedStart(lines: string[]): number | null {
  const filled = (i: number) => (lines[i] ?? '').trim() !== ''
  const headerAt = (i: number): boolean => {
    if (!HDR_FROM.test(lines[i] ?? '')) return false
    let seen = 0
    for (let j = i + 1; j < lines.length && j <= i + 8; j++) {
      if (!filled(j)) continue
      if (HDR_OTHER.test(lines[j] ?? '')) seen++
      else if (seen === 0 || !/^\s*[*_>\s]*[\p{L}]+\s*[:：]/u.test(lines[j] ?? '')) break
    }
    return seen >= 1
  }
  let contentAbove = false
  let forwarded = false
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i] ?? ''
    if (!t.trim()) continue
    if (FORWARDED_MSG.test(t)) {
      forwarded = true
      continue
    }
    const explicit = ORIGINAL_MSG.test(t)
    const wrote = WROTE_END.test(t) && WROTE_LINE.test(t)
    const header = headerAt(i)
    if (explicit || wrote || header) {
      if (header && forwarded) {
        // The header of a forwarded message: what follows is the supplier's own reply, not a quote of ours.
        forwarded = false
        let j = i
        while (j < lines.length && (filled(j) ? HDR_FROM.test(lines[j] ?? '') || HDR_OTHER.test(lines[j] ?? '') || /^\s*[\p{L}]+\s*[:：]/u.test(lines[j] ?? '') : j === i)) j++
        i = j - 1
        continue
      }
      if (!contentAbove && !explicit) {
        // The very top is the reply's own header (a forwarded copy): skip the header lines and read on.
        let j = i
        while (j < lines.length && filled(j) && /^\s*[*_>\s]*[\p{L}]+\s*[:：]/u.test(lines[j] ?? '')) j++
        i = Math.max(i, j - 1)
        continue
      }
      let s = i
      if (wrote && i > 0 && filled(i - 1) && !/[.!?:]\s*$/.test(lines[i - 1] ?? '') && /^\s*(?:on|am|le|il|el)\b/i.test(lines[i - 1] ?? '')) s = i - 1
      // The separator line or blank lines just above belong to the quote.
      while (s > 0 && (!filled(s - 1) || SEP_LINE.test(lines[s - 1] ?? ''))) s--
      return s
    }
    if (!SEP_LINE.test(t)) contentAbove = true
  }
  return null
}

/**
 * The reply without the quoted RFQ below it: cut at an Outlook "From:/Sent:/To:/Subject:" block (also German, French,
 * Italian and Chinese headings), "-----Original Message-----" or "On ... wrote:"; lines starting with ">" are blanked.
 * Line numbers of what is kept do not move. A copy whose very top is the reply's own header, or a forwarded message, is
 * read below that header.
 */
export function stripQuotedReply(text: string): string {
  const lines = (text ?? '').split(/\r?\n/).map(l => (/^\s*>/.test(l) ? '' : l))
  const cut = quotedStart(lines)
  return (cut === null ? lines : lines.slice(0, cut)).join('\n')
}

// ------------------------------------------------------------------------------------------------ questions

const SIGN_OFF = /^\s*(?:(?:with\s+)?(?:best|kind|warm|many|sincere)?\s*(?:regards|wishes)\b|yours\s+(?:sincerely|faithfully|truly)|sincerely\b|thanks?\s*(?:&|and)\s*(?:best\s*)?regards|mit\s+freundlichen|cordiali\s+saluti|cordialement|此致|祝好|顺祝商祺)/i
/** An amount written with its currency: the only thing read from a signature. */
const ANCHORED_AMOUNT = /[$€£¥￥]\s*\d|\b(?:USD|EUR|CNY|RMB|AED|GBP|PKR|Rs\.?)\s*\d|\d\s*(?:USD|EUR|CNY|RMB|AED|GBP|PKR|元)\b/i
/** Contact lines of a signature: telephone, address, messaging ids, web. */
const CONTACT_LINE = /^\s*[*•-]?\s*(?:tel(?:ephone)?|fax|mob(?:ile)?|cell|phone|add(?:ress)?|post\s*code|zip|qq|wechat|whatsapp|skype|teams|e-?mail|website|web|hotmail|gmail|mailto)\s*\d?\s*[:：.\t]|^\s*(?:www\.|https?:)/i
const ADDRESS_LINE = /^[^$€£¥￥]*\b(?:building|road|street|lane|district|province|block|floor|room|mansion|tower|avenue|town|village|plaza|industrial|estate|park|strasse|straße)\b[^$€£¥￥]*,[^$€£¥￥]*$/i

const ASK_PLEASE =
  /\b(?:(?:please|pls|kindly)\s+(?:confirm|advise|clarify|let\s+(?:us|me)\s+know|tell|send|share|provide|specify|revert|help|check)|(?:we|i)\s+(?:need|require)\s+(?:more|further|your|the|some|to\s+know)|can\s+you|could\s+you|would\s+you|do\s+you|did\s+you|are\s+you\s+(?:able|looking)|is\s+it\s+(?:possible|ok|okay)|which\s+(?:size|model|type|brand|one|version|item)|what\s+(?:is|are|size|model|type|quantity|qty|brand)|how\s+many|how\s+much)\b|请问|能否|是否|可否|请确认|请告知|请提供|请补充|请说明|请告诉|麻烦/i

/** The line asks something. A "?" counts (a URL query does not); so do the usual please-confirm and which-size forms. */
function asksQuestion(raw: string): boolean {
  const s = raw.replace(/(?:https?:\/\/|www\.)\S+/gi, ' ')
  return /[?？]/.test(s) || ASK_PLEASE.test(s)
}

// ------------------------------------------------------------------------------------------------ a substitute model

const CODE_AT = String.raw`(?=[A-Za-z0-9._/-]*[A-Za-z])(?=[A-Za-z0-9._/-]*\d)[A-Za-z0-9][A-Za-z0-9._/-]*[A-Za-z0-9]`
const SUB_FILL = String.raw`(?:(?:model|type|part\s*(?:no\.?|number)?|p\/n|pn|code|ref(?:erence)?|item|no\.?|is|as|the|a|an|our|new|with|to|by|for|:)\s*[:.-]?\s*)*`
const SUB_AFTER_RE = new RegExp(
  String.raw`(?:replac(?:ement|ed\s+(?:by|with)|es?\s+with)|substitut(?:e|ion|ed\s+(?:by|with))|alternativ(?:e|ely)|supersed(?:ed|es)\s+by|successor|upgraded?\s+to|new\s+model|equivalent|instead|(?:we\s+)?(?:can\s+)?(?:offer|quote|suggest|propose|recommend)(?:ed|ing)?|offering|offered|suggested|proposed|替代|替换|代替|改为)[^A-Za-z0-9]{0,12}${SUB_FILL}(${CODE_AT})`,
  'i',
)
const SUB_BEFORE_RE = new RegExp(
  String.raw`(${CODE_AT})\s*[,(-]?\s*(?:which\s+)?(?:replaces|replacing|supersedes|superseding|to\s+replace|(?:is\s+)?(?:the\s+)?(?:replacement|successor|substitute|alternative|equivalent)\s+(?:of|for|to)|instead\s+of|in\s+place\s+of|substitutes?\s+(?:for)?)`,
  'i',
)

/** The model a reply line offers in place of the one asked for ("replacement PT-200", "PT-200 (replaces PT-100)"), else null. */
function offeredModel(text: string, own: readonly string[]): string | null {
  const squeeze = (s: string) => s.toUpperCase().replace(/[-./_]/g, '')
  const mine = new Set(own)
  for (const re of [SUB_BEFORE_RE, SUB_AFTER_RE]) {
    const g = new RegExp(re.source, 'gi')
    let m: RegExpExecArray | null
    while ((m = g.exec(text))) {
      const tok = (m[1] ?? '').replace(/[.,;:]+$/, '')
      const sq = squeeze(tok)
      if (sq.length < 4 || mine.has(sq) || SPEC_SHAPE.test(sq) || modelTokens(tok).length === 0) continue
      return tok
    }
  }
  return null
}

// ------------------------------------------------------------------------------------------------ main

/** "The pump is the only item we can supply." */
const ONLY_SUPPLY_RE = /\b(?:is|are)\s+the\s+only\s+(?:item|product|one|part)s?\s+(?:that\s+)?(?:we|i)\s+(?:can|could)\s+(?:supply|offer|quote|provide)/i
const POINTER_RE = /\b(?:pls|please)?\s*see\s+(?:below|next|the\s+next)|\bas\s+below\b|\balternat(?:ive|e)\b/i

/** The first part-number-like word of a line that is not one of the item's own codes (the model a supplier offers in its place). */
function firstCode(text: string, own: readonly string[]): string | undefined {
  for (const raw of text.split(/[\s,;|()[\]]+/)) {
    const tok = raw.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
    const sq = tok.toUpperCase().replace(/[-./_]/g, '')
    if (sq.length >= 4 && /[A-Z]/.test(sq) && /\d/.test(sq) && !own.includes(sq) && !SPEC_SHAPE.test(sq) && modelTokens(tok).length > 0) return tok
  }
  return undefined
}

interface Draft {
  /** The model offered in place of the item's (a row that answers a "see below"). */
  pn?: string
  itemIdx: number | null
  by: MatchedBy
  matchScore: number
  f: LineFields
  snippets: string[]
  lines: number[]
}

const PRICE_LABEL_LINE = /^\s*(?:[-•*]\s*)?(?:unit\s*)?(?:price|rate|cost)\b/i
const GLOBAL_RE = /\b(?:all\s+(?:items|prices|the\s+above)?|every|above|overall|generally|for\s+everything|for\s+all|each\s+item)\b/i
const LABEL_START = /^\s*(?:[-•*]\s*)?(?:price|unit\s*price|rate|total|lead|delivery|dlv|origin|moq|min|valid|validity|stock|availability|qty|quantity|brand|make|remarks?|note|eta|cost|offer)\b/i
const GREETING_HEADER = /^\s*(?:from|to|cc|bcc|subject|sent|date|reply-to)\s*:/i
const WA_PREFIX = /^\s*\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AaPp]\.?[Mm]\.?)?\]?\s*[-–]?\s*(?:[^:\d][^:]{0,40}:\s)?/

interface Line {
  n: number
  text: string
}

/** Non-empty lines with their numbers; lines like "1) USD 8 2) USD 9" are cut at the markers. */
function prepare(text: string): Line[] {
  const out: Line[] = []
  let signed = false
  text.split(/\r?\n/).forEach((l, i) => {
    const t = l.replace(/\u00a0/g, ' ').replace(WA_PREFIX, '').trimEnd()
    if (!t.trim() || /^\s*>/.test(t) || GREETING_HEADER.test(t)) {
      if (!t.trim()) out.push({ n: i + 1, text: '' })
      return
    }
    // A "Best regards" in the middle of a mail (a template's greeting above the quotation table): the table's heading ends it.
    if (signed) {
      const hc = t.includes('	') ? splitCells(t) : null
      if (hc && tableHeader(hc)) signed = false
    }
    if (CONTACT_LINE.test(t) || (signed && !ANCHORED_AMOUNT.test(t)) || (ADDRESS_LINE.test(t) && !ANCHORED_AMOUNT.test(t))) return
    if (SIGN_OFF.test(t) && t.length < 60) {
      signed = true
      return
    }
    const marks = [...t.matchAll(/(?:^|\s)(\d{1,2})\)\s/g)]
    const nums = marks.map(m => Number(m[1]))
    if (marks.length >= 2 && nums.every((n, k) => k === 0 || n === (nums[k - 1] ?? 0) + 1)) {
      const starts = marks.map(m => m.index + (m[0].startsWith(' ') ? 1 : 0))
      starts.forEach((s, k) => out.push({ n: i + 1, text: t.slice(s, starts[k + 1] ?? t.length).trim() }))
      return
    }
    for (const piece of sentences(t)) out.push({ n: i + 1, text: piece })
  })
  return out
}

const ABBREV = /(?:\b(?:no|nos|rs|approx|min|max|qty|pcs|dhs|ex|ref|inc|incl|excl|ltd|co|dr|mr|mrs|ms|st|fig|tel|vs|etc|est|sr|ph|mob|attn|pos|dia|pkr|usd|eur|cny|rmb|aed|gbp|sec)|\b[A-Za-z])$/i

/** A paragraph of several sentences as one piece each ("USD 120 each. Delivery 3 weeks."), never inside a table row or a price. */
function sentences(t: string): string[] {
  if (t.length < 50 || /\t|\|/.test(t)) return [t]
  const out: string[] = []
  let from = 0
  const re = /(?<=[a-z0-9)\]%"'])\.\s+(?=[A-Z])|(?<=[?!])\s+(?=[A-Z])|。\s*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const before = t.slice(from, m.index)
    if (m[0].startsWith('.') && ABBREV.test(before)) continue
    const piece = (before + (m[0].startsWith('.') ? '.' : '')).trim()
    if (piece) out.push(piece)
    from = m.index + m[0].length
  }
  const rest = t.slice(from).trim()
  if (rest) out.push(rest)
  return out.length ? out : [t]
}

export { sentences as splitSentences }

const snip = (s: string) => (s.length > 220 ? `${s.slice(0, 217)}...` : s)

export function parseSupplierReply(text: string, rfqItems: ReplyItemRef[], opts: ParseReplyOptions = {}): ParsedReply {
  const inheritOn = opts.inheritReplyLevel !== false
  const lines = prepare(stripQuotedReply(text ?? ''))
  const idx = indexItems(rfqItems)
  const nonEmpty = lines.filter(l => l.text).length

  const drafts: Draft[] = []
  const pending: Draft[] = []
  const declined: DeclinedItem[] = []
  const regretLines: Array<{ kind: RegretKind; text: string }> = []
  const questionLines: string[] = []
  const globals: LineFields = {
    prices: [], lead: null, inStock: null, origin: null, moq: null, validityText: null, validityDays: null, qty: null, declaredCurrency: null, regret: null, question: false,
  }
  let current: Draft | null = null
  /** The item of a table row that only points to the next row ("pls see below"). */
  let pointer: number | null = null
  let blankSince = false
  let cols: TableCols | null = null

  const mergeInto = (d: Draft, f: LineFields, line: Line) => {
    const t = d.f
    if (!t.prices.length || (t.prices.every(p => !p.anchored) && f.prices.some(p => p.anchored))) t.prices = f.prices
    t.lead ??= f.lead
    t.inStock ??= f.inStock
    t.origin ??= f.origin
    t.moq ??= f.moq
    t.validityText ??= f.validityText
    if (t.validityDays === null) t.validityDays = f.validityDays
    t.qty ??= f.qty
    d.snippets.push(line.text.trim())
    d.lines.push(line.n)
  }

  for (const rawLine of lines) {
    let line = rawLine
    if (!line.text) {
      blankSince = true
      cols = null
      continue
    }
    if (SEPARATOR_ROW.test(line.text)) continue

    // A row whose first cells are the end of the row above (a mail export that scrambled the cells): that part goes to the item
    // above, and the row goes on from its own item.
    const spill = cols && current !== null && current.itemIdx !== null && current.f.prices.length === 0 ? spillRow(splitCells(line.text), cols, idx) : null
    if (spill) {
      const lf = analyse(spill.lead, opts.today)
      const lp = spill.price !== null ? [{ value: spill.price, currency: cols?.headCur ?? null, ambiguous: false, anchored: true, kind: 'unit' as const, forQty: null, start: 0, end: 0 }] : []
      if (lp.length) lf.prices = lp
      mergeInto(current as Draft, lf, line)
      line = { ...line, text: spill.row.join('	') }
    }
    const cells = splitCells(line.text)
    const header = cells ? tableHeader(cells) : null
    if (header) {
      cols = header
      continue
    }
    // A row a mail client left short (its empty cells are not written) is put back under the heading it belongs to.
    const aligned = cols && cells && cells.length < cols.n ? alignShortRow(cells, cols) : null
    const rowCells = aligned ?? cells
    const rowCols = cols && rowCells && rowCells.length === cols.n ? cols : null
    // A list number in front of a sentence ("3.) Payment terms: ...") is a list number, not a price.
    // (A table row under a heading: its serial number is not a price either.)
    const analysable = cells ? (cols && !rowCols && cells.length <= 2 && cols.num >= 0 && /^\d{1,3}$/.test(cells[0] ?? '') ? cells.slice(1).join(String.fromCharCode(9)) : line.text) : line.text.replace(/^\s*\d{1,2}\s*[.)]+\s*(?=[A-Za-z])/, '')
    const f = rowCols && rowCells ? analyseRow(rowCells, rowCols, opts.today) : analyse(analysable, opts.today)
    // A row whose empty cells were trimmed ends in "NA.": no price for this item.
    if (!f.regret && !rowCols && cells && cells.length >= 3 && f.prices.length === 0 && /^(?:n\.?\/?a\.?|nil|not\s+available|unavailable)$/i.test(cells[cells.length - 1] ?? '')) {
      f.regret = { kind: 'unavailable', text: line.text.trim() }
    }
    // A table row with no heading to go by (a picture lost it): quantity × unit price = total names the unit price.
    if (!rowCols && cells) {
      const qpt = qtyPriceTotal(cells)
      if (qpt) {
        const cur = f.prices.find(p => p.currency)?.currency ?? null
        f.prices = [{ value: qpt.price, currency: cur, ambiguous: false, anchored: true, kind: 'unit', forQty: null, start: 0, end: 0 }]
        f.qty = qpt.qty
      }
    }
    const rowNumber = rowCols && rowCells && rowCols.num >= 0 && /^\d{1,3}$/.test(rowCells[rowCols.num] ?? '') ? Number(rowCells[rowCols.num]) - 1 : null
    const numIdx = rowNumber !== null && rowNumber >= 0 && rowNumber < idx.length ? rowNumber : markerNumber(line.text, idx.length)
    let match = matchByContent(line.text, idx)
    // The same model on two RFQ lines: the row's own item number decides, else the first of them that has no answer yet.
    if (match?.tied) {
      const answered = new Set<number>([...drafts.filter(d => d.itemIdx !== null && hasData(d.f)).map(d => d.itemIdx as number), ...declined.map(d => idx.findIndex(i => i.id === d.rfqItemId))])
      const sameQty = f.qty === null ? [] : match.tied.filter(k => idx[k]?.qty === f.qty && !answered.has(k))
      const pick = sameQty.length === 1 ? (sameQty[0] as number) : numIdx !== null && match.tied.includes(numIdx) ? numIdx : (match.tied.find(k => !answered.has(k)) ?? (match.tied[0] as number))
      match = { idx: pick, by: match.by, score: match.score }
    }

    // "The pump is the only item we can supply": every other item is declined.
    if (ONLY_SUPPLY_RE.test(line.text) && idx.length > 1) {
      if (match) {
        const keep = match.idx
        idx.forEach((it, k) => {
          if (k !== keep && !declined.some(d => d.rfqItemId === it.id)) declined.push({ rfqItemId: it.id, kind: 'cannot_quote', snippet: snip(line.text.trim()) })
        })
      }
      blankSince = false
      continue
    }

    if (f.regret) {
      const listed = listedItemNumbers(line.text, idx.length)
      const target = match ?? (numIdx !== null ? { idx: numIdx, by: 'item-number' as MatchedBy, score: 0.6 } : null)
      const under =
        current !== null && current.itemIdx !== null && !blankSince && current.f.prices.length === 0 && (/^\s{2,}\S/.test(line.text) || /^\s*[-•*→]\s/.test(line.text))
          ? current.itemIdx
          : null
      const ids = listed.length > 1 ? listed : target ? [target.idx] : under !== null ? [under] : []
      if (ids.length) {
        for (const k of ids) {
          const it = idx[k]
          if (it && !declined.some(d => d.rfqItemId === it.id)) declined.push({ rfqItemId: it.id, kind: f.regret.kind, snippet: snip(f.regret.text) })
        }
      } else regretLines.push(f.regret)
      blankSince = false
      continue
    }

    // A reply that only asks ("which size?", "please confirm the quantity") quotes nothing: its numbers are not offers.
    if (f.question && !f.prices.some(p => p.anchored)) {
      questionLines.push(line.text.trim())
      blankSince = false
      continue
    }

    let m: Match | null = match
    if (!m && numIdx !== null) m = { idx: numIdx, by: 'item-number', score: 0.6 }
    // "7 | MS495 | 2 | | | pls see below", then a row with no number and another model: the answer for item 7 is that row's part.
    let altPn: string | undefined
    if (!m && rowCols && pointer !== null && rowNumber === null && f.prices.some(p => p.anchored)) {
      m = { idx: pointer, by: 'item-number', score: 0.6 }
      altPn = firstCode(line.text, idx[pointer]?.tokens ?? [])
    }
    pointer = null

    if (m) {
      const d: Draft = { itemIdx: m.idx, by: m.by, matchScore: m.score, f, snippets: [line.text.trim()], lines: [line.n], pn: altPn }
      drafts.push(d)
      current = d
      blankSince = false
      if (rowCols && f.prices.length === 0 && POINTER_RE.test(line.text)) pointer = m.idx
      continue
    }

    // A numbered sentence that names no item ("3) Handling charge: USD 12.00", "4) For orders under 500 EUR a surcharge") is a term of
    // the offer, not an offer.
    if (!cells && /^\s*\d{1,2}\s*[.)]+\s*[A-Za-z]/.test(line.text) && line.text.trim().split(/\s+/).length >= 3) {
      if (f.declaredCurrency) globals.declaredCurrency ??= f.declaredCurrency
      blankSince = false
      continue
    }

    if (!hasData(f)) {
      if (f.declaredCurrency) globals.declaredCurrency ??= f.declaredCurrency
      blankSince = false
      continue
    }

    const forAll = GLOBAL_RE.test(line.text)
    // A price label ("Unit price $181") under a block of the item's own lines belongs to that item even across blank lines (a mail client
    // that double-spaces its text), as long as it is close.
    const near = current !== null && current.itemIdx !== null && current.f.prices.length === 0 && f.prices.length > 0 && PRICE_LABEL_LINE.test(line.text) && line.n - (current.lines[current.lines.length - 1] ?? 0) <= 14
    // The price line straight under a line that named the item and gave no price ("1) XQ-100 Maker - NEW" / "Timing relay ...
    // 69,87USD 1 In stock"), and a line that only repeats that price as the total ("5-7 days  69,87USD").
    const headerUnder = current !== null && current.itemIdx !== null && current.f.prices.length === 0 && !blankSince && f.prices.length > 0 && line.n - (current.lines[current.lines.length - 1] ?? 0) <= 2
    const repeatsPrice =
      current !== null && current.itemIdx !== null && !blankSince && f.prices.length > 0 && f.prices.every(p => current!.f.prices.some(c => Math.abs(c.value - p.value) < 0.005)) && line.n - (current.lines[current.lines.length - 1] ?? 0) <= 2
    const continuation =
      current !== null && !forAll && (near || headerUnder || repeatsPrice || (!blankSince && (LABEL_START.test(line.text) || /^\s{2,}\S/.test(line.text) || /^\s*[-•*]\s/.test(line.text))))
    if (continuation && current) {
      mergeInto(current, f, line)
    } else if (!f.prices.length) {
      globals.lead ??= f.lead
      globals.inStock ??= f.inStock
      globals.origin ??= f.origin
      globals.validityText ??= f.validityText
      if (globals.validityDays === null) globals.validityDays = f.validityDays
      globals.moq ??= f.moq
      if (f.declaredCurrency) globals.declaredCurrency ??= f.declaredCurrency
      current = null
    } else {
      const d: Draft = { itemIdx: null, by: 'none', matchScore: 0, f, snippets: [line.text.trim()], lines: [line.n] }
      pending.push(d)
      drafts.push(d)
      current = d
    }
    blankSince = false
  }

  // ---- position: price lines nobody could place
  const covered = new Set(drafts.filter(d => d.itemIdx !== null && hasData(d.f)).map(d => d.itemIdx as number))
  if (pending.length) {
    if (idx.length === 1) {
      for (const d of pending) {
        d.itemIdx = 0
        d.by = 'single-item'
        d.matchScore = 0.6
      }
    } else {
      const free = idx.map((_, i) => i).filter(i => !covered.has(i))
      pending.forEach((d, k) => {
        const slot = free[k]
        if (slot !== undefined && pending.length <= free.length) {
          d.itemIdx = slot
          d.by = 'position'
          d.matchScore = 0.35
        }
      })
    }
  }

  // ---- reply-level currency: the one the reply states, else the only one it uses
  const used = new Set<ReplyCurrency>()
  for (const d of drafts) for (const p of d.f.prices) if (p.currency) used.add(p.currency)
  const replyCurrency: ReplyCurrency | null = globals.declaredCurrency ?? (used.size === 1 ? [...used][0] ?? null : null)

  // ---- build offers
  const offers: ReplyOffer[] = []
  for (const d of drafts) {
    if (!hasData(d.f)) continue
    const it = d.itemIdx !== null ? idx[d.itemIdx] ?? null : null
    const flags: OfferFlag[] = []
    const inherited: InheritedField[] = []
    const unitCands = d.f.prices.filter(p => p.kind !== 'total')
    const totalCand = d.f.prices.find(p => p.kind === 'total') ?? null
    let main: PriceCand | null = unitCands[0] ?? null
    let unitPrice = main ? main.value : null
    let currency: ReplyCurrency | null = main?.currency ?? totalCand?.currency ?? null
    const qty = d.f.qty ?? totalCand?.forQty ?? null
    let derived = false
    if (unitPrice === null && totalCand) {
      const q = qty ?? it?.qty ?? null
      if (q && q > 0) {
        unitPrice = Math.round((totalCand.value / q) * 10000) / 10000
        derived = true
        main = totalCand
        flags.push('derived_from_total')
      }
    }
    let currencySource: CurrencySource = currency ? 'line' : null
    if (!currency && inheritOn && replyCurrency && (unitPrice !== null || totalCand)) {
      currency = replyCurrency
      currencySource = 'reply'
      inherited.push('currency')
    }
    // "EUR 1.250" is 1.25 or 1,250: the app does not guess. The offer stays (the item, lead time and the line are real) with no price,
    // flagged, so the engineer types the figure.
    const ambiguous = Boolean(main?.ambiguous)
    if (ambiguous) {
      flags.push('ambiguous_separator')
      unitPrice = null
    }
    if (unitCands.length > 1) flags.push('multiple_prices')
    if (main && !main.anchored && !derived) flags.push('bare_number')
    if (unitPrice === null) flags.push('price_missing')
    else if (!currency) flags.push('currency_missing')
    if (d.by === 'position') flags.push('match_by_position')
    if (d.itemIdx === null) flags.push('no_item_match')
    const offeredPn = unitPrice !== null ? d.pn ?? offeredModel(d.snippets.join(' '), it?.tokens ?? []) : null
    if (offeredPn) flags.push('substitute')

    let lead = d.f.lead
    let inStock = d.f.inStock
    let origin = d.f.origin
    let validityText = d.f.validityText
    let validityDays = d.f.validityDays
    if (inheritOn) {
      if (!lead && globals.lead) {
        lead = globals.lead
        inherited.push('leadTime')
      }
      if (inStock === null && globals.inStock !== null) {
        inStock = globals.inStock
        inherited.push('stock')
      }
      if (!origin && globals.origin) {
        origin = globals.origin
        inherited.push('origin')
      }
      if (!validityText && globals.validityText) {
        validityText = globals.validityText
        validityDays = globals.validityDays
        inherited.push('validity')
      }
    }

    // confidence: how sure the item is, times how clean the price is
    let priceScore = 0
    if (unitPrice !== null) priceScore = main?.anchored ? 1 : 0.6
    if (derived) priceScore = 0.5
    if (ambiguous) priceScore *= 0.8
    if (unitCands.length > 1) priceScore *= 0.8
    if (unitPrice !== null && !currency) priceScore *= 0.85
    if (currencySource === 'reply') priceScore *= 0.95
    let score = d.itemIdx === null ? 0.15 : unitPrice !== null ? d.matchScore * priceScore : Math.min(d.matchScore, 0.9) * 0.6
    score = Math.round(score * 100) / 100
    const confidence: Confidence = score >= 0.75 ? 'high' : score >= 0.45 ? 'medium' : 'low'

    offers.push({
      rfqItemId: it?.id ?? null,
      matchedBy: d.itemIdx === null ? 'none' : d.by,
      matchScore: Math.round(d.matchScore * 100) / 100,
      offeredPn,
      unitPrice,
      currency,
      currencySource,
      totalPrice: totalCand ? totalCand.value : null,
      qty,
      leadTimeText: lead?.text ?? null,
      leadTimeDaysMax: lead?.daysMax ?? null,
      leadTimeDaysMin: lead?.daysMin ?? null,
      inStock,
      origin,
      moq: d.f.moq,
      validityText,
      validityDays,
      otherPrices: unitCands.slice(1).map(p => ({ unitPrice: p.value, currency: p.currency })),
      inherited,
      flags,
      confidence,
      score,
      snippet: snip(d.snippets.join(' / ')),
      lineNumbers: d.lines,
    })
  }

  // ---- regret: the reply declines when it says so and quotes nothing
  const anyPrice = offers.some(o => o.unitPrice !== null)
  const regret = !anyPrice && (regretLines.length > 0 || declined.length > 0)
  let finalDeclined = declined
  if (regretLines.length > 0 && !anyPrice) {
    const first = regretLines[0]
    const have = new Set(declined.map(x => x.rfqItemId))
    finalDeclined = [
      ...declined,
      ...idx.filter(i => !have.has(i.id)).map(i => ({ rfqItemId: i.id, kind: first?.kind ?? 'cannot_quote', snippet: snip(first?.text ?? '') })),
    ]
  }
  const firstRegret = regretLines[0] ?? (declined[0] ? { kind: declined[0].kind, text: declined[0].snippet } : null)
  // Only a question: nothing priced, nothing declined, and the reply asks something.
  const question = !anyPrice && !regret && finalDeclined.length === 0 && questionLines.length > 0

  return {
    offers,
    regret,
    regretKind: regret ? firstRegret?.kind ?? 'cannot_quote' : null,
    regretSnippet: regret ? snip(firstRegret?.text ?? '') : null,
    declined: finalDeclined,
    question,
    questionSnippet: question ? snip(questionLines[0] ?? '') : null,
    replyCurrency,
    lineCount: nonEmpty,
  }
}
