import type { NavKey } from '@/app/navConfig'
import type { SessionUser } from '@/app/session'
import { useBusinessToday, useTodayView } from '@/features/today/hooks'
import { navSectionOf, type NavSection } from '@/features/today/rules'
import type { Role } from '@/features/today/types'

/**
 * The numbers beside the top-bar destinations. Every one means "needs you" (DESIGN_SYSTEM section 12, owner decision
 * 2026-10-19), and every one is read from the person's own Today list, so the counts can never disagree with Today:
 *   Today   the length of the "needs you" list.
 *   RFQs, Orders, Money  that list split by navSectionOf (today/rules.ts): every item lands in exactly one, so the three
 *           always add up to Today's number. Money is for admin and sales only.
 * The top bar and the phone tabs draw them with NeedsCount (", 4 need you" for screen readers).
 * A destination with nothing to do shows no number, never a 0. An engineer gets no Money count: Today never reads a money fact
 * for them. No request of its own: Today's list is already loaded for the Today count.
 */
export function useNavCounts(user: SessionUser): Partial<Record<NavKey, number>> {
  const today = useTodayView({ id: user.id, role: user.role as Role }, useBusinessToday())
  const counts: Partial<Record<NavKey, number>> = {}
  if (today.view) {
    const active = today.view.active
    const some = (n: number) => (n > 0 ? n : undefined) // nothing waiting: no number, no nag
    const section = (key: NavSection) => some(active.filter(i => navSectionOf(i) === key).length)
    counts.today = some(active.length)
    counts.rfqs = section('rfqs')
    counts.orders = section('orders')
    if (user.role === 'admin' || user.role === 'sales') counts.money = section('money')
  }
  return counts
}
