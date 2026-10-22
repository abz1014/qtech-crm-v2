// Fictional supplier quotations in the shapes suppliers send them: an email with one offer per line, an email or PDF with a
// price table (totals, terms and bank details under it), a Chinese supplier's email (￥, 天), a WhatsApp reply, a local trader's
// rupee quote, a proforma invoice. The RFQ the quote answers is part of the case: the reader matches each offer to an RFQ item.

import type { Block, ChatMsg, Doc, QuoteCase, QuoteLineTruth, QuoteTruth } from './model'
import type { Rng } from './rng'
import { dateAfter, parts, supplier, writeDate, type Part, type Supplier } from './vocab'

export interface QuoteDraft {
  doc: Doc
  rfq: QuoteCase['rfq']
  truth: QuoteTruth
  media: Array<'text' | 'pdf' | 'image' | 'scan'>
}

export type QuoteTemplate = (r: Rng) => QuoteDraft

interface Line {
  id: string
  p: Part
  qty: number
  price: number | null
  lead: { text: string; max: number } | null
}

const CUR_WRITE: Record<string, string[]> = {
  USD: ['USD ', 'US$ ', '$', 'USD'],
  EUR: ['EUR ', '€', '€ ', 'EUR'],
  CNY: ['RMB ', '￥', 'CNY ', '¥'],
  AED: ['AED ', 'AED', 'Dhs '],
  PKR: ['Rs. ', 'PKR ', 'Rs.', 'Rs '],
}

function price(r: Rng, cur: string): number {
  const base = r.pick([8.8, 12.5, 18, 26.4, 45, 68, 95, 120, 150, 235, 310, 480, 650, 890, 1250, 2400])
  const mult = cur === 'PKR' ? 280 : cur === 'CNY' ? 7 : cur === 'AED' ? 3.7 : cur === 'EUR' ? 0.92 : 1
  const v = base * mult
  return cur === 'PKR' ? Math.round(v / 50) * 50 : Math.round(v * 100) / 100
}

function money(r: Rng, cur: string, v: number, withCur = true): string {
  const s = cur === 'PKR' ? `${v.toLocaleString('en-US')}${r.chance(0.5) ? '/-' : ''}` : r.chance(0.6) ? v.toFixed(2) : String(v)
  if (!withCur) return s
  const w = r.pick(CUR_WRITE[cur] as string[])
  return w.length > 1 && /[A-Z]$/.test(w) && r.chance(0.3) ? `${s} ${w.trim()}` : `${w}${s}`
}

function lead(r: Rng): { text: string; max: number } {
  return r.pick([
    { text: '4-6 weeks', max: 42 },
    { text: '2-3 weeks', max: 21 },
    { text: '6-8 weeks', max: 56 },
    { text: '3 weeks', max: 21 },
    { text: '10-12 working days', max: 17 },
    { text: '5-7 days', max: 7 },
    { text: '2 weeks', max: 14 },
    { text: 'ex-stock', max: 0 },
    { text: '8 weeks', max: 56 },
    { text: '30 days', max: 30 },
  ])
}

function makeRfq(r: Rng, n: number): Line[] {
  return parts(r, n).map((p, i) => ({ id: `it${i + 1}`, p, qty: p.qty(r), price: null, lead: null }))
}

function rfqOf(lines: Line[]): QuoteCase['rfq'] {
  return lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' }))
}

function terms(r: Rng, s: Supplier): { blocks: Block[]; validity: number; payment: string; incoterm?: string } {
  const validity = r.pick([7, 15, 30, 30, 45, 60])
  const payment = r.pick(['100% T/T in advance', '50% advance, 50% before shipment', '30 days credit', 'L/C at sight', '100% advance with PO'])
  const inc = s.region === 'local' ? undefined : r.pick(['FOB Shanghai', 'EXW Hamburg', 'CIF Karachi', 'FOB Ningbo', 'EXW Dubai', 'CFR Karachi'])
  const blocks: Block[] = [
    { k: 'text', text: r.pick([`Price validity: ${validity} days`, `Validity: ${validity} days`, `Offer valid for ${validity} days`, `Quotation valid for ${validity} days from date.`]) },
    { k: 'text', text: r.pick([`Payment: ${payment}`, `Payment terms: ${payment}`, `Terms of payment: ${payment}`]) },
  ]
  if (inc) blocks.push({ k: 'text', text: r.pick([`Delivery terms: ${inc}`, `Price basis: ${inc}`, `Incoterms: ${inc}`]) })
  return { blocks, validity, payment, incoterm: inc }
}

