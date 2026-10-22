// Template generations 14 and 15: written together after fresh batch 15 was folded into dev and passed; generation 14 first
// checked on fresh batch 16, generation 15 on fresh batch 17 (two consecutive fresh batches). Every name and number is invented.
// 14: items whose specs are separated by spaced dashes ("Pressure gauge - 0-10 bar - 4 Nos"), a PDF with two tables each under
//     its own heading, a spreadsheet paste with the quantity and unit in one cell, a quotation with a "Delivery (days)" column.
// 15: a chat where the customer adds items after our reply ("Also add: ..."), an item named only in the subject line, an ERP
//     export with the quantity and unit first and a numeric material code, a quotation with each price on the line under its item.

import type { Block, ChatMsg, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)

// ------------------------------------------------------------------------------------------------ generation 14

export const dashedSpecs: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'Please quote the following items:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    const desc = p.plain.replace(/,\s*/g, ' - ')
    blocks.push({ k: 'text', text: `${i + 1}. ${desc} - ${qty} ${unit}` })
    items.push({ description: desc, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const twoTables: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(4, 10))
  const cut = r.int(2, ps.length - 2)
  const items: ItemTruth[] = []
  const table = (list: Part[]): Block => ({
    k: 'table',
    head: ['Sr. No.', 'Item Description', 'Qty', 'Unit'],
    rows: list.map((p, i) => {
      const unit = unitFor(r, p, 'caps')
      const qty = Math.ceil(p.qty(r))
      items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
      return [String(i + 1), p.plain, String(qty), unit]
    }),
    widths: [0.08, 0.62, 0.1, 0.1],
    align: ['c', 'l', 'r', 'c'],
    ruled: true,
    descCol: 1,
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true, align: 'center' },
    { k: 'text', text: 'REQUEST FOR QUOTATION', bold: true, align: 'center' },
    { k: 'text', text: 'A) Electrical Items', bold: true },
    table(ps.slice(0, cut)),
    { k: 'text', text: 'B) Mechanical Items', bold: true },
    table(ps.slice(cut)),
    { k: 'text', text: 'Please quote on your letterhead with make and delivery.' },
  ]
  return { doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9.5 } }, truth: { items, company: c.name }, media: ['pdf', 'image'] }
}

export const qtyUnitCell: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 8))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [`IC-${String(4100 + i * 7)}`, p.plain, `${qty} ${unit}`]
  })
  const blocks: Block[] = [
    { k: 'text', text: 'Hello,' },
    { k: 'text', text: 'Need prices for below list:' },
    { k: 'table', head: ['Item Code', 'Item Name', 'Required Qty'], rows, widths: [0.14, 0.62, 0.16], align: ['l', 'l', 'r'], ruled: true, descCol: 1 },
    { k: 'text', text: c.person },
    { k: 'text', text: c.name },
  ]
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const daysColumnQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['gulf', 'local'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(2, 6)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const priced = lines.map(l => ({ ...l, price: r.pick([45, 120, 380, 950, 2200]), days: r.pick([7, 15, 30, 45]) }))
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Wasif,' },
    { k: 'text', text: `Our prices in ${cur}:` },
    {
      k: 'table',
      head: ['No.', 'Item', 'Qty', 'Unit Price', 'Delivery (days)'],
      rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), l.price.toFixed(2), String(l.days)]),
      widths: [0.05, 0.53, 0.07, 0.13, 0.14],
      align: ['c', 'l', 'r', 'r', 'c'],
      ruled: true,
      descCol: 1,
    },
    { k: 'text', text: 'Offer valid 15 days.' },
    { k: 'text', text: s.person },
  ]
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: cur, leadMax: l.days, validityDays: 15 })), unpriced: [], currency: cur, validityDays: 15 },
    media: ['text', 'pdf', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ generation 15

export const addOnChat: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 6))
  const extra = ps.length - r.int(1, 2)
  const items: ItemTruth[] = []
  const date = writeDate(r, dateAfter(0), 0)
  const first = ['Salam sir, rates chahiye:']
  ps.slice(0, extra).forEach((p, i) => {
    const qty = Math.ceil(p.qty(r))
    const unit = unitFor(r, p, 'lower')
    first.push(`${i + 1}. ${p.plain} ${qty} ${unit}`)
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  const msgs: ChatMsg[] = [
    { date, time: '10:02', name: c.person, lines: first },
    { date, time: '10:05', name: 'Wasif Q-Tech', lines: ['Ok sir, will send today'], out: true },
  ]
  const add = ps.slice(extra).map(p => {
    const qty = Math.ceil(p.qty(r))
    const unit = unitFor(r, p, 'lower')
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return `${qty} ${unit} ${p.plain}`
  })
  msgs.push({ date, time: '10:09', name: c.person, lines: [`Also add: ${add.join(', ')}`] })
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

export const subjectItem: EnquiryTemplate = r => {
  const c = customer(r)
  const p = parts(r, 1)[0] as Part
  const qty = Math.ceil(p.qty(r))
  const unit = unitFor(r, p, 'title')
  const email = { from: `${c.person} <${c.email}>`, sent: `${writeDate(r, dateAfter(-1), 3)} 11:40 AM`, to: 'sales@qtech.example', subject: `RFQ: ${p.plain} - ${qty} ${unit}` }
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'Please quote for the item in the subject, with delivery time.' }, { k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name }]
  return {
    doc: { look: 'email', email, blocks },
    truth: { items: [{ description: p.plain, qty, unit, part: p.part ?? undefined }], company: c.name, domain: c.domain },
    media: ['text', 'image'],
  }
}

