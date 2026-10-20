import { gstWholeRupeesPaisa, productPaisa, toPaisa, type Amount } from '@/lib/money'

/*
 * The sales-tax invoice PDF (owner decision 2026-10-20, item 2): the pure rules. No React, no database, so every figure is
 * unit-tested (model.test.ts).
 *
 * Where the lines come from. An invoice row stores only its net and its GST (DATA_MODEL 2.16): those two are the legal figures,
 * already in the GST register and sent to FBR, and the PDF prints them unchanged. The lines are the order's lines
 * (order_items): every line when the invoice is the whole order, otherwise the lines this invoice covers, found by their net
 * (a unique set of whole lines that adds up to the invoice net) or ticked by the person, with a smaller quantity for a part
 * delivery. Nothing about the pick is stored. The ticked lines must add up to the invoice net to the paisa, or nothing prints.
 *
 * Line arithmetic is the database's (v_order_items_total, 0014): line net = round(qty x unit price, 2), line sales tax =
 * round(line net x rate / 100, 0), whole rupees per line (DATA_MODEL 2.13). Exempt is a 0% line: no tax, never adjusted.
 *
 * The +/- Rs 1 rule (P9 money review, DECISIONS 2026-10-19 item 1: rounding GST to whole rupees per line may move a total by
 * about Rs 1, accepted). The invoice's stored GST can differ from the sum of the lines' own rounded tax, e.g. when the amounts
 * were edited at creation (GST on the total) or for an imported invoice. The PDF never changes the stored figure: the
 * difference is moved onto the taxable lines whose own figure was nearest to rounding the other way, at most Rs 1 per line
 * (a sub-rupee remainder, legacy paisa only, rides on the next such line), so the sales-tax column adds up to the stored GST
 * exactly. A difference larger than Rs 1 per taxable line is not rounding: the PDF is blocked and says so.
 */

// ------------------------------------------------------------------ inputs

/** One order line as the PDF needs it (order_items). */
export interface PdfOrderLine {
  id: string
  description: string
  qty: Amount
  unit: string | null
  unitPriceNet: Amount
  /** Percent, 18 or 0 (exempt). */
  gstRate: Amount
}

/** A line on this invoice and how much of it (at most the order line's quantity). */
export interface LinePick {
  id: string
  qty: Amount
}

/** The invoice's stored, legal figures. */
export interface StoredAmounts {
  net: Amount
  gst: Amount
}

// ------------------------------------------------------------------ line arithmetic

const RATE_SCALE = 100n // rate percent to hundredths ("18" is 1800)

function rateHundredths(rate: Amount): bigint {
  const n = Number(rate)
  if (!Number.isFinite(n) || n < 0) throw new Error(`Not a GST rate: ${String(rate)}`)
  return BigInt(Math.round(n * 100))
}

const isTaxable = (rate: Amount): boolean => Number(rate) > 0

/** Quantity as a number with up to 3 decimals (numeric(12,3)). */
const qtyNumber = (q: Amount): number => Math.round(Number(q) * 1000) / 1000

export interface PrintedLine {
  id: string
  /** 1, 2, 3 in the order of the order's lines. */
  no: number
  description: string
  qty: number
  unit: string | null
  /** Unit price excluding tax, in paisa. */
  unitPrice: bigint
  ratePercent: number
  exempt: boolean
  /** Value excluding tax, in paisa. */
  net: bigint
  /** The line's own tax, round(net x rate / 100) whole rupees, in paisa. */
  ownGst: bigint
  /** The tax printed: ownGst, moved by at most Rs 1 when the invoice's stored GST asks for it. */
  gst: bigint
  /** Value including tax. */
  gross: bigint
}

export interface RateTotal {
  ratePercent: number
  net: bigint
  gst: bigint
}

export interface InvoiceFigures {
  lines: PrintedLine[]
  /** Equal to the stored invoice net, GST and net + GST, to the paisa. */
  net: bigint
  gst: bigint
  gross: bigint
  /** Value and tax per rate, highest rate first ("Sales tax at 18%"; exempt at 0). */
  byRate: RateTotal[]
  /** Stored GST minus the sum of the lines' own tax (0 when nothing was moved). */
  adjustment: bigint
  /** The lines whose printed tax differs from their own rounding. */
  adjustedLines: number[]
}

export type FiguresProblem =
  | { kind: 'no-lines' }
  | { kind: 'bad-qty'; lineId: string; max: number }
  | { kind: 'net-differs'; linesNet: bigint; invoiceNet: bigint }
  | { kind: 'gst-differs'; linesGst: bigint; invoiceGst: bigint; taxableLines: number }

