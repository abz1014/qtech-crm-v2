import type { QueryClient } from '@tanstack/react-query'
import { jobKeyFor, type OldKind } from '@/app/oldAddressesModel'
import { getJobFactsFromOld } from '@/features/jobs/api'
import { jobFactsQuery } from '@/features/jobs/hooks'
import { qk } from '@/features/queryKeys'

/*
 * An old RFQ or order address, turned into the Job key (src/app/oldAddresses.tsx). The facts the job page needs come back in the same
 * round and are put in the cache under the key, so the page that opens finds them: the redirect costs no extra round trip. The
 * address's own app start (routeChunks.ts) runs this too, before the redirect component has even mounted; both share one request.
 */
const query = (client: QueryClient, kind: OldKind, id: string) => ({
  queryKey: [...qk.jobs.all, 'old-address', kind, id] as const,
  staleTime: 60_000,
  queryFn: async (): Promise<string | null> => {
    const facts = await getJobFactsFromOld(kind, id).catch(() => null)
    if (facts) {
      client.setQueryData(jobFactsQuery(facts.job.key).queryKey, facts)
      return facts.job.key
    }
    return jobKeyFor(kind, id)
  },
})

export const resolveOldAddress = (client: QueryClient, kind: OldKind, id: string): Promise<string | null> => client.fetchQuery(query(client, kind, id))