export const erpQtyFirst: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 8))
  const items: ItemTruth[] = []
  const rows = ps.map(p => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.erp, qty, unit, part: p.part ?? undefined })
    return [qty.toFixed(3), unit, String(r.int(10000000, 19999999)), p.erp]
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true },
    { k: 'text', text: 'Enquiry - Stores & Spares' },
    { k: 'table', head: ['Quantity', 'UOM', 'Material Code', 'Material Description'], rows, widths: [0.11, 0.08, 0.15, 0.6], align: ['r', 'c', 'l', 'l'], ruled: true, descCol: 3 },
  ]
  return { doc: { look: 'sheet', blocks, page: { font: 'helvetica', size: 8.5, landscape: true } }, truth: { items, company: c.name }, media: ['pdf', 'text'] }
}

export const priceUnderQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'europe'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(2, 5)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const blocks: Block[] = [{ k: 'text', text: 'Hello Wasif,' }, { k: 'text', text: 'Please find our quotation:' }]
  const truth = lines.map((l, i) => {
    const price = r.pick([9.9, 34, 76.5, 210, 845])
    const wk = r.pick([2, 3, 4])
    blocks.push({ k: 'text', text: `${i + 1}) ${l.p.plain}` }, { k: 'text', text: `${cur} ${price.toFixed(2)} / pc    Delivery: ${wk} weeks`, indent: 3 })
    return { itemId: l.id, unitPrice: price, currency: cur, leadMax: wk * 7 }
  })
  blocks.push({ k: 'text', text: 'Best regards,' }, { k: 'text', text: s.person })
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: truth, unpriced: [], currency: cur },
    media: ['text', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN14 = [
  { shape: 'dashed_specs', make: dashedSpecs, weight: 3 },
  { shape: 'two_tables', make: twoTables, weight: 3 },
  { shape: 'qty_unit_cell', make: qtyUnitCell, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN14 = [{ shape: 'quote_days_column', make: daysColumnQuote, weight: 4 }]
export const ENQUIRY_TEMPLATES_GEN15 = [
  { shape: 'add_on_chat', make: addOnChat, weight: 3 },
  { shape: 'subject_item', make: subjectItem, weight: 3 },
  { shape: 'erp_qty_first', make: erpQtyFirst, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN15 = [{ shape: 'quote_price_under', make: priceUnderQuote, weight: 4 }]
