import { fetchAll, requireSupabase, unwrap } from '@/lib/supabase'
import type { PaidVia } from '@/features/money/expenses/model'
import type { PaymentState, PriorPayment, ReceivableRow, ReceivableTotals } from '@/features/money/payments/model'

/*
 * Payments in and receivables (M02): every database call for this area. Receivables come from receivables_list() and
 * receivables_summary() (0074/0076; admin and sales: balances, never a payment row). Payments themselves (payments_in) are admin
 * only, by Row Level Security.
 */
const num = (v: number | string | null | undefined): number => (v === null || v === undefined ? 0 : Number(v))

/** One row of receivables_list() (0074): order_receivables() with the company's name and the order's invoice numbers. */
export interface ReceivablesListRow {
  order_id: string
  order_number: number
  company_id: string
  company_name: string | null
  owner_id: string | null
  invoice_numbers: string[] | null
  gross_target: number
  settled: number
  balance: number
  overpaid_by: number
  due_on: string | null
  is_overdue: boolean
  payment_state: string
  last_reminded_on: string | null
  reminder_count: number
  data_trust?: string | null
}

export interface ReceivablesListArgs {
  p_state?: 'open' | 'unpaid' | 'part' | 'overdue' | 'settled'
  p_company_id?: string
  p_order_id?: string
  /** Only orders with a gross above 0 (what To collect lists). */
  p_with_value?: boolean
}

/**
 * receivables_list(), filtered on the server and read in 1,000-row pages (ordered by order number), so no list is cut at
 * PostgREST's cap and no id list goes into the URL. Admin and sales only (the database refuses an engineer).
 */
export async function fetchReceivablesList(args: ReceivablesListArgs = {}): Promise<ReceivablesListRow[]> {
  const db = requireSupabase()
  return fetchAll<ReceivablesListRow>(
    (from, to) =>
      db.rpc('receivables_list', args).order('order_number').range(from, to) as unknown as PromiseLike<{
        data: ReceivablesListRow[] | null
        error: { code?: string; message: string } | null
      }>,
  )
}

export const toReceivableRow = (r: ReceivablesListRow, imported = false): ReceivableRow => ({
  orderId: r.order_id,
  orderNumber: Number(r.order_number),
  companyId: r.company_id,
  companyName: r.company_name ?? '',
  ownerId: r.owner_id,
  invoiceNumbers: r.invoice_numbers ?? [],
  gross: num(r.gross_target),
  settled: num(r.settled),
  balance: num(r.balance),
  overpaidBy: num(r.overpaid_by),
  dueOn: r.due_on,
  isOverdue: !!r.is_overdue,
  state: (r.payment_state as PaymentState) ?? 'unpaid',
  lastRemindedOn: r.last_reminded_on,
  reminderCount: num(r.reminder_count),
  imported,
})

/**
 * Every order with something to collect or already settled (gross above 0): one paged receivables_list() read, which carries
 * no cost and no payment row. It leaves out a cancelled order with no invoice and keeps one that was invoiced (its balance is
 * real; owner decision 2026-10-19), so this list and Today's "payment overdue" agree.
 */
export async function listReceivables(): Promise<ReceivableRow[]> {
  const [rows, imported] = await Promise.all([fetchReceivablesList({ p_with_value: true }), fetchImportedOrderIds()])
  return rows.map(r => toReceivableRow(r, imported.has(r.order_id)))
}

/** Ids of orders imported from the old CRM (legacy_source set), id only: their invoices are not linked to them yet (owner decision 1b). */
export async function fetchImportedOrderIds(): Promise<Set<string>> {
  const db = requireSupabase()
  const rows = await fetchAll<{ id: string }>(
    (from, to) =>
      db.from('orders').select('id').not('legacy_source', 'is', null).order('id').range(from, to) as unknown as PromiseLike<{
        data: { id: string }[] | null
        error: { code?: string; message: string } | null
      }>,
  )
  return new Set(rows.map(r => r.id))
}

/**
 * The To collect figures (receivableTotals' rules) in one row from receivables_summary() (0076: 7 working days). Null when the
 * function answers no row (a deactivated user): the page then counts from the rows it has.
 */
export async function getReceivablesSummary(today: string): Promise<ReceivableTotals | null> {
  const db = requireSupabase()
  const r = (unwrap(await db.rpc('receivables_summary', { p_today: today })) ?? [])[0]
  if (!r) return null
  return {
    openCount: num(r?.open_count),
    outstanding: num(r?.outstanding),
    overdueCount: num(r?.overdue_count),
    overdue: num(r?.overdue),
    reminderDueCount: num(r?.reminder_due_count),
    notYetDueCount: num(r?.not_yet_due_count),
    notYetDue: num(r?.not_yet_due),
    notInvoicedCount: num(r?.not_invoiced_count),
    notInvoiced: num(r?.not_invoiced),
    importedCount: 0,
    imported: 0,
    gross: num(r?.gross),
    settled: num(r?.settled),
  }
}

/** One advance held on a cancelled, never-invoiced order (held_advances, 0080; admin only): refund it or keep it. */
export interface HeldAdvance {
  orderId: string
  orderNumber: number
  companyName: string
  cancelledOn: string | null
  held: number
}

/**
 * Owner decision 2026-10-22: money paid on an order that was then cancelled before any invoice is never owed and never overdue
 * (order_receivables leaves the order out, D-MR3). The admin sees it apart, as "Advance held — refund or keep".
 */
export async function listHeldAdvances(): Promise<HeldAdvance[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.rpc('held_advances')) ?? []
  return rows.map(r => ({
    orderId: r.order_id,
    orderNumber: num(r.order_number),
    companyName: r.company_name ?? 'Customer',
    cancelledOn: r.cancelled_on ?? null,
    held: num(r.held),
  }))
}

export interface PaymentOrder {
  row: ReceivableRow
  prior: PriorPayment[]
}

/** One order for the record-payment dialog: its balance (receivables_list for the order) and the payments already recorded (admin). */
export async function getPaymentOrder(orderId: string): Promise<PaymentOrder | null> {
  const db = requireSupabase()
  const [rows, payments] = await Promise.all([
    fetchReceivablesList({ p_order_id: orderId }),
    db.from('payments_in').select('received_on, amount').eq('order_id', orderId).is('voided_at', null).order('received_on'),
  ])
  const raw = rows[0]
  if (!raw) return null
  return {
    row: toReceivableRow(raw, (await fetchImportedOrderIds()).has(raw.order_id)),
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
