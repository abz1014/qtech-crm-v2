// Template generation 5: written after fresh batch 4 was folded into dev and passed; first checked on fresh batch 5.
// Variations on everyday shapes written another way: an Outlook table with a header row and a required-date column, items as
// labelled blocks ("Description:" / "Required Qty:" / "Make:"), items in square brackets with an em dash, and a supplier
// answering each item as a small block ("Item:" / "Price:" / "Delivery:"). Every name and number is invented.

import type { Block, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)

/** An Outlook table with a header row: Sr | Description | Qty | Unit | Required Date. */
export const outlookHeaderDate: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 9))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    const desc = `${p.caps}-0${r.int(1, 3)}`
    items.push({ description: desc, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), desc, String(qty), unit, writeDate(r, dateAfter(r.int(20, 60)), 0)]
  })
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Sir,' },
    { k: 'text', text: 'Please share your quotation for the following.' },
    { k: 'table', head: ['Sr.', 'DESCRIPTION', 'QTY', 'UNIT', 'REQUIRED DATE'], rows, widths: [0.06, 0.55, 0.08, 0.08, 0.15], align: ['c', 'l', 'r', 'c', 'c'], ruled: true, descCol: 1 },
    { k: 'text', text: 'Regards,' },
    { k: 'text', text: c.person },
    { k: 'text', text: c.title },
    { k: 'text', text: c.name },
  ]
  return { doc: { look: 'email', email: { from: `${c.person} <${c.email}>`, sent: 'Tue 20/10/2026 10:02', to: 'sales@qtech.example', subject: 'RFQ' }, blocks }, truth: { items, company: c.name, domain: c.domain }, media: ['text', 'image'] }
}

/** Each item a labelled block: "Description: ..." / "Required Qty: 4 Sets" / "Make: ...". */
export const labelledBlocks: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'Please quote as per details below.' }, { k: 'gap' }]
  for (const p of ps) {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    const base = p.brand ? p.plain.replace(`${p.brand} `, '') : p.plain
    blocks.push({ k: 'text', text: `Description: ${base}` })
    blocks.push({ k: 'text', text: `${r.pick(['Required Qty', 'Qty', 'Quantity'])}: ${qty} ${unit}` })
    if (p.brand) blocks.push({ k: 'text', text: `Make: ${p.brand}` })
    blocks.push({ k: 'gap' })
    items.push({ description: `${base}${p.brand ? ` ${p.brand}` : ''}`, qty, unit, part: p.part ?? undefined })
  }
  blocks.push({ k: 'text', text: 'Best regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

/** "[1] Pressure gauge 0-10 bar — 2 pcs" */
export const bracketItems: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Hello,' }, { k: 'text', text: 'Rates required for:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'lower')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `[${i + 1}] ${p.plain} — ${qty} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Thanks,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text'] }
}

/** The supplier answers each item as a small block: Item / Price / Delivery. */
export const blockQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'gulf'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(1, 5)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const sym = { USD: 'USD', EUR: 'EUR', CNY: 'RMB', AED: 'AED', PKR: 'PKR' }[cur]
  const blocks: Block[] = [{ k: 'text', text: 'Hi Wasif,' }, { k: 'text', text: 'Our offer:' }, { k: 'gap' }]
  const truth = lines.map(l => {
    const price = r.pick([9.8, 36, 120, 455, 980])
    const wk = r.pick([1, 2, 3, 5])
    blocks.push({ k: 'text', text: `Item: ${l.p.part ?? l.p.plain}` }, { k: 'text', text: `Price: ${sym} ${price} / pc` }, { k: 'text', text: `Delivery: ${wk} weeks` }, { k: 'gap' })
    return { itemId: l.id, unitPrice: price, currency: cur, leadMax: wk * 7, validityDays: 20 }
  })
  blocks.push({ k: 'text', text: 'Validity: 20 days' }, { k: 'text', text: 'Thanks' }, { k: 'text', text: s.person })
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: truth, unpriced: [], currency: cur, validityDays: 20 },
    media: ['text', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN5 = [
  { shape: 'outlook_header_date', make: outlookHeaderDate, weight: 3 },
  { shape: 'labelled_blocks', make: labelledBlocks, weight: 3 },
  { shape: 'bracket_items', make: bracketItems, weight: 2 },
]
export const QUOTE_TEMPLATES_GEN5 = [{ shape: 'quote_blocks', make: blockQuote, weight: 4 }]