/** Prices for all but (sometimes) one line. `perLineLead`: every priced line names its lead time; 'some': a few do; false: none. */
function priced(r: Rng, lines: Line[], cur: string, perLineLead: boolean | 'some'): Line[] {
  const skip = lines.length > 2 && r.chance(0.3) ? r.int(0, lines.length - 1) : -1
  return lines.map((l, i) => (i === skip ? l : { ...l, price: price(r, cur), lead: perLineLead === true || (perLineLead === 'some' && r.chance(0.2)) ? lead(r) : null }))
}

function truthOf(lines: Line[], cur: string, t: { validity?: number; payment?: string; incoterm?: string; quoteRef?: string }, quoteLead: { max: number } | null): QuoteTruth {
  const out: QuoteLineTruth[] = lines
    .filter(l => l.price !== null)
    .map(l => ({ itemId: l.id, unitPrice: l.price as number, currency: cur, leadMax: l.lead?.max ?? quoteLead?.max, validityDays: t.validity }))
  return { lines: out, unpriced: lines.filter(l => l.price === null).map(l => l.id), currency: cur, validityDays: t.validity, payment: t.payment, incoterm: t.incoterm, quoteRef: t.quoteRef }
}

const name = (r: Rng, l: Line) => (l.p.part && r.chance(0.6) ? r.pick([`${l.p.part}`, `${l.p.plain}`]) : l.p.plain)

// ------------------------------------------------------------------------------------------------ 1. Email, one offer per line

