import { monthKey, monthLabel } from '@/features/money/expenses/model'
import { DEFAULT_GST_DEADLINES, gstDatesFor, type GstDeadlines } from '@/features/settings/gstDeadlines'
import { divRoundHalfUp, gstWholeRupeesPaisa, paisaToFixed, productPaisa, toPaisa, type Amount } from '@/lib/money'

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
  /**
   * Each order line's own net and GST in paisa (round(qty x price, 2); GST whole rupees per line, DATA_MODEL 2.13), so a part
   * invoice of whole lines carries exactly those lines' GST (HW-11) and its PDF adds up.
   */
  lines?: readonly LineMoney[]
}

/** One order line's own figures, in whole paisa (plain numbers, so the read can be cached as JSON). */
export interface LineMoney {
  net: number
  gst: number
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
  /** The order's lines (OrderAmounts.lines), when known. */
  lines?: readonly LineMoney[]
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
    lines: a.lines,
  }
}

/** One order line's own net and GST in paisa, as v_order_items_total works them out (0014). */
export function lineMoneyOf(qty: Amount, unitPriceNet: Amount, gstRate: Amount): LineMoney {
  const net = productPaisa(qty, unitPriceNet)
  return { net: Number(net), gst: Number(Number(gstRate) > 0 ? gstWholeRupeesPaisa(net, gstRate) : 0n) }
}

/** More priced lines than this are not searched for a set of whole lines (2^20 sums). */
export const MAX_LINE_SEARCH = 20

/**
 * The GST of the whole lines whose nets add up to `netPaisa` exactly: the sum of those lines' own GST. Null when no set of whole
 * lines adds up to it, when two sets do with different GST (the amount alone cannot say which lines), or the order has more
 * than MAX_LINE_SEARCH priced lines. The PDF (pdf/model.ts matchLines) reads the same lines from the same net.
 */
export function gstOfWholeLines(lines: readonly LineMoney[], netPaisa: bigint): bigint | null {
  const priced = lines
    .map(l => ({ net: BigInt(l.net), gst: BigInt(l.gst) }))
    .filter(l => l.net > 0n)
    .sort((a, b) => (a.net === b.net ? 0 : a.net > b.net ? -1 : 1))
  if (netPaisa <= 0n || priced.length === 0 || priced.length > MAX_LINE_SEARCH) return null
  const rest: bigint[] = new Array<bigint>(priced.length + 1).fill(0n)
  for (let i = priced.length - 1; i >= 0; i--) rest[i] = rest[i + 1] + priced[i].net
  let found: bigint | null = null
  let conflict = false
  const walk = (i: number, sum: bigint, gst: bigint) => {
    if (conflict) return
    if (sum === netPaisa) {
      if (found === null) found = gst
      else if (found !== gst) conflict = true
      return
    }
    if (i >= priced.length || sum > netPaisa || sum + rest[i] < netPaisa) return
    walk(i + 1, sum + priced[i].net, gst + priced[i].gst)
    walk(i + 1, sum, gst)
  }
  walk(0, 0n, 0n)
  return conflict ? null : found
}

/**
 * The GST row when the net amount is typed. A net that is exactly a set of whole order lines takes those lines' own GST
 * (gstOfWholeLines, HW-11), which is what the invoice PDF prints line by line.
 *
 * Otherwise: the order's GST is rounded per LINE (DATA_MODEL 2.13), so a GST worked out again on the invoice total (round(net x 18%)) can differ from the lines by up to Rs 0.50 a line and the order would never read "fully
 * invoiced". So whenever there is GST left on the lines and the rate typed is the order's own (18% on an all-18% order, or an
 * order that mixes 18% and exempt), the GST left is shared out in proportion to the net typed: the full net left carries exactly
 * the GST of the lines, half of it carries half (whole rupees, half away from zero, in exact integer arithmetic). Otherwise
 * (exempt, or 18% picked on an order with nothing left) the GST comes from the net.
 */
export function gstForNet(
  net: number,
  option: GstOption | 'mixed',
  start: Pick<InvoiceStart, 'net' | 'gst'> & { option?: InvoiceStart['option']; lines?: readonly LineMoney[] },
): number {
  const share = option === 'mixed' || (option === '18' && (start.option ?? '18') === '18' && start.net > 0)
  if (!share) return gstOn(net, option as GstOption)
  if (!(net > 0) || !(start.net > 0)) return 0
  const n = toPaisa(net)
  const left = toPaisa(start.net)
  if (n === left) return start.gst
  // HW-11: a net that is exactly a set of whole lines carries those lines' own GST (the 18% line of a mixed order keeps its
  // 1,800, not a share of the order's GST), never more than the GST left.
  const whole = start.lines ? gstOfWholeLines(start.lines, n) : null
  if (whole !== null && whole <= toPaisa(start.gst)) return Number(paisaToFixed(whole))
  const rupees = divRoundHalfUp(toPaisa(start.gst) * n, left * 100n)
  return Number(paisaToFixed(rupees * 100n))
}

