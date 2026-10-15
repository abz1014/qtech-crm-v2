import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { useAskSuppliers } from '@/features/rfqs/useAskSuppliers'
import type { SupplierSuggestion } from '@/features/rfqs/lib/supplierSuggestion'

export function numbersText(nums: readonly number[]): string {
  const n = [...nums].sort((a, b) => a - b)
  if (n.length === 0) return ''
  if (n.length === 1) return `item ${n[0]}`
  if (n.length === 2) return `items ${n[0]} and ${n[1]}`
  return `items ${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

/** The next suppliers in line for these items (at most `limit`), excluding everyone already asked on the RFQ. Pure over the loaded history. */
export function nextInLine(suggestions: readonly SupplierSuggestion[], askedIds: ReadonlySet<string>, limit = 2): SupplierSuggestion[] {
  return suggestions.filter(s => !askedIds.has(s.supplierId)).slice(0, limit)
}

/** "Choose suppliers for items 2 and 3": the same action as Float to another supplier (copies the enquiry for those items, records the asking, Undo). */
export function useChooseSuppliers(rfq: RfqHeader | undefined, inquiries: readonly InquiryRow[]) {
  const asker = useAskSuppliers(rfq as RfqHeader, inquiries)
  return {
    busy: asker.busy,
    choose: async (input: { supplierIds: string[]; names: string[]; items: readonly RfqItemRow[] }): Promise<void> => {
      if (!rfq) return
      await asker.ask(input)
    },
  }
}
