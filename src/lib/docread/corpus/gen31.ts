// Generation 31: documents that are NOT enquiries and that arrive where an enquiry is expected (attached to an RFQ email, pasted by
// mistake): a purchase order, a sales tax invoice, our own quotation, a 2-page datasheet, a company profile, a follow-up message and
// our own request for quotation. Every name, number and sentence is invented.
//
// They have their own list (NON_RFQ_CASES) and their own truth (the kind the document type check must answer): the enquiry and
// quote truth models describe items and prices, which these documents either have none of or must never yield. No batch in corpus.ts
// uses them, so the reader's floors are untouched; docKind.corpus.test.ts runs them.

import type { DocKind } from '../docKind'
import type { Block, Doc, TextStyle } from './model'
import { rng, type Rng } from './rng'
import { customer, dateAfter, parts, supplier, writeDate } from './vocab'

export interface NonRfqCase {
  id: string
  /** What the document type check must answer. */
  kind: DocKind
  shape: string
  medium: 'text' | 'pdf'
  doc: Doc
  textStyle: TextStyle
}

type Make = (r: Rng, i: number) => Doc

const OWN = 'Q-Tech Engineering'
const OWN_ADDR = 'Office 14, Block C, Gulberg Commercial Centre, Lahore'
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const T = (text: string, bold?: boolean): Block => ({ k: 'text', text, bold })

const purchaseOrder: Make = (r, i) => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 8))
  const rows = ps.map((p, n) => {
    const qty = Math.ceil(p.qty(r))
    const price = r.int(8, 900) * 50
    return [String(n + 1), p.plain, String(qty), 'Nos', money(price), money(price * qty)]
  })
  const total = rows.reduce((s, x) => s + Number((x[5] as string).replace(/,/g, '')), 0)
  const blocks: Block[] = [
    T(c.name, true),
    T(c.address),
    T(['PURCHASE ORDER', 'Purchase Order', 'PURCHASE ORDER (LOCAL)'][i % 3] as string, true),
    { k: 'pair', left: `PO No: ${c.code}-PO-${r.int(10000, 99999)}`, right: `PO Date: ${writeDate(r, dateAfter(-2), 0)}` },
    T(`Vendor: ${OWN}, Lahore`),
    T(`Payment Terms: ${r.pick(['30 days from delivery', '45 days after invoice', 'Advance 50%, balance on delivery'])}`),
    T(`Delivery Address: ${c.name} Store, ${c.address}`),
    T('Please supply the following items as per your quotation:'),
    { k: 'table', head: ['Sr', 'Description', 'Qty', 'Unit', 'Unit Price', 'Amount'], rows, widths: [0.05, 0.43, 0.07, 0.08, 0.17, 0.2], align: ['c', 'l', 'r', 'c', 'r', 'r'], ruled: true, descCol: 1, foot: [['', '', '', '', 'Total (PKR)', money(total)]] },
    T('Terms and Conditions: 1. Goods must be as per specification. 2. Delivery within the stated period. 3. Please acknowledge receipt of this order.'),
    T('Authorised Signatory', true),
  ]
  return { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } }
}

const taxInvoice: Make = (r, i) => {
  const c = customer(r)
  const ps = parts(r, r.int(2, 7))
  const rows = ps.map((p, n) => {
    const qty = Math.ceil(p.qty(r))
    const rate = r.int(8, 700) * 50
    return [String(n + 1), p.plain, String(qty), money(rate), money(rate * qty), money(rate * qty * 0.18)]
  })
  const blocks: Block[] = [
    T(OWN, true),
    T(OWN_ADDR),
    T(`NTN: ${r.int(1000000, 9999999)}-${r.int(1, 9)}    STRN: ${r.int(10, 99)}-00-${r.int(1000, 9999)}-${r.int(100, 999)}-${r.int(10, 99)}`),
    T(['SALES TAX INVOICE', 'Sales Tax Invoice', 'TAX INVOICE'][i % 3] as string, true),
    { k: 'pair', left: `Invoice No: INV-26-${r.int(1000, 9999)}`, right: `Date: ${writeDate(r, dateAfter(-1), 0)}` },
    T(`Buyer: ${c.name}`),
    T(`Buyer NTN: ${r.int(1000000, 9999999)}-${r.int(1, 9)}   Buyer STRN: ${r.int(10, 99)}-00-${r.int(1000, 9999)}-${r.int(100, 999)}-${r.int(10, 99)}`),
    { k: 'table', head: ['Sr', 'Description', 'Qty', 'Rate', 'Value excl. GST', 'GST 18%'], rows, widths: [0.05, 0.4, 0.07, 0.14, 0.19, 0.15], align: ['c', 'l', 'r', 'r', 'r', 'r'], ruled: true, descCol: 1, foot: [['', '', '', '', 'Total incl. GST', money(r.int(40000, 900000))]] },
    T('Amount in words: Rupees only.'),
    T(`Bank details: Example Bank Limited, IBAN PK00EXMP${r.int(100000000, 999999999)}${r.int(1000000, 9999999)}`),
  ]
  return { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } }
}

