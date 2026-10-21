import type { Prefetch } from '@/app/routeChunks'
import { prefetchToday } from '@/features/today/hooks'
import type { Role } from '@/features/today/types'

/** Today's first read, started by the app before the page is drawn (src/app/routeChunks.ts). */
export const prefetch: Prefetch = ({ client, user }) => prefetchToday(client, { id: user.id, role: user.role as Role })
