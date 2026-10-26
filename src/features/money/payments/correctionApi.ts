import { PAID_VIA_LABEL, type PaidVia } from '@/features/money/expenses/model'
import { formatShortDate } from '@/lib/formatDay'
import { formatAmount, toPaisa } from '@/lib/money'
import { PlainError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { requireSupabase, unwrap } from '@/lib/supabase'

/*
 * Payment corrections (migration 0073): void, correct and Undo a recorded payment. Admin only (the RPCs check the role and
 * row security keeps payments_in to admins). Nothing is overwritten: a void marks the row (voided_at, voided_by, void_reason)
 * and every money figure leaves it out; a correction is a void plus a new row on the same order that points at the old one
 * (corrects_payment_id). Undo (restore_payment) is for the admin who voided, within UNDO_WINDOW_MINUTES; undoing a
 * correction also voids the correction, so the money counts once.
 *
 * The database refuses with a plain sentence and a HINT naming the case (closed month, bank tick, already voided ...). Those
 * come back from here as a PlainError whose `code` is the hint, so `mapPgError(e).message` shows the sentence as it is and a
 * screen can branch on `mapPgError(e).code` (for example to offer "Open Month-end" on 'month_closed').
 */

/** How long after a void its Undo still works (restore_payment). The toast's own Undo is 10 seconds; this is the server's limit. */
export const UNDO_WINDOW_MINUTES = 10

/** The HINT of every refusal the three RPCs (and the guard trigger) raise. */
export const CORRECTION_REFUSALS = [
  'reason_required',
  'not_found',
  'already_voided',
  'month_closed',
  'bank_ticked',
  'unchanged',
  'amount',
  'date',
  'paid_via',
  'not_voided',
  'undo_other_user',
  'undo_expired',
  'changed_since',
  'voided',
] as const
export type CorrectionRefusal = (typeof CORRECTION_REFUSALS)[number]

const REFUSALS: ReadonlySet<string> = new Set(CORRECTION_REFUSALS)

interface PgLike {
  code?: string
  message?: string
  hint?: string | null
}

/** A refusal of ours becomes a PlainError (message as written, code = the hint); anything else is returned unchanged for mapPgError. */
export function toCorrectionError(err: unknown): unknown {
  if (typeof err === 'object' && err !== null) {
    const e = err as PgLike
    if (typeof e.hint === 'string' && REFUSALS.has(e.hint) && typeof e.message === 'string' && e.message.trim()) {
      return new PlainError(e.message.trim(), e.hint)
    }
  }
  return err
}

/** One payment of an order, voided ones included, as the payment rows of the order page show them. */
export interface PaymentLine {
  id: string
  orderId: string
  receivedOn: string
  amount: number
  paidVia: PaidVia
  reference: string | null
  /** The statement month it is ticked against ("2026-10-01"), or null. A ticked payment must be unticked before a change. */
  bankMonth: string | null
  createdAt: string
  createdBy: string | null
  creditedUserId: string | null
  /** Imported from the old CRM. */
  legacy: boolean
  /** counts: in every figure. voided: voided on its own. corrected: voided by a correction (correctedById is the new row). */
  status: 'counts' | 'voided' | 'corrected'
  voidedAt: string | null
  voidedBy: string | null
  voidReason: string | null
  /** On a correction: the payment it replaced. */
  correctsPaymentId: string | null
  /** On a corrected payment: the correction made when it was voided. */
  correctedById: string | null
}

interface PaymentRaw {
  id: string
  order_id: string
  received_on: string
  amount: number | string
  paid_via: string
  reference: string | null
  bank_month: string | null
  created_at: string
  created_by: string | null
  credited_user_id: string | null
  legacy_source: unknown
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
  corrects_payment_id: string | null
}

const PAYMENT_COLUMNS =
  'id, order_id, received_on, amount, paid_via, reference, bank_month, created_at, created_by, credited_user_id, legacy_source, voided_at, voided_by, void_reason, corrects_payment_id'

/** A timestamptz as PostgREST writes it ("2026-10-20T10:15:00.123456+00:00") to milliseconds; the microseconds are cut. */
export function timestampMs(ts: string): number {
  return Date.parse(ts.replace(/(\.\d{3})\d+/, '$1'))
}

/** Shapes the rows and links each correction to the payment it replaced (the correction's created_at is that payment's voided_at). */
export function toPaymentLines(rows: readonly PaymentRaw[]): PaymentLine[] {
  const madeAt = new Map<string, string>()
  for (const r of rows) if (r.corrects_payment_id) madeAt.set(`${r.corrects_payment_id}|${r.created_at}`, r.id)
  return rows.map(r => {
    const correctedById = r.voided_at ? (madeAt.get(`${r.id}|${r.voided_at}`) ?? null) : null
    return {
      id: r.id,
      orderId: r.order_id,
      receivedOn: r.received_on,
      amount: Number(r.amount),
      paidVia: r.paid_via === 'cash' ? 'cash' : 'bank',
      reference: r.reference,
      bankMonth: r.bank_month,
      createdAt: r.created_at,
      createdBy: r.created_by,
      creditedUserId: r.credited_user_id,
      legacy: r.legacy_source !== null && r.legacy_source !== undefined,
      status: r.voided_at === null ? 'counts' : correctedById ? 'corrected' : 'voided',
      voidedAt: r.voided_at,
      voidedBy: r.voided_by,
      voidReason: r.void_reason,
      correctsPaymentId: r.corrects_payment_id,
      correctedById,
    }
  })
}

/** Every payment of one order, oldest first, voided ones included (admin; row security returns nothing to anyone else). */
export async function listOrderPayments(orderId: string): Promise<PaymentLine[]> {
  const db = requireSupabase()
  const rows = unwrap(
    await db.from('payments_in').select(PAYMENT_COLUMNS).eq('order_id', orderId).order('received_on').order('created_at'),
  ) as unknown as PaymentRaw[] | null
  return toPaymentLines(rows ?? [])
}

/** The payments that count (what the balance is made of). */
export const countingPayments = (lines: readonly PaymentLine[]): PaymentLine[] => lines.filter(l => l.status === 'counts')

/** Why Void / Correct is not offered on a line, or null when it is (a closed month is only known to the server: it answers month_closed). */
export function changeBlockedBy(line: PaymentLine): 'voided' | 'bank_ticked' | null {
  if (line.status !== 'counts') return 'voided'
  if (line.bankMonth !== null) return 'bank_ticked'
  return null
}

export type DeleteBlock = 'voided' | 'correction_chain' | 'bank_ticked'

/**
 * Why a payment cannot be deleted (delete_payment, 0092), in the order the database checks: voided, part of a correction (it
 * corrects another, or another corrects it: `inChain`), ticked against a bank statement. Null when it can be tried (a closed
 * month is only known to the server: it answers month_closed).
 */
export function deleteBlockedBy(line: Pick<PaymentLine, 'status' | 'correctsPaymentId' | 'bankMonth'>, inChain: boolean): DeleteBlock | null {
  if (line.status !== 'counts') return 'voided'
  if (line.correctsPaymentId !== null || inChain) return 'correction_chain'
  if (line.bankMonth !== null) return 'bank_ticked'
  return null
}

/** True while `userId` may still undo the void of this line (the same rule restore_payment applies). */
export function canUndo(line: PaymentLine, userId: string | null | undefined, nowMs: number = Date.now()): boolean {
  if (line.status === 'counts' || !line.voidedAt || !userId || line.voidedBy !== userId) return false
  return nowMs - timestampMs(line.voidedAt) < UNDO_WINDOW_MINUTES * 60_000
}

export interface VoidInput {
  paymentId: string
  reason: string
}

/** Voids one payment. Refusals (no reason, closed month, ticked, already voided) come back as PlainError. */
export async function voidPayment(v: VoidInput): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('void_payment', { p_payment_id: v.paymentId, p_reason: v.reason })
  if (error) throw toCorrectionError(error)
}

