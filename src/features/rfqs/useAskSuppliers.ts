import { useRef, useState } from 'react'
import { businessToday } from '@/lib/dates'
import { copyToClipboard } from '@/lib/clipboard'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { useSession } from '@/app/session'
import { useToast } from '@/ui/useToast'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { useAddInquiries, useMarkInquiriesSent, useRemoveInquiries } from '@/features/rfqs/hooks'
import { generateEnquiryDraft } from '@/features/rfqs/lib'

/*
 * Asking more suppliers from the RFQ page (g2-rfq-detail: "Copy enquiry for 2 suppliers", "Copy enquiry text", "Float to another
 * supplier"). One tap copies the enquiry for the chosen items, listing each of them, and records the asking: an inquiry per
 * supplier stamped sent today, so the supplier appears under "Suppliers asked". The toast has an Undo that takes the new
 * inquiries back (they return to shortlisted and are deleted; nothing else is touched). A supplier already asked is left alone.
 * A supplier on the shortlist (New RFQ's "Save without asking": an inquiry with no sent date) has that inquiry stamped sent today
 * (review of ux/rfqs, item 3), and the Undo takes the stamp back. If the clipboard refuses nothing is recorded.
 */
export function useAskSuppliers(rfq: RfqHeader, inquiries: readonly InquiryRow[]) {
  const { toast } = useToast()
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const add = useAddInquiries(rfq.id)
  const remove = useRemoveInquiries(rfq.id)
  const mark = useMarkInquiriesSent(rfq.id)

  // The copy runs before the insert, so nothing is pending yet while it does: a second tap then would ask the same suppliers again.
  const inFlight = useRef(false)
  const [copying, setCopying] = useState(false)
  const ask = async (input: { supplierIds: readonly string[]; items: readonly RfqItemRow[]; names: readonly string[] }): Promise<boolean> => {
    if (inFlight.current) return false
    inFlight.current = true
    setCopying(true)
    try {
      return await askOnce(input)
    } finally {
      inFlight.current = false
      setCopying(false)
    }
  }

  const askOnce = async (input: { supplierIds: readonly string[]; items: readonly RfqItemRow[]; names: readonly string[] }): Promise<boolean> => {
    const fresh = input.supplierIds.filter(id => !inquiries.some(i => i.supplierId === id))
    const shortlisted = inquiries.filter(i => input.supplierIds.includes(i.supplierId) && !i.sentOn && !i.noOfferOn).map(i => i.id)
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
      toast({ title: 'Could not copy the message', body: 'The browser refused the clipboard. Nothing was recorded.', tone: 'danger' })
      return false
    }
    try {
      const today = businessToday()
      const [ids, stamped] = await Promise.all([
        fresh.length > 0 ? add.mutateAsync({ supplierIds: fresh, sentOn: today }) : Promise.resolve<string[]>([]),
        shortlisted.length > 0 ? mark.mutateAsync({ ids: shortlisted, on: today }) : Promise.resolve<string[]>([]),
      ])
      const who = input.names.length === 1 ? input.names[0] : `${input.names.length} suppliers`
      toast({
        title: 'Message copied',
        body: ids.length + stamped.length > 0 ? `${who} added to the suppliers asked` : `${who} already asked`,
        tone: 'success',
        undo:
          ids.length + stamped.length > 0
            ? {
                onUndo: async () => {
                  await Promise.all([ids.length > 0 ? remove.mutateAsync(ids) : null, stamped.length > 0 ? mark.mutateAsync({ ids: stamped, on: today, undo: true }) : null])
                },
                settledTitle: 'Message copied',
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

  return { ask, busy: copying || add.isPending || remove.isPending || mark.isPending }
}
