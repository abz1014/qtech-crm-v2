import { useEffect } from 'react'
import type { NavKey } from '@/app/navConfig'
import type { SessionUser } from '@/app/session'
import { useBusinessToday, useTodayView } from '@/features/today/hooks'
import { navSectionOf, type NavSection } from '@/features/today/rules'
import { needsYouItems } from '@/features/today/needsYou'
import type { Role, TodayView } from '@/features/today/types'

export type NavCounts = Partial<Record<NavKey, number>>

/**
 * The "needs you" numbers, all from ONE definition (features/today/needsYou.ts, redesign phase 0): the items on the person's own
 * Today that are due today or late, not Waiting, not snoozed and not older than 30 days (a late payment never ages out).
 *   today   how many: the ONLY number drawn in the top bar and the phone tabs (plan section (c): every other badge goes).
 *   rfqs, orders, money  the same items split by navSectionOf (today/rules.ts): every item lands in exactly one, so the three
 *           always add up to Today's number. They are not drawn as badges; the shell hands them to its pages (navCountsContext),
 *           so the RFQ board's and the Orders list's "N need you" are these numbers. Money is for admin and sales only.
 * A destination with nothing to do shows no number, never a 0. No request of its own: Today's list is already loaded.
 * `ready`: Today's list has loaded (before that every count is missing, which is not the same as nothing to do).
 */
export function navCountsFrom(view: TodayView, role: string): NavCounts {
  const items = needsYouItems(view)
  const some = (n: number) => (n > 0 ? n : undefined) // nothing waiting: no number, no nag
  const section = (key: NavSection) => some(items.filter(i => navSectionOf(i) === key).length)
  const counts: NavCounts = { today: some(items.length), rfqs: section('rfqs'), orders: section('orders') }
  if (role === 'admin' || role === 'sales') counts.money = section('money')
  return counts
}

export function useNavCounts(user: SessionUser): { counts: NavCounts; ready: boolean } {
  const today = useTodayView({ id: user.id, role: user.role as Role }, useBusinessToday())
  return { counts: today.view ? navCountsFrom(today.view, user.role) : {}, ready: today.view !== null }
}

/**
 * The counts as a component of their own, loaded (with the Today rules) only once the page has its data (AppShell,
 * usePageSettled): on a slow connection the page's reads go first and the Today read for the numbers follows (perf/lcp).
 */
export default function NavCountsSource({ user, onCounts }: { user: SessionUser; onCounts: (nav: { counts: NavCounts; ready: boolean }) => void }) {
  const nav = useNavCounts(user)
  const key = JSON.stringify(nav)
  useEffect(() => {
    onCounts(JSON.parse(key) as { counts: NavCounts; ready: boolean })
  }, [key, onCounts])
  return null
}
