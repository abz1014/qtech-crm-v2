// Template generation 32: the EU quotation PDF, the Italian "Preventivo / Offerta" layout. Every name and number is invented.
// 32: a letterhead with address and tax number, "Preventivo n." and "Data:" in two columns, Italian column headings (Pos. / Codice /
//     Descrizione / Q.tà / Prezzo unitario / Importo / Consegna), prices in the European format (1.250,00), lead times in weeks
//     ("4 settimane", "Pronta consegna"), Imponibile / IVA / Totale under the table and the terms in Italian (Validità offerta,
//     Pagamento, Resa). The reader turns the labels into English and takes the rest as it does for any other quotation.

import type { Block } from './model'
import type { QuoteTemplate } from './quotes'
import { dateAfter, parts, supplier } from './vocab'

const eu = (n: number) => n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const PAYMENTS = ['Bonifico bancario 30 gg d.f.', 'Bonifico anticipato 100%', 'RiBa 60 gg d.f.f.m.', 'Bonifico bancario 50% all\'ordine, saldo prima della spedizione', 'Bonifico bancario a vista fattura']
const LEADS: Array<{ text: string; max: number }> = [
  { text: '2 settimane', max: 14 },
  { text: '3 settimane', max: 21 },
  { text: '4 settimane', max: 28 },
  { text: '4-6 settimane', max: 42 },
  { text: '6-8 settimane', max: 56 },
  { text: '15 giorni', max: 15 },
  { text: 'Pronta consegna', max: 0 },
]

export const preventivoQuote: QuoteTemplate = r => {
  const s = supplier(r, 'europe')
  const city = r.pick(['Brescia', 'Bergamo', 'Modena', 'Padova', 'Torino', 'Vicenza'])
  const lines = parts(r, r.int(2, 6)).map((p, i) => ({
    id: `it${i + 1}`,
    p,
    qty: Math.ceil(p.qty(r)),
    price: r.pick([18.4, 38.5, 96.5, 312, 980, 1250, 2480, 4780]),
    lead: r.pick(LEADS),
  }))
  const ref = `${r.pick(['2026/', 'P26-', 'OFF-26/'])}${r.int(100, 999)}`
  const validity = r.pick([15, 30, 30, 45, 60])
  const payment = r.pick(PAYMENTS)
  const wrongOrder = r.chance(0.3)
  const incoterm = `EXW ${city}`
  const headCur = r.chance(0.5)
  const total = lines.reduce((n, l) => n + l.price * l.qty, 0)
  const vat = Math.round(total * 22) / 100
  const rows = lines.map((l, i) => [String(i + 1), l.p.part ?? '-', l.p.plain.replace(l.p.part ?? '\u0000', '').replace(/,?\s*Model\s*$/, '').trim(), String(l.qty), eu(l.price), eu(Math.round(l.price * l.qty * 100) / 100), l.lead.text])
  const foot = [
    ['', '', 'Imponibile', '', '', `€ ${eu(total)}`, ''],
    ['', '', 'IVA 22%', '', '', `€ ${eu(vat)}`, ''],
    ['', '', 'Totale', '', '', `€ ${eu(Math.round((total + vat) * 100) / 100)}`, ''],
  ]
  const blocks: Block[] = [
    { k: 'text', text: 'PREVENTIVO', bold: true, size: 14, align: 'center' },
    { k: 'pair', left: 'Spett.le Q-Tech Engineering', right: `Preventivo n. ${ref}` },
    { k: 'pair', left: 'Alla c.a. Sig. Wasif', right: `Data: ${dateAfter(r.int(0, 3)).iso.split('-').reverse().join('/')}` },
    { k: 'text', text: `Vs. richiesta: RFQ-QT-${r.int(100, 999)}` },
    { k: 'gap' },
    {
      k: 'table',
      head: ['Pos.', 'Codice', 'Descrizione', 'Q.tà', headCur ? 'Prezzo unit. (€)' : 'Prezzo unit.', headCur ? 'Importo (€)' : 'Importo', 'Consegna'],
      rows,
      widths: [0.07, 0.14, 0.25, 0.07, 0.15, 0.14, 0.18],
      align: ['c', 'l', 'l', 'r', 'r', 'r', 'c'],
      ruled: r.chance(0.7),
      descCol: 2,
      foot,
    },
    { k: 'gap' },
    { k: 'text', text: `Validità offerta: ${validity} giorni` },
    { k: 'text', text: `Pagamento: ${payment}` },
    { k: 'text', text: wrongOrder ? `Resa: ${incoterm} (Incoterms 2020)` : `Resa: Franco fabbrica ${city}` },
    { k: 'gap' },
    { k: 'text', text: `Coordinate bancarie: IBAN IT${r.int(10, 99)} X${r.int(1000, 9999)} ${r.int(10000, 99999)} ${r.int(100000, 999999)}` },
    { k: 'text', text: `Cordiali saluti, ${s.person}` },
  ]
  const letterhead: Block[] = [
    { k: 'text', text: s.name, bold: true, size: 13 },
    { k: 'text', text: `Via ${r.pick(['Garibaldi', 'Roma', 'Mazzini', 'dell\'Industria'])} ${r.int(2, 90)}, ${r.int(20000, 38999)} ${city}`, size: 8 },
    { k: 'text', text: `P.IVA IT${r.int(10000000000, 99999999999)}  Tel. ${s.phone}`, size: 8 },
    { k: 'gap' },
  ]
  return {
    doc: { look: 'paper', blocks, page: { font: r.pick(['helvetica', 'times']), size: 9, letterhead, footer: r.chance(0.5) ? 'Pag. {n} di {m}' : undefined } },
    rfq: lines.map(l => ({ id: l.id, description: l.p.plain, model: l.p.part, qty: l.qty, unit: 'nos' })),
    truth: {
      lines: lines.map(l => ({ itemId: l.id, unitPrice: l.price, currency: 'EUR', leadMax: l.lead.max, validityDays: validity })),
      unpriced: [],
      currency: 'EUR',
      validityDays: validity,
      payment,
      incoterm,
      quoteRef: ref,
    },
    media: ['pdf', 'text'],
  }
}

export const QUOTE_TEMPLATES_GEN32: Array<{ shape: string; make: QuoteTemplate; weight: number }> = [{ shape: 'quote_preventivo', make: preventivoQuote, weight: 4 }]
