// "Can't quote" (Gate 2 decision, 2026-10-14): ONE reason per supplier inquiry, with an optional per-item override.
// Stored as structured records (migration 0032), never as text in the notes:
//   supplier_inquiries.no_offer_on + no_offer_reason   the whole inquiry
//   inquiry_item_declines (inquiry_id, rfq_item_id)    a different reason for one item
// The keys below are what the database holds (and what the outcome reports group by). The words people read are built
// from the key here, in one place.

export const CANT_QUOTE_REASONS = [
  { key: 'no_brand', label: "Doesn't carry this brand" },
  { key: 'cant_source_in_time', label: "Can't source in time" },
  { key: 'discontinued', label: 'Item discontinued' },
  { key: 'wont_quote_quantity', label: "Won't quote this quantity" },
  { key: 'other', label: 'Other reason' },
] as const

export type CantQuoteReason = (typeof CANT_QUOTE_REASONS)[number]['key']

/** The words for a stored key. An unknown key (a newer reason than this build knows) reads as "Other reason". */
export function reasonLabel(key: string | null | undefined): string {
  return CANT_QUOTE_REASONS.find(r => r.key === key)?.label ?? 'Other reason'
}

export function isCantQuoteReason(key: string | null | undefined): key is CantQuoteReason {
  return CANT_QUOTE_REASONS.some(r => r.key === key)
}

/** The reason that applies to an item: its own override, else the whole inquiry's (when the inquiry was marked). */
export function reasonForItem(
  itemId: string,
  inquiry: { noOfferOn: string | null; noOfferReason: string | null; itemDeclines: Readonly<Record<string, string>> },
): string | null {
  return inquiry.itemDeclines[itemId] ?? (inquiry.noOfferOn ? inquiry.noOfferReason : null)
}
