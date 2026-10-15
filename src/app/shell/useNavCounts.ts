import type { NavKey } from '@/app/navConfig'
import type { SessionUser } from '@/app/session'
import { useOpenRfqs } from '@/features/rfqs/board/hooks'
import { useBusinessToday, useTodayView } from '@/features/today/hooks'
import type { Role } from '@/features/today/types'

/**
 * The numbers beside the top-bar destinations ("Today 9", "RFQs 14").
 * Today is the length of the "needs you" list; RFQs is every open RFQ. Both read the TanStack cache the
 * two pages already fill, so the bar costs no extra request once either page has loaded. Orders and Money
 * are not built yet and stay unset. A destination whose data has not loaded (or failed) shows no number.
 */
export function useNavCounts(user: SessionUser): Partial<Record<NavKey, number>> {
  const today = useTodayView({ id: user.id, role: user.role as Role }, useBusinessToday())
  const open = useOpenRfqs()
  const counts: Partial<Record<NavKey, number>> = {}
  if (today.view) counts.today = today.view.active.length
  if (open.data) counts.rfqs = open.data.length
  return counts
}
