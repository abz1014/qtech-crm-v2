/*
 * Every lazily loaded screen and page, in one place (perf/lcp). The route table (routes.tsx) and each screen's own sub-routes
 * load their pages through these functions, and preloadRoute() starts the same downloads the moment the app starts, from
 * the address alone: a signed-in phone fetches the page it opens on while the session is still being confirmed, instead of
 * after it (Lighthouse, Slow 4G: the page's code used to wait for the session lookup, one more round trip and its whole
 * download). A list and its record page are separate downloads, so a list does not bring every dialog of the record page.
 *
 * Pages are only ever reached through `import()` here, so this module adds no page code to the first load.
 */
import type { QueryClient } from '@tanstack/react-query'
import { setFirstPage } from '@/app/firstPage'
import type { SessionUser } from '@/app/session'
import { queryClient } from '@/lib/queryClient'
import { readRememberedUser } from '@/lib/storedSession'
import { getSupabase } from '@/lib/supabase'

export const routeChunks = {
  signIn: () => import('@/app/pages/SignInPage'),
  today: () => import('@/features/today/TodayScreen'),
  companies: () => import('@/features/companies/CompaniesScreen'),
  companiesList: () => import('@/features/companies/CompaniesPage'),
  company: () => import('@/features/companies/CompanyPage'),
  rfqs: () => import('@/features/rfqs/board/RfqsScreen'),
  rfqsBoard: () => import('@/features/rfqs/board/BoardPage'),
  rfq: () => import('@/features/rfqs/RfqDetailScreen'),
  rfqNew: () => import('@/features/rfqs/IntakeScreen'),
  orders: () => import('@/features/orders/OrdersScreen'),
  ordersList: () => import('@/features/orders/OrdersListPage'),
  order: () => import('@/features/orders/OrderDetailScreen'),
  jobs: () => import('@/features/jobs/JobsScreen'),
  jobsList: () => import('@/features/jobs/JobsListPage'),
  job: () => import('@/features/jobs/JobPage'),
  money: () => import('@/features/money/MoneyScreen'),
  moneyReceivables: () => import('@/features/money/payments/ReceivablesPage'),
  moneyGst: () => import('@/features/money/invoices/GstRegisterPage'),
  moneyExpenses: () => import('@/features/money/expenses/ExpensesPage'),
  moneyChecklist: () => import('@/features/money/monthEnd/ChecklistPage'),
  moneyBank: () => import('@/features/money/bank/BankTickPage'),
  moneyReportPages: () => import('@/features/money/monthEnd/ReportPages'),
  moneyExceptions: () => import('@/features/money/exceptions/ExceptionsPage'),
  moneyMargins: () => import('@/features/money/margins/MarginsPage'),
  moneyInOut: () => import('@/features/money/inOut/InOutPage'),
  moneyReports: () => import('@/features/reports/ReportsPage'),
} as const

type ChunkKey = keyof typeof routeChunks

/**
 * The downloads a first visit to `pathname` needs, outermost first: exactly the pages routes.tsx and each screen's own routes
 * draw for that address (an address no page owns gets only its screen, which draws Not found, and no data is read ahead).
 */
export function chunksForPath(pathname: string): ChunkKey[] {
  const parts = pathname.split('/').filter(Boolean)
  const [top, sub, third] = parts
  const n = parts.length
  switch (top) {
    case 'login':
      return n === 1 ? ['signIn'] : []
    case 'today':
      return ['today']
    case 'rfqs':
      if (n === 1) return ['rfqs', 'rfqsBoard']
      if (n === 2) return sub === 'new' ? ['rfqNew'] : ['rfqs', 'rfq']
      return ['rfqs']
    case 'orders':
      return n === 1 ? ['orders', 'ordersList'] : n === 2 ? ['orders', 'order'] : ['orders']
    case 'jobs':
      return n === 1 ? ['jobs', 'jobsList'] : n === 2 ? ['jobs', 'job'] : ['jobs']
    case 'companies':
      return n === 1 ? ['companies', 'companiesList'] : n === 2 ? ['companies', 'company'] : ['companies']
    case 'money':
      if (n === 1) return ['money', 'moneyReceivables'] // /money opens Who owes us
      if (n === 2) {
        const page: Partial<Record<string, ChunkKey>> = {
          receivables: 'moneyReceivables',
          'gst-register': 'moneyGst',
          expenses: 'moneyExpenses',
          'month-end': 'moneyChecklist',
          margins: 'moneyMargins',
          exceptions: 'moneyExceptions',
          reports: 'moneyReports',
        }
        const key = sub ? page[sub] : undefined
        return key ? ['money', key] : ['money']
      }
      if (n === 3 && sub === 'month-end') return ['money', third === 'bank' ? 'moneyBank' : 'moneyReportPages']
      if (n === 3 && sub === 'reports') return ['money', third === 'in-out' ? 'moneyInOut' : third === 'enquiries' ? 'moneyReports' : 'moneyReportPages']
      return ['money']
    default:
      return []
  }
}

