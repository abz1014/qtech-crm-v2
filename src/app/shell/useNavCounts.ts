import type { NavKey } from '@/app/navConfig'
import type { SessionUser } from '@/app/session'
import { useBusinessToday, useTodayView } from '@/features/today/hooks'
import type { Role } from '@/features/today/types'

/**
 * The numbers beside the top-bar destinations. Every one means "needs you" (DESIGN_SYSTEM section 12, owner decision
 * 2026-10-19), and every one is read from the person's own Today list, so the counts can never disagree with Today:
 *   Today   the length of the "needs you" list.
 *   RFQs    the items on that list about an RFQ (ask suppliers, chase, send the answers, a quotation due, no decision).
 *   Orders  the items about an order that are not money (goods late, place the PO, plan commissioning, a supplier missing,
 *           an engineer's assigned jobs).
 *   Money   the money items (overdue payments, FBR, TCS, costs, recurring, month end), for admin and sales only.
 * A destination with nothing to do shows no number, never a 0. An engineer gets no Money count: Today never reads a money fact
 * for them. No request of its own: Today's list is already loaded for the Today count.
 */
export function useNavCounts(user: SessionUser): Partial<Record<NavKey, number>> {
  const today = useTodayView({ id: user.id, role: user.role as Role }, useBusinessToday())
  const counts: Partial<Record<NavKey, number>> = {}
  if (today.view) {
    const active = today.view.active
    counts.today = active.length
    const some = (n: number) => (n > 0 ? n : undefined) // nothing waiting: no number, no nag
    counts.rfqs = some(active.filter(i => i.rfqId).length)
    counts.orders = some(active.filter(i => i.orderId && i.tab !== 'money').length)
    if (user.role === 'admin' || user.role === 'sales') counts.money = some(active.filter(i => i.tab === 'money').length)
  }
  return counts
}
