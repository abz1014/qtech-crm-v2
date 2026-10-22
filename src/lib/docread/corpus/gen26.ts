// Template generations 26 and 27: written together after fresh batch 27 was folded into dev and passed; generation 26 first
// checked on fresh batch 28, generation 27 on fresh batch 29 (two consecutive fresh batches). Every name and number is invented.
// 26: a numbered list with the quantity in front and "of" ("10 nos. of Cable gland PG9"), a PDF RFQ with a "Remarks" line
//     under each row, a WhatsApp list where each item ends with "(urgent)", a quotation listing "Model: X - USD 45 - 2 weeks".
// 27: a table copied from Excel with the header in capitals and a blank column, an email with "Qty Required:" on the same
//     line after a semicolon, a list with sizes in inches and feet quotes ("1/2\"", "10 ft"), a quotation with prices per 100.

import type { Block, ChatMsg, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)

// ------------------------------------------------------------------------------------------------ generation 26

export const qtyOfItem: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'We require:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'lower')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${i + 1}. ${qty} ${unit}. of ${p.plain}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const remarksUnderRow: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true },
    { k: 'text', text: 'REQUEST FOR QUOTATION', bold: true },
    { k: 'text', text: 'Please quote the items below. Remarks are for your information.' },
  ]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${i + 1}. ${p.plain} -- ${qty} ${unit}` })
    blocks.push({ k: 'text', text: `Remarks: ${r.pick(['Original only', 'Same as old supply', 'Test certificate required', 'For boiler house'])}`, indent: 4 })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  return { doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 10 } }, truth: { items, company: c.name }, media: ['pdf', 'text', 'image'] }
}

export const urgentTags: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const items: ItemTruth[] = []
  const lines = ['Sir quotation chahiye']
  ps.forEach(p => {
    const qty = Math.ceil(p.qty(r))
    const unit = unitFor(r, p, 'lower')
    lines.push(`${p.plain} ${qty} ${unit}${r.chance(0.5) ? ' (urgent)' : ''}`)
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  const msgs: ChatMsg[] = [{ date: writeDate(r, dateAfter(0), 0), time: '16:20', name: c.person, lines }]
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

export const dashedOfferQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'gulf'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(1, 5)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const blocks: Block[] = [{ k: 'text', text: 'Hi Wasif,' }, { k: 'text', text: 'Prices:' }]
  const truth = lines.map(l => {
    const price = r.pick([7.5, 36, 142, 520])
    const wk = r.pick([1, 2, 3])
    blocks.push({ k: 'text', text: `${l.p.plain} - ${cur} ${price} - ${wk} week${wk > 1 ? 's' : ''}` })
    return { itemId: l.id, unitPrice: price, currency: cur, leadMax: wk * 7 }
  })
  blocks.push({ k: 'text', text: s.person })
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: truth, unpriced: [], currency: cur },
    media: ['text', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ generation 27

export const excelCapsBlank: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 8))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.caps, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), p.caps, '', String(qty), unit]
  })
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Sir, please quote the attached list (copied below).' },
    { k: 'table', head: ['SR', 'ITEM DESCRIPTION', 'BRAND', 'QTY', 'UOM'], rows, widths: [0.05, 0.55, 0.14, 0.08, 0.08], align: ['c', 'l', 'l', 'r', 'c'], ruled: true, descCol: 1 },
    { k: 'text', text: c.person },
    { k: 'text', text: c.name },
  ]
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const semicolonQtyRequired: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'Please offer for:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${i + 1}. ${p.plain}; Qty Required: ${qty} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const inchFeet: EnquiryTemplate = r => {
  const c = customer(r)
  const n = r.int(1, 5)
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Salam,' }, { k: 'text', text: 'Rates for the following pipe fittings please:' }]
  const things = ['Ball valve SS316', 'Gate valve brass', 'PVC pipe', 'Flexible hose SS braided', 'Pressure gauge siphon', 'Hose clamp']
  for (let i = 0; i < n; i++) {
    const size = r.pick(['1/2"', '3/4"', '1"', '2"'])
    const len = r.pick(['', ' x 10 ft', ' x 6 ft'])
    const desc = `${things[(i + r.int(0, 5)) % things.length]} ${size}${len}`
    if (items.some(x => x.description === desc)) continue
    const qty = r.pick([2, 4, 5, 10, 20])
    blocks.push({ k: 'text', text: `- ${desc} = ${qty} nos` })
    items.push({ description: desc, qty, unit: 'nos' })
  }
  blocks.push({ k: 'text', text: 'Thanks' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const per100Quote: QuoteTemplate = r => {
  const s = supplier(r, 'local')
  const lines = parts(r, r.int(1, 4)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'Our rates:' }]
  const truth = lines.map((l, i) => {
    const price = r.pick([450, 1200, 3800, 9500])
    blocks.push({ k: 'text', text: `${i + 1}. ${l.p.plain} - Rs. ${price.toLocaleString('en-US')}/- per piece` })
    return { itemId: l.id, unitPrice: price, currency: 'PKR' }
  })
  blocks.push({ k: 'text', text: 'Prices exclusive of GST. Delivery ex-stock.' }, { k: 'text', text: s.person })
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: truth, unpriced: [], currency: 'PKR' },
    media: ['text', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN26 = [
  { shape: 'qty_of_item', make: qtyOfItem, weight: 3 },
  { shape: 'remarks_under_row', make: remarksUnderRow, weight: 3 },
  { shape: 'urgent_tags', make: urgentTags, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN26 = [{ shape: 'quote_dashed_offer', make: dashedOfferQuote, weight: 4 }]
export const ENQUIRY_TEMPLATES_GEN27 = [
  { shape: 'excel_caps_blank', make: excelCapsBlank, weight: 3 },
  { shape: 'semicolon_qty_required', make: semicolonQtyRequired, weight: 3 },
  { shape: 'inch_feet', make: inchFeet, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN27 = [{ shape: 'quote_per_piece', make: per100Quote, weight: 4 }]
