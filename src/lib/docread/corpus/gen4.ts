// Template generation 4: written after fresh batch 3 was folded into dev and passed; first checked on fresh batch 4.
// New shapes: a short reply on top of the customer's own earlier enquiry ("please add these"), a Microsoft Teams chat copied
// as text, an ERP form stamped with a diagonal COPY watermark, and a supplier writing the prices in sentences.
// Every name and number is invented.

import type { Block, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)

/** "Please add the following to our enquiry" on top, the customer's earlier message quoted under it: only the new items. */
export const replyOnTop: EnquiryTemplate = r => {
  const c = customer(r)
  const fresh = parts(r, r.int(1, 4))
  const old = parts(r, r.int(2, 4))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Wasif,' }, { k: 'text', text: 'Please add the following to our enquiry:' }]
  fresh.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${i + 1}. ${p.plain} - ${qty} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'gap' })
  blocks.push({ k: 'text', text: `From: ${c.person} <${c.email}>` }, { k: 'text', text: `Sent: ${writeDate(r, dateAfter(-3), 3)} 11:20` }, { k: 'text', text: 'To: sales@qtech.example' }, { k: 'text', text: 'Subject: Enquiry' }, { k: 'gap' })
  blocks.push({ k: 'text', text: 'Dear Sir, please quote:' })
  old.forEach((p, i) => blocks.push({ k: 'text', text: `${i + 1}. ${p.plain} - ${Math.ceil(p.qty(r))} Nos` }))
  return { doc: { look: 'email', blocks }, truth: { items, domain: c.domain }, media: ['text'] }
}

/** A Microsoft Teams chat copied as text: "Name  10:42 AM" over each message. */
export const teamsChat: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const items: ItemTruth[] = []
  const lines: string[] = [`${c.person}  ${r.int(9, 11)}:${String(r.int(10, 59)).padStart(2, '0')} AM`, 'Hi Wasif, need prices for these:']
  ps.forEach(p => {
    const unit = unitFor(r, p, 'lower')
    const qty = Math.ceil(p.qty(r))
    lines.push(`${p.plain} - ${qty} ${unit}`)
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  lines.push(`Wasif (Q-Tech)  ${r.int(11, 12)}:0${r.int(1, 9)} PM`, 'Noted, will share by evening.')
  return { doc: { look: 'email', blocks: lines.map(text => ({ k: 'text', text }) as Block) }, truth: { items }, media: ['text'] }
}

/** An ERP RFQ printout with a diagonal "COPY" watermark across the page. */
export const watermarkForm: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 8))
  const no = String(r.int(4500000000, 4500099999))
  const due = dateAfter(r.int(5, 20))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.erp, qty, unit, part: p.part ?? undefined })
    return [String((i + 1) * 10), p.erp, `${qty}.00`, unit]
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name.toUpperCase(), bold: true, align: 'center' },
    { k: 'text', text: 'REQUEST FOR QUOTATION', bold: true, align: 'center' },
    { k: 'pair', left: `RFQ No: ${no}`, right: `Reply by: ${writeDate(r, due, 1)}` },
    { k: 'table', head: ['Item', 'Material Description', 'Qty', 'UoM'], rows, widths: [0.08, 0.62, 0.12, 0.1], align: ['l', 'l', 'r', 'c'], ruled: false, descCol: 1 },
  ]
  return { doc: { look: 'paper', blocks, page: { font: 'courier', size: 9, watermark: 'COPY' } }, truth: { items, ref: no, due: due.iso, company: c.name }, media: ['pdf', 'scan'] }
}

function rfq(r: Rng, n: number) {
  return parts(r, n).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
}

/** Prices written in sentences: "For the pressure gauge we can offer USD 45.00 per piece, delivery 3 weeks." */
export const proseQuote: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'gulf', 'europe'] as const))
  const cur = s.currency
  const lines = rfq(r, r.int(1, 4))
  const sym = { USD: 'USD', EUR: 'EUR', CNY: 'RMB', AED: 'AED', PKR: 'PKR' }[cur]
  const blocks: Block[] = [{ k: 'text', text: 'Dear Wasif,' }, { k: 'text', text: 'Thank you for the enquiry.' }]
  const truth = lines.map(l => {
    const price = r.pick([18, 45, 96.5, 230, 740])
    const wk = r.pick([2, 3, 4, 6])
    blocks.push({ k: 'text', text: `For the ${l.p.plain} we can offer ${sym} ${price.toFixed(2)} per piece, with delivery in ${wk} weeks.` })
    return { itemId: l.id, unitPrice: price, currency: cur, leadMax: wk * 7 }
  })
  blocks.push({ k: 'text', text: 'Looking forward to your order.' }, { k: 'text', text: s.person })
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: truth, unpriced: [], currency: cur },
    media: ['text', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN4 = [
  { shape: 'reply_on_top', make: replyOnTop, weight: 3 },
  { shape: 'teams_chat', make: teamsChat, weight: 3 },
  { shape: 'watermark_form', make: watermarkForm, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN4 = [{ shape: 'quote_prose', make: proseQuote, weight: 4 }]
