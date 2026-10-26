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
const OWN_REF = /\b(?:QT-\d{2}-\d{3,5}|QT[A-Z]-[A-Z]+-?\d{2,})\b/
/** A letterhead line starts with our name; a line that only mentions us ("To: Q-Tech", "Buyer: Q-Tech") is the other side. */
const STARTS_OWN = /^\W*q[\s-]?tech\b/i
// A label line above a name ("Supplier", "To") means the name is the addressee, not the issuer.
const ADDRESSEE_LABEL = /^\W*(?:supplier|vendor|to|attn|attention|bill\s+to|ship\s+to|quote\s+to|dear)(?:\s+(?:name|code))?\s*:?\W*$/i
/** Header lines that say nothing about the document (an email's subject, a reference quoted back). */
const NOISE = /^(?:subject|re|fw|fwd)\s*:|your\s+ref/i

/** What asks us for a price (a bare "RFQ" is left out: a company introduction ends "looking forward to your RFQ"). */
const ASK_PHRASE =
  /request\s+for\s+(?:quotation|quote|price|proposal)|\b(?:please|kindly|pls|plz)\s+quote\b|\b(?:please|kindly|pls|plz)\s+(?:provide|send|submit|share|offer|revert|advise)\s+(?:\S+\s+){0,5}?(?:quot\w+|price\w*|pricing|rates?|offer\w*|availab\w*|lead\s*time|delivery)|(?:quotation|quote|price|prices|offer|rates?)\s+(?:required|requested|needed|please)|need\s+(?:price|quote|quotation|rates?)|(?<!\bour\s)(?:best|lowest)\s+(?:price|rates?|offer)|\b(?:enquiry|inquiry)\s+(?:no|ref|number)|purchase\s+(?:requisition|enquiry|inquiry)|invit\w*\s+(?:your\s+)?(?:quotation|quote|offer)s?|chahiye|bhej\s*do|چاہی|درکار|ریٹ|rate\s+(?:bhej|bata|pls|please)|\bye\s+list|\b(?:we\s+)?need\s+(?:the\s+following|\d+\s)|(?<!\bquick\s)(?<!\bhour\s)\bquote\s+(?:for|us|the|these)\b|request(?:ed|ing)?\s+(?:a\s+|for\s+)?(?:your\s+)?(?:quotation|quote|price)|(?:send|share|provide|give|submit)\s+(?:us\s+)?(?:the\s+|your\s+|a\s+)?(?:\w+\s+){0,2}?(?:price|quot\w+|rates?|offer)|for\s+your\s+(?:\w+\s+){0,2}(?:quotation|quote)|urgent\s+quotation|(?:price|prices|quotation|quote|rates?)\s+(?:and|&)\s+(?:availability|delivery|lead)|enclosed\s+(?:please\s+find\s+)?(?:the\s+)?(?:inquiry|enquiry)/gi
