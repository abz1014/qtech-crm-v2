import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { mapPgError } from '@/lib/pgErrors'
import { useToast } from '@/ui/useToast'
import type { OrderHeader, OrderLegRow } from '@/features/orders/api'
import { useSupplierMedianDays, useUpdateLeg } from '@/features/orders/hooks'
import { before, editPatch, nextStamp, stampPatch, type LegDates, type LegPatch } from '@/features/orders/lib/legModel'

/*
 * The writes of one supplier order (a "leg" in the database): its next-step stamp (Mark placed, Delivered today: 1 tap, Undo in the
 * toast), a hand edit of a date, and its reference. Shared by the supplier order's own row and by the order header, whose one primary
 * button can be that stamp. The leg may be undefined (the header has no supplier-order step): the hooks still run, nothing is stamped.
 */
export function useLegActions(order: OrderHeader, leg: OrderLegRow | undefined) {
  const { toast } = useToast()
  const update = useUpdateLeg(order.id)
  const median = useSupplierMedianDays(leg?.supplierId)
  const medianDays = median.data ?? null
  const today = businessToday()
  const dates: LegDates | null = leg ? { placedOn: leg.placedOn, expectedOn: leg.expectedOn, receivedOn: leg.receivedOn, deliveredOn: leg.deliveredOn } : null
  const stamp = dates ? nextStamp(dates) : null
  const leadHint = leg && leg.leadTimes.length > 0 ? [...leg.leadTimes].sort((a, b) => b.length - a.length)[0] : null

  const run = async (patch: LegPatch & { reference?: string | null }, title: string, body: string) => {
    if (!leg || !dates) return
    const prev: LegPatch & { reference?: string | null } = { ...before(dates, patch), ...('reference' in patch ? { reference: leg.reference } : {}) }
    try {
      await update.mutateAsync({ id: leg.id, patch })
      toast({
        title,
        body,
        undo: {
          onUndo: async () => {
            await update.mutateAsync({ id: leg.id, patch: prev })
          },
          settledTitle: title,
          undoneTitle: 'Taken back',
        },
      })
    } catch (err) {
      toast({ title: 'Could not save', body: mapPgError(err, { entity: 'supplier order' }).message, tone: 'danger' })
    }
  }

  const doStamp = () => {
    if (!stamp || !leg || !dates) return
    const patch = stampPatch(stamp.step, dates, today, leg.leadTimes, medianDays)
    const verb = stamp.step === 'place' ? 'Marked placed' : 'Marked delivered'
    const extra = patch.expected_on ? `expected ${formatDay(patch.expected_on)}, from lead time ${leadHint ?? ''}`.replace(/, from lead time $/, '') : ''
    void run(patch, verb, [leg.supplierName, extra].filter(Boolean).join(' · '))
  }

  const saveDate = (field: keyof LegDates, name: string) => (value: string | null) => {
    if (!leg || !dates) return Promise.resolve()
    return run(editPatch(field, value, dates, leg.leadTimes, medianDays), value ? `${name} date set` : `${name} date cleared`, leg.supplierName)
  }

  return { stamp, doStamp, run, saveDate, pending: update.isPending, medianDays, today }
}
