// What kind of document a pasted text or a PDF's text is, before anything is read out of it as items or prices. A product
// brochure read as an enquiry gave hundreds of "items"; our own quotation gave its column headings. Pure, no dependencies.
//
// It is deliberately cautious about blocking: a document is only called something other than an enquiry when the evidence is
// clear and nothing says "please quote". The screens warn and always let the person read the document anyway.

export type DocKind = 'rfq' | 'supplier-quote' | 'own-rfq' | 'own-quote' | 'po' | 'invoice' | 'brochure' | 'marketing' | 'follow-up' | 'unknown'

export interface DocKindResult {
  kind: DocKind
  /** 0 to 1. */
  confidence: number
  reasons: string[]
}

/** Our own name (the same words enquiryParse keeps out of the customer). */
const OWN = /q[\s-]?tech/i
/** Our quotation number: "QT-26-0042". */
const OWN_REF = /\bQT-\d{2}-\d{3,5}\b/
/** A letterhead line starts with our name; a line that only mentions us ("To: Q-Tech", "Buyer: Q-Tech") is the other side. */
const STARTS_OWN = /^\W*q[\s-]?tech\b/i
/** Header lines that say nothing about the document (an email's subject, a reference quoted back). */
const NOISE = /^(?:subject|re|fw|fwd)\s*:|your\s+ref/i

const RFQ_PHRASE =
  /request\s+for\s+(?:quotation|quote|price|proposal)|\brfq\b|\b(?:please|kindly|pls|plz)\s+(?:quote|provide|send|submit|share|offer|revert|advise)|(?:quotation|quote|price|prices|offer|rates?)\s+(?:required|requested|needed|please)|need\s+(?:price|quote|quotation|rates?)|(?:best|lowest)\s+(?:price|rates?|offer)|\b(?:enquiry|inquiry)\s+(?:no|ref|number)|purchase\s+(?:requisition|enquiry|inquiry)|invit\w*\s+(?:your\s+)?(?:quotation|quote|offer)s?|chahiye|bhej\s*do|چاہی|درکار|ریٹ|rate\s+(?:bhej|bata|pls|please)|\bye\s+list|\b(?:we\s+)?need\s+(?:the\s+following|\d+\s)|\bquote\s+(?:for|us|the|these)\b/gi
/** A supplier thanking us for the enquiry is not an enquiry. */
const THANKS = /(?:thank|thanks)\s+(?:you\s+)?for\s+(?:your\s+|the\s+)?(?:enquiry|inquiry|rfq)/gi
const RFQ_DATE = /\b(?:due\s+date|closing\s+date|last\s+date|(?:quotations?|quotes?|offers?|bids?|replies|reply)\s+(?:due|required|must\s+reach)|submit\w*\s+(?:by|before|on)|before\s+\d{1,2}[/.-]\d{1,2})/i
const QTY_HEAD = /\b(?:qty|quantity|req(?:uired)?\.?\s*qty|order\s+qty)\b/i
const DESC_HEAD = /\b(?:description|item|items|product|material|part|particulars|details|sr|s\.?\s?no)\b/i
const QTY_ROW = /\b\d+(?:\.\d+)?\s*(?:nos?\.?|pcs?\.?|pieces?|sets?|units?|each|ea|mtrs?|meters?|kgs?|rolls?|boxes|box|packs?|lots?)\b/i
const PRICE = /(?:\b(?:pkr|usd|us\$|eur|aed|cny|rmb|rs\.?|gbp)\s?[\d,]{2,}|[$€£¥￥]\s?[\d,]{2,}|\d[\d,]*(?:\.\d{1,2})?\s?(?:pkr|usd|eur|aed|cny|rmb)\b)/i
const TOTAL = /^(?:sub\s*-?\s*total|grand\s+total|net\s+total|total(?:\s+(?:amount|price|value|incl|excl)\b.*)?$|gst|vat|sales\s+tax|freight)\b/i
/** A supplier's own words: what a quotation says and an enquiry does not. */
/** The strongest of them, counted a second time. */
const QUOTE_STRONG = /please\s+find\s+(?:our|the\s+attached)|our\s+(?:offer|quotation|quote)|we\s+(?:can\s+)?offer/gi
const QUOTE_PHRASE =
  /\b(?:our\s+(?:offer|quotation|quote|prices?|rates?)|we\s+(?:can\s+)?offer|offer\s+valid|offer\s*:|price\s+validity|validity|valid\s+(?:for|until|till)|lead\s*time|please\s+find\s+(?:our|the\s+attached)\s+(?:quotation|offer|prices?)|quotation\s+no|offer\s+no|best\s+offer|looking\s+forward\s+to\s+your\s+order|sorry,?\s+we\s+cannot|unable\s+to\s+(?:offer|quote)|incoterm|price\s+term|(?:fob|exw|cif|fca|cfr)\s+[a-z]+|prices?\s*:|rates?\s*:|delivery\s*:\s*\d|(?:rates?|prices?|amounts?)\s+(?:are\s+)?(?:in|exclusive|inclusive)\s+(?:of\s+)?[a-z]{2,}|gst\s*(?:\d+\s*%\s*)?extra|(?:exclusive|inclusive)\s+of\s+(?:\d+\s*%\s*)?(?:gst|vat|tax)|payment\s*:?\s*(?:100%|advance|l\/c|t\/t|30\s+days))|有效期|交货/gi
