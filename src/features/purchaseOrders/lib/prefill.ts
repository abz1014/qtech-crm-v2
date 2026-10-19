// Supplier PO (O07): the lines of the Issue purchase order dialog and what they cost. Pure and framework-free.
//
// Each line's price comes from the first source that has one, in this order (DATA_MODEL 2.26, Amendment A2b), and always says where it
// came from: the order, the supplier's quote, the supplier's last PO, or typed. The database (po_line_prefill, migration 0043) decides
// the source; this file words it and adds up the money. A price the person types over becomes "typed", exactly as issue_purchase_order
// labels it when the issued price differs from the pre-fill.

import { formatDay, formatShortDate } from '@/lib/formatDay'
import { poRef, rfqRef } from '@/lib/refs'

export type PriceSource = 'order' | 'quote' | 'last_po' | 'typed'

export interface PrefillRow {
  orderItemId: string
  position: number
  description: string
  qty: number
  unit: string | null
  /** The pre-filled price in the leg's currency, or null when nothing knows one. */
  unitPrice: number | null
  source: PriceSource
  sourceNumber: number | null
  sourceRevision: number | null
  sourceOn: string | null
}

/** The price a person has typed for a line: undefined means "leave the pre-fill", null means "cleared". */
export type Typed = Readonly<Record<string, number | null | undefined>>

/** The price that will be issued for a line. */
export function priceOf(row: PrefillRow, typed: Typed): number | null {
  const t = typed[row.orderItemId]
  return t === undefined ? row.unitPrice : t
}

/** The source that will be recorded: a price different from the pre-fill is typed. */
export function sourceOf(row: PrefillRow, typed: Typed): PriceSource {
  const t = typed[row.orderItemId]
  if (t === undefined || t === row.unitPrice) return row.source
  return 'typed'
}

export interface SourceText {
  /** The chip: "order", "last PO", "quote", "typed". */
  chip: string
  /** The line under it: "Agreed on the order", "PO-26-0009, 14 Aug 2026". */
  detail: string
}

export function sourceText(row: PrefillRow, typed: Typed, today: string): SourceText {
  const src = sourceOf(row, typed)
  if (src === 'order') return { chip: 'order', detail: 'Agreed on the order' }
  if (src === 'quote') {
    return {
      chip: 'quote',
      detail: `Their quote${row.sourceNumber !== null ? `, ${rfqRef(row.sourceNumber)}` : ''}${row.sourceOn ? `, ${formatShortDate(row.sourceOn, today)}` : ''}`,
    }
  }
  if (src === 'last_po') {
    const ref = row.sourceNumber !== null && row.sourceOn ? `${poRef(row.sourceNumber, row.sourceOn)}${row.sourceRevision ? ` R${row.sourceRevision}` : ''}` : 'Last PO'
    return { chip: 'last PO', detail: `${ref}${row.sourceOn ? `, ${formatDay(row.sourceOn).replace(/^\w{3} /, '')} ${row.sourceOn.slice(0, 4)}` : ''}` }
  }
  return { chip: 'typed', detail: priceOf(row, typed) === null ? 'Type a price' : 'Typed by you, check it' }
}

/** Qty times price in the leg's currency, to 2 decimals (the database rounds the same way when it totals the PO). */
export function lineTotal(qty: number, price: number | null): number | null {
  return price === null ? null : Math.round(qty * price * 100) / 100
}

/**
 * A unit price as the PO prints it: two decimals at least, up to the four a supplier price is stored at (numeric(14,4)), with grouping.
 * Rounding 0.125 to 0.13 would make qty x unit price disagree with the line amount on the PDF.
 */
export function unitPriceText(price: number): string {
  const [whole, frac] = Math.abs(price).toFixed(4).split('.')
  const kept = frac.replace(/0+$/, '').padEnd(2, '0')
  return `${price < 0 ? '−' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${kept}`
}

export function poTotal(rows: readonly PrefillRow[], typed: Typed): number {
  return rows.reduce((n, r) => n + Math.round((lineTotal(r.qty, priceOf(r, typed)) ?? 0) * 100), 0) / 100
}

