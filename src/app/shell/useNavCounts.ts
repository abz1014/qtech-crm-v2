import type { NavKey } from '@/app/navConfig'
import type { SessionUser } from '@/app/session'
import { useActiveOrderCount } from '@/features/orders/hooks'
import { useOpenRfqs } from '@/features/rfqs/board/hooks'
import { useBusinessToday, useTodayView } from '@/features/today/hooks'
import type { Role } from '@/features/today/types'

/**
 * The numbers beside the top-bar destinations ("Today 9, RFQs 14, Orders 7, Money 3").
 *   Today  the length of the "needs you" list.
 *   RFQs   every open RFQ.
 *   Orders every active order (one head request that counts v_order_state, which carries no money).
 *   Money  the Money items waiting on Today (overdue payments, FBR, TCS, costs, recurring, month end), for admin and sales only.
 *          An engineer gets no Money count: the destination is not in their bar, and Today never reads a money fact for them.
 * Today and RFQs read the TanStack cache the two pages already fill. A destination whose data has not loaded (or failed) shows no number.
 */
export function useNavCounts(user: SessionUser): Partial<Record<NavKey, number>> {
  const today = useTodayView({ id: user.id, role: user.role as Role }, useBusinessToday())
  const open = useOpenRfqs()
  const orders = useActiveOrderCount()
  const counts: Partial<Record<NavKey, number>> = {}
  if (today.view) {
    counts.today = today.view.active.length
    if (user.role === 'admin' || user.role === 'sales') {
      const money = today.view.active.filter(i => i.tab === 'money').length
      if (money > 0) counts.money = money // nothing waiting: no number, no nag
    }
  }
  if (open.data) counts.rfqs = open.data.length
  if (typeof orders.data === 'number') counts.orders = orders.data
  return counts
}
