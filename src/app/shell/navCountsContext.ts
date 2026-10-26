import { createContext, useContext } from 'react'
import type { CountKey } from '@/app/navConfig'

/**
 * The top-bar numbers (useNavCounts), handed to the pages under the shell, so a page that says "N need you" says the same
 * number as its badge, from the same Today list and with no request of its own. Null outside the shell or until Today has loaded.
 */
export const NavCountsContext = createContext<(Partial<Record<CountKey, number>> & { moneyLate?: boolean }) | null>(null)

export function useSharedNavCounts(): (Partial<Record<CountKey, number>> & { moneyLate?: boolean }) | null {
  return useContext(NavCountsContext)
}
