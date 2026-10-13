// Ported from src/lib/roleRoutes.ts @ 7a29f3a (Q-Tech CRM v1). Uses v2 navConfig; role param is string so unknown roles fall to /no-access.
import { navItemsForRole } from '@/app/navConfig'

export const NO_ACCESS_ROUTE = '/no-access'

/** First nav item the role may reach; unknown role -> /no-access. */
export function getHomeRoute(role: string): string {
  return navItemsForRole(role)[0]?.path ?? NO_ACCESS_ROUTE
}
