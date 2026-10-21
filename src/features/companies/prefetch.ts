import type { Prefetch } from '@/app/routeChunks'
import { companyListQuery } from '@/features/companies/hooks'

/** The Companies list's first read, started by the app before the page is drawn (src/app/routeChunks.ts). */
export const prefetch: Prefetch = ({ client }) => client.prefetchQuery(companyListQuery())
