// Template generations 16 and 17: written together after fresh batch 17 was folded into dev and passed; generation 16 first
// checked on fresh batch 18, generation 17 on fresh batch 19 (two consecutive fresh batches). Every name and number is invented.
// 16: a table followed by "Total items: 6", items with a "Brand: X / Qty: 4 Pcs" line under each, a PDF letter with
//     "Ref: ... Dated: ..." on one line and a last date of submission, a Gulf quotation with prices excluding VAT.
// 17: a WhatsApp voice note then a list with bare quantities after a dash, bullets with sub-bullets for size and quantity,
//     a requisition whose Remarks column has numbers in it, a quotation over several PDF pages with page footers.

import type { Block, ChatMsg, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)
const withoutBrand = (p: Part) => (p.brand ? p.plain.replace(`${p.brand} `, '') : p.plain)

// ------------------------------------------------------------------------------------------------ generation 16

export const totalItemsLine: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 8))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), p.plain, String(qty), unit]
  })
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Sir,' },
    { k: 'text', text: 'Please send quotation for the following:' },
    { k: 'table', head: ['Sr#', 'Description', 'Qty', 'Unit'], rows, widths: [0.07, 0.65, 0.1, 0.1], align: ['c', 'l', 'r', 'c'], ruled: true, descCol: 1 },
    { k: 'text', text: `Total items: ${ps.length}` },
    { k: 'text', text: 'Regards,' },
    { k: 'text', text: c.person },
    { k: 'text', text: c.name },
  ]
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'pdf', 'image'] }
}

export const brandQtyLine: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Wasif,' }, { k: 'text', text: 'Please quote the items below:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    const brand = p.brand ?? 'Any reputable make'
    const base = withoutBrand(p)
    blocks.push({ k: 'text', text: `${i + 1}. ${base}` }, { k: 'text', text: `Brand: ${brand} / Qty: ${qty} ${unit}`, indent: 3 })
    items.push({ description: `${base} ${brand}`, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Thanks,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const refDatedLetter: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 7))
  const ref = `${c.code}/PUR/${r.int(100, 999)}/2026`
  const due = dateAfter(r.int(7, 21))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), p.plain, unit, String(qty)]
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true, size: 13, align: 'center' },
    { k: 'text', text: c.address, align: 'center' },
    { k: 'gap' },
    { k: 'text', text: `Ref: ${ref}          Dated: ${writeDate(r, dateAfter(-1), 8)}` },
    { k: 'text', text: 'M/s Q-Tech Engineering, Lahore' },
    { k: 'text', text: 'Subject: Request for quotation' },
    { k: 'text', text: 'Dear Sir, we are interested in purchasing the following items:' },
    { k: 'table', head: ['S.No', 'Description', 'Unit', 'Qty'], rows, widths: [0.07, 0.65, 0.1, 0.1], align: ['c', 'l', 'c', 'r'], ruled: true, descCol: 1 },
    { k: 'text', text: `Last date of submission: ${writeDate(r, due, 1)}` },
    { k: 'text', text: 'Purchase Manager' },
  ]
  return { doc: { look: 'paper', blocks, page: { font: 'times', size: 10.5 } }, truth: { items, ref, due: due.iso, company: c.name }, media: ['pdf', 'image'] }
}