/** Rupees allowed over what is left, as in v_order_state's "fully invoiced" (Rs 1 allowance). */
export const OVER_INVOICE_ALLOWANCE = 1

/**
 * HW-13: a new invoice may not carry more net than is left to invoice on the order's lines (Rs 1 allowance). Returns the net
 * that is left when `net` is above it, else null. An order without priced lines has nothing to check against.
 */
export function overInvoiced(net: number, start: Pick<InvoiceStart, 'net'>, itemsNet: number): number | null {
  if (!(itemsNet > 0) || !(net > 0)) return null
  return net > start.net + OVER_INVOICE_ALLOWANCE ? start.net : null
}

/** A mixed-rate part invoice whose net is not a set of whole lines: its GST is a share, and its PDF needs the lines ticked. */
export function gstIsShare(net: number, option: GstOption | 'mixed', start: Pick<InvoiceStart, 'net' | 'lines'>): boolean {
  if (option !== 'mixed' || !(net > 0) || !start.lines) return false
  const n = toPaisa(net)
  if (n === toPaisa(start.net)) return false
  return gstOfWholeLines(start.lines, n) === null
}

/** Due date: the invoice date plus the order's payment terms. Null without terms. */
export function dueOn(invoiceDate: string, terms: number | null): string | null {
  if (terms === null || !/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) return null
  const [y, m, d] = invoiceDate.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + terms))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/**
 * This invoice's own due date (0123, process audit 2): its date plus the terms. A later part invoice is due from ITS date, not from
 * the first invoice's, so it is not overdue the day it is issued. The order follows its oldest unpaid invoice.
 */
export function invoiceDueOn(invoiceDate: string, terms: number | null): string | null {
  return dueOn(invoiceDate, terms)
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

export interface InvoiceNextStep {
  tone: 'late' | 'now' | 'done'
  label: string
  detail?: string
}

/**
 * The register's ONE Next step (round 3: it replaces the two chip columns "Invoice posted" and "GST paid to FBR"): a step
 * recorded out of order first, then GST late for an earlier month, then sending the invoice to the customer (by the TCS
 * courier), then depositing its GST, else Done.
 */
export function invoiceNextStep(r: GstRow): InvoiceNextStep {
  if (r.fbrException) {
    const noPsid = (r.fbrState === 'deposited' || r.fbrState === 'receipt_received') && !r.psid
    return { tone: 'now', label: noPsid ? 'Add the PSID' : 'Add deposit receipt', detail: attentionReason(r) ?? undefined }
  }
  if (r.needsAttention && r.fbrState !== 'deposited') return { tone: 'late', label: 'Deposit GST', detail: attentionReason(r) ?? undefined }
  if (tcsNotSent(r)) return { tone: 'now', label: 'Send to customer' }
  if (r.fbrState !== 'deposited') return { tone: 'now', label: 'Deposit GST' }
  return { tone: 'done', label: 'Done' }
}

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

// ------------------------------------------------------------------ editing and deleting: has the month's GST return gone in?

/** The sentence shown, with a tick, before an invoice of such a month is changed or deleted (owner decision 2026-10-26: warn, never block). */
export const GST_FILED_WARNING = "This month's GST return may already be filed. File a revised return with FBR."

/**
 * The day after which a month's GST return is taken as filed: the return's file-by date, from Settings > Tax deadlines (the 18th of
 * the month that follows to start with, or the month's one-off date when FBR moved it).
 */
export const gstReturnDueDay = (invoiceDate: string, deadlines: GstDeadlines = DEFAULT_GST_DEADLINES): string => gstDatesFor(deadlines, monthKey(invoiceDate)).returnBy

/** An FBR GST payment (tax deposited) or a PSID is recorded on an invoice of that month. */
export function monthHasFbrRecord(rows: readonly Pick<GstRow, 'invoiceDate' | 'psid' | 'taxDepositedOn'>[], invoiceDate: string | null | undefined): boolean {
  if (!invoiceDate) return false
  const m = monthKey(invoiceDate)
  return rows.some(r => !!r.invoiceDate && monthKey(r.invoiceDate) === m && (!!r.psid?.trim() || !!r.taxDepositedOn))
}

/**
 * The GST return of the invoice's month may already be filed: an FBR GST payment or a PSID is recorded for the month, or today is
 * past the file-by date of the following month. A guess that errs towards warning; the person ticks and goes on.
 */
export function gstReturnMayBeFiled(invoiceDate: string | null | undefined, today: string, fbrRecorded: boolean, deadlines: GstDeadlines = DEFAULT_GST_DEADLINES): boolean {
  if (!invoiceDate) return false
  return fbrRecorded || today > gstReturnDueDay(invoiceDate, deadlines)
}