export const quoteEmailLines: QuoteTemplate = r => {
  const s = supplier(r)
  const cur = s.currency
  const rfqLines = makeRfq(r, r.int(1, 7))
  const perLineLead = r.chance(0.5)
  const lines = priced(r, rfqLines, cur, perLineLead || 'some')
  const t = terms(r, s)
  const quoteLead = perLineLead ? null : lead(r)
  const blocks: Block[] = [
    { k: 'text', text: r.pick(['Dear Wasif,', 'Dear Sir,', 'Hi Wasif,', 'Dear Mr. Wasif,']) },
    { k: 'gap' },
    { k: 'text', text: r.pick(['Thanks for your inquiry. Please find our best offer as below:', 'Thank you for your RFQ. Our prices are as follows:', 'Good day! Kindly check our quotation below.']) },
    { k: 'gap' },
  ]
  const style = r.int(0, 3)
  lines.forEach((l, i) => {
    const nm = name(r, l)
    if (l.price === null) {
      blocks.push({ k: 'text', text: `${i + 1}. ${nm}: ${r.pick(['Sorry, not available.', 'discontinued, no replacement', 'Regret, we cannot offer this item.'])}` })
      return
    }
    const pr = money(r, cur, l.price)
    const ld = l.lead ? r.pick([`, delivery ${l.lead.text}`, `, lead time ${l.lead.text}`, ` - ${l.lead.text}`]) : ''
    if (style === 0) blocks.push({ k: 'text', text: `${i + 1}. ${nm} - ${pr}/${r.pick(['pc', 'pcs', 'unit', 'set'])}${ld}` })
    else if (style === 1) blocks.push({ k: 'text', text: `${i + 1}) ${nm}, Qty ${l.qty}, unit price ${pr}${ld}` })
    else if (style === 2) {
      blocks.push({ k: 'text', text: `Item ${i + 1}: ${nm}` })
      blocks.push({ k: 'text', text: `Unit price: ${pr}` })
      if (l.lead) blocks.push({ k: 'text', text: `Lead time: ${l.lead.text}` })
      blocks.push({ k: 'gap' })
    } else blocks.push({ k: 'text', text: `${nm} @ ${pr} each${ld}` })
  })
  blocks.push({ k: 'gap' })
  if (quoteLead) blocks.push({ k: 'text', text: r.pick([`Delivery: ${quoteLead.text}`, `Lead time: ${quoteLead.text} after PO`]) })
  blocks.push(...t.blocks, { k: 'gap' }, { k: 'text', text: r.pick(['Best regards', 'Regards,', 'Thanks & best regards']) }, { k: 'text', text: s.person }, { k: 'text', text: s.name }, { k: 'text', text: `Tel: ${s.phone}` })
  return {
    doc: { look: 'email', email: { from: `${s.person} <${s.email}>`, sent: 'Wednesday, October 21, 2026 9:14 AM', to: 'sales@qtech.example', subject: 'RE: RFQ - Q-Tech' }, blocks },
    rfq: rfqOf(rfqLines),
    truth: truthOf(lines, cur, { validity: t.validity, payment: t.payment, incoterm: t.incoterm }, quoteLead),
    media: ['text', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ 2. A price table (email or PDF)

export const quoteTable: QuoteTemplate = r => {
  const s = supplier(r)
  const cur = s.currency
  const rfqLines = makeRfq(r, r.int(2, 14))
  const withLead = r.chance(0.5)
  const lines = priced(r, rfqLines, cur, withLead)
  const t = terms(r, s)
  const quoteLead = withLead ? null : lead(r)
  const qref = `${r.pick(['QT', 'Q', 'SQ', 'QUO'])}-${r.int(2026000, 2026999)}`
  const head = ['No.', r.pick(['Description', 'Item Description', 'Product']), r.pick(['Model', 'Part No.']), 'Qty', r.pick([`Unit Price (${cur})`, 'Unit Price', `Price ${cur}`]), r.pick([`Amount (${cur})`, 'Total', `Total ${cur}`]), ...(withLead ? [r.pick(['Lead Time', 'Delivery'])] : [])]
  const rows = lines.map((l, i) => {
    const amt = l.price === null ? '' : money(r, cur, Math.round(l.price * l.qty * 100) / 100, false)
    return [String(i + 1), l.p.plain.replace(l.p.part ?? '\u0000', '').replace(/,?\s*Model\s*$/, '').trim(), l.p.part ?? '-', String(l.qty), l.price === null ? r.pick(['N/A', 'Not available', 'Regret']) : money(r, cur, l.price, false), amt, ...(withLead ? [l.lead?.text ?? ''] : [])]
  })
  const total = lines.reduce((n, l) => n + (l.price ?? 0) * l.qty, 0)
  const foot = [['', 'Sub Total', '', '', '', money(r, cur, Math.round(total * 100) / 100, false), ...(withLead ? [''] : [])]]
  if (r.chance(0.5)) foot.push(['', cur === 'PKR' ? 'GST 18%' : 'Freight', '', '', '', money(r, cur, Math.round(total * 18) / 100, false), ...(withLead ? [''] : [])])
  foot.push(['', 'Grand Total', '', '', '', money(r, cur, Math.round(total * 118) / 100, false), ...(withLead ? [''] : [])])
  const widths = withLead ? [0.05, 0.33, 0.15, 0.06, 0.13, 0.13, 0.13] : [0.06, 0.4, 0.16, 0.06, 0.15, 0.15]
  const blocks: Block[] = [
    { k: 'text', text: 'QUOTATION', bold: true, size: 14, align: 'center' },
    { k: 'pair', left: 'To: Q-Tech Engineering, Lahore', right: `Quotation No: ${qref}` },
    { k: 'pair', left: 'Attn: Mr. Wasif', right: `Date: ${writeDate(r, dateAfter(1), 0)}` },
    { k: 'pair', left: `Your Ref: RFQ-QT-${r.int(100, 999)}`, right: `Currency: ${cur}` },
    { k: 'gap' },
    { k: 'table', head, rows, widths, align: ['c', 'l', 'l', 'r', 'r', 'r', 'c'], ruled: r.chance(0.7), descCol: 1, foot },
    { k: 'gap' },
    { k: 'text', text: 'Terms & Conditions:', bold: true },
    ...(quoteLead ? [{ k: 'text', text: `Delivery time: ${quoteLead.text} after receipt of PO` } as Block] : []),
    ...t.blocks,
    { k: 'gap' },
    { k: 'text', text: 'Bank Details:', bold: true },
    { k: 'text', text: `Beneficiary: ${s.name}` },
    { k: 'text', text: `Account No: ${r.int(100000000, 999999999)}${r.int(1000, 9999)}` },
    { k: 'text', text: `SWIFT: ${r.pick(['BKCHCNBJ', 'DEUTDEFF', 'EBILAEAD', 'HABBPKKA'])}${r.int(100, 999)}` },
    { k: 'gap' },
    { k: 'text', text: `For ${s.name}` },
    { k: 'text', text: `${s.person}, Sales Manager` },
  ]
  const letterhead: Block[] = [{ k: 'text', text: s.name, bold: true, size: 13 }, { k: 'text', text: `${s.city} | Tel: ${s.phone} | ${s.email}`, size: 8 }, { k: 'gap' }]
  return {
    doc: { look: 'paper', blocks, page: { font: r.pick(['helvetica', 'times']), size: 9, letterhead, footer: r.chance(0.5) ? 'Page {n} of {m}' : undefined, rowsPerPage: rows.length > 9 && r.chance(0.5) ? 7 : undefined, repeatHead: r.chance(0.6) } },
    rfq: rfqOf(rfqLines),
    truth: truthOf(lines, cur, { validity: t.validity, payment: t.payment, incoterm: t.incoterm, quoteRef: qref }, quoteLead),
    media: ['pdf', 'text', 'image', 'scan'],
  }
}

// ------------------------------------------------------------------------------------------------ 3. A Chinese supplier's email

export const quoteChinese: QuoteTemplate = r => {
  const s = supplier(r, 'china')
  const cur = r.chance(0.6) ? 'CNY' : 'USD'
  const rfqLines = makeRfq(r, r.int(1, 5))
  const lines = priced(r, rfqLines, cur, true).map(l => (l.lead ? { ...l, lead: r.pick([{ text: '3-5天', max: 5 }, { text: '7天', max: 7 }, { text: '2周', max: 14 }, { text: '15 days', max: 15 }, { text: '10-15 days', max: 15 }]) } : l))
  const validity = r.pick([7, 15, 30])
  const blocks: Block[] = [{ k: 'text', text: 'Dear Wasif,' }, { k: 'text', text: 'Thanks for your inquiry. Our offer as below:' }]
  lines.forEach((l, i) => {
    if (l.price === null) {
      blocks.push({ k: 'text', text: `${i + 1}. ${l.p.part ?? l.p.plain}: sorry, no stock, discontinued` })
      return
    }
    const p = cur === 'CNY' ? `${r.pick(['￥', '￥ ', 'RMB '])}${l.price}` : `USD ${l.price}`
    blocks.push({ k: 'text', text: `${i + 1}. ${l.p.part ?? l.p.plain} ${l.p.part ? l.p.plain.split(' ').slice(0, 3).join(' ') : ''}`.trim() })
    blocks.push({ k: 'text', text: r.pick([`单价：${p}，交货期：${l.lead?.text ?? '7天'}`, `Unit price ${p} /pc`, `Price: ${p}/pc, delivery ${l.lead?.text ?? '7 days'}`]) })
    if (!/交货期|delivery/.test((blocks[blocks.length - 1] as { text: string }).text) && l.lead) blocks.push({ k: 'text', text: `Delivery: ${l.lead.text}` })
  })
  blocks.push({ k: 'text', text: r.pick([`Price validity: ${validity} days`, `有效期：${validity}天`]) }, { k: 'text', text: 'Payment: 100% T/T in advance' }, { k: 'text', text: 'Best regards' }, { k: 'text', text: s.person })
  return {
    doc: { look: 'email', blocks },
    rfq: rfqOf(rfqLines),
    truth: truthOf(lines, cur, { validity, payment: '100% T/T in advance' }, null),
    media: ['text', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ 4. A WhatsApp reply

export const quoteWhatsapp: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['local', 'china', 'gulf'] as const))
  const cur = s.currency
  const rfqLines = makeRfq(r, r.int(1, 5))
  const lines = priced(r, rfqLines, cur, r.chance(0.6) || 'some')
  const date = writeDate(r, dateAfter(1), 0)
  const msgs: ChatMsg[] = [{ date, time: '11:02', name: s.person, lines: [r.pick(['Sir rates:', 'Prices as below', 'Dear, offer:', 'AoA sir, rates ye hain'])] }]
  let mi = 3
  for (const l of lines) {
    const nm = l.p.part ?? l.p.plain
    if (l.price === null) {
      msgs.push({ date, time: `11:${String(mi++).padStart(2, '0')}`, name: s.person, lines: [`${nm} not available`] })
      continue
    }
    const pr = money(r, cur, l.price)
    msgs.push({ date, time: `11:${String(mi++).padStart(2, '0')}`, name: s.person, lines: [`${nm} ${pr}${r.pick([' each', '/pc', ''])}${l.lead ? ` ${r.pick(['delivery', 'lead time', ''])} ${l.lead.text}`.replace(/\s+/g, ' ') : ''}`] })
  }
  const validity = r.chance(0.5) ? r.pick([7, 15, 30]) : undefined
  if (validity) msgs.push({ date, time: `11:${String(mi++).padStart(2, '0')}`, name: s.person, lines: [`Validity ${validity} days`] })
  msgs.push({ date, time: `11:${String(mi++).padStart(2, '0')}`, name: 'Wasif Q-Tech', lines: ['Ok thanks'], out: true })
  return {
    doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] },
    rfq: rfqOf(rfqLines),
    truth: truthOf(lines, cur, { validity }, null),
    media: ['text', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ 5. A proforma invoice (PDF)

export const proforma: QuoteTemplate = r => {
  const s = supplier(r, r.pick(['china', 'europe', 'gulf'] as const))
  const cur = s.currency
  const rfqLines = makeRfq(r, r.int(1, 8))
  const lines = priced(r, rfqLines, cur, false).map(l => ({ ...l, price: l.price ?? price(r, cur) }))
  const until = dateAfter(r.pick([10, 15, 30, 41]))
  const days = Math.round((Date.UTC(until.y, until.m - 1, until.d) - Date.UTC(2026, 9, 20)) / 86_400_000)
  const inc = r.pick(['FOB Shanghai', 'EXW Hamburg', 'CIF Karachi', 'FCA Dubai'])
  const quoteLead = lead(r)
  const pi = `PI-${r.int(26000, 26999)}`
  const rows = lines.map((l, i) => [String(i + 1), l.p.plain, String(l.qty), money(r, cur, l.price as number, false), money(r, cur, Math.round((l.price as number) * l.qty * 100) / 100, false)])
  const blocks: Block[] = [
    { k: 'text', text: 'PROFORMA INVOICE', bold: true, size: 14, align: 'center' },
    { k: 'pair', left: 'Buyer: Q-Tech Engineering', right: `PI No.: ${pi}` },
    { k: 'pair', left: 'Lahore, Pakistan', right: `Date: ${writeDate(r, dateAfter(0), 3)}` },
    { k: 'gap' },
    { k: 'table', head: ['Item', 'Description of Goods', 'Qty', `Unit Price (${cur})`, `Amount (${cur})`], rows, widths: [0.07, 0.5, 0.08, 0.17, 0.17], align: ['c', 'l', 'r', 'r', 'r'], ruled: true, descCol: 1, foot: [['', 'TOTAL', '', '', money(r, cur, Math.round(lines.reduce((n, l) => n + (l.price as number) * l.qty, 0) * 100) / 100, false)]] },
    { k: 'text', text: `Amount in words: ${cur} ${r.pick(['Two Thousand Four Hundred', 'Eleven Thousand Two Hundred Fifty'])} Only` },
    { k: 'gap' },
    { k: 'text', text: `Price terms: ${inc}` },
    { k: 'text', text: `Delivery: ${quoteLead.text} after receipt of payment` },
    { k: 'text', text: `Validity: until ${writeDate(r, until, r.pick([3, 2, 0]))}` },
    { k: 'text', text: 'Payment: 100% T/T in advance' },
    { k: 'text', text: `Bank: ${r.pick(['Bank of Example', 'Example Commercial Bank'])}, IBAN: XX${r.int(10, 99)} 0000 ${r.int(1000, 9999)} ${r.int(1000, 9999)}` },
  ]
  return {
    doc: { look: 'paper', blocks, page: { font: 'helvetica', size: 9, letterhead: [{ k: 'text', text: s.name, bold: true, size: 13, align: 'center' }, { k: 'gap' }] } },
    rfq: rfqOf(rfqLines),
    truth: truthOf(lines, cur, { validity: days, payment: '100% T/T in advance', incoterm: inc, quoteRef: pi }, quoteLead),
    media: ['pdf', 'scan'],
  }
}

// ------------------------------------------------------------------------------------------------ 6. A local trader's rupee quote

export const quoteLocal: QuoteTemplate = r => {
  const s = supplier(r, 'local')
  const rfqLines = makeRfq(r, r.int(1, 6))
  const lines = priced(r, rfqLines, 'PKR', r.chance(0.4) || 'some')
  const quoteLead = lines.some(l => l.lead) ? null : r.pick([{ text: 'ex-stock', max: 0 }, { text: '1 week', max: 7 }, { text: '2-3 weeks', max: 21 }])
  const validity = r.pick([7, 15, 30])
  const blocks: Block[] = [{ k: 'text', text: 'Respected Sir,' }, { k: 'text', text: 'With reference to your enquiry, our rates are as under:' }, { k: 'gap' }]
  lines.forEach((l, i) => {
    if (l.price === null) blocks.push({ k: 'text', text: `${i + 1}. ${l.p.plain} - not available` })
    else blocks.push({ k: 'text', text: `${i + 1}. ${l.p.plain} - ${money(r, 'PKR', l.price)} ${r.pick(['each', 'per piece', 'per no.', ''])}${l.lead ? ` (${l.lead.text})` : ''}`.trim() })
  })
  blocks.push({ k: 'gap' }, { k: 'text', text: 'GST 18% extra.' })
  if (quoteLead) blocks.push({ k: 'text', text: `Delivery: ${quoteLead.text}` })
  blocks.push({ k: 'text', text: `Validity: ${validity} days` }, { k: 'text', text: 'Payment: 50% advance' }, { k: 'gap' }, { k: 'text', text: 'Regards,' }, { k: 'text', text: s.name }, { k: 'text', text: s.phone })
  return {
    doc: { look: 'email', blocks },
    rfq: rfqOf(rfqLines),
    truth: truthOf(lines, 'PKR', { validity, payment: '50% advance' }, quoteLead),
    media: ['text', 'image'],
  }
}

export const QUOTE_TEMPLATES_GEN0: Array<{ shape: string; make: QuoteTemplate; weight: number }> = [
  { shape: 'quote_email_lines', make: quoteEmailLines, weight: 4 },
  { shape: 'quote_table', make: quoteTable, weight: 4 },
  { shape: 'quote_chinese', make: quoteChinese, weight: 2 },
  { shape: 'quote_whatsapp', make: quoteWhatsapp, weight: 2 },
  { shape: 'quote_proforma', make: proforma, weight: 2 },
  { shape: 'quote_local', make: quoteLocal, weight: 2 },
]
