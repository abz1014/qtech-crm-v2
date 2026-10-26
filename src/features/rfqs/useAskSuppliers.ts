import { useEffect, useRef, useState } from 'react'
import { businessToday } from '@/lib/dates'
import { copyToClipboard } from '@/lib/clipboard'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { useSession } from '@/app/session'
import { useToast } from '@/ui/useToast'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { useAddInquiries, useMarkInquiriesSent, useRemoveInquiries } from '@/features/rfqs/hooks'
import { generateEnquiryDraft } from '@/features/rfqs/lib/enquiryDraft'

/*
 * Asking more suppliers from the RFQ page (g2-rfq-detail: "Copy enquiry for 2 suppliers", "Copy enquiry text", "Float to another
 * supplier"). One tap copies the enquiry for the chosen items, listing each of them, and records the asking: an inquiry per
 * supplier stamped sent today, so the supplier appears under "Suppliers asked". The toast has an Undo that takes the new
 * inquiries back (they return to shortlisted and are deleted; nothing else is touched). A supplier already asked is left alone.
 * A supplier on the shortlist (New RFQ's "Save without asking": an inquiry with no sent date) has that inquiry stamped sent today
 * (review of ux/rfqs, item 3), and the Undo takes the stamp back. If the clipboard refuses nothing is recorded.
 */
/** What one ask produced: the enquiry (the same text for every supplier) and who it is for. */
export interface AskResult {
  ok: boolean
  text: string
  supplierIds: string[]
}

// The RFQ page shows "Send it to each supplier" after any ask on it, including the ones started inside the chase card
// (FloatElsewhere) or Today: each ask announces itself here, by RFQ.
type AskListener = (rfqId: string, result: AskResult) => void
const askListeners = new Set<AskListener>()

/** The last successful ask on this RFQ (null until one happens, and after `clear`). */
export function useLastAsk(rfqId: string): [AskResult | null, () => void] {
  const [last, setLast] = useState<AskResult | null>(null)
  useEffect(() => {
    setLast(null)
    const on: AskListener = (id, result) => {
      if (id === rfqId) setLast(result)
    }
    askListeners.add(on)
    return () => {
      askListeners.delete(on)
    }
  }, [rfqId])
  return [last, () => setLast(null)]
}

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
  const ask = async (input: { supplierIds: readonly string[]; items: readonly RfqItemRow[]; names: readonly string[] }): Promise<AskResult> => {
    if (inFlight.current) return { ok: false, text: '', supplierIds: [] }
    inFlight.current = true
    setCopying(true)
    try {
      const text = await askOnce(input)
      const result: AskResult = text === null ? { ok: false, text: '', supplierIds: [] } : { ok: true, text, supplierIds: [...input.supplierIds] }
      if (result.ok) askListeners.forEach(on => on(rfq.id, result))
      return result
    } finally {
      inFlight.current = false
      setCopying(false)
    }
  }

  /** The enquiry text once it is copied and recorded; null when nothing was recorded. */
  const askOnce = async (input: { supplierIds: readonly string[]; items: readonly RfqItemRow[]; names: readonly string[] }): Promise<string | null> => {
    const fresh = input.supplierIds.filter(id => !inquiries.some(i => i.supplierId === id))
    const shortlisted = inquiries.filter(i => input.supplierIds.includes(i.supplierId) && !i.sentOn && !i.noOfferOn).map(i => i.id)
    if (input.items.length === 0 || input.supplierIds.length === 0) return null
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
      return null
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
      return text
    } catch (err) {
      toast({ title: 'Copied, but the suppliers were not recorded', body: mapPgError(err, { entity: 'enquiry' }).message, tone: 'danger' })
      return null
    }
  }

  return { ask, busy: copying || add.isPending || remove.isPending || mark.isPending }
}
