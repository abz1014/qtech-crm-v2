// Fictional customer enquiries in every shape Q-Tech receives them (owner brief 2026-10-22): an Outlook email with a ruled
// table and no header row, an email with a numbered list, an email table with a header, an ERP purchase requisition printed to
// PDF, an Excel sheet printed to PDF, a Word letter, a WhatsApp chat in Urdu and English, a forwarded thread. Each template
// returns the document and its truth; corpus.ts decides the medium (text, PDF, picture, scan).

import type { Block, ChatMsg, Doc, EnquiryTruth, ItemTruth } from './model'
import type { Rng } from './rng'
import { customer, dateAfter, monthName, parts, weekday, writeDate, type Customer, type DateParts, type Part } from './vocab'
import { unitFamily, writeUnit } from './units'

export interface EnquiryDraft {
  doc: Doc
  truth: EnquiryTruth
  /** The media this shape arrives as. */
  media: Array<'text' | 'pdf' | 'image' | 'scan'>
}

export type EnquiryTemplate = (r: Rng) => EnquiryDraft

// ------------------------------------------------------------------------------------------------ shared pieces

const OWN = { company: 'Q-Tech Engineering', email: 'sales@qtech.example', person: 'Wasif' }

function sentLine(r: Rng, d: DateParts): string {
  const h = r.int(8, 17)
  const m = r.int(0, 59)
  return r.pick([
    `${weekday(d)}, ${monthName(d.m)} ${d.d}, ${d.y} ${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`,
    `${weekday(d).slice(0, 3)} ${String(d.d).padStart(2, '0')}/${String(d.m).padStart(2, '0')}/${d.y} ${h}:${String(m).padStart(2, '0')}`,
    `${d.d} ${monthName(d.m)} ${d.y} at ${h}:${String(m).padStart(2, '0')}`,
  ])
}

function greeting(r: Rng): string {
  return r.pick(['Dear Sir,', 'Dear Sir/Madam,', 'Dear Wasif Sahib,', 'Hi Wasif,', 'Dear Team Q-Tech,', 'Assalam o Alaikum,', 'Respected Sir,', 'Dear Valued Supplier,', 'Good morning,'])
}

function askLine(r: Rng): string {
  return r.pick([
    'Please share your best price and delivery for the below mentioned items.',
    'Kindly quote your most competitive rates for the following material.',
    'Please send us your quotation for the items listed below.',
    'Hope you are doing well. Please share the price and availability for the below mentioned parts.',
    'We are pleased to invite your quotation for the following items required at our plant.',
    'Kindly provide your offer for the below requirement at the earliest.',
    'Please quote the following items along with make, origin and delivery time.',
  ])
}

function signoff(r: Rng): string {
  return r.pick(['Regards,', 'Best Regards,', 'Thanks & Regards,', 'Kind regards,', 'Thanks and Regards', 'Sincerely,', 'Warm Regards,'])
}

function signature(r: Rng, c: Customer, withCompany = true): Block[] {
  const out: Block[] = [{ k: 'text', text: c.person, bold: r.chance(0.5) }, { k: 'text', text: c.title }]
  if (withCompany) out.push({ k: 'text', text: c.name, bold: r.chance(0.3) })
  const extra: string[] = [
    r.pick([`Mobile: ${c.phone}`, `Cell: ${c.phone}`, `Mob # ${c.phone}`, `M: ${c.phone}`]),
    r.pick([`Tel: ${c.landline}`, `Ph: ${c.landline} Ext. ${r.int(100, 450)}`, `UAN: 111-${r.int(100, 999)}-${r.int(100, 999)}`]),
    c.address,
    r.pick([`Email: ${c.email}`, c.email, `www.${c.domain}`]),
  ]
  for (const e of extra) if (r.chance(0.75)) out.push({ k: 'text', text: e })
  return out
}

function disclaimer(r: Rng): Block[] {
  return r.pick([
    [{ k: 'text', text: 'DISCLAIMER: This email and any attachments are confidential and intended solely for the addressee. If you have received this email in error please notify the sender and delete it. Any views expressed are those of the author.' }],
    [{ k: 'text', text: 'This e-mail is confidential. If you are not the intended recipient, you must not copy, distribute or take any action in reliance on it.' }],
    [{ k: 'text', text: 'Please consider the environment before printing this email.' }],
  ] as Block[][])
}

