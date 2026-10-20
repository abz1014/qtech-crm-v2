import type { InquiryRow, RfqItemRow } from '@/features/rfqs/api'

/** The id of a supplier's price box for an item, so a menu elsewhere on the page ("Edit reply") can take the person straight to it. */
export const replyInputId = (inquiryId: string, itemId: string) => `reply-${inquiryId}-${itemId}`

/** The event that asks the replies panel to open a supplier's reply (its row may be closed) and put the cursor in a price box. */
export const OPEN_REPLY_EVENT = 'qtech:open-reply'
export interface OpenReplyDetail {
  inquiryId: string
  itemId: string
}

/**
 * Scroll to a supplier's price box for an item and put the cursor in it. When the supplier's reply row is closed, the replies panel
 * is asked to open it and focuses the box itself once it is drawn. Returns true when the box was already on the page.
 */
export function focusReplyInput(inquiryId: string, itemId: string): boolean {
  const el = document.getElementById(replyInputId(inquiryId, itemId))
  if (!el) {
    window.dispatchEvent(new CustomEvent<OpenReplyDetail>(OPEN_REPLY_EVENT, { detail: { inquiryId, itemId } }))
    return false
  }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  ;(el as HTMLInputElement).focus({ preventScroll: true })
  return true
}

/** Items this supplier has neither priced nor declined: what a chase asks for. */
export function outstandingItems(inquiry: InquiryRow, items: readonly RfqItemRow[]): RfqItemRow[] {
  return items.filter(it => !inquiry.lines.some(l => l.itemId === it.id) && !inquiry.itemDeclines[it.id])
}

/** Asked, not said no, and still owing a price for at least one item. */
export function canChaseInquiry(inquiry: InquiryRow, items: readonly RfqItemRow[]): boolean {
  return Boolean(inquiry.sentOn) && !inquiry.noOfferOn && outstandingItems(inquiry, items).length > 0
}

/** Sent, nothing back yet, and not said no: the reply that is expected next. Its row starts open. */
export function awaitingReply(inquiry: InquiryRow): boolean {
  return Boolean(inquiry.sentOn) && !inquiry.noOfferOn && inquiry.lines.length === 0
}
