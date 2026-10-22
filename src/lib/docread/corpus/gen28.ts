// Template generation 28: written after fresh batch 29 passed first try, to check the next fresh batch (30) first try.
// Every name and number is invented.
// 28: an email list with the part number first in capitals and the description after a dash, a PDF purchase enquiry with a
//     "Pack Size" column, a WhatsApp list with "Qty 4 nos - item", a quotation with "Price each".

import type { Block, ChatMsg, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)

export const partDashDesc: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6)).filter(p => p.part)
  if (ps.length === 0) ps.push(...parts(r, 2))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'Please quote for the following part numbers:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    const base = p.plain.replace(/,?\s*Model\s+\S+/, '').replace(p.part ?? '\u0000', '').replace(/\s+/g, ' ').replace(/[\s,]+$/, '').trim()
    const line = p.part ? `${p.part} - ${base} - ${qty} ${unit}` : `${base} - ${qty} ${unit}`
    blocks.push({ k: 'text', text: `${i + 1}. ${line}` })
    items.push({ description: p.part ? `${p.part} ${base}` : base, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const packSizeColumn: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 7))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), p.plain, r.pick(['-', 'Std', 'Box of 10', 'Single']), String(qty), unit]
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true },
    { k: 'text', text: 'Purchase Enquiry', bold: true },
    { k: 'table', head: ['S.No', 'Description', 'Pack Size', 'Qty', 'Unit'], rows, widths: [0.06, 0.54, 0.14, 0.08, 0.08], align: ['c', 'l', 'l', 'r', 'c'], ruled: true, descCol: 1 },
  ]
  return { doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } }, truth: { items, company: c.name }, media: ['pdf', 'text', 'image'] }
}

export const qtyFirstChat: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 4))
  const items: ItemTruth[] = []
  const lines = ['Sir ye items chahiye:']
  ps.forEach(p => {
    const qty = Math.ceil(p.qty(r))
    const unit = unitFor(r, p, 'lower')
    lines.push(`Qty ${qty} ${unit} - ${p.plain}`)
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  const msgs: ChatMsg[] = [{ date: writeDate(r, dateAfter(0), 0), time: '09:05', name: c.person, lines }]
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

export const priceEachQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'europe', 'gulf'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(2, 5)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const priced = lines.map(l => ({ ...l, price: r.pick([16, 64, 210, 735]) }))
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Wasif,' },
    {
      k: 'table',
      head: ['No', 'Product', 'Qty', `Price each (${cur})`, 'Delivery'],
      rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), l.price.toFixed(2), '2-3 weeks']),
      widths: [0.05, 0.55, 0.07, 0.15, 0.13],
      align: ['c', 'l', 'r', 'r', 'c'],
      ruled: true,
      descCol: 1,
    },
    { k: 'text', text: s.person },
  ]
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: cur, leadMax: 21 })), unpriced: [], currency: cur },
    media: ['text', 'pdf', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN28 = [
  { shape: 'part_dash_desc', make: partDashDesc, weight: 3 },
  { shape: 'pack_size_column', make: packSizeColumn, weight: 3 },
  { shape: 'qty_first_chat', make: qtyFirstChat, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN28 = [{ shape: 'quote_price_each', make: priceEachQuote, weight: 4 }]
