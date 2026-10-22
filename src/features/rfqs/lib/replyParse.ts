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
const CUR_SUFFIX_SRC = String.raw`(?:\s*(USD|US\$|\$|EUR|€|CNY|RMB|¥|￥|AED|GBP|£|PKR|₨|dollars?|euros?|yuan|dirhams?|dhs|pounds?|rupees?|元|块)|(?:\/-)?\s+(Rs\.?))(?![A-Za-z])`
const CUR_CODE_SRC = String.raw`(US\s?\$|USD|\$|EUR|€|CNY|RMB|¥|￥|AED|GBP|£|PKR|₨|Rs\.?|dollars?|euros?|yuan|dirhams?|pounds?|rupees?)`
// An amount: with thousands groups (comma, dot, apostrophe, or space when SP) and up to four decimals, or plain; an optional k.
// Pakistani (lakh) grouping first: "1,25,000", "12,50,000", "1,00,00,000". A multiplier word may follow: k, lakh / lac, crore.
const LAKH_GROUPS = String.raw`\d{1,2}(?:,\d{2})+,\d{3}(?:\.\d{1,4})?`
const MULT_WORD = String.raw`(\s?(?:[kK]|[lL]akhs?|[lL]acs?|[cC]rores?)(?![A-Za-z]))?`
const AMOUNT_SP = String.raw`(?<![A-Za-z0-9.,])(${LAKH_GROUPS}|\d{1,3}(?:[ ,.'’]\d{3})+(?:[.,]\d{1,4})?|\d+(?:[.,]\d{1,4})?)${MULT_WORD}`
/** The same amount right after a currency written in front of it ("Rs.182,000", "USD890"): no gap needed. */
const AMOUNT_AFTER_CUR = String.raw`(?<!\d|\d[.,])(${LAKH_GROUPS}|\d{1,3}(?:[ ,.'’]\d{3})+(?:[.,]\d{1,4})?|\d+(?:[.,]\d{1,4})?)${MULT_WORD}`
const AMOUNT = String.raw`(?<![A-Za-z0-9.,])(${LAKH_GROUPS}|\d{1,3}(?:[,.'’]\d{3})+(?:[.,]\d{1,4})?|\d+(?:[.,]\d{1,4})?)${MULT_WORD}`
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
    '没有货|无法报价|不能报价',
  ].join('|'),
  'i',
)

