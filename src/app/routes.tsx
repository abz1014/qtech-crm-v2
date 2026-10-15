import { lazy, Suspense, type ComponentType } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { RequireRole, RequireSession, RoleLanding } from '@/app/guards'
import { navItems, type NavKey } from '@/app/navConfig'
import { DestinationPage } from '@/app/pages/DestinationPage'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { SignInPage } from '@/app/pages/SignInPage'
import { useSession } from '@/app/session'
import { AdminOnly, SettingsHome, SettingsLayout } from '@/features/settings/SettingsLayout'
import { AppShell } from '@/app/shell/AppShell'

/**
 * Screens plug in here, one per destination. A feature task replaces its entry
 * (a lazy-loaded page component); until then the destination shows the stand-in.
 * Sub-routes such as /rfqs/:id are declared by the feature under the same key.
 */
const screens: Partial<Record<NavKey, ComponentType>> = {
  today: lazy(() => import('@/features/today/TodayScreen')),
  companies: lazy(() => import('@/features/companies/CompaniesScreen')),
  rfqs: lazy(() => import('@/features/rfqs/board/RfqsScreen')),
}

const TeamPage = lazy(() => import('@/features/settings/TeamPage').then(m => ({ default: m.TeamPage })))
const TargetsPage = lazy(() => import('@/features/settings/TargetsPage').then(m => ({ default: m.TargetsPage })))
const CategoriesPage = lazy(() => import('@/features/settings/CategoriesPage').then(m => ({ default: m.CategoriesPage })))
const ChangePasswordPage = lazy(() => import('@/features/settings/ChangePasswordPage').then(m => ({ default: m.ChangePasswordPage })))
const ExchangeRatesPage = lazy(() => import('@/features/settings/ExchangeRatesPage').then(m => ({ default: m.ExchangeRatesPage })))
const CompanyProfilePage = lazy(() => import('@/features/settings/CompanyProfilePage').then(m => ({ default: m.CompanyProfilePage })))
/** New RFQ (R05): its own route, so it works under whichever screen owns the rest of /rfqs. */
const IntakeScreen = lazy(() => import('@/features/rfqs/IntakeScreen'))
const rfqsItem = navItems.find(i => i.key === 'rfqs')

/** Dev builds only: the component gallery (U09). Dead code in production. */
const Gallery = import.meta.env.DEV ? lazy(() => import('@/dev/gallery/Gallery')) : null

function SignInRoute() {
  const session = useSession()
  const from = (useLocation().state as { from?: string } | null)?.from
  return session.status === 'signed-in' ? <Navigate to={from && from !== '/login' ? from : '/'} replace /> : <SignInPage />
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<SignInRoute />} />
      {Gallery ? (
        <Route
          path="/dev/gallery"
          element={
            <Suspense fallback={null}>
              <Gallery />
            </Suspense>
          }
        />
      ) : null}
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route index element={<RoleLanding />} />
          <Route path="no-access" element={<NoAccessPage />} />
          <Route path="settings" element={<SettingsLayout />}>
            <Route index element={<SettingsHome />} />
            <Route
              path="team"
              element={
                <AdminOnly area="Team">
                  <Suspense fallback={null}>
                    <TeamPage />
                  </Suspense>
                </AdminOnly>
              }
            />
            <Route
              path="targets"
              element={
                <AdminOnly area="Targets">
                  <Suspense fallback={null}>
                    <TargetsPage />
                  </Suspense>
                </AdminOnly>
              }
            />
            <Route
              path="categories"
              element={
                <AdminOnly area="Expense categories">
                  <Suspense fallback={null}>
                    <CategoriesPage />
                  </Suspense>
                </AdminOnly>
              }
            />
            <Route
              path="company"
              element={
                <Suspense fallback={null}>
                  <CompanyProfilePage />
                </Suspense>
              }
            />
            <Route
              path="rates"
              element={
                <Suspense fallback={null}>
                  <ExchangeRatesPage />
                </Suspense>
              }
            />
            <Route
              path="password"
              element={
                <Suspense fallback={null}>
                  <ChangePasswordPage />
                </Suspense>
              }
            />
            <Route path="*" element={<NotFoundPage />} />
          </Route>
          {rfqsItem ? (
            <Route
              path="rfqs/new"
              element={
                <RequireRole item={rfqsItem}>
                  <Suspense fallback={null}>
                    <IntakeScreen />
                  </Suspense>
                </RequireRole>
              }
            />
          ) : null}
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
