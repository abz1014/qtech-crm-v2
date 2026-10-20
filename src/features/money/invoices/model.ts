import { monthLabel } from '@/features/money/expenses/model'
import { divRoundHalfUp, paisaToFixed, toPaisa } from '@/lib/money'

/*
 * Invoices and the GST register (M01): the pure rules. No React and no database in here, so each rule can be unit-tested.
 * Every invoice goes to FBR; there is one register (DATA_MODEL 2.16). GST is 18% or exempt, never another rate (owner rule).
 */

// ------------------------------------------------------------------ GST: 18% or exempt

export type GstOption = '18' | 'exempt'
export const GST_RATE_PERCENT = 18

/** GST on a net amount. Whole rupees, as on the order lines (DATA_MODEL 2.13). Exempt is zero. */
export function gstOn(net: number, option: GstOption): number {
  if (option === 'exempt' || !(net > 0)) return 0
  return Math.round((net * GST_RATE_PERCENT) / 100)
}

export const round2 = (n: number): number => Math.round(n * 100) / 100

export const GST_OPTION_LABEL: Record<GstOption, string> = { '18': '18%', exempt: 'Exempt' }

/** The label of the GST row: "GST, 18%" or "GST, exempt", or "GST, from the lines" when the order mixes both. */
export function gstRowLabel(option: GstOption | 'mixed'): string {
  return option === 'mixed' ? 'GST, from the lines' : option === 'exempt' ? 'GST, exempt' : `GST, ${GST_RATE_PERCENT}%`
}

export interface OrderAmounts {
  /** All of the order's lines, from v_order_items_total. */
  itemsNet: number
  itemsGst: number
  lineCount: number
  exemptLineCount: number
  /** What earlier invoices on the order already carry. */
  invoicedNet: number
  invoicedGst: number
  paymentTermsDays: number | null
  /** The date of the order's earliest dated invoice, if any: the whole order falls due from it (DATA_MODEL section 5). */
  earliestInvoiceDate?: string | null
}

export interface InvoiceStart {
  net: number
  gst: number
  gross: number
  /** The GST row of the dialog. */
  option: GstOption | 'mixed'
  /** Nothing is left to invoice from the lines. */
  fullyInvoiced: boolean
  /** The whole order (no earlier invoice) as opposed to what is left. */
  wholeOrder: boolean
}

/** The amounts a new invoice opens with: what is left of the order's lines after earlier invoices (net and GST pre-filled). */
export function invoiceStart(a: OrderAmounts): InvoiceStart {
  const net = Math.max(round2(a.itemsNet - a.invoicedNet), 0)
  const gst = Math.max(round2(a.itemsGst - a.invoicedGst), 0)
  const allExempt = a.lineCount > 0 && a.exemptLineCount === a.lineCount
  const noneExempt = a.exemptLineCount === 0
  const option: GstOption | 'mixed' = allExempt ? 'exempt' : noneExempt ? '18' : 'mixed'
  return {
    net,
    gst,
    gross: round2(net + gst),
    option,
    fullyInvoiced: net <= 0 && a.itemsNet > 0,
    wholeOrder: a.invoicedNet <= 0 && a.invoicedGst <= 0,
  }
}

/**
 * The GST row when the net amount is typed. The order's GST is rounded per LINE (DATA_MODEL 2.13), so a GST worked out again on
 * the invoice total (round(net x 18%)) can differ from the lines by up to Rs 0.50 a line and the order would never read "fully
 * invoiced". So whenever there is GST left on the lines and the rate typed is the order's own (18% on an all-18% order, or an
 * order that mixes 18% and exempt), the GST left is shared out in proportion to the net typed: the full net left carries exactly
 * the GST of the lines, half of it carries half (whole rupees, half away from zero, in exact integer arithmetic). Otherwise
 * (exempt, or 18% picked on an order with nothing left) the GST comes from the net.
 */
export function gstForNet(net: number, option: GstOption | 'mixed', start: Pick<InvoiceStart, 'net' | 'gst'> & { option?: InvoiceStart['option'] }): number {
  const share = option === 'mixed' || (option === '18' && (start.option ?? '18') === '18' && start.net > 0)
  if (!share) return gstOn(net, option as GstOption)
  if (!(net > 0) || !(start.net > 0)) return 0
  const n = toPaisa(net)
  const left = toPaisa(start.net)
  if (n === left) return start.gst
  const rupees = divRoundHalfUp(toPaisa(start.gst) * n, left * 100n)
  return Number(paisaToFixed(rupees * 100n))
}

