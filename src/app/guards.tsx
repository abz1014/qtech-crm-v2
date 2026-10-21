import { Navigate, Outlet, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { canAccess, type NavItem } from '@/app/navConfig'
import { getHomeRoute } from '@/app/roleRoutes'
import { useSession } from '@/app/session'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { OfflineBanner, OfflineWaitingPage } from '@/app/pages/OfflinePage'
import { Splash } from '@/app/pages/Splash'
import { useConnection } from '@/lib/connection'
import { useUpdateNeeded } from '@/lib/pwa/minVersion'
import { UpdateNeededBanner } from '@/app/shell/UpdateNeededBanner'
import { useScrollRestoration } from '@/lib/useScrollRestoration'

/**
 * Everything inside needs a signed-in person. Loading shows the splash; signed out goes to /login.
 *
 * Offline or reconnecting (AuthProvider, src/lib/connection.ts): a person this device remembers gets the shell with a
 * banner above it; one it does not remember yet gets the waiting page, never an endless splash or the sign-in form.
 * The two wrappers are always rendered (display: contents while online), so the banner coming and going never re-mounts
 * the shell and never closes an open sheet. While the banner shows, the shell's own viewport-tall frame (the element
 * that holds <main id="main">) is fitted below it.
 *
 * An app older than the server's minimum (owner decision 2026-10-22, src/lib/pwa/minVersion.ts) gets the "Update needed" strip
 * the same way, above the offline one.
 *
 * Also keeps the scroll place of the shell's <main> across navigation (src/lib/useScrollRestoration.ts).
 */
export function RequireSession() {
  const session = useSession()
  const connection = useConnection()
  const location = useLocation()
  const outdated = useUpdateNeeded()
  useScrollRestoration('main', session.status === 'signed-in')
  if (session.status === 'loading') return connection === 'online' ? <Splash /> : <OfflineWaitingPage connection={connection} />
  if (session.status === 'signed-out') return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  const away = connection === 'online' ? null : connection
  const strip = away !== null || outdated
  return (
    <div className={strip ? 'flex h-dvh flex-col' : 'contents'}>
      {outdated ? <UpdateNeededBanner /> : null}
      {away ? <OfflineBanner connection={away} /> : null}
      <div className={strip ? 'relative min-h-0 flex-1 [&_div:has(>#main)]:h-full' : 'contents'}>
        <Outlet />
      </div>
    </div>
  )
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