/** The figures of a payment a correction may change. */
export interface PaymentFigures {
  amount: number
  receivedOn: string
  paidVia: PaidVia
  reference: string | null
}

export interface CorrectionInput extends PaymentFigures {
  paymentId: string
  /** Made when the dialog opens and kept for retries: a retry returns the same new payment instead of a second one. */
  newId: string
  reason: string
}

/** Voids the payment and records the corrected one; returns the new payment's id. */
export async function correctPayment(v: CorrectionInput): Promise<string> {
  const db = requireSupabase()
  const { data, error } = await db.rpc('correct_payment', {
    p_payment_id: v.paymentId,
    p_amount: v.amount,
    p_received_on: v.receivedOn,
    p_paid_via: v.paidVia,
    p_reference: v.reference?.trim() ?? '',
    p_reason: v.reason,
    p_new_id: v.newId,
  })
  if (error) throw toCorrectionError(error)
  return typeof data === 'string' && data ? data : v.newId
}

/** delete_payment (admin only, permanent). The refusals carry a HINT (voided, correction_chain, bank_ticked, month lock) for the caller to branch on. */
export async function deletePayment(paymentId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('delete_payment', { p_payment_id: paymentId })
  if (error) throw error
}

/** Undo of a void or a correction: pass the payment that was voided (for a correction, the original). */
export async function restorePayment(paymentId: string): Promise<void> {
  const db = requireSupabase()
  const { error } = await db.rpc('restore_payment', { p_payment_id: paymentId })
  if (error) throw toCorrectionError(error)
}

