import { NavLink } from 'react-router-dom'
import { Import, Search } from 'lucide-react'
import { navItemsForRole, type NavItem, type NavKey } from '@/app/navConfig'
import { ROLE_LABEL, type SessionUser } from '@/app/session'
import { AccountMenu } from '@/app/shell/AccountMenu'
import { BrandImage } from '@/ui/BrandImage'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { cn } from '@/lib/utils'
import { searchKeyHint } from '@/ui/paletteSources'

interface TopBarProps {
  user: SessionUser
  /** Optional counts beside a destination ("RFQs 14"). Supplied by the data layer; nothing is shown when absent. */
  counts?: Partial<Record<NavKey, number>>
  onSearch?: () => void
  onCapture?: () => void
  /** The destinations. Default: the role's list from navConfig. The gallery passes a fixed list so its photo does not move with navConfig. */
  items?: readonly NavItem[]
}

/** The paste / photo action (was "Capture"; plain-words glossary, DECISIONS 2026-10-19). Same C key. */
export const CAPTURE_LABEL = 'Paste or photo'

/*
 * Direction B top bar (desktop and tablet): --topbar-h, the role-filtered destinations (5 or 6, from navConfig),
 * search with the command-palette hint, the paste-or-photo action, role and avatar. Words beat icons for this
 * team, so the labels stay on from 1024 up (a 1366 laptop at 125% is about 1093 px) and the icons, key hints and
 * role go first when room runs out. Never wider than the window (e2e/money-books/shell-overflow.spec.ts):
 *   2xl, 1536 up  icon + label + count, wordmark, 280 search with the key hint, the action with C, role.
 *   xl, 1280-1535 label + count, wordmark, 220 search; no icons, key hints or role.
 *   lg, 1024-1279 label + count, logo mark, a short "Search" box, the action labelled.
 *   md, 768-1023  icons, the active label only, logo mark, search and the action as icon buttons.
 * Below 768 the phone bar and the bottom tabs take over (MobileChrome).
 */
export function TopBar({ user, counts, onSearch, onCapture, items: given }: TopBarProps) {
  const items = given ?? navItemsForRole(user.role)
  const hint = searchKeyHint()
  return (
    <header className="hidden h-topbar min-w-0 items-center gap-4 border-b bg-surface px-4 md:flex xl:gap-5 2xl:gap-6 2xl:px-5">
      <NavLink to="/" className="shrink-0 rounded" aria-label="Q-Tech Solutions, home">
        <BrandImage name="logo-wordmark" alt="" width={124} height={30} className="block h-[30px] w-auto max-xl:hidden" />
        <BrandImage name="logo-mark" alt="" width={28} height={28} className="block size-[28px] xl:hidden" />
      </NavLink>

      <nav aria-label="Main" className="flex min-w-0 gap-1 self-stretch 2xl:ml-2">
        {items.map(item => (
          <NavLink
            key={item.key}
            to={item.path}
            title={item.label}
            className={({ isActive }) =>
              cn(
                'relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap rounded px-2 text-sm font-medium transition-colors duration-fast ease-out xl:px-3',
                'hover:text-fg',
                isActive ? 'text-fg' : 'text-fg-2',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon icon={item.icon} className="lg:max-2xl:hidden" />
                <span data-nav-label="" className={cn(!isActive && 'max-lg:sr-only')}>
                  {item.label}
                </span>
                {counts?.[item.key] != null ? (
                  <span className="num text-xs text-fg-muted max-lg:hidden">{counts[item.key]}</span>
                ) : null}
                {isActive ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-2 -bottom-px h-indicator bg-brand-green xl:inset-x-3" /> : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <button
        type="button"
        onClick={onSearch}
        aria-label="Search or jump to"
        className={cn(
          'ml-auto flex h-control shrink-0 items-center gap-2 rounded border border-line-strong bg-sunken text-left text-sm text-fg-muted',
          'transition-colors duration-fast ease-out hover:border-line-input',
          'w-control justify-center lg:w-[150px] lg:justify-start lg:pl-3 lg:pr-2 xl:w-[220px] 2xl:w-[280px]',
        )}
      >
        <Icon icon={Search} />
        <span aria-hidden="true" className="flex-1 truncate max-lg:hidden xl:hidden">
          Search
        </span>
        <span aria-hidden="true" className="flex-1 truncate max-xl:hidden">
          Search or jump to
        </span>
        <Kbd className="max-2xl:hidden">{hint}</Kbd>
      </button>

      {onCapture ? (
        <button
          type="button"
          onClick={onCapture}
          aria-label={CAPTURE_LABEL}
          className={cn(
            'flex h-control shrink-0 items-center gap-2 whitespace-nowrap rounded border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground',
            'transition-colors duration-fast ease-out hover:border-primary-hover hover:bg-primary-hover active:bg-primary-active',
            'max-lg:w-control max-lg:justify-center max-lg:px-0',
          )}
        >
          <Icon icon={Import} />
          <span aria-hidden="true" className="max-lg:hidden">
            {CAPTURE_LABEL}
          </span>
          <Kbd className="border-primary-foreground/40 bg-transparent text-primary-foreground max-2xl:hidden">C</Kbd>
        </button>
      ) : null}

      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs font-medium text-fg-muted max-2xl:hidden">{ROLE_LABEL[user.role] ?? user.role}</span>
        <AccountMenu user={user} />
      </div>
    </header>
  )
}
