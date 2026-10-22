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

import { parseLeadTime, parseSupplierReply, splitSentences, stripQuotedReply, normaliseCurrency, type LeadTime, type ParsedReply, type ParseReplyOptions, type ReplyCurrency, type ReplyItemRef } from '@/features/rfqs/lib/replyParse'
import { businessToday } from '@/lib/dates'
import { alignSpacedRows, foldWrappedTables, rebuildCellText } from './cellTable'
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

// Labels and units of the languages quotations come in, written in English so the one reader below sees them. Only whole labels
// are turned (a heading, a field name, the unit after a number): item names and a payment sentence are left as written.
const LABELS: Array<[RegExp, string]> = [
  // Chinese
  [/报价单号|报价单编号|报价编号|报价号/g, 'Quotation No. '],
  [/报价日期|报价单日期|(?<=^|[\s,])日期(?=\s*:)/gm, 'Date '],
  [/\b(?:data|datum)(?=\s*:)/gi, 'Date'],
  [/币种|货币/g, 'Currency '],
  [/付款方式|付款条款|付款条件|支付方式|结算方式/g, 'Payment terms '],
  [/贸易条款|贸易术语|价格条款|交货方式/g, 'Delivery terms '],
  [/小计/g, 'Subtotal '],
  [/总价|合计|总计|价税合计/g, 'Total '],
  [/运费/g, 'Freight '],
  [/增值税|税额/g, 'VAT '],
  [/大写/g, 'In words '],
  [/备注/g, 'Remarks: '],
  [/序号/g, 'No '],
  [/产品名称|货物名称|品名|名称/g, 'Description '],
  [/规格型号|型号规格|规格|型号/g, 'Model '],
  [/数量/g, 'Qty '],
  [/产地/g, 'Origin '],
  [/品牌/g, 'Brand '],
  [/金额/g, 'Amount '],
  [/价格/g, 'Price '],
  [/人民币/g, 'RMB '],
  [/美元|美金/g, 'USD '],
  [/欧元/g, 'EUR '],
  [/现货供应/g, 'ex-stock'],
  // Italian
  [/\b(?:preventivo|offerta|offerta\s+commerciale)\s*(?:n\.?|nr\.?|n°|num\.?|numero)\s*[:.]?\s*/gi, 'Quotation No. '],
  [/\bofferta\s+valida\s+fino\s+al\b/gi, 'Valid until'],
  [/\bofferta\s+valida\s+per\b/gi, 'Offer valid for'],
  [/\bvalidit[àa]\s*(?:offerta|preventivo)?/gi, 'Validity'],
  [/\b(?:condizioni|modalit[àa])\s+di\s+pagamento\b|\bpagamento\b/gi, 'Payment terms'],
  [/\b(?:condizioni\s+di\s+)?resa(?=\s*[:\t])/gi, 'Delivery terms'],
  [/\bfranco\s+fabbrica\b/gi, 'EXW'],
  [/\bpronta\s+consegna\b|\b(?:disponibile\s+)?(?:a|da)\s+magazzino\b/gi, 'ex-stock'],
  [/\b(?:termini|tempi|termine)\s+di\s+consegna\b|\bconsegna\b/gi, 'Delivery'],
  [/\bcodice\s+articolo\b|\bcod\.?\s*art\.?|\bcodice\b/gi, 'Part No'],
  [/\bdescrizione(?:\s+articolo)?\b/gi, 'Description'],
  [/\bq\.?t[àa]\.?(?=\s|$)|\bqta\b|\bquantit[àa]\b/gi, 'Qty'],
  [/\bprezzo\s+(?:unitario|unit\.?|un\.?)|\bprz\.?\s*unit\.?/gi, 'Unit price'],
  [/\bprezzo\s+totale\b|\btotale\s+riga\b|\bimporto\b/gi, 'Amount'],
  [/\bprezzo\b/gi, 'Price'],
  [/\b(?:totale\s+imponibile|imponibile|totale\s+netto)\b/gi, 'Subtotal'],
  [/\btotale\b/gi, 'Total'],
  [/(?<=^|\t)[ ]*(?:spese\s+di\s+)?(?:trasporto|spedizione|imballo)\b/gim, 'Freight'],
  [/\bsconto\b/gi, 'Discount'],
  [/(?<!p\.\s?)\biva\b/gi, 'VAT'],
  [/\borigine\b|\bpaese\s+d['’]origine\b/gi, 'Origin'],
  [/\bu\.?m\.?(?=\s*(?:\t|$))/gi, 'Unit'],
  [/\bpz\.?(?=\s|$)|\bpezzi\b/gi, 'pcs'],
  // German
  [/\bangebot(?:s)?\s*(?:nr\.?|nummer|no\.?)\s*[:.]?\s*/gi, 'Quotation No. '],
  [/\bg[üu]ltigkeit\b/gi, 'Validity'],
  [/\bzahlungsbedingungen\b|\bzahlungskonditionen\b/gi, 'Payment terms'],
  [/\blieferbedingungen\b|\blieferkonditionen\b/gi, 'Delivery terms'],
  [/\blieferzeit\b|\blieferfrist\b|\blieferung\b/gi, 'Delivery'],
  [/\bab\s+werk\b/gi, 'EXW'],
  [/\bab\s+lager\b|\bsofort\s+lieferbar\b/gi, 'ex-stock'],
  [/\bbezeichnung\b|\bbeschreibung\b/gi, 'Description'],
  [/\bmenge\b|\banzahl\b/gi, 'Qty'],
  [/\bst(?:ü|u)ckpreis\b/gi, 'Unit price'],
  [/\bsumme\b|\bgesamtbetrag\b/gi, 'Total'],
  // French
  [/\b(?:devis|offre)\s*(?:n°|no\.?|num(?:[ée]ro)?)\s*[:.]?\s*/gi, 'Quotation No. '],
  [/\bvalidit[ée]\b/gi, 'Validity'],
  [/\bconditions\s+de\s+(?:paiement|r[èe]glement)\b/gi, 'Payment terms'],
  [/\bd[ée]lai\s+de\s+livraison\b|\blivraison\b/gi, 'Delivery'],
  [/\bd[ée]part\s+usine\b/gi, 'EXW'],
  [/\bd[ée]signation\b/gi, 'Description'],
  [/\bquantit[ée]\b|\bqt[ée]\b/gi, 'Qty'],
  [/\bprix\s+unit(?:aire|\.)?/gi, 'Unit price'],
  [/\bmontant\b/gi, 'Amount'],
]

// The number, alone (not the tail of a part number such as 6ES7197-3GG87), then the unit.
const NUM = String.raw`((?<![A-Za-z0-9/.-])\d+(?:[.,]\d+)?(?:[ ]*-[ ]*\d+(?:[.,]\d+)?)?)[ ]*`
/** Only the payment label: payment terms are read in the supplier's own words, so nothing else in the line is turned. */
const PAYMENT_LABELS: Array<[RegExp, string]> = [
  [/付款方式|付款条款|付款条件|支付方式|结算方式/g, 'Payment terms '],
  [/\b(?:condizioni|modalit[àa])\s+di\s+pagamento\b|\bpagamento\b/gi, 'Payment terms'],
  [/\bzahlungsbedingungen\b|\bzahlungskonditionen\b/gi, 'Payment terms'],
  [/\bconditions\s+de\s+(?:paiement|r[èe]glement)\b/gi, 'Payment terms'],
]

const AFTER_NUMBER: Array<[RegExp, string]> = [
  [new RegExp(NUM + String.raw`(?:giorni\s+lavorativi|giorni\s+lav\.?|jours?\s+ouvr[ée]s?|werktage?n?|arbeitstage?n?)(?![A-Za-z0-9])`, 'gi'), '$1 working days'],
  [new RegExp(NUM + String.raw`(?:settimane|settimana|sett\.|semaines?|wochen|woche)(?![A-Za-z0-9])`, 'gi'), '$1 weeks'],
  [new RegExp(NUM + String.raw`(?:giorni|giorno|gg|jours?|tage|tagen|tag)(?![A-Za-z0-9])`, 'gi'), '$1 days'],
  [new RegExp(NUM + String.raw`(?:mesi|mese|mois|monate|monaten|monat)(?![A-Za-z0-9])`, 'gi'), '$1 months'],
]

/** Full-width forms, Chinese, Italian, German and French labels and units to plain English ("￥" is kept: it is read as yuan). */
export function plainQuoteText(raw: string, units: boolean | 'payment' = true): string {
  let s = (raw ?? '')
    .replace(/\r\n?/g, '\n')
    // No-break and ideographic spaces and the other odd ones (tabs and line ends stay).
    .replace(/[^\S\n\t\r]/g, ' ')
    .replace(/：/g, ': ')
    .replace(/，/g, ', ')
    .replace(/（/g, ' (')
    .replace(/）/g, ') ')
    .replace(/．/g, '.')
    .replace(/[～〜]/g, '-')
    .replace(/。/g, '. ')
    .replace(/、/g, ', ')
    // Every other full-width letter, digit and sign ("ＵＳＤ", "５０", "％", "－") is the plain one.
    .replace(/[！-～]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/￡/g, '£')
    // A word the picture reader broke at its dash ("ex- stock").
    .replace(/\bex-\s+stock\b/gi, 'ex-stock')
  // Units after a number ("4 settimane" is "4 weeks"). With units off the wording is left as the supplier wrote it (payment terms).
  if (units === true) for (const [re, to] of AFTER_NUMBER) s = s.replace(re, to)
  s = s
    .replace(/(\d)[ ]*个?工作日/g, '$1 working days')
    .replace(/(\d)[ ]*天/g, '$1 days')
    .replace(/(\d)[ ]*(?:个)?(?:星期|周)/g, '$1 weeks')
    .replace(/(\d)[ ]*个月/g, '$1 months')
    .replace(/(\d)[ ]*(?:个|件|只|台|套)(?![一-鿿])/g, '$1 pcs')
    .replace(/\/[ ]*(?:个|件|只|台|套)(?![A-Za-z一-鿿])/g, '/pc')
    .replace(/单价/g, 'Unit price ')
    .replace(/交货期|交期|货期/g, 'Delivery ')
    .replace(/(?:报价)?有效期|报价有效/g, 'Validity ')
    .replace(/最小起订量|起订量/g, 'MOQ ')
    // Chinese regrets, as the reply reader knows them.
    .replace(/已?停产|停止生产|不再生产|被淘汰|已淘汰/g, ' discontinued ')
  for (const [re, to] of units === 'payment' ? PAYMENT_LABELS : LABELS) s = s.replace(re, to)
  return s
}

const TOTAL_LABEL =
  /^(?:sub\s*-?\s*total|total(?:\s+(?:amount|value|price))?|grand\s+total|net\s+(?:total|amount)|vat|gst|sales\s+tax|tax|freight|shipping(?:\s+cost)?|discount|packing|insurance|bank\s+charges|round(?:ing)?\s*off|amount\s+in\s+words|in\s+words|say\s*:|total\s+in\s+words)\b/i
const BANK = /\b(?:banca|bonifico\s+su|coordinate\s+bancarie|bankverbindung|iban|swift|bic|account\s*(?:no\.?|number|title|name)|a\/c\s*(?:no|title)|beneficiary|bank\s*(?:name|address|details|account)|branch\s*code|routing|sort\s*code)\b/i
const CONTACT = /^(?:tel|ph|phone|fax|mob|mobile|cell|email|e-mail|web|website|www\.|add(?:ress)?|attn|attention|to|from|cc|sent|subject|date|dated)\b\.?\s*[:.]?/i
const REF_TOKEN = String.raw`[A-Z0-9][A-Z0-9/_.-]*\d[A-Z0-9/_.-]*`
// "Quotation No. Q-118", "Our ref: Q-118", "Quote: SH/2026/118". The customer's own reference ("Your ref") is never the quote's.
const QUOTE_REF = new RegExp(
  String.raw`(?<!\b(?:your|ur|vs|ihre)\s)\b(?:(?:quotation|quote|offer|proforma(?:\s+invoice)?|p\.?\s?i\.?|invoice|ref(?:erence)?)\s*(?:no\.?|number|#)\s*[:.#-]?\s*(${REF_TOKEN})|(?:our|quote|quotation|offer|proforma)\s+ref(?:erence)?\s*(?:[:#.-]|\bis\b)\s*(${REF_TOKEN})|(?:quotation|quote|offer)\s*[:#]\s*((?=[A-Z0-9/_.-]*[A-Z/_-])${REF_TOKEN}))`,
  'i',
)
const YOUR_REF = /^(?:(?:your|ur|vs\.?|ihre|votre|vostra)\s+(?:ref|rfq|enquiry|inquiry|rif|richiesta|anfrage|demande)\b|rif\.?\s*(?:vs|vostr))/i
/** Address, tax-number and company-register lines of a letterhead: not offers. */
const LETTERHEAD = /^(?:spett\.?le|egr\.?|alla\s+c\.?a\.?|via|viale|piazza|corso|strada|sede|cell|pec|p\.?\s?iva|c\.?f\.?|cod(?:ice)?\.?\s*fisc|partita\s+iva|vat\s*(?:no|id|number|reg)|ust-?id|siret|capitale\s+sociale|reg\.?\s*imprese|iscr)\b/i
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

const VALID_DAYS = /\bvalid(?:ity)?\b[^0-9\n]{0,32}?(\d{1,3})\s*(days?|weeks?|months?)\b/i
const VALID_UNTIL = /\bvalid(?:ity)?\b[^\n]{0,25}?\b(?:till|until|upto|up\s+to|through|to)\b\s*:?\s*(.{4,30})$/i
const PAYMENT = /^(?:payment(?:\s+terms?)?|terms\s+of\s+payment)\s*[:=-]?\s*(.+)$/i
/** Payment terms inside a sentence: "..., payment terms are 50% advance". */
const PAYMENT_INLINE = /(?:^|[.;,]\s+)(?:payment(?:\s+terms?)?|terms\s+of\s+payment)\s*(?:[:=-]|\bis\b|\bare\b|\bwill\s+be\b|\bto\s+be\b)\s*([^\n]+?)\s*$/i
const INCOTERM = /\b(EXW|FOB|FCA|CIF|CFR|CNF|CPT|CIP|DAP|DPU|DDP|[Ee]x[\s-]?[Ww]orks)\b(?:\s*[,:-]?\s*([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?))?/
const MOQ = /\b(?:moq|min(?:imum)?\.?\s*order(?:\s*(?:qty|quantity))?)\s*[:=-]?\s*(\d[\d,]*)/i
const LEAD_LABEL = /^(?:delivery(?:\s+(?:time|period))?|lead\s*time|shipment|dispatch|ready\s+in|eta)\b/i
/** A lead time written in a sentence: "..., delivery 4 weeks", "lead time is 6-8 weeks". */
const LEAD_INLINE = /\b(?:delivery|lead\s*time|dispatch|shipment)\b(?!\s*terms)/i

const utcDays = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000
}

const cleanPayment = (s: string) => s.trim().replace(/^(?:is|are|will\s+be|to\s+be)\s+/i, '').replace(/[.]+$/, '')

function readFacts(lines: string[], today: string): Omit<QuoteFacts, 'currency'> {
  const f: Omit<QuoteFacts, 'currency'> = { quoteRef: null, quoteDate: null, validity: null, leadTime: null, paymentTerms: null, incoterm: null, moq: null }
  // A paragraph is read a sentence at a time ("... Prices valid 30 days. Our quote ref is SQ-8841.").
  for (const line of lines.flatMap(l => splitSentences(l))) {
    const t = line.replace(/\t+/g, ' ').trim()
    if (!t) continue
    if (!f.quoteRef && !YOUR_REF.test(t)) {
      const r = QUOTE_REF.exec(t)
      if (r) f.quoteRef = (r[1] ?? r[2] ?? r[3] ?? '').replace(/[.,;:]+$/, '') || null
    }
    // A reference printed beside the date, over the table: "2026/10/8   WQ20260031".
    if (!f.quoteRef) {
      const bare = /^(?:\d{4}[/.-]\d{1,2}[/.-]\d{1,2}|\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4})\s+([A-Z]{1,4}-?\d{6,}[A-Z0-9-]*)$/.exec(t)
      if (bare) {
        f.quoteRef = bare[1] as string
        f.quoteDate ??= findDate(t, today)?.iso ?? null
      }
    }
    if (!f.quoteDate && /^(?:date|dated|quotation\s+date|quote\s+date|pi\s+date)\b/i.test(t)) f.quoteDate = findDate(t, today)?.iso ?? null
    // "Quotation No. Q-118 dated 12 Oct 2026"
    if (!f.quoteDate && !YOUR_REF.test(t)) {
      const dd = /\bdated?\s*[:.]?\s*(\S.{3,30})$/i.exec(t)
      if (dd) f.quoteDate = findDate(dd[1] as string, today)?.iso ?? null
    }
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
    if (!f.leadTime) {
      const li = LEAD_INLINE.exec(t)
      if (li) f.leadTime = parseLeadTime(t.slice(li.index + li[0].length))
    }
    if (!f.paymentTerms) {
      const p = PAYMENT.exec(t) ?? PAYMENT_INLINE.exec(t)
      if (p) f.paymentTerms = cleanPayment(p[1] as string)
    }
    if (!f.incoterm) {
      const i = INCOTERM.exec(t)
      if (i && (/\b(?:price|delivery|terms|basis|incoterm|each|per\s+(?:pc|piece|unit)|offer|quote)/i.test(t) || /\(\s*(?:EXW|FOB|FCA|CIF|CFR|CNF|CPT|CIP|DAP|DPU|DDP)\s*\)/.test(t) || /^(?:EXW|FOB|FCA|CIF|CFR|CNF|CPT|CIP|DAP|DPU|DDP)\b/.test(t))) {
        f.incoterm = [/^ex/i.test(i[1] ?? '') ? 'EXW' : i[1], i[2]].filter(Boolean).join(' ').trim()
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
  const lines = rebuildCellText(foldWrappedTables(alignSpacedRows(stripQuotedReply(plainQuoteText(raw)).split('\n'))).join('\n'), t => TOTAL_LABEL.test(t) || BANK.test(t))
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
    // A paragraph of sentences: each is kept or dropped on its own ("Our quote ref is SQ-8841." must not take the prices with it).
    .flatMap(l => splitSentences(l))
    // "1. DATE OF SHIPMENT: ...", "2. TERMS OF PAYMENT: ...": a numbered term of the quotation is not item 1 or 2.
    .map(l => l.replace(/^\s*\d{1,2}\s*[.)]\s*(?=(?:date\s+of\s+(?:shipment|delivery)|terms\s+of\s+(?:payment|delivery)|warranty|validity|payment|delivery|shipment|lead\s*time|packing|remarks?|notes?)\b)/i, ''))
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
      (CONTACT.test(first) && !/\b(?:price|rate|delivery|lead|shipment|dispatch|validity|payment)\b/i.test(t)) ||
      LETTERHEAD.test(first) ||
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
  // A quotation whose price lines name no currency often says it only on the totals ("Totale EUR 20.971,80"): the one currency
  // there is the quotation's.
  const onTotals = new Set<ReplyCurrency>()
  for (const d of dropped) {
    if (BANK.test(d)) continue
    for (const m of d.matchAll(/(?<![A-Za-z])(USD|EUR|CNY|RMB|AED|GBP|PKR|€|£|¥|￥|元)(?![A-Za-z])/g)) {
      const c = normaliseCurrency(m[1])
      if (c) onTotals.add(c)
    }
  }
  const named = /\b(?:USD|EUR|CNY|RMB|AED|GBP|PKR)\b|[$€£¥￥元]/.test(text)
  const only = onTotals.size === 1 ? [...onTotals][0] : null
  const reply = parseSupplierReply(only && !named ? `Currency: ${only}\n${text}` : text, rfqItems, { ...opts, today })
  const facts = readFacts(lines, today)
  // Payment terms are the supplier's own wording ("Bonifico bancario 30 gg d.f."): read before units are turned into English.
  for (const l of stripQuotedReply(plainQuoteText(raw, 'payment')).split('\n').flatMap(x => splitSentences(x))) {
    const p = PAYMENT.exec(l.trim()) ?? PAYMENT_INLINE.exec(l.trim())
    if (p) {
      facts.paymentTerms = cleanPayment(p[1] as string)
      break
    }
  }
  // One lead time on every offer that gives one is the quotation's lead time, even when no line of its own states it.
  if (!facts.leadTime) {
    const leads = reply.offers.filter(o => o.unitPrice !== null && o.leadTimeText)
    const first = leads[0]
    if (first && leads.every(o => o.leadTimeText === first.leadTimeText && o.leadTimeDaysMax === first.leadTimeDaysMax)) {
      facts.leadTime = { text: first.leadTimeText ?? '', daysMin: first.leadTimeDaysMin, daysMax: first.leadTimeDaysMax, exStock: first.inStock === true && first.leadTimeDaysMax === 0 }
    }
  }
  return { ...reply, facts: { ...facts, currency: reply.replyCurrency }, text, dropped }
}
