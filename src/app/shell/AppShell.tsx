import { lazy, Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { navItemForPath, type CountKey } from '@/app/navConfig'
import { useSession, type SessionUser } from '@/app/session'
import { ToastProvider } from '@/ui/Toast'
import { useSearchPaletteSource } from '@/features/search/paletteSource'
import { PaletteHost } from '@/app/palette/PaletteHost'
import { usePalette } from '@/app/palette/usePalette'
import { BottomTabs, MobileBar } from '@/app/shell/MobileChrome'
import { MobileBarProvider } from '@/app/shell/MobileBarProvider'
import { PwaPrompts } from '@/app/shell/PwaPrompts'
import { CaptureProvider } from '@/app/capture/CaptureProvider'
import { EngineerFab } from '@/app/shell/EngineerFab'
import { TopBar } from '@/app/shell/TopBar'
import type { NavCounts } from '@/app/shell/useNavCounts'
import { usePageSettled } from '@/app/usePageSettled'
import { markContentDrawn } from '@/lib/afterContent'
import { NavCountsContext } from '@/app/shell/navCountsContext'
import { useRouteFocus } from '@/app/shell/useRouteFocus'
import { HelpHost } from '@/features/help/HelpHost'

/*
 * The top bar's counts read the whole Today list (a dozen requests). They load, with the Today rules, once the page has its
 * data (perf/lcp). A failed download only means no numbers, never a broken shell.
 */
const NavCountsSource = lazy(() => import('@/app/shell/useNavCounts').catch(() => ({ default: () => null })))

interface AppShellProps {
  /** Counts beside the destinations. Today and RFQs are read from the shared cache; a value passed here wins. */
  counts?: Partial<Record<CountKey, number>>
}

/**
 * AppShell composite (INVENTORY section 2). A viewport-tall frame: top bar on
 * tablet and desktop, mobile bar plus bottom tab bar on phones, one scrolling
 * <main> between. A render error inside a page is caught here, so the
 * navigation stays usable and the person can move on.
 */
export function AppShell({ counts }: AppShellProps) {
  const session = useSession()
  if (session.status !== 'signed-in') return null
  return (
    <ToastProvider>
      <PwaPrompts />
      <CaptureProvider>
        <PaletteHost role={session.user.role} personId={session.user.id}>
          <MobileBarProvider>
            <Frame user={session.user} counts={counts} />
          </MobileBarProvider>
        </PaletteHost>
      </CaptureProvider>
    </ToastProvider>
  )
}

function Frame({ user, counts: given }: { user: SessionUser; counts?: Partial<Record<CountKey, number>> }) {
  const [nav, setNav] = useState<{ counts: NavCounts; ready: boolean }>({ counts: {}, ready: false })
  const settled = usePageSettled()
  const counts = { ...nav.counts, ...given }
  // One badge (redesign phase 0, plan section (c)): Today's. The other numbers still reach the pages (NavCountsContext).
  const badges = { today: counts.today }
  // ...and Money's red dot while an invoice is late (no number anywhere else)
  const dots = { money: nav.counts.moneyLate === true }
  useEffect(() => {
    if (settled) markContentDrawn()
  }, [settled])
  const palette = usePalette()
  useSearchPaletteSource()
  const { pathname } = useLocation()
  const active = navItemForPath(pathname)
  const inSettings = pathname === '/settings' || pathname.startsWith('/settings/')
  const title = active?.label ?? (inSettings ? 'Settings' : 'Q-Tech CRM')

  useRouteFocus(pathname, active?.label ?? (inSettings ? 'Settings' : null))

  return (
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto] bg-canvas">
      <a
        href="#main"
        className="sr-only rounded border bg-surface px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50"
      >
        Skip to content
      </a>
      <TopBar user={user} counts={badges} dots={dots} onSearch={palette.open} />
      <MobileBar user={user} title={title} onSearch={palette.open} />
      <main id="main" tabIndex={-1} className="min-h-0 overflow-y-auto focus:outline-none">
        <ErrorBoundary key={pathname} variant="inline">
          <NavCountsContext.Provider value={nav.ready ? counts : null}>
            <Outlet />
          </NavCountsContext.Provider>
        </ErrorBoundary>
      </main>
      <BottomTabs role={user.role} counts={badges} dots={dots} fab={user.role === 'engineer' ? <EngineerFab /> : undefined} />
      <HelpHost />
      {settled ? (
        <Suspense fallback={null}>
          <NavCountsSource user={user} onCounts={setNav} />
        </Suspense>
      ) : null}
    </div>
  )
}
