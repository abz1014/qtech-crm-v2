// Template generation 3: written after fresh batch 2 was folded into dev and passed; first checked on fresh batch 3.
// New shapes: items listed inside one sentence, a spreadsheet with a two-row heading, an email whose signature is a table, a
// quotation whose lead time is a "Wks" column, a proforma invoice with HS codes. Every name and number is invented.

import type { Block, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)

/** "We require 2 nos pressure transmitters 0-10 bar, 4 nos ball valves 1 inch and 10 nos cable glands PG16." */
export const sentenceItems: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 4))
  const items: ItemTruth[] = []
  const bits = ps.map(p => {
    const unit = writeUnit(r, 'nos', r.pick(['lower', 'title']))
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return `${qty} ${unit} ${p.plain}`
  })
  const sentence = `${r.pick(['We require', 'Kindly quote for', 'Please quote'])} ${bits.slice(0, -1).join('; ')} and ${bits[bits.length - 1]}.`
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: sentence }, { k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name }]
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text'] }
}

/** A spreadsheet whose heading takes two rows: a group row ("ITEM DETAILS", "REQUIREMENT") over the real headings. */
export const twoRowHeading: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(3, 10))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), p.plain, String(qty), unit, r.pick(['', 'Urgent', 'Stock'])]
  })
  const blocks: Block[] = [
    { k: 'text', text: `${c.name} - Purchase Requisition`, bold: true },
    { k: 'table', head: ['', 'ITEM DETAILS', 'REQUIREMENT', '', ''], rows: [['S.No', 'Description', 'Qty', 'UOM', 'Remarks'], ...rows], widths: [0.08, 0.55, 0.1, 0.1, 0.15], align: ['c', 'l', 'r', 'c', 'l'], ruled: true, descCol: 1 },
  ]
  return { doc: { look: 'sheet', blocks, page: { font: 'helvetica', size: 9 } }, truth: { items, company: c.name }, media: ['text', 'pdf', 'image'] }
}

/** An Outlook enquiry whose signature is laid out as a table (name and title left, phone and address right). */
export const signatureTable: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Hi,' }, { k: 'text', text: 'Need your best price for:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${i + 1}. ${p.plain} - ${qty} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push(
    { k: 'gap' },
    { k: 'text', text: 'Thanks,' },
    { k: 'table', head: null, rows: [[c.person, `Mob: ${c.phone}`], [c.title, `Tel: ${c.landline}`], [c.name, c.address]], widths: [0.35, 0.5], align: ['l', 'l'], ruled: false, descCol: 0 },
  )
  return { doc: { look: 'email', email: { from: `${c.person} <${c.email}>`, sent: 'Mon 19/10/2026 09:12', to: 'sales@qtech.example', subject: 'Price required' }, blocks }, truth: { items, company: c.name, domain: c.domain }, media: ['text', 'image'] }
}

function rfq(r: Rng, n: number) {
  return parts(r, n).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
}

/** A quotation table with lead time as a bare number under a "Wks" heading. */
export const weeksColumn: QuoteTemplate = r => {
  const s = supplier(r, 'europe')
  const cur = s.currency
  const lines = rfq(r, r.int(2, 7))
  const priced = lines.map(l => ({ ...l, price: r.pick([19.9, 48, 112, 365, 780]), wks: r.pick([2, 4, 6, 8]) }))
  const blocks: Block[] = [
    { k: 'text', text: s.name, bold: true },
    { k: 'text', text: 'Angebot / Quotation', bold: true },
    { k: 'table', head: ['Pos', 'Description', 'Qty', `Unit ${cur}`, `Total ${cur}`, 'Wks'], rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), l.price.toFixed(2), (l.price * l.qty).toFixed(2), String(l.wks)]), widths: [0.06, 0.5, 0.07, 0.13, 0.14, 0.07], align: ['c', 'l', 'r', 'r', 'r', 'c'], ruled: r.chance(0.5), descCol: 1 },
    { k: 'text', text: 'Delivery times in weeks after order. Offer valid 30 days.' },
  ]
  return {
    doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: cur, leadMax: l.wks * 7, validityDays: 30 })), unpriced: [], currency: cur, validityDays: 30 },
    media: ['pdf', 'text', 'image'],
  }
}

/** A proforma invoice with an HS code column and a validity date. */
export const hsCodes: QuoteTemplate = r => {
  const s = supplier(r, 'china')
  const cur = 'USD'
  const lines = rfq(r, r.int(2, 6))
  const priced = lines.map(l => ({ ...l, price: r.pick([6.5, 23, 88, 145, 610]) }))
  const until = dateAfter(r.pick([14, 21, 30]))
  const days = Math.round((Date.UTC(until.y, until.m - 1, until.d) - Date.UTC(2026, 9, 20)) / 86_400_000)
  const blocks: Block[] = [
    { k: 'text', text: s.name, bold: true },
    { k: 'text', text: 'PROFORMA INVOICE', bold: true, align: 'center' },
    { k: 'pair', left: 'Consignee: Q-Tech Engineering, Lahore', right: `PI No: PI${r.int(2026100, 2026999)}` },
    { k: 'table', head: ['No.', 'Commodity', 'HS Code', 'Qty', 'Unit Price USD', 'Amount USD'], rows: priced.map((l, i) => [String(i + 1), l.p.plain, `${r.int(8471, 9032)}.${r.int(10, 90)}.${r.int(10, 99)}`, String(l.qty), l.price.toFixed(2), (l.price * l.qty).toFixed(2)]), widths: [0.06, 0.44, 0.13, 0.07, 0.15, 0.15], align: ['c', 'l', 'c', 'r', 'r', 'r'], ruled: true, descCol: 1 },
    { k: 'text', text: `Valid until: ${writeDate(r, until, 3)}` },
    { k: 'text', text: 'Shipment: within 15 days after deposit' },
    { k: 'text', text: 'Terms: FOB Ningbo' },
  ]
  return {
    doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: cur, leadMax: 15, validityDays: days })), unpriced: [], currency: cur, validityDays: days, incoterm: 'FOB Ningbo' },
    media: ['pdf', 'scan'],
  }
}

export const ENQUIRY_TEMPLATES_GEN3 = [
  { shape: 'sentence_items', make: sentenceItems, weight: 2 },
  { shape: 'two_row_heading', make: twoRowHeading, weight: 3 },
  { shape: 'signature_table', make: signatureTable, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN3 = [
  { shape: 'quote_weeks_column', make: weeksColumn, weight: 3 },
  { shape: 'quote_hs_codes', make: hsCodes, weight: 3 },
]
