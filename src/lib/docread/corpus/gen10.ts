// Template generations 10 and 11: written together after fresh batch 9 was folded into dev and passed; generation 10 first
// checked on fresh batch 12, generation 11 on fresh batch 13 (two consecutive fresh batches). Every name and number is invented.
// 10: a table with the quantity and unit before the description, items written "2 x Relay ...", the closing date in the
//     subject line, a quotation with list price, discount and net price.
// 11: a requisition table split by section rows ("ELECTRICAL ITEMS"), each item over two lines with its quantity below, items
//     written "Contactor 25A = 4 Nos", a European quotation with the supplier's own order codes.

import type { Block, ChatMsg, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)
/** The description without its part number, and the part number, for a form that gives the part its own column. */
const split = (p: Part) => ({
  base: p.plain.replace(/,?\s*Model\s+\S+/, '').replace(p.part ?? '\u0000', '').replace(/\s+/g, ' ').replace(/[\s,]+$/, '').trim(),
  pn: p.part ?? '',
})

// ------------------------------------------------------------------------------------------------ generation 10

export const qtyFirstTable: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 7))
  const items: ItemTruth[] = []
  const rows = ps.map(p => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    const { base, pn } = split(p)
    items.push({ description: pn ? `${base} ${pn}` : base, qty, unit, part: p.part ?? undefined })
    return [String(qty), unit, base, pn]
  })
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Sir,' },
    { k: 'text', text: 'Please send your best offer for the items below.' },
    { k: 'table', head: ['Qty', 'Unit', 'Description', 'Part No.'], rows, widths: [0.08, 0.08, 0.56, 0.22], align: ['r', 'c', 'l', 'l'], ruled: true, descCol: 2 },
    { k: 'text', text: 'Regards,' },
    { k: 'text', text: c.person },
    { k: 'text', text: c.name },
  ]
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'pdf', 'image'] }
}

export const timesQty: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const before = r.chance(0.5)
  const items: ItemTruth[] = []
  const lines: string[] = [r.pick(['Salam, rates required:', 'AoA sir, need price for', 'Please quote'])]
  ps.forEach(p => {
    const qty = Math.ceil(p.qty(r))
    lines.push(before ? `${qty} x ${p.plain}` : `${p.plain} x ${qty}`)
    items.push({ description: p.plain, qty, unit: null, part: p.part ?? undefined })
  })
  const msgs: ChatMsg[] = [{ date: writeDate(r, dateAfter(0), 0), time: '11:20', name: c.person, lines }]
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

export const dueInSubject: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const due = dateAfter(r.int(7, 25))
  const ref = `${c.code}-RFQ-${r.int(1000, 9999)}`
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'Please quote the following:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${i + 1}. ${p.plain} - ${qty} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  const subject = `RFQ ${ref} - closing ${writeDate(r, due, r.pick([0, 2, 3]))}`
  const email = { from: `${c.person} <${c.email}>`, sent: `${writeDate(r, dateAfter(-1), 3)} 10:15 AM`, to: 'sales@qtech.example', subject }
  return { doc: { look: 'email', email, blocks }, truth: { items, ref, due: due.iso, company: c.name, domain: c.domain }, media: ['text', 'image'] }
}

