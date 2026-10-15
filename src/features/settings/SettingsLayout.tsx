import type { ReactNode } from 'react'
import { Navigate, NavLink, Outlet } from 'react-router-dom'
import { Building2, KeyRound, Users, type LucideIcon } from 'lucide-react'
import { NoAccessPage } from '@/app/pages/NoAccessPage'
import { useSession } from '@/app/session'
import { InstallBanner } from '@/features/settings/InstallBanner'
import { Icon } from '@/ui/Icon'
import { cn } from '@/lib/utils'

/*
 * Settings (A04, A06). Reached from the account menu, not the six main destinations. A left list on
 * tablet and desktop, a row of links above the page on a phone. Team is shown to admins only; the
 * company profile is shown to everyone (read-only unless admin).
 */
interface SettingsLink {
  to: string
  label: string
  icon: LucideIcon
  adminOnly?: boolean
}
const SETTINGS_LINKS: readonly SettingsLink[] = [
  { to: '/settings/team', label: 'Team', icon: Users, adminOnly: true },
  { to: '/settings/company', label: 'Company profile', icon: Building2 },
  { to: '/settings/password', label: 'Change password', icon: KeyRound },
]

const useIsAdmin = () => {
  const s = useSession()
  return s.status === 'signed-in' && s.user.role === 'admin'
}

export function SettingsLayout() {
  const isAdmin = useIsAdmin()
  const links = SETTINGS_LINKS.filter(l => isAdmin || !l.adminOnly)
  return (
    <div className="grid min-h-full md:grid-cols-[200px_minmax(0,1fr)]">
      <nav aria-label="Settings" className="border-b bg-canvas px-4 py-3 md:border-b-0 md:border-r md:px-3 md:py-6">
        <p className="mb-2 hidden px-3 text-xs font-medium text-fg-muted md:block">Settings</p>
        <ul className="flex gap-1 md:grid">
          {links.map(l => (
            <li key={l.to}>
              <NavLink
                to={l.to}
                className={({ isActive }) =>
                  cn(
                    'relative flex h-control items-center gap-2 rounded px-3 text-sm max-md:h-touch',
                    isActive ? 'bg-selected font-medium text-fg' : 'text-fg-2 hover:bg-sunken',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    {isActive ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] rounded-l bg-brand-green" /> : null}
                    <Icon icon={l.icon} className="text-fg-muted" />
                    {l.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="min-w-0 px-4 pb-12 pt-6 md:px-8">
        <div className="mx-auto max-w-table">
          <InstallBanner />
          <Outlet />
        </div>
      </div>
    </div>
  )
}

/** /settings alone goes to the first page the person may use. */
export function SettingsHome() {
  return <Navigate to={useIsAdmin() ? '/settings/team' : '/settings/company'} replace />
}

/** The Team screen is admin only. Anyone else sees the no-access page inside the shell, never the data (the function refuses them too). */
export function AdminOnly({ area, children }: { area: string; children: ReactNode }) {
  return useIsAdmin() ? <>{children}</> : <NoAccessPage area={area} />
}
