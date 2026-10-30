import { requireSupabase, unwrap } from '@/lib/supabase'
import type { PaidVia } from '@/features/money/expenses/model'
import { lookupLabels } from '@/features/money/lookupLabels'
import { fetchReceivablesList } from '@/features/money/payments/api'
import { orderRef } from '@/lib/refs'
import { NO_CREDIT, type ApplyTarget, type CreditApplication, type CreditRefund, type CreditSummary } from '@/features/money/credit/model'

/*
 * Customer credit (0126, 0127): every database call for this area. Admin only, enforced by Row Level Security; the hooks pass
 * `enabled`, so nobody else makes these requests. A refund and an applied credit are written by record_refund() and apply_credit(),
 * the one door for each (the tables give the API no INSERT).
 */
export interface CompanyCredit {
  summary: CreditSummary
  refunds: CreditRefund[]
  applications: CreditApplication[]
  /** order id to "ORD-0038", for the history lines. */
  orderRefs: Record<string, string>
}

const num = (v: number | string | null | undefined): number => Number(v ?? 0)

/** The customer's credit balance and the last refunds and applied credit (a page of 25 each is more than a screen shows). */
export async function getCompanyCredit(companyId: string): Promise<CompanyCredit> {
  const db = requireSupabase()
  const [view, refunds, apps] = await Promise.all([
    db.from('v_company_credit').select('*').eq('company_id', companyId).maybeSingle(),
    db.from('customer_refunds').select('*').eq('company_id', companyId).order('refunded_on', { ascending: false }).order('created_at', { ascending: false }).limit(25),
    db.from('credit_applications').select('*').eq('company_id', companyId).order('applied_on', { ascending: false }).order('created_at', { ascending: false }).limit(25),
  ])
  const v = unwrap(view)
  const refundRows = unwrap(refunds) ?? []
  const appRows = unwrap(apps) ?? []
  const orderIds = [...new Set([...refundRows.map(r => r.order_id), ...appRows.map(a => a.to_order_id)].filter((x): x is string => !!x))]
  const labels = await lookupLabels({ orders: orderIds })
  return {
    summary: v
      ? { overpaid: num(v.overpaid), refunded: num(v.refunded), applied: num(v.applied), balance: num(v.balance) }
      : NO_CREDIT,
    refunds: refundRows.map(r => ({
      id: r.id,
      refundedOn: r.refunded_on,
      amount: num(r.amount),
      paidVia: r.paid_via as PaidVia,
      reference: r.reference,
      reason: r.reason,
      orderId: r.order_id,
    })),
    applications: appRows.map(a => ({ id: a.id, appliedOn: a.applied_on, amount: num(a.amount), note: a.note, toOrderId: a.to_order_id })),
    orderRefs: Object.fromEntries(Object.entries(labels.orders).map(([id, o]) => [id, orderRef(Number(o.number))])),
  }
}

/** The customer's orders that still owe money, oldest first: where credit can be put. */
export async function listApplyTargets(companyId: string): Promise<ApplyTarget[]> {
  const rows = await fetchReceivablesList({ p_company_id: companyId })
  return rows
    .filter(r => num(r.balance) > 0)
    .map(r => ({ orderId: r.order_id, orderNumber: Number(r.order_number), balance: num(r.balance) }))
}

/** The customer's orders (any state), for "this refund is for order ..." (optional). */
export async function listCompanyOrders(companyId: string): Promise<{ orderId: string; orderNumber: number }[]> {
  const rows = await fetchReceivablesList({ p_company_id: companyId })
  return rows.map(r => ({ orderId: r.order_id, orderNumber: Number(r.order_number) }))
}

export interface RefundInsert {
  id: string
  companyId: string
  orderId: string | null
  refundedOn: string
  amount: number
  paidVia: PaidVia
  reference: string | null
  reason: string | null
  /** The person saw "Looks like a refund already recorded on ..." and chose to record it anyway (0127). */
  confirmDuplicate?: boolean
}

/** The id comes from the form, so a retry cannot record the same refund twice. */
export async function recordRefund(v: RefundInsert): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('record_refund', {
    p_id: v.id,
    p_company_id: v.companyId,
    p_order_id: v.orderId ?? undefined,
    p_refunded_on: v.refundedOn,
    p_amount: v.amount,
    p_paid_via: v.paidVia,
    p_reference: v.reference ?? undefined,
    p_reason: v.reason ?? undefined,
    p_confirm_duplicate: v.confirmDuplicate ?? false,
  })
  if (error) throw error
}

export interface ApplyInsert {
  id: string
  toOrderId: string
  amount: number
  appliedOn: string
  note: string | null
}

export async function applyCredit(v: ApplyInsert): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('apply_credit', {
    p_id: v.id,
    p_to_order_id: v.toOrderId,
    p_amount: v.amount,
    p_applied_on: v.appliedOn,
    p_note: v.note ?? undefined,
  })
  if (error) throw error
}

/** Take a refund back out (delete it; the month lock refuses a closed month). */
export async function deleteRefund(id: string): Promise<void> {
  const db = requireSupabase()
  const { data, error } = await db.from('customer_refunds').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Not removed. You may not have permission, or the month is closed.')
}

/** Take an applied credit back (delete it; the order owes again and the customer holds the credit again). */
export async function deleteApplication(id: string): Promise<void> {
  const db = requireSupabase()
  const { data, error } = await db.from('credit_applications').delete().eq('id', id).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new Error('Not removed. You may not have permission, or the month is closed.')
}