export interface FigureChange {
  field: 'amount' | 'receivedOn' | 'paidVia' | 'reference'
  /** "PKR 5,900 → 5,000", "10 Feb → 11 Feb", "Bank → Cash", "Ref TT-1 → CHQ-9". */
  text: string
}

const refText = (r: string | null) => (r && r.trim() ? r.trim() : 'none')

/** What a correction changes, in the order the dialog lists the fields. Empty: nothing to correct (the server refuses it too). */
export function correctionChanges(before: PaymentFigures, after: PaymentFigures, today?: string): FigureChange[] {
  const out: FigureChange[] = []
  if (toPaisa(before.amount) !== toPaisa(after.amount)) {
    out.push({ field: 'amount', text: `PKR ${formatAmount(before.amount)} → ${formatAmount(after.amount)}` })
  }
  if (before.receivedOn !== after.receivedOn) {
    out.push({ field: 'receivedOn', text: `${formatShortDate(before.receivedOn, today)} → ${formatShortDate(after.receivedOn, today)}` })
  }
  if (before.paidVia !== after.paidVia) {
    out.push({ field: 'paidVia', text: `${PAID_VIA_LABEL[before.paidVia]} → ${PAID_VIA_LABEL[after.paidVia]}` })
  }
  if (refText(before.reference) !== refText(after.reference)) {
    out.push({ field: 'reference', text: `Ref ${refText(before.reference)} → ${refText(after.reference)}` })
  }
  return out
}

export interface ToastText {
  title: string
  body: string
  undoneBody: string
}

/** The Undo toast after a void: "Voided payment" / "ORD-0038 · PKR 5,900 · 20 Feb". */
export function voidToastText(line: Pick<PaymentLine, 'amount' | 'receivedOn'>, orderNumber: number, today?: string): ToastText {
  return {
    title: 'Voided payment',
    body: `${orderRef(orderNumber)} · PKR ${formatAmount(line.amount)} · ${formatShortDate(line.receivedOn, today)}`,
    undoneBody: 'The payment counts again.',
  }
}

/** The Undo toast after a correction: "Corrected payment" / "ORD-0038 · PKR 5,900 → 5,000 · 10 Feb → 11 Feb". */
export function correctionToastText(before: PaymentFigures, after: PaymentFigures, orderNumber: number, today?: string): ToastText {
  const changes = correctionChanges(before, after, today).map(c => c.text)
  return {
    title: 'Corrected payment',
    body: [orderRef(orderNumber), ...changes].join(' · '),
    undoneBody: 'The original payment counts again.',
  }
}
