import type { ReactNode } from 'react'
import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { Building2, KeyRound, Receipt, RefreshCw, Target, User, Users, type LucideIcon } from 'lucide-react'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { useSession } from '@/app/session'
import { InstallBanner } from '@/features/settings/InstallBanner'
import { SettingsHomePage } from '@/features/settings/SettingsHomePage'
import { Icon } from '@/ui/Icon'
import { cn } from '@/lib/utils'
import { useScrollActiveIntoView } from '@/lib/useScrollActiveIntoView'

/*
 * Settings (A04, A06). Reached from the account menu, not the six main destinations. A left list on
 * tablet and desktop, a row of links above the page on a phone. Team, Targets and Expense categories are shown to admins only; the
 * company profile is shown to everyone (read-only unless admin).
 */
interface SettingsLink {
  to: string
  label: string
  icon: LucideIcon
  adminOnly?: boolean
  /** Shown at the right for everyone who is not an admin ("View only"). */
  tagForOthers?: string
}
const SETTINGS_LINKS: readonly SettingsLink[] = [
  { to: '/settings/team', label: 'Team', icon: Users, adminOnly: true },
  { to: '/settings/targets', label: 'Targets', icon: Target, adminOnly: true },
  { to: '/settings/categories', label: 'Expense categories', icon: Receipt, adminOnly: true },
  { to: '/settings/company', label: 'Company profile', icon: Building2, tagForOthers: 'View only' },
  { to: '/settings/details', label: 'Your details', icon: User },
  { to: '/settings/exchange-rates', label: 'Exchange rates', icon: RefreshCw },
  { to: '/settings/password', label: 'Change password', icon: KeyRound },
]

const useIsAdmin = () => {
  const s = useSession()
  return s.status === 'signed-in' && s.user.role === 'admin'
}

export function SettingsLayout() {
  const isAdmin = useIsAdmin()
  const links = SETTINGS_LINKS.filter(l => isAdmin || !l.adminOnly)
  const strip = useScrollActiveIntoView<HTMLUListElement>()
  return (
    <div className="grid min-h-full grid-cols-[minmax(0,1fr)] max-md:grid-rows-[auto_minmax(0,1fr)] md:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Settings" className="border-b bg-surface px-4 py-3 md:border-b-0 md:border-r md:px-3 md:py-6">
        <p className="mb-2 hidden px-3 text-xs font-semibold text-fg-muted md:block">Settings</p>
        <ul ref={strip} className="flex gap-1 overflow-x-auto md:grid md:gap-[2px] md:overflow-visible">
          {links.map(l => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-control items-center gap-2 whitespace-nowrap rounded px-3 text-sm font-medium max-md:h-touch',
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
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
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

/** /settings alone: an admin goes to Team; sales and engineers land on the Settings home. */
export function SettingsHome() {
  return useIsAdmin() ? <Navigate to="/settings/team" replace /> : <SettingsHomePage />
}

/** The Team screen is admin only. Anyone else sees the no-access page inside the shell, never the data (the function refuses them too). */
export function AdminOnly({ area, children }: { area: string; children: ReactNode }) {
  return useIsAdmin() ? <>{children}</> : <NoAccessPage area={area} />
}
