import { useState } from 'react'
import { Ban } from 'lucide-react'
import { orderRef } from '@/lib/refs'
import { copyToClipboard } from '@/lib/clipboard'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { MessageActions } from '@/ui/MessageActions'
import { Radio, RadioGroup } from '@/ui/form/Radio'
import { useToast } from '@/ui/useToast'
import type { OrderHeader } from '@/features/orders/api'
import { CANCEL_REASONS, type CancelReason } from '@/features/orders/lib/cancel'
import { useSentPos } from '@/features/purchaseOrders/hooks'
import { cancellationMessage, sentPoSentence } from '@/features/purchaseOrders/lib/cancelText'
import { COMPANY_NAME } from '@/features/rfqs/lib/chaseCommon'

/* The cancel-order dialog (see OrderHeaderBlock): downloaded when it opens, not with the order page (perf: LCP). */
export function CancelDialog({
  order,
  busy,
  onClose,
  onConfirm,
}: {
  order: OrderHeader
  busy: boolean
  onClose: () => void
  onConfirm: (reason: CancelReason) => Promise<unknown>
}) {
  const [reason, setReason] = useState<CancelReason | null>(null)
  const { toast } = useToast()
  const sent = useSentPos(order.id, true).data ?? []
  return (
    <Dialog open busy={busy} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        size="sm"
        tone="danger"
        icon={Ban}
        title="Cancel this order"
        context={`${orderRef(order.number)} · ${order.companyName}`}
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={busy}>
              Keep the order
            </Button>
            <Button variant="danger" busy={busy} busyLabel="Cancelling" disabled={!reason} onClick={() => (reason ? onConfirm(reason) : undefined)}>
              Cancel order
            </Button>
          </>
        }
      >
        <div className="grid gap-4">
          <p className="text-sm text-fg-muted">The order stays on record and can be reopened. Reports use the reason.</p>
          {sent.length > 0 ? (
            <ul aria-label="Purchase orders already sent" data-testid="cancel-sent-pos" className="grid gap-3 rounded border border-tone-warning-fg/25 bg-tone-warning-bg p-3 text-sm text-tone-warning-fg">
              {sent.map(po => (
                <li key={po.ref} className="flex flex-wrap items-center justify-between gap-2">
                  <span>{sentPoSentence(po)}</span>
                  <MessageActions
                    size="sm"
                    to={po.contact ?? { name: po.supplierName }}
                    text={cancellationMessage(po, COMPANY_NAME)}
                    email={{ subject: `${po.ref} cancelled` }}
                    copy={{
                      label: 'Copy cancellation message',
                      onCopy: async () => {
                        const ok = await copyToClipboard(cancellationMessage(po, COMPANY_NAME))
                        toast(ok ? { title: 'Cancellation message copied', body: `For ${po.supplierName}, ${po.ref}.` } : { title: 'Could not copy the message', body: 'Nothing was changed.', tone: 'danger' })
                      },
                    }}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          <RadioGroup aria-label="Reason" value={reason ?? ''} onValueChange={v => setReason(v as CancelReason)} className="gap-2">
            {CANCEL_REASONS.map(r => (
              <Radio key={r.value} value={r.value} label={r.label} />
            ))}
          </RadioGroup>
        </div>
      </DialogContent>
    </Dialog>
  )
}
