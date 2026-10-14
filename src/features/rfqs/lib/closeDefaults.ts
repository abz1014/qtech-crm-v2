// Close or lose (R07): the reason is pre-filled from what the RFQ already knows, so closing is two taps
// (open the dialog, confirm). The values are rfqs.close_reason's CHECK list.

export const CLOSE_REASONS = [
  { value: 'competitor', label: 'The customer chose a competitor' },
  { value: 'price', label: 'Price too high' },
  { value: 'no_reply_to_clarification', label: 'No reply to our questions' },
  { value: 'customer_cancelled', label: 'The customer cancelled' },
  { value: 'could_not_source', label: 'We could not source it' },
  { value: 'we_were_late', label: 'We were too late' },
  { value: 'other', label: 'Another reason' },
] as const

export type CloseReason = (typeof CLOSE_REASONS)[number]['value']

export interface CloseContext {
  sourcingState: string | null
  clarificationState: string | null
  bidState: string | null
  isOverdue: boolean
}

/**
 * First match wins:
 *  nobody can supply it            -> could_not_source
 *  waiting on the customer         -> no_reply_to_clarification
 *  past its due date, never bid    -> we_were_late
 *  a bid went out                  -> price (the commonest loss after a bid; one tap to change)
 *  otherwise                       -> other
 */
export function defaultCloseReason(c: CloseContext): CloseReason {
  if (c.sourcingState === 'no_offer_anywhere') return 'could_not_source'
  if (c.clarificationState === 'waiting_on_customer') return 'no_reply_to_clarification'
  if (c.isOverdue && c.bidState !== 'bid_sent') return 'we_were_late'
  if (c.bidState === 'bid_sent' || c.bidState === 'quotation_expired') return 'price'
  return 'other'
}

export function closeReasonLabel(v: string | null | undefined): string {
  return CLOSE_REASONS.find(r => r.value === v)?.label ?? 'Another reason'
}
