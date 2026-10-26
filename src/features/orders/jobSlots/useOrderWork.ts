import type { JobContext } from '@/features/jobs/slots'
import { useLegPos, useOrderEngineers, useOrderHeader, useOrderItems, useOrderLegs, useOrderMoney } from '@/features/orders/hooks'

/*
 * What the order-side stages of the job page read: the same hooks, on the same query keys, as the order page (and as useJobData),
 * so a read the job page already made is found in the cache and a write that refreshes the order refreshes these. An engineer
 * asks for no price (the hooks' own `money` switch).
 */
export function useOrderWork(ctx: JobContext) {
  const orderId = ctx.job.orderId ?? undefined
  const { money, role } = ctx
  const header = useOrderHeader(orderId, money)
  const items = useOrderItems(orderId, money)
  const legs = useOrderLegs(orderId, items.data)
  const engineers = useOrderEngineers(orderId)
  const orderMoney = useOrderMoney(orderId, role === 'engineer' ? null : role)
  const pos = useLegPos(orderId, (legs.data ?? []).map(l => l.id), money)
  const order = header.data ?? null
  const ready = Boolean(order && items.data && legs.data)
  const failed = header.isError || items.isError || legs.isError
  const canEdit = order !== null && order.cancelledOn === null
  const goodsLegs = (legs.data ?? []).filter(l => (items.data ?? []).some(i => i.legId === l.id && !i.isService))
  /** Every supplier order that supplies goods has delivered them (no goods at all counts: there is nothing on order). */
  const allDelivered = goodsLegs.every(l => l.deliveredOn !== null)
  return { orderId, order, items, legs, engineers, orderMoney, pos, ready, failed, canEdit, goodsLegs, allDelivered, money, role }
}

export type OrderWork = ReturnType<typeof useOrderWork>