/** The customer's own reference, written the way that customer writes it. */
function makeRef(r: Rng, c: Customer): { value: string; line: (v: string) => string; inSubject: boolean } {
  const y = r.pick(['2026', '26'])
  const value = r.pick([
    `${c.code}/PUR/${y}/${r.int(100, 1999)}`,
    `RFQ-${c.code}-${y}-${r.int(10, 999)}`,
    `${r.int(1000000000, 1000099999)}`,
    `PR-${r.int(1000, 99999)}`,
    `ENQ/${y}/${String(r.int(1, 999)).padStart(3, '0')}`,
    `${r.int(80000, 89999)}-RFQ-${r.pick(['OC', 'LC', 'IMP'])}`,
    `${c.code}-RFQ-${r.int(1000, 9999)}`,
    `T-${y}-${r.int(10, 99)}${r.pick(['', 'A', 'B'])}`,
  ])
  const label = r.pick([
    (v: string) => `RFQ No: ${v}`,
    (v: string) => `Our Ref: ${v}`,
    (v: string) => `Enquiry No. ${v}`,
    (v: string) => `Ref. No. ${v}`,
    (v: string) => `RFQ # ${v}`,
    (v: string) => `PR No: ${v}`,
    (v: string) => `Inquiry Ref: ${v}`,
    (v: string) => `Tender No. ${v}`,
  ])
  return { value, line: label, inSubject: r.chance(0.35) }
}

/** A quotation due date and the sentence that states it. */
function makeDue(r: Rng): { date: DateParts; line: string } {
  const date = dateAfter(r.int(4, 30))
  const w = writeDate(r, date)
  return {
    date,
    line: r.pick([
      `Please submit your quotation latest by ${w}.`,
      `Due date: ${w}`,
      `Quotation Due Date: ${w}`,
      `Closing date: ${w}`,
      `Kindly send your offer by ${w}.`,
      `Quotation must reach us on or before ${w}.`,
      `Last date for submission of quotation: ${w}`,
      `Bid due: ${w}`,
      `Please send the quotation by ${w}.`,
      `Deadline for quotation: ${w}`,
    ]),
  }
}

/** A delivery date: a date that is NOT the quotation due date. */
function deliveryLine(r: Rng): string {
  const w = writeDate(r, dateAfter(r.int(30, 90)))
  return r.pick([`Delivery required by ${w} at our plant.`, `Material required at site before ${w}.`, `Required delivery date: ${w}`])
}

function unitFor(r: Rng, p: Part, register: 'caps' | 'title' | 'lower' | 'any'): string {
  const fam = unitFamily(r.pick(p.units)) as string
  return writeUnit(r, fam, register)
}

function qtyFor(r: Rng, p: Part, unit: string): number {
  const fam = unitFamily(unit)
  if (fam === 'm') return r.pick([25, 50, 100, 150, 200, 300, 500, 1000, 12.5])
  if (fam === 'kg') return r.pick([2, 5, 10, 20, 25, 2.5, 50, 100])
  return Math.ceil(p.qty(r))
}

const fmt = (n: number, style: 'plain' | 'erp' | 'pad' = 'plain') =>
  style === 'erp' ? n.toFixed(3) : style === 'pad' && n < 10 && Number.isInteger(n) ? `0${n}` : n >= 1000 && Number.isInteger(n) && style === 'plain' ? n.toLocaleString('en-US') : String(n)

function email(r: Rng, c: Customer, subject: string, days = -r.int(0, 2)): Doc['email'] {
  return {
    from: r.chance(0.8) ? `${c.person} <${c.email}>` : c.email,
    sent: sentLine(r, dateAfter(days)),
    to: r.pick([`${OWN.email}`, `Q-Tech Sales <${OWN.email}>`, `'Wasif' <${OWN.email}>`]),
    cc: r.chance(0.3) ? `purchase@${c.domain}` : undefined,
    subject,
  }
}

function subjectFor(r: Rng, ref: { value: string; inSubject: boolean } | null, topic: string): string {
  if (ref?.inSubject) return r.pick([`RFQ ${ref.value} - ${topic}`, `Request for Quotation | ${ref.value}`, `RFQ FOR THE ${topic.toUpperCase()} REQUIRED ${ref.value}`, `Enquiry ${ref.value} for ${topic}`])
  return r.pick([`RFQ - ${topic}`, `Enquiry for ${topic}`, `Request for quotation`, `Quotation required - ${topic}`, `${topic} - urgent`, `Price inquiry`])
}

const TOPICS = ['instrumentation spares', 'electrical items', 'PLC spares', 'electronics items', 'valves', 'sensors', 'maintenance spares', 'drive spares', 'consumables']

