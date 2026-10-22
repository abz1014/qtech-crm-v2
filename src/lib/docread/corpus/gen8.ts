// Template generations 8 and 9: written together after fresh batch 7 was folded into dev and passed; generation 8 first
// checked on fresh batch 8, generation 9 on fresh batch 9 (two consecutive fresh batches). Every name and number is invented.
//  8: an Outlook copy with its inline-image placeholders ("[cid:image001.png@...]", "[image: Logo]"), a requisition with an empty
//     "Estimated Rate" column, a forwarded WhatsApp list in *bold*, a WhatsApp quote with *Price:* labels.
//  9: a request that points at an attachment and lists more items, items lettered A) B) C), a landscape table running over
//     pages without its heading repeated, a quotation that declines some items in words.

import type { Block, ChatMsg, ItemTruth } from './model'
import type { EnquiryTemplate } from './enquiries'
import type { QuoteTemplate } from './quotes'
import type { Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

const unitFor = (r: Rng, p: Part, reg: 'caps' | 'title' | 'lower' | 'any') => writeUnit(r, unitFamily(r.pick(p.units)) as string, reg)

// ------------------------------------------------------------------------------------------------ generation 8

export const outlookImages: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: '[cid:image001.png@01DB2A4C.5F3E9A10]' }, { k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'Please quote:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${i + 1}. ${p.plain} - ${qty} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards,' }, { k: 'text', text: '[image: Logo]' }, { k: 'text', text: c.person }, { k: 'text', text: c.name }, { k: 'text', text: '[cid:image002.jpg@01DB2A4C.5F3E9A10]' })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text'] }
}

export const estimatedRate: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 8))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), p.plain, unit, String(qty), '', '']
  })
  const blocks: Block[] = [
    { k: 'text', text: `${c.name}`, bold: true, align: 'center' },
    { k: 'text', text: 'PURCHASE REQUISITION / ENQUIRY', bold: true, align: 'center' },
    { k: 'table', head: ['S.No', 'Item Description', 'Unit', 'Qty Req.', 'Estimated Rate', 'Amount'], rows, widths: [0.06, 0.48, 0.08, 0.1, 0.14, 0.12], align: ['c', 'l', 'c', 'r', 'r', 'r'], ruled: true, descCol: 1 },
  ]
  return { doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } }, truth: { items, company: c.name }, media: ['pdf', 'text', 'image'] }
}

export const boldChat: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 5))
  const items: ItemTruth[] = []
  const lines = ['Forwarded', '*Required items*']
  ps.forEach(p => {
    const unit = unitFor(r, p, 'lower')
    const qty = Math.ceil(p.qty(r))
    lines.push(`*${p.plain}* - ${qty} ${unit}`)
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  const msgs: ChatMsg[] = [{ date: writeDate(r, dateAfter(0), 0), time: '12:05', name: c.person, lines }]
  return { doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] }, truth: { items }, media: ['text'] }
}

export const boldQuote: QuoteTemplate = r => {
  const s = supplier(r, 'local')
  const lines = parts(r, r.int(1, 4)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const date = writeDate(r, dateAfter(1), 0)
  const msgs: ChatMsg[] = []
  const truth = lines.map((l, i) => {
    const price = r.pick([2500, 6800, 14500, 38000])
    msgs.push({ date, time: `16:0${i}`, name: s.person, lines: [`*${l.p.part ?? l.p.plain}*`, `*Price:* Rs ${price.toLocaleString('en-US')}/-`, '*Delivery:* 1 week'] })
    return { itemId: l.id, unitPrice: price, currency: 'PKR', leadMax: 7 }
  })
  return {
    doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: truth, unpriced: [], currency: 'PKR' },
    media: ['text'],
  }
}

// ------------------------------------------------------------------------------------------------ generation 9

