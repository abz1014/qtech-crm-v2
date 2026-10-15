// Cancelling an order (O03). The reason is a fixed key in orders.cancel_reason (migration 0040), never text in the notes: reports read
// it and notes belong to people. The words the screen shows are built here from the key. Pure and framework-free.

export type CancelReason = 'customer_cancelled' | 'lost_to_competitor' | 'supplier_cannot_supply' | 'price_or_terms' | 'duplicate_or_mistake' | 'other'

export const CANCEL_REASONS: ReadonlyArray<{ value: CancelReason; label: string }> = [
  { value: 'customer_cancelled', label: 'The customer cancelled the PO' },
  { value: 'lost_to_competitor', label: 'Lost to a competitor' },
  { value: 'supplier_cannot_supply', label: 'The supplier cannot supply it' },
  { value: 'price_or_terms', label: 'Price or terms could not be agreed' },
  { value: 'duplicate_or_mistake', label: 'Entered twice or by mistake' },
  { value: 'other', label: 'Another reason' },
]

/** The readable phrase for a stored key. Null (no reason given, or an order cancelled before the column existed) reads as no reason. */
export function cancelReasonLabel(reason: string | null | undefined): string | null {
  if (!reason) return null
  return CANCEL_REASONS.find(r => r.value === reason)?.label ?? 'Another reason'
}
