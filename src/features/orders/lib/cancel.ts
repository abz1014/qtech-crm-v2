// Cancelling an order (O03). The orders table has no reason column, so the reason is written into the order notes as one
// dated line (the audit log records the change as well). Pure and framework-free.

export type CancelReason = 'customer_cancelled' | 'entered_twice' | 'could_not_supply' | 'other'

export const CANCEL_REASONS: ReadonlyArray<{ value: CancelReason; label: string }> = [
  { value: 'customer_cancelled', label: 'The customer cancelled the PO' },
  { value: 'entered_twice', label: 'Entered twice or by mistake' },
  { value: 'could_not_supply', label: 'We could not supply it' },
  { value: 'other', label: 'Another reason' },
]

export function cancelReasonLabel(reason: CancelReason): string {
  return CANCEL_REASONS.find(r => r.value === reason)?.label ?? 'Another reason'
}

/** "Cancelled 2026-11-27: The customer cancelled the PO (they changed the plant)". */
export function cancelNote(onISO: string, reason: CancelReason, note: string): string {
  const extra = note.trim()
  return `Cancelled ${onISO}: ${cancelReasonLabel(reason)}${extra ? ` (${extra})` : ''}`
}
