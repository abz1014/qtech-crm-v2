import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { canAccess, type NavItem } from '@/app/navConfig'
import { getHomeRoute } from '@/app/roleRoutes'
import { useSession } from '@/app/session'
import { NoAccessPage } from '@/app/pages/NoAccessPage'

/** Everything inside needs a signed-in person. Loading shows nothing (A03 adds the splash); signed out goes to /login. */
export function RequireSession() {
  const session = useSession()
  const location = useLocation()
  if (session.status === 'loading') return null
  if (session.status === 'signed-out') return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

/**
 * A destination the role may not reach renders the no-access page inside the
 * shell (the nav never offered it). The data is protected by RLS regardless;
 * this keeps the interface honest.
 */
export function RequireRole({ item, children }: { item: NavItem; children: ReactNode }) {
  const session = useSession()
  const role = session.status === 'signed-in' ? session.user.role : ''
  return canAccess(role, item) ? <>{children}</> : <NoAccessPage area={item.label} />
}

/** `/` sends each role to its landing page: the first destination it may reach, else /no-access. */
export function RoleLanding() {
  const session = useSession()
  const role = session.status === 'signed-in' ? session.user.role : ''
  return <Navigate to={getHomeRoute(role)} replace />
}