const ownQuote: Make = (r, i) => {
  const c = customer(r)
  const ps = parts(r, r.int(3, 14))
  const rows = ps.map((p, n) => {
    const qty = Math.ceil(p.qty(r))
    const price = r.int(8, 900) * 50
    return [String(n + 1), p.plain, String(qty), 'Nos', money(price), money(price * qty)]
  })
  const blocks: Block[] = [
    T(OWN, true),
    T(OWN_ADDR),
    T(`sales@qtech.example   +92 42 ${r.int(3000000, 8999999)}`),
    T(i % 2 === 0 ? 'Quotation' : 'QUOTATION', true),
    { k: 'pair', left: `Quotation no. QT-26-${String(r.int(1, 999)).padStart(4, '0')}`, right: `Date: ${writeDate(r, dateAfter(0), 0)}` },
    T(`Prepared for: ${c.name}, ${c.city}`),
    T(`Attention: ${c.person}`),
    { k: 'table', head: ['#', 'Description', 'Qty', 'Unit', 'Unit Pr. (PKR)', 'Total (PKR)'], rows, widths: [0.05, 0.43, 0.07, 0.08, 0.17, 0.2], align: ['c', 'l', 'r', 'c', 'r', 'r'], ruled: true, descCol: 1, foot: [['', '', '', '', 'Sub Total', money(r.int(40000, 900000))], ['', '', '', '', 'GST 18%', money(r.int(7000, 160000))], ['', '', '', '', 'Grand Total', money(r.int(47000, 1060000))]] },
    T(`Validity: ${r.pick(['14', '30', '7'])} days from the date of quotation.`),
    T(`Delivery: ${r.pick(['2-3 weeks', 'ex-stock', '4-6 weeks'])}. Payment: ${r.pick(['30 days', 'advance', '50% advance'])}.`),
  ]
  return { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } }
}

const SENT = [
  'The transmitter measures gauge or absolute pressure in clean and mildly aggressive liquids, gases and steam, and is designed for continuous duty in process plants.',
  'Its welded stainless steel housing and ceramic sensing element give long-term stability even under strong vibration and sudden pressure peaks.',
  'The device is configured with the keypad on the housing or over the digital interface, and every setting is stored in memory that survives a power failure.',
  'A wide range of process connections and electrical outputs allows the unit to replace older instruments without changes to the existing installation.',
  'All instruments are individually calibrated and tested at the factory before shipment, and a calibration certificate is supplied with each unit on request.',
]

const datasheet: Make = (r, i) => {
  const model = `${r.pick(['ZX', 'PM', 'LT', 'RK', 'HV'])}-${r.int(100, 990)}`
  const noun = r.pick(['Pressure Transmitter', 'Temperature Transmitter', 'Level Switch', 'Flow Sensor'])
  const spec: string[][] = [
    ['Measuring range', `0 to ${r.pick([4, 10, 40, 100])} bar`],
    ['Accuracy', `${r.pick(['0.1', '0.25', '0.5'])} % of span`],
    ['Output signal', '4-20 mA, HART'],
    ['Supply voltage', '10-30 VDC'],
    ['Operating temperature', '-40 to 85 C'],
    ['Ingress protection', 'IP67'],
    ['Housing material', 'Stainless steel 316L'],
    ['Weight', `${r.pick(['0.4', '0.6', '0.9'])} kg`],
    ['Response time', '< 5 ms'],
    ['Repeatability', '0.05 %'],
    ['Process connection', 'G1/2, 1/2 NPT, flange'],
    ['Approvals', 'CE, ATEX, SIL 2'],
  ]
  const ordering = Array.from({ length: 44 + (i % 5) }, (_, n) => [`${model}-${String(n + 1).padStart(3, '0')}`, `${r.pick([1, 2.5, 4, 6, 10, 16, 25, 40, 60, 100, 160, 250])} bar`, r.pick(['G1/2', '1/2 NPT', 'DN25', 'M20']), r.pick(['4-20 mA', '0-10 V', 'HART'])])
  const blocks: Block[] = [
    T(`${model} ${noun}`, true),
    T('Datasheet, revision 4. Technical data and ordering information.'),
    ...SENT.map(s => T(s)),
    T('Specifications', true),
    { k: 'table', head: ['Parameter', 'Value'], rows: spec, widths: [0.45, 0.45], align: ['l', 'l'], ruled: true, descCol: 0 },
    { k: 'pagebreak' },
    T('Features and applications', true),
    ...[SENT[3], SENT[4], 'Typical applications are water treatment, chemical dosing, boiler houses, hydraulic power units and general machine building.'].map(s => T(s as string)),
    T('Ordering information', true),
    { k: 'table', head: ['Order code', 'Range', 'Connection', 'Output'], rows: ordering, widths: [0.3, 0.2, 0.25, 0.25], align: ['l', 'l', 'l', 'l'], ruled: false, descCol: 0, size: 8 },
    T('Dimensions and weight are subject to change without notice. Page 2 of 2.'),
  ]
  return { look: 'paper', blocks, page: { font: 'helvetica', size: 9, rowsPerPage: 30 } }
}

