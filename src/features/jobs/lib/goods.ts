import type { OrderItemRow, OrderLegRow } from '@/features/orders/api'

/**
 * Are the goods of the order at least ordered from the supplier? True with no goods at all (a service only order), or when every goods
 * line is on a live supplier order and every live supplier order is placed. Null while the lines or the supplier orders are still loading.
 * The engineer's Installed today waits for this (live review 24 Nov: it was offered while the office was still placing the order).
 */
export function goodsOrdered(items: readonly OrderItemRow[] | undefined, legs: readonly OrderLegRow[] | undefined): boolean | null {
  if (!items || !legs) return null
  const live = legs.filter(l => !l.cancelledWithSupplierOn)
  const liveIds = new Set(live.map(l => l.id))
  if (items.some(i => !i.isService && (!i.legId || !liveIds.has(i.legId)))) return false
  return live.every(l => Boolean(l.placedOn))
}