export type FiguresResult = { ok: true; figures: InvoiceFigures } | { ok: false; problem: FiguresProblem }

/**
 * Move `difference` paisa (stored GST minus the lines' own tax) across the taxable lines, at most Rs 1 (100 paisa) per line.
 * Lines nearest to having rounded the other way go first: for more tax, the ones that were rounded down the most; for less,
 * the ones rounded up the most. Ties: the larger net, then the earlier line. Exempt and free lines never carry any, and no
 * line's tax goes below zero. Returns null when the difference is more than the lines can carry.
 */
export function spreadGstDifference(lines: ReadonlyArray<Pick<PrintedLine, 'net' | 'ownGst' | 'ratePercent'>>, difference: bigint): bigint[] | null {
  const moves = lines.map(() => 0n)
  if (difference === 0n) return moves
  // Only a taxed line with a value can carry a rupee: a free line never gets tax, and no line's tax goes below zero.
  const taxable = lines.map((l, i) => ({ l, i })).filter(x => x.l.ratePercent > 0 && x.l.net > 0n && (difference > 0n || x.l.ownGst >= 100n))
  const abs = difference < 0n ? -difference : difference
  const steps = Number((abs + 99n) / 100n)
  if (steps > taxable.length) return null
  // residual = exact tax - own tax, scaled by 10^4 so it stays an integer: net (paisa) x rate (hundredths) - own x 10^4
  const residual = (x: (typeof taxable)[number]) => x.l.net * rateHundredths(x.l.ratePercent) - x.l.ownGst * RATE_SCALE * RATE_SCALE
  const sign = difference > 0n ? 1n : -1n
  const ordered = [...taxable].sort((a, b) => {
    const ra = residual(a) * sign
    const rb = residual(b) * sign
    if (ra !== rb) return ra > rb ? -1 : 1
    if (a.l.net !== b.l.net) return a.l.net > b.l.net ? -1 : 1
    return a.i - b.i
  })
  let left = abs
  for (const x of ordered) {
    if (left === 0n) break
    const step = left >= 100n ? 100n : left
    moves[x.i] = step * sign
    left -= step
  }
  return moves
}

/**
 * The printed figures of an invoice: the picked lines (in the order's order), their values and tax, reconciled to the stored
 * net and GST. Blocked (not a broken PDF) when the lines do not add up to the invoice net, or the tax differs by more than
 * the +/- Rs 1 per line rule allows.
 */
export function invoiceFigures(orderLines: readonly PdfOrderLine[], picks: readonly LinePick[], stored: StoredAmounts): FiguresResult {
  const pickById = new Map(picks.map(p => [p.id, p]))
  const printed: PrintedLine[] = []
  for (const line of orderLines) {
    const pick = pickById.get(line.id)
    if (!pick) continue
    const qty = qtyNumber(pick.qty)
    const max = qtyNumber(line.qty)
    if (!(qty > 0) || qty > max) return { ok: false, problem: { kind: 'bad-qty', lineId: line.id, max } }
    const net = productPaisa(qty, line.unitPriceNet)
    const ratePercent = Number(line.gstRate)
    const ownGst = isTaxable(line.gstRate) ? gstWholeRupeesPaisa(net, line.gstRate) : 0n
    printed.push({
      id: line.id,
      no: printed.length + 1,
      description: line.description,
      qty,
      unit: line.unit,
      unitPrice: toPaisa(line.unitPriceNet),
      ratePercent,
      exempt: !isTaxable(line.gstRate),
      net,
      ownGst,
      gst: ownGst,
      gross: net + ownGst,
    })
  }
  if (printed.length === 0) return { ok: false, problem: { kind: 'no-lines' } }

  const invoiceNet = toPaisa(stored.net)
  const invoiceGst = toPaisa(stored.gst)
  const linesNet = printed.reduce((s, l) => s + l.net, 0n)
  if (linesNet !== invoiceNet) return { ok: false, problem: { kind: 'net-differs', linesNet, invoiceNet } }

  const linesGst = printed.reduce((s, l) => s + l.ownGst, 0n)
  const difference = invoiceGst - linesGst
  const moves = spreadGstDifference(printed, difference)
  if (!moves) {
    return { ok: false, problem: { kind: 'gst-differs', linesGst, invoiceGst, taxableLines: printed.filter(l => !l.exempt).length } }
  }
  const lines = printed.map((l, i) => {
    const gst = l.ownGst + moves[i]
    return { ...l, gst, gross: l.net + gst }
  })

  const rates = new Map<number, RateTotal>()
  for (const l of lines) {
    const t = rates.get(l.ratePercent) ?? { ratePercent: l.ratePercent, net: 0n, gst: 0n }
    t.net += l.net
    t.gst += l.gst
    rates.set(l.ratePercent, t)
  }
  return {
    ok: true,
    figures: {
      lines,
      net: invoiceNet,
      gst: invoiceGst,
      gross: invoiceNet + invoiceGst,
      byRate: [...rates.values()].sort((a, b) => b.ratePercent - a.ratePercent),
      adjustment: difference,
      adjustedLines: lines.filter(l => l.gst !== l.ownGst).map(l => l.no),
    },
  }
}

