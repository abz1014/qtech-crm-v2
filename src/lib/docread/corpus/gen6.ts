// Template generation 6: written after fresh batch 5 was folded into dev and passed; first checked on fresh batch 6.
// Variations: a spreadsheet range pasted without its heading (description, part number, quantity, unit), a list whose
// quantity sits in the middle of the line among the specifications, a WhatsApp list sent as several numbered messages with
// voice notes and photos between them, and a multi-page quotation with a "Unit Rate" and a "Del. Time" column.
// Every name and number is invented.

import type { Block, ChatMsg, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)

/** A spreadsheet range pasted without its heading: description, part number, quantity, unit. */
export const headerlessSheet: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 8)).filter(p => p.part)
  const use = ps.length ? ps : parts(r, 2)
  const items: ItemTruth[] = []
  const rows = use.map(p => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    const desc = p.part ? p.plain.replace(`, Model ${p.part}`, '').replace(` ${p.part}`, '') : p.plain
    items.push({ description: `${desc}${p.part ? ` ${p.part}` : ''}`, qty, unit, part: p.part ?? undefined })
    return [desc, p.part ?? '', String(qty), unit]
  })
  const blocks: Block[] = [
    { k: 'text', text: 'Dear Sir, please quote:' },
    { k: 'table', head: null, rows, widths: [0.5, 0.2, 0.08, 0.08], align: ['l', 'l', 'r', 'l'], ruled: false, descCol: 0 },
    { k: 'text', text: 'Regards,' },
    { k: 'text', text: c.person },
    { k: 'text', text: c.name },
  ]
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text'] }
}

/** "Pressure gauge, range 0-16 bar, qty 3 nos, 100mm dial, glycerine filled" */
export const midQuantity: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Respected Sir,' }, { k: 'text', text: 'Kindly quote for the items below.' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'lower')
    const qty = Math.ceil(p.qty(r))
    const words = p.plain.split(', ')
    const head = words[0] as string
    const rest = words.slice(1).join(', ')
    blocks.push({ k: 'text', text: `${i + 1}. ${head}, qty ${qty} ${unit}${rest ? `, ${rest}` : ''}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Thanks and regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

/** A WhatsApp list sent as numbered messages, with voice notes and photos between them. */
export const chatNumbered: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 6))
  const date = writeDate(r, dateAfter(-1), 0)
  const msgs: ChatMsg[] = [{ date, time: '09:30', name: c.person, lines: ['Sir in ka rate'] }]
  const items: ItemTruth[] = []
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'lower')
    const qty = Math.ceil(p.qty(r))
    msgs.push({ date, time: `09:${31 + i}`, name: c.person, lines: [`${i + 1}) ${p.plain} ${qty} ${unit}`] })
    if (r.chance(0.4)) msgs.push({ date, time: `09:${31 + i}`, name: c.person, lines: [], media: r.pick(['voice', 'image'] as const) })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  msgs.push({ date, time: '09:50', name: c.person, lines: ['Ye sab chahiye 🙏'] })
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text', 'image'] }
}

/** A multi-page quotation with "Unit Rate" and "Del. Time" columns and the heading repeated on each page. */
export const longQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'local'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(8, 16)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const priced = lines.map(l => ({ ...l, price: cur === 'PKR' ? r.pick([2500, 7800, 15400, 64000]) : r.pick([7.5, 26, 88, 310, 940]), wk: r.pick([2, 3, 4]) }))
  const blocks: Block[] = [
    { k: 'text', text: s.name, bold: true },
    { k: 'text', text: `Quotation for Q-Tech Engineering, ${writeDate(r, dateAfter(0), 3)}` },
    { k: 'table', head: ['Sr', 'Description', 'Qty', `Unit Rate (${cur})`, `Total (${cur})`, 'Del. Time'], rows: priced.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), cur === 'PKR' ? l.price.toLocaleString('en-US') : l.price.toFixed(2), cur === 'PKR' ? (l.price * l.qty).toLocaleString('en-US') : (l.price * l.qty).toFixed(2), `${l.wk} weeks`]), widths: [0.05, 0.47, 0.06, 0.14, 0.14, 0.12], align: ['c', 'l', 'r', 'r', 'r', 'c'], ruled: true, descCol: 1 },
    { k: 'text', text: 'Validity: 15 days' },
  ]
  return {
    doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9, rowsPerPage: 6, repeatHead: true, footer: 'Page {n} of {m}' } },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: priced.map(l => ({ itemId: l.id, unitPrice: l.price, currency: cur, leadMax: l.wk * 7, validityDays: 15 })), unpriced: [], currency: cur, validityDays: 15 },
    media: ['pdf', 'scan'],
  }
}

export const ENQUIRY_TEMPLATES_GEN6 = [
  { shape: 'headerless_sheet', make: headerlessSheet, weight: 3 },
  { shape: 'mid_quantity', make: midQuantity, weight: 3 },
  { shape: 'chat_numbered', make: chatNumbered, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN6 = [{ shape: 'quote_long', make: longQuote, weight: 4 }]