/** A price column heading ("Unit Price", "Price each"), not an estimate or a target the customer wrote. */
const PRICE_HEAD = /\b(?:unit\s*(?:price|rate|pr\b)|price\s+each|list\s+price|net\s+price|ext\.?\s+price|einzelpreis|total\s+(?:price|amount))|\brates?\s*\((?:rs|pkr|usd|eur|aed|cny|rmb)|\bunit\s+(?:usd|eur|pkr|aed|cny|rmb)\b|\bunit\s+rate|[\t|\s]rate[\t|\s]+(?:amount|total|value)\b|\bprice\s+(?:pkr|usd|eur|aed|cny|rmb|rs)\b|^(?:rate|price)\s*(?:\([^)]*\))?$/i
const QUOTE_TITLE = /^\W*(?:price\s+)?(?:quotation|quote|offer|proforma\s+invoice|preventivo|offerta|angebot|cotizaci\w+|报价)\s*(?:$|no\b|number\b|ref\b|#|:|date\b|\/|\d)/i
const PO_HEAD = /^\W*(?:purchase\s+order|work\s+order|sales\s+order|order\s+confirmation|p\.?\s?o\.?\s*(?:no|number|#))/i
const PO_TERM =
  /\b(?:po\s*(?:no|number|date|#)|order\s+(?:no|number|date)|ship\s*to|bill\s*to|delivery\s+(?:address|schedule|location)|payment\s+terms|authori[sz]ed\s+signator\w*|terms\s*(?:&|and)\s*conditions|please\s+(?:supply|deliver|arrange\s+supply|acknowledge|confirm\s+(?:receipt|acceptance))|kindly\s+(?:supply|deliver|acknowledge)|place\s+(?:this|an?)\s+order|order\s+(?:is\s+)?placed)\b/gi
const INVOICE_HEAD = /(?:sales\s+)?tax\s+invoice|commercial\s+invoice|\binvoice\s+(?:no|number|date|#)|\binvoice\s*$/i
const INVOICE_TERM = /\b(?:strn|ntn|gst\s*(?:no|reg|#)|sales\s+tax\s+(?:reg|no|number)|fbr|amount\s+in\s+words|due\s+date|bank\s+(?:details|account)|iban|inclusive\s+of\s+(?:gst|tax)|value\s+excluding)\b/gi
const SPEC = /\b(?:specifications?|data\s*sheet|datasheet|features?|applications?|operating\s+(?:temperature|pressure|voltage|range)|accuracy|output\s+signal|ingress|ip\s?\d\d|dimensions?|weight|supply\s+voltage|ordering\s+(?:code|information)|technical\s+data|catalog(?:ue)?|brochure|certifi\w+|iso\s?\d{4,5}|atex|sil\s?\d|housing|repeatability|response\s+time|rev(?:ision)?\.?\s?\d)\b/gi
const PROFILE =
  /\b(?:company\s+profile|about\s+us|who\s+we\s+are|our\s+(?:mission|vision|values|clients|customers|products|services|story|team|network|certifications)|we\s+(?:are\s+a\s+)?(?:leading|pioneer|provide|specialize|offer)|years\s+of\s+(?:experience|excellence)|established\s+in|since\s+(?:19|20)\d\d|one-?stop|trusted\s+partner|authori[sz]ed\s+(?:distributor|dealer)|head\s+office|branches)\b/gi
const FOLLOW = /\b(?:any\s+update|status\s+of|follow(?:ing)?[\s-]?up|gentle\s+reminder|reminder|still\s+waiting|did\s+you\s+(?:get|receive)|have\s+you\s+(?:got|received|sent)|kindly\s+update|pending\s+since|awaiting\s+(?:your|the)\s+(?:quotation|reply|response|offer))\b/i

const count = (re: RegExp, s: string) => (s.match(re) ?? []).length
const words = (s: string) => s.split(/\s+/).filter(Boolean).length
const plural = (n: number, w: string) => `${n} ${w}`

const REPLY_SEP = /^(?:-{2,}\s*original\s+message\s*-{2,}|_{5,}|-{5,}|on\s.{4,160}\swrote:?)$/i

/** The message itself, without an older thread quoted under it (an old quotation of ours under a customer's enquiry). */
function withoutThread(text: string): string {
  const lines = text.split('\n')
  const seen: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const l = (lines[i] as string).trim()
    if (!l) continue
    seen.push(l)
    const next = lines.slice(i + 1, i + 4).join('\n')
    if (seen.length > 4 && (REPLY_SEP.test(l) || (/^from\s*:/i.test(l) && /^(?:sent|date)\s*:/im.test(next)))) return lines.slice(0, i).join('\n')
  }
  return text
}

export function classifyDoc(raw: string): DocKindResult {
  const text = (raw ?? '').replace(/\r\n?/g, '\n').replace(/[\u00a0\u3000]/g, ' ')
  const top = withoutThread(text)
  const r = classify(top)
  return top !== text && r.kind === 'unknown' ? classify(text) : r
}

function classify(text: string): DocKindResult {
  // Table cells are stripped of their rule marks ("| Sub Total | | 9,000 |") so a row reads from its first word.
  const lines = text.split('\n').map(l => l.trim().replace(/^[|\s]+|[|\s]+$/g, '')).filter(Boolean)
  const done = (kind: DocKind, confidence: number, reasons: string[]): DocKindResult => ({ kind, confidence: Math.min(0.99, Math.round(confidence * 100) / 100), reasons })
  if (lines.length === 0) return done('unknown', 0, ['nothing to read'])
  const thanks = count(THANKS, text)
  const body = lines.filter(l => !NOISE.test(l)).join('\n').replace(THANKS, ' ')
  const head = lines.slice(0, 12)
  const headBody = head.filter(l => !NOISE.test(l))
  const rfqHits = count(RFQ_PHRASE, body)
  const colHead = (re: RegExp) => lines.slice(0, 60).some(l => l.length <= 40 && re.test(l))
  const qtyHead = lines.some(l => QTY_HEAD.test(l) && DESC_HEAD.test(l) && l.split(/\t|\s{2,}|\|/).length >= 3) || (colHead(QTY_HEAD) && colHead(DESC_HEAD))
  const qtyRows = lines.filter(l => QTY_ROW.test(l)).length
  const priceLines = lines.filter(l => PRICE.test(l)).length
  const totals = lines.filter(l => TOTAL.test(l)).length
  const prose = lines.filter(l => words(l) >= 14 && /[.;]$/.test(l)).length
  const dataRows = lines.filter(l => /\d/.test(l) && /\t|\s{3,}|\|/.test(l)).length
  const spec = count(SPEC, text)
  const profile = count(PROFILE, text)
  const issuer = headBody.some(l => STARTS_OWN.test(l) && l.length < 90) || head.some(l => /^from\s*:/i.test(l) && OWN.test(l))
  const ownRef = OWN_REF.test(headBody.join('\n'))
  const quoteTitle = head.some(l => l.length < 70 && QUOTE_TITLE.test(l))
  const priced = priceLines >= 2 || (priceLines >= 1 && totals >= 1)
  const quotePhrases = count(QUOTE_PHRASE, body) + count(QUOTE_STRONG, body)
  const priceHead = lines.some(l => l.length < 220 && PRICE_HEAD.test(l) && !/\b(?:estimated|target|budget|expected)\b/i.test(l))
  // How much it reads like a supplier's quotation: prices, a price column, the supplier's own words, a title.
  const quoteScore = (priceLines >= 1 ? Math.min(4, priceLines + 1) : 0) + (priceHead ? 3 : 0) + Math.min(3, quotePhrases) + (quoteTitle ? 2 : 0) + (totals > 0 ? 1 : 0) + (thanks > 0 ? 2 : 0)
  const asks = rfqHits > 0 || RFQ_DATE.test(body)

  // Our own paper first: it is the one that never has a customer's items in it.
  if ((issuer || ownRef) && quoteTitle && (priced || totals > 0 || priceHead)) return done('own-quote', 0.7 + (issuer && ownRef ? 0.2 : 0.1), ['our name or quote number at the top', 'titled quotation, with prices'])
  if (issuer && ownRef && priced && rfqHits === 0) return done('own-quote', 0.8, ['our quote number and name', 'prices'])
  if (issuer && rfqHits > 0 && !priced && qtyRows + (qtyHead ? 1 : 0) > 0 && head.some(l => /^\W*(?:request\s+for\s+(?:quotation|quote)|rfq)\b/i.test(l))) return done('own-rfq', 0.75, ['our name at the top', 'request for quotation written by us'])

  if (rfqHits === 0) {
    const poHead = head.some(l => PO_HEAD.test(l))
    const poTerms = count(PO_TERM, text)
    if (poHead && poTerms + totals >= 2) return done('po', 0.7 + Math.min(0.25, 0.05 * (poTerms + totals)), ['titled purchase order', plural(poTerms, 'order terms'), ...(totals ? ['totals'] : [])])
    if (!poHead && poTerms >= 5 && priced) return done('po', 0.6, [plural(poTerms, 'order terms'), 'prices'])
    const invHead = head.some(l => INVOICE_HEAD.test(l) && !/proforma/i.test(l))
    const invTerms = count(INVOICE_TERM, text)
    if (invHead && invTerms >= 2) return done('invoice', 0.7 + Math.min(0.25, 0.05 * invTerms), ['titled tax invoice', plural(invTerms, 'tax fields')])
    if (invTerms >= 4 && /\binvoice\b/i.test(text) && !/proforma/i.test(text)) return done('invoice', 0.6, [plural(invTerms, 'tax fields'), 'the word invoice'])
  }

  // No question asked of us, no quantity column: a catalogue page, a datasheet or a profile.
  if (!asks && !qtyHead) {
    const manyRows = dataRows > 40
    const longText = prose >= 3 || (lines.length >= 25 && prose >= 2)
    if (profile >= 3 && profile >= spec / 2) return done('marketing', 0.6 + Math.min(0.3, 0.05 * profile), [plural(profile, 'company-profile phrases'), 'no quantity column', 'no request for a price'])
    if ((spec >= 6 && (longText || manyRows)) || (manyRows && qtyRows < 3 && !priced) || (spec >= 10 && qtyRows < 3)) {
      return done('brochure', 0.55 + Math.min(0.4, 0.03 * spec + (manyRows ? 0.1 : 0) + (longText ? 0.1 : 0)), [plural(spec, 'specification words'), ...(longText ? [plural(prose, 'long sentences')] : []), ...(manyRows ? [plural(dataRows, 'table rows')] : []), 'no quantity column', 'no request for a price'])
    }
  }

  // A supplier's quotation says what it offers at what price; an enquiry that merely quotes an old offer asks for one as well.
  if ((priceLines >= 1 || priceHead || quoteTitle || quotePhrases >= 3 || (totals > 0 && quotePhrases >= 1)) && quoteScore - 2 * rfqHits >= 3) {
    return done('supplier-quote', 0.5 + Math.min(0.45, 0.05 * quoteScore), [plural(priceLines, 'lines with a price'), ...(priceHead ? ['a price column'] : []), ...(quotePhrases ? ['quotation wording'] : []), ...(totals ? ['totals'] : [])])
  }

  if (qtyRows === 0 && !qtyHead && lines.length <= 12 && words(text) <= 90 && FOLLOW.test(text)) return done('follow-up', 0.7, ['a short message asking for an update', 'no items'])

  if (asks || qtyHead) {
    return done('rfq', 0.5 + Math.min(0.45, 0.1 * rfqHits + (qtyHead ? 0.2 : 0) + (RFQ_DATE.test(body) ? 0.1 : 0) + (qtyRows ? 0.1 : 0)), [...(rfqHits ? [plural(rfqHits, 'request phrases')] : []), ...(qtyHead ? ['a quantity column'] : []), ...(qtyRows ? [plural(qtyRows, 'lines with a quantity')] : [])])
  }
  if (qtyRows > 0) return done('rfq', 0.4, [plural(qtyRows, 'lines with a quantity')])
  return done('unknown', 0.2, ['nothing that settles it'])
}

/** Kinds the screens warn about before reading a document as an enquiry; `rfq` and `unknown` pass. Nothing is ever dropped: the person can read it anyway. */
export const NOT_AN_ENQUIRY: readonly DocKind[] = ['own-rfq', 'own-quote', 'po', 'invoice', 'brochure', 'marketing', 'follow-up', 'supplier-quote']
/** Kinds SupplierReplies warns about before reading a document as a supplier's quotation. */
export const NOT_A_SUPPLIER_QUOTE: readonly DocKind[] = ['rfq', 'own-rfq', 'own-quote', 'po', 'invoice']

export const KIND_LABEL: Record<DocKind, string> = {
  rfq: 'an enquiry',
  'supplier-quote': "a supplier's quotation",
  'own-rfq': 'your own request for quotation',
  'own-quote': 'your own quotation',
  po: 'a purchase order',
  invoice: 'a tax invoice',
  brochure: 'a product brochure or datasheet',
  marketing: 'a company profile',
  'follow-up': 'a follow-up message',
  unknown: 'a document',
}
