import type { Prefetch } from '@/app/routeChunks'
import { jobsListQuery } from '@/features/jobs/hooks'

/** The Jobs list's first read, started by the app before the page is drawn (src/app/routeChunks.ts). */
export const prefetchList: Prefetch = ({ client, user }) => client.prefetchQuery(jobsListQuery(user.role))
