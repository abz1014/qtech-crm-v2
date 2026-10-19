import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { useToast } from '@/ui/useToast'
import type { OrderHeader } from '@/features/orders/api'
import { useUpdateOrder } from '@/features/orders/hooks'

// Commissioning actions shared by the order header (the engineer) and the Commissioning panel (admin and sales).

/** The one-tap "Mark done today" and its Undo. Used by the page header (engineer) and by the panel (admin and sales). */
export function useMarkDone(order: OrderHeader) {
  const { toast } = useToast()
  const update = useUpdateOrder(order.id)
  return {
    pending: update.isPending,
    run: async () => {
      const previous = order.doneOn
      try {
        await update.mutateAsync({ commissioning_done_on: businessToday() })
        toast({
          title: 'Commissioning marked done',
          body: `${order.companyName}, today`,
          undo: {
            onUndo: async () => {
              await update.mutateAsync({ commissioning_done_on: previous })
            },
            settledTitle: 'Commissioning marked done',
            undoneTitle: 'Taken back',
          },
        })
      } catch (err) {
        toast({ title: 'Could not mark it done', body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
      }
    },
  }
}

/** Moves the planned date (used by the panel and by the engineer's "Change planned date"). */
export function useSetPlanned(order: OrderHeader) {
  const { toast } = useToast()
  const update = useUpdateOrder(order.id)
  return async (value: string | null) => {
    const previous = order.plannedOn
    try {
      await update.mutateAsync({ commissioning_planned_on: value })
      toast({
        title: value ? 'Planned date changed' : 'Planned date cleared',
        body: value ? formatDay(value) : order.companyName,
        undo: {
          onUndo: async () => {
            await update.mutateAsync({ commissioning_planned_on: previous })
          },
          settledTitle: value ? 'Planned date changed' : 'Planned date cleared',
          undoneTitle: 'Taken back',
        },
      })
    } catch (err) {
      toast({ title: 'Could not change the date', body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
    }
  }
}
