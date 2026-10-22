// Reads a supplier's quotation (an email, a WhatsApp reply, or the text of a quotation or proforma-invoice PDF) into offers per
// RFQ item. Pure and framework-free. The per-line reading is the supplier-reply parser's (src/features/rfqs/lib/replyParse.ts:
// unit price and currency, lead time, stock, MOQ, validity, regrets, matching a line to an RFQ item by part number first and
// then by description); this module prepares a whole quotation for it and reads the quotation's own header and terms:
//
//  - Full-width and Chinese forms are made plain: ￥ stays a yuan sign, full-width digits and colons become ASCII, "3-5天" is
//    "3-5 days", "2周" is "2 weeks". Currency symbols ¥ ￥ € $ £ Rs and codes PKR USD EUR RMB/CNY AED GBP are all read.
//  - Lines that are not offers are taken out so their numbers are never read as a price or matched to an item by position:
//    totals (Sub Total, VAT, Freight, Grand Total), amount in words, bank details, the quotation's own number and date,
//    addresses, phone and email lines. They are listed in `dropped`.
//  - Terms written for the whole quotation (validity, payment, delivery terms, "all prices in USD") are set apart so they
//    apply to every item, not only the item above them.
//  - The header and terms are returned as `facts`: quotation number and date, currency, validity, lead time, payment terms,
//    incoterm and MOQ.
//
// It never saves anything: the screen shows the offers and the person accepts them (R08).

import { parseLeadTime, parseSupplierReply, type LeadTime, type ParsedReply, type ParseReplyOptions, type ReplyCurrency, type ReplyItemRef } from '@/features/rfqs/lib/replyParse'
import { businessToday } from '@/lib/dates'
import { alignSpacedRows, rebuildCellText } from './cellTable'
import { findDate } from './enquiryParse'

export interface QuoteFacts {
  /** The supplier's own quotation or proforma-invoice number. */
  quoteRef: string | null
  /** YYYY-MM-DD. */
  quoteDate: string | null
  /** The currency the quotation states or the only one it uses. */
  currency: ReplyCurrency | null
  validity: { text: string; days: number | null } | null
  leadTime: LeadTime | null
  paymentTerms: string | null
  /** "FOB Shanghai", "EXW Karachi", "CIF". */
  incoterm: string | null
  moq: number | null
}

export interface SupplierQuoteParse extends ParsedReply {
  facts: QuoteFacts
  /** The text as given to the line parser, after the preparation above. */
  text: string
  /** Lines taken out (totals, bank details, the quotation header), for "we ignored these lines". */
  dropped: string[]
}

// ------------------------------------------------------------------------------------------------ text preparation

/** Full-width forms and Chinese units to plain text ("￥" is kept: it is read as yuan). */
export function plainQuoteText(raw: string): string {
  return (raw ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u2007\u202f\u3000]/g, ' ')
    .replace(/[０-９]/g, d => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/：/g, ': ')
    .replace(/，/g, ', ')
    .replace(/（/g, ' (')
    .replace(/）/g, ') ')
    .replace(/．/g, '.')
    .replace(/[～〜]/g, '-')
    // A word the picture reader broke at its dash ("ex- stock").
    .replace(/\bex-\s+stock\b/gi, 'ex-stock')
    .replace(/(\d)\s*个?工作日/g, '$1 working days')
    .replace(/(\d)\s*天/g, '$1 days')
    .replace(/(\d)\s*(?:个)?(?:星期|周)/g, '$1 weeks')
    .replace(/(\d)\s*个月/g, '$1 months')
    .replace(/(\d)\s*(?:个|件|只|台|套)(?![一-鿿])/g, '$1 pcs')
    .replace(/单价/g, 'Unit price ')
    .replace(/交货期|交期|货期/g, 'Delivery ')
    .replace(/有效期/g, 'Validity ')
    .replace(/最小起订量|起订量/g, 'MOQ ')
}

const TOTAL_LABEL =
  /^(?:sub\s*-?\s*total|total(?:\s+(?:amount|value|price))?|grand\s+total|net\s+(?:total|amount)|vat|gst|sales\s+tax|tax|freight|shipping(?:\s+cost)?|discount|packing|insurance|bank\s+charges|round(?:ing)?\s*off|amount\s+in\s+words|in\s+words|say\s*:|total\s+in\s+words)\b/i
