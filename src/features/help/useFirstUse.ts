import { useQuery } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { firstUseCopy } from '@/features/help/firstUseCopy'
import { fetchFirstUse, isNewOn, type FirstUseScreenName } from '@/features/help/firstUseApi'

const TEN_MINUTES = 10 * 60_000

/**
 * Whether to show the first-use state on a screen. Pass `enabled` only in the screen's empty branch, so a person with work
 * never pays for the read. While it loads (or if it fails) the answer is "not new": the screen's own empty state shows.
 */
export function useFirstUse(screen: FirstUseScreenName, userId: string, role: string, enabled: boolean) {
  const q = useQuery({
    queryKey: qk.onboarding.firstUse(userId),
    queryFn: () => fetchFirstUse(userId, role),
    enabled: enabled && !!userId,
    staleTime: TEN_MINUTES,
  })
  const facts = q.data
  const alone = !!facts?.ownerAlone
  // A role with no first-use words for this screen (an engineer on the RFQ board) keeps the screen's own empty state.
  const isNew = enabled && !!facts && isNewOn(screen, role, facts) && firstUseCopy(screen, role, { alone }) !== null
  return { isNew, alone }
}
