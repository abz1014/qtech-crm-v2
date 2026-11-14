import { Suspense } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { useSession } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { VersionLabel } from '@/app/shell/VersionLabel'
import { InstallBanner } from '@/features/settings/InstallBanner'
import { canOpenSettingsLink, SETTINGS_GROUPS } from '@/features/settings/settingsLinks'
import { CARD } from '@/ui/card'
import { Icon } from '@/ui/Icon'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { lazyWithReload } from '@/lib/importWithReload'
import { NoPrimary } from '@/ui/NoPrimary'

// The Settings home (its rates table, DataTable and the RFQ rate queries) is a lazy chunk: none of it is on the first screen (perf/trim).
const SettingsHomePage = lazyWithReload(() => import('@/features/settings/SettingsHomePage').then(m => ({ default: m.SettingsHomePage })))

/*
 * Settings (A04, A06). Reached from the account menu, not the five main destinations (the search box's "Jump to" entries for
 * Settings are the shell's to add).
 * Two short groups (UX audit 2026-10-19): the company's settings, then yours. A left list on tablet and desktop. On a phone
 * /settings IS the list (no sideways-scrolling strip), and every page under it has the phone bar's back arrow to /settings
 * (Team sets its own bar, with its Add button). Team, Targets and Expense categories are shown to admins only; the company
 * profile is shown to everyone (read-only unless admin).
 */
// The pages and their two groups live in settingsLinks.ts, shared with the command palette's Jump to.


const useIsAdmin = () => {
  const s = useSession()
  return s.status === 'signed-in' && s.user.role === 'admin'
}

const usePhone = () => useMediaQuery('(max-width: 767.98px)')

export function SettingsLayout() {
  const isAdmin = useIsAdmin()
  const session = useSession()
  const role = session.status === 'signed-in' ? session.user.role : null
  const { pathname } = useLocation()
  const atHome = pathname.replace(/\/+$/, '') === '/settings'
  const groups = SETTINGS_GROUPS.map(g => ({ ...g, links: g.links.filter(l => canOpenSettingsLink(l, role)) }))
  const current = groups.flatMap(g => g.links).find(l => pathname.startsWith(l.to))
  return (
    <div className="mx-auto grid w-full max-w-table grid-cols-[minmax(0,1fr)] content-start gap-card-gap px-4 pb-12 pt-4 md:grid-cols-[19rem_minmax(0,1fr)] md:px-8 md:pt-6">
      <NoPrimary />
      {/* Team sets its own phone bar; every other page under Settings gets the back arrow to the list. */}
      {!atHome && current && current.to !== '/settings/team' ? <BackToSettings title={current.label} /> : null}
      {/* Mockup 75: the list is a Forest card on the canvas, beside the page from 768. */}
      <nav aria-label="Settings" className={cn(CARD, 'min-w-0 self-start px-3 py-3 md:py-4', !atHome && 'max-md:hidden')}>
        <p className="hidden px-3 pb-1 type-section md:block">Settings</p>
        {groups.map(g =>
          g.links.length ? (
            <div key={g.title} className="grid gap-px pb-2">
              <p className="px-3 pb-1 pt-2 text-sm font-medium text-fg-muted">{g.title}</p>
              <ul className="grid min-w-0 gap-px">
                {g.links.map(l => (
                  <li key={l.to} className="min-w-0">
                    <NavLink
                      to={l.to}
                      className={({ isActive }) =>
                        cn(
                          'flex h-control min-w-0 items-center gap-3 whitespace-nowrap rounded-control px-3 text-base font-medium transition-colors duration-fast max-md:h-touch',
                          isActive ? 'bg-brand-100 font-card text-primary' : 'text-fg hover:bg-sunken',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          <Icon icon={l.icon} className={cn('shrink-0', isActive ? 'text-primary' : 'text-fg-2')} />
                          <span className="min-w-0 truncate">{l.label}</span>
                          {!isAdmin && l.tagForOthers ? (
                            <span className="ml-auto inline-flex min-h-chip shrink-0 items-center rounded-pill bg-deep px-2 text-sm font-medium text-fg-2">
                              {l.tagForOthers}
                            </span>
                          ) : null}
                          <Icon icon={ChevronRight} size="sm" className={cn('shrink-0 text-fg-muted md:hidden', (isAdmin || !l.tagForOthers) && 'ml-auto')} />
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
        <div className="mx-3 border-t [&>div]:px-0">
          <VersionLabel />
        </div>
      </nav>
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-card-gap">
        <InstallBanner />
        <Outlet />
      </div>
    </div>
  )
}

/** The phone bar's back arrow to the Settings list, with the page's name. */
function BackToSettings({ title }: { title: string }) {
  useMobileBar({ title, back: '/settings' })
  return null
}

/**
 * /settings alone. On a phone it is the list itself (the layout draws it), plus the Settings home for sales and engineers.
 * On a tablet or desktop an admin goes to Team, which the side list already offers; sales and engineers land on the home.
 */
export function SettingsHome() {
  const isAdmin = useIsAdmin()
  const phone = usePhone()
  // the list is the page on a phone, for every role (the rates were drawn under it, as a second page, and each has its own link in the
  // list): it still needs the page's one level-one heading
  if (phone) return <h1 className="sr-only">Settings</h1>
  if (isAdmin) return <Navigate to="/settings/team" replace />
  return (
    <Suspense fallback={null}>
      <SettingsHomePage />
    </Suspense>
  )
}

export { AdminOnly, PricesOnly } from '@/features/settings/settingsGuards'
