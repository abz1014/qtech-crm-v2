// Template generations 12 and 13: written together after fresh batch 13 was folded into dev and passed; generation 12 first
// checked on fresh batch 14, generation 13 on fresh batch 15 (two consecutive fresh batches). Every name and number is invented.
// 12: a supplier-portal export with one labelled line per item, the quantity in brackets after the item, a typewriter-style
//     PDF with columns lined up in Courier and no rules, a local quotation with a Rate column and GST extra.
// 13: items with an em dash before the quantity, a PDF whose header gives the RFQ number and closing date in two columns,
//     a chat list in Roman Urdu with "adad", a Chinese-style quotation in labelled blocks per model.

import type { Block, ChatMsg, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)

// ------------------------------------------------------------------------------------------------ generation 12

export const portalLines: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const ref = `${r.int(6000100, 6000999)}`
  const due = dateAfter(r.int(6, 20))
  const items: ItemTruth[] = []
  const blocks: Block[] = [
    { k: 'text', text: `Event: RFQ ${ref}` },
    { k: 'text', text: `Buyer: ${c.name}` },
    { k: 'text', text: `Response due: ${writeDate(r, due, 2)} 17:00 PKT` },
    { k: 'gap' },
  ]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `Line ${i + 1} | Short text: ${p.plain} | Quantity: ${qty} ${unit} | Need by: ${writeDate(r, dateAfter(40), 0)}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'gap' }, { k: 'text', text: 'Please submit your response through the portal or by reply to this email.' })
  return { doc: { look: 'email', blocks }, truth: { items, ref, due: due.iso, company: c.name }, media: ['text', 'image'] }
}

export const qtyInBrackets: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'Kindly quote your best rates for the following:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${i + 1}) ${p.plain} [Qty: ${qty} ${unit}]` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Thanks & regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.title }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const courierSheet: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 8))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.caps, qty, unit, part: p.part ?? undefined })
    return [String(i + 1).padStart(2, '0'), p.caps, String(qty), unit]
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name.toUpperCase() },
    { k: 'text', text: 'STORES DEPARTMENT - DEMAND FOR QUOTATION' },
    { k: 'gap' },
    { k: 'table', head: ['SR', 'DESCRIPTION', 'QTY', 'UNIT'], rows, widths: [0.06, 0.66, 0.1, 0.1], align: ['l', 'l', 'r', 'l'], ruled: false, descCol: 1 },
    { k: 'gap' },
    { k: 'text', text: 'STORE KEEPER' },
  ]
  return { doc: { look: 'paper', blocks, page: { font: 'courier', size: 9 } }, truth: { items, company: c.name }, media: ['pdf', 'image'] }
}

