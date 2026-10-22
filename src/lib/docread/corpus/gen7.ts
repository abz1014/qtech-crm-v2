// Template generation 7: written after fresh batch 6 passed first try; first checked on fresh batch 7 (the second consecutive
// fresh batch). Variations: a customer's purchase-department memo with the items after "Required Items:", an email table with
// Part No first and description second, a WhatsApp message listing items with dashes and Urdu-English tails, and a quotation
// sent as tab-separated rows with a currency column. Every name and number is invented.

import type { Block, ChatMsg, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)

/** An internal memo forwarded to us: "Required Items:" then the items, a due date sentence, the department. */
export const memo: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 6))
  const due = dateAfter(r.int(5, 25))
  const items: ItemTruth[] = []
  const blocks: Block[] = [
    { k: 'text', text: 'MEMO', bold: true },
    { k: 'text', text: 'From: Maintenance Department' },
    { k: 'text', text: 'To: Purchase Department' },
    { k: 'gap' },
    { k: 'text', text: 'Required Items:' },
  ]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${i + 1}. ${p.plain} = ${qty} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'gap' }, { k: 'text', text: `Quotations are required before ${writeDate(r, due, 3)}.` }, { k: 'text', text: `${c.name}, Maintenance Department` })
  return { doc: { look: 'paper', blocks, page: { font: 'times', size: 11 } }, truth: { items, due: due.iso }, media: ['pdf', 'text'] }
}

/** An email table with Part No first and the description second. */
export const partFirst: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 8))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    const desc = p.part ? p.plain.replace(`, Model ${p.part}`, '').replace(` ${p.part}`, '') : p.plain
    items.push({ description: `${desc}${p.part ? ` ${p.part}` : ''}`, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), p.part ?? '-', desc, String(qty), unit]
  })
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Wasif,' },
    { k: 'text', text: 'Please quote below:' },
    { k: 'table', head: ['No', 'Part No', 'Description', 'Qty', 'Unit'], rows, widths: [0.06, 0.2, 0.48, 0.08, 0.08], align: ['c', 'l', 'l', 'r', 'c'], ruled: true, descCol: 2 },
    { k: 'text', text: 'Regards,' },
    { k: 'text', text: c.person },
    { k: 'text', text: c.name },
  ]
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'pdf', 'image'] }
}

/** A WhatsApp message listing items with dashes, Urdu-English tails. */
export const chatDashes: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 6))
  const items: ItemTruth[] = []
  const lines = ['Bhai ye cheezein chahiye:']
  for (const p of ps) {
    const unit = unitFor(r, p, 'lower')
    const qty = Math.ceil(p.qty(r))
    lines.push(`- ${p.plain} ${qty} ${unit} ${r.pick(['', 'urgent', 'bhi', 'chahiye'])}`.trim())
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  }
  const msgs: ChatMsg[] = [{ date: writeDate(r, dateAfter(0), 0), time: '14:20', name: c.person, lines }]
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

/** A quotation sent as tab-separated rows with a Currency column. */
export const currencyColumn: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['gulf', 'europe'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(2, 6)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const priced = lines.map(l => ({ ...l, price: r.pick([14, 58, 230, 815]), wk: r.pick([1, 2, 4]) }))
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Sir, please find our prices:' },
    { k: 'table', head: ['#', 'Item', 'Qty', 'Currency', 'Unit Price', 'Lead Time'], rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), cur, l.price.toFixed(2), `${l.wk} week${l.wk > 1 ? 's' : ''}`]), widths: [0.05, 0.48, 0.07, 0.1, 0.12, 0.12], align: ['c', 'l', 'r', 'c', 'r', 'c'], ruled: true, descCol: 1 },
    { k: 'text', text: 'Validity 30 days.' },
    { k: 'text', text: s.person },
  ]
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: cur, leadMax: l.wk * 7, validityDays: 30 })), unpriced: [], currency: cur, validityDays: 30 },
    media: ['text', 'pdf', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN7 = [
  { shape: 'memo', make: memo, weight: 3 },
  { shape: 'part_first', make: partFirst, weight: 3 },
  { shape: 'chat_dashes', make: chatDashes, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN7 = [{ shape: 'quote_currency_column', make: currencyColumn, weight: 4 }]
