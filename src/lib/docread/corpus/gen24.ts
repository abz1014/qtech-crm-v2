// Template generations 24 and 25: written together after fresh batch 25 was folded into dev and passed; generation 24 first
// checked on fresh batch 26, generation 25 on fresh batch 27 (two consecutive fresh batches). Every name and number is invented.
// 24: a list whose quantity sits in front with "x" glued ("4x Proximity sensor"), a table with Item No and a separate
//     Specification column, a Teams message list with "qty:" lowercase at the end, a quotation table with a "Discount" row.
// 25: a printed requisition with the unit written in words ("Numbers", "Meters") in its own column, a chat where the
//     customer corrects a quantity ("sorry 6 not 4"), a list with quantities in words for small numbers ("two nos"),
//     a quotation with "Unit Rate" and "Ext. Price" columns and a stock column.

import type { Block, ChatMsg, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

// ------------------------------------------------------------------------------------------------ generation 24

export const gluedTimes: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Hello Wasif,' }, { k: 'text', text: 'Please quote:' }]
  ps.forEach(p => {
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${qty}x ${p.plain}` })
    items.push({ description: p.plain, qty, unit: null, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Thanks' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const specColumn: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 7))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    const [noun, ...rest] = p.plain.split(/,\s*/)
    const spec = rest.join(', ')
    items.push({ description: spec ? `${noun} ${spec}` : (noun as string), qty, unit, part: p.part ?? undefined })
    return [String(i + 1), noun as string, spec || '-', String(qty), unit]
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true },
    { k: 'text', text: 'Enquiry', bold: true },
    { k: 'table', head: ['Item No', 'Item', 'Specification', 'Qty', 'UOM'], rows, widths: [0.07, 0.36, 0.33, 0.08, 0.08], align: ['c', 'l', 'l', 'r', 'c'], ruled: true, descCol: 1 },
  ]
  return { doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } }, truth: { items, company: c.name }, media: ['pdf', 'text', 'image'] }
}

export const lowerQtyTail: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const items: ItemTruth[] = []
  const lines = ['hi, can you check prices']
  ps.forEach(p => {
    const qty = Math.ceil(p.qty(r))
    const unit = unitFor(r, p, 'lower')
    lines.push(`${p.plain} qty: ${qty} ${unit}`)
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  const msgs: ChatMsg[] = [{ date: writeDate(r, dateAfter(0), 0), time: '10:40', name: c.person, lines }]
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

export const discountRowQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['local', 'gulf'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(2, 5)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const priced = lines.map(l => ({ ...l, price: r.pick([300, 750, 1800, 4200]) }))
  const sub = priced.reduce((n, l) => n + l.price * l.qty, 0)
  const blocks: Block[] = [
    { k: 'text', text: 'Quotation', bold: true },
    {
      k: 'table',
      head: ['S.No', 'Description', 'Qty', `Rate (${cur})`, `Amount (${cur})`],
      rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), l.price.toFixed(2), (l.price * l.qty).toFixed(2)]),
      widths: [0.06, 0.5, 0.07, 0.15, 0.15],
      align: ['c', 'l', 'r', 'r', 'r'],
      ruled: true,
      descCol: 1,
      foot: [['', 'Total', '', '', sub.toFixed(2)], ['', 'Discount 5%', '', '', (sub * 0.05).toFixed(2)], ['', 'Net Total', '', '', (sub * 0.95).toFixed(2)]],
    },
    { k: 'text', text: 'Delivery: 1 week' },
    { k: 'text', text: s.person },
  ]
  return {
    doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: cur, leadMax: 7 })), unpriced: [], currency: cur },
    media: ['text', 'pdf', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ generation 25

export const unitWordsColumn: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 7))
  const items: ItemTruth[] = []
  const word: Record<string, string> = { nos: 'Numbers', pcs: 'Pieces', m: 'Meters', kg: 'Kgs', set: 'Sets', roll: 'Rolls', pair: 'Pairs', box: 'Boxes', lot: 'Lots', ea: 'Each' }
  const rows = ps.map((p, i) => {
    const fam = unitFamily(r.pick(p.units)) as string
    const unit = word[fam] ?? writeUnit(r, fam, 'title')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), p.plain, String(qty), unit]
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true, align: 'center' },
    { k: 'text', text: 'Store Requisition', align: 'center' },
    { k: 'table', head: ['Sr. No.', 'Particulars', 'Quantity', 'Unit'], rows, widths: [0.08, 0.6, 0.12, 0.14], align: ['c', 'l', 'r', 'c'], ruled: true, descCol: 1 },
  ]
  return { doc: { look: 'paper', blocks, page: { font: 'times', size: 10 } }, truth: { items, company: c.name }, media: ['pdf', 'text', 'image'] }
}

export const correctionChat: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 5))
  const items: ItemTruth[] = []
  const date = writeDate(r, dateAfter(0), 0)
  const lines = ['Sir rates please:']
  const fixed = r.int(0, ps.length - 1)
  let correction = ''
  ps.forEach((p, i) => {
    const qty = Math.ceil(p.qty(r))
    const unit = unitFor(r, p, 'lower')
    if (i === fixed) {
      const wrong = qty + r.int(1, 3)
      lines.push(`${i + 1}. ${p.plain} - ${wrong} ${unit}`)
      correction = `Sorry, item ${i + 1} qty is ${qty} ${unit}, not ${wrong}`
    } else lines.push(`${i + 1}. ${p.plain} - ${qty} ${unit}`)
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  const msgs: ChatMsg[] = [
    { date, time: '12:00', name: c.person, lines },
    { date, time: '12:03', name: c.person, lines: [correction] },
  ]
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

export const wordQty: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'We need the following:' }]
  ps.forEach((p, i) => {
    const qty = r.int(1, 12)
    const unit = r.pick(['nos', 'pcs', 'sets'])
    blocks.push({ k: 'text', text: `${i + 1}) ${p.plain} - ${WORDS[qty]} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const extPriceQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['europe', 'china'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(2, 5)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const priced = lines.map(l => ({ ...l, price: r.pick([11.5, 48, 260, 905]) }))
  const blocks: Block[] = [
    { k: 'text', text: `Offer ${r.int(1000, 9999)} - prices in ${cur}` },
    {
      k: 'table',
      head: ['Line', 'Description', 'Qty', 'Unit Rate', 'Ext. Price', 'Stock'],
      rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), l.price.toFixed(2), (l.price * l.qty).toFixed(2), r.pick(['In stock', '3 weeks'])]),
      widths: [0.05, 0.45, 0.07, 0.12, 0.13, 0.12],
      align: ['c', 'l', 'r', 'r', 'r', 'c'],
      ruled: true,
      descCol: 1,
    },
    { k: 'text', text: s.person },
  ]
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: cur })), unpriced: [], currency: cur },
    media: ['text', 'pdf', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN24 = [
  { shape: 'glued_times', make: gluedTimes, weight: 3 },
  { shape: 'spec_column', make: specColumn, weight: 3 },
  { shape: 'lower_qty_tail', make: lowerQtyTail, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN24 = [{ shape: 'quote_discount_row', make: discountRowQuote, weight: 4 }]
export const ENQUIRY_TEMPLATES_GEN25 = [
  { shape: 'unit_words_column', make: unitWordsColumn, weight: 3 },
  { shape: 'correction_chat', make: correctionChat, weight: 3 },
  { shape: 'word_qty', make: wordQty, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN25 = [{ shape: 'quote_ext_price', make: extPriceQuote, weight: 4 }]
