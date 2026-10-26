import { describe, expect, it } from 'vitest'
import { ENQUIRY_EMAIL_TABLES } from './__fixtures__/enquiryEmailTables'
import { ENQUIRY_EMAILS } from './__fixtures__/enquiryEmails'
import { ENQUIRY_FULL_EMAILS } from './__fixtures__/enquiryFullEmails'
import { ENQUIRY_HOLDOUT } from './__fixtures__/enquiryHoldout'
import { classifyDoc, KIND_LABEL, NOT_A_SUPPLIER_QUOTE, NOT_AN_ENQUIRY } from './docKind'

// Every document below is invented.

const RFQ = ['Dear Sir, please quote:', '1) Pressure gauge 0-10 bar - 4 nos', '2) Ball valve 1 inch SS316 x 2', 'Regards, K'].join('\n')

describe('classifyDoc', () => {
  it('reads an ordinary enquiry as an enquiry', () => {
    const r = classifyDoc(RFQ)
    expect(r.kind).toBe('rfq')
    expect(r.confidence).toBeGreaterThan(0.5)
    expect(r.reasons.length).toBeGreaterThan(0)
  })

  it('reads a bare list of items with quantities as an enquiry (low confidence), never as something else', () => {
    const r = classifyDoc('Pressure gauge 0-10 bar - 4 nos\nBall valve 1 inch - 2 nos')
    expect(r.kind).toBe('rfq')
    expect(r.confidence).toBeLessThan(0.6)
  })

  it('is unknown when nothing settles it, and for nothing at all', () => {
    expect(classifyDoc('hello').kind).toBe('unknown')
    expect(classifyDoc('').kind).toBe('unknown')
    expect(classifyDoc('   \n  ').kind).toBe('unknown')
  })

  it('reads our own quotation, with its column headings, as ours', () => {
    const rows = Array.from({ length: 22 }, (_, i) => `${i + 1}\tTransmitter model ${100 + i}\t${i + 1}\tNos\t${(i + 1) * 4500}.00\t${(i + 1) * (i + 1) * 4500}.00`)
    const text = ['Q-Tech Engineering', 'Lahore', 'Quotation', 'Quotation no. QT-26-0042\tDate: 20/10/2026', '#\tDescription\tQty\tUnit\tUnit Pr. (PKR)\tTotal (PKR)', ...rows, 'Sub Total\t1,200,000.00', 'Validity: 14 days'].join('\n')
    const r = classifyDoc(text)
    expect(r.kind).toBe('own-quote')
    expect(r.confidence).toBeGreaterThan(0.7)
  })

  it('does not take a customer\'s enquiry for our own paper because it is addressed to us', () => {
    expect(classifyDoc(['From: Asad <asad@mill.example>', 'To: sales@qtech.example', 'Subject: RFQ - Q-Tech', '', 'Messrs Q-Tech Engineering,', 'Please quote 2 nos gauge 0-10 bar.'].join('\n')).kind).toBe('rfq')
  })

  it('does not take an old quotation of ours quoted under a new enquiry for the document', () => {
    const text = [
      'Dear Sir,',
      'Please provide quotation for:',
      '1. Contactor 25A 24VDC coil - 4 Nos',
      '2. Safety relay 24VDC - 2 Nos',
      'Regards, Bilal',
      '',
      '________________________________',
      'From: Wasif <sales@qtech.example>',
      'Sent: Thursday, October 8, 2026 10:25 AM',
      'Subject: Quotation QT-26-0912',
      'Dear Sir, please find our offer:',
      'Limit switch - 2 Nos - PKR 56,000 each',
      'Power supply 24VDC - 2 Nos - PKR 48,000 each',
    ].join('\n')
    expect(classifyDoc(text).kind).toBe('rfq')
  })

  it('reads a purchase order as a purchase order', () => {
    const text = ['Example Mills Ltd', 'PURCHASE ORDER', 'PO No: EM-PO-20114    PO Date: 19/10/2026', 'Vendor: Q-Tech Engineering', 'Payment Terms: 30 days', 'Sr\tDescription\tQty\tUnit\tUnit Price\tAmount', '1\tGauge 0-10 bar\t4\tNos\t4,500.00\t18,000.00', 'Total (PKR)\t18,000.00', 'Terms and Conditions: please acknowledge receipt of this order.', 'Authorised Signatory'].join('\n')
    expect(classifyDoc(text).kind).toBe('po')
  })

  it('reads a sales tax invoice as an invoice, and a proforma invoice from a supplier as a quotation', () => {
    const invoice = ['Q-Tech Engineering', 'NTN: 1234567-8    STRN: 32-00-1234-567-89', 'SALES TAX INVOICE', 'Invoice No: INV-26-1042    Date: 19/10/2026', 'Sr\tDescription\tQty\tRate\tValue excl. GST\tGST 18%', '1\tGauge\t4\t4,500.00\t18,000.00\t3,240.00', 'Amount in words: Rupees only.'].join('\n')
    expect(classifyDoc(invoice).kind).toBe('invoice')
    const pi = ['Shenzhen Example Electric Co., Ltd.', 'PROFORMA INVOICE', 'Buyer: Q-Tech Engineering', 'PI No.: PI-26572', 'Item\tDescription\tQty\tUnit Price (USD)\tAmount (USD)', '1\tCarbon brush\t2\t890.00\t1780', 'TOTAL\t1780.00', 'Validity: until 30/11/2026', 'Payment: 100% T/T in advance'].join('\n')
    expect(classifyDoc(pi).kind).toBe('supplier-quote')
  })

  it('reads a supplier quotation as a quotation, with and without a price column', () => {
    expect(classifyDoc(['Dear Wasif,', 'Thanks for your inquiry. Our offer as below:', '1. Gauge 0-10 bar USD 95 /pc', 'Delivery: 3-5 days', 'Offer valid for 15 days'].join('\n')).kind).toBe('supplier-quote')
    expect(classifyDoc(['Dear Wasif,', 'No\tProduct\tQty\tPrice each (USD)\tDelivery', '1\tPanel meter\t5\t16.00\t2-3 weeks'].join('\n')).kind).toBe('supplier-quote')
  })

  it('reads a product datasheet and a long catalogue as a brochure, never as an enquiry', () => {
    const rows = Array.from({ length: 491 }, (_, i) => `ZX-${String(i).padStart(3, '0')}\t${(i % 40) + 1} bar\tG1/2\t4-20 mA`)
    const sheet = ['ZX-200 Pressure Transmitter datasheet', 'The transmitter measures gauge pressure in clean liquids, gases and steam, and is designed for continuous duty in process plants.', 'Its welded stainless steel housing gives long-term stability under vibration and sudden pressure peaks, with accuracy of 0.1 percent.', 'Specifications', 'Operating temperature\t-40 to 85 C', 'Ingress protection\tIP67', 'Ordering information', ...rows].join('\n')
    const r = classifyDoc(sheet)
    expect(r.kind).toBe('brochure')
    expect(NOT_AN_ENQUIRY).toContain(r.kind)
  })

  it('reads a company profile as marketing', () => {
    const text = ['Company Profile', 'Established in 1998, Alpine Controls is a leading supplier of automation products.', 'About us', 'We provide engineering support. Our mission is to keep customers running. Our clients include power and textile plants.', 'Certifications: ISO 9001. Head office and branches in four cities.'].join('\n')
    expect(classifyDoc(text).kind).toBe('marketing')
  })

  it('reads a short nudge as a follow-up, and a company profile that also asks for a price as an enquiry', () => {
    expect(classifyDoc('Dear Wasif,\nAny update on our enquiry sent last week?\nRegards, Asad').kind).toBe('follow-up')
    const both = ['We are a leading textile company established in 1990. Our mission is quality. Our clients are worldwide.', 'Please quote for 4 nos gauge 0-10 bar.'].join('\n')
    expect(classifyDoc(both).kind).toBe('rfq')
  })

  it('reads our own request for quotation to a supplier as ours', () => {
    const text = ['Q-Tech Engineering', 'Request for Quotation', 'To: Example Trading LLC', 'Please quote your best price for:', 'Sr\tDescription\tQty\tUnit', '1\tGauge 0-10 bar\t4\tNos', 'Quotation due date: 25/10/2026'].join('\n')
    expect(classifyDoc(text).kind).toBe('own-rfq')
  })

  it('gives every kind a plain-language label', () => {
    for (const k of ['rfq', 'supplier-quote', 'own-rfq', 'own-quote', 'po', 'invoice', 'brochure', 'marketing', 'follow-up', 'unknown'] as const) expect(KIND_LABEL[k].length).toBeGreaterThan(3)
  })

  it('never blocks any of the hand-written enquiry fixtures', () => {
    const all = [...ENQUIRY_EMAILS, ...ENQUIRY_FULL_EMAILS, ...ENQUIRY_EMAIL_TABLES, ...ENQUIRY_HOLDOUT]
    expect(all.length).toBeGreaterThan(30)
    const blocked = all.map(c => ({ name: c.name, kind: classifyDoc(c.text).kind })).filter(c => NOT_AN_ENQUIRY.includes(c.kind))
    expect(blocked).toEqual([])
  })
})

