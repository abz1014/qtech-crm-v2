import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import type { PaidVia } from '@/features/money/expenses/model'
import type { PaymentState, PriorPayment, ReceivableRow } from '@/features/money/payments/model'

/*
 * Payments in and receivables (M02): every database call for this area. Receivables come from order_receivables() (admin and
 * sales: balances, never a payment row). Payments themselves (payments_in) are admin only, by Row Level Security.
 */
const num = (v: number | string | null | undefined): number => (v === null || v === undefined ? 0 : Number(v))

interface ReceivableRaw {
  order_id: string
  order_number: number
  company_id: string
  owner_id: string | null
  gross_target: number
  settled: number
  balance: number
  overpaid_by: number
  due_on: string | null
  is_overdue: boolean
  payment_state: string
  last_reminded_on: string | null
  reminder_count: number
}

async function companyNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map()
  const db = requireSupabase()
  const rows = unwrap(await db.from('companies').select('id, name').in('id', ids)) ?? []
  return new Map(rows.map(c => [c.id, c.name]))
}

async function invoiceNumbersByOrder(orderIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (orderIds.length === 0) return out
  const db = requireSupabase()
  const rows = await fetchAll<{ order_id: string | null; number: string | null; invoice_date: string | null }>((from, to) =>
    db.from('invoices').select('order_id, number, invoice_date').in('order_id', orderIds).order('invoice_date').range(from, to),
  )
  for (const r of rows) {
    if (!r.order_id || !r.number) continue
    out.set(r.order_id, [...(out.get(r.order_id) ?? []), r.number])
  }
  return out
}

const toRow = (r: ReceivableRaw, names: Map<string, string>, invoices: Map<string, string[]>): ReceivableRow => ({
  orderId: r.order_id,
  orderNumber: Number(r.order_number),
  companyId: r.company_id,
  companyName: names.get(r.company_id) ?? '',
  ownerId: r.owner_id,
  invoiceNumbers: invoices.get(r.order_id) ?? [],
  gross: num(r.gross_target),
  settled: num(r.settled),
  balance: num(r.balance),
  overpaidBy: num(r.overpaid_by),
  dueOn: r.due_on,
  isOverdue: !!r.is_overdue,
  state: (r.payment_state as PaymentState) ?? 'unpaid',
  lastRemindedOn: r.last_reminded_on,
  reminderCount: num(r.reminder_count),
})

/** Every order with something to collect or already settled: through order_receivables(), which carries no cost and no payment row. */
export async function listReceivables(): Promise<ReceivableRow[]> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('order_receivables')
  if (error) throw error
  const raw = ((data ?? []) as unknown as ReceivableRaw[]).filter(r => num(r.gross_target) > 0)
  if (raw.length === 0) return []
  const ids = raw.map(r => r.order_id)
  // order_receivables() already leaves out a cancelled order with no invoice and keeps one that was invoiced (its balance is real;
  // owner decision 2026-10-19), so this list and Today's "payment overdue" agree.
  const [names, invoices] = await Promise.all([companyNames([...new Set(raw.map(r => r.company_id))]), invoiceNumbersByOrder(ids)])
  return raw.map(r => toRow(r, names, invoices))
}

export interface PaymentOrder {
  row: ReceivableRow
  prior: PriorPayment[]
}

/** One order for the record-payment dialog: its balance (from order_receivables) and the payments already recorded (admin). */
export async function getPaymentOrder(orderId: string): Promise<PaymentOrder | null> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('order_receivables', { p_order_id: orderId })
  if (error) throw error
  const raw = ((data ?? []) as unknown as ReceivableRaw[])[0]
  if (!raw) return null
  const [names, invoices, payments] = await Promise.all([
    companyNames([raw.company_id]),
    invoiceNumbersByOrder([orderId]),
    db.from('payments_in').select('received_on, amount').eq('order_id', orderId).order('received_on'),
  ])
  return {
    row: toRow(raw, names, invoices),
    prior: (unwrap(payments) ?? []).map(p => ({ receivedOn: p.received_on, amount: Number(p.amount) })),
  }
}

export interface PaymentInsert {
  id: string
  orderId: string
  receivedOn: string
  amount: number
  reference: string | null
  paidVia: PaidVia
}

/** The id comes from the form, so a retry cannot record the same payment twice. credited_user_id is filled from the order's owner by the database. */
export async function recordPayment(v: PaymentInsert): Promise<void> {
  const db = requireSupabase()
  const { error } = await db
    .from('payments_in')
    .insert({ id: v.id, order_id: v.orderId, received_on: v.receivedOn, amount: v.amount, reference: v.reference, paid_via: v.paidVia })
  if (error) throw error
}
