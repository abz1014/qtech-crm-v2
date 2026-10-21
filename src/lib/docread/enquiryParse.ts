// Reads a customer enquiry as it really arrives (a whole email, a WhatsApp export, the text of a PDF) into item rows and the
// header facts around them. Pure and framework-free. It builds on the intake parser (src/features/rfqs/lib/parseItems.ts:
// greetings, polite openers, the quantity at the start or end of a line, spreadsheet rows), which reads one clean list well,
// and adds what real messages carry around the list (data-entry audit, docs/audit):
//
//  - Noise is dropped, not turned into items: email headers, quoted replies ("> ", "-----Original Message-----", "On ...
//    wrote:"), the signature after a sign-off (or a closing block of name, phone, address and email), disclaimers,
//    "Sent from my iPhone", WhatsApp "[date] Name:" prefixes, phone, email, web and address lines, notes and instructions
//    ("Note: please mention origin"), and lines that only carry a reference or a date.
//  - An item can span lines: "Make:", "Size:", "Range:" and "Qty: 2 Nos" lines are folded into the item above; a line that
//    wraps (indented, or the line above ends with a comma) is joined, so its quantity is not lost; "Item 1" /
//    "Description:" / "QTY REQUIRED: 01" blocks become one item each.
//  - More quantity shapes: "QTY REQUIRED: 01", "REQ QTY: 6", "Qty : 03 NOS", "Qty-2", "2.000 EA", "x2", "(2 Nos)", "4 Drums",
//    a "Qty: 2 Nos" in the middle of the line, and tables with a header (Description / Part No / Qty / UOM ...).
//  - Facts: the customer's reference (RFQ #, Enquiry/Inquiry Ref, Tender No, PR #, Collective No, "Our Ref", a ref in the
//    subject), the quotation due date (Due:, deadline, closing date, "must reach us before", dd/mm/yyyy, 11-JUL-26, 23rd
//    October 2026) but never a delivery date, and a company hint (the company line of the signature or letterhead, the
//    sender's email domain, phone numbers) for the screen to match against the companies on file.
//
// Every result is a first guess the person checks; nothing is saved here. `raw` is the text as given, for the RFQ notes.

import { businessToday } from '@/lib/dates'
import { normaliseUnit, parsePaste, type ParsedItem, type ParseResult } from '@/features/rfqs/lib/parseItems'
import { alignSpacedRows, rebuildCellTables } from './cellTable'
import { isHeaderCell } from './pdfLayout'

export type EnquiryLineKind = 'item' | 'joined' | 'skipped'
export type SkipReason =
  | 'greeting'
  | 'header'
  | 'reference'
  | 'date'
  | 'contact'
  | 'signature'
  | 'quoted'
  | 'disclaimer'
  | 'instruction'
  | 'table'

export interface EnquiryLine {
  text: string
  /** item: starts an item row. joined: folded into the item above (a Make: line, a wrapped line). skipped: not an item. */
  kind: EnquiryLineKind
  reason: SkipReason | null
  /** The list marker ("1.", "a)", "Item 2:"), for highlighting. */
  marker: string | null
}

export interface EnquiryFacts {
  /** The customer's own reference for this enquiry. */
  customerRef: { value: string; label: string; line: string } | null
  /** The date the quotation is due (YYYY-MM-DD). Never a delivery date. */
  dueDate: { iso: string; text: string } | null
  /** Who sent it, as far as the text says. The screen matches it against the companies and contacts on file. */
  company: { name: string | null; domain: string | null; emails: string[]; phones: string[] } | null
}

export interface EnquiryParse {
  items: ParsedItem[]
  lines: EnquiryLine[]
  /** Non-empty lines in the text. */
  lineCount: number
  facts: EnquiryFacts
  /** The text as given, for the RFQ notes. */
  raw: string
}

export interface EnquiryOptions {
  /** YYYY-MM-DD; dates written without a year are read as the next such date. Default: today in the business timezone. */
  today?: string
  /** Our own name and domain, never offered as the customer. */
  own?: RegExp
}

const DEFAULT_OWN = /q[\s-]?tech/i

// ------------------------------------------------------------------------------------------------ vocabulary

const PRODUCT =
  /\b(?:valves?|gauges?|transmitters?|sensors?|switch(?:es)?|meters?|pumps?|motors?|cables?|relays?|contactors?|breakers?|mcbs?|mccbs?|plcs?|hmis?|vfds?|drives?|inverters?|encoders?|actuators?|positioners?|controllers?|indicators?|thermocouples?|rtds?|pt100|bearings?|seals?|gaskets?|hoses?|fittings?|glands?|lugs?|trays?|panels?|transformers?|detectors?|analy[sz]ers?|recorders?|timers?|counters?|modules?|cpus?|ups|batter(?:y|ies)|lamps?|fans?|filters?|regulators?|cylinders?|solenoids?|manifolds?|thermowells?|probes?|electrodes?|scanners?|hooters?|sirens?|annunciators?|enclosures?|terminals?|connectors?|couplings?|belts?|chains?|gears?|gearbox(?:es)?|fuses?|isolators?|starters?|capacitors?|calibrators?|multimeters?|testers?|thermostats?|thermometers?|spares?)\b/i

const COURTESY =
  /\b(?:enquiry|inquiry|quotations?|quote|quoting|offers?|rfq|tender|attached|attachment|below|above|following|requirements?|arrange|reply|revert|respond|soonest|earliest|asap|needful|urgent(?:ly)?|thanks|thank|regards|kindly|please|plz|pls|best\s+price|lowest|rates?|prices?|hai|hain|bata|batao|bhejo|bhej|dein|jaldi|zaroor|chahiye|letterhead|invited|fyi|f\.y\.i|for\s+your\s+(?:information|reference|action)|today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|need\s+(?:it|them)|hope\s+you|finds?\s+you\s+well|trust\s+(?:this|you))\b/i
/** A sentence that only greets ("Hi Ali, hope you are well."). */
const GREETING_SENTENCE = /^(?:hi|hello|hey|dear|respected|asalam\w*|salam|assalam\w*|aoa|good\s+(?:morning|afternoon|evening))\b[^.!?]*[.!?]?$|\bhope\s+(?:you|this|all)\b/i

const SIGN_OFF =
  /^(?:(?:best|kind|warm|warmest|with)\s+regards?|regards?|thanks?(?:\s*(?:&|and)\s*(?:best\s+|kind\s+)?regards?)?|thank\s+you(?:\s+(?:and|&)\s+regards)?|thankyou|many\s+thanks|sincerely|yours\s+(?:sincerely|faithfully|truly)|br|cheers|allah\s+hafiz|jazak\s*allah(?:\s+khair)?|shukriya|shukria|thnx|thx|tks)[\s,.!]*$/i
const SENT_FROM = /^sent\s+from\s+my\b/i
const DISCLAIMER =
  /^(?:\**\s*disclaimer|confidentiality\s+notice|this\s+(?:e-?mail|message)\s+(?:and\s+any|is\s+(?:confidential|intended)|may\s+contain|contains)|the\s+information\s+(?:contained|in\s+this)|if\s+you\s+(?:are\s+not|have\s+received)|please\s+consider\s+the\s+environment|caution\s*:|this\s+email\s+has\s+been\s+scanned)/i
const REPLY_SEP = /^(?:-{2,}\s*original\s+message\s*-{2,}|_{5,}|-{5,})$|^on\s.{4,160}\swrote:?$/i
const FORWARD_SEP = /^(?:-{2,}\s*forwarded\s+message\s*-{2,}|begin\s+forwarded\s+message:?)$/i
const HEADER_LINE = /^(?:from|to|cc|bcc|sent|date|subject|reply-to|attachments?)\s*:/i
const WA_PREFIX = /^\s*\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s?m\.?)?\]?\s*(?:-\s*)?(?:[^:\d][^:]{0,40}:\s)?/i
/** WhatsApp Web's copy of several messages puts the time first: "[10:42, 19/10/2026] Name: ". */
const WA_WEB_PREFIX = /^\s*\[\d{1,2}:\d{2}(?::\d{2})?\s*(?:[ap]\.?\s?m\.?)?,\s*\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\]\s*(?:[^:\d][^:]{0,40}:\s)?/i
/** Emoji and their joiners: never part of an item. */
const EMOJI = /\p{Extended_Pictographic}|[\u{1F3FB}-\u{1F3FF}]|\u{FE0F}|\u{200D}/gu
/** What a chat export writes for a voice note, a photo, a file or a deleted message. */
const CHAT_MEDIA =
  /^‎?(?:<media omitted>|<attached:[^>]*>|(?:audio|image|video|sticker|gif|document|contact card)\s+omitted|this message was deleted|you deleted this message|null|\S+\.(?:opus|ogg|m4a|aac|mp3|jpe?g|png|webp|mp4|pdf|docx?|xlsx?)\s*\(file attached\)|missed (?:voice|video) call)\.?$/i
