import { NavLink } from 'react-router-dom'
import { Search } from 'lucide-react'
import { navItemsForRole, type NavKey } from '@/app/navConfig'
import { ROLE_LABEL, type SessionUser } from '@/app/session'
import { AccountMenu } from '@/app/shell/AccountMenu'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { cn } from '@/lib/utils'

interface TopBarProps {
  user: SessionUser
  /** Optional counts beside a destination ("RFQs 14"). Supplied by the data layer; nothing is shown when absent. */
  counts?: Partial<Record<NavKey, number>>
  onSearch?: () => void
}

/**
 * Direction B top bar (desktop and tablet): 52px, wordmark, six role-filtered
 * destinations, search with the command-palette hint, role and avatar.
 * 1280 and up shows labels; 768 to 1279 shows icons and the active label only
 * (as in money-12-tablet-768); below 768 the mobile bar and tab bar take over.
 */
export function TopBar({ user, counts, onSearch }: TopBarProps) {
  const items = navItemsForRole(user.role)
  return (
    <header className="hidden h-topbar items-center gap-6 border-b bg-surface px-5 max-xl:px-4 md:flex">
      <NavLink to="/" className="shrink-0 rounded" aria-label="Q-Tech Solutions, home">
        <img src="/brand/logo-wordmark.png" alt="" width={124} height={30} className="block h-[30px] w-auto" />
      </NavLink>

      <nav aria-label="Main" className="ml-2 flex gap-1 self-stretch max-xl:ml-0">
        {items.map(item => (
          <NavLink
            key={item.key}
            to={item.path}
            title={item.label}
            className={({ isActive }) =>
              cn(
                'relative inline-flex items-center gap-2 rounded px-3 max-xl:px-2 text-sm font-medium transition-colors duration-fast ease-out',
                'hover:text-fg',
                isActive ? 'text-fg' : 'text-fg-muted',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon icon={item.icon} />
                <span className={cn(!isActive && 'max-xl:sr-only')}>{item.label}</span>
                {counts?.[item.key] != null ? (
                  <span className="num text-xs text-fg-muted max-xl:hidden">{counts[item.key]}</span>
                ) : null}
                {isActive ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-3 max-xl:inset-x-2 -bottom-px h-indicator bg-brand-green" /> : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        onClick={onSearch}
        aria-label="Search or jump to ⌘K"
        className={cn(
          'ml-auto flex h-control items-center gap-2 rounded border border-line-strong bg-sunken px-2 text-left text-sm text-fg-muted',
          'transition-colors duration-fast ease-out hover:border-line-input',
          'xl:w-[280px] xl:pl-3 max-xl:w-control max-xl:justify-center max-xl:px-0',
        )}
      >
        <Icon icon={Search} />
        <span className="flex-1 max-xl:hidden">Search or jump to</span>
        <Kbd className="max-xl:hidden">⌘K</Kbd>
      </button>

      <div className="flex items-center gap-3">
        <span className="text-xs font-medium text-fg-muted max-xl:hidden">{ROLE_LABEL[user.role] ?? user.role}</span>
        <AccountMenu user={user} />
      </div>
    </header>
  )
}