/** Due date: the invoice date plus the order's payment terms. Null without terms. */
export function dueOn(invoiceDate: string, terms: number | null): string | null {
  if (terms === null || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return null
  const [y, m, d] = invoiceDate.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + terms))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/**
 * The order's due date once this invoice exists: the EARLIEST invoice date plus the terms, the date order_receivables, Today and
 * the Receivables page use (DATA_MODEL section 5). A second or part invoice does not move it later.
 */
export function orderDueOn(invoiceDate: string, earliestInvoiceDate: string | null | undefined, terms: number | null): string | null {
  const first = earliestInvoiceDate && earliestInvoiceDate < invoiceDate ? earliestInvoiceDate : invoiceDate
  return dueOn(first, terms)
}

// ------------------------------------------------------------------ the register

export interface GstRow {
  invoiceId: string
  number: string | null
  invoiceDate: string | null
  orderId: string | null
  orderNumber: number | null
  companyId: string | null
  companyName: string | null
  net: number
  gst: number
  gross: number
  courierState: string
  fbrState: string
  fbrException: boolean
  needsAttention: boolean
  psid: string | null
  taxDepositedOn: string | null
}

const MONTH_ONLY = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** "2026-10-16" to "October". */
export const monthName = (isoDate: string): string => MONTH_ONLY[Number(isoDate.slice(5, 7)) - 1] ?? ''

export const rowMonth = (r: Pick<GstRow, 'invoiceDate'>): string => (r.invoiceDate ? monthLabel(r.invoiceDate) : 'No date')

/**
 * Why a row is flagged, in the words the register shows under the customer: a step recorded without the one before it, or
 * tax not deposited for an earlier month. Null when nothing needs attention.
 */
export function attentionReason(r: Pick<GstRow, 'fbrException' | 'needsAttention' | 'fbrState' | 'psid' | 'invoiceDate'>): string | null {
  if (r.fbrException) {
    if (r.fbrState === 'deposited' && !r.psid) return 'Deposit recorded without a PSID'
    if (r.fbrState === 'receipt_received' && !r.psid) return 'Receipt recorded without a PSID'
    return 'Deposit recorded without a receipt'
  }
  if (r.needsAttention && r.invoiceDate) return `${monthName(r.invoiceDate)} invoice, tax not deposited`
  return null
}

export const needsAttention = (r: GstRow): boolean => attentionReason(r) !== null

/** No courier date yet (not started, or only the optional "copy received"): the register's "Not sent by TCS" filter. */
export const tcsNotSent = (r: Pick<GstRow, 'courierState'>): boolean => r.courierState === 'not_started' || r.courierState === 'copy_received'

/** Search the register by invoice number, customer or order number. */
export function matchesSearch(r: GstRow, text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = `${r.number ?? ''} ${r.companyName ?? ''} ORD-${String(r.orderNumber ?? '').padStart(4, '0')}`.toLowerCase()
  return words.every(w => hay.includes(w))
}

export function registerTotals(rows: readonly GstRow[]): { count: number; net: number; gst: number; gross: number } {
  return {
    count: rows.length,
    net: round2(rows.reduce((s, r) => s + r.net, 0)),
    gst: round2(rows.reduce((s, r) => s + r.gst, 0)),
    gross: round2(rows.reduce((s, r) => s + r.gross, 0)),
  }
}

/** "Sep to Nov 2026" over the months present. */
export function rangeLabel(rows: readonly GstRow[]): string {
  const dates = rows.map(r => r.invoiceDate).filter((d): d is string => !!d).sort()
  if (dates.length === 0) return ''
  const a = dates[0]
  const b = dates[dates.length - 1]
  const short = (d: string) => monthName(d).slice(0, 3)
  if (a.slice(0, 7) === b.slice(0, 7)) return `${monthName(b)} ${b.slice(0, 4)}`
  return a.slice(0, 4) === b.slice(0, 4) ? `${short(a)} to ${short(b)} ${b.slice(0, 4)}` : `${short(a)} ${a.slice(0, 4)} to ${short(b)} ${b.slice(0, 4)}`
}

// ------------------------------------------------------------------ month stamping

export type StampKind = 'tcs' | 'psid' | 'deposit'

/** Which of the ticked invoices a stamp would change (a date stamp never overwrites a date already there). */
export function stampable(rows: readonly GstRow[], kind: StampKind): GstRow[] {
  switch (kind) {
    case 'tcs':
      return rows.filter(r => r.courierState === 'not_started' || r.courierState === 'copy_received')
    case 'deposit':
      return rows.filter(r => r.fbrState !== 'deposited')
    case 'psid':
      return rows.slice()
  }
}

/** A PSID is pasted as it comes; surrounding space and line breaks are not part of it. */
export function cleanPsid(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

// ------------------------------------------------------------------ invoice number

export const invoiceNumberOk = (n: string): boolean => n.trim().length > 0 && n.trim().length <= 40