const BANK = /\b(?:iban|swift|bic|account\s*(?:no\.?|number|title|name)|a\/c\s*(?:no|title)|beneficiary|bank\s*(?:name|address|details|account)|branch\s*code|routing|sort\s*code)\b/i
const CONTACT = /^(?:tel|ph|phone|fax|mob|mobile|cell|email|e-mail|web|website|www\.|add(?:ress)?|attn|attention|to|from|cc|sent|subject|date|dated)\b\.?\s*[:.]?/i
const QUOTE_REF = /\b(?:quotation|quote|offer|proforma(?:\s+invoice)?|p\.?\s?i\.?|invoice|ref(?:erence)?)\s*(?:no\.?|number|#)\s*[:.#-]?\s*([A-Z0-9][A-Z0-9/_.-]*\d[A-Z0-9/_.-]*)/i
const YOUR_REF = /^(?:your|ur)\s+(?:ref|rfq|enquiry|inquiry)\b/i
/** Terms for the whole quotation: set apart from the item above so they apply to every item. */
const TERMS = /^(?:price\s+validity|validity|offer\s+valid|quotation\s+valid|valid\s+(?:for|till|until)|payment|terms|delivery\s+terms|incoterms?|price\s+basis|prices?\s+(?:are|is|in|based)|all\s+(?:prices|items|the\s+above)|currency|warranty|remarks?\s*:|notes?\s*:)/i

const TERM_LABEL = /^(?:price\s+)?(?:validity|offer\s+validity|delivery(?:\s+(?:time|period|terms))?|lead\s*time|payment(?:\s+terms)?|terms\s+of\s+payment|incoterms?|price\s+basis|currency|warranty|origin|moq)\s*:?$/i

function cells(line: string): string[] {
  return line.includes('\t') ? line.split('\t').map(c => c.trim()) : line.includes('|') && (line.match(/\|/g) ?? []).length >= 2 ? line.split('|').map(c => c.trim()) : [line.trim()]
}

/** A totals row: its first written cell is a totals label and it names no product. */
function isTotalRow(line: string): boolean {
  const filled = cells(line).filter(Boolean)
  const first = filled.find(c => !/^[\d.,\s]*$/.test(c)) ?? ''
  return TOTAL_LABEL.test(first)
}

// ------------------------------------------------------------------------------------------------ facts

const VALID_DAYS = /\bvalid(?:ity)?\b[^0-9\n]{0,20}?(\d{1,3})\s*(days?|weeks?|months?)\b/i
const VALID_UNTIL = /\bvalid(?:ity)?\b[^\n]{0,25}?\b(?:till|until|upto|up\s+to|through|to)\b\s*:?\s*(.{4,30})$/i
const PAYMENT = /^(?:payment(?:\s+terms?)?|terms\s+of\s+payment)\s*[:=-]?\s*(.+)$/i
const INCOTERM = /\b(EXW|FOB|FCA|CIF|CFR|CNF|CPT|CIP|DAP|DPU|DDP|Ex[\s-]?works)\b(?:\s*[,:-]?\s*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?))?/
const MOQ = /\b(?:moq|min(?:imum)?\.?\s*order(?:\s*(?:qty|quantity))?)\s*[:=-]?\s*(\d[\d,]*)/i
const LEAD_LABEL = /^(?:delivery(?:\s+(?:time|period))?|lead\s*time|shipment|dispatch|ready\s+in|eta)\b/i

const utcDays = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000
}

function readFacts(lines: string[], today: string): Omit<QuoteFacts, 'currency'> {
  const f: Omit<QuoteFacts, 'currency'> = { quoteRef: null, quoteDate: null, validity: null, leadTime: null, paymentTerms: null, incoterm: null, moq: null }
  for (const line of lines) {
    const t = line.replace(/\t+/g, ' ').trim()
    if (!t) continue
    if (!f.quoteRef && !YOUR_REF.test(t)) {
      const r = QUOTE_REF.exec(t)
      if (r) f.quoteRef = (r[1] as string).replace(/[.,;:]+$/, '')
    }
    if (!f.quoteDate && /^(?:date|dated|quotation\s+date|quote\s+date|pi\s+date)\b/i.test(t)) f.quoteDate = findDate(t, today)?.iso ?? null
    if (!f.validity) {
      const d = VALID_DAYS.exec(t)
      if (d) {
        const unit = (d[2] as string).toLowerCase()
        const mult = unit.startsWith('w') ? 7 : unit.startsWith('m') ? 30 : 1
        f.validity = { text: t, days: Number(d[1]) * mult }
      } else {
        const u = VALID_UNTIL.exec(t)
        const date = u ? findDate(u[1] as string, today) : null
        if (date) f.validity = { text: t, days: Math.max(0, Math.round(utcDays(date.iso) - utcDays(today))) }
      }
    }
    if (!f.leadTime && LEAD_LABEL.test(t) && !/terms/i.test(t)) f.leadTime = parseLeadTime(t)
    if (!f.paymentTerms) {
      const p = PAYMENT.exec(t)
      if (p) f.paymentTerms = (p[1] as string).trim()
    }
    if (!f.incoterm) {
      const i = INCOTERM.exec(t)
      if (i && (/\b(?:price|delivery|terms|basis|incoterm)/i.test(t) || /^(?:EXW|FOB|FCA|CIF|CFR|CNF|CPT|CIP|DAP|DPU|DDP)\b/.test(t))) {
        f.incoterm = [i[1], i[2]].filter(Boolean).join(' ').trim()
      }
    }
    if (f.moq === null && /^(?:moq|min)/i.test(t)) {
      const m = MOQ.exec(t)
      if (m) f.moq = Number((m[1] as string).replace(/,/g, ''))
    }
  }
  return f
}