/** A chat reply that only acknowledges ("Noted", "Ok sir, will share today", "Sure, checking"). */
const ACK = /^(?:ok(?:ay)?|noted|sure|done|received|thanks?|thank\s+you|thx|jee|ji|g\b|acha|theek|right|alright|great|will\s+(?:do|share|send|check|revert|update))\b/i
const INSTRUCTION =
  /^(?:note|notes|n\.?\s?b|remarks?|terms|conditions|payment|delivery|required\s+delivery|delivery\s+(?:period|time|terms)|validity|offer\s+validity|warranty|origin|incoterms?|price\s+basis|please\s+(?:mention|confirm|include|specify|indicate|note|quote\s+(?:with|on|your\s+(?:validity|delivery)))|kindly\s+(?:mention|confirm|include|specify|indicate|note)|partial\s+(?:quotations?|offers?)|bid\s+security|earnest\s+money|performance\s+(?:bond|guarantee|security)|tender\s+(?:fee|documents?)|sealed\s+bids?|quotations?\s+(?:should|must)\s+(?:be|include|mention)|offer\s+(?:should|must)\s+(?:be|include|mention))\b[\s.:-]*/i

const COMPANY =
  /\b(?:ltd|limited|pvt|private|inc|llc|corp(?:oration)?|company|co\.|industries|mills|group|enterprises?|traders|associates|sons)\b/i
const DESIGNATION =
  /\b(?:engineer|engr\.?|manager|officer|executive|incharge|in-charge|director|assistant|supervisor|coordinator|buyer|purchaser|procurement|purchase|stores?|department|dept\.?|section|ceo|gm|dgm|agm|senior|junior|deputy)\b/i
