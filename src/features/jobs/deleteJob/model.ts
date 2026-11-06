import { formatShortDate } from '@/lib/formatDay'

/*
 * Delete a job (migration 0132): what stops it, turned into a guide the owner can follow.
 *
 * job_delete_blockers() returns one row per thing that stops the delete, already in the order to clear them (step 1 to 7). A row is
 * either something the person can clear from a screen (can_clear) or something the books keep (a numbered invoice, a voided payment):
 * those never go, so the way out is to cancel the job instead. Pure and role-free: the page decides who sees the menu item.
 */
export type BlockerKind = 'credit_applied' | 'refund' | 'payment' | 'invoice' | 'expense' | 'purchase_order' | 'other_order_lines'

export interface Blocker {
  step: number
  kind: BlockerKind
  /** The order it sits on; null for a cost or claim on the enquiry itself (an expense step with no order yet). */
  orderId: string | null
  orderNumber: number | null
  refId: string | null
  /** "Rs 10,000.00 payment", "Invoice INV-0042": what it is, in words. */
  label: string
  on: string | null
  canClear: boolean
  /** One plain sentence: what to do about it. */
  why: string
}

export interface BlockerRow {
  step: number
  kind: string
  order_id: string | null
  order_number: number | null
  ref_id: string | null
  ref_label: string
  ref_on: string | null
  can_clear: boolean
  why: string
}

const KINDS: readonly BlockerKind[] = ['credit_applied', 'refund', 'payment', 'invoice', 'expense', 'purchase_order', 'other_order_lines']
const isKind = (k: string): k is BlockerKind => (KINDS as readonly string[]).includes(k)

/**
 * The database's sentence for a kept record ends with "Cancel the job instead.", which the guide's button and intro already say.
 * Cut here rather than migrate 0132: the wording is the screen's, the data is the database's.
 */
const plainWhy = (why: string) => why.replace(/\s*Cancel the job instead\.\s*$/, '').trim()

export function toBlockers(rows: readonly BlockerRow[]): Blocker[] {
  return rows
    .filter(r => isKind(r.kind))
    .map(r => ({
      step: r.step,
      kind: r.kind as BlockerKind,
      orderId: r.order_id,
      orderNumber: r.order_number,
      refId: r.ref_id,
      label: r.ref_label,
      on: r.ref_on,
      canClear: r.can_clear,
      why: plainWhy(r.why),
    }))
    .sort((a, b) => a.step - b.step)
}

/** The short name of a step: what the person is about to do. */
export const STEP_TITLE: Record<BlockerKind, string> = {
  credit_applied: 'Take back the applied credit',
  refund: 'Remove the refund',
  payment: 'Delete the payment',
  invoice: 'Delete the invoice',
  expense: 'Remove the expense',
  purchase_order: 'Delete the purchase order',
  other_order_lines: 'Move the lines off',
}

/** Title of a record the books keep. */
export const KEEP_TITLE: Record<BlockerKind, string> = {
  credit_applied: 'Applied credit',
  refund: 'Refund',
  payment: 'Payment',
  invoice: 'Invoice',
  expense: 'Expense',
  purchase_order: 'Purchase order',
  other_order_lines: 'Order lines',
}

export interface Guide {
  /** Steps to do first, in order. */
  todo: Blocker[]
  /** Records the books keep: these never go, so the job can only be cancelled. */
  keep: Blocker[]
  /** True when nothing stops the delete. */
  clear: boolean
  /** True when the delete can never happen (something is kept): the way out is Cancel the job. */
  mustCancel: boolean
}

export function guideOf(blockers: readonly Blocker[]): Guide {
  const todo = blockers.filter(b => b.canClear)
  const keep = blockers.filter(b => !b.canClear)
  return { todo, keep, clear: blockers.length === 0, mustCancel: keep.length > 0 }
}

/** The opening sentence of the guide (the way out, Mark the job cancelled, is the button below it). */
export function guideIntro(g: Guide): string {
  if (g.clear) return ''
  if (g.mustCancel) return 'Some records of this job stay for the books, so it cannot be deleted.'
  return 'This job cannot be deleted yet. Do these steps in order, then press Check again.'
}

export interface JobRef {
  key: string
  orderId: string | null
  companyId: string
}

export interface BlockerLink {
  to: string
  label: string
}

const STAGE_OF: Partial<Record<BlockerKind, string>> = { payment: 'payment', invoice: 'invoice', purchase_order: 'supplier-order' }

/**
 * Where to clear it. The credit and the refunds are on the customer's page; the rest are on the job's own stage when the row is on
 * the job's live order (?stage= opens that stage), else on the page of the order it sits on. Null when the record is kept.
 */
export function blockerLink(b: Blocker, job: JobRef): BlockerLink | null {
  if (!b.canClear) return null
  if (b.kind === 'credit_applied' || b.kind === 'refund') return { to: `/companies/${job.companyId}`, label: 'Open the customer' }
  const stage = STAGE_OF[b.kind]
  if (stage && b.orderId && b.orderId === job.orderId) return { to: `/jobs/${encodeURIComponent(job.key)}?stage=${stage}`, label: 'Open this stage' }
  if (b.orderId) return { to: `/orders/${b.orderId}`, label: 'Open the order' }
  // a cost or claim on the enquiry itself (0136) has no order: the Expenses page is where it is removed or decided
  if (b.kind === 'expense') return { to: '/money/expenses', label: 'Open Expenses' }
  return null
}

/** "Rs 10,000.00 payment · 5 Nov 2026". */
export function blockerLine(b: Blocker, today?: string): string {
  return b.on ? `${b.label} · ${formatShortDate(b.on, today, true)}` : b.label
}

/** The stop a ?stage= value opens on the job page (index in STOPS), or null for anything unknown. */
export function stageIndexOf(slug: string | null, stops: readonly string[]): number | null {
  if (!slug) return null
  const i = stops.findIndex(s => s.toLowerCase().replace(/ /g, '-') === slug)
  return i < 0 ? null : i
}
