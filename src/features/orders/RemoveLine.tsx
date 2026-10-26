import { mapPgError } from '@/lib/pgErrors'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { useToast } from '@/ui/useToast'
import type { OrderItemRow } from '@/features/orders/api'
import { useRemoveOrderItem } from '@/features/orders/hooks'

/*
 * "Remove line" on an order (W10). An order keeps at least one line: for the last one the confirm says so and offers no Delete
 * (delete the order instead). Whose line it is stays the database's rule (0092 guard_entered_by, HINT not_yours); the page only
 * offers the action to someone who may edit the order's lines.
 */
export const LAST_LINE = 'An order needs at least one line, so the last one cannot be removed. To get rid of the whole order, delete the order (More).'

export function RemoveLineConfirm({ orderId, line, lineCount, onClose }: { orderId: string; line: Pick<OrderItemRow, 'id' | 'description'>; lineCount: number; onClose: () => void }) {
  const { toast } = useToast()
  const remove = useRemoveOrderItem(orderId)
  return (
    <ConfirmDelete
      open
      onOpenChange={o => {
        if (!o) onClose()
      }}
      thing="this line"
      summary={line.description}
      blocked={lineCount <= 1 ? LAST_LINE : null}
      onConfirm={async () => {
        await remove.mutateAsync(line.id)
        toast({ title: 'Line removed', body: line.description, tone: 'success' })
      }}
      errorMessage={e => mapPgError(e, { entity: 'line' }).message}
    />
  )
}
