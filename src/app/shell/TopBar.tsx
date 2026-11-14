import { NavLink } from 'react-router-dom'
import { CircleHelp, Search, Settings } from 'lucide-react'
import { ROLE_LABEL, type SessionUser } from '@/app/session'
import { AccountMenu } from '@/app/shell/AccountMenu'
import { useHelp } from '@/features/help/useHelp'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { cn } from '@/lib/utils'
import { searchKeyHint } from '@/ui/paletteSources'

interface TopBarProps {
  user: SessionUser
  onSearch?: () => void
}

/*
 * Top bar (768 up), beside the forest rail on the canvas (02-navigation.html, .qb-topbar; 81-create-account.html#ca-bar). The lanes and
 * Create live in the rail now, so the bar holds only:
 *   Search "Search or jump to" (opens the command palette; the key is in the tooltip, and beside the box for a mouse from 1536 up);
 *   at the right end Help, Settings (an icon with its name below 1536, icon and word from 1536), the role word (1536 up) and the
 *   account initial, which opens the account menu (live TopBar.tsx: kept for every role, gate 2 SU8).
 * Never wider than the window (e2e/money-books/shell-overflow.spec.ts): the search box is the part that gives.
 * Below 768 the phone band and the bottom bar take over (MobileChrome).
 */
const utilityLink =
  'inline-flex h-control min-w-control items-center justify-center gap-2 rounded-pill px-2 text-sm font-medium text-fg-2 transition-colors duration-fast ease-out hover:bg-sunken hover:text-fg 2xl:px-3'

export function TopBar({ user, onSearch }: TopBarProps) {
  const hint = searchKeyHint()
  const { openHelp } = useHelp()
  return (
    <header className="hidden h-topbar min-w-0 items-center gap-4 bg-canvas px-gutter text-fg md:flex">
      {/* The search key hint sits beside the button, drawn over its right end (inside the 2xl:pr-16 padding), not inside it: text inside
          a button must be part of its name (axe label-content-name-mismatch at 2xl, where the hint shows); the name stays the action, the
          key is aria-keyshortcuts. Below 2xl the hint hides, so the tooltip carries the key (consistency spec 4.3). */}
      <div className="relative min-w-0 max-w-dialog flex-1">
        <button
          type="button"
          onClick={onSearch}
          title={`Search or jump to (${hint})`}
          aria-label="Search or jump to"
          aria-keyshortcuts={hint === '⌘K' ? 'Meta+K' : 'Control+K'}
          className={cn(
            'flex h-control w-full min-w-0 items-center gap-3 rounded-control border border-line-input bg-surface px-4 text-left text-base text-fg-muted',
            'transition-colors duration-fast ease-out hover:border-line-strong 2xl:pr-16',
          )}
        >
          <Icon icon={Search} />
          <span aria-hidden="true" className="min-w-0 flex-1 truncate">
            Search or jump to
          </span>
        </button>
        <Kbd aria-hidden className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 max-2xl:hidden">
          {hint}
        </Kbd>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 lg:gap-2">
        <button type="button" onClick={() => openHelp()} title="Help" className={utilityLink} data-testid="topbar-help">
          <Icon icon={CircleHelp} />
          <span className="max-2xl:sr-only">Help</span>
        </button>
        <NavLink to="/settings" title="Settings" className={utilityLink} data-testid="topbar-settings">
          <Icon icon={Settings} />
          <span className="max-2xl:sr-only">Settings</span>
        </NavLink>
        <span className="text-xs font-medium text-fg-muted max-2xl:hidden">{ROLE_LABEL[user.role] ?? user.role}</span>
        <AccountMenu user={user} />
      </div>
    </header>
  )
}
