import { useState } from 'react'
import { Ban, Banknote, RotateCcw, Trash2 } from 'lucide-react'
import { useReassignOwnerItem } from '@/features/owners/useReassignOwner'
import { businessToday } from '@/lib/dates'
import { mapPgError } from '@/lib/pgErrors'
import { orderRef } from '@/lib/refs'
import { MenuItem, MenuSeparator } from '@/ui/Popover'
import { MoreMenu } from '@/ui/MoreMenu'
import { useToast } from '@/ui/useToast'
import type { OrderHeader } from '@/features/orders/api'
import { useCancelOrder } from '@/features/orders/hooks'
import { useDeleteOrderFlow } from '@/features/orders/deleteFlow'
import { useDeleteJobFlow } from '@/features/jobs/deleteJob/useDeleteJobFlow'
import type { DeleteJobTarget } from '@/features/jobs/deleteJob/DeleteJobDialog'
import { useHistoryPanel } from '@/features/history/useHistoryPanel'
import { useInFlight } from '@/lib/useInFlight'
import { lazyDialog, lazyShown } from '@/lib/lazyDialog'

// Downloaded the first time it opens, not with the menu (perf/lcp, lazyDialog.tsx).
const CancelDialog = lazyShown(() => import('@/features/orders/CancelDialog').then(m => m.CancelDialog))
// Record payment from the More menu: its form library (react-hook-form) is not on the order page's first download.
const RecordPaymentDialog = lazyDialog(() => import('@/features/money/payments/RecordPaymentDialog').then(m => m.RecordPaymentDialog))

/**
 * The order's "More" menu (the shared MoreMenu): Cancel order (with a reason, and Undo) or Reopen order. A "More" text button beside
 * the title from tablet up, and an icon in the phone's one bar (useMobileBar) below 768. Engineers have none.
 */
export function OrderMoreMenu({ order, touch = false, recordPayment = false, afterDelete, deleteJob, scope }: { order: OrderHeader; touch?: boolean; /** Admin: Record payment lives here before an invoice (an advance) or once paid. */ recordPayment?: boolean; /** Where a deleted order lands (the job page: the jobs list). */ afterDelete?: string; /** The job page: Delete job (the guide first) takes the place of Delete order. */ deleteJob?: DeleteJobTarget; /** The job page, on a job that has an enquiry: Reassign owner moves the enquiry and its orders (kind `job`), as the page header's button did. Without it the order alone moves. */ scope?: { rfqId: string; label: string; ownerId: string | null; ownerName: string | null } }) {
  const { toast } = useToast()
  const cancel = useCancelOrder(order.id)
  const once = useInFlight() // HW-15: one cancel / reopen per press, however many clicks
  const [cancelling, setCancelling] = useState(false)
  const [paying, setPaying] = useState(false)
  const cancelled = order.cancelledOn !== null
  const ref = orderRef(order.number)
  const today = businessToday()
  const del = useDeleteOrderFlow({ id: order.id, number: order.number, companyName: order.companyName }, afterDelete)
  const delJob = useDeleteJobFlow(deleteJob ?? null, order.cancelledOn === null ? () => setCancelling(true) : undefined)
  const history = useHistoryPanel({ table: 'orders', id: order.id, context: `${ref} · ${order.companyName}`, imported: order.imported })
  const reassign = useReassignOwnerItem(
    scope
      ? { kind: 'job', id: scope.rfqId, label: scope.label, ownerId: scope.ownerId, ownerName: scope.ownerName }
      : { kind: 'order', id: order.id, label: `${ref} · ${order.companyName}`, ownerId: order.owner?.id ?? null, ownerName: order.owner?.name ?? null },
  )

  const reopen = () =>
    once(async () => {
      if (order.cancelledOn === null) return
      const before = { cancelled_on: order.cancelledOn, cancel_reason: order.cancelReason }
      try {
        // the reason goes with the date: the database refuses a reason on an active order
        await cancel.mutateAsync({ cancelled_on: null, cancel_reason: null })
        toast({
          title: 'Order reopened',
          body: ref,
          undo: {
            onUndo: async () => {
              await cancel.mutateAsync(before)
            },
            settledTitle: 'Order reopened',
            undoneTitle: 'Cancelled again',
          },
        })
      } catch (err) {
        toast({ title: 'Could not reopen', body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
      }
    })

  return (
    <>
      <MoreMenu touch={touch} label="More actions">
          {history.item}
          {reassign.item}
          {recordPayment ? (
            <MenuItem icon={Banknote} onClick={() => setPaying(true)}>
              Record payment
            </MenuItem>
          ) : null}
          {cancelled ? (
            <MenuItem icon={RotateCcw} onClick={() => void reopen()}>
              Reopen order
            </MenuItem>
          ) : (
            <MenuItem icon={Ban} danger onClick={() => setCancelling(true)}>
              Cancel order
            </MenuItem>
          )}
          {(deleteJob ? delJob.ask : del.ask) ? (
            <>
              <MenuSeparator />
              <MenuItem icon={Trash2} danger onClick={deleteJob ? delJob.ask : del.ask}>
                {deleteJob ? 'Delete job' : 'Delete order'}
              </MenuItem>
            </>
          ) : null}
      </MoreMenu>
      {del.node}
      {delJob.node}
      {history.node}
      {reassign.node}
      {recordPayment ? <RecordPaymentDialog open={paying} onOpenChange={setPaying} orderId={order.id} /> : null}
      {cancelling ? (
        <CancelDialog
          order={order}
          busy={cancel.isPending}
          onClose={() => setCancelling(false)}
          onConfirm={reason =>
            once(async () => {
              // idempotent: an order already cancelled (a second press that slipped through) is not written again
              if (order.cancelledOn !== null) return setCancelling(false)
              const before = { cancelled_on: order.cancelledOn, cancel_reason: order.cancelReason }
              try {
                await cancel.mutateAsync({ cancelled_on: today, cancel_reason: reason })
                setCancelling(false)
                toast({
                  title: 'Order cancelled',
                  body: ref,
                  undo: {
                    onUndo: async () => {
                      await cancel.mutateAsync(before)
                    },
                    settledTitle: 'Order cancelled',
                    undoneTitle: 'Order is active again',
                  },
                })
              } catch (err) {
                toast({ title: 'Could not cancel the order', body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
              }
            })
          }
        />
      ) : null}
    </>
  )
}