export const gstExtraQuote: QuoteTemplate = r => {
  const s = supplier(r, 'local')
  const lines = parts(r, r.int(2, 6)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const priced = lines.map(l => ({ ...l, price: r.pick([850, 2400, 6750, 18500, 42000]) }))
  const blocks: Block[] = [
    { k: 'text', text: s.name, bold: true },
    { k: 'text', text: `QUOTATION   Date: ${writeDate(r, dateAfter(1), 0)}` },
    { k: 'text', text: 'Messrs Q-Tech Engineering, Lahore' },
    {
      k: 'table',
      head: ['S#', 'Description', 'Qty', 'Rate', 'Amount'],
      rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), l.price.toLocaleString('en-US'), (l.price * l.qty).toLocaleString('en-US')]),
      widths: [0.05, 0.5, 0.08, 0.14, 0.16],
      align: ['c', 'l', 'r', 'r', 'r'],
      ruled: true,
      descCol: 1,
      foot: [['', 'Total', '', '', priced.reduce((n, l) => n + l.price * l.qty, 0).toLocaleString('en-US')]],
    },
    { k: 'text', text: 'Rates are in PKR. GST 18% extra.' },
    { k: 'text', text: 'Delivery: 7-10 days after PO' },
    { k: 'text', text: 'Payment: 30 days credit' },
    { k: 'text', text: s.person },
  ]
  return {
    doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9.5 } },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: 'PKR', leadMax: 10 })), unpriced: [], currency: 'PKR', payment: '30 days credit' },
    media: ['text', 'pdf', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ generation 13

export const emDashQty: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Hi Wasif,' }, { k: 'text', text: 'Can you send a quote for these?' }]
  ps.forEach(p => {
    const unit = unitFor(r, p, 'lower')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${p.plain} — ${qty} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Cheers,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const twoColumnHeader: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 8))
  const ref = `${c.code}/RFQ/${r.int(100, 999)}/26`
  const due = dateAfter(r.int(6, 20))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), p.plain, unit, String(qty)]
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true, size: 13 },
    { k: 'text', text: c.address },
    { k: 'gap' },
    { k: 'pair', left: 'To: Q-Tech Engineering, Lahore', right: `RFQ Ref: ${ref}` },
    { k: 'pair', left: `Attn: Sales Department`, right: `Issue Date: ${writeDate(r, dateAfter(-1), 0)}` },
    { k: 'pair', left: `Contact: ${c.person}`, right: `Closing Date: ${writeDate(r, due, 0)}` },
    { k: 'gap' },
    { k: 'table', head: ['Item', 'Description', 'Unit', 'Quantity'], rows, widths: [0.07, 0.63, 0.1, 0.12], align: ['c', 'l', 'c', 'r'], ruled: true, descCol: 1 },
  ]
  return { doc: { look: 'paper', blocks, page: { font: 'times', size: 10 } }, truth: { items, ref, due: due.iso, company: c.name }, media: ['pdf', 'image'] }
}

export const adadChat: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const items: ItemTruth[] = []
  const lines = [r.pick(['Wasif bhai in ka rate bata dein', 'Sir ye cheezain chahiye', 'Rate bhej dein please'])]
  ps.forEach(p => {
    const qty = Math.ceil(p.qty(r))
    lines.push(`${p.plain} ${qty} adad`)
    items.push({ description: p.plain, qty, unit: 'adad', part: p.part ?? undefined })
  })
  const msgs: ChatMsg[] = [{ date: writeDate(r, dateAfter(0), 0), time: '15:12', name: c.person, lines }]
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

export const modelBlocksQuote: QuoteTemplate = r => {
  const s = supplier(r, 'china')
  const cur = s.currency
  const lines = parts(r, r.int(1, 4)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const blocks: Block[] = [{ k: 'text', text: 'Dear friend,' }, { k: 'text', text: 'Good day! Here is our best offer:' }, { k: 'gap' }]
  const truth = lines.map(l => {
    const price = r.pick([6.8, 12.5, 48, 135, 260])
    blocks.push(
      { k: 'text', text: `Product: ${l.p.plain}` },
      { k: 'text', text: `Unit price: ${cur} ${price.toFixed(2)}/pc` },
      { k: 'text', text: 'MOQ: 1 pc' },
      { k: 'text', text: 'Lead time: 15 days' },
      { k: 'gap' },
    )
    return { itemId: l.id, unitPrice: price, currency: cur, leadMax: 15 }
  })
  blocks.push({ k: 'text', text: 'Price term: FOB Shenzhen' }, { k: 'text', text: s.person })
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: truth, unpriced: [], currency: cur, incoterm: 'FOB Shenzhen' },
    media: ['text', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN12 = [
  { shape: 'portal_lines', make: portalLines, weight: 3 },
  { shape: 'qty_in_brackets', make: qtyInBrackets, weight: 3 },
  { shape: 'courier_sheet', make: courierSheet, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN12 = [{ shape: 'quote_gst_extra', make: gstExtraQuote, weight: 4 }]
export const ENQUIRY_TEMPLATES_GEN13 = [
  { shape: 'em_dash_qty', make: emDashQty, weight: 3 },
  { shape: 'two_column_header', make: twoColumnHeader, weight: 3 },
  { shape: 'adad_chat', make: adadChat, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN13 = [{ shape: 'quote_model_blocks', make: modelBlocksQuote, weight: 4 }]
