import type { InquiryRow, RfqItemRow } from '@/features/rfqs/api'

/** The id of a supplier's price box for an item, so a menu elsewhere on the page ("Edit reply", "Add reply") can take the person straight to it. */
export const replyInputId = (inquiryId: string, itemId: string) => `reply-${inquiryId}-${itemId}`

/** Scroll to a supplier's price box for an item and put the cursor in it. Returns false when it is not on the page. */
export function focusReplyInput(inquiryId: string, itemId: string): boolean {
  const el = document.getElementById(replyInputId(inquiryId, itemId))
  if (!el) return false
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
