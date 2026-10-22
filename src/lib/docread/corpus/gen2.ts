// Template generation 2: written after fresh batch 1 was folded into dev and passed; first checked on fresh batch 2.
// New shapes: an email whose items sit under department headings, a terse SMS-style request with several items on one line,
// a page printed sideways (the text runs up the page), a quotation whose terms are a two-column table, and a quotation that
// prices some lines in one currency and some in another. Every name and number is invented.

import type { Block, ItemTruth, QuoteLineTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, parts, supplier, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)

/** Items grouped under headings ("Electrical:", "Instrumentation:"): the headings are not items. */
export const departmentHeadings: EnquiryTemplate = r => {
  const c = customer(r)
  const groups = r.sample(['Electrical:', 'Instrumentation:', 'Mechanical spares:', 'For ETP plant:', 'Boiler house:'], r.int(2, 3))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'Please quote the items below, department wise.' }, { k: 'gap' }]
  for (const g of groups) {
    blocks.push({ k: 'text', text: g, bold: true })
    parts(r, r.int(1, 4)).forEach((p, i) => {
      const unit = unitFor(r, p, 'title')
      const qty = Math.ceil(p.qty(r))
      blocks.push({ k: 'text', text: `${i + 1}. ${p.plain} - ${qty} ${unit}` })
      items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    })
    blocks.push({ k: 'gap' })
  }
  blocks.push({ k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

/** A terse request: "plz quote 3 contactor 32A + 2 overload relay 9-13A + 10 mtr cable". */
export const smsStyle: EnquiryTemplate = r => {
  const ps = parts(r, r.int(2, 4))
  const items: ItemTruth[] = []
  const bits = ps.map(p => {
    const unit = r.chance(0.5) ? unitFor(r, p, 'lower') : null
    const qty = Math.ceil(p.qty(r))
    const desc = p.plain.toLowerCase()
    items.push({ description: desc, qty, unit, part: p.part ? p.part.toLowerCase() : undefined })
    return unit ? `${qty} ${unit} ${desc}` : `${qty} x ${desc}`
  })
  const text = `${r.pick(['plz quote', 'rate pls', 'pls send rates'])}: ${bits.join(r.pick([' + ', ' & ', ' and ']))}`
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs: [{ date: '20/10/2026', time: '18:02', name: '+92 300 1112233', lines: [text] }] }] }, truth: { items }, media: ['text'] }
}

/** A list printed on a page that lies on its side: the text runs up the page (no /Rotate). */
export const sidewaysPage: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 8))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), p.plain, String(qty), unit]
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true, size: 12 },
    { k: 'text', text: `Requisition No: ${c.code}-${r.int(1000, 9999)}` },
    { k: 'table', head: ['S.No', 'Description', 'Qty', 'Unit'], rows, widths: [0.08, 0.62, 0.12, 0.12], align: ['c', 'l', 'r', 'c'], ruled: true, descCol: 1 },
  ]
  const ref = (blocks[1] as { text: string }).text.split(': ')[1] as string
  return { doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9.5, sideways: true } }, truth: { items, ref, company: c.name }, media: ['pdf'] }
}

function rfq(r: Rng, n: number) {
  return parts(r, n).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
}

/** A quotation whose terms are a two-column table ("Validity | 30 days", "Delivery | 6 weeks"). */
export const termsTable: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'europe'] as const))
  const cur = s.currency
  const lines = rfq(r, r.int(2, 6))
  const priced = lines.map(l => ({ ...l, price: r.pick([14.5, 38, 95, 210, 480, 1150]) }))
  const validity = r.pick([15, 30, 45])
  const lead = r.pick([{ t: '6 weeks', d: 42 }, { t: '4-5 weeks', d: 35 }, { t: '20 days', d: 20 }])
  const blocks: Block[] = [
    { k: 'text', text: s.name, bold: true, size: 13 },
    { k: 'text', text: 'QUOTATION', bold: true, align: 'center' },
    { k: 'table', head: ['Item', 'Description', 'Qty', `Unit Price (${cur})`, `Amount (${cur})`], rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), l.price.toFixed(2), (l.price * l.qty).toFixed(2)]), widths: [0.07, 0.53, 0.08, 0.16, 0.16], align: ['c', 'l', 'r', 'r', 'r'], ruled: true, descCol: 1 },
    { k: 'gap' },
    { k: 'table', head: null, rows: [['Validity', `${validity} days`], ['Delivery', lead.t], ['Payment', '30% advance, 70% against B/L copy'], ['Incoterm', 'FOB Shanghai']], widths: [0.2, 0.5], align: ['l', 'l'], ruled: true, descCol: 1 },
  ]
  return {
    doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: cur, leadMax: lead.d, validityDays: validity })), unpriced: [], currency: cur, validityDays: validity, payment: '30% advance, 70% against B/L copy' },
    media: ['pdf', 'image', 'text'],
  }
}

/** Some lines in USD, some in EUR (a trader quoting two principals). */
export const mixedCurrency: QuoteTemplate = r => {
  const lines = rfq(r, r.int(2, 5))
  const truth: QuoteLineTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Wasif,' }, { k: 'text', text: 'Prices from our two principals:' }]
  lines.forEach((l, i) => {
    const cur = i % 2 === 0 ? 'USD' : 'EUR'
    const price = r.pick([22, 64, 145, 380, 920])
    blocks.push({ k: 'text', text: `${i + 1}. ${l.p.plain}: ${cur} ${price}.00 per unit, ${r.pick(['delivery 3 weeks', 'lead time 3 weeks'])}` })
    truth.push({ itemId: l.id, unitPrice: price, currency: cur, leadMax: 21 })
  })
  blocks.push({ k: 'text', text: 'Regards,' }, { k: 'text', text: supplier(r, 'gulf').person })
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: truth, unpriced: [], currency: 'USD' },
    media: ['text', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN2 = [
  { shape: 'department_headings', make: departmentHeadings, weight: 3 },
  { shape: 'sms_style', make: smsStyle, weight: 2 },
  { shape: 'sideways_page', make: sidewaysPage, weight: 2 },
]
export const QUOTE_TEMPLATES_GEN2 = [
  { shape: 'quote_terms_table', make: termsTable, weight: 3 },
  { shape: 'quote_mixed_currency', make: mixedCurrency, weight: 2 },
]
