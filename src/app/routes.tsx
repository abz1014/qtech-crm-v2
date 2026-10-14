import { lazy, Suspense, type ComponentType } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { RequireRole, RequireSession, RoleLanding } from '@/app/guards'
import { navItems, type NavKey } from '@/app/navConfig'
import { DestinationPage } from '@/app/pages/DestinationPage'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { SignInPage } from '@/app/pages/SignInPage'
import { useSession } from '@/app/session'
import { AppShell } from '@/app/shell/AppShell'

/**
 * Screens plug in here, one per destination. A feature task replaces its entry
 * (a lazy-loaded page component); until then the destination shows the stand-in.
 * Sub-routes such as /rfqs/:id are declared by the feature under the same key.
 */
const screens: Partial<Record<NavKey, ComponentType>> = {
  companies: lazy(() => import('@/features/companies/CompaniesScreen')),
}

/** Dev builds only: review page for the U03/U07/U08 primitives. U09's /dev/gallery replaces it. Dead code in production. */
const PrimitivesPreview = import.meta.env.DEV ? lazy(() => import('@/dev/PrimitivesPreview')) : null

function SignInRoute() {
  const session = useSession()
  const from = (useLocation().state as { from?: string } | null)?.from
  return session.status === 'signed-in' ? <Navigate to={from && from !== '/login' ? from : '/'} replace /> : <SignInPage />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<SignInRoute />} />
      {PrimitivesPreview ? (
        <Route
          path="/dev/primitives"
          element={
            <Suspense fallback={null}>
              <PrimitivesPreview />
            </Suspense>
          }
        />
      ) : null}
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route index element={<RoleLanding />} />
          <Route path="no-access" element={<NoAccessPage />} />
          {navItems.map(item => {
            const Screen = screens[item.key]
            return (
              <Route
                key={item.key}
                path={`${item.path.slice(1)}/*`}
                element={
                  <RequireRole item={item}>
                    {Screen ? (
                      <Suspense fallback={null}>
                        <Screen />
                      </Suspense>
                    ) : (
                      <DestinationPage navKey={item.key} />
                    )}
                  </RequireRole>
                }
              />
            )
          })}
          <Route path="*" element={<NotFoundPage />} />
        </Route>
      </Route>
    </Routes>
  )
}
