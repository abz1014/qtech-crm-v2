import { useQuery } from '@tanstack/react-query'
import { useSession } from '@/app/session'
import { qk } from '@/features/queryKeys'
import * as api from '@/features/rfqs/api'
import { COMPANY_NAME, type ChaseSignature } from '@/features/rfqs/lib'

/** The signature of every chase message: the signed-in person's name and job title, and the company. One source for every surface. */
export function useSignature(): ChaseSignature {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const profile = useQuery({
    queryKey: qk.me.profile(user?.id ?? ''),
    queryFn: () => api.getMyProfile(user?.id as string),
    enabled: Boolean(user),
    staleTime: 5 * 60_000,
  })
  return { name: user?.name ?? COMPANY_NAME, company: COMPANY_NAME, jobTitle: profile.data?.jobTitle ?? null, phone: profile.data?.phone ?? null }
}
