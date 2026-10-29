import { daysBetween } from '@/features/rfqs/lib/dateText'
import { DEFAULT_GST_DEADLINES, gstDatesFor, type GstDeadlines } from '@/features/settings/gstDeadlines'
import type { GstMonthRow } from '@/features/money/monthEnd/model'
import { paisaToFixed, toPaisa } from '@/lib/money'

/*
 * GST to FBR (P6-B, plan section (f), "Accounts, one level down"). One line a month, in plain words:
 *
 *     GST charged  -  GST paid on purchases  =  to pay
 *
 * GST charged is the GST on the month's invoices (v_gst_month.gst, frozen at a close); GST paid on purchases is the input tax on
 * the month's expenses (0025). The GST is paid to FBR by the pay-by day of the following month (the payment slip number is the PSID)
 * and the return is filed by the file-by day; both are the admin's settings (Settings > Tax deadlines, 15 and 18 to start with, with a
 * one-off date for a month when FBR extends). A month is "paid" when every invoice of it carries its deposit. Nothing is worked out beyond a
 * subtraction of two figures the database already holds, in whole paisa.
 */
/** Amber from this many days before the pay-by date. */
const AMBER_DAYS = 3

/** What a month's invoices carry about the payment to FBR: their PSIDs and the last day a deposit was made. */
export interface GstFiling {
  month: string
  psids: string[]
  lastDepositedOn: string | null
}

export type GstTone = 'paid' | 'ok' | 'soon' | 'late' | 'nothing'

export interface GstLine {
  month: string
  invoiceCount: number
  charged: string
  /** Null when the figure is not for this reader (input tax is admin only). */
  paidOnPurchases: string | null
  /** charged less paid on purchases, never below zero. */
  toPay: string
  /** Paid on purchases is more than charged: what is left over, to carry. */
  credit: string
  payBy: string
  returnBy: string
  /** A one-off date set for this month is in force (FBR moved the deadline). */
  payOverridden: boolean
  returnOverridden: boolean
  tone: GstTone
  deposited: string
  psids: string[]
  paidOn: string | null
}

export function gstLine(row: GstMonthRow, filing: GstFiling | undefined, today: string, deadlines: GstDeadlines = DEFAULT_GST_DEADLINES): GstLine {
  const charged = toPaisa(row.gst)
  const bought = row.inputTax === null ? 0n : toPaisa(row.inputTax)
  const net = charged - bought
  const { payBy, returnBy, payOverridden, returnOverridden } = gstDatesFor(deadlines, row.month)
  const allIn = row.invoiceCount > 0 && row.depositedCount >= row.invoiceCount
  let tone: GstTone
  if (row.invoiceCount === 0 || charged === 0n) tone = 'nothing'
  else if (allIn) tone = 'paid'
  else if (net <= 0n) tone = 'nothing' // input tax covers it: there is nothing to pay, so it is never late
  else if (today > payBy) tone = 'late'
  else if (daysBetween(today, payBy) < AMBER_DAYS) tone = 'soon'
  else tone = 'ok'
  return {
    month: row.month,
    invoiceCount: row.invoiceCount,
    charged: row.gst,
    paidOnPurchases: row.inputTax,
    toPay: paisaToFixed(net > 0n ? net : 0n),
    credit: paisaToFixed(net < 0n ? -net : 0n),
    payBy,
    returnBy,
    payOverridden,
    returnOverridden,
    tone,
    deposited: row.depositedAmount,
    psids: filing?.psids ?? [],
    paidOn: filing?.lastDepositedOn ?? null,
  }
}

/** The months to show, newest first: months with invoices, the six latest, and the one now running even when it is empty. */
export function gstLines(rows: readonly GstMonthRow[], filings: readonly GstFiling[], today: string, limit = 6, deadlines: GstDeadlines = DEFAULT_GST_DEADLINES): GstLine[] {
  const byMonth = new Map(filings.map(f => [f.month, f]))
  return [...rows]
    .filter(r => r.invoiceCount > 0 || r.month === today.slice(0, 7))
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .slice(0, limit)
    .map(r => gstLine(r, byMonth.get(r.month), today, deadlines))
}

/** Groups the invoices that carry a PSID or a deposit into one filing a month. */
export function filingsOf(invoices: readonly { invoice_date: string | null; psid: string | null; tax_deposited_on: string | null }[]): GstFiling[] {
  const by = new Map<string, GstFiling>()
  for (const i of invoices) {
    if (!i.invoice_date) continue
    const month = i.invoice_date.slice(0, 7)
    const f = by.get(month) ?? { month, psids: [], lastDepositedOn: null }
    const psid = i.psid?.trim()
    if (psid && !f.psids.includes(psid)) f.psids.push(psid)
    if (i.tax_deposited_on && (!f.lastDepositedOn || i.tax_deposited_on > f.lastDepositedOn)) f.lastDepositedOn = i.tax_deposited_on
    by.set(month, f)
  }
  return [...by.values()]
}