// ------------------------------------------------------------------ which lines

export type LineMatch =
  | { how: 'whole-order'; picks: LinePick[] }
  | { how: 'matched'; picks: LinePick[] }
  | { how: 'ambiguous' | 'none'; picks: LinePick[] }

const fullPick = (l: PdfOrderLine): LinePick => ({ id: l.id, qty: l.qty })

/** More lines than this are not searched for a subset (2^20 sums); the person ticks them. */
export const MAX_SEARCH_LINES = 20

/**
 * The lines an invoice covers, read from its net: every line when they add up to it (the usual case: one invoice per order),
 * else the one set of whole lines that adds up to it exactly. Two or more such sets, or none (a part quantity, a typed
 * amount), leave the choice to the person. Free lines (net 0) are only ever part of the whole order.
 */
export function matchLines(orderLines: readonly PdfOrderLine[], invoiceNet: Amount): LineMatch {
  const target = toPaisa(invoiceNet)
  const nets = orderLines.map(l => productPaisa(l.qty, l.unitPriceNet))
  const all = nets.reduce((s, n) => s + n, 0n)
  if (orderLines.length > 0 && all === target) return { how: 'whole-order', picks: orderLines.map(fullPick) }

  const priced = orderLines.map((l, i) => ({ l, n: Number(nets[i]) })).filter(x => x.n > 0)
  if (priced.length === 0 || priced.length > MAX_SEARCH_LINES || target <= 0n) return { how: 'none', picks: [] }
  const goal = Number(target)
  // depth-first over the lines, largest first; prune when the rest cannot reach the goal or the sum is past it
  const sorted = [...priced].sort((a, b) => b.n - a.n)
  // rest[i]: the sum of sorted[i..], the most the remaining lines can still add
  const rest: number[] = new Array<number>(sorted.length + 1).fill(0)
  for (let i = sorted.length - 1; i >= 0; i--) rest[i] = rest[i + 1] + sorted[i].n
  const found: number[][] = []
  const chosen: number[] = []
  const walk = (i: number, sum: number) => {
    if (found.length > 1) return
    if (sum === goal) {
      found.push([...chosen])
      return
    }
    if (i >= sorted.length || sum > goal || sum + rest[i] < goal) return
    chosen.push(i)
    walk(i + 1, sum + sorted[i].n)
    chosen.pop()
    walk(i + 1, sum)
  }
  walk(0, 0)
  if (found.length === 1) {
    const ids = new Set(found[0].map(i => sorted[i].l.id))
    return { how: 'matched', picks: orderLines.filter(l => ids.has(l.id)).map(fullPick) }
  }
  return { how: found.length > 1 ? 'ambiguous' : 'none', picks: [] }
}

// ------------------------------------------------------------------ what must be filled in first

export interface SellerTax {
  legal_name: string | null
  address: string | null
  ntn: string | null
  strn: string | null
}

export interface BuyerTax {
  name: string
  ntn: string | null
  strn: string | null
  /** true registered, false not registered, null not known yet. */
  salesTaxRegistered: boolean | null
  invoiceAddress: string | null
}

const filled = (s: string | null | undefined): s is string => Boolean(s && s.trim())

/** Registered for sales tax, as far as the CRM knows: the stated status, else yes when there is an STRN, else unknown. */
export function buyerRegistered(b: Pick<BuyerTax, 'salesTaxRegistered' | 'strn'>): boolean | null {
  if (b.salesTaxRegistered !== null) return b.salesTaxRegistered
  return filled(b.strn) ? true : null
}

/** The buyer address on the invoice: the company's invoice address, else the order's delivery site address. */
export function buyerAddress(b: Pick<BuyerTax, 'invoiceAddress'>, siteAddress: string | null): string | null {
  if (filled(b.invoiceAddress)) return b.invoiceAddress.trim()
  return filled(siteAddress) ? siteAddress.trim() : null
}

