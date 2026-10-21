import { Suspense, type ComponentType } from 'react'
import { lazyWithReload as lazy } from '@/lib/importWithReload'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { RequireRole, RequireSession, RoleLanding } from '@/app/guards'
import { navItems, type NavKey } from '@/app/navConfig'
import { DestinationPage } from '@/app/pages/DestinationPage'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { useSession } from '@/app/session'
import { AdminOnly, PricesOnly, SettingsHome, SettingsLayout } from '@/features/settings/SettingsLayout'
import { AppShell } from '@/app/shell/AppShell'

// Lazy: the sign-in form brings zod, react-hook-form and its resolvers, which nothing else on first paint needs (perf/client).
const SignInPage = lazy(() => import('@/app/pages/SignInPage').then(m => ({ default: m.SignInPage })))

/**
 * Screens plug in here, one per destination. A feature task replaces its entry
 * (a lazy-loaded page component); until then the destination shows the stand-in.
 * Sub-routes such as /rfqs/:id are declared by the feature under the same key.
 */
const screens: Partial<Record<NavKey, ComponentType>> = {
  today: lazy(() => import('@/features/today/TodayScreen')),
  companies: lazy(() => import('@/features/companies/CompaniesScreen')),
  rfqs: lazy(() => import('@/features/rfqs/board/RfqsScreen')),
  money: lazy(() => import('@/features/money/MoneyScreen')),
  orders: lazy(() => import('@/features/orders/OrdersScreen')),
}

const TeamPage = lazy(() => import('@/features/settings/TeamPage').then(m => ({ default: m.TeamPage })))
const ExchangeRatesPage = lazy(() => import('@/features/fx/ExchangeRatesPage').then(m => ({ default: m.ExchangeRatesPage })))
const TargetsPage = lazy(() => import('@/features/settings/TargetsPage').then(m => ({ default: m.TargetsPage })))
const CategoriesPage = lazy(() => import('@/features/settings/CategoriesPage').then(m => ({ default: m.CategoriesPage })))
const ChangePasswordPage = lazy(() => import('@/features/settings/ChangePasswordPage').then(m => ({ default: m.ChangePasswordPage })))
const MyDetailsPage = lazy(() => import('@/features/settings/MyDetailsPage').then(m => ({ default: m.MyDetailsPage })))
const CompanyProfilePage = lazy(() => import('@/features/settings/CompanyProfilePage').then(m => ({ default: m.CompanyProfilePage })))
/** New RFQ (R05): its own route, so it works under whichever screen owns the rest of /rfqs. */
const IntakeScreen = lazy(() => import('@/features/rfqs/IntakeScreen'))
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
                <PricesOnly area="Exchange rates">
                  <Suspense fallback={null}>
                    <ExchangeRatesPage />
                  </Suspense>
                </PricesOnly>
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
