import { useState } from 'react'
import { Check } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { useToast } from '@/ui/useToast'
import type { InquiryRow } from '@/features/rfqs/api'
import { useConfirmInquiriesSent } from '@/features/rfqs/hooks'

/*
 * The honest "Sent" (redesign phase 3, P3-C2). Copying a supplier enquiry, or opening it in WhatsApp or email, proves nothing: the
 * person may not press Send. So the app asks once, "Did you send it?", and only [Yes, sent] writes supplier_inquiries.sent_confirmed_at
 * (0097). Until then every screen says "Asked", never "Sent" (sentLine in lib/detailView.ts). [Not yet] changes nothing and hides the
 * question here; the supplier's row on the RFQ page keeps a quiet [Yes, sent] for later.
 *   variant "ask"    the question with both answers (right after the message was copied or opened)
 *   variant "later"  just [Yes, sent], on the Suppliers asked row, for an enquiry nobody has confirmed
 */
export function SentConfirm({ rfqId, inquiry, variant = 'ask' }: { rfqId: string; inquiry: Pick<InquiryRow, 'id' | 'supplierName' | 'sentOn' | 'sentConfirmedAt'>; variant?: 'ask' | 'later' }) {
  const confirm = useConfirmInquiriesSent(rfqId)
  const { toast } = useToast()
  const [notYet, setNotYet] = useState(false)
  if (!inquiry.sentOn) return null
  if (inquiry.sentConfirmedAt) {
    return variant === 'ask' ? (
      <p className="m-0 flex items-center gap-2 text-base text-tone-success-fg" data-sent-confirmed>
        <Icon icon={Check} size="sm" /> Sent
      </p>
    ) : null
  }
  const yes = () =>
    confirm.mutate(
      { ids: [inquiry.id] },
      {
        onSuccess: ids =>
          toast({
            title: `Sent to ${inquiry.supplierName}`,
            tone: 'success',
            undo: ids.length > 0 ? { onUndo: () => confirm.mutateAsync({ ids, undo: true }).then(() => undefined), undoneTitle: 'Back to asked' } : undefined,
          }),
        onError: err => toast({ title: 'Could not save it', body: mapPgError(err, { entity: 'enquiry' }).message, tone: 'danger' }),
      },
    )
  if (variant === 'later') {
    return (
      <Button size="sm" variant="quiet" busy={confirm.isPending} busyLabel="Saving" onClick={yes} aria-label={`Yes, sent: ${inquiry.supplierName}`}>
        Yes, sent
      </Button>
    )
  }
  if (notYet) return <p className="m-0 text-base text-fg-muted">Asked, not sent yet</p>
  return (
    <div role="group" aria-label={`Did you send it to ${inquiry.supplierName}?`} className="flex flex-wrap items-center gap-2" data-sent-question>
      <span className="text-base font-medium">Did you send it?</span>
      <Button size="sm" busy={confirm.isPending} busyLabel="Saving" onClick={yes} aria-label={`Yes, sent: ${inquiry.supplierName}`}>
        Yes, sent
      </Button>
      <Button size="sm" variant="quiet" onClick={() => setNotYet(true)} aria-label={`Not yet: ${inquiry.supplierName}`}>
        Not yet
      </Button>
    </div>
  )
}