export const attachmentAndMore: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(1, 4))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir,' }, { k: 'text', text: 'Please see the attached RFQ and also quote the following additional items:' }]
  ps.forEach(p => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `• ${p.plain} (${qty} ${unit})` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Regards,' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const letteredItems: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 6))
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: 'Dear Sir, kindly send rates for:' }]
  ps.forEach((p, i) => {
    const unit = unitFor(r, p, 'title')
    const qty = Math.ceil(p.qty(r))
    blocks.push({ k: 'text', text: `${'ABCDEFGH'[i]}) ${p.plain}, Qty ${qty} ${unit}` })
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
  })
  blocks.push({ k: 'text', text: 'Thanks' }, { k: 'text', text: c.person }, { k: 'text', text: c.name })
  return { doc: { look: 'email', blocks }, truth: { items, company: c.name }, media: ['text', 'image'] }
}

export const landscapeNoRepeat: EnquiryTemplate = r => {
  const c = customer(r)
  const ps = parts(r, r.int(10, 20))
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = Math.ceil(p.qty(r))
    items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    return [String(i + 1), p.plain, p.brand ?? '', String(qty), unit, r.pick(['', 'Critical', 'Stock'])]
  })
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true },
    { k: 'text', text: `Enquiry No. ${c.code}/${r.int(100, 999)}` },
    { k: 'table', head: ['Sr', 'Description', 'Make', 'Qty', 'Unit', 'Remarks'], rows, widths: [0.05, 0.5, 0.12, 0.07, 0.07, 0.12], align: ['c', 'l', 'l', 'r', 'c', 'l'], ruled: true, descCol: 1 },
  ]
  for (const it of items) {
    const brand = rows.find(rw => rw[1] === it.description)?.[2]
    if (brand && !it.description.includes(brand)) it.description = `${it.description} ${brand}`
  }
  const ref = (blocks[1] as { text: string }).text.replace('Enquiry No. ', '')
  return { doc: { look: 'sheet', blocks, page: { font: 'helvetica', size: 9, landscape: true, rowsPerPage: 7, repeatHead: false, footer: 'Page {n} of {m}' } }, truth: { items, ref, company: c.name }, media: ['pdf'] }
}

export const declineSome: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'europe'] as const))
  const cur = s.currency
  const lines = parts(r, r.int(3, 6)).map((p, i) => ({ id: `it${i + 1}`, p, qty: Math.ceil(p.qty(r)) }))
  const blocks: Block[] = [{ k: 'text', text: 'Dear Wasif,' }, { k: 'text', text: 'Please see below:' }]
  const truthLines: Array<{ itemId: string; unitPrice: number; currency: string; leadMax: number }> = []
  const unpriced: string[] = []
  lines.forEach((l, i) => {
    if (i % 3 === 2) {
      blocks.push({ k: 'text', text: `${i + 1}. ${l.p.plain}: ${r.pick(['not in our range', 'sorry, we cannot offer', 'discontinued by the maker'])}` })
      unpriced.push(l.id)
      return
    }
    const price = r.pick([16, 52, 140, 395])
    blocks.push({ k: 'text', text: `${i + 1}. ${l.p.plain}: ${cur} ${price}.00 each, 3 weeks` })
    truthLines.push({ itemId: l.id, unitPrice: price, currency: cur, leadMax: 21 })
  })
  blocks.push({ k: 'text', text: s.person })
  return {
    doc: { look: 'email', blocks },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: { lines: truthLines, unpriced, currency: cur },
    media: ['text', 'image'],
  }
}

export const ENQUIRY_TEMPLATES_GEN8 = [
  { shape: 'outlook_images', make: outlookImages, weight: 3 },
  { shape: 'estimated_rate', make: estimatedRate, weight: 3 },
  { shape: 'bold_chat', make: boldChat, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN8 = [{ shape: 'quote_bold_chat', make: boldQuote, weight: 4 }]
export const ENQUIRY_TEMPLATES_GEN9 = [
  { shape: 'attachment_and_more', make: attachmentAndMore, weight: 3 },
  { shape: 'lettered_items', make: letteredItems, weight: 3 },
  { shape: 'landscape_no_repeat', make: landscapeNoRepeat, weight: 3 },
]
export const QUOTE_TEMPLATES_GEN9 = [{ shape: 'quote_decline_some', make: declineSome, weight: 4 }]