// ---- emails: the newest message decides, not the enquiry quoted under it ----
const OUR_RFQ = ['From: sales@q-tech.example', 'Sent: Monday, October 5, 2026 9:00 AM', 'To: sales@vendor.example', 'Subject: Urgent RFQ: Pressure gauge', '', 'Dear Sales Team,', 'Please quote the best price of below items.', '1) Pressure gauge 0-10 bar - 4 nos', 'Regards, Q-Tech'].join('\n')
const below = (top: string) => `${top}\n\n________________________________\n${OUR_RFQ}`
const CTX_OUT = { from: 'Sam <sam@vendor.example>', subject: 'RE: Urgent RFQ: Pressure gauge' }

describe('classifyDoc on an email thread', () => {
  it('reads a supplier price reply as a supplier quotation, not the enquiry quoted under it', () => {
    expect(classifyDoc(below('Hello,\nPlease see price: USD 45 each, lead time 3 days.\nRegards, Sam'), CTX_OUT).kind).toBe('supplier-quote')
    expect(classifyDoc(below('Dear sir, good day.\nPlease see our price below:\nGauge 0-10 bar\t4\t$45.00\nBest regards'), CTX_OUT).kind).toBe('supplier-quote')
  })

  it('reads a regret, a holding note or a question as a supplier reply too', () => {
    expect(classifyDoc(below('Sorry, we cannot offer this item.'), CTX_OUT).kind).toBe('supplier-quote')
    expect(classifyDoc(below('Please give us some time to check with the factory.'), CTX_OUT).kind).toBe('supplier-quote')
    expect(classifyDoc(below('Could you send photos of the nameplate?'), CTX_OUT).kind).toBe('supplier-quote')
    expect(classifyDoc(below('Please provide the update on the order that was previously inquired about.'), CTX_OUT).kind).toBe('supplier-quote')
  })

  it('finds the quoted part in the other layouts: tabs, Original Message, Replied Message, wrote, other languages', () => {
    const top = 'Pls see price: USD 45 each.'
    const layouts = [
      `${top}\n\n-----Original Message-----\nFrom: sales@q-tech.example\nSent: Monday\nTo: x\nSubject: RFQ\n\nPlease quote the best price: 4 nos gauge`,
      `${top}\n---- Replied Message ----\nFrom\t<sales@q-tech.example>\nDate\t10/18/2026\nSubject\tRFQ\n\nPlease quote the best price: 4 nos gauge`,
      `${top}\n\nOn Mon, 5 Oct 2026, Q-Tech <sales@q-tech.example> wrote:\n> Please quote the best price: 4 nos gauge`,
      `${top}\n\nDa: sales@q-tech.example\nInviato: lunedi 5 ottobre\nA: x\nOggetto: RFQ\n\nPlease quote the best price: 4 nos gauge`,
    ]
    for (const t of layouts) expect(classifyDoc(t, CTX_OUT).kind).toBe('supplier-quote')
  })

  it('cuts at a quoted header even when the reply is a single short line', () => {
    expect(classifyDoc(below('not have'), CTX_OUT).kind).toBe('supplier-quote')
  })

  it('reads a customer chasing, or talking about an order, as a follow-up', () => {
    const thread = (top: string) => `${top}\n\nFrom: Sales <sales@q-tech.example>\nSent: Monday\nTo: buyer@mill.example\nSubject: Quotation - relay\n\nThank you for your inquiry. Please find the attached quotation and feel free to contact us.`
    expect(classifyDoc(thread('Please share the update?'), { from: 'Buyer <buyer@mill.example>', subject: 'RE: Quotation - relay' }).kind).toBe('follow-up')
    expect(classifyDoc(thread('Kindly confirm the delivery date.'), { from: 'Buyer <buyer@mill.example>', subject: 'RE: PO # 1234: Quotation' }).kind).toBe('follow-up')
  })

  it('reads a forward of a customer enquiry as an enquiry, with or without a header block under the banner', () => {
    const cust = ['Dear Team,', 'Kindly provide your offer for the below items.', '1) Pressure gauge 0-10 bar - 4 nos', 'Regards']
    const fwd1 = ['FYI', '', '---------- Forwarded message ---------', 'From: Buyer <buyer@mill.example>', 'Date: Fri, 16 Oct 2026', 'Subject: Purchase inquiry 1234', '', ...cust].join('\n')
    const fwd2 = ['FN', '', '---------- Forwarded message ---------', ...cust].join('\n')
    expect(classifyDoc(fwd1, { from: 'Q-Tech <q@gmail.example>', subject: 'Fwd: Purchase inquiry 1234' }).kind).toBe('rfq')
    expect(classifyDoc(fwd2).kind).toBe('rfq')
  })

  it('reads a forward of a supplier offer as a supplier quotation', () => {
    const t = ['FYI', 'From: Gesint <info@vendor.example>', 'Sent: Wednesday', 'To: q@q-tech.example', 'Subject: R: RFQ', '', 'Below our best offer for the item requested:', 'Gauge 1 pc EUR 230,00 each', 'Delivery time: 1 week', '', 'Da: q@q-tech.example', 'Inviato: lunedi', 'Oggetto: RFQ', '', 'Please quote the best price for 1 gauge.'].join('\n')
    expect(classifyDoc(t, { from: 'Q-Tech <q@gmail.example>', subject: 'FW: RFQ' }).kind).toBe('supplier-quote')
  })

  it('reads mail we wrote as our own enquiry, our own quotation or an internal note', () => {
    const us = { from: 'Q-Tech <sales@q-tech.example>' }
    expect(classifyDoc('Dear Ms. Lee,\n\nPlease send the price quotation with reseller price of below part.\n\nInductive sensor X1\nQuantity 4 nos', us).kind).toBe('own-rfq')
    expect(classifyDoc('Dear Sir,\nThank you for considering us. Please find attached our price quotation along with the catalogue.', us).kind).toBe('own-quote')
    expect(classifyDoc('Dear Maggie,\nThank you for sharing the price quote. Please confirm the model is correct.', us).kind).toBe('follow-up')
    const note = 'REMINDER\n\nFrom: Q-Tech <sales@q-tech.example>\nSent: Monday\nTo: buyer@mill.example\nSubject: Re: technical advice\n\nDear Mr. Ali, hope you are fine. Awaiting your reply.'
    expect(classifyDoc(note, { from: 'Q-Tech <q@gmail.example>', subject: 'Fw: technical advice' }).kind).toBe('follow-up')
  })

  it('reads a cold sales mail as marketing even when it invites our RFQs, and a customer request as an enquiry', () => {
    const cold = 'Hi dear,\nThis is Max from Acme Trading, an independent distributor of electronic components. We have competitive pricing and stable supply.\nIf you have any current RFQs, please send them to me and I will provide you with our best prices.\nBest regards, Max'
    expect(classifyDoc(cold, { from: 'max@acme.example', subject: 'Industrial parts supply' }).kind).toBe('marketing')
    expect(classifyDoc('Dear Sir,\nWe kindly request a quotation for Request No:2200451 at your earliest convenience.', { from: 'buyer@mill.example', subject: 'Request No:2200451' }).kind).toBe('rfq')
  })

  it('reads a fresh supplier mail with a quotation attached as a supplier quotation', () => {
    expect(classifyDoc('Dear Faizan,\nGood day, thank you for your inquiry. Please find the quotation attached.\nModel X1  1  6500  1-2 weeks', { from: 'sales@vendor.example', subject: 'Urgent RFQ: relays' }).kind).toBe('supplier-quote')
  })

  it('reads our quotation PDF by its reference and a datasheet by its title and figures', () => {
    const q = ['QUOTATION', 'M/s: Example Mills Limited', 'Quotation Ref: QTS-EML6510', 'Sr#\tItem Description\tQuantity\tUnit Pr. (PKR)\tTotal Pr. (PKR)', '1 Sensor\t3\t148,016\t444,048', 'Gross Amount W/O GST\t444,048'].join('\n')
    expect(classifyDoc(q).kind).toBe('own-quote')
    const sheet = ['TECH DATA SHEET', 'Power supply', '230Vac (15mA)', 'Working temperature', '0 to 50 C, 5A 250V', 'Dimensions', 'H = 100mm  L = 45mm', 'Weight', '390 g max', 'Pressure range 0.3 to 10 bar'].join('\n')
    expect(classifyDoc(sheet, { isPdf: true }).kind).toBe('brochure')
  })

  it('never lets an RS232 connector name pass for a price', () => {
    expect(classifyDoc('Interfaces\nRS232C (In/Out), RJ45\nRS232C (In) Gender\nRS485 port\n', { isPdf: true }).kind).not.toBe('supplier-quote')
  })

  it('does not block on unknown, in either screen', () => {
    expect(NOT_AN_ENQUIRY).not.toContain('unknown')
    expect(NOT_A_SUPPLIER_QUOTE).not.toContain('unknown')
    expect(classifyDoc('ok, noted').kind).toBe('unknown')
  })
})

describe('a one-line price pasted as a reply (R-0 follow-up)', () => {
  it('is not called an enquiry, so a pasted reply is not held', () => {
    for (const t of ['AB-100 DN50: EUR 1.234 each', 'AB-100 DN50 - USD 100.00 each, 3 weeks']) {
      expect(NOT_A_SUPPLIER_QUOTE).not.toContain(classifyDoc(t).kind)
    }
  })
})
