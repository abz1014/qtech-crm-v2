import { Suspense, useEffect, useRef, type ComponentType } from 'react'
import { lazyWithReload as lazy } from '@/lib/importWithReload'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { RequireRole, RequireSession, RoleLanding } from '@/app/guards'
import { navItems, type NavKey } from '@/app/navConfig'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { useSession } from '@/app/session'
import { AdminOnly, SettingsHome, SettingsLayout } from '@/features/settings/SettingsLayout'
import { AppShell } from '@/app/shell/AppShell'
import { preloadRouteCode, routeChunks } from '@/app/routeChunks'

// Lazy: the sign-in form brings zod, react-hook-form and its resolvers, which nothing else on first paint needs (perf/client).
const SignInPage = lazy(() => routeChunks.signIn().then(m => ({ default: m.SignInPage })))

/**
 * One lazy-loaded screen per destination (a total map: a new nav key does not compile without its screen).
 * Sub-routes such as /rfqs/:id are declared by the feature under the same key.
 */
const screens: Record<NavKey, ComponentType> = {
  today: lazy(routeChunks.today),
  companies: lazy(routeChunks.companies),
  rfqs: lazy(routeChunks.rfqs),
  money: lazy(routeChunks.money),
  orders: lazy(routeChunks.orders),
}

const TeamPage = lazy(() => import('@/features/settings/TeamPage').then(m => ({ default: m.TeamPage })))
const ExchangeRatesPage = lazy(() => import('@/features/fx/ExchangeRatesPage').then(m => ({ default: m.ExchangeRatesPage })))
const TargetsPage = lazy(() => import('@/features/settings/TargetsPage').then(m => ({ default: m.TargetsPage })))
const CategoriesPage = lazy(() => import('@/features/settings/CategoriesPage').then(m => ({ default: m.CategoriesPage })))
const ChangePasswordPage = lazy(() => import('@/features/settings/ChangePasswordPage').then(m => ({ default: m.ChangePasswordPage })))
const MyDetailsPage = lazy(() => import('@/features/settings/MyDetailsPage').then(m => ({ default: m.MyDetailsPage })))
const CompanyProfilePage = lazy(() => import('@/features/settings/CompanyProfilePage').then(m => ({ default: m.CompanyProfilePage })))
/** New RFQ (R05): its own route, so it works under whichever screen owns the rest of /rfqs. */
const IntakeScreen = lazy(routeChunks.rfqNew)
/** The Android share target and sign-in return point (R22): opens the Capture sheet. */
const CaptureRoute = lazy(() => import('@/features/capture/CaptureRoute'))
const rfqsItem = navItems.find(i => i.key === 'rfqs')
const moneyItem = navItems.find(i => i.key === 'money')

/**
 * `/reports` was a destination of its own until the 2026-10-19 owner decision (five tabs). Reports now live inside Money,
 * so an old link, a bookmark or the palette lands on Money's Reports view with its query string kept. Engineers get the
 * no-access page, as before.
 */
function ReportsRedirect() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/money/reports', search }} replace />
}

/** Dev builds only: the component gallery (U09). Dead code in production. */
const Gallery = import.meta.env.DEV ? lazy(() => import('@/dev/gallery/Gallery')) : null
/** Dev builds only: reads a picture with the on-device OCR (e2e/docread). Dead code in production. */
const DocreadLab = import.meta.env.DEV ? lazy(() => import('@/dev/docread/DocreadLab')) : null

function SignInRoute() {
  const session = useSession()
  const from = (useLocation().state as { from?: string } | null)?.from
  return session.status === 'signed-in' ? <Navigate to={from && from !== '/login' ? from : '/'} replace /> : (
    <Suspense fallback={null}>
      <SignInPage />
    </Suspense>
  )
}

/**
 * An in-app navigation fetches the new page's code all at once (its screen and its page together) instead of the screen first
 * and the page after it (perf/lcp). The first address is handled at start-up (main.tsx).
 */
function PreloadOnNavigate() {
  const { pathname } = useLocation()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    preloadRouteCode(pathname)
  }, [pathname])
  return null
}

export function AppRoutes() {
  return (
    <>
      <PreloadOnNavigate />
      <AppRouteTable />
    </>
  )
}

function AppRouteTable() {
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
      {DocreadLab ? (
        <Route
          path="/dev/docread"
          element={
            <Suspense fallback={null}>
              <DocreadLab />
            </Suspense>
          }
        />
      ) : null}
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route index element={<RoleLanding />} />
          <Route path="no-access" element={<NoAccessPage />} />
          <Route
            path="capture"
            element={
              <Suspense fallback={null}>
                <CaptureRoute />
              </Suspense>
            }
          />
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
              path="details"
              element={
                <Suspense fallback={null}>
                  <MyDetailsPage />
                </Suspense>
              }
            />
            <Route
              path="exchange-rates"
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
          {moneyItem ? (
            <Route
              path="reports/*"
              element={
                <RequireRole item={moneyItem}>
                  <ReportsRedirect />
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
                    <Suspense fallback={null}>
                      <Screen />
                    </Suspense>
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
