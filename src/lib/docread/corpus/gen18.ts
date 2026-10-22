// Template generations 18 and 19: written together after fresh batch 19 was folded into dev and passed; generation 18 first
// checked on fresh batch 20, generation 19 on fresh batch 21 (two consecutive fresh batches). Every name and number is invented.
// 18: an Outlook table with quantities written "2.00", a numbered list whose items wrap onto an unindented second line with
//     the quantity, an indent number as the reference, a European quotation with "1.250,00 €" prices.
// 19: quantities written "02 Nos" after a bracketed number, an "external email" caution banner above the request, a list with
//     the unit before the number ("Nos 4"), a quotation with the currency after the amount ("45 USD each").

import type { Block, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)

// ------------------------------------------------------------------------------------------------ generation 18

export const decimalQtyTable: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 7))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [`${i + 1}.`, p.plain, qty.toFixed(2), unit]
  })
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Sir,' },
    { k: 'text', text: 'Kindly provide your quotation for the following material.' },
    { k: 'table', head: ['Sl.', 'Material Description', 'Quantity', 'Unit'], rows, widths: [0.06, 0.64, 0.12, 0.1], align: ['c', 'l', 'r', 'c'], ruled: true, descCol: 1 },
    { k: 'text', text: 'Best Regards' },
    { k: 'text', text: c.person },
    { k: 'text', text: c.name },
  ]
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const wrappedNoIndent: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Sir, please quote:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    const words = p.plain.split(' ')
    if (words.length >= 4) {
      const cut = Math.ceil(words.length / 2)
      blocks.push({ k: 'text', text: `${i + 1}. ${words.slice(0, cut).join(' ')}` }, { k: 'text', text: `${words.slice(cut).join(' ')} - ${qty} ${unit}` })
    } else blocks.push({ k: 'text', text: `${i + 1}. ${p.plain} - ${qty} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const indentRef: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const ref = `2026/MNT/${String(r.int(1, 999)).padStart(4, '0')}`
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: `Please quote against our Indent No. ${ref} for the items below:` }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${i + 1}- ${p.plain}, ${qty} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, ref, company: c.name }, media: ['text', 'image'] }
}

export const euroCommaQuote: QuoteTemplate = r => {
  const s = supplier(r, 'europe')
  const lines = parts(r, r.int(2, 5)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const priced = lines.map(l => ({ ...l, price: r.pick([18.4, 96.5, 312, 1250, 4780]) }))
  const eu = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const blocks: Block[] = [
    { k: 'text', text: 'Sehr geehrter Herr Wasif, dear Mr. Wasif,' },
    { k: 'text', text: 'please find our offer:' },
    {
      k: 'table',
      head: ['Pos.', 'Beschreibung / Description', 'Menge', 'Einzelpreis', 'Gesamtpreis'],
      rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), `${eu(l.price)} €`, `${eu(l.price * l.qty)} €`]),
      widths: [0.05, 0.5, 0.08, 0.15, 0.15],
      align: ['c', 'l', 'r', 'r', 'r'],
      ruled: true,
      descCol: 1,
    },
    { k: 'text', text: 'Lieferzeit / delivery: 4 weeks' },
    { k: 'text', text: s.person },
  ]
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: 'EUR', leadMax: 28 })), unpriced: [], currency: 'EUR' },
    media: ['text', 'pdf', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ generation 19

export const paddedQty: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'Required following items, please quote:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `(${i + 1}) ${String(qty).padStart(2, '0')} ${unit} - ${p.plain}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const cautionBanner: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [
    { k: 'text', text: 'CAUTION: This email originated from outside of the organization. Do not click links or open attachments unless you recognize the sender and know the content is safe.' },
    { k: 'text', text: 'Dear Sir,' },
    { k: 'text', text: 'Please quote your best price and delivery for:' },
  ]
  ps.forEach(p => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `- ${p.plain}: ${qty} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Thanks' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const unitBeforeNumber: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'AoA,' }, { k: 'text', text: 'Rates required for:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${i + 1}. ${p.plain} -- ${unit} ${qty}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const currencyAfterQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'gulf'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(1, 5)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const blocks: Block[] = [{ k: 'text', text: `Dear Wasif, ${writeDate(r, dateAfter(1), 3)}` }, { k: 'text', text: 'Our offer as below:' }]
  const truth = lines.map((l, i) => {
    const price = r.pick([12, 45, 88, 230, 610])
    blocks.push({ k: 'text', text: `${i + 1}. ${l.p.plain} -> ${price} ${cur} each, delivery 10 days` })
    return { itemId: l.id, unitPrice: price, currency: cur, leadMax: 10 }
  })
  blocks.push({ k: 'text', text: s.person })
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: truth, unpriced: [], currency: cur },
    media: ['text', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN18 = [
  { shape: 'decimal_qty_table', make: decimalQtyTable, weight: 3 },
  { shape: 'wrapped_no_indent', make: wrappedNoIndent, weight: 3 },
  { shape: 'indent_ref', make: indentRef, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN18 = [{ shape: 'quote_euro_comma', make: euroCommaQuote, weight: 4 }]
export const ENQUIRY_TEMPLATES_GEN19 = [
  { shape: 'padded_qty', make: paddedQty, weight: 3 },
  { shape: 'caution_banner', make: cautionBanner, weight: 3 },
  { shape: 'unit_before_number', make: unitBeforeNumber, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN19 = [{ shape: 'quote_currency_after', make: currencyAfterQuote, weight: 4 }]
