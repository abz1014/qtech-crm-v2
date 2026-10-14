import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { navItemForPath, type NavKey } from '@/app/navConfig'
import { useSession, type SessionUser } from '@/app/session'
import { ToastProvider } from '@/ui/Toast'
import { useCompaniesPaletteSource } from '@/features/companies/paletteSource'
import { useRfqsPaletteSource } from '@/features/rfqs/board/paletteSource'
import { PaletteHost } from '@/app/palette/PaletteHost'
import { usePalette } from '@/app/palette/usePalette'
import { BottomTabs, MobileBar } from '@/app/shell/MobileChrome'
import { TopBar } from '@/app/shell/TopBar'

interface AppShellProps {
  /** Counts beside the destinations. Supplied by the data layer in later tasks. */
  counts?: Partial<Record<NavKey, number>>
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
      <PaletteHost role={session.user.role}>
        <Frame user={session.user} counts={counts} />
      </PaletteHost>
    </ToastProvider>
  )
}

function Frame({ user, counts }: { user: SessionUser; counts?: Partial<Record<NavKey, number>> }) {
  const palette = usePalette()
  useCompaniesPaletteSource()
  useRfqsPaletteSource()
  const { pathname } = useLocation()
  const active = navItemForPath(pathname)
  const title = active?.label ?? 'Q-Tech CRM'

  useEffect(() => {
    document.title = active ? `${active.label} · Q-Tech CRM` : 'Q-Tech CRM'
  }, [active])

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] bg-canvas">
      <a
        href="#main"
        className="sr-only rounded border bg-surface px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50"
      >
        Skip to content
      </a>
      <TopBar user={user} counts={counts} onSearch={palette.open} />
      <MobileBar user={user} title={title} onSearch={palette.open} />
      <main id="main" tabIndex={-1} className="min-h-0 overflow-y-auto focus:outline-none">
        <ErrorBoundary key={pathname} variant="inline">
          <Outlet />
        </ErrorBoundary>
      </main>
      <BottomTabs role={user.role} />
    </div>
  )
}
