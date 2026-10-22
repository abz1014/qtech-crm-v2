// Template generations 20 and 21: written together after fresh batch 21 was folded into dev and passed; generation 20 first
// checked on fresh batch 22, generation 21 on fresh batch 23 (two consecutive fresh batches). Every name and number is invented.
// 20: a table with "Qty in Stock" beside "Qty Required", a table with a required-date column, a chat list "Item: 4",
//     a quotation with only line amounts (the unit price is the amount over the quantity).
// 21: a lowercase chat with the count first and no unit, emoji bullets, a Markdown table with a separator row, a quotation
//     with freight and bank charges under the items.

import type { Block, ChatMsg, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)

// ------------------------------------------------------------------------------------------------ generation 20

export const stockColumn: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 7))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), p.plain, unit, String(r.int(0, 3)), String(qty)]
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true },
    { k: 'text', text: 'Purchase Requisition', bold: true },
    { k: 'table', head: ['S.No', 'Description', 'UOM', 'Qty in Stock', 'Qty Required'], rows, widths: [0.06, 0.56, 0.08, 0.12, 0.12], align: ['c', 'l', 'c', 'r', 'r'], ruled: true, descCol: 1 },
    { k: 'text', text: 'Store Officer' },
  ]
  return { doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } }, truth: { items, company: c.name }, media: ['pdf', 'text', 'image'] }
}

export const requiredDateColumn: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 7))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [String(10 * (i + 1)), p.plain, String(qty), unit, writeDate(r, dateAfter(r.int(20, 60)), 1)]
  })
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Supplier,' },
    { k: 'text', text: 'Please submit your quotation for the items below.' },
    { k: 'table', head: ['Item', 'Description', 'Qty', 'UOM', 'Required Date'], rows, widths: [0.06, 0.54, 0.08, 0.08, 0.16], align: ['c', 'l', 'r', 'c', 'c'], ruled: true, descCol: 1 },
    { k: 'text', text: 'Regards,' },
    { k: 'text', text: c.person },
    { k: 'text', text: c.name },
  ]
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'pdf', 'image'] }
}

export const colonCountChat: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const lines = ['Sir please share rates']
  ps.forEach(p => {
    const qty = Math.ceil(p.qty(r))
    lines.push(`${p.plain}: ${qty}`)
    items.push({ description: p.plain, qty, unit: null, part: p.part ?? undefined })
  })
  const msgs: ChatMsg[] = [{ date: writeDate(r, dateAfter(0), 0), time: '17:45', name: c.person, lines }]
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

export const amountOnlyQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['local', 'gulf'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(2, 5)).map((p, i) => ({ id: `it${i + 1}`, p, qty: r.pick([1, 2, 4, 5, 10]) }))
  const priced = lines.map(l => ({ ...l, price: r.pick([150, 400, 1200, 3500]) }))
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Sir,' },
    { k: 'text', text: `Please find our quotation (amounts in ${cur}):` },
    {
      k: 'table',
      head: ['#', 'Description', 'Qty', 'Amount'],
      rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), (l.price * l.qty).toLocaleString('en-US')]),
      widths: [0.05, 0.6, 0.08, 0.15],
      align: ['c', 'l', 'r', 'r'],
      ruled: true,
      descCol: 1,
    },
    { k: 'text', text: 'Delivery: 2 weeks' },
    { k: 'text', text: s.person },
  ]
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: cur, leadMax: 14 })), unpriced: [], currency: cur },
    media: ['text', 'pdf', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ generation 21

export const lowercaseCountChat: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const items: ItemTruth[] = []
  const lines: string[] = ['salam']
  ps.forEach(p => {
    const qty = Math.ceil(p.qty(r))
    const desc = p.plain.toLowerCase()
    lines.push(`need ${qty} ${desc}`)
    items.push({ description: desc, qty, unit: null, part: p.part ? p.part.toLowerCase() : undefined })
  })
  lines.push('rate bata dein')
  const msgs: ChatMsg[] = [{ date: writeDate(r, dateAfter(0), 0), time: '08:55', name: c.person, lines }]
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

export const emojiBullets: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const lines: string[] = ['Assalam o Alaikum sir, please quote 🙏']
  ps.forEach(p => {
    const qty = Math.ceil(p.qty(r))
    const unit = unitFor(r, p, 'lower')
    lines.push(`${r.pick(['✅', '🔹', '👉', '▪️'])} ${p.plain} - ${qty} ${unit}`)
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  const msgs: ChatMsg[] = [{ date: writeDate(r, dateAfter(0), 0), time: '11:11', name: c.person, lines }]
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text'] }
}

export const markdownTable: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Hi team,' }, { k: 'text', text: 'Requesting a quote for:' }, { k: 'text', text: '| # | Item | Qty | Unit |' }, { k: 'text', text: '|---|------|-----|------|' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `| ${i + 1} | ${p.plain} | ${qty} | ${unit} |` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Thanks,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text'] }
}

export const chargesQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'europe'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(1, 4)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const blocks: Block[] = [{ k: 'text', text: 'Dear Wasif,' }, { k: 'text', text: 'Our quotation:' }]
  const truth = lines.map((l, i) => {
    const price = r.pick([14, 55, 120, 480])
    blocks.push({ k: 'text', text: `${i + 1}. ${l.p.plain}: ${cur} ${price.toFixed(2)}/pc` })
    return { itemId: l.id, unitPrice: price, currency: cur, leadMax: 21 }
  })
  blocks.push(
    { k: 'text', text: `Freight charges: ${cur} ${r.pick([85, 120, 240])}.00` },
    { k: 'text', text: `Bank charges: ${cur} 35.00` },
    { k: 'text', text: 'Delivery: 3 weeks' },
    { k: 'text', text: s.person },
  )
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: truth, unpriced: [], currency: cur },
    media: ['text', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN20 = [
  { shape: 'stock_column', make: stockColumn, weight: 3 },
  { shape: 'required_date_column', make: requiredDateColumn, weight: 3 },
  { shape: 'colon_count_chat', make: colonCountChat, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN20 = [{ shape: 'quote_amount_only', make: amountOnlyQuote, weight: 4 }]
export const ENQUIRY_TEMPLATES_GEN21 = [
  { shape: 'lowercase_count_chat', make: lowercaseCountChat, weight: 3 },
  { shape: 'emoji_bullets', make: emojiBullets, weight: 3 },
  { shape: 'markdown_table', make: markdownTable, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN21 = [{ shape: 'quote_charges', make: chargesQuote, weight: 4 }]