const RFQ_PHRASE = new RegExp(`${ASK_PHRASE.source}|${String.raw`\brfq\b`}`, 'gi')
/** A supplier thanking us for the enquiry is not an enquiry. */
const THANKS = /(?:thank|thanks)\s+(?:you\s+)?(?:very\s+much\s+)?for\s+(?:your\s+|the\s+)?(?:enquiry|inquiry|rfq)/gi
const RFQ_DATE = /\b(?:due\s+date|closing\s+date|last\s+date|(?:quotations?|quotes?|offers?|bids?|replies|reply)\s+(?:due|required|must\s+reach)|submit\w*\s+(?:by|before|on)|before\s+\d{1,2}[/.-]\d{1,2})/i
const QTY_HEAD = /\b(?:qty|quantity|req(?:uired)?\.?\s*qty|order\s+qty)\b/i
const DESC_HEAD = /\b(?:description|item|items|product|material|part|particulars|details|sr|s\.?\s?no)\b/i
const QTY_ROW = /\b\d+(?:\.\d+)?\s*(?:nos?\.?|pcs?\.?|pieces?|sets?|units?|each|ea|mtrs?|meters?|kgs?|rolls?|boxes|box|packs?|lots?)\b/i
const PRICE = /(?:\b(?:pkr|usd|us\$|eur|aed|cny|rmb|rs\.?|gbp)\s?[\d,]{2,}(?![\da-z])|[$€£¥￥]\s?[\d,]{2,}|\u20ac\s?\d{1,3}(?:\.\d{3})*,\d{2}\b|\b\d{1,3}(?:\.\d{3})*,\d{2}\s?\u20ac|\d[\d,]*(?:\.\d{1,2})?\s?(?:pkr|usd|eur|aed|cny|rmb)\b)/i
const TOTAL = /^(?:imponibile|totale|sub\s*-?\s*total|grand\s+total|net\s+total|total(?:\s+(?:amount|price|value|incl|excl)\b.*)?$|gst|vat|sales\s+tax|freight)\b/i
/** A supplier's own words: what a quotation says and an enquiry does not. */
/** The strongest of them, counted a second time. */
const QUOTE_STRONG = /please\s+find\s+(?:our|the\s+attached)|\bour\s+(?:offer|quotation|quote)|\bwe\s+(?:can\s+)?offer/gi
const QUOTE_PHRASE =
  /\b(?:our\s+(?:offer|quotation|quote|prices?|rates?)|we\s+(?:can\s+)?offer|offer\s+valid|offer\s*:|price\s+validity|validity|valid\s+(?:for|until|till)|lead\s*time|please\s+find\s+(?:our|the\s+attached)\s+(?:quotation|offer|prices?)|quotation\s+no|offer\s+no|best\s+offer|looking\s+forward\s+to\s+your\s+order|sorry,?\s+we\s+cannot|unable\s+to\s+(?:offer|quote)|incoterm|price\s+term|(?:fob|exw|cif|fca|cfr)\s+[a-z]+|prices?\s*:|rates?\s*:|delivery\s*:\s*\d|(?:rates?|prices?|amounts?)\s+(?:are\s+)?(?:in|exclusive|inclusive)\s+(?:of\s+)?[a-z]{2,}|gst\s*(?:\d+\s*%\s*)?extra|(?:exclusive|inclusive)\s+of\s+(?:\d+\s*%\s*)?(?:gst|vat|tax)|payment\s*:?\s*(?:100%|advance|l\/c|t\/t|30\s+days))|有效期|交货/gi
