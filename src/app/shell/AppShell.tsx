import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { ErrorBoundary } from '@/app/ErrorBoundary'
import { navItemForPath, type NavKey } from '@/app/navConfig'
import { useSession } from '@/app/session'
import { BottomTabs, MobileBar } from '@/app/shell/MobileChrome'
import { TopBar } from '@/app/shell/TopBar'

interface AppShellProps {
  /** Counts beside the destinations. Supplied by the data layer in later tasks. */
  counts?: Partial<Record<NavKey, number>>
  /** Opens the command palette (U08). Also bound to Cmd+K / Ctrl+K when given. */
  onSearch?: () => void
}

/**
 * AppShell composite (INVENTORY section 2). A viewport-tall frame: top bar on
 * tablet and desktop, mobile bar plus bottom tab bar on phones, one scrolling
 * <main> between. A render error inside a page is caught here, so the
 * navigation stays usable and the person can move on.
 */
export function AppShell({ counts, onSearch }: AppShellProps) {
  const session = useSession()
  const { pathname } = useLocation()
  const active = navItemForPath(pathname)
  const title = active?.label ?? 'Q-Tech CRM'

  useEffect(() => {
    document.title = active ? `${active.label} · Q-Tech CRM` : 'Q-Tech CRM'
  }, [active])

  useEffect(() => {
    if (!onSearch) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onSearch()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onSearch])

  if (session.status !== 'signed-in') return null
  const { user } = session

  return (
    <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto] bg-canvas">
      <a
        href="#main"
        className="sr-only rounded border bg-surface px-3 py-2 text-sm font-medium focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-50"
      >
        Skip to content
      </a>
      <TopBar user={user} counts={counts} onSearch={onSearch} />
      <MobileBar user={user} title={title} onSearch={onSearch} />
      <main id="main" tabIndex={-1} className="min-h-0 overflow-y-auto focus:outline-none">
        <ErrorBoundary key={pathname} variant="inline">
          <Outlet />
        </ErrorBoundary>
      </main>
      <BottomTabs role={user.role} />
    </div>
  )
}
