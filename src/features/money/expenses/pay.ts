import { cleanDetail, SUPPLIER_PAYMENT_ID, type ExpenseInsert, type PaidVia } from '@/features/money/expenses/model'
import { BANK_CHARGES_ID } from '@/features/money/expenses/quick'

/*
 * Pay a supplier (redesign phase 1: one door). The only way a supplier payment is recorded: from the supplier order (on the order
 * page, or a row of We owe suppliers). It takes what was paid in the supplier's currency (USD 3,240), the PKR the bank actually
 * debited, and the bank's charges as their own line (a Bank charges expense), so the supplier payment is exactly what reached the
 * supplier and "We owe suppliers" settles in the supplier's currency (0087 payables_as_of).
 */

export interface PayInput {
  /** Client ids: a retry adds nothing twice. */
  paymentId: string
  chargesId: string
  orderId: string
  legId: string
  supplierId: string
  supplierName: string
  /** The supplier's currency; 'PKR' for a local supplier. */
  currency: string
  /** Paid in the supplier's currency; ignored for PKR. */
  fxAmount: number | null
  /** What left the bank for the supplier, PKR (charges not included). */
  pkr: number
  /** The bank's charges for sending it, PKR; 0 or null for none. */
  charges: number | null
  paidOn: string
  paidVia: PaidVia
  inputTax: number | null
  detail: string
}

export type PayProblem = 'fx' | 'pkr' | 'charges' | 'tax'

export function payProblem(p: Pick<PayInput, 'currency' | 'fxAmount' | 'pkr' | 'charges' | 'inputTax'>): PayProblem | null {
  if (p.currency !== 'PKR' && !(p.fxAmount !== null && p.fxAmount > 0)) return 'fx'
  if (!(p.pkr > 0) || !Number.isFinite(p.pkr)) return 'pkr'
  if (p.charges !== null && p.charges < 0) return 'charges'
  if (p.inputTax !== null && (p.inputTax < 0 || p.inputTax > p.pkr)) return 'tax'
  return null
}

export type PayRow = ExpenseInsert & { supplier_order_id: string | null; payee_id: string | null; fx_currency?: string; fx_amount?: number }

/** One or two rows, saved together: the supplier payment, and the bank charges when there are any. */
export function payInserts(p: PayInput): PayRow[] {
  const foreign = p.currency !== 'PKR' && p.fxAmount !== null && p.fxAmount > 0
  const rows: PayRow[] = [
    {
      id: p.paymentId,
      amount_pkr: p.pkr,
      category_id: SUPPLIER_PAYMENT_ID,
      paid_on: p.paidOn,
      paid_via: p.paidVia,
      description: cleanDetail(p.detail),
      input_tax_pkr: p.inputTax && p.inputTax > 0 ? p.inputTax : 0,
      order_id: p.orderId,
      supplier_order_id: p.legId,
      payee_id: p.supplierId,
      ...(foreign ? { fx_currency: p.currency, fx_amount: p.fxAmount as number } : {}),
    },
  ]
  if (p.charges && p.charges > 0)
    rows.push({
      id: p.chargesId,
      amount_pkr: p.charges,
      category_id: BANK_CHARGES_ID,
      paid_on: p.paidOn,
      paid_via: 'bank',
      description: `Bank charges, payment to ${p.supplierName}`.slice(0, 200),
      input_tax_pkr: 0,
      order_id: p.orderId,
      supplier_order_id: null,
      payee_id: null,
    })
  return rows
}

/** PKR per unit of the supplier's currency this payment cost ("283.33"), or null. */
export function effectiveRate(pkr: number | null, fxAmount: number | null): number | null {
  if (!pkr || !fxAmount || pkr <= 0 || fxAmount <= 0) return null
  return Math.round((pkr / fxAmount) * 100) / 100
}

/** What is still owed in the supplier's currency: committed less what was paid in it (never below 0); null when not known. */
export function owedInCurrency(committed: number | null, paidFx: number): number | null {
  if (committed === null) return null
  return Math.max(Math.round((committed - paidFx) * 100) / 100, 0)
}