const profile: Make = r => {
  const name = `${r.pick(['Alpine', 'Crescent', 'Meridian', 'Horizon', 'Summit'])} ${r.pick(['Controls', 'Instrumentation', 'Process Systems'])} ${r.pick(['Pvt. Ltd.', 'Limited', 'Co.'])}`
  const year = r.int(1989, 2012)
  const blocks: Block[] = [
    T('Company Profile', true),
    T(name, true),
    T(`Established in ${year}, ${name} is a leading supplier of process instrumentation and automation products. We are a trusted partner to plants across the region, with more than ${2026 - year} years of experience.`),
    T('About us', true),
    T('We specialize in measurement, control and drive technology, and we provide complete engineering support from selection to commissioning and after-sales service.'),
    T('Our mission', true),
    T('To keep our customers running by delivering dependable products, honest advice and prompt service every time.'),
    T('Our products and services', true),
    T('Pressure, temperature and flow instruments; PLCs, drives and panels; calibration and repair; training and technical seminars.'),
    T('Our clients', true),
    T('Power, textile, cement, food and chemical plants, water utilities and original equipment manufacturers. We are an authorised distributor of several international brands.'),
    T('Certifications: ISO 9001, ISO 14001. Head office and branches in four cities. Contact: info@example.example.'),
  ]
  return { look: 'paper', blocks, page: { font: 'times', size: 11 } }
}

const followUp: Make = (r, i) => {
  const c = customer(r)
  const lines = [
    ['Dear Wasif,', 'Any update on our enquiry sent last week? Please let us know the status of the quotation.', 'Regards,', c.person],
    ['Hi Wasif,', 'Gentle reminder: still waiting for your offer against our RFQ. Kindly update us today.', 'Thanks', c.person],
    ['Assalam o Alaikum,', 'Did you receive my message about the quotation? Awaiting your reply.', c.person],
  ][i % 3] as string[]
  return { look: 'email', email: { from: `${c.person} <${c.email}>`, sent: `${writeDate(r, dateAfter(-1), 3)} 10:15 AM`, to: 'sales@qtech.example', subject: 'Re: Quotation' }, blocks: lines.map(l => T(l)) }
}

const ownRfq: Make = r => {
  const s = supplier(r)
  const ps = parts(r, r.int(2, 6))
  const rows = ps.map((p, n) => [String(n + 1), p.plain, String(Math.ceil(p.qty(r))), 'Nos'])
  const blocks: Block[] = [
    T(OWN, true),
    T(OWN_ADDR),
    T('Request for Quotation', true),
    { k: 'pair', left: `To: ${s.name}`, right: `Date: ${writeDate(r, dateAfter(0), 0)}` },
    T('Please quote your best price and delivery for the following:'),
    { k: 'table', head: ['Sr', 'Description', 'Qty', 'Unit'], rows, widths: [0.07, 0.65, 0.1, 0.1], align: ['c', 'l', 'r', 'c'], ruled: true, descCol: 1 },
    T(`Quotation due date: ${writeDate(r, dateAfter(5), 0)}`),
  ]
  return { look: 'paper', blocks, page: { font: 'helvetica', size: 9 } }
}

const KINDS: Array<{ kind: DocKind; shape: string; make: Make; n: number }> = [
  { kind: 'po', shape: 'purchase order', make: purchaseOrder, n: 8 },
  { kind: 'invoice', shape: 'sales tax invoice', make: taxInvoice, n: 8 },
  { kind: 'own-quote', shape: 'our own quotation', make: ownQuote, n: 8 },
  { kind: 'brochure', shape: '2-page datasheet', make: datasheet, n: 8 },
  { kind: 'marketing', shape: 'company profile', make: profile, n: 8 },
  { kind: 'follow-up', shape: 'follow-up message', make: followUp, n: 6 },
  { kind: 'own-rfq', shape: 'our own RFQ', make: ownRfq, n: 6 },
]

/** The non-enquiry documents, each as pasted text and as a PDF. */
export const NON_RFQ_CASES: NonRfqCase[] = KINDS.flatMap(k =>
  Array.from({ length: k.n }, (_, i): NonRfqCase => {
    const doc = k.make(rng(`nonrfq/${k.kind}/${i}`), i)
    const medium: NonRfqCase['medium'] = k.kind === 'follow-up' ? 'text' : i % 2 === 0 ? 'text' : 'pdf'
    return { id: `n31-${k.kind}-${i}`, kind: k.kind, shape: k.shape, medium, doc, textStyle: { table: (['tab', 'spaces', 'pipes', 'cells'] as const)[i % 4] as TextStyle['table'], chat: 'android' } }
  }),
)