export const discountQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['europe', 'gulf'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(2, 5)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const disc = r.pick([10, 15, 20, 25])
  const priced = lines.map(l => {
    const list = r.pick([40, 120, 260, 480, 900])
    return { ...l, list, net: Math.round(list * (100 - disc)) / 100 }
  })
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Mr. Wasif,' },
    { k: 'text', text: 'Thank you for your enquiry. Our offer:' },
    {
      k: 'table',
      head: ['Pos', 'Description', 'Qty', `List Price ${cur}`, 'Disc. %', `Net Price ${cur}`, `Total ${cur}`],
      rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), l.list.toFixed(2), `${disc}%`, l.net.toFixed(2), (l.net * l.qty).toFixed(2)]),
      widths: [0.05, 0.4, 0.06, 0.12, 0.08, 0.12, 0.12],
      align: ['c', 'l', 'r', 'r', 'r', 'r', 'r'],
      ruled: true,
      descCol: 1,
    },
    { k: 'text', text: 'Delivery: 3 weeks after order' },
    { k: 'text', text: 'Validity: 30 days' },
    { k: 'text', text: s.person },
  ]
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.net, currency: cur, leadMax: 21, validityDays: 30 })), unpriced: [], currency: cur, validityDays: 30 },
    media: ['text', 'pdf', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ generation 11

export const sectionedTable: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(4, 10))
  const items: ItemTruth[] = []
  const cut = r.int(1, ps.length - 1)
  const rows: string[][] = []
  ps.forEach((p, i) => {
    if (i === 0) rows.push(['', r.pick(['ELECTRICAL ITEMS', 'A. ELECTRICAL', 'Electrical Spares']), '', ''])
    if (i === cut) rows.push(['', r.pick(['INSTRUMENTATION ITEMS', 'B. INSTRUMENTS', 'Mechanical / Others']), '', ''])
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    rows.push([String(i + 1), p.plain, unit, String(qty)])
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true, align: 'center' },
    { k: 'text', text: 'MATERIAL REQUISITION', bold: true, align: 'center' },
    { k: 'table', head: ['S.No', 'Description of Material', 'UOM', 'Qty'], rows, widths: [0.07, 0.65, 0.1, 0.1], align: ['c', 'l', 'c', 'r'], ruled: true, descCol: 1 },
    { k: 'text', text: 'Prepared by: Store Incharge' },
  ]
  return { doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } }, truth: { items, company: c.name }, media: ['pdf', 'text', 'image'] }
}

export const twoLineItems: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const ref = String(r.int(4500100000, 4500199999))
  const items: ItemTruth[] = []
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Sir,' },
    { k: 'text', text: `Against our PR No. ${ref} dated ${writeDate(r, dateAfter(-3), 0)}, please quote:` },
  ]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${i + 1}. ${p.plain}` })
    blocks.push({ k: 'text', text: `Qty: ${qty} ${unit}`, indent: 3 })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Best regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, ref, company: c.name }, media: ['text', 'image'] }
}

export const equalsQty: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const lines = ['Sir rates send kar dein:']
  ps.forEach(p => {
    const unit = unitFor(r, p, r.pick(['title', 'lower'] as const))
    const qty = Math.ceil(p.qty(r))
    lines.push(`${p.plain} = ${qty} ${unit}`)
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  lines.push('Shukriya')
  const msgs: ChatMsg[] = [{ date: writeDate(r, dateAfter(0), 0), time: '09:41', name: c.person, lines }]
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

export const orderCodes: QuoteTemplate = r => {
  const s = supplier(r, 'europe')
  const cur = s.currency
  const lines = parts(r, r.int(2, 6)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const priced = lines.map(l => ({ ...l, price: r.pick([24.5, 87, 156.4, 640, 1290]), code: `${r.int(100, 999)}${r.int(1000, 9999)}` }))
  const blocks: Block[] = [
    { k: 'text', text: `Quotation No. AN-${r.int(20000, 29999)}` },
    { k: 'text', text: 'Dear Sir, we are pleased to offer as follows:' },
    {
      k: 'table',
      head: ['Pos', 'Order code', 'Description', 'Qty', `Unit price ${cur}`, `Total ${cur}`, 'Delivery'],
      rows: priced.map((l, i) => [String((i + 1) * 10), l.code, l.p.plain, String(l.qty), l.price.toFixed(2), (l.price * l.qty).toFixed(2), '4-6 wks']),
      widths: [0.05, 0.11, 0.38, 0.06, 0.12, 0.12, 0.1],
      align: ['c', 'l', 'l', 'r', 'r', 'r', 'c'],
      ruled: true,
      descCol: 2,
    },
    { k: 'text', text: 'Terms: FCA Hamburg, payment 100% in advance.' },
    { k: 'text', text: s.person },
  ]
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: cur, leadMax: 42 })), unpriced: [], currency: cur },
    media: ['text', 'pdf', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN10 = [
  { shape: 'qty_first_table', make: qtyFirstTable, weight: 3 },
  { shape: 'times_qty', make: timesQty, weight: 3 },
  { shape: 'due_in_subject', make: dueInSubject, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN10 = [{ shape: 'quote_discount', make: discountQuote, weight: 4 }]
export const ENQUIRY_TEMPLATES_GEN11 = [
  { shape: 'sectioned_table', make: sectionedTable, weight: 3 },
  { shape: 'two_line_items', make: twoLineItems, weight: 3 },
  { shape: 'equals_qty', make: equalsQty, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN11 = [{ shape: 'quote_order_codes', make: orderCodes, weight: 4 }]