// ------------------------------------------------------------------------------------------------ main

export function parseSupplierQuote(raw: string, rfqItems: ReplyItemRef[], opts: ParseReplyOptions = {}): SupplierQuoteParse {
  const today = opts.today ?? businessToday()
  // A letterhead copied from a PDF keeps its two columns on one line ("Your Ref: RFQ-118        Currency: USD"): each labelled
  // part is a line of its own, so the quotation's own facts are not dropped with our reference.
  const lines = rebuildCellText(alignSpacedRows(plainQuoteText(raw).split('\n')).join('\n'), t => TOTAL_LABEL.test(t) || BANK.test(t))
    .split('\n')
    // Terms written as a two-column table ("Validity | 30 days"): "Validity: 30 days", a line a term reader knows.
    .map(l => {
      const c = cells(l).filter(Boolean)
      return c.length === 2 && TERM_LABEL.test(c[0] as string) && !/\d{3,}/.test(c[0] as string) ? `${(c[0] as string).replace(/[:\s]+$/, '')}: ${c[1]}` : l
    })
    .flatMap(l => {
      const parts = l.includes('\t') ? [l] : l.trim().split(/\s{4,}/)
      return parts.length === 2 && parts.every(p => /^[A-Za-z][A-Za-z .'/#]{1,30}:/.test(p)) ? parts : [l]
    })
    // The same terms copied one cell per line ("Validity" / "45 days"): label and value on one line again.
    .reduce<string[]>((out, l) => {
      const prev = out[out.length - 1]
      if (prev !== undefined && TERM_LABEL.test(prev.trim()) && l.trim() && !TERM_LABEL.test(l.trim())) out[out.length - 1] = `${prev.trim().replace(/:$/, '')}: ${l.trim()}`
      // A sentence a picture broke before its value ("Offer valid for" / "30 days").
      else if (prev !== undefined && /\b(?:valid\s+(?:for|till|until)|validity\s+of|delivery\s+(?:in|within)|payment\s*:?)\s*$/i.test(prev.trim()) && /^\d[\d\s-]*\s*(?:days?|weeks?|wks?|months?)\b/i.test(l.trim()))
        out[out.length - 1] = `${prev.trim()} ${l.trim()}`
      else out.push(l)
      return out
    }, [])
  const kept: string[] = []
  const dropped: string[] = []
  /** Under a totals label copied one cell per line ("Grand Total" / "53,959.51"): its amount goes with it. */
  let afterTotal = false
  for (const line of lines) {
    const t = line.trim()
    if (!t) {
      kept.push('')
      afterTotal = false
      continue
    }
    if (afterTotal && /^[^A-Za-z]*\d[^A-Za-z]*$/.test(t)) {
      dropped.push(t)
      continue
    }
    // ("VAT 5%" / "4100.50": the rate is part of the label.)
    afterTotal = isTotalRow(t) && !/\d/.test(t.replace(/\d+(?:\.\d+)?\s*%/g, ''))
    const first = cells(t).find(Boolean) ?? ''
    const drop =
      isTotalRow(t) ||
      BANK.test(t) ||
      (CONTACT.test(first) && !/\b(?:price|rate|delivery|lead)\b/i.test(t)) ||
      (QUOTE_REF.test(t) && !/\t/.test(t)) ||
      YOUR_REF.test(t) ||
      /^page\s+\d+/i.test(t)
    if (drop) {
      dropped.push(t)
      continue
    }
    if (TERMS.test(t) && kept[kept.length - 1] !== '') kept.push('')
    kept.push(line.replace(/\s+$/, ''))
  }
  const text = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const reply = parseSupplierReply(text, rfqItems, { ...opts, today })
  const facts = readFacts(lines, today)
  return { ...reply, facts: { ...facts, currency: reply.replyCurrency }, text, dropped }
}