export type GapWhere = 'company-profile' | 'buyer' | 'invoice' | 'order'

export interface Gap {
  where: GapWhere
  /** What to fill in, as a phrase that completes "Fill in ...". */
  text: string
}

export interface ReadinessInput {
  seller: SellerTax | null
  buyer: BuyerTax | null
  siteAddress: string | null
  invoice: { number: string | null; invoiceDate: string | null; orderId: string | null }
  orderFlags: readonly string[]
}

export interface Readiness {
  /** Blocking: the PDF is not made while any is open. */
  gaps: Gap[]
  /** Not blocking: printed without, but worth filling in. */
  warnings: string[]
}

/**
 * What section 23(1) of the Sales Tax Act, 1990 needs that the CRM does not have yet. Blocking: the supplier's name, address,
 * NTN and STRN (company profile); the invoice's number, date and order (its lines); the buyer's address; whether the buyer is
 * registered, and a registered buyer's STRN. Not blocking: the buyer's NTN or CNIC (asked by FBR's digital invoicing; the
 * Finance Act 2019 condition for unregistered buyers was reported withdrawn in 2022).
 */
export function invoiceReadiness(input: ReadinessInput): Readiness {
  const gaps: Gap[] = []
  const warnings: string[] = []
  const s = input.seller
  if (!filled(s?.legal_name)) gaps.push({ where: 'company-profile', text: 'your company’s legal name' })
  if (!filled(s?.address)) gaps.push({ where: 'company-profile', text: 'your company’s address' })
  if (!filled(s?.ntn)) gaps.push({ where: 'company-profile', text: 'your company’s NTN' })
  if (!filled(s?.strn)) gaps.push({ where: 'company-profile', text: 'your company’s STRN (sales-tax registration number)' })

  if (!filled(input.invoice.number)) gaps.push({ where: 'invoice', text: 'the invoice number (this imported invoice has none)' })
  if (!input.invoice.invoiceDate) gaps.push({ where: 'invoice', text: 'the invoice date' })
  if (!input.invoice.orderId) gaps.push({ where: 'invoice', text: 'the order (this invoice is in the register without an order, so it has no lines to print)' })
  if (input.orderFlags.includes('value_basis_unknown')) gaps.push({ where: 'order', text: 'whether the order’s prices include GST (answer it on the order page)' })

  const b = input.buyer
  if (b) {
    if (!buyerAddress(b, input.siteAddress)) gaps.push({ where: 'buyer', text: `${b.name}’s address` })
    const registered = buyerRegistered(b)
    if (registered === null) gaps.push({ where: 'buyer', text: `whether ${b.name} is registered for sales tax` })
    else if (registered && !filled(b.strn)) gaps.push({ where: 'buyer', text: `${b.name}’s STRN (it is registered for sales tax)` })
    if (!filled(b.ntn)) warnings.push(`No NTN or CNIC for ${b.name}. It prints without one; FBR’s digital invoicing asks for it.`)
  }
  return { gaps, warnings }
}

/** "your company’s NTN, and Acme’s STRN" style list for a sentence. */
export function gapSentence(gaps: readonly Gap[]): string {
  const t = gaps.map(g => g.text)
  if (t.length <= 1) return t.join('')
  return `${t.slice(0, -1).join(', ')} and ${t[t.length - 1]}`
}

// ------------------------------------------------------------------ the copy marks

/** Original goes to the buyer (only one tax invoice per supply, s.23(1)); the duplicate is the office copy. */
export type InvoiceCopy = 'original' | 'duplicate'

export const COPY_LABEL: Record<InvoiceCopy, string> = {
  original: 'Original, for the buyer',
  duplicate: 'Duplicate, office copy',
}

/** "INV-0012.pdf", "INV-0012-duplicate.pdf": the number with anything a file name cannot carry replaced. */
export function invoiceFileName(number: string, copy: InvoiceCopy): string {
  const safe = number.trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'invoice'
  return `${safe}${copy === 'duplicate' ? '-duplicate' : ''}.pdf`
}

/** Quantity as printed: 2, 2.5, 12.125. */
export function qtyText(n: number): string {
  return Number.isInteger(n) ? String(n) : String(parseFloat(n.toFixed(3)))
}

/** "18%" or "Exempt". */
export function rateText(ratePercent: number): string {
  return ratePercent > 0 ? `${qtyText(ratePercent)}%` : 'Exempt'
}
