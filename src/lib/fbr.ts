// Ported from src/lib/gst/fbr.ts @ 7a29f3a (Q-Tech CRM v1). Rewritten for v2 model: no fbr_status; state derived from psid / wasif_receipt_on / tax_deposited_on / legacy flag.
import { businessToday } from '@/lib/dates'

export type FbrState = 'pending' | 'generated' | 'receipt_received' | 'deposited'

/** Minimal invoice shape the FBR helpers need. */
export interface FbrInvoice {
  invoice_date: string
  psid: string | null
  wasif_receipt_on: string | null
  tax_deposited_on: string | null
  legacy_flags?: string[] | null
}

export const FBR_GENERATED_LEGACY_FLAG = 'fbr_generated_legacy'

function hasGenerated(inv: FbrInvoice): boolean {
  return Boolean(inv.psid) || (inv.legacy_flags ?? []).includes(FBR_GENERATED_LEGACY_FLAG)
}

/** Furthest FBR step reached. */
export function fbrState(inv: FbrInvoice): FbrState {
  if (inv.tax_deposited_on) return 'deposited'
  if (inv.wasif_receipt_on) return 'receipt_received'
  if (hasGenerated(inv)) return 'generated'
  return 'pending'
}

/** True when a later step is recorded without the step before it. */
export function fbrException(inv: FbrInvoice): boolean {
  const generated = hasGenerated(inv)
  const receipt = Boolean(inv.wasif_receipt_on)
  const deposited = Boolean(inv.tax_deposited_on)
  if (deposited && !receipt) return true
  if (receipt && !generated) return true
  return false
}

/**
 * Needs attention: tax not yet deposited and the invoice month (YYYY-MM) is
 * earlier than the current month (Karachi by default).
 */
export function needsFbrAttention(
  inv: Pick<FbrInvoice, 'invoice_date' | 'tax_deposited_on'>,
  today: string = businessToday(),
): boolean {
  if (inv.tax_deposited_on) return false
  const month = (inv.invoice_date || '').slice(0, 7)
  if (!month) return false
  return month < today.slice(0, 7)
}
