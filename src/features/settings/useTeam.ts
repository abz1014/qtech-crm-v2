import { useQuery, useQueryClient } from '@tanstack/react-query'
import { adminUsers, type TeamMember } from '@/features/settings/adminUsers'

export const TEAM_KEY = ['team'] as const

/** The people list, from the admin-users function (the only place that can read their emails). */
export function useTeam(enabled: boolean) {
  return useQuery<TeamMember[]>({ queryKey: TEAM_KEY, queryFn: adminUsers.list, enabled })
}

/** After any change the list is re-read from the server: the function is the source of truth. */
export function useRefreshTeam() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: TEAM_KEY })
}