function regretKind(s: string): RegretKind {
  if (/discontinued|obsolete|end[\s-]of[\s-]life|eol|no\s+longer/i.test(s)) return 'discontinued'
  if (/scope|range|line|portfolio|carry|handle|deal|supply|sell|manufacture|product/i.test(s) && /not|don|doesn|out of/i.test(s) && !/unable|can(?:'|’)?t|cannot/i.test(s)) return 'not_handled'
  if (/not\s+interested|pass\s+on|declin/i.test(s)) return 'not_interested'
  if (/not\s+available|unavailable/i.test(s)) return 'unavailable'
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
}

const blank = (w: string, s: Span) => w.slice(0, s.start) + ' '.repeat(s.end - s.start) + w.slice(s.end)

const PRICE_LABEL_RE = /\b(?:unit\s*)?(?:price|rate|cost|offer|quoted?|quotation|prc|each|ea)\b|@|\bp\/u\b/i
const TOTAL_BEFORE_RE = /(?:total|amount|sub\s?total|sum|ext(?:ended)?|=)\s*(?:price|amount|value|cost)?\s*[:=-]?\s*(?:is|of)?\s*$/i
const UNIT_AFTER_RE = /^\s*(?:\/\s*(?:pc|pcs|piece|unit|no|nos|ea|each|set|m|mtr|kg|l)\b|(?:per|a|each|ea\b|\/)\s*(?:pc|pcs|piece|unit|no|nos|set|m|mtr|kg|l)?)/i
const FOR_QTY_RE = /^\s*(?:for|x|×)\s*(\d+)\s*(?:pcs|pc|nos|no|units|sets|set|pieces)?\b/i

function findQty(w: string): { value: number } & Span | null {
  let m = /(?:\bqty|\bquantity|\bq'ty)\s*[:=]?\s*(\d+)\b/i.exec(w)
  if (!m) m = /(?<![A-Za-z0-9.,])(\d{1,5})\s*(?:pcs|pc|nos|units|sets|set|pieces)\b/i.exec(w)
  if (!m) m = /(?<![A-Za-z0-9])[x×]\s*(\d{1,5})\b(?!\s*[x×\d])/i.exec(w)
  if (!m) return null
  return { value: Number(m[1]), start: m.index, end: m.index + m[0].length }
}

/** Replaces codes, sizes, dates, phone numbers and percentages with spaces so their digits are not read as prices. */
function maskNonPrice(w: string): string {
  const masks: RegExp[] = [
    // item numbers: "Item 3", "#2", "Pos 4", and a leading "1)" / "2." / "3 - "
    /\b(?:item|pos|position|sr|line|s\/n)\.?\s*#?\s*\d{1,3}\b/gi,
    /^\s*#?\d{1,3}\s*(?:[.):](?=\s|$)|\s-\s)/g,
    /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g,
    /(?:https?:\/\/|www\.)\S+/gi,
    /\+\d[\d\s()-]{8,}\d/g,
    /(?<![\d.,])0\d{2,3}[- ]?\d{7}(?!\d)/g,
    /\b\d{1,2}:\d{2}(?::\d{2})?\s?(?:[ap]m)?\b/gi,
    /\b\d{4}-\d{2}-\d{2}\b/g,
    /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g,
    /\b\d{1,2}(?:st|nd|rd|th)?[\s-]+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:[\s,-]+\d{2,4})?/gi,
    /(?<![A-Za-z0-9])\d+(?:[.,]\d+)?\s?%/g,
    /(?<![A-Za-z0-9.,])\d+(?:\s*(?:-|to)\s*\d+)?\s*(?:working\s+|business\s+)?(?:days?|weeks?|wks?|months?|mths?|years?|yrs?)(?![A-Za-z])/gi,
    // ranges and values with a technical unit: 4-20mA, 0-10 bar, 24V, 100mm, 5 kW, 1/2", 12.5 kg
    /(?<![A-Za-z0-9.,])\d+(?:[.,]\d+)?\s*-\s*\d+(?:[.,]\d+)?\s*(?:ma|v|vdc|vac|bar|psi|mpa|kpa|mbar|mm|cm|m|a|hz|°\s?c|c|kw|w|rpm|ohm|kohm|mtr|%)(?![A-Za-z])/gi,
    /(?<![A-Za-z0-9.,])\d+(?:[.,]\d+)?\s*(?:ma|vdc|vac|va|bar|psi|mpa|kpa|mbar|mm|cm|kw|hz|rpm|°\s?c|ohm|kohm|kg|inch|amps?|hp|kva|lpm|l\/min|m3\/h|nm|mtr|ltr|mhz|ghz|kb|mb|gb|awg|sqmm)(?![A-Za-z])/gi,
    /(?<![A-Za-z0-9.,])\d+(?:[.,]\d+)?(?:v|a|w|c|m|l)(?![A-Za-z0-9])/gi,
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
  while ((m = pre.exec(w))) accept(m, 2, 3, m[1] ?? '', m.index, m.index + m[0].length, m.index + m[0].length)
  // amount first: "120 USD", "350元", "1.2k usd"
  const suf = new RegExp(AMOUNT_SP + CUR_SUFFIX_SRC, 'gi')
  while ((m = suf.exec(w))) accept(m, 1, 2, m[3] ?? m[4] ?? '', m.index, m.index + m[0].length, m.index + m[0].length)
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
  while ((m = re.exec(masked))) {
    const rest = masked.slice(m.index + m[0].length)
    if (/^[A-Za-z]/.test(rest) && !AFTER_OK.test(rest)) continue
    const amt = parseAmount(`${m[1] ?? ''}${m[2] ?? ''}`)
    if (!amt || amt.value <= 0) continue
    const plainInt = /^\d{4}$/.test(m[1] ?? '') && amt.value >= 2024 && amt.value <= 2035
    if (plainInt && !hasLabel) continue
    found.push({ ...amt, currency: null, anchored: false, start: m.index, end: m.index + m[0].length, kind: 'unknown', forQty: null })
  }
  if (anchoredCount > 0) return []
  if (hasLabel) {
    const lab = PRICE_LABEL_RE.exec(w)
    const after = found.filter(f => lab && f.start >= lab.index)
    return (after.length ? after : found).slice(0, 1)
  }
  return found.length === 1 ? found : []
}

const DECLARE_RE = new RegExp(String.raw`\b(?:prices?|rates?|quot(?:e|ed|ation)s?|currency|amounts?|offers?)\b[^.\n]{0,40}?${CUR_CODE_SRC}(?![A-Za-z])|${CUR_CODE_SRC}(?![A-Za-z])\s+(?:prices?|rates?|basis|only)\b`, 'i')

function analyse(raw: string, today: string | undefined, skipPrice = false): LineFields {
  const orig = raw.replace(/\u00a0/g, ' ')
  let w = orig.replace(/[–—−]/g, '-').replace(/×/g, 'x')
  const f: LineFields = {
    prices: [], lead: null, inStock: null, origin: null, moq: null, validityText: null, validityDays: null, qty: null, declaredCurrency: null, regret: null,
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

  if (!skipPrice) {
    const anchored = findAnchoredPrices(w, null)
    for (const c of anchored) w = blank(w, c)
    f.prices = anchored.length ? anchored : findBarePrices(w, 0)
  }

  // "Relay 12VDC, 2 CO, Model X: Sorry, not available": a regret with only a bare number in it quotes nothing.
  if (f.prices.length && f.prices.every(p => !p.anchored) && REGRET_RE.test(w)) f.prices = []
  // "Offer 6816 - prices in USD": a line that declares the currency, with only a bare number (the offer's number) in it.
  if (f.prices.length && f.prices.every(p => !p.anchored) && DECLARE_RE.test(w) && !/\t|\|/.test(w)) f.prices = []
  const priced = f.prices.length > 0
  if (!priced) {
    const d = DECLARE_RE.exec(w)
    if (d) f.declaredCurrency = normaliseCurrency(d[1] ?? d[2] ?? null)
  }
  const reg = REGRET_RE.exec(w)
  if (reg && !priced && !(f.lead && f.lead.daysMax !== null && !f.lead.exStock)) {
    f.regret = { kind: regretKind(reg[0]), text: orig.trim() }
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
  words: Set<string>
}

function indexItems(items: ReplyItemRef[]): ItemIndex[] {
  return items.map(it => {
    const toks = modelTokens(`${it.description} ${it.model ?? ''}`).filter(t => !SPEC_SHAPE.test(t))
    return { id: it.id, qty: it.qty ?? null, tokens: toks, words: new Set(words(it.description)) }
  })
}

interface Match {
  idx: number
  by: MatchedBy
  score: number
}

function matchByContent(raw: string, idx: ItemIndex[]): Match | null {
  const norm = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  const lineToks = new Set(raw.toUpperCase().split(/[\s,;|()[\]]+/).map(t => t.replace(/[-./_]/g, '')).filter(Boolean))
  // 1. model codes
  let best: Match | null = null
  let tied = false
  idx.forEach((it, i) => {
    if (!it.tokens.length) return
    let hit = 0
    let total = 0
    for (const t of it.tokens) {
      total += t.length
      if (t.length >= 6 ? norm.includes(t) : lineToks.has(t)) hit += t.length
    }
    if (!hit) return
    const score = 0.7 + 0.25 * (hit / total)
    if (best && Math.abs(score - best.score) < 1e-9) tied = true
    else if (!best || score > best.score) {
      best = { idx: i, by: 'model', score }
      tied = false
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
  return bestD
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

const SEPARATOR_ROW = /^[\s|:\-+=_*]{3,}$/

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
  const q = cell(cols.qty)
  if (/^\d+$/.test(q)) f.qty = Number(q)
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

// ------------------------------------------------------------------------------------------------ main

interface Draft {
  itemIdx: number | null
  by: MatchedBy
  matchScore: number
  f: LineFields
  snippets: string[]
  lines: number[]
}

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
  text.split(/\r?\n/).forEach((l, i) => {
    const t = l.replace(/\u00a0/g, ' ').replace(WA_PREFIX, '').trimEnd()
    if (!t.trim() || /^\s*>/.test(t) || GREETING_HEADER.test(t)) {
      if (!t.trim()) out.push({ n: i + 1, text: '' })
      return
    }
    const marks = [...t.matchAll(/(?:^|\s)(\d{1,2})\)\s/g)]
    const nums = marks.map(m => Number(m[1]))
    if (marks.length >= 2 && nums.every((n, k) => k === 0 || n === (nums[k - 1] ?? 0) + 1)) {
      const starts = marks.map(m => m.index + (m[0].startsWith(' ') ? 1 : 0))
      starts.forEach((s, k) => out.push({ n: i + 1, text: t.slice(s, starts[k + 1] ?? t.length).trim() }))
      return
    }
    out.push({ n: i + 1, text: t })
  })
  return out
}

const snip = (s: string) => (s.length > 220 ? `${s.slice(0, 217)}...` : s)

export function parseSupplierReply(text: string, rfqItems: ReplyItemRef[], opts: ParseReplyOptions = {}): ParsedReply {
  const inheritOn = opts.inheritReplyLevel !== false
  const lines = prepare(text ?? '')
  const idx = indexItems(rfqItems)
  const nonEmpty = lines.filter(l => l.text).length

  const drafts: Draft[] = []
  const pending: Draft[] = []
  const declined: DeclinedItem[] = []
  const regretLines: Array<{ kind: RegretKind; text: string }> = []
  const globals: LineFields = {
    prices: [], lead: null, inStock: null, origin: null, moq: null, validityText: null, validityDays: null, qty: null, declaredCurrency: null, regret: null,
  }
  let current: Draft | null = null
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

  for (const line of lines) {
    if (!line.text) {
      blankSince = true
      cols = null
      continue
    }
    if (SEPARATOR_ROW.test(line.text)) continue

    const cells = splitCells(line.text)
    const header = cells ? tableHeader(cells) : null
    if (header) {
      cols = header
      continue
    }
    const rowCols = cols && cells && cells.length === cols.n ? cols : null
    const f = rowCols && cells ? analyseRow(cells, rowCols, opts.today) : analyse(line.text, opts.today)
    const match = matchByContent(line.text, idx)
    const rowNumber = rowCols && cells && rowCols.num >= 0 && /^\d{1,3}$/.test(cells[rowCols.num] ?? '') ? Number(cells[rowCols.num]) - 1 : null
    const numIdx = rowNumber !== null && rowNumber >= 0 && rowNumber < idx.length ? rowNumber : markerNumber(line.text, idx.length)

    if (f.regret) {
      const target = match ?? (numIdx !== null ? { idx: numIdx, by: 'item-number' as MatchedBy, score: 0.6 } : null)
      if (target) {
        const it = idx[target.idx]
        if (it) declined.push({ rfqItemId: it.id, kind: f.regret.kind, snippet: snip(f.regret.text) })
      } else regretLines.push(f.regret)
      blankSince = false
      continue
    }

    let m: Match | null = match
    if (!m && numIdx !== null) m = { idx: numIdx, by: 'item-number', score: 0.6 }

    if (m) {
      const d: Draft = { itemIdx: m.idx, by: m.by, matchScore: m.score, f, snippets: [line.text.trim()], lines: [line.n] }
      drafts.push(d)
      current = d
      blankSince = false
      continue
    }

    if (!hasData(f)) {
      if (f.declaredCurrency) globals.declaredCurrency ??= f.declaredCurrency
      blankSince = false
      continue
    }

    const forAll = GLOBAL_RE.test(line.text)
    const continuation =
      current !== null && !forAll && !blankSince && (LABEL_START.test(line.text) || /^\s{2,}\S/.test(line.text) || /^\s*[-•*]\s/.test(line.text))
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
    const ambiguous = Boolean(main?.ambiguous)
    if (ambiguous) flags.push('ambiguous_separator')
    if (unitCands.length > 1) flags.push('multiple_prices')
    if (main && !main.anchored && !derived) flags.push('bare_number')
    if (unitPrice === null) flags.push('price_missing')
    else if (!currency) flags.push('currency_missing')
    if (d.by === 'position') flags.push('match_by_position')
    if (d.itemIdx === null) flags.push('no_item_match')

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

  return {
    offers,
    regret,
    regretKind: regret ? firstRegret?.kind ?? 'cannot_quote' : null,
    regretSnippet: regret ? snip(firstRegret?.text ?? '') : null,
    declined: finalDeclined,
    replyCurrency,
    lineCount: nonEmpty,
  }
}
