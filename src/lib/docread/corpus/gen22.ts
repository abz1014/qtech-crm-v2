// Template generations 22 and 23: written together after fresh batch 23 was folded into dev and passed; generation 22 first
// checked on fresh batch 24, generation 23 on fresh batch 25 (two consecutive fresh batches). Every name and number is invented.
// 22: a reply on top of our own earlier quotation ("please also quote ..."), items numbered "Sr. 1:" with "Qty-4", a PDF form
//     with the description column last, a quotation whose table gives "Price/Unit" and the currency in each cell ("USD 45").
// 23: an email with a numbered list where some items say "(Make: X)" in brackets, a table whose Qty column says "4 Nos"
//     and whose Unit column is missing, a chat with prices asked "kitne ka hai" after each item, a quotation whose price heading
//     names the delivery term and the currency ("Unit Price CIF Karachi (USD)").

import type { Block, ChatMsg, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)

// ------------------------------------------------------------------------------------------------ generation 22

export const alsoQuoteOnOurs: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 4))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Wasif,' }, { k: 'text', text: 'Thanks for your offer. Please also quote the following:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${i + 1}. ${p.plain} - ${qty} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push(
    { k: 'text', text: 'Regards,' },
    { k: 'text', text: c.person },
    { k: 'text', text: c.name },
    { k: 'gap' },
    { k: 'text', text: `From: Wasif <sales@qtech.example>` },
    { k: 'text', text: `Sent: ${writeDate(r, dateAfter(-5), 3)} 3:10 PM` },
    { k: 'text', text: `To: ${c.email}` },
    { k: 'text', text: 'Subject: Quotation QT-2026-1044' },
    { k: 'text', text: 'Dear Sir, please find our offer:' },
  )
  for (const p of parts(r, 2)) blocks.push({ k: 'text', text: `${p.plain} - 2 Nos - PKR ${r.int(5, 90)},500 each` })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text'] }
}

export const srColonItems: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'Please provide quotation:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `Sr. ${i + 1}: ${p.plain}, Qty-${qty} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const descLastForm: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 8))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), String(qty), unit, p.plain]
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true },
    { k: 'text', text: 'INQUIRY FORM', bold: true },
    { k: 'table', head: ['No.', 'Qty', 'Unit', 'Description'], rows, widths: [0.06, 0.1, 0.1, 0.66], align: ['c', 'r', 'c', 'l'], ruled: true, descCol: 3 },
    { k: 'text', text: 'Authorised signature' },
  ]
  return { doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9.5 } }, truth: { items, company: c.name }, media: ['pdf', 'text', 'image'] }
}

export const currencyInCellQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'gulf', 'europe'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(2, 5)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const priced = lines.map(l => ({ ...l, price: r.pick([19, 45, 132, 560]) }))
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Sir,' },
    {
      k: 'table',
      head: ['Sr.', 'Item', 'Qty', 'Price/Unit', 'Total'],
      rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), `${cur} ${l.price}`, `${cur} ${l.price * l.qty}`]),
      widths: [0.05, 0.55, 0.08, 0.14, 0.14],
      align: ['c', 'l', 'r', 'r', 'r'],
      ruled: true,
      descCol: 1,
    },
    { k: 'text', text: 'Lead time: 2 weeks. Validity: 30 days.' },
    { k: 'text', text: s.person },
  ]
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: cur, leadMax: 14, validityDays: 30 })), unpriced: [], currency: cur, validityDays: 30 },
    media: ['text', 'pdf', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ generation 23

export const makeInBrackets: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'Kindly quote:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    const base = p.brand ? p.plain.replace(`${p.brand} `, '') : p.plain
    const text = p.brand ? `${base} (Make: ${p.brand})` : base
    blocks.push({ k: 'text', text: `${i + 1}. ${text} - ${qty} ${unit}` })
    items.push({ description: p.brand ? `${base} ${p.brand}` : base, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const qtyNosColumn: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 7))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), p.plain, `${qty} ${unit}`]
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true },
    { k: 'text', text: 'Request for Quotation', bold: true },
    { k: 'table', head: ['Sr.', 'Description', 'Qty'], rows, widths: [0.07, 0.7, 0.15], align: ['c', 'l', 'r'], ruled: true, descCol: 1 },
    { k: 'text', text: 'Kindly send your quotation at the earliest.' },
  ]
  return { doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 10 } }, truth: { items, company: c.name }, media: ['pdf', 'text', 'image'] }
}

export const kitneKaChat: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 4))
  const items: ItemTruth[] = []
  const msgs: ChatMsg[] = []
  const date = writeDate(r, dateAfter(0), 0)
  ps.forEach((p, i) => {
    const qty = Math.ceil(p.qty(r))
    const unit = unitFor(r, p, 'lower')
    msgs.push({ date, time: `14:0${i}`, name: c.person, lines: [`${p.plain} ${qty} ${unit} kitne ka hai?`] })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

export const exwCifQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'europe'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(2, 5)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const priced = lines.map(l => ({ ...l, price: r.pick([25, 70, 190, 640]) }))
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Mr. Wasif,' },
    { k: 'text', text: 'Please see our prices:' },
    {
      k: 'table',
      head: ['No.', 'Description', 'Qty', `Unit Price CIF Karachi (${cur})`],
      rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), l.price.toFixed(2)]),
      widths: [0.05, 0.55, 0.08, 0.24],
      align: ['c', 'l', 'r', 'r'],
      ruled: true,
      descCol: 1,
    },
    { k: 'text', text: 'Delivery: 5 weeks' },
    { k: 'text', text: s.person },
  ]
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: cur, leadMax: 35 })), unpriced: [], currency: cur },
    media: ['text', 'pdf', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN22 = [
  { shape: 'also_quote_on_ours', make: alsoQuoteOnOurs, weight: 3 },
  { shape: 'sr_colon_items', make: srColonItems, weight: 3 },
  { shape: 'desc_last_form', make: descLastForm, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN22 = [{ shape: 'quote_currency_in_cell', make: currencyInCellQuote, weight: 4 }]
export const ENQUIRY_TEMPLATES_GEN23 = [
  { shape: 'make_in_brackets', make: makeInBrackets, weight: 3 },
  { shape: 'qty_nos_column', make: qtyNosColumn, weight: 3 },
  { shape: 'kitne_ka_chat', make: kitneKaChat, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN23 = [{ shape: 'quote_exw_cif', make: exwCifQuote, weight: 4 }]
