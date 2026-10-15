import { mapPgError } from '@/lib/pgErrors'
import { useToast } from '@/ui/useToast'
import { useAddInquiries, useRemoveInquiries } from '@/features/rfqs/hooks'
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

/** Shortlist the chosen suppliers on the RFQ with an Undo (they appear under Supplier replies as "not sent yet"). */
export function useChooseSuppliers(rfqId: string, ref: string): { busy: boolean; choose: (supplierIds: string[]) => Promise<void> } {
  const add = useAddInquiries(rfqId)
  const remove = useRemoveInquiries(rfqId)
  const { toast } = useToast()
  return {
    busy: add.isPending,
    choose: async ids => {
      try {
        const created = await add.mutateAsync(ids)
        toast({
          title: created.length > 0 ? `Shortlisted ${created.length} ${created.length === 1 ? 'supplier' : 'suppliers'}` : 'Already on this RFQ',
          body: created.length > 0 ? `${ref} · write the enquiry to send it to them` : ref,
          tone: 'success',
          undo:
            created.length > 0
              ? {
                  onUndo: async () => {
                    try {
                      await remove.mutateAsync(created)
                    } catch (err) {
                      toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
                    }
                  },
                  settledTitle: 'Shortlisted',
                  undoneTitle: 'Undone.',
                }
              : undefined,
        })
      } catch (err) {
        toast({ title: 'Could not shortlist them', body: mapPgError(err).message, tone: 'danger' })
      }
    },
  }
}
