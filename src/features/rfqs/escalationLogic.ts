import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { useAskSuppliers } from '@/features/rfqs/useAskSuppliers'
import type { SupplierSuggestion } from '@/features/rfqs/lib/supplierSuggestion'

export { numbersText } from '@/features/rfqs/lib/askedItems'

/** The next suppliers in line for these items (at most `limit`), excluding everyone already asked on the RFQ. Pure over the loaded history. */
export function nextInLine(suggestions: readonly SupplierSuggestion[], askedIds: ReadonlySet<string>, limit = 2): SupplierSuggestion[] {
  return suggestions.filter(s => !askedIds.has(s.supplierId)).slice(0, limit)
}

/** "Choose suppliers for items 2 and 3": the same action as Float to another supplier (copies the enquiry for those items, records the asking, Undo). */
export function useChooseSuppliers(rfq: RfqHeader | undefined, inquiries: readonly InquiryRow[]) {
  // The hook must run on every render; before the RFQ has loaded it gets an empty stand-in and `choose` does nothing.
  const asker = useAskSuppliers(rfq ?? ({ id: '', number: 0, dueOn: null } as unknown as RfqHeader), inquiries)
  return {
    busy: asker.busy,
    choose: async (input: { supplierIds: string[]; names: string[]; items: readonly RfqItemRow[] }): Promise<void> => {
      if (!rfq) return
      await asker.ask(input)
    },
  }
}
