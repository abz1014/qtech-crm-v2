// Template generation 1: written after the reader passed batch 0 and the extra dev batches, first checked on fresh batch 1.
// New shapes (a government tender schedule, a semicolon-specified list, a supplier's rate sheet, a reply written under each
// quoted line) and the edge cases the bug hunt found (a list pasted with leading spaces, Urdu-script quantities and request
// words, decimal quantities). Every name and number is invented.

import type { Block, ChatMsg, ItemTruth, QuoteLineTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)
const decimalQty = (r: Rng, unit: string) => (['m', 'kg', 'l'].includes(unitFamily(unit) ?? '') ? r.pick([0.5, 1.5, 2.5, 12.5, 7.5, 25, 100]) : r.pick([1, 2, 3, 4, 6, 10, 20]))

// ------------------------------------------------------------------------------------------------ enquiries

/** A list pasted from an email client that indents it, some items wrapping onto a further-indented line. */
export const indentedList: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 7))
  const pad = ' '.repeat(r.int(2, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: r.pick(['Dear Sir,', 'Hi,', 'Salam,']) }, { k: 'text', text: 'Please send your rates for:' }, { k: 'gap' }]
  for (const p of ps) {
    const unit = unitFor(r, p, r.pick(['title', 'lower']))
    const qty = decimalQty(r, unit)
    const q = String(qty)
    if (r.chance(0.3) && p.plain.includes(' ')) {
      const words = p.plain.split(' ')
      const cut = Math.max(1, Math.floor(words.length / 2))
      blocks.push({ k: 'text', text: `${pad}${words.slice(0, cut).join(' ')}` })
      blocks.push({ k: 'text', text: `${pad}${pad}${words.slice(cut).join(' ')} - ${q} ${unit}` })
    } else blocks.push({ k: 'text', text: `${pad}${p.plain}${r.pick([` - ${q} ${unit}`, ` ${q} ${unit}`, `, ${q} ${unit}`])}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  }
  blocks.push({ k: 'gap' }, { k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text'] }
}

const URDU_TAIL = ['', ' بھیج دیں', ' چاہیے', ' بھی', ' جلدی']
const URDU_DIGITS = '۰۱۲۳۴۵۶۷۸۹'
const urduNumber = (n: number) => String(n).replace(/\d/g, d => URDU_DIGITS[Number(d)] as string)

/** A WhatsApp enquiry typed with Urdu words: عدد for pieces, Urdu request words, sometimes Urdu digits. */
export const whatsappUrdu: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const date = writeDate(r, dateAfter(-1), 0)
  const msgs: ChatMsg[] = [{ date, time: '10:15', name: c.person, lines: [r.pick(['السلام علیکم، ریٹ بھیج دیں', 'AoA sir, rates please', 'سر یہ آئٹمز چاہیے'])] }]
  const items: ItemTruth[] = []
  ps.forEach((p, i) => {
    const urdu = r.chance(0.6)
    const unit = urdu ? 'adad' : unitFor(r, p, 'lower')
    const qty = urdu ? r.pick([1, 2, 3, 4, 5, 10, 12]) : decimalQty(r, unit)
    const q = urdu && r.chance(0.4) ? urduNumber(qty) : String(qty)
    const written = urdu ? 'عدد' : unit
    msgs.push({ date, time: `10:${String(16 + i).padStart(2, '0')}`, name: c.person, lines: [`${p.plain} ${r.pick(['- ', '', ': '])}${q} ${written}${r.pick(URDU_TAIL)}`] })
    items.push({ description: p.plain, qty, unit: urdu ? 'nos' : unit, part: p.part ?? undefined })
  })
  msgs.push({ date, time: '10:40', name: 'Q-Tech Sales', lines: ['جی، آج بھیج دیں گے'], out: true })
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

/** A government or semi-government tender schedule: "Schedule of Requirements", A/U column, a closing date. */
export const tenderSchedule: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(3, 16))
  const tender = `${c.code}/TENDER/${r.int(10, 99)}/2026-27`
  const due = dateAfter(r.int(7, 30))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = decimalQty(r, unit)
    items.push({ description: `${p.plain}`, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), p.plain, String(qty), unit]
  })
  const blocks: Block[] = [
    { k: 'text', text: 'TENDER NOTICE', bold: true, size: 13, align: 'center' },
    { k: 'text', text: `Tender No. ${tender}`, align: 'center' },
    { k: 'gap' },
    { k: 'text', text: `Sealed bids are invited from registered firms for the supply of the following stores. ${r.pick(['Last date of submission', 'Closing date'])}: ${writeDate(r, due, r.pick([0, 3, 4]))} at 11:00 AM.` },
    { k: 'gap' },
    { k: 'text', text: 'SCHEDULE OF REQUIREMENTS', bold: true },
    { k: 'table', head: ['Sr', 'Item Name / Specification', 'Qty', 'A/U'], rows, widths: [0.07, 0.65, 0.12, 0.12], align: ['c', 'l', 'r', 'c'], ruled: true, descCol: 1 },
    { k: 'gap' },
    { k: 'text', text: '1. Bid security 2% of the quoted amount.' },
    { k: 'text', text: '2. Delivery period: 60 days from the date of the order.' },
    { k: 'gap' },
    { k: 'text', text: 'Procurement Officer' },
    { k: 'text', text: c.name },
  ]
  return {
    doc: { look: 'paper', blocks, page: { font: r.pick(['times', 'helvetica']), size: 10, footer: 'Page {n} of {m}', rowsPerPage: ps.length > 10 ? 8 : undefined, repeatHead: r.chance(0.5) } },
    truth: { items, ref: tender, due: due.iso, company: c.name },
    media: ['pdf', 'scan', 'text'],
  }
}

/** Items written as "Item: ...; Size: ...; Qty: ..." on one line each. */
export const semicolonSpecs: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: r.pick(['Required urgently, please quote:', 'Please quote the following.']) }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = decimalQty(r, unit)
    const make = p.brand ? `; Make: ${p.brand}` : ''
    const base = p.brand ? p.plain.replace(`${p.brand} `, '') : p.plain
    blocks.push({ k: 'text', text: `${i + 1}) Item: ${base}${make}; Qty: ${qty} ${unit}` })
    items.push({ description: `${base}${p.brand ? ` ${p.brand}` : ''}`, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

// ------------------------------------------------------------------------------------------------ quotes

function rfq(r: Rng, n: number) {
  return parts(r, n).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
}

/** A local trader's rate sheet: Sr, Item, Brand, Origin, Qty, Rate, Amount, Delivery; rupees; GST as a column. */
export const rateSheet: QuoteTemplate = r => {
  const s = supplier(r, 'local')
  const lines = rfq(r, r.int(2, 10))
  const priced = lines.map(l => ({ ...l, price: Math.round(r.pick([1200, 3500, 8750, 19050, 42000, 65800, 134400]) / 50) * 50 }))
  const lead = r.pick([{ t: '1 week', d: 7 }, { t: '2-3 weeks', d: 21 }, { t: 'Ex-stock', d: 0 }])
  const rows = priced.map((l, i) => [String(i + 1), l.p.plain, l.p.brand ?? 'Any', r.pick(['China', 'Germany', 'Japan', 'Italy']), String(l.qty), l.price.toLocaleString('en-US'), (l.price * l.qty).toLocaleString('en-US'), lead.t])
  const blocks: Block[] = [
    { k: 'text', text: s.name, bold: true, size: 13 },
    { k: 'text', text: 'RATE SHEET', bold: true },
    { k: 'pair', left: 'To: Q-Tech Engineering', right: `Date: ${writeDate(r, dateAfter(0), 0)}` },
    { k: 'table', head: ['Sr', 'Item', 'Brand', 'Origin', 'Qty', 'Rate (Rs)', 'Amount (Rs)', 'Delivery'], rows, widths: [0.05, 0.33, 0.1, 0.09, 0.06, 0.12, 0.13, 0.12], align: ['c', 'l', 'l', 'l', 'r', 'r', 'r', 'c'], ruled: true, descCol: 1 },
    { k: 'text', text: 'Rates are exclusive of 18% GST.' },
    { k: 'text', text: 'Validity: 7 days' },
    { k: 'text', text: 'Payment: Cash against delivery' },
  ]
  const truth: QuoteLineTruth[] = priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: 'PKR', leadMax: lead.d, validityDays: 7 }))
  return {
    doc: { look: 'sheet', blocks, page: { font: 'helvetica', size: 8.5, landscape: true } },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: truth, unpriced: [], currency: 'PKR', validityDays: 7, payment: 'Cash against delivery' },
    media: ['pdf', 'image', 'text'],
  }
}

/** The supplier answers under each line of our RFQ, quoted with ">". */
export const inlineReply: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'europe', 'gulf'] as const))
  const lines = rfq(r, r.int(2, 6))
  const cur = s.currency
  const sym = { USD: 'USD ', EUR: 'EUR ', CNY: 'RMB ', AED: 'AED ', PKR: 'Rs. ' }[cur]
  const blocks: Block[] = [{ k: 'text', text: 'Dear Wasif, please see our prices under each item.' }, { k: 'gap' }]
  const truth: QuoteLineTruth[] = []
  lines.forEach((l, i) => {
    const price = r.pick([12.5, 45, 88, 120, 235, 650, 1250])
    const lead = r.pick([{ t: '3-4 weeks', d: 28 }, { t: '10 days', d: 10 }, { t: '6 weeks', d: 42 }])
    blocks.push({ k: 'text', text: `> ${i + 1}. ${l.p.plain} - ${l.qty} Nos` })
    blocks.push({ k: 'text', text: r.pick([`Our price: ${sym}${price} each, delivery ${lead.t}`, `Price ${sym}${price}/pc, lead time ${lead.t}`]) })
    blocks.push({ k: 'gap' })
    truth.push({ itemId: l.id, unitPrice: price, currency: cur, leadMax: lead.d, validityDays: 30 })
  })
  blocks.push({ k: 'text', text: 'Offer valid for 30 days.' }, { k: 'text', text: 'Best regards' }, { k: 'text', text: s.person })
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: truth, unpriced: [], currency: cur, validityDays: 30 },
    media: ['text', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN1 = [
  { shape: 'list_indented', make: indentedList, weight: 3 },
  { shape: 'whatsapp_urdu', make: whatsappUrdu, weight: 3 },
  { shape: 'tender_schedule', make: tenderSchedule, weight: 3 },
  { shape: 'semicolon_specs', make: semicolonSpecs, weight: 2 },
]
export const QUOTE_TEMPLATES_GEN1 = [
  { shape: 'quote_rate_sheet', make: rateSheet, weight: 3 },
  { shape: 'quote_inline_reply', make: inlineReply, weight: 3 },
]