/** Start downloading the pages an in-app navigation to `pathname` needs, all at once instead of one after the other. */
export function preloadRouteCode(pathname: string): void {
  for (const key of chunksForPath(pathname)) void routeChunks[key]().catch(() => {})
}

/**
 * What a page module may export to start its first reads before it is drawn: the same query keys and functions its hooks use
 * (so the hooks find the data, or the request already on its way, and never ask twice). `id` is the record id of a record page.
 */
export interface PrefetchContext {
  client: QueryClient
  user: SessionUser
  id: string | undefined
}
export type Prefetch = (ctx: PrefetchContext) => Promise<unknown>

/**
 * A page's first reads, in a module of their own (the query keys and functions only, no screen code), so they are downloaded
 * and started while the page's own, larger download is still on its way.
 */
const routePrefetch: Partial<Record<ChunkKey, () => Promise<{ prefetch: Prefetch }>>> = {
  today: () => import('@/features/today/prefetch'),
  rfqsBoard: () => import('@/features/rfqs/board/prefetch'),
  rfq: () => import('@/features/rfqs/prefetch'),
  ordersList: () => import('@/features/orders/prefetch').then(m => ({ prefetch: m.prefetchList })),
  order: () => import('@/features/orders/prefetch').then(m => ({ prefetch: m.prefetchOrder })),
  jobsList: () => import('@/features/jobs/prefetch').then(m => ({ prefetch: m.prefetchList })),
  job: () => import('@/features/jobs/prefetch').then(m => ({ prefetch: m.prefetchJob })),
  companiesList: () => import('@/features/companies/prefetch'),
  moneyReceivables: () => import('@/features/money/payments/prefetch'),
}

/** The longest the extras (the top bar's counts, Money's tab counts) wait for the first page before they load anyway. */
const FIRST_PAGE_WAIT_MS = 4_000

/**
 * Start downloading the page at `pathname` now, and its first data as soon as the session token is known. A person this device
 * does not keep signed in lands on the sign-in form whatever the address, so only that is fetched for them.
 *
 * The data is read only for the person whose session this device keeps (the remembered person, src/lib/storedSession.ts, must
 * be the same account) and only once Auth reports that session live, so nothing is ever read with the anonymous key. It does not
 * draw anything: the shell still waits for the session lookup (AuthProvider) as before, and Row Level Security still decides
 * what comes back. A sign-out or deactivation empties the cache as before.
 *
 * Returns whether a page is being fetched ahead. Failures are ignored here: the route table's own import (with its retry and reload, importWithReload.ts) and the page's own
 * hooks report them when the page is really drawn.
 */
export function preloadRoute(pathname: string, sessionUserId: string | null): boolean {
  if (!sessionUserId) {
    void routeChunks.signIn().catch(() => {})
    return false
  }
  const keys = chunksForPath(pathname).filter(k => k !== 'signIn')
  if (keys.length === 0) return false
  // The small reads module is asked for first, so its requests go out while the page's larger code is still downloading.
  const reads = routePrefetch[keys[keys.length - 1]]
  const readsModule = reads?.()
  const code = Promise.all(keys.map(key => routeChunks[key]().catch(() => null)))
  const user = readRememberedUser()
  const id = pathname.split('/').filter(Boolean)[1]
  const data = readsModule
    ? readsModule
        .then(async ({ prefetch }) => {
          const supabase = getSupabase()
          if (!supabase || !user || user.id !== sessionUserId || !navigator.onLine) return
          const { data: auth } = await supabase.auth.getSession()
          if (auth.session?.user.id !== user.id) return
          await prefetch({ client: queryClient, user, id })
        })
        .catch(() => {})
    : Promise.resolve()
  const done = Promise.all([code, data]).then(() => {})
  setFirstPage(Promise.race([done, new Promise<void>(resolve => window.setTimeout(resolve, FIRST_PAGE_WAIT_MS))]))
  return true
}
