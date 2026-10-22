import type { NavKey } from '@/app/navConfig'
import type { SessionUser } from '@/app/session'
import { useBusinessToday, useTodayView } from '@/features/today/hooks'
import { navSectionOf, type NavSection } from '@/features/today/rules'
import type { Role } from '@/features/today/types'

/**
 * The numbers beside the top-bar destinations. Every one means "needs you" (DESIGN_SYSTEM section 12, owner decision
 * 2026-10-19), and every one is read from the person's own Today list, so the counts can never disagree with Today:
 *   Today   the length of the "needs you" list.
 *   RFQs, Money  that list split by navSectionOf (today/rules.ts). Money is for admin and sales only.
 *   Orders  no number (audit O4, 2026-10-22). The Orders page says "N need you" from each order's next step (late or now,
 *           orders/lib/nextStep listNextStep), filtered by Mine or All; Today's order items are a different, rule-based set, so a badge
 *           from Today read "Orders 1" beside a page saying "6 need you". Counting the page's way would need the whole orders
 *           list and its next-step model in the shell (a second request and more first-load code), so the badge is dropped;
 *           the order items still count under Today.
 * The top bar and the phone tabs draw them with NeedsCount (", 4 need you" for screen readers).
 * A destination with nothing to do shows no number, never a 0. An engineer gets no Money count: Today never reads a money fact
 * for them. No request of its own: Today's list is already loaded for the Today count.
 * The shell also hands them to its pages (navCountsContext), so the Orders page's "N need you" is the Orders badge's number.
 * `ready`: Today's list has loaded (before that every count is missing, which is not the same as nothing to do).
 */
export function useNavCounts(user: SessionUser): { counts: Partial<Record<NavKey, number>>; ready: boolean } {
  const today = useTodayView({ id: user.id, role: user.role as Role }, useBusinessToday())
  const counts: Partial<Record<NavKey, number>> = {}
  if (today.view) {
    const active = today.view.active
    const some = (n: number) => (n > 0 ? n : undefined) // nothing waiting: no number, no nag
    const section = (key: NavSection) => some(active.filter(i => navSectionOf(i) === key).length)
    counts.today = some(active.length)
    counts.rfqs = section('rfqs')
    if (user.role === 'admin' || user.role === 'sales') counts.money = section('money')
  }
  return { counts, ready: today.view !== null }
}
