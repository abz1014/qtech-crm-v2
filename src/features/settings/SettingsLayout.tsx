import type { ReactNode } from 'react'
import { Navigate, NavLink, Outlet, useLocation } from 'react-router-dom'
import { Building2, ChevronRight, KeyRound, Receipt, RefreshCw, Target, User, Users, type LucideIcon } from 'lucide-react'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { useSession } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { InstallBanner } from '@/features/settings/InstallBanner'
import { SettingsHomePage } from '@/features/settings/SettingsHomePage'
import { Icon } from '@/ui/Icon'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'

/*
 * Settings (A04, A06). Reached from the account menu and from the search box ("Jump to"), not the five main destinations.
 * Two short groups (UX audit 2026-10-19): the company's settings, then yours. A left list on tablet and desktop. On a phone
 * /settings IS the list (no sideways-scrolling strip), and every page under it has the phone bar's back arrow to /settings
 * (Team sets its own bar, with its Add button). Team, Targets and Expense categories are shown to admins only; the company
 * profile is shown to everyone (read-only unless admin).
 */
interface SettingsLink {
  to: string
  label: string
  icon: LucideIcon
  adminOnly?: boolean
  /** Shown at the right for everyone who is not an admin ("View only"). */
  tagForOthers?: string
}
const GROUPS: readonly { title: string; links: readonly SettingsLink[] }[] = [
  {
    title: 'Company',
    links: [
      { to: '/settings/team', label: 'Team', icon: Users, adminOnly: true },
      { to: '/settings/company', label: 'Company profile', icon: Building2, tagForOthers: 'View only' },
      { to: '/settings/targets', label: 'Targets', icon: Target, adminOnly: true },
      { to: '/settings/categories', label: 'Expense categories', icon: Receipt, adminOnly: true },
      { to: '/settings/exchange-rates', label: 'Exchange rates', icon: RefreshCw },
    ],
  },
  {
    title: 'You',
    links: [
      { to: '/settings/details', label: 'Your details', icon: User },
      { to: '/settings/password', label: 'Change password', icon: KeyRound },
    ],
  },
]

const useIsAdmin = () => {
  const s = useSession()
  return s.status === 'signed-in' && s.user.role === 'admin'
}

const usePhone = () => useMediaQuery('(max-width: 767.98px)')

export function SettingsLayout() {
  const isAdmin = useIsAdmin()
  const { pathname } = useLocation()
  const atHome = pathname.replace(/\/+$/, '') === '/settings'
  const groups = GROUPS.map(g => ({ ...g, links: g.links.filter(l => isAdmin || !l.adminOnly) }))
  const current = groups.flatMap(g => g.links).find(l => pathname.startsWith(l.to))
  return (
    <div className="grid min-h-full grid-cols-[minmax(0,1fr)] max-md:grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)]">
      {/* Team sets its own phone bar; every other page under Settings gets the back arrow to the list. */}
      {!atHome && current && current.to !== '/settings/team' ? <BackToSettings title={current.label} /> : null}
      <nav aria-label="Settings" className={cn('bg-surface px-4 py-3 md:border-r md:px-3 md:py-6', atHome ? 'max-md:border-b' : 'max-md:hidden')}>
        <p className="mb-2 hidden px-3 text-sm font-semibold text-fg-muted md:block">Settings</p>
        {groups.map(g =>
          g.links.length ? (
            <div key={g.title} className="mb-3 grid gap-[2px]">
              <p className="px-3 pb-1 pt-2 text-sm font-medium text-fg-muted">{g.title}</p>
              <ul className="grid gap-[2px]">
                {g.links.map(l => (
                  <li key={l.to}>
                    <NavLink
                      to={l.to}
                      className={({ isActive }) =>
                        cn(
                          'relative flex h-control items-center gap-2 whitespace-nowrap rounded px-3 text-sm font-medium max-md:h-touch max-md:text-base',
                          isActive ? 'bg-selected text-fg' : 'text-fg-2 hover:bg-sunken hover:text-fg',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive ? (
                            <span aria-hidden="true" className="absolute bottom-[6px] left-0 top-[6px] w-[3px] rounded-r-[2px] bg-brand-green" />
                          ) : null}
                          <Icon icon={l.icon} className="text-fg-muted" />
                          {l.label}
                          {!isAdmin && l.tagForOthers ? (
                            <span className="ml-auto inline-flex h-5 items-center rounded bg-selected px-[6px] text-xs font-medium text-fg-2">
                              {l.tagForOthers}
                            </span>
                          ) : null}
                          <Icon icon={ChevronRight} size="sm" className={cn('text-fg-muted md:hidden', (isAdmin || !l.tagForOthers) && 'ml-auto')} />
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
      </nav>
      <div className="min-w-0 px-4 pb-12 pt-6 md:px-10 md:pb-12 md:pt-8">
        <div className="grid max-w-[940px] grid-cols-[minmax(0,1fr)] gap-6">
          <InstallBanner />
          <Outlet />
        </div>
      </div>
    </div>
  )
}

/** The phone bar's back arrow to the Settings list, with the page's name. */
function BackToSettings({ title }: { title: string }) {
  useMobileBar({ title, back: { to: '/settings', label: 'Settings' } })
  return null
}

/**
 * /settings alone. On a phone it is the list itself (the layout draws it), plus the Settings home for sales and engineers.
 * On a tablet or desktop an admin goes to Team, which the side list already offers; sales and engineers land on the home.
 */
export function SettingsHome() {
  const isAdmin = useIsAdmin()
  const phone = usePhone()
  if (isAdmin) return phone ? null : <Navigate to="/settings/team" replace />
  return <SettingsHomePage />
}

/** The Team screen is admin only. Anyone else sees the no-access page inside the shell, never the data (the function refuses them too). */
export function AdminOnly({ area, children }: { area: string; children: ReactNode }) {
  return useIsAdmin() ? <>{children}</> : <NoAccessPage area={area} />
}