const ADDRESS =
  /\b(?:road|rd\.?|street|block|sector|phase|plot|floor|building|bldg|tower|plaza|town|colony|industrial\s+(?:area|estate|zone)|p\.?\s?o\.?\s?box|district|tehsil|karachi|lahore|islamabad|rawalpindi|faisalabad|multan|peshawar|sialkot|gujranwala|hyderabad|quetta|haripur|hattar|sheikhupura|kasur|pakistan|plant\s+site|head\s+office)\b/i
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const URL = /\b(?:https?:\/\/|www\.)[\w.-]+(?:\/\S*)?/i
const PHONE = /(?:\+|00)92[\s-]?\(?\d{2,4}\)?(?:[\s-]?\d{2,4}){2,3}|\b03\d{2}[\s-]?\d{7}\b|\b0\d{2,4}[\s-]\d{6,8}\b|\b111[\s-]?\d{3}[\s-]?\d{3}\b/
const PHONE_LABEL = /^(?:tel|ph|phone|cell|mob|mobile|fax|whatsapp|uan|landline|ext|e-?mail|email|web|website|address|off|office|res)\b\.?\s*[:#.]?/i
const FREE_MAIL = /^(?:gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|icloud|me|aol|proton|protonmail|zoho|yandex|mail)\./i

// ------------------------------------------------------------------------------------------------ quantities

const UNIT_SRC = String.raw`nos?\.?|no's|numbers?|pcs?\.?|pieces?|ea|each|units?|sets?|lots?|pairs?|rolls?|mtrs?|meters?|metres?|m|ltrs?|litres?|liters?|l|kgs?|ft|feet|prs?|adad|rmt?|lengths?|boxe?s?|pkts?|packets?|bags?|drums?|cans?|sheets?|coils?|cartons?`
const QTY_WORD = String.raw`(?:qty\.?\s*req(?:uired|d)?\.?|req(?:uired|\.)?\s*qty\.?|required\s+(?:qty\.?|quantity)|quantity\s+required|qty\.?|quantity|q'ty|qnty)`
const LABELLED_QTY = new RegExp(
  String.raw`(^|[\s,;(|])${QTY_WORD}\s*[:=.\-–]?\s*(\d[\d,]*(?:\.\d+)?)(?:\s*(${UNIT_SRC}))?(?![A-Za-z0-9])`,
  'i',
)
const EXTRA_TRAIL = new RegExp(String.raw`(?:^|[\s,;(–-])\s*(\d[\d,]*(?:\.\d+)?)\s*(nos?|no's|numbers?|adad|drums?|bags?|boxe?s?|cans?|sheets?|coils?|cartons?|pkts?|packets?|lengths?|kgs?|prs?|pairs?|rolls?|ea|each|pieces?|pcs?|sets?|lots?)\.?\s*\)?\.?$`, 'i')
const LEAD_UNIT = new RegExp(String.raw`^(\d[\d,]*(?:\.\d+)?)\s*(${UNIT_SRC})\.?\s+(?:of\s+)?(?=[A-Za-z])`, 'i')
const QTY_ONLY = new RegExp(String.raw`^(?:${QTY_WORD}\s*[:=.\-–]?\s*)?(\d[\d,]*(?:\.\d+)?)\s*(${UNIT_SRC})?\.?$`, 'i')

function toQty(raw: string): number {
  const n = Number(raw.replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? n : 1
}

/**
 * Units the intake stores in its own words: "No.", "No's" and "NOS" are nos, "Mtr" and "meters" are m, "Kgs" is kg. Any other
 * unit is the customer's own and is kept as written ("EA", "Pcs", "each", "BOX"): owner brief 2026-10-22, the customer's unit
 * goes on the quotation unchanged.
 */
const OWN_UNITS: Record<string, string> = {
  no: 'nos', nos: 'nos', "no's": 'nos', number: 'nos', numbers: 'nos', adad: 'nos',
  set: 'set', sets: 'set', lot: 'lot', lots: 'lot', pair: 'pair', pairs: 'pair', pr: 'pair', prs: 'pair', roll: 'roll', rolls: 'roll',
  m: 'm', mtr: 'm', mtrs: 'm', meter: 'm', meters: 'm', metre: 'm', metres: 'm', rm: 'm', rmt: 'm',
  kg: 'kg', kgs: 'kg', l: 'l', ltr: 'l', ltrs: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l', ft: 'ft', feet: 'ft',
}

/** The unit as the intake stores it: our own word for nos, set, m, kg ..., else the customer's word as written. */
export function unitOf(raw: string | null | undefined): string | null {
  if (!raw) return null
  const w = raw.trim().replace(/\.$/, '')
  if (!w) return null
  return OWN_UNITS[w.toLowerCase()] ?? (/^[a-z]+$/i.test(w) ? w : normaliseUnit(w))
}

/**
 * The unit word written next to `qty` in `text` ("12 Pcs", "Qty: 4 EA"), as written; null when there is none. The intake's own
 * reading (parsePaste) gives a stored unit only ("nos" for "Pcs"); this finds the customer's word again.
 */
function writtenUnitFor(text: string, qty: number): string | null {
  const re = new RegExp(String.raw`(\d[\d,]*(?:\.\d+)?)\s*(${UNIT_SRC})(?![A-Za-z0-9])`, 'gi')
  let m: RegExpExecArray | null
  let found: string | null = null
  while ((m = re.exec(text))) if (toQty(m[1] as string) === qty) found = m[2] as string
  return found
}

const tidy = (s: string) =>
  s
    .replace(/\s+/g, ' ')
    .replace(/\s+([,;])/g, '$1')
    .replace(/([,;])(?:\s*[,;])+/g, '$1')
    .replace(/^[\s,;:–-]+/, '')
    .replace(/[\s,;:(–-]+$/, '')
    .replace(/(?<=[A-Za-z0-9)"])[.?!]$/, '')
    .trim()

/** Urdu and English tails that are not part of the item ("... chahiye", "... bhi", "... urgently required"). */
const TAIL = /[\s,-]+(?:(?:is|are)\s+)?(?:chahiye|chahiyen|chaiye|chahye|bhi|bhej\s*d[ei]+n|bhej\s*do|bhejo|bhejen|required|needed|urgently\s+required|urgent|asap)(?:\s+(?:hai|hain|urgent(?:ly)?|asap))?[\s.!]*$/i
const OPENER = /^(?:(?:aur|and|also|plus)\s+|(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+|kindly\s+|pls\s+|plz\s+)?(?:send|share|give|provide|quote|arrange)\s+(?:me|us)\s+(?:your\s+|the\s+)?(?:best\s+|lowest\s+)?(?:prices?|rates?|quotation|quote|offer)\s+(?:for|of)\s+|(?:we|i)\s+(?:need|require|want|are\s+looking\s+for|would\s+like(?:\s+to\s+(?:buy|purchase|procure|order))?)\s+(?:to\s+(?:buy|purchase|procure|order)\s+)?)/i

interface ReadItem {
  description: string
  qty: number | null
  unit: string | null
  /** The quantity cell as written ("2.000"), for a table row. */
  rawQty?: string
}

/** One item's text (its own line, plus any wrapped lines) into description, quantity (null when none) and unit. */
function readItem(text: string): ReadItem | null {
  // "Item: Push button red; Make: X; Qty: 20 Pcs": the label in front is not part of the description.
  let t = text
    .replace(TAIL, '')
    .replace(/^(?:(?:plz|pls|please)\s+)?(?:quote|rates?(?:\s+(?:pls|plz|please))?|send\s+rates?)\s*[:,-]\s*/i, '')
    .replace(OPENER, '')
    .replace(/^(?:item|description|product|material|particulars)\s*[:=-]\s*/i, '')
  let qty: number | null = null
  let unit: string | null = null
  const lab = LABELLED_QTY.exec(t)
  if (lab) {
    qty = toQty(lab[2] as string)
    unit = unitOf(lab[3])
    const start = lab.index + (lab[1] as string).length
    t = `${t.slice(0, start)} ${t.slice(lab.index + lab[0].length)}`
  } else {
    // "20 Kg lubricating grease", "5 kgs ...", "2 PR carbon brush": a quantity and unit in front.
    const lead = LEAD_UNIT.exec(t)
    if (lead) {
      qty = toQty(lead[1] as string)
      unit = unitOf(lead[2])
      t = t.slice(lead[0].length)
    }
  }
  t = tidy(t.replace(OPENER, ''))
  if (!t) return null
  // The intake's own reading: polite openers, greetings, "2 nos ..." at the start, "... - 2 nos" at the end. With the
  // quantity already read, a stand-in "qty 1" is what it takes off the end, so a size ("0-10m") is not read as one.
  let old = parsePaste(qty === null ? t : `${t} qty 1`).items[0]
  if (!old) return null
  // "Model FX3U-48M": the end of a part number, not 48 metres.
  if (qty === null && old.unit && /[A-Za-z0-9]-\d+(?:\.\d+)?[A-Za-z]+\.?$/.test(t)) old = { description: tidy(t), qty: 1, unit: null }
  let description = qty === null ? old.description : old.description.replace(/\s*qty 1$/i, '')
  if (qty === null) {
    const explicit = old.qty !== 1 || old.unit !== null || /(?:^|\s)(?:[x×]\s*0*1|0*1\s*[x×])(?:\s|$)/i.test(t)
    if (explicit) {
      qty = old.qty
      unit = old.unit ? unitOf(writtenUnitFor(t, old.qty) ?? old.unit) : null
    } else {
      const ex = EXTRA_TRAIL.exec(description)
      // "Siemens 6ES7 231-4HD32-0XB0 – 2": a bare number after a spaced dash, when what is before it is not a number
      // (that would be a range, "0 - 10").
      const dash = /\s[–-]\s+(\d{1,4})$/.exec(description)
      // "Silicone tube 8mm 0.5 m": a quantity with a decimal point and a length or weight unit at the end.
      const dec = /\s(\d+\.\d+)\s*(m|mtrs?|meters?|metres?|kgs?|ltrs?|l)\.?$/i.exec(description)
      if (ex) {
        qty = toQty(ex[1] as string)
        unit = unitOf(ex[2])
        description = description.slice(0, ex.index)
      } else if (dec) {
        qty = toQty(dec[1] as string)
        unit = unitOf(dec[2])
        description = description.slice(0, dec.index)
      } else if (dash && !/(?:^|\s)\d+(?:\.\d+)?$/.test(description.slice(0, dash.index))) {
        qty = toQty(dash[1] as string)
        description = description.slice(0, dash.index)
      }
    }
  }
  description = tidy(description.replace(OPENER, ''))
  return description ? { description, qty, unit } : null
}

// ------------------------------------------------------------------------------------------------ dates

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`
const DATE_RES: Array<{ re: RegExp; read: (m: RegExpExecArray) => [number | null, number, number] }> = [
  { re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/, read: m => [Number(m[1]), Number(m[2]), Number(m[3])] },
  {
    re: /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})\b/,
    read: m => {
      let d = Number(m[1])
      let mo = Number(m[2])
      if (mo > 12 && d <= 12) [d, mo] = [mo, d]
      const y = (m[3] as string).length === 2 ? 2000 + Number(m[3]) : Number(m[3])
      return [y, mo, d]
    },
  },
  {
    re: new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?[\s./-]*(?:of\s+)?${MONTH}\.?(?:[\s,./-]+(\d{4}|\d{2}))?\b`, 'i'),
    read: m => [m[3] ? ((m[3] as string).length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : null, MONTHS.indexOf((m[2] as string).slice(0, 3).toLowerCase()) + 1, Number(m[1])],
  },
  {
    re: new RegExp(String.raw`\b${MONTH}\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b`, 'i'),
    read: m => [m[3] ? Number(m[3]) : null, MONTHS.indexOf((m[1] as string).slice(0, 3).toLowerCase()) + 1, Number(m[2])],
  },
  { re: /\b(\d{1,2})[/.](\d{1,2})\b(?![./-]?\d|\s*(?:"|”|inch|in\b|mm|bar))/, read: m => [null, Number(m[2]), Number(m[1])] },
]
/** "22/10" with no year: only read after a due-date word ("Due 22/10"); elsewhere it is a size (1/2") or a ratio. */
const NO_YEAR = DATE_RES.length - 1

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * The first date written in the text, as YYYY-MM-DD. A day and month with no year ("22/10") is read only with `noYear`,
 * as the next such date on or after `today`; a month name with no year ("23rd October") is read the same way.
 */
export function findDate(text: string, today: string, noYear = false): { iso: string; text: string; index: number } | null {
  let best: { iso: string; text: string; index: number } | null = null
  for (const [n, { re, read }] of DATE_RES.entries()) {
    if (n === NO_YEAR && !noYear) continue
    const m = re.exec(text)
    if (!m) continue
    const [y0, mo, d] = read(m)
    if (mo < 1 || mo > 12 || d < 1 || d > 31) continue
    let y = y0 ?? Number(today.slice(0, 4))
    let iso = `${y}-${pad(mo)}-${pad(d)}`
    if (y0 === null && iso < today) {
      y += 1
      iso = `${y}-${pad(mo)}-${pad(d)}`
    }
    if (!best || m.index < best.index) best = { iso, text: m[0], index: m.index }
  }
  return best
}

const DUE_STRONG =
  /\b(?:due(?:\s+date)?|deadline|closing(?:\s+date)?|last\s+date|bid\s+due|submission|submit(?:ted)?|reach\s+(?:us|this\s+office|the\s+undersigned)|be\s+received|latest\s+by|on\s+or\s+before|not\s+later\s+than)\b/i
const DUE_WEAK = /\b(?:by|before|till|until)\b/i
const QUOTE_WORD = /\b(?:quot\w*|offers?|bids?|tenders?|proposals?|prices?|rates?|reply)\b/i
const NOT_DUE = /\b(?:deliver\w*|dispatch\w*|shipment|at\s+site|material\s+required|valid\w*|dated)\b/i

function findDue(line: string, today: string): { iso: string; text: string } | null {
  if (NOT_DUE.test(line) && !/\b(?:quot\w*|offers?|bids?)\b[^.]*\b(?:reach|submit|due|before|by)\b/i.test(line)) return null
  const strong = DUE_STRONG.exec(line)
  const weak = !strong && DUE_WEAK.test(line) && QUOTE_WORD.test(line) ? DUE_WEAK.exec(line) : null
  const kw = strong ?? weak
  if (!kw) return null
  const after = findDate(line.slice(kw.index), today, true)
  const any = after ?? findDate(line, today)
  return any ? { iso: any.iso, text: line.trim() } : null
}

// ------------------------------------------------------------------------------------------------ references

interface RefHit {
  value: string
  label: string
  rank: number
}

const REF_RULES: Array<{ re: RegExp; label: string; rank: number }> = [
  { re: /(?<![-/])\b(?:rfq|r\.f\.q\.?|request\s+for\s+quotation)\s*(?:no\.?|number|#|ref(?:erence)?\.?)?\s*[:#.-]?\s*/gi, label: 'RFQ', rank: 10 },
  { re: /(?<![-/])\b(?:enquiry|inquiry)\s*(?:no\.?|number|#|ref(?:erence)?\.?)\s*[:#.-]?\s*/gi, label: 'Enquiry', rank: 10 },
  { re: /\btender\s*(?:no\.?|number|#|ref\.?)\s*[:#.-]?\s*/gi, label: 'Tender', rank: 9 },
  { re: /\bcollective\s*(?:no\.?|number|#)\s*[:#.-]?\s*/gi, label: 'Collective No', rank: 7 },
  { re: /\b(?:pr|p\.r\.|purchase\s+requisition|requisition|indent|demand|mr|material\s+requisition)\s*(?:no\.?|number|#)\s*[:#.-]?\s*/gi, label: 'PR', rank: 6 },
  { re: /\b(?:our\s+ref(?:erence)?|(?<!your\s)ref(?:erence)?\b)\.?\s*(?:no\.?|number|#)?\s*[:#.-]?\s*/gi, label: 'Ref', rank: 5 },
]
/** A reference written as one word: RFQ-ST-2026-118, PR-2291, ENQ/26/04. */
const REF_TOKEN = /(?<![A-Za-z0-9/-])((?:RFQ|ENQ|INQ|PR|TND|RFP)[-/][A-Z0-9][A-Z0-9/_.-]*)/gi
const REF_VALUE = /^([A-Z0-9][A-Z0-9/_.-]*[A-Z0-9]|[A-Z0-9]{3,})/i

function cleanRef(v: string): string | null {
  const s = v.replace(/[.,;:)]+$/, '')
  if (s.length < 3 || s.length > 40 || !/\d/.test(s)) return null
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(s)) return null // a date
  if (/^0\d{9,11}$/.test(s)) return null // a phone number
  return s
}

/**
 * A subject line that names an enquiry but carries its number without a label: "RFQ FOR THE ELECTRONICS ITEMS REQUIRED 131026",
 * "RFQ PLC SPARES EML-RFQ-2210", "Enquiry 2210-B for PLC spares". The code right after the word, else the last code on the line.
 */
function subjectRef(line: string): RefHit | null {
  const body = line.replace(/^subject\s*:\s*/i, '').replace(/^(?:(?:re|fw|fwd)\s*:\s*)+/i, '')
  const kw = /\b(?:rfq|enquiry|inquiry|quotation|tender)\b/i.exec(body)
  if (!kw) return null
  const tokens = body.split(/[\s,;:()]+/).filter(Boolean)
  const isCode = (w: string) => /\d/.test(w) && w.length >= 4 && cleanRef(w) !== null && !/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(w)
  const after = body.slice(kw.index + kw[0].length).trim().split(/[\s,;:()]+/)[0] ?? ''
  const pick = isCode(after) ? after : [...tokens].reverse().find(isCode)
  const value = pick ? cleanRef(pick) : null
  return value ? { value, label: 'Subject', rank: 4 } : null
}

function findRefs(text: string): RefHit[] {
  // "Your Ref: QT-RFQ-0118" is our own number quoted back: nothing from there on is the customer's.
  const yours = /\byour\s+ref/i.exec(text)
  const line = yours ? text.slice(0, yours.index) : text
  const tokens: RefHit[] = []
  REF_TOKEN.lastIndex = 0
  let t: RegExpExecArray | null
  while ((t = REF_TOKEN.exec(line))) {
    const value = cleanRef(t[1] as string)
    if (value) tokens.push({ value, label: (t[1] as string).split(/[-/]/)[0]?.toUpperCase() ?? 'Ref', rank: 8 })
  }
  const out: RefHit[] = []
  for (const rule of REF_RULES) {
    rule.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.re.exec(line))) {
      const v = REF_VALUE.exec(line.slice(m.index + m[0].length))
      const value = v ? cleanRef(v[1] as string) : null
      if (!value) continue
      // "RFQ-CS-7781": the label is part of the reference; keep the whole word, at the label's rank.
      const whole = tokens.find(k => k.value.endsWith(value) && k.value.length > value.length)
      if (whole) whole.rank = Math.max(whole.rank, rule.rank)
      else out.push({ value, label: rule.label, rank: rule.rank })
    }
  }
  for (const k of tokens) if (!out.some(o => o.value.includes(k.value))) out.push(k)
  return out
}

// ------------------------------------------------------------------------------------------------ lines

const MARKER =
  /^\s*(?:(?:item|ltem|tem)\s*(?:no\.?)?\s*#?\s*\d{1,3}\s*(?:[:.)-]\s*|$)|\(?\d{1,3}\)\s*|\d{1,3}[.:]\s+|\d{1,3}\s?-\s+|\(?[a-h]\)\s+|\(?(?:i{1,3}|iv|vi{0,3}|ix|x)\)\s+|[-•*·–®©°«»¢]\s+|\+\s+(?=[A-Za-z])|#\s*\d{1,3}[.:)]?\s+|0\d{3,4}\s+)/i

/** A line that stops where it cannot end: the next line goes on with it ("..., Model" / "FX4U-48MT/ESS"). */
const DANGLING = /(?:[,/&(:-]|\b(?:with|and|for|of|model|model\s*no\.?|type|qty\.?|quantity|p\/n|part\s*no\.?|make|brand|size|range|code))$/i

/** Lines of one item put together: a word broken at its dash ("g5zk-" / "051") is joined without a space. */
function joinWrapped(texts: string[]): string {
  return texts.reduce((a, b) => (a === '' ? b : /[A-Za-z0-9]-$/.test(a) && /^[A-Za-z0-9]/.test(b) ? a + b : `${a} ${b}`), '')
}

/** A label line that belongs to the item above ("Make: Siemens", "Qty: 2 Nos", "Description: ..."). */
const ATTR =
  /^(make|brand|manufacturer|model(?:\s*no\.?)?|part\s*(?:no\.?|number|#)|cat(?:alogue|alog)?\.?\s*no\.?|type|range|size|rating|material|moc|specs?|specifications?|description|item\s+description|material\s+description|item|product|tag(?:\s*no\.?)?|output|input|voltage|power|capacity|pressure|temperature|length|dia(?:meter)?|connection|end\s+connection|class|ip\s*rating|accuracy|application|service|medium|fluid|qty\.?\s*req(?:uired|d)?\.?|req(?:uired|\.)?\s*qty\.?|required\s+(?:qty\.?|quantity)|quantity\s+required|qty\.?|quantity|q'ty|uom|unit|drawing\s*no\.?|item\s*code|code)\s*[:=–-]\s*(.*)$/i

interface Draft {
  first: number
  marker: string | null
  indent: number
  texts: string[]
  attrs: string[]
  qty: { qty: number; unit: string | null } | null
  fromTable?: ReadItem
  /** Its quantity came on a line of its own ("Qty:" / "1 Each"): the item is complete, the next line is not its tail. */
  qtyLine?: boolean
}

interface TableCols {
  desc: number[]
  extra: Array<{ i: number; label: string; codes: boolean }>
  qty: number
  unit: number
  n: number
}

function splitCells(line: string): string[] | null {
  if (line.includes('\t')) return line.split('\t').map(c => c.trim())
  if ((line.match(/\|/g) ?? []).length >= 2) {
    const cells = line.split('|').map(c => c.trim())
    if (cells[0] === '') cells.shift()
    if (cells[cells.length - 1] === '') cells.pop()
    return cells
  }
  return null
}

function tableHeader(cells: string[]): TableCols | null {
  const filled = cells.filter(Boolean)
  if (filled.length < 2 || filled.some(c => /\d{2,}/.test(c.replace(/\(.*?\)/g, '')))) return null
  const hits = filled.filter(isHeaderCell).length
  if (hits < 2 || hits < Math.ceil(filled.length * 0.6)) return null
  const idx = (re: RegExp) => cells.findIndex(c => re.test(c) || re.test(c.replace(/\s+/g, '')))
  let desc = cells.map((c, i) => (/desc|particular|specification|product|item\s*name|short\s*text|item\s*text|goods|special\s*instruction/i.test(c) ? i : -1)).filter(i => i >= 0)
  if (desc.length === 0) desc = cells.map((c, i) => (/^item$/i.test(c) ? i : -1)).filter(i => i >= 0)
  // A heading the picture reader garbled ("C=" for "Description" in "Description of Goods") just before the description
  // column: its column holds the first words of each description.
  if (desc.length && desc[0]! > 0) {
    const before = cells[desc[0]! - 1] ?? ''
    if (before && !isHeaderCell(before) && !/[A-Za-z]{3}/.test(before)) desc = [desc[0]! - 1, ...desc]
  }
  if (desc.length === 0) return null
  const extra = cells
    .map((c, i) => ({ i, label: c.replace(/[:.]+$/, ''), codes: /^(?:material|item\s*code|code|material\s*(?:no|code)\.?)$/i.test(c) }))
    .filter(e => !desc.includes(e.i) && /^(?:part\s*(?:no\.?|number|#)|model(?:\s*no\.?)?|make|brand|cat(?:alogue|alog)?\.?\s*no\.?|material(?:\s*(?:no|code)\.?)?|item\s*code|code|size|type)$/i.test(e.label))
  return {
    desc,
    extra,
    qty: idx(/qty|quantity/i),
    unit: idx(/^(?:uom|units?|u\/m|a\s*\/\s*u)\.?$/i),
    n: cells.length,
  }
}

function tableItem(cells: string[], cols: TableCols): ReadItem | null {
  const cell = (i: number) => (i >= 0 ? (cells[i] ?? '').trim() : '')
  // Two description columns ("Item Description" and "Special Instructions"): both, unless one only repeats the other.
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z0-9]+/g) ?? [])
  const parts = cols.desc.map(cell).filter(Boolean)
  const main = parts
    .filter((p, i) => {
      const w = words(p)
      return !parts.some((q, j) => j !== i && q.length > p.length && [...w].every(x => words(q).has(x)))
    })
    .join(', ')
  if (!main || /^(?:sub\s*-?\s*total|grand\s+total|total|vat|gst|sales\s+tax|freight|discount)\b/i.test(main)) return null
  const extras = cols.extra
    .map(e => ({ e, v: cell(e.i) }))
    .filter(({ e, v }) => v && !(e.codes && /^\d+$/.test(v)))
    .map(({ e, v }) => `${e.label}: ${v}`)
  const q = cell(cols.qty)
  const qm = /^(\d[\d,]*(?:\.\d+)?)\s*([A-Za-z'.]+)?$/.exec(q)
  return {
    // A serial number and a material code that ran into the description cell ("60 13404632 BREAKER,...").
    description: tidy([main.replace(/^(?:\d{1,5}\s+)?\d{7,}\s+(?=[A-Za-z])/, ''), ...extras].join(', ')),
    rawQty: q,
    qty: qm ? toQty(qm[1] as string) : unitQty(cell(cols.unit)),
    unit: unitOf(unitCell(cell(cols.unit)) || qm?.[2] || null),
  }
}

/** The unit in a unit cell: the cell itself, its letters run together ("Numbe rs"), or its first word ("PCS Stockitem"). */
function unitCell(c: string): string {
  if (!c || UNIT_CELL.test(c)) return c
  const joined = c.replace(/\s+/g, '')
  if (UNIT_CELL.test(joined)) return joined
  const first = c.split(/\s+/)[0] ?? ''
  if (UNIT_CELL.test(first)) return first
  const lastWord = c.split(/\s+/).pop() ?? ''
  return /\d\s+\S+$/.test(c) && UNIT_CELL.test(lastWord) ? lastWord : c
}

/** Units an ERP or a purchase clerk writes in capitals; kept as the customer wrote them. */
const CAPS_UNIT = /^(?:EA|EACH|NOS?|PCS?|SETS?|MTRS?|M|KGS?|LOTS?|ROLLS?|BOX(?:ES)?|PAIRS?|PRS?|LTRS?|FT|PKTS?|DRUMS?|COILS?|UNITS?|LENGTHS?)$/

/** A unit on its own in a table cell ("EA", "NO", "Nos", "Mtr"). */
const UNIT_CELL = new RegExp(String.raw`^(?:${UNIT_SRC})$`, 'i')
const NUM_CELL = /^\d[\d,]*(?:\.\d+)?$/

/**
 * A printed RFQ form's item row (an ERP printout: SAP, Oracle): a quantity cell next to a unit cell. Returns the item, with the
 * description from the text cells before the unit (a leading serial or requisition number is dropped). Null for any other row.
 */
function formRow(cells: string[]): ReadItem | null {
  if (cells.filter(Boolean).length < 3) return null
  for (let i = cells.length - 1; i > 0; i--) {
    const c = cells[i] as string
    if (!NUM_CELL.test(c)) continue
    const unitAt = UNIT_CELL.test(cells[i - 1] ?? '') ? i - 1 : UNIT_CELL.test(cells[i + 1] ?? '') ? i + 1 : -1
    if (unitAt < 0) continue
    const text = cells
      .slice(0, Math.min(i, unitAt))
      .filter(Boolean)
      .filter((x, k) => !(k === 0 && /^(?:\d+\s*\.?|\d{4,})$/.test(x)))
    const description = tidy(text.join(' '))
    if (!description || !/[A-Za-z]{2}/.test(description)) return null
    return { description, qty: toQty(c), unit: unitOf(cells[unitAt]), rawQty: c }
  }
  return null
}

/** A heading that starts the terms printed under the items ("Terms and Conditions", "Special Instructions :"). */
const TERMS_HEAD = /^(?:special\s+instructions|(?:general\s+)?terms\s*(?:and|&)\s*conditions|general\s+terms|terms)\s*:?$/i
/** Continuation text stops at the form's totals. */
const TOTALS = /\b(?:sub\s*-?\s*total|grand\s+total|total\s+amount|total)\b.*$/i
const MAX_DESCRIPTION = 400

/** A quantity read into the unit cell with its unit ("aty 8 Each", "8 Each"). */
function unitQty(c: string): number | null {
  const m = /(?:^|\s)(\d[\d,]*(?:\.\d+)?)\s+([A-Za-z']+)\.?$/.exec(c)
  return m && UNIT_CELL.test(m[2] as string) ? toQty(m[1] as string) : null
}

const isContact = (t: string): boolean => {
  // A city on a line of its own under the address ("Lahore.").
  if (/^[A-Z][a-z]+\.?$/.test(t.trim()) && ADDRESS.test(t)) return true
  if (PHONE_LABEL.test(t) && (PHONE.test(t) || /@|www\.|https?:/i.test(t) || /^(?:address|e-?mail|email|web|website)\b/i.test(t))) return true
  const bare = t.replace(EMAIL, ' ').replace(URL, ' ').replace(PHONE, ' ').replace(/[|,;:/()+\-–\s]+/g, ' ').trim()
  if ((EMAIL.test(t) || URL.test(t) || PHONE.test(t)) && bare.split(' ').filter(w => w.length > 1).length <= 4 && !PRODUCT.test(bare)) {
    EMAIL.lastIndex = 0
    return true
  }
  EMAIL.lastIndex = 0
  return ADDRESS.test(t) && !PRODUCT.test(t) && !LABELLED_QTY.test(t) && !hasCode(t) && !/\d\s*(?:nos?|pcs?|pieces?|sets?|ea|each|units?)\b/i.test(t) && (/,/.test(t) || (t.match(new RegExp(ADDRESS.source, 'gi')) ?? []).length >= 2)
}

const isCompanyLine = (t: string) =>
  COMPANY.test(t) && !/\d/.test(t.replace(EMAIL, '')) && t.split(/\s+/).length <= 9 && !PRODUCT.test(t) && !COURTESY.test(t.replace(/\bcompany\b/i, ''))

/** A line with model-code shapes (letters and digits mixed) is about a product, not a person. */
const hasCode = (t: string) => /(?<![\w@.])(?=[A-Za-z0-9-]*[A-Za-z])(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]{3,}(?![\w@])/.test(t.replace(EMAIL, ' ').replace(PHONE, ' '))

/** Lines with no digits that only ask, thank or point at an attachment (still so once a polite opener is taken off). */
function isCourtesy(t: string): boolean {
  if (/\d/.test(t) || PRODUCT.test(t) || hasCode(t)) return false
  if (ACK.test(t) && t.split(/\s+/).length <= 8) return true
  if (!COURTESY.test(t)) return false
  const rest = parsePaste(t).items[0]?.description ?? ''
  return rest === '' || COURTESY.test(rest)
}

const ABBREV = /(?:\b(?:no|nos|ref|dt|engr|mr|ms|mrs|dr|st|co|pvt|ltd|approx|etc|vs|sr|jr|qty|m)\.)$/i

function sentences(t: string): string[] {
  const out: string[] = []
  let start = 0
  const re = /[.!?]\s+(?=[A-Z])/g
  let m: RegExpExecArray | null
  while ((m = re.exec(t))) {
    const piece = t.slice(start, m.index + 1)
    if (ABBREV.test(piece)) continue
    out.push(piece.trim())
    start = m.index + m[0].length
  }
  out.push(t.slice(start).trim())
  return out.filter(Boolean)
}

// ------------------------------------------------------------------------------------------------ main

export function parseEnquiry(raw: string, opts: EnquiryOptions = {}): EnquiryParse {
  const today = opts.today ?? businessToday()
  const own = opts.own ?? DEFAULT_OWN
  const text = (raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ':')
    // Urdu and Arabic-Indic digits, the Urdu word for "number" (adad) and Urdu request tails ("bhej dein", "chahiye").
    .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x06f0 + 48))
    .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0660 + 48))
    .replace(/\s*عدد/g, ' adad')
    .replace(/\s*(?:بھیج\s*دیں|بھیجیں|بھیج\s*دو|چاہیے|چاہئے|چاہیئے|ضرور|جلدی|بھی)(?=\s|$|[.!؟?،])/g, '')

  interface Src {
    t: string
    indent: number
    blankBefore: boolean
    wa: boolean
  }
  const src: Src[] = []
  let blank = false
  /** Inside a chat message we sent ourselves (its sender is our own name): not the customer's words. */
  let ownMessage = false
  for (const line0 of alignSpacedRows(text.split('\n'))) {
    const line = line0.replace(EMOJI, '').replace(/\s+$/, '')
    const web = WA_WEB_PREFIX.test(line)
    const wa = web || (WA_PREFIX.test(line) && /^\s*\[?\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4},?\s+\d{1,2}:\d{2}/.test(line))
    const body = web ? line.replace(WA_WEB_PREFIX, '') : wa ? line.replace(WA_PREFIX, '') : line
    if (wa) {
      const sender = /(?:\]|\s-)\s*([^:\]]{1,40}):\s*$/.exec(line.slice(0, line.length - body.length))?.[1] ?? ''
      ownMessage = sender !== '' && own.test(sender)
    }
    if (ownMessage || CHAT_MEDIA.test(body.trim())) continue
    if (!body.trim()) {
      blank = true
      continue
    }
    // Columns lined up with spaces (copied from a PDF viewer): two or more wide gaps make it a tab row.
    const spaced = !body.includes('\t') && (body.trim().match(/\S {3,}(?=\S)/g) ?? []).length >= 2 ? body.trim().replace(/ {3,}/g, '\t') : body
    const kept = spaced.includes('\t') ? spaced.replace(/[ ]+/g, ' ').replace(/^ +| +$/g, '').replace(/(?:\s*\t\s*)+$/, '') : spaced.replace(/[ ]+/g, ' ').trim()
    if (!kept.replace(/\t/g, '').trim()) {
      blank = true
      continue
    }
    src.push({ t: kept, indent: /^\s*/.exec(body)?.[0].replace(/\t/g, '    ').length ?? 0, blankBefore: blank, wa })
    blank = false
  }
  rebuildCellTables(src, t => SIGN_OFF.test(t) || DISCLAIMER.test(t) || findDue(t, today) !== null)

  // A closing block of name, title, phone, address and email with no sign-off word is a signature too: a paragraph that has
  // a contact line, no quantity and no product words or model codes.
  const sigLines = new Set<number>()
  {
    let p0 = 0
    for (let k = 0; k <= src.length; k++) {
      if (k === src.length || (k > p0 && (src[k] as Src).blankBefore)) {
        const para = src.slice(p0, k)
        const contact = para.some(s => isContact(s.t))
        const itemish = para.some(s => !isContact(s.t) && (LABELLED_QTY.test(s.t) || PRODUCT.test(s.t) || hasCode(s.t) || /\t/.test(s.t) || MARKER.test(s.t)))
        if (contact && !itemish && p0 > 0) for (let q = p0; q < k; q++) sigLines.add(q)
        p0 = k
      }
    }
  }

  // A reply on top of an older thread: once the new message above the separator ("____", "-----Original Message-----",
  // "On ... wrote:", or an Outlook "From:" with "Sent:" or "Date:" under it) has anything item-like, everything below it is the
  // old thread, even when nothing above has been read as an item yet. It never counts for list mode either.
  const itemish = (t: string) => LABELLED_QTY.test(t) || PRODUCT.test(t) || hasCode(t) || /\d\s*(?:nos?|pcs?|sets?|units?)\b/i.test(t)
  let quotedFrom = src.length
  for (let k = 1; k < src.length; k++) {
    const t = (src[k] as Src).t
    const outlook = /^from\s*:/i.test(t) && src.slice(k + 1, k + 4).some(x => /^(?:sent|date)\s*:/i.test(x.t))
    if ((REPLY_SEP.test(t) || outlook) && !FORWARD_SEP.test(t) && src.slice(0, k).some(x => itemish(x.t))) {
      quotedFrom = k
      break
    }
  }

  // List mode: when the items carry markers ("1.", "-", "a)"), an unmarked line is not an item of its own.
  const markerMode = src.some((s, k) => {
    if (sigLines.has(k) || k >= quotedFrom) return false
    const m = MARKER.exec(s.t)
    if (!m) return false
    const body = s.t.slice(m[0].length)
    return body === '' || (!isCourtesy(body) && !isContact(body))
  })

  // Form mode: a printed RFQ form (an ERP printout read from a PDF) has its items as table rows with a quantity next to a unit.
  // Then a line outside those rows is never an item of its own: it is the description wrapping onto the next line (joined to
  // the row above) or the form around the table (header boxes, comments, terms).
  const formMode = src.some(s => {
    const c = splitCells(s.t)
    return c !== null && formRow(c) !== null
  })

  const lines: EnquiryLine[] = []
  const drafts: Draft[] = []
  const refs: Array<RefHit & { line: string }> = []
  let due: { iso: string; text: string } | null = null
  const emails: Array<{ e: string; rank: number }> = []
  const phones: string[] = []
  const names: Array<{ n: string; rank: number }> = []
  let zone: 'content' | 'signature' | 'quoted' | 'disclaimer' | 'terms' = 'content'
  let cur: Draft | null = null
  let table: TableCols | null = null
  let contentLines = 0
  /** Form mode: the item row a wrapped line belongs to, until a blank line. */
  let row: Draft | null = null
  const extend = (d: Draft, t: string) => {
    const it = d.fromTable as ReadItem
    const more = tidy(t.replace(TOTALS, ''))
    // A part number broken at its dash ("6ES7647-8BB61-" / "7CS1") is joined back without a space.
    const glue = hyphenated.has(d) ? '-' : ' '
    hyphenated.delete(d)
    if (/[A-Za-z0-9]-\s*$/.test(t)) hyphenated.add(d)
    if (more && it.description.length < MAX_DESCRIPTION) it.description = tidy(`${it.description}${glue}${more}`).slice(0, MAX_DESCRIPTION)
    lines.push({ text: t, kind: 'joined', reason: null, marker: null })
  }
  const hyphenated = new Set<Draft>()

  /**
   * A line under a form's item row that goes on with its description (wrapped text, "MAKE: X"), not the form's own text: a
   * due date, a reference, a delivery date, an instruction, a sign-off, a contact line, courtesy.
   */
  /** "Kindly send your offer by" / "02/11/2026": a due-date sentence whose date wrapped onto the next line. */
  const dueOnNext = (t: string, next: string | undefined) =>
    next && (DUE_STRONG.test(t) || (DUE_WEAK.test(t) && QUOTE_WORD.test(t))) && !findDate(t, today) ? findDue(`${t} ${next}`, today) : null
  const continuesRow = (t0: string): boolean => {
    // A numbered line under the table ("1. Bid security 2% ...") is the form's own text; so are a title and a company.
    if (/^\(?\d{1,2}[.)]\s/.test(t0)) return false
    if ((DESIGNATION.test(t0) && t0.split(' ').length <= 4 && !/\d/.test(t0)) || (isCompanyLine(t0) && !own.test(t0))) return false
    const t = t0
    return !(
      findDue(t, today) ||
      (DUE_STRONG.test(t) && /\d/.test(t)) ||
      findRefs(t).length > 0 ||
      (INSTRUCTION.test(t) && !ATTR.test(t)) ||
      SIGN_OFF.test(t) ||
      isContact(t) ||
      isCourtesy(t) ||
      (NOT_DUE.test(t) && findDate(t, today) !== null) ||
      /^(?:please|kindly|we\s|our\s|prepared|approved|checked|requested|for\s+and\s+on|authori[sz]ed|signature)/i.test(t)
    )
  }
  const skip = (t: string, reason: SkipReason) => lines.push({ text: t, kind: 'skipped', reason, marker: null })
  const close = () => {
    cur = null
  }
  const noteContacts = (t: string, rank: number) => {
    for (const e of t.match(EMAIL) ?? []) emails.push({ e: e.toLowerCase(), rank })
    const w = URL.exec(t)
    if (w) emails.push({ e: `web@${w[0].replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0]}`.toLowerCase(), rank: rank - 1 })
    const p = PHONE.exec(t)
    if (p && phones.length < 3) phones.push(p[0].trim())
  }
  const noteCompany = (t: string, rank: number) => {
    // "Example Mills Limited, Some Centre, 2nd Floor,": the company is one part of an address line.
    for (const part of t.split(/\s*[|,]\s*/)) {
      const p = part.replace(EMAIL, '').trim()
      if (p && isCompanyLine(p) && !own.test(p)) names.push({ n: p, rank })
    }
  }
  const noteFacts = (t: string, rankShift = 0) => {
    for (const r of findRefs(t)) refs.push({ ...r, rank: r.rank + rankShift, line: t })
    if (!due && rankShift === 0) due = findDue(t, today)
  }

  for (let k = 0; k < src.length; k++) {
    const s = src[k] as Src
    const t = s.t
    if (s.blankBefore) {
      table = null
      row = null
    }
    if (zone === 'terms') {
      if (!due) due = findDue(t, today) ?? findDue(`${t} ${src[k + 1]?.t ?? ''}`, today)
      noteContacts(t, 1)
      skip(t, 'instruction')
      continue
    }
    if (TERMS_HEAD.test(t) && drafts.length > 0) {
      zone = 'terms'
      close()
      skip(t, 'instruction')
      continue
    }

    if (FORWARD_SEP.test(t)) {
      zone = 'content'
      close()
      skip(t, 'header')
      continue
    }
    if (k === quotedFrom) {
      close()
      zone = 'quoted'
    }
    if (REPLY_SEP.test(t)) {
      close()
      // Items above: the rest is the older thread. None yet: what follows is the enquiry (a forward pasted whole).
      zone = drafts.length > 0 || k >= quotedFrom ? 'quoted' : 'content'
      skip(t, 'quoted')
      continue
    }
    if (zone === 'quoted') {
      if (/^(?:from|to|cc|subject)\s*:/i.test(t)) {
        noteContacts(t, 1)
        if (/^subject\s*:/i.test(t)) noteFacts(t, -5)
      }
      skip(t, 'quoted')
      continue
    }
    if (/^>/.test(t)) {
      skip(t, 'quoted')
      continue
    }
    if (zone !== 'disclaimer' && DISCLAIMER.test(t)) zone = 'disclaimer'
    if (zone === 'disclaimer') {
      skip(t, 'disclaimer')
      continue
    }
    if (HEADER_LINE.test(t)) {
      close()
      if (/^(?:from|reply-to)\s*:/i.test(t)) noteContacts(t, 3)
      else if (/^(?:to|cc)\s*:/i.test(t)) noteContacts(t, 0)
      if (/^subject\s*:/i.test(t)) {
        noteFacts(t)
        const sr = findRefs(t).length ? null : subjectRef(t)
        if (sr) refs.push({ ...sr, line: t })
      }
      skip(t, 'header')
      continue
    }
    if (zone === 'signature' && s.wa) zone = 'content'
    if (zone === 'signature' || sigLines.has(k)) {
      noteContacts(t, 3)
      noteCompany(t, 3)
      skip(t, 'signature')
      continue
    }
    if (SENT_FROM.test(t)) {
      skip(t, 'signature')
      continue
    }
    if (SIGN_OFF.test(t)) {
      close()
      if (drafts.length > 0 || contentLines > 1) zone = 'signature'
      skip(t, 'greeting')
      continue
    }
    contentLines++

    // A line with no Latin letter or digit (a greeting typed in Urdu): never an item, as a part is named in English.
    if (!/[A-Za-z0-9]/.test(t)) {
      skip(t, 'greeting')
      continue
    }
    // A sentence that wrapped onto this line ("The quotation" / "should mention delivery period ..."): skipped as its first
    // line was. Our own name and address ("M/s Q-Tech Engineering, Lahore") and a broken-off email address are never items.
    const last = lines[lines.length - 1]
    if (
      last?.kind === 'skipped' &&
      (last.reason === 'instruction' || last.reason === 'greeting' || last.reason === 'date' || last.reason === 'reference') &&
      !/[.:!?]$/.test(last.text) &&
      last.text.split(' ').length >= 6 &&
      /^[a-z]/.test(t) &&
      !/\d/.test(t) &&
      !s.wa &&
      !t.includes('\t')
    ) {
      skip(t, last.reason)
      continue
    }
    if ((own.test(t) && !LABELLED_QTY.test(t) && !/\d\s*(?:nos?|pcs?|sets?)\b/i.test(t)) || (/@/.test(t) && t.split(' ').length <= 3)) {
      for (const r of findRefs(t)) refs.push({ ...r, line: t })
      if (!due) due = findDue(t, today) ?? dueOnNext(t, src[k + 1]?.t)
      noteContacts(t, 1)
      skip(t, 'contact')
      continue
    }

    // ---- tables (tab or pipe separated)
    const cells = splitCells(t)
    if (cells) {
      if (cells.every(c => /^[\s:|+=_*-]*$/.test(c))) {
        skip(t, 'table')
        continue
      }
      const head = tableHeader(cells)
      if (head) {
        close()
        table = head
        skip(t, 'table')
        continue
      }
      if (table) {
        // A header word the picture reader got wrong ("Qry", "uUomMm"): the column is found from the first row that has a
        // number after the description (the quantity) and a unit word (the unit).
        if (table.qty < 0 || table.unit < 0) {
          const after = (i: number) => i > Math.max(...table!.desc) && !table!.extra.some(e => e.i === i)
          if (table.qty < 0) {
            const q = cells.findIndex((c, i) => after(i) && NUM_CELL.test(c))
            if (q >= 0 && cells.some((c, i) => i !== q && after(i) && UNIT_CELL.test(unitCell(c)))) table.qty = q
          }
          if (table.unit < 0 && table.qty >= 0) {
            const u = cells.findIndex((c, i) => i !== table!.qty && after(i) && UNIT_CELL.test(unitCell(c)))
            if (u >= 0) table.unit = u
          }
        }
        const it = tableItem(cells, table)
        // A form's row with no quantity is the row above wrapping onto the next line.
        // A row with its own serial number or material code is an item even when its quantity was not read.
        const rowShape = (table.unit >= 0 && UNIT_CELL.test(unitCell(cells[table.unit] ?? ''))) || cells.some(c => /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(c))
        const ownRow = rowShape && (/^\d{1,5}\s*\.?$/.test(cells[0] ?? '') || table.extra.some(e => e.codes && /^\d{5,}$/.test(cells[e.i] ?? '')))
        if (formMode && row && !ownRow && (table.qty < 0 || !NUM_CELL.test(cells[table.qty] ?? '')) && continuesRow(cells.filter(Boolean).join(' '))) {
          // Only the text that goes on with the item: the description columns, the Make / Part No columns, and words that
          // spilled into the serial column; not the plant or the unit wrapping in their own columns ("FCCL" / "Nizampur").
          const tbl = table
          const keep = cells.filter((c, i) => c && (tbl.desc.includes(i) || tbl.extra.some(e => e.i === i) || (i === 0 && !/^\d{1,3}\s*\.?$/.test(c))))
          extend(row, (keep.length ? keep : cells.filter(Boolean)).join(' '))
          continue
        }
        if (it) {
          const d: Draft = { first: lines.length, marker: null, indent: 0, texts: [], attrs: [], qty: null, fromTable: it }
          drafts.push(d)
          row = formMode ? d : null
          lines.push({ text: t, kind: 'item', reason: null, marker: null })
          close()
          continue
        }
        skip(t, 'table')
        close()
        continue
      }
    }

    if (formMode) {
      const it = cells ? formRow(cells) : null
      if (it) {
        close()
        row = { first: lines.length, marker: null, indent: 0, texts: [], attrs: [], qty: null, fromTable: it }
        drafts.push(row)
        lines.push({ text: t, kind: 'item', reason: null, marker: null })
        continue
      }
      if (row && !/^(?:comments?|remarks?|note)\s*:/i.test(t) && continuesRow(t)) {
        extend(row, cells ? cells.filter(Boolean).join(' ') : t)
        continue
      }
      row = null
      // Facts still come from the form around the table; nothing else there is an item.
      for (const r of findRefs(t)) refs.push({ ...r, line: t })
      if (!due) due = findDue(t, today) ?? dueOnNext(t, src[k + 1]?.t)
      noteContacts(t, 2)
      if (isCompanyLine(t) && !own.test(t)) names.push({ n: t, rank: contentLines <= 4 ? 2 : 1 })
      skip(t, isContact(t) ? 'contact' : 'header')
      continue
    }

    // A header word on its own line (a table pasted one cell per line).
    if (!/\d/.test(t) && t.split(' ').length <= 3 && isHeaderCell(t)) {
      close()
      skip(t, 'table')
      continue
    }

    // ---- facts: references and dates
    const lineRefs = findRefs(t)
    // "Quotation must reach us on or before" / "08/11/2026": the date can wrap onto the next line.
    const lineDue = findDue(t, today) ?? dueOnNext(t, src[k + 1]?.t)
    for (const r of lineRefs) refs.push({ ...r, line: t })
    if (lineDue && !due) due = lineDue
    noteContacts(t, 2)
    if (isCompanyLine(t) && !own.test(t)) {
      names.push({ n: t, rank: contentLines <= 4 ? 2 : 1 })
      close()
      skip(t, 'contact')
      continue
    }
    if (isContact(t)) {
      skip(t, 'contact')
      continue
    }
    const m = MARKER.exec(t)
    const body = m ? t.slice(m[0].length).trim() : t
    const marker = m ? m[0].trim() : null

    // An item with a list marker and nothing after it ("Item 1"): its Description: line follows.
    if (m && body === '') {
      cur = { first: lines.length, marker, indent: s.indent, texts: [], attrs: [], qty: null }
      drafts.push(cur)
      lines.push({ text: t, kind: 'item', reason: null, marker })
      continue
    }

    // Sentences that only carry the reference, a date, a greeting or courtesy are dropped; what is left may be an item.
    let work = body
    const said = sentences(body)
    const keep = said.filter(
      p => !findRefs(p).length && !findDue(p, today) && !findDate(p, today) && !(said.length > 1 && (isCourtesy(p) || GREETING_SENTENCE.test(p))),
    )
    if (keep.length < said.length) {
      work = keep.join(' ')
      if (!work || (!LABELLED_QTY.test(work) && !PRODUCT.test(work) && !hasCode(work) && !/\d/.test(work) && !m)) {
        close()
        skip(t, lineRefs.length ? 'reference' : lineDue || findDate(body, today) ? 'date' : 'greeting')
        continue
      }
    }
    if (INSTRUCTION.test(work) && !ATTR.test(work)) {
      close()
      skip(t, 'instruction')
      continue
    }

    // ---- lines that belong to the item above
    const attr = ATTR.exec(work)
    if (attr && !m) {
      const label = (attr[1] as string).trim()
      const value = (attr[2] as string).trim()
      if (/^(?:description|item\s+description|material\s+description|item|product)$/i.test(label)) {
        if (cur && cur.texts.length === 0) {
          ;(cur as Draft).texts.push(value)
          lines.push({ text: t, kind: 'joined', reason: null, marker: null })
        } else {
          cur = { first: lines.length, marker: null, indent: s.indent, texts: [value], attrs: [], qty: null }
          drafts.push(cur)
          lines.push({ text: t, kind: 'item', reason: null, marker: null })
        }
        continue
      }
      if (cur) {
        const d = cur as Draft
        if (/qty|quantity|q'ty/i.test(label)) {
          const q = QTY_ONLY.exec(value)
          if (q && !d.qty) d.qty = { qty: toQty(q[1] as string), unit: unitOf(q[2]) }
        } else if (/^(?:uom|unit)$/i.test(label)) {
          if (d.qty && !d.qty.unit) d.qty.unit = unitOf(value)
        } else if (value) d.attrs.push(`${label}: ${value}`)
        lines.push({ text: t, kind: 'joined', reason: null, marker: null })
        continue
      }
    }
    const qOnly = QTY_ONLY.exec(work.replace(TAIL, '').trim())
    if (qOnly && !m && !cur) {
      // a number on its own with no item above (a table pasted one cell per line: the row number)
      skip(t, 'table')
      continue
    }
    if (qOnly && cur && !(cur as Draft).qty && !m) {
      ;(cur as Draft).qty = { qty: toQty(qOnly[1] as string), unit: unitOf(qOnly[2]) }
      ;(cur as Draft).qtyLine = true
      lines.push({ text: t, kind: 'joined', reason: null, marker: null })
      continue
    }
    // A line with a quantity and unit of its own ("Pneumatic cylinder bore 40mm - 2 Nos") is an item of its own in a list whose
    // other lines have markers, unless it wraps from an item that has no quantity yet.
    const self = readItem(work)
    const ownQty = !m && self !== null && self.qty !== null && /[A-Za-z]{3}/.test(self.description)
    const curHasQty0 = () => cur !== null && ((cur as Draft).qty !== null || ((cur as Draft).texts.length > 0 && readItem(joinWrapped((cur as Draft).texts))?.qty != null))
    if (cur && !m && !s.blankBefore) {
      const d = cur as Draft
      const prev = d.texts[d.texts.length - 1] ?? ''
      // An indented line under an item is its wrapped text, unless both have a quantity of their own (a list pasted with
      // leading spaces: "Pressure gauge - 2 Nos" / "   Ball valve - 4 Nos").
      const wraps = !d.qtyLine && ((s.indent > d.indent && !(ownQty && curHasQty0())) || DANGLING.test(prev))
      const curHasQty = d.qty !== null || (d.texts.length > 0 && readItem(joinWrapped(d.texts))?.qty != null)
      // In a marked list, an unmarked line naming a product after an item that has its quantity starts a new item (its
      // quantity can follow on the next line: "Insulation tape self amalgamating" / "25 rolls").
      const newItem = markerMode && curHasQty && (PRODUCT.test(work) || hasCode(work)) && !DANGLING.test(prev)
      if (wraps || (markerMode && !newItem && !isCourtesy(work) && !SIGN_OFF.test(work) && !(ownQty && curHasQty))) {
        d.texts.push(work)
        lines.push({ text: t, kind: 'joined', reason: null, marker: null })
        continue
      }
    }
    close()
    const unmarkedItem = markerMode && !m && cur === null && lines[lines.length - 1]?.kind !== 'skipped' && (PRODUCT.test(work) || hasCode(work))
    if (markerMode && !m && !ownQty && !unmarkedItem) {
      skip(t, 'greeting')
      continue
    }
    // A heading over a group of items ("Mechanical spares:", "For ETP plant:").
    if (!m && /:\s*$/.test(work) && !/\d/.test(work) && work.split(' ').length <= 5) {
      skip(t, 'header')
      continue
    }
    const greetingOnly = GREETING_SENTENCE.test(work) && !/\d/.test(work) && !PRODUCT.test(work) && !hasCode(work) && work.split(' ').length <= 6
    if ((!m && (isCourtesy(work) || greetingOnly)) || (!m && DESIGNATION.test(work) && work.split(' ').length <= 4 && !/\d/.test(work) && !PRODUCT.test(work))) {
      skip(t, 'greeting')
      continue
    }
    // Two items in one line: "4 nos contactor ... and 4 nos overload relay ..."
    // A list line the picture reader split at a wide gap ("1. Thermal paste silicone based    5 Kg"): one line again.
    if (work.includes('\t') && (m || work.split('\t').filter(Boolean).length < 3)) work = work.replace(/\t+/g, ' ')
    if (work.includes('\t')) {
      // A spreadsheet-like row with no header above it: the intake's own reading (row number dropped, last cells qty and unit).
      const row0 = parsePaste(work).items[0]
      const row = row0 && row0.unit ? { ...row0, unit: unitOf(writtenUnitFor(work.replace(/\t/g, ' '), row0.qty) ?? row0.unit) } : row0
      if (row) {
        drafts.push({ first: lines.length, marker, indent: s.indent, texts: [], attrs: [], qty: null, fromTable: row })
        lines.push({ text: t, kind: 'item', reason: null, marker })
      } else skip(t, 'table')
      continue
    }
    let parts = work.split(new RegExp(String.raw`\s+(?:and|&|aur|plus|\+)\s+(?=\d[\d,.]*\s*(?:${UNIT_SRC}|x)\b)`, 'i'))
    if (parts.length === 1) parts = work.split(/(?<=\d\s*(?:nos?|pcs?|pieces?|sets?|units?)\.?)\s+(?:and|&|aur|plus)\s+/i)
    if (parts.length > 1 && !parts.every(p => readItem(p)?.qty != null)) parts = [work]
    if (!parts.every(p => readItem(p) !== null)) {
      skip(t, 'greeting')
      continue
    }
    for (const p of parts) {
      const d: Draft = { first: lines.length, marker, indent: s.indent, texts: [p], attrs: [], qty: null }
      drafts.push(d)
      cur = d
    }
    lines.push({ text: t, kind: 'item', reason: null, marker })
  }

  // ---- items
  // The customer's own unit, when the row ends with it in capitals ("12\tEA", "100   MTR", "3 SET"): kept as written.
  const writtenUnit = (d: Draft): string | null => {
    const line = lines[d.first]?.text ?? ''
    const m = /\d[\d,]*(?:\.\d+)?[\s\t]+([A-Z]{1,5}S?)\.?[\s\t]*$/.exec(line.replace(/[\u00a0]/g, ' '))
    const w = m?.[1]
    // "NOS" and "SET" are our own units in capitals: stored as ours. "EA" or "MTR" would be renamed by the intake: kept as written.
    return w && CAPS_UNIT.test(w) && unitOf(w) !== w.toLowerCase() ? w : null
  }
  // An ERP form writes every quantity with three decimals ("2.000"): one read from a picture without its point ("2000",
  // "12500") is the same form's 2.000 and 12.500.
  const raws = drafts.map(d => d.fromTable?.rawQty ?? '').filter(Boolean)
  if (raws.length >= 2 && raws.filter(r => /^\d[\d,]*\.\d{3}$/.test(r)).length >= 0.5 * raws.length) {
    for (const d of drafts) {
      const r = d.fromTable?.rawQty
      if (d.fromTable && r && /^\d{4,}$/.test(r)) d.fromTable.qty = Number(r) / 1000
    }
  }
  const items: ParsedItem[] = []
  for (const d of drafts) {
    if (d.fromTable) {
      items.push({ description: d.fromTable.description, qty: d.fromTable.qty ?? 1, unit: writtenUnit(d) ?? d.fromTable.unit })
      continue
    }
    const r = d.texts.length ? readItem(joinWrapped(d.texts)) : null
    const description = tidy([r?.description ?? '', ...d.attrs].filter(Boolean).join(', '))
    if (!description) continue
    const qty = r && r.qty !== null ? { qty: r.qty, unit: r.unit } : d.qty
    items.push({ description, qty: qty?.qty ?? 1, unit: (qty ? writtenUnit(d) : null) ?? qty?.unit ?? null })
  }

  // ---- facts
  refs.sort((a, b) => b.rank - a.rank)
  const ref = refs.find(r => r.rank > 0 && !own.test(r.line.replace(/\bq[\s-]?tech\b.*?:/i, ''))) ?? refs[0] ?? null
  const domainOf = (e: string) => (e.split('@')[1] ?? '').replace(/^www\./, '')
  const goodEmails = emails.filter(x => {
    const d = domainOf(x.e)
    return d !== '' && !own.test(x.e) && !FREE_MAIL.test(d)
  })
  goodEmails.sort((a, b) => b.rank - a.rank)
  const domain = goodEmails[0] ? domainOf(goodEmails[0].e) : null
  names.sort((a, b) => b.rank - a.rank)
  // "For Example Mills Ltd" under a letter, "M/s Example Mills": the company is what follows.
  const name =
    names[0]?.n
      .replace(/^(?:for\s+(?:and\s+on\s+behalf\s+of\s+)?|on\s+behalf\s+of\s+|m\/s\.?\s*|messrs\.?\s+)/i, '')
      .replace(/[\s,:;]+$/, '')
      .trim() ?? null
  const realEmails = [...new Set(goodEmails.map(x => x.e).filter(e => !e.startsWith('web@')))]
  const company = name || domain || realEmails.length || phones.length ? { name, domain, emails: realEmails, phones } : null

  return {
    items,
    lines,
    lineCount: src.length,
    facts: {
      customerRef: ref ? { value: ref.value, label: ref.label, line: ref.line } : null,
      dueDate: due,
      company,
    },
    raw: raw ?? '',
  }
}

/**
 * The result in the intake's own shape (parseItems' ParseResult), so the paste panel shows it as it shows parsePaste's: a line
 * folded into the item above counts as part of that item, not as skipped.
 */
export function asParseResult(r: EnquiryParse): ParseResult {
  return {
    items: r.items,
    lines: r.lines.map(l => ({ text: l.text, kind: l.kind === 'skipped' ? 'skipped' : 'item', marker: l.marker })),
    // A table's header row is not a line of the enquiry ("2 items found in 2 lines" for a header and two rows), as parsePaste counts.
    lineCount: r.lineCount - r.lines.filter(l => l.reason === 'table' && splitCells(l.text) !== null && tableHeader(splitCells(l.text) as string[]) !== null).length,
  }
}