/** Lines still without a price: the PO cannot be issued until each has one. */
export function missingPrices(rows: readonly PrefillRow[], typed: Typed): PrefillRow[] {
  return rows.filter(r => {
    const p = priceOf(r, typed)
    return p === null || p < 0
  })
}

/** The p_lines of issue_purchase_order: every goods line with the price and quantity to issue. */
export function issueLines(rows: readonly PrefillRow[], typed: Typed): Array<{ order_item_id: string; unit_price: number; qty: number }> {
  return rows.map(r => ({ order_item_id: r.orderItemId, unit_price: priceOf(r, typed) as number, qty: r.qty }))
}

// ---------------------------------------------------------------- terms

export interface LastPo {
  number: number
  revision: number
  issuedOn: string
  incoterm: string | null
  deliveryTerms: string | null
  paymentTerms: string | null
}

export interface Defaulted {
  value: string
  /** Where the value came from, in words: "from PO-26-0009", "company profile", "Q-Tech office, default". Null when nothing was filled. */
  source: string | null
}

export interface TermsDefaults {
  incoterm: Defaulted
  delivery: Defaulted
  payment: Defaulted
  shipTo: Defaulted
}

/**
 * Incoterm, delivery and payment terms default to the supplier's last PO (so a repeat order asks for nothing); payment terms fall back
 * to the company profile's standard PO terms; ship-to is the company profile's address. Same rule as issue_purchase_order's coalesce.
 */
export function termsDefaults(last: LastPo | null, profile: { po_terms: string | null; address: string | null } | null | undefined): TermsDefaults {
  const from = last ? `from ${poRef(last.number, last.issuedOn)}` : null
  const pick = (v: string | null | undefined): string => (v ?? '').trim()
  const lastPay = pick(last?.paymentTerms)
  const profilePay = pick(profile?.po_terms)
  return {
    incoterm: { value: pick(last?.incoterm), source: pick(last?.incoterm) ? from : null },
    delivery: { value: pick(last?.deliveryTerms), source: pick(last?.deliveryTerms) ? from : null },
    payment: lastPay ? { value: lastPay, source: from } : { value: profilePay, source: profilePay ? 'company profile' : null },
    shipTo: { value: pick(profile?.address), source: pick(profile?.address) ? 'Q-Tech office, default' : null },
  }
}

export const INCOTERMS = ['EXW', 'FCA', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const

// ---------------------------------------------------------------- the amount in words, in the leg's currency

const NAMES: Record<string, [string, string, string, string]> = {
  PKR: ['rupee', 'rupees', 'paisa', 'paise'],
  USD: ['US dollar', 'US dollars', 'cent', 'cents'],
  EUR: ['euro', 'euros', 'cent', 'cents'],
  GBP: ['pound sterling', 'pounds sterling', 'penny', 'pence'],
  AED: ['UAE dirham', 'UAE dirhams', 'fils', 'fils'],
  CNY: ['yuan', 'yuan', 'fen', 'fen'],
}

/** "Four thousand two hundred thirteen US dollars only." Any other currency is written with its code. */
export function currencyInWords(minor: bigint, currency: string, wholeInWords: (n: number) => string): string {
  const [one, many, minorOne, minorMany] = NAMES[currency] ?? [currency, currency, 'minor unit', 'minor units']
  const whole = Number(minor / 100n)
  const part = Number(minor % 100n)
  let s = `${wholeInWords(whole)} ${whole === 1 ? one : many}`
  if (part > 0) s += ` and ${wholeInWords(part)} ${part === 1 ? minorOne : minorMany}`
  return `${s.charAt(0).toUpperCase()}${s.slice(1)} only.`
}

// ---------------------------------------------------------------- the PDF's standard terms

/** The mockup's sample wording for "Terms of this order", printed when a PO has none of its own. The owner replaces it (open question Q5). */
export const STANDARD_TERMS = [
  'Please acknowledge this order in writing within 2 working days.',
  'Goods must be new, genuine and exactly the models and options described above.',
  'Any change to price, quantity or delivery needs our written approval before it takes effect.',
  'Mark every package with the PO number. Goods that do not match this order may be returned at the supplier’s cost.',
]
