import { businessToday } from '@/lib/dates'
import { copyToClipboard } from '@/lib/clipboard'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { useSession } from '@/app/session'
import { useToast } from '@/ui/useToast'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { useAddInquiries, useRemoveInquiries } from '@/features/rfqs/hooks'
import { generateEnquiryDraft } from '@/features/rfqs/lib'

/*
 * Asking more suppliers from the RFQ page (g2-rfq-detail: "Copy enquiry for 2 suppliers", "Copy enquiry text", "Float to another
 * supplier"). One tap copies the enquiry for the chosen items, listing each of them, and records the asking: an inquiry per
 * supplier stamped sent today, so the supplier appears under "Suppliers asked". The toast has an Undo that takes the new
 * inquiries back (they return to shortlisted and are deleted; nothing else is touched). A supplier already asked is left alone.
 * If the clipboard refuses nothing is recorded.
 */
export function useAskSuppliers(rfq: RfqHeader, inquiries: readonly InquiryRow[]) {
  const { toast } = useToast()
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const add = useAddInquiries(rfq.id)
  const remove = useRemoveInquiries(rfq.id)

  const ask = async (input: { supplierIds: readonly string[]; items: readonly RfqItemRow[]; names: readonly string[] }): Promise<boolean> => {
    const fresh = input.supplierIds.filter(id => !inquiries.some(i => i.supplierId === id))
    if (input.items.length === 0 || input.supplierIds.length === 0) return false
    const text = generateEnquiryDraft({
      rfqRef: rfqRef(rfq.number),
      items: input.items.map(it => ({ description: it.description, brandName: it.brandName, qty: it.qty, unit: it.unit })),
      dueOn: rfq.dueOn,
      today: businessToday(),
      signature: { name: user?.name ?? 'Q-Tech Solutions', company: 'Q-Tech Solutions' },
      variant: 'whatsapp',
    }).body
    const copied = await copyToClipboard(text)
    if (!copied) {
      toast({ title: 'Could not copy the enquiry', body: 'The browser refused the clipboard. Nothing was recorded.', tone: 'danger' })
      return false
    }
    try {
      const ids = await add.mutateAsync({ supplierIds: fresh, sentOn: businessToday() })
      const who = input.names.length === 1 ? input.names[0] : `${input.names.length} suppliers`
      toast({
        title: 'Enquiry text copied',
        body: ids.length > 0 ? `${who} added to the suppliers asked` : `${who} already asked`,
        tone: 'success',
        undo:
          ids.length > 0
            ? {
                onUndo: async () => {
                  try {
                    await remove.mutateAsync(ids)
                  } catch (err) {
                    toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
                  }
                },
                settledTitle: 'Enquiry text copied',
                undoneTitle: 'Taken back',
              }
            : undefined,
      })
      return true
    } catch (err) {
      toast({ title: 'Copied, but the suppliers were not recorded', body: mapPgError(err, { entity: 'enquiry' }).message, tone: 'danger' })
      return false
    }
  }

  return { ask, busy: add.isPending || remove.isPending }
}