/** A price column heading ("Unit Price", "Price each"), not an estimate or a target the customer wrote. */
const PRICE_HEAD = /\b(?:unit\s*(?:price|rate|pr\b)|price\s+each|list\s+price|net\s+price|ext\.?\s+price|einzelpreis|prezzo\s+unit\w*|prix\s+unitaire|total\s+(?:price|amount))|\brates?\s*\((?:rs|pkr|usd|eur|aed|cny|rmb)|\bunit\s+(?:usd|eur|pkr|aed|cny|rmb)\b|\bunit\s+rate|[\t|\s]rate[\t|\s]+(?:amount|total|value)\b|\bprice\s+(?:pkr|usd|eur|aed|cny|rmb|rs)\b|^(?:rate|price)\s*(?:\([^)]*\))?$/i
const QUOTE_TITLE = /^\W*(?:price\s+)?(?:quotation|quote|offer|proforma\s+invoice|preventivo|offerta|angebot|cotizaci\w+|报价)\s*(?:$|no\b|number\b|ref\b|#|:|date\b|\/|\d)/i
const PO_HEAD = /^\W*(?:purchase\s+order|work\s+order|sales\s+order|order\s+confirmation|p\.?\s?o\.?\s*(?:no|number|#))/i
const PO_TERM =
  /\b(?:po\s*(?:no|number|date|#)|order\s+(?:no|number|date)|ship\s*to|bill\s*to|delivery\s+(?:address|schedule|location)|payment\s+terms|authori[sz]ed\s+signator\w*|terms\s*(?:&|and)\s*conditions|please\s+(?:supply|deliver|arrange\s+supply|acknowledge|confirm\s+(?:receipt|acceptance))|kindly\s+(?:supply|deliver|acknowledge)|place\s+(?:this|an?)\s+order|order\s+(?:is\s+)?placed)\b/gi
const INVOICE_HEAD = /(?:sales\s+)?tax\s+invoice|commercial\s+invoice|\binvoice\s+(?:no|number|date|#)|\binvoice\s*$/i
const INVOICE_TERM = /\b(?:strn|ntn|gst\s*(?:no|reg|#)|sales\s+tax\s+(?:reg|no|number)|fbr|amount\s+in\s+words|due\s+date|bank\s+(?:details|account)|iban|inclusive\s+of\s+(?:gst|tax)|value\s+excluding)\b/gi
const SPEC = /\b(?:specifications?|data\s*sheet|datasheet|features?|applications?|operating\s+(?:temperature|pressure|voltage|range)|accuracy|output\s+signal|ingress|ip\s?\d\d|dimensions?|weight|supply\s+voltage|ordering\s+(?:code|information)|technical\s+data|catalog(?:ue)?|brochure|certifi\w+|iso\s?\d{4,5}|atex|sil\s?\d|housing|repeatability|response\s+time|rev(?:ision)?\.?\s?\d)\b/gi
/** Electrical and mechanical figures with their units: a datasheet is full of them. */
const UNIT_TOKEN = /\d\s?(?:v(?:ac|dc|a)?|ma|a|w|kw|hz|khz|mhz|ghz|°\s?c|℃|mm|cm|bar|psi|kg|g|mpa|kpa|ip\s?\d\d|db|rpm|nm|ω|ohm|%|μm|µm)(?![a-z])/gi
/** A datasheet or catalogue names itself near the top. */
const SHEET_TITLE = /\b(?:data\s*sheet|tech(?:nical)?\s+data|technical\s+(?:characteristics|specifications?)|product\s+(?:catalogue|catalog|brochure|specification)|catalogue|brochure|company\s+profile)\b/i
const PROFILE =
  /\b(?:company\s+profile|about\s+us|who\s+we\s+are|our\s+(?:mission|vision|values|clients|customers|products|services|story|team|network|certifications)|we\s+(?:are\s+a\s+)?(?:leading|pioneer|provide|specialize|offer)|years\s+of\s+(?:experience|excellence)|established\s+in|since\s+(?:19|20)\d\d|one-?stop|trusted\s+partner|authori[sz]ed\s+(?:distributor|dealer)|head\s+office|branches|headquarters|quality\s+control|global\s+(?:sales|distributors|network)|committed\s+to|customers\s+worldwide|long-?term\s+partner|trade\s+company|distribution\s+and\s+trading|main\s+application\s+fields|our\s+products\s+serve|international\s+certificates|technological\s+innovation)\b/gi
const FOLLOW = /\b(?:any\s+update|status\s+of|follow(?:ing)?[\s-]?up|gentle\s+reminder|reminder|still\s+waiting|did\s+you\s+(?:get|receive)|have\s+you\s+(?:got|received|sent)|kindly\s+update|pending\s+since|awaiting\s+(?:your|the)\s+(?:quotation|reply|response|offer))\b/i

const count = (re: RegExp, s: string) => (s.match(re) ?? []).length
const words = (s: string) => s.split(/\s+/).filter(Boolean).length
const plural = (n: number, w: string) => `${n} ${w}`

// ---- an email is read as its NEWEST message --------------------------------------------------------------------------------
// A supplier's reply carries our enquiry under it, and a forward carries somebody else's mail: the words "please quote" sit in the
// quoted part, so the message is cut at the first quoted-header block and judged on its own wording and sender.

export interface DocKindContext {
  /** The sender, when the caller knows it (an email's From line). */
  from?: string
  subject?: string
  filename?: string
  isPdf?: boolean
}

const HDR_FROM = /^[\s>*]*(?:from|von|de|da|发件人|寄件者)\s*(?:[:：]|\t)/i
const HDR_NEXT = /^[\s>*]*(?:sent|date|subject|importance|gesendet|betreff|inviato|oggetto|enviado|asunto|发送时间|发送|主题|日期)\s*(?:[:：]|\t)/i
const HDR_ANY = /^[\s>*]*(?:from|to|cc|bcc|sent|date|subject|importance|reply-to|von|an|gesendet|betreff|da|a|inviato|oggetto|enviado|para|asunto|发件人|收件人|抄送|发送时间|发送|主题|日期)\s*(?:[:：]|\t)/i
const BANNER = /^[\s>*_-]*(?:begin\s+forwarded\s+message|(?:original|replied|forwarded)\s+message)\b[\s:_-]*$/i
const WROTE = /^(?:on\s.{4,200}wrote|在.{4,160}[写寫]道)\s*[:：]?\s*$/i
const FWD_SUBJECT = /^\s*(?:fw|fwd)\s*:/i
const RE_SUBJECT = /^\s*(?:re|aw|rv|回复|答复)\s*[:：]/i
const RULE_ONLY = /^[\s_=*~-]*$/

interface Boundary {
  at: number
  fwd: boolean
}

function isHeaderBlock(lines: string[], i: number): boolean {
  if (!HDR_FROM.test(lines[i] as string)) return false
  let seen = 0
  for (let j = i + 1; j < lines.length && seen < 8; j++) {
    const l = lines[j] as string
    if (!l.trim()) continue
    seen++
    if (HDR_NEXT.test(l)) return true
  }
  return false
}

function findBoundary(lines: string[]): Boundary | null {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i] as string
    if (BANNER.test(l)) return { at: i, fwd: /forward/i.test(l) }
    if (WROTE.test(l.trim())) return { at: i, fwd: false }
    if (isHeaderBlock(lines, i)) return { at: i, fwd: false }
  }
  return null
}

/** Reads a leading banner and header block; `end` is where the message's own text starts. */
function readHead(lines: string[]): { from?: string; subject?: string; end: number } | null {
  let i = 0
  while (i < lines.length && (BANNER.test(lines[i] as string) || !(lines[i] as string).trim())) i++
  if (i >= lines.length) return null
  const first = lines[i] as string
  if (WROTE.test(first.trim())) return { from: first, end: i + 1 }
  if (!isHeaderBlock(lines, i)) return null
  let from: string | undefined
  let subject: string | undefined
  let n = 0
  let sawSubject = false
  for (; i < lines.length && n < 16; i++, n++) {
    const l = lines[i] as string
    if (!l.trim()) {
      if (sawSubject || n >= 3) break
      continue
    }
    if (HDR_FROM.test(l) && from === undefined) from = l.replace(HDR_FROM, '').trim()
    else if (/^[\s>*]*(?:subject|betreff|oggetto|asunto|主题)\s*(?:[:：]|\t)/i.test(l)) {
      subject = l.replace(/^[\s>*]*\S+\s*(?:[:：]|\t)/, '').trim()
      sawSubject = true
    } else if (!HDR_ANY.test(l) && !/[@;]|mailto/i.test(l)) break
  }
  return { from, subject, end: i }
}

interface Newest {
  from?: string
  subject?: string
  body: string
  /** Something is quoted under the message. */
  thread: boolean
  /** One of the senders quoted under it is us. */
  quotedOwn: boolean
  quoted: string
  /** What we ourselves wrote in the quoted part (empty when nothing quoted is from us). */
  ourQuoted: string
  forwarded: boolean
}

/** The text of the quoted messages that were sent by us, or null when none was. */
function quotedBy(under: string[]): string | null {
  let rest = under
  let found = false
  const texts: string[] = []
  for (let guard = 0; rest.length > 0 && guard < 40; guard++) {
    const head = readHead(rest)
    const afterHead = head ? rest.slice(head.end) : rest.slice(1)
    const b = findBoundary(afterHead)
    const text = (b ? afterHead.slice(0, b.at) : afterHead).join('\n')
    if (head && head.from !== undefined && OWN.test(head.from)) {
      found = true
      texts.push(text)
    }
    rest = b ? afterHead.slice(b.at) : []
  }
  return found ? texts.join('\n') : null
}

function newestMessage(lines: string[], meta: { from?: string; subject?: string }): Newest {
  let from = meta.from
  let subject = meta.subject
  let rest = lines
  let forwarded = false
  for (let depth = 0; ; depth++) {
    const head = readHead(rest)
    if (head) {
      from = head.from ?? from
      subject = head.subject ?? subject
      rest = rest.slice(head.end)
    } else {
      // A forward banner with no header block under it: the forwarded text follows directly.
      let k = 0
      while (k < rest.length && (BANNER.test(rest[k] as string) || !(rest[k] as string).trim())) k++
      if (k > 0 && depth > 0) rest = rest.slice(k)
    }
    const b = findBoundary(rest)
    const bodyLines = (b ? rest.slice(0, b.at) : rest).filter((l, i, a) => !(RULE_ONLY.test(l) && a.slice(i).every(x => RULE_ONLY.test(x))))
    const under = b ? rest.slice(b.at) : []
    const body = bodyLines.join('\n').trim()
    const cover = b !== null && depth < 4 && words(body) <= 30 && (b.fwd || FWD_SUBJECT.test(subject ?? ''))
    if (cover) {
      forwarded = true
      rest = under
      continue
    }
    const ours = quotedBy(under)
    return { from, subject, body, thread: b !== null, quotedOwn: ours !== null, ourQuoted: ours ?? '', quoted: under.join('\n'), forwarded }
  }
}

/** A leading "From:/Subject:" block on a plain paste names the sender and subject; a caller that knows them can pass them as `ctx`. */
export function classifyDoc(raw: string, ctx?: DocKindContext): DocKindResult {
  const text = (raw ?? '').replace(/\r\n?/g, '\n').replace(/[\u00a0\u3000]/g, ' ')
  const m = newestMessage(text.split('\n'), { from: ctx?.from, subject: ctx?.subject })
  const byMail = classifyMail(m)
  if (byMail) return byMail
  let r = classify(m.body)
  if (r.kind === 'unknown' && m.thread) {
    const whole = classify(text)
    if (whole.kind !== 'rfq') r = whole
  }
  // A company profile that arrives as a file is a brochure to the person who reads it.
  return ctx?.isPdf && r.kind === 'marketing' ? { ...r, kind: 'brochure' } : r
}

const done = (kind: DocKind, confidence: number, reasons: string[]): DocKindResult => ({ kind, confidence: Math.min(0.99, Math.round(confidence * 100) / 100), reasons })

/** Wording that declines, holds back or answers an enquiry; with a price or a quotation phrase it is a supplier's reply. */
const REPLY_CUE =
  /\b(?:unfortunately|regret\w*|sorry|apolog\w+|can(?:'|no)?t\s+(?:offer|supply|quote|provide|help|do)|cannot\s+(?:offer|supply|quote|provide|help)|unable\s+to\s+(?:offer|supply|quote|provide|help)|not\s+(?:able\s+to\s+)?(?:offer|supply|quote|available|in\s+stock|have|handle|deal)|(?:do|does)\s*n[o']t\s+(?:have|deal|sell|supply|handle|offer|stock)|out\s+of\s+stock|in\s+stock|no\s+stock|ready\s+stock|discontinued|obsolete|not\s+our\s+(?:line|business)|check(?:ed|ing)\s+(?:with|the|your|for)|give\s+us\s+(?:some\s+)?time|will\s+(?:revert|get\s+back|check)|let\s+me\s+(?:check|confirm)|(?:pls|please)\s+(?:see|check|find|refer)|quotation\s+(?:attached|below|as)|(?:quote|offer|price)s?\s+(?:attached|below|as\s+below)|attached\s+(?:is\s+|are\s+)?(?:the\s+|our\s+)?(?:quotation|quote|offer|price)|lead\s*time|delivery\s+time|moq|ex-?works?|exw|best\s+price|unit\s+price|no\s+(?:price|offer)|not\s+complete|alternat\w+|substitut\w+)\b|有货|现货|报价/gi
/** A customer or colleague chasing, or talking about an order already placed. */
const THREAD_CUE =
  /\b(?:any\s+update|update\??|status|remind\w*|chas\w+|delivery|deliver(?:ed)?|dispatch\w*|received|supplied|replacement|payment|invoice|purchase\s+order|pending|awaiting|still\s+waiting|feedback|follow(?:ing)?[\s-]?up|did\s+you|have\s+you|kindly\s+(?:update|confirm|advise)|costing|as\s+discussed|end\s+user|required\s+(?:cable|length))\b/i
const PROMO_CUE =
  /\b(?:distribut\w+|manufactur\w+|factory|trading|wholesale|stockist|we\s+(?:supply|sell|specializ\w+|provide|have|can\s+supply)|we\s+are\s+(?:a|an)\s+[\w\s-]{0,30}(?:supplier|distributor|manufacturer|company|trader)|our\s+(?:products?|company|services?|advantages?|strengths?|main|strong)|competitive|brand\s+new|wide\s+(?:range|coverage)|one-?stop|cooperat\w+|business\s+partner|introduce|hope\s+(?:this\s+email|to\s+hear)|still\s+in\s+need|heard\s+from\s+you|new\s+arrivals?|hot\s+sale|promotion|discount|catalog\w*|shortages?|cost-?saving|original\s+(?:and|&)\s+(?:new|genuine)|genuine|this\s+is\s+\w+(?:\s+\w+)?\s+from|we\s+distribute|stable\s+supply|inventory|100%\s+original|hard-to-find|strong\s+line|committed\s+to|commited\s+to|reliable\s+(?:supplier|lead)|independent\s+distributor|sourcing)\b/gi
/** Ours: "please find attached our quotation". */
/** A seller inviting us to send them our enquiries ("send me your RFQ"): the other way round from asking us for a price. */
const INVITE = /(?:send|share|forward|email)\s+(?:(?:me|us|you|them|your|any|the|all|those|these|an?)\s+)*(?:current\s+|new\s+|hard-to-find\s+)?(?:rfqs?|inquir\w+|enquir\w+|requirements?|requests?|part\s+numbers?)|your\s+(?:inquiry|enquiry)s?(?:\s+(?:and|&)\s+rfqs?)?|any\s+(?:current\s+)?rfqs?|looking\s+forward\s+to\s+(?:your\s+)?(?:inquir\w+|enquir\w+|rfq)|reply\s+with\s+(?:pn|part)|\bI\s+(?:will|can|shall)\s+(?:provide|send|give|quote|offer|get\s+back)\b[^.!?\n]*[.!?]?|\bif\s+you\s+(?:have|need|are|want|would|can)\b[^.!?\n]*[.!?]?/gi
const OWN_OFFER = /\b(?:please\s+find\s+(?:the\s+)?attached\s+(?:is\s+)?our|our\s+(?:price\s+)?(?:quotation|quote|offer)|our\s+best\s+offer|attached\s+(?:is\s+)?our)\b/i
/** An order already placed or delivered: the thread is a customer's, not a supplier's. */
const ORDER_CUE = /\bpo\s*#|\b(?:p\.o\.|purchase\s+order|order\s+(?:no|number|#)|delivery\s+(?:status|schedule)|supplied|received\s+(?:the\s+)?(?:item|material|goods|sensor)|replacement)\b/i
const ORDER_CUE_G = new RegExp(ORDER_CUE.source, 'gi')
const THANKS_QUOTE = /\bthank(?:s|\s+you)\b[^.\n]{0,40}\b(?:quot\w+|offer|price|reply|revert\w*)\b/i

function classifyMail(m: Newest): DocKindResult | null {
  const hasSender = Boolean(m.from && m.from.trim())
  if (!hasSender && !m.thread) return null
  const body = m.body.replace(THANKS, ' ')
  if (!body.trim() && !m.thread) return null
  const askBody = body.replace(INVITE, ' ')
  const own = hasSender ? OWN.test(m.from as string) : false
  const asks = count(ASK_PHRASE, askBody)
  const reply = count(REPLY_CUE, body)
  const prices = body.split('\n').filter(l => PRICE.test(l)).length
  const offer = reply + Math.min(3, prices) * 2 + count(QUOTE_STRONG, body) * 2 + (THANKS_QUOTE.test(body) ? 1 : 0)
  const promo = count(PROMO_CUE, body)
  const chase = THREAD_CUE.test(body) || THREAD_CUE.test(m.subject ?? '')
  const subjectRe = RE_SUBJECT.test(m.subject ?? '')

  if (own) {
    if (OWN_OFFER.test(body) || (prices >= 2 && !asks)) return done('own-quote', 0.7, ['written by us', 'our quotation wording'])
    if (asks > 0 && !THANKS_QUOTE.test(body) && !subjectRe) return done('own-rfq', 0.7, ['written by us', 'asks for a quotation'])
    if (words(body) > 0 || m.forwarded) return done('follow-up', 0.6, ['written by us', 'no request for a price or quotation from us'])
    return null
  }

  if (m.thread && (m.quotedOwn || subjectRe)) {
    // Somebody answering something we sent: a supplier answering our enquiry, or a customer talking about a quotation or order.
    // What we sent decides it: an enquiry from us means a supplier is answering; a quotation or an answer from us means a customer is.
    const weOffered = OWN_OFFER.test(m.ourQuoted) || /\bpleased\s+to\s+offer\b/i.test(m.ourQuoted)
    const weAsked = count(ASK_PHRASE, m.ourQuoted.replace(INVITE, ' ')) > 0
    const orderThread = ORDER_CUE.test(m.subject ?? '') || count(ORDER_CUE_G, m.quoted) >= 2
    if (asks > 0 && asks >= offer) return null
    if (offer >= 2) return done('supplier-quote', 0.7, ['answers a message we sent', 'prices or a reply to the request'])
    if (weOffered && !weAsked) return done('follow-up', 0.6, ['answers our quotation', 'no prices'])
    if (orderThread) return done('follow-up', 0.6, ['answers us about an order', 'no prices'])
    if (weAsked) return done('supplier-quote', 0.6, ['answers an enquiry we sent'])
    if (chase) return done('follow-up', 0.6, ['answers a message we sent', 'asks about an update, an order or delivery'])
    return done('supplier-quote', 0.5, ['answers a message we sent', 'no new request'])
  }
  if (asks === 0 && promo >= 3 && prices === 0 && !m.thread) return done('marketing', 0.6, ['introduces a company and its products', 'no request for a price'])
  if (asks > 0) return null
  if (offer >= 2) return done('supplier-quote', 0.6, ['prices or a quotation in the message'])
  if (promo >= 2 && (asks === 0 || promo >= 4)) return done('marketing', 0.6, ['introduces a company and its products', 'no request for a price'])
  if (!m.thread && chase && asks === 0 && prices === 0 && words(body) <= 90) return done('follow-up', 0.55, ['a short message asking for an update'])
  return null
}

function classify(text: string): DocKindResult {
  // Table cells are stripped of their rule marks ("| Sub Total | | 9,000 |") so a row reads from its first word.
  const lines = text.split('\n').map(l => l.trim().replace(/^[|\s]+|[|\s]+$/g, '')).filter(Boolean)
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
  const tech = spec + Math.floor(count(UNIT_TOKEN, text) / 2)
  const sheetTitle = lines.slice(0, 6).some(l => l.length < 80 && SHEET_TITLE.test(l))
  const issuer = headBody.some((l, i) => STARTS_OWN.test(l) && l.length < 90 && !(i > 0 && ADDRESSEE_LABEL.test(headBody[i - 1] ?? ''))) || head.some(l => /^from\s*:/i.test(l) && OWN.test(l))
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
  if (ownRef && (priced || priceHead || totals > 0) && !head.some(l => /^\W*(?:request\s+for\s+(?:quotation|quote)|rfq)\b/i.test(l))) return done('own-quote', 0.7, ['our quote number', 'a price column'])
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
    if ((tech >= 6 && (longText || manyRows)) || (manyRows && qtyRows < 3 && !priced) || (tech >= 10 && qtyRows < 3) || (sheetTitle && qtyRows < 3 && tech >= 3)) {
      return done('brochure', 0.55 + Math.min(0.4, 0.03 * spec + (manyRows ? 0.1 : 0) + (longText ? 0.1 : 0)), [plural(spec, 'specification words'), ...(longText ? [plural(prose, 'long sentences')] : []), ...(manyRows ? [plural(dataRows, 'table rows')] : []), 'no quantity column', 'no request for a price'])
    }
  }

  // A supplier's quotation says what it offers at what price; an enquiry that merely quotes an old offer asks for one as well.
  if ((priceLines >= 1 || priceHead || quoteTitle || quotePhrases >= 3 || (totals > 0 && quotePhrases >= 1)) && quoteScore - 2 * rfqHits >= 3) {
    return done('supplier-quote', 0.5 + Math.min(0.45, 0.05 * quoteScore), [plural(priceLines, 'lines with a price'), ...(priceHead ? ['a price column'] : []), ...(quotePhrases ? ['quotation wording'] : []), ...(totals ? ['totals'] : [])])
  }

  if (rfqHits === 0 && qtyRows === 0 && !qtyHead && lines.length <= 12 && words(text) <= 90 && FOLLOW.test(text)) return done('follow-up', 0.7, ['a short message asking for an update', 'no items'])

  if (asks || qtyHead) {
    return done('rfq', 0.5 + Math.min(0.45, 0.1 * rfqHits + (qtyHead ? 0.2 : 0) + (RFQ_DATE.test(body) ? 0.1 : 0) + (qtyRows ? 0.1 : 0)), [...(rfqHits ? [plural(rfqHits, 'request phrases')] : []), ...(qtyHead ? ['a quantity column'] : []), ...(qtyRows ? [plural(qtyRows, 'lines with a quantity')] : [])])
  }
  // A line with a quantity and an amount of money and nothing else ("FM-100 DN50: EUR 1.234 each") is a supplier's one-line price at
  // least as much as an enquiry's line: left undecided, so a pasted reply is not held.
  if (qtyRows > 0 && !asks && !qtyHead && /(?:\b(?:usd|eur|aed|cny|rmb|gbp|pkr)\s?\d|\d\s?(?:usd|eur|aed|cny|rmb|gbp|pkr)\b|[$\u20ac\u00a3\u00a5]\s?\d)/i.test(text)) return done('unknown', 0.3, ['one line with a quantity and an amount'])
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
