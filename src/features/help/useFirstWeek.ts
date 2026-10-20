import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { inFirstWeeks, type FirstWeekMember } from '@/features/help/firstWeek'
import { fetchFirstWeek } from '@/features/help/firstWeekApi'

/** The checklist facts for the people on the Team page still in their first 14 days. One read for all of them. */
export function useFirstWeek(members: FirstWeekMember[], enabled: boolean) {
  const fresh = useMemo(() => members.filter(m => inFirstWeeks(m)).map(m => ({ id: m.id, role: m.role })), [members])
  return useQuery({
    queryKey: qk.onboarding.firstWeek(fresh.map(p => p.id).sort().join(',')),
    queryFn: () => fetchFirstWeek(fresh),
    enabled: enabled && fresh.length > 0,
    staleTime: 5 * 60_000,
  })
}
