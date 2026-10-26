import { Suspense, useEffect, useRef, type ComponentType } from 'react'
import { lazyWithReload as lazy } from '@/lib/importWithReload'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { RequireRole, RequireSession, RoleLanding } from '@/app/guards'
import { Briefcase } from 'lucide-react'
import { navItems, type NavItem, type NavKey } from '@/app/navConfig'
import { OldAddress } from '@/app/oldAddresses'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { useSession } from '@/app/session'
import { AdminOnly, PricesOnly } from '@/features/settings/settingsGuards'
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
  jobs: lazy(routeChunks.jobs),
  companies: lazy(routeChunks.companies),
  money: lazy(routeChunks.money),
}

/**
 * The old RFQ board and Orders list: no longer destinations (Jobs holds both). /rfqs and /orders open Jobs; an id opens its Job;
 * ?old=1 keeps the old page for two weeks (src/app/oldAddresses.tsx).
 */
const OldRfqs = lazy(routeChunks.rfqs)
const OldOrders = lazy(routeChunks.orders)

/** The weekly owner review (redesign phase 3): /todo/review, admin only. */
// Settings' list and home are not on the first screen (perf/trim).
const SettingsLayout = lazy(() => import('@/features/settings/SettingsLayout').then(m => ({ default: m.SettingsLayout })))
const SettingsHome = lazy(() => import('@/features/settings/SettingsLayout').then(m => ({ default: m.SettingsHome })))
const ReviewPage = lazy(() => import('@/features/today/ReviewPage'))
const TeamPage = lazy(() => import('@/features/settings/TeamPage').then(m => ({ default: m.TeamPage })))
const ExchangeRatesPage = lazy(() => import('@/features/fx/ExchangeRatesPage').then(m => ({ default: m.ExchangeRatesPage })))
const TargetsPage = lazy(() => import('@/features/settings/TargetsPage').then(m => ({ default: m.TargetsPage })))
const ProductCategoriesPage = lazy(() => import('@/features/settings/productCategories/ProductCategoriesPage').then(m => ({ default: m.ProductCategoriesPage })))
const CategoriesPage = lazy(() => import('@/features/settings/CategoriesPage').then(m => ({ default: m.CategoriesPage })))
const ChangePasswordPage = lazy(() => import('@/features/settings/ChangePasswordPage').then(m => ({ default: m.ChangePasswordPage })))
const MyDetailsPage = lazy(() => import('@/features/settings/MyDetailsPage').then(m => ({ default: m.MyDetailsPage })))
const CompanyProfilePage = lazy(() => import('@/features/settings/CompanyProfilePage').then(m => ({ default: m.CompanyProfilePage })))
/** New RFQ (R05): its own route, so it works under whichever screen owns the rest of /rfqs. */
const IntakeScreen = lazy(routeChunks.rfqNew)
/** 0087: an engineer's "I paid" (their own expense claims). The page itself refuses anyone but an engineer. */
const MyClaimsPage = lazy(() => import('@/features/money/expenses/MyClaimsPage').then(m => ({ default: m.MyClaimsPage })))
/** The Android share target and sign-in return point (R22): opens the Capture sheet. */
const CaptureRoute = lazy(() => import('@/features/capture/CaptureRoute'))
/** New enquiry (P4-A): the document beside what was read; wraps the intake. */
const NewEnquiryPage = lazy(() => import('@/features/enquiry/NewEnquiryPage'))
/** The old pages keep the access they had: every staff role. */
const oldItem = (label: string, path: string): NavItem => ({ key: 'jobs', label, path, icon: Briefcase, roles: ['admin', 'sales', 'engineer'] })
const rfqsItem = oldItem('RFQs', '/rfqs')
const ordersItem = oldItem('Orders', '/orders')
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

/** `/today` was the home screen until redesign phase 3 (To do). Its query string is kept. */
function TodayRedirect() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/todo', search }} replace />
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
  const { pathname, search } = useLocation()
  const first = useRef(true)
  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    preloadRouteCode(pathname, search)
  }, [pathname, search])
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
            path="todo/review"
            element={
              <AdminOnly area="Weekly review">
                <Suspense fallback={null}>
                  <ReviewPage />
                </Suspense>
              </AdminOnly>
            }
          />
          {/* Today became To do (redesign phase 3): an old link, bookmark or installed shortcut lands on /todo. */}
          <Route path="today/*" element={<TodayRedirect />} />
          <Route
            path="my-expenses"
            element={
              <Suspense fallback={null}>
                <MyClaimsPage />
              </Suspense>
            }
          />
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
              path="product-categories"
              element={
                <AdminOnly area="Product categories">
                  <Suspense fallback={null}>
                    <ProductCategoriesPage />
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
          <Route
            path="enquiries/new"
            element={
              <RequireRole item={rfqsItem}>
                <Suspense fallback={null}>
                  <NewEnquiryPage />
                </Suspense>
              </RequireRole>
            }
          />
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
          <Route
            path="rfqs/*"
            element={
              <RequireRole item={rfqsItem}>
                <OldAddress kind="rfq">
                  <Suspense fallback={null}>
                    <OldRfqs />
                  </Suspense>
                </OldAddress>
              </RequireRole>
            }
          />
          <Route
            path="orders/*"
            element={
              <RequireRole item={ordersItem}>
                <OldAddress kind="order">
                  <Suspense fallback={null}>
                    <OldOrders />
                  </Suspense>
                </OldAddress>
              </RequireRole>
            }
          />
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
            // Companies is not in an engineer's menu (To do and Jobs only) but the page stays open to them: they add and edit
            // customers and suppliers from a job, and every link to a company works (DECISIONS section 10).
            const guard = item.key === 'companies' ? { ...item, roles: ['admin', 'sales', 'engineer'] as const } : item
            return (
              <Route
                key={item.key}
                path={`${item.path.slice(1)}/*`}
                element={
                  <RequireRole item={guard}>
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