export const vatExcludedQuote: QuoteTemplate = r => {
  const s = supplier(r, 'gulf')
  const lines = parts(r, r.int(2, 6)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const priced = lines.map(l => ({ ...l, price: r.pick([75, 190, 420, 1350, 2800]) }))
  const sub = priced.reduce((n, l) => n + l.price * l.qty, 0)
  const blocks: Block[] = [
    { k: 'text', text: `${s.name} - Quotation`, bold: true },
    { k: 'text', text: 'To: Q-Tech Engineering' },
    {
      k: 'table',
      head: ['#', 'Description', 'Qty', 'Unit Price (AED, excl. VAT)', 'Amount (AED)'],
      rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), l.price.toFixed(2), (l.price * l.qty).toFixed(2)]),
      widths: [0.05, 0.47, 0.07, 0.18, 0.15],
      align: ['c', 'l', 'r', 'r', 'r'],
      ruled: true,
      descCol: 1,
      foot: [['', 'Sub total', '', '', sub.toFixed(2)], ['', 'VAT 5%', '', '', (sub * 0.05).toFixed(2)], ['', 'Grand total', '', '', (sub * 1.05).toFixed(2)]],
    },
    { k: 'text', text: 'Delivery: 2-3 weeks' },
    { k: 'text', text: 'Validity: 15 days' },
    { k: 'text', text: s.person },
  ]
  return {
    doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: 'AED', leadMax: 21, validityDays: 15 })), unpriced: [], currency: 'AED', validityDays: 15 },
    media: ['text', 'pdf', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ generation 17

export const voiceThenList: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const date = writeDate(r, dateAfter(0), 0)
  const lines = ['Ye list hai sir:']
  ps.forEach(p => {
    const qty = Math.ceil(p.qty(r))
    lines.push(`${p.plain} - ${qty}`)
    items.push({ description: p.plain, qty, unit: null, part: p.part ?? undefined })
  })
  const msgs: ChatMsg[] = [
    { date, time: '13:30', name: c.person, lines: [], media: 'voice' },
    { date, time: '13:31', name: c.person, lines },
  ]
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

export const subBullets: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Hi,' }, { k: 'text', text: 'We need a quotation for:' }]
  ps.forEach(p => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `• ${p.plain}` }, { k: 'text', text: `- Qty: ${qty} ${unit}`, indent: 4 })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const remarksNumbers: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 8))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    const remark = r.pick(['', `For line ${r.int(1, 4)}`, `Old PO ${r.int(4500000, 4599999)}`, `${r.int(2, 6)} in stock, balance required`, 'Urgent'])
    return [String(i + 1), p.plain, String(qty), unit, remark]
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true },
    { k: 'text', text: 'Material Requisition', bold: true },
    { k: 'table', head: ['S.No', 'Description', 'Qty', 'UOM', 'Remarks'], rows, widths: [0.06, 0.5, 0.08, 0.08, 0.22], align: ['c', 'l', 'r', 'c', 'l'], ruled: true, descCol: 1 },
    { k: 'text', text: 'Requested by: Maintenance' },
  ]
  return { doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } }, truth: { items, company: c.name }, media: ['pdf', 'text', 'image'] }
}

export const multiPageQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'europe'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(10, 16)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const priced = lines.map(l => ({ ...l, price: r.pick([8.5, 22, 64, 150, 480, 1250]) }))
  const blocks: Block[] = [
    { k: 'text', text: `${s.name}`, bold: true },
    { k: 'text', text: `Quotation No. Q-${r.int(10000, 99999)}` },
    {
      k: 'table',
      head: ['Item', 'Description', 'Qty', `Unit Price ${cur}`, `Amount ${cur}`, 'Lead time'],
      rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), l.price.toFixed(2), (l.price * l.qty).toFixed(2), '3-4 weeks']),
      widths: [0.05, 0.47, 0.07, 0.13, 0.13, 0.12],
      align: ['c', 'l', 'r', 'r', 'r', 'c'],
      ruled: true,
      descCol: 1,
    },
    { k: 'text', text: 'Payment: 100% T/T before shipment' },
    { k: 'text', text: s.person },
  ]
  return {
    doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9, rowsPerPage: 6, repeatHead: true, footer: 'Page {n} of {m}' } },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: cur, leadMax: 28 })), unpriced: [], currency: cur, payment: '100% T/T before shipment' },
    media: ['pdf'],
  }
}

export const ENQUIRY_TEMPLATES_GEN16 = [
  { shape: 'total_items_line', make: totalItemsLine, weight: 3 },
  { shape: 'brand_qty_line', make: brandQtyLine, weight: 3 },
  { shape: 'ref_dated_letter', make: refDatedLetter, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN16 = [{ shape: 'quote_vat_excluded', make: vatExcludedQuote, weight: 4 }]
export const ENQUIRY_TEMPLATES_GEN17 = [
  { shape: 'voice_then_list', make: voiceThenList, weight: 3 },
  { shape: 'sub_bullets', make: subBullets, weight: 3 },
  { shape: 'remarks_numbers', make: remarksNumbers, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN17 = [{ shape: 'quote_multi_page', make: multiPageQuote, weight: 4 }]
