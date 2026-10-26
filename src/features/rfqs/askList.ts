import type { InquiryRow, RfqItemRow } from '@/features/rfqs/api'
import type { SupplierSuggestion } from '@/features/rfqs/lib'

/**
 * The Ask list (review of ux/rfqs, item 3): the suppliers on the shortlist (New RFQ's "Save without asking": an inquiry with no
 * sent date) come first, already ticked, then the suggestions. Asking them stamps their inquiry sent (useAskSuppliers). Undefined
 * while the suggestions load.
 */
export function withShortlist(
  inquiries: readonly InquiryRow[],
  items: readonly RfqItemRow[],
  suggestions: readonly SupplierSuggestion[] | undefined,
): SupplierSuggestion[] | undefined {
  if (suggestions === undefined) return undefined
  const short = inquiries
    .filter(i => !i.sentOn && !i.noOfferOn)
    .map<SupplierSuggestion>(i => ({
      supplierId: i.supplierId,
      name: i.supplierName,
      city: i.supplierCity ?? null,
      group: 'supplied_before',
      groupKey: 'supplied_before',
      groupLabel: 'Shortlist',
      preTicked: true,
      tierLabel: 'same item',
      reason: 'On the shortlist from New RFQ. Not asked yet.',
      memoryLine: '',
      coversItemIds: items.map(it => it.id),
      lastContact: null,
      record: null,
      evidence: null,
      stats: null,
      suppliedBefore: false,
      manualTag: false,
      demoted: false,
      categoryId: null,
      categoryName: null,
    }))
  return [...short, ...suggestions.filter(s => !short.some(x => x.supplierId === s.supplierId))]
}