// ------------------------------------------------------------------------------------------------ 1. Outlook RFQ, ruled table, no header row

export const outlookTable: EnquiryTemplate = r => {
  const c = customer(r)
  const n = r.int(2, 14)
  const ps = parts(r, n)
  const lineCode = r.chance(0.6)
  const items: ItemTruth[] = ps.map(p => {
    const unit = unitFor(r, p, 'caps')
    const desc = lineCode ? `${p.caps}${r.pick(['-01', '-01', ' -01', '-02'])}` : p.caps
    return { description: desc, qty: qtyFor(r, p, unit), unit, part: p.part ?? undefined }
  })
  const ref = r.chance(0.7) ? makeRef(r, c) : null
  if (ref) ref.inSubject = r.chance(0.6)
  const due = r.chance(0.4) ? makeDue(r) : null
  const subject = subjectFor(r, ref, r.pick(TOPICS))
  const blocks: Block[] = [{ k: 'text', text: greeting(r) }, { k: 'gap' }, { k: 'text', text: askLine(r) }]
  if (ref && !ref.inSubject) blocks.push({ k: 'text', text: ref.line(ref.value) })
  blocks.push({ k: 'gap' })
  blocks.push({
    k: 'table',
    head: null,
    rows: items.map(it => [it.description, fmt(it.qty), it.unit as string]),
    widths: [0.6, 0.12, 0.08],
    align: ['l', 'r', 'c'],
    ruled: true,
    descCol: 0,
    shaded: r.chance(0.3),
  })
  if (due) blocks.push({ k: 'text', text: due.line })
  if (r.chance(0.3)) blocks.push({ k: 'text', text: deliveryLine(r) })
  blocks.push({ k: 'gap' }, { k: 'text', text: signoff(r) }, { k: 'gap' }, ...signature(r, c))
  if (r.chance(0.35)) blocks.push({ k: 'gap' }, ...disclaimer(r))
  return {
    doc: { look: 'email', email: email(r, c, subject), blocks },
    truth: { items: items.map(({ description, qty, unit, part }) => ({ description, qty, unit, part })), ref: ref?.value, due: due?.date.iso, company: c.name, domain: c.domain },
    media: ['text', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ 2. Email with a numbered list

function listLine(r: Rng, marker: string, desc: string, qty: number, unit: string | null): string {
  const q = fmt(qty, r.chance(0.2) ? 'pad' : 'plain')
  if (!unit) return `${marker}${r.pick([`${desc} - ${q}`, `${desc} qty ${q}`, `${desc} x ${q}`, `${desc}, Qty: ${q}`, `${q} x ${desc}`])}`
  return `${marker}${r.pick([
    `${desc} - ${q} ${unit}`,
    `${desc} – ${q} ${unit}`,
    `${desc}: ${q} ${unit}`,
    `${desc} (${q} ${unit})`,
    `${desc}, Qty: ${q} ${unit}`,
    `${q} ${unit} ${desc}`,
    `${desc} ${q} ${unit}`,
    `${desc} Qty ${q} ${unit}`,
  ])}`
}

export const emailList: EnquiryTemplate = r => {
  const c = customer(r)
  const n = r.int(1, 9)
  const ps = parts(r, n)
  const markers = r.pick([
    (i: number) => `${i + 1}. `,
    (i: number) => `${i + 1}) `,
    (i: number) => `${i + 1}- `,
    (i: number) => `(${i + 1}) `,
    (i: number) => `${'abcdefghij'[i]}) `,
    () => '- ',
    () => '• ',
    (i: number) => `Item ${i + 1}: `,
  ])
  const attrLines = r.chance(0.25)
  const items: ItemTruth[] = []
  const blocks: Block[] = [{ k: 'text', text: greeting(r) }, { k: 'gap' }, { k: 'text', text: askLine(r) }, { k: 'gap' }]
  const ref = r.chance(0.6) ? makeRef(r, c) : null
  if (ref && !ref.inSubject) blocks.splice(3, 0, { k: 'text', text: ref.line(ref.value) })
  for (const [i, p] of ps.entries()) {
    const unit = r.chance(0.85) ? unitFor(r, p, r.pick(['title', 'lower', 'any'])) : null
    const qty = qtyFor(r, p, unit ?? 'nos')
    if (attrLines && p.brand) {
      const base = p.plain.replace(p.brand, '').replace(/,?\s*Model\s+\S+/, '').replace(p.part ?? '\u0000', '').replace(/\s+/g, ' ').trim()
      blocks.push({ k: 'text', text: `${markers(i)}${base}` })
      blocks.push({ k: 'text', text: `Make: ${p.brand}`, indent: 3 })
      if (p.part) blocks.push({ k: 'text', text: `Model: ${p.part}`, indent: 3 })
      blocks.push({ k: 'text', text: unit ? `Qty: ${fmt(qty)} ${unit}` : `Qty: ${fmt(qty)}`, indent: 3 })
      items.push({ description: `${base} ${p.brand}${p.part ? ` ${p.part}` : ''}`, qty, unit, part: p.part ?? undefined })
    } else {
      blocks.push({ k: 'text', text: listLine(r, markers(i), p.plain, qty, unit) })
      items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
    }
  }
  const due = r.chance(0.5) ? makeDue(r) : null
  blocks.push({ k: 'gap' })
  if (due) blocks.push({ k: 'text', text: due.line })
  if (r.chance(0.4)) blocks.push({ k: 'text', text: r.pick(['Please mention make, origin and delivery period in your offer.', 'Note: Prices should be inclusive of GST.', 'Partial quotations are acceptable.']) })
  if (r.chance(0.25)) blocks.push({ k: 'text', text: deliveryLine(r) })
  blocks.push({ k: 'gap' }, { k: 'text', text: signoff(r) }, ...signature(r, c))
  if (r.chance(0.3)) blocks.push({ k: 'text', text: 'Sent from my iPhone' })
  const em = r.chance(0.8) ? email(r, c, subjectFor(r, ref, r.pick(TOPICS))) : undefined
  if (!em && ref?.inSubject) blocks.splice(3, 0, { k: 'text', text: ref.line(ref.value) })
  return {
    doc: { look: 'email', email: em, blocks },
    truth: { items, ref: ref?.value, due: due?.date.iso, company: c.name, domain: em ? c.domain : undefined },
    media: ['text', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ 3. Email with a table and a header row

export const emailHeaderTable: EnquiryTemplate = r => {
  const c = customer(r)
  const n = r.int(2, 12)
  const ps = parts(r, n)
  const withPart = r.chance(0.6)
  const withMake = r.chance(0.4)
  const withRemarks = r.chance(0.3)
  const head = [
    r.pick(['S.No', 'Sr. No', 'Sr#', 'Item', '#', 'S. No.']),
    r.pick(['Description', 'Item Description', 'Material Description', 'Particulars']),
    ...(withPart ? [r.pick(['Part No', 'Model', 'Part Number', 'Model No.'])] : []),
    ...(withMake ? [r.pick(['Make', 'Brand'])] : []),
    r.pick(['Qty', 'Quantity', 'QTY', 'Req. Qty']),
    r.pick(['Unit', 'UOM', 'UoM', 'Units']),
    ...(withRemarks ? ['Remarks'] : []),
  ]
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, r.pick(['title', 'caps']))
    const qty = qtyFor(r, p, unit)
    const desc = withPart && p.part ? p.plain.replace(`, Model ${p.part}`, '').replace(` ${p.part}`, '') : p.plain
    const brandInDesc = p.brand && desc.includes(p.brand)
    const make = withMake ? (p.brand && !brandInDesc ? p.brand : r.pick(['Any', 'Equivalent', '-', ''])) : null
    const remark = withRemarks ? r.pick(['', '', 'Urgent', 'For boiler', 'Original only', 'Same as sample']) : null
    const row = [String(i + 1), desc, ...(withPart ? [p.part ?? ''] : []), ...(make !== null ? [make] : []), fmt(qty), unit, ...(remark !== null ? [remark] : [])]
    const descTruth = [desc, withPart && p.part ? p.part : '', make && make !== '-' && make !== '' ? make : ''].filter(Boolean).join(' ')
    items.push({ description: descTruth, qty, unit, part: p.part ?? undefined })
    return row
  })
  const widths = head.map((_, i) => (i === 1 ? 0.4 : i === 0 ? 0.06 : 0.12))
  const align = head.map((h, i) => (/qty|quantity/i.test(h) ? 'r' : i === 0 ? 'c' : 'l')) as Array<'l' | 'r' | 'c'>
  const ref = r.chance(0.6) ? makeRef(r, c) : null
  const due = r.chance(0.5) ? makeDue(r) : null
  const blocks: Block[] = [{ k: 'text', text: greeting(r) }, { k: 'gap' }, { k: 'text', text: askLine(r) }]
  if (ref && !ref.inSubject) blocks.push({ k: 'text', text: ref.line(ref.value) })
  blocks.push({ k: 'gap' }, { k: 'table', head, rows, widths, align, ruled: true, descCol: 1 })
  if (due) blocks.push({ k: 'text', text: due.line })
  blocks.push({ k: 'gap' }, { k: 'text', text: signoff(r) }, ...signature(r, c))
  if (r.chance(0.3)) blocks.push({ k: 'gap' }, ...disclaimer(r))
  return {
    doc: { look: 'email', email: email(r, c, subjectFor(r, ref, r.pick(TOPICS))), blocks },
    truth: { items, ref: ref?.value, due: due?.date.iso, company: c.name, domain: c.domain },
    media: ['text', 'image', 'pdf'],
  }
}

// ------------------------------------------------------------------------------------------------ 4. ERP purchase requisition / RFQ printout (PDF)

export const erpForm: EnquiryTemplate = r => {
  const c = customer(r)
  const n = r.int(2, 18)
  const ps = parts(r, n)
  const prNo = String(r.int(1000010000, 1000099999))
  const rfqNo = r.chance(0.5) ? `${r.int(6000000000, 6000099999)}` : prNo
  const due = makeDue(r)
  const docDate = dateAfter(-r.int(0, 3))
  const title = r.pick(['REQUEST FOR QUOTATION', 'PURCHASE REQUISITION', 'RFQ - REQUEST FOR QUOTATION', 'ENQUIRY'])
  const refLabel = title.includes('REQUISITION') ? r.pick(['PR No:', 'Requisition No.:', 'PR #']) : r.pick(['RFQ No:', 'RFQ Number:', 'Collective No:', 'Enquiry No.:'])
  const head = [r.pick(['Item', 'Itm', 'S.No']), r.pick(['Material', 'Material Code', 'Item Code']), r.pick(['Description', 'Material Description', 'Short Text']), r.pick(['Qty', 'Quantity', 'Req. Qty']), r.pick(['UoM', 'Unit', 'UOM']), r.pick(['Req. Date', 'Delivery Date', 'Del. Date']), 'Plant']
  const plant = String(r.pick([1100, 1200, 2100, 3000]))
  const erpQty = r.chance(0.5)
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, 'caps')
    const qty = qtyFor(r, p, unit)
    const extra = r.chance(0.5) ? ` ${r.pick(['MAKE', 'BRAND'])}: ${p.brand ?? r.pick(['ANY', 'ORIGINAL'])}` : ''
    const longText = r.chance(0.5) ? ` ${r.pick(['FOR BOILER HOUSE', 'SPARE FOR LINE 2', 'AS PER ATTACHED DATASHEET', 'WITH TEST CERTIFICATE', 'FOR ETP PLANT'])}` : ''
    const desc = `${p.erp}${extra}${longText}`
    items.push({ description: desc, qty, unit, part: p.part ?? undefined })
    return [String((i + 1) * 10).padStart(r.chance(0.5) ? 5 : 1, '0'), String(r.int(10000000, 19999999)), desc, erpQty ? fmt(qty, 'erp') : fmt(qty), unit, writeDate(r, dateAfter(r.int(30, 80)), 1), plant]
  })
  const letterhead: Block[] = [
    { k: 'text', text: c.name.toUpperCase(), bold: true, size: 13, align: 'center' },
    { k: 'text', text: c.address, align: 'center', size: 8 },
    { k: 'text', text: `Tel: ${c.landline}  Email: ${c.email}`, align: 'center', size: 8 },
    { k: 'gap' },
  ]
  const blocks: Block[] = [
    { k: 'text', text: title, bold: true, size: 12, align: 'center' },
    { k: 'gap' },
    { k: 'pair', left: `Vendor: ${r.pick(['200145', '300872', '201113'])} Q-Tech Engineering`, right: `${refLabel} ${rfqNo}` },
    { k: 'pair', left: 'Lahore, Pakistan', right: `Date: ${writeDate(r, docDate, 1)}` },
    { k: 'pair', left: `Purchasing Group: P${r.int(10, 40)} ${c.person}`, right: `${r.pick(['Quotation Deadline:', 'Bid Submission Date:', 'Closing Date:', 'Quotation Due:'])} ${writeDate(r, due.date, r.pick([0, 1, 2, 6]))}` },
    { k: 'pair', left: `Contact: ${c.phone}`, right: `Plant: ${plant} ${c.city}` },
    { k: 'gap' },
    { k: 'text', text: 'Please quote your lowest prices for the following material:' },
    { k: 'table', head, rows, widths: [0.07, 0.12, 0.41, 0.1, 0.07, 0.13, 0.08], align: ['l', 'l', 'l', 'r', 'c', 'c', 'c'], ruled: r.chance(0.5), descCol: 2 },
    { k: 'gap' },
    { k: 'text', text: 'Terms and Conditions', bold: true },
    { k: 'text', text: '1. Quotation should be valid for 30 days.' },
    { k: 'text', text: '2. Please mention delivery period, make and country of origin.' },
    { k: 'text', text: `3. ${deliveryLine(r)}` },
    { k: 'text', text: '4. Payment: 30 days after receipt of material.' },
    { k: 'gap' },
    { k: 'text', text: `For ${c.name}` },
    { k: 'text', text: 'Authorized Signatory' },
  ]
  return {
    doc: {
      look: 'paper',
      blocks,
      page: { font: r.pick(['helvetica', 'courier', 'helvetica', 'times']), size: r.pick([8.5, 9, 9.5]), letterhead, footer: r.chance(0.7) ? r.pick(['Page {n} of {m}', 'Page {n}/{m}', '- {n} -']) : undefined, rowsPerPage: n > 8 && r.chance(0.6) ? r.int(5, 9) : undefined, repeatHead: r.chance(0.6), landscape: r.chance(0.2) },
    },
    truth: { items, ref: rfqNo, due: due.date.iso, company: c.name, domain: c.domain },
    media: ['pdf', 'scan', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ 5. Excel sheet printed to PDF

export const excelPdf: EnquiryTemplate = r => {
  const c = customer(r)
  const n = r.int(3, 22)
  const ps = parts(r, n)
  const head = ['S.No', r.pick(['Item Description', 'Description', 'Description of Goods']), r.pick(['Part No.', 'Model', 'Part Number']), r.pick(['Make', 'Brand']), r.pick(['Qty', 'Quantity', 'QTY']), r.pick(['Unit', 'UOM']), 'Remarks']
  const items: ItemTruth[] = []
  const rows = ps.map((p, i) => {
    const unit = unitFor(r, p, r.pick(['caps', 'title']))
    const qty = qtyFor(r, p, unit)
    const desc = p.part ? p.plain.replace(`, Model ${p.part}`, '').replace(` ${p.part}`, '') : p.plain
    const brandInDesc = p.brand && desc.includes(p.brand)
    const make = p.brand && !brandInDesc ? p.brand : r.pick(['', 'Any'])
    items.push({ description: [desc, p.part ?? '', make].filter(Boolean).join(' '), qty, unit, part: p.part ?? undefined })
    return [String(i + 1), desc, p.part ?? '', make, fmt(qty), unit, r.pick(['', '', '', 'Urgent', 'Stock item'])]
  })
  const ref = makeRef(r, c)
  const due = r.chance(0.5) ? makeDue(r) : null
  const blocks: Block[] = [
    { k: 'text', text: c.name, bold: true, size: 13, align: 'center' },
    { k: 'text', text: r.pick(['MATERIAL REQUIREMENT LIST', 'RFQ ITEMS LIST', 'Spare parts requirement']), bold: true, align: 'center' },
    { k: 'pair', left: ref.line(ref.value), right: `Date: ${writeDate(r, dateAfter(-1))}` },
    ...(due ? [{ k: 'text', text: due.line } as Block] : []),
    { k: 'gap' },
    { k: 'table', head, rows, widths: [0.06, 0.38, 0.16, 0.1, 0.07, 0.07, 0.16], align: ['c', 'l', 'l', 'l', 'r', 'c', 'l'], ruled: true, descCol: 1, size: 8.5 },
    { k: 'gap' },
    { k: 'text', text: `Prepared by: ${c.person}` },
  ]
  return {
    doc: { look: 'sheet', blocks, page: { font: 'helvetica', size: 9, landscape: r.chance(0.4), rotate: r.chance(0.25) ? 90 : 0, footer: r.chance(0.5) ? 'Page {n} of {m}' : undefined, rowsPerPage: n > 12 && r.chance(0.5) ? r.int(8, 12) : undefined, repeatHead: r.chance(0.5) } },
    truth: { items, ref: ref.value, due: due?.date.iso, company: c.name },
    media: ['pdf', 'image', 'scan'],
  }
}

// ------------------------------------------------------------------------------------------------ 6. Word letter

export const wordLetter: EnquiryTemplate = r => {
  const c = customer(r)
  const n = r.int(1, 7)
  const ps = parts(r, n)
  const ref = makeRef(r, c)
  const due = makeDue(r)
  const asTable = r.chance(0.5)
  const items: ItemTruth[] = []
  const blocks: Block[] = [
    { k: 'pair', left: ref.line(ref.value), right: `Dated: ${writeDate(r, dateAfter(-1))}` },
    { k: 'gap' },
    { k: 'text', text: 'M/s Q-Tech Engineering,' },
    { k: 'text', text: 'Lahore.' },
    { k: 'gap' },
    { k: 'text', text: `Subject: ${r.pick(['REQUEST FOR QUOTATION', 'Invitation to quote', 'Enquiry for supply of spares'])}`, bold: true },
    { k: 'gap' },
    { k: 'text', text: 'Dear Sir,' },
    { k: 'text', text: `${r.pick(['We are interested in purchasing the following items.', 'You are requested to quote your best rates for the supply of the following items.'])} ${due.line}` },
    { k: 'gap' },
  ]
  if (asTable) {
    const rows = ps.map((p, i) => {
      const unit = unitFor(r, p, 'title')
      const qty = qtyFor(r, p, unit)
      items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
      return [String(i + 1), p.plain, fmt(qty), unit]
    })
    blocks.push({ k: 'table', head: ['Sr. No.', 'Description', 'Qty', 'Unit'], rows, widths: [0.1, 0.62, 0.12, 0.12], align: ['c', 'l', 'r', 'c'], ruled: true, descCol: 1 })
  } else {
    for (const [i, p] of ps.entries()) {
      const unit = unitFor(r, p, 'title')
      const qty = qtyFor(r, p, unit)
      items.push({ description: p.plain, qty, unit, part: p.part ?? undefined })
      blocks.push({ k: 'text', text: listLine(r, `${i + 1}. `, p.plain, qty, unit) })
    }
  }
  blocks.push(
    { k: 'gap' },
    { k: 'text', text: 'The quotation should mention delivery period, validity and payment terms. Prices should be quoted inclusive of all taxes.' },
    { k: 'gap' },
    { k: 'text', text: 'Yours faithfully,' },
    { k: 'gap' },
    { k: 'text', text: c.person },
    { k: 'text', text: c.title },
    { k: 'text', text: `For ${c.name}` },
  )
  const letterhead: Block[] = [
    { k: 'text', text: c.name, bold: true, size: 15, align: 'center' },
    { k: 'text', text: `${c.address} | Ph: ${c.landline} | ${c.email}`, size: 8, align: 'center' },
    { k: 'gap' },
  ]
  return {
    doc: { look: 'paper', blocks, page: { font: r.pick(['times', 'helvetica']), size: r.pick([10, 11]), letterhead } },
    truth: { items, ref: ref.value, due: due.date.iso, company: c.name },
    media: ['pdf', 'scan', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ 7. WhatsApp chat

const URDU_ASK = ['AoA bhai, in items ka rate bhej dein', 'Salam sir, ye cheezein chahiye, rates bata dein', 'Sir please quote', 'Asalam o alaikum, rate chahiye', 'Bhai ye items urgent chahiye', 'Rates please']
const URDU_TAIL = ['', '', '', ' chahiye', ' bhi', ' urgent', ' bhej dein']
const EMOJI = ['', '', '', ' 🙏', ' 👍', ' ✅']

export const whatsapp: EnquiryTemplate = r => {
  const c = customer(r)
  const n = r.int(1, 8)
  const ps = parts(r, n)
  const date = writeDate(r, dateAfter(-r.int(0, 3)), 0)
  const name = r.pick([c.person, `${c.person.split(' ')[0]} ${c.short}`, `${c.person} (${c.short})`, `+92 3${r.int(0, 4)}${r.int(0, 9)} ${r.int(1000000, 9999999)}`])
  const msgs: ChatMsg[] = []
  let t = r.int(9 * 60, 17 * 60)
  const tick = () => {
    t += r.int(0, 3)
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
  }
  const items: ItemTruth[] = []
  msgs.push({ date, time: tick(), name, lines: [r.pick(URDU_ASK) + r.pick(EMOJI)] })
  const oneMessage = r.chance(0.5)
  const lines: string[] = []
  for (const [i, p] of ps.entries()) {
    const unit = r.chance(0.7) ? unitFor(r, p, r.pick(['lower', 'title'])) : null
    const qty = qtyFor(r, p, unit ?? 'nos')
    const lower = r.chance(0.5)
    const desc = lower ? p.plain.toLowerCase() : p.plain
    const marker = oneMessage && r.chance(0.6) ? `${i + 1}. ` : ''
    const line = listLine(r, marker, desc, qty, unit) + r.pick(URDU_TAIL)
    items.push({ description: desc, qty, unit, part: p.part ? (lower ? p.part.toLowerCase() : p.part) : undefined })
    if (oneMessage) lines.push(line)
    else msgs.push({ date, time: tick(), name, lines: [line] })
    if (!oneMessage && r.chance(0.15)) msgs.push({ date, time: tick(), name, lines: [], media: r.pick(['voice', 'image'] as const) })
  }
  if (oneMessage) msgs.push({ date, time: tick(), name, lines })
  if (r.chance(0.5)) msgs.push({ date, time: tick(), name: r.pick(['Wasif Q-Tech', 'Q-Tech Sales']), lines: [r.pick(['Ok sir, will share quotation today', 'Noted 👍', 'Sure, checking with supplier'])], out: true })
  if (r.chance(0.4)) msgs.push({ date, time: tick(), name, lines: [r.pick(['Jaldi bhej dein please', 'Thanks', 'Kal tak rate chahiye', 'Ok 👍'])] })
  if (r.chance(0.2)) msgs.push({ date, time: tick(), name, lines: [], media: 'voice' })
  return {
    doc: { look: 'chat', blocks: [{ k: 'chat', msgs }] },
    truth: { items },
    media: ['text', 'image'],
  }
}

// ------------------------------------------------------------------------------------------------ 8. A forwarded enquiry, or a reply on top of an old thread

export const forwardedThread: EnquiryTemplate = r => {
  const inner = r.chance(0.5) ? emailList(r) : outlookTable(r)
  const c = customer(r)
  const blocks: Block[] = []
  if (r.chance(0.5)) {
    // A colleague forwards the customer's enquiry.
    blocks.push({ k: 'text', text: r.pick(['FYI, please quote.', 'Please check and send rates today.', 'Forwarding for your action.']) }, { k: 'gap' }, { k: 'text', text: '---------- Forwarded message ---------' })
    const e = inner.doc.email
    if (e) blocks.push({ k: 'text', text: `From: ${e.from}` }, { k: 'text', text: `Date: ${e.sent}` }, { k: 'text', text: `Subject: ${e.subject}` }, { k: 'text', text: `To: ${e.to}` }, { k: 'gap' })
    blocks.push(...inner.doc.blocks)
    return { doc: { look: 'email', blocks }, truth: { ...inner.truth, domain: undefined }, media: ['text'] }
  }
  // The customer's new list on top, our old quotation under it: only the new list counts.
  blocks.push(...inner.doc.blocks, { k: 'gap' }, { k: 'text', text: r.pick(['-----Original Message-----', '________________________________', `On ${writeDate(r, dateAfter(-12), 3)}, at 4:12 PM, Wasif <${OWN.email}> wrote:`]) })
  blocks.push({ k: 'text', text: `From: Wasif <${OWN.email}>` }, { k: 'text', text: `Sent: ${sentLine(r, dateAfter(-12))}` }, { k: 'text', text: `To: ${c.email}` }, { k: 'text', text: 'Subject: Quotation QT-2026-0912' }, { k: 'gap' })
  blocks.push({ k: 'text', text: 'Dear Sir, please find our offer:' })
  for (const p of parts(r, 3)) blocks.push({ k: 'text', text: `${p.plain} - 2 Nos - PKR ${r.int(5, 90)},000 each` })
  blocks.push({ k: 'text', text: 'Regards, Wasif' })
  return { doc: { ...inner.doc, blocks }, truth: inner.truth, media: ['text'] }
}

export const ENQUIRY_TEMPLATES_GEN0: Array<{ shape: string; make: EnquiryTemplate; weight: number }> = [
  { shape: 'outlook_table', make: outlookTable, weight: 5 },
  { shape: 'email_list', make: emailList, weight: 4 },
  { shape: 'email_header_table', make: emailHeaderTable, weight: 3 },
  { shape: 'erp_form', make: erpForm, weight: 4 },
  { shape: 'excel_pdf', make: excelPdf, weight: 3 },
  { shape: 'word_letter', make: wordLetter, weight: 3 },
  { shape: 'whatsapp', make: whatsapp, weight: 4 },
  { shape: 'forwarded_thread', make: forwardedThread, weight: 2 },
]
