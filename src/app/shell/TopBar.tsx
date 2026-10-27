import { NavLink } from 'react-router-dom'
import { Search } from 'lucide-react'
import { navItemsForRole, type CountKey, type NavItem, type NavKey } from '@/app/navConfig'
import { ROLE_LABEL, type SessionUser } from '@/app/session'
import { AccountMenu } from '@/app/shell/AccountMenu'
import { NewMenu } from '@/app/shell/NewMenu'
import { BrandImage } from '@/ui/BrandImage'
import { Icon } from '@/ui/Icon'
import { Kbd } from '@/ui/Kbd'
import { LateDot } from '@/ui/LateDot'
import { NeedsCount } from '@/ui/Tag'
import { cn } from '@/lib/utils'
import { searchKeyHint } from '@/ui/paletteSources'

interface TopBarProps {
  user: SessionUser
  /** "Needs you" counts beside a destination (NeedsCount: "RFQs 4", named "RFQs, 4 need you"). Nothing is shown for 0 or absent. */
  counts?: Partial<Record<CountKey, number>>
  /** A red dot, no number (Money while an invoice is late). */
  dots?: Partial<Record<NavKey, boolean>>
  onSearch?: () => void
  /** The destinations. Default: the role's list from navConfig. The gallery passes a fixed list so its photo does not move with navConfig. */
  items?: readonly NavItem[]
}


/*
 * Top bar (desktop and tablet), navy in direction C (data-surface="navy" re-inks the primitives inside): --topbar-h, the role-filtered destinations (5 or 6, from navConfig),
 * search with the command-palette hint, the paste-or-photo action, role and avatar. Words beat icons for this
 * team, so the labels stay on from 1024 up (a 1366 laptop at 125% is about 1093 px) and the icons, key hints and
 * role go first when room runs out. Never wider than the window (e2e/money-books/shell-overflow.spec.ts):
 *   2xl, 1536 up  icon + label + count, wordmark, 280 search with the key hint, the action (outlined), role.
 *   xl, 1280-1535 label + count, wordmark, 220 search; no icons, key hints or role.
 *   lg, 1024-1279 label + count, logo mark, a short "Search" box, the action labelled.
 *   md, 768-1023  icons, the active label only, logo mark, search and the action as icon buttons.
 * Below 768 the phone bar and the bottom tabs take over (MobileChrome).
 */
export function TopBar({ user, counts, dots, onSearch, items: given }: TopBarProps) {
  const items = given ?? navItemsForRole(user.role)
  const hint = searchKeyHint()
  return (
    <header data-surface="navy" className="hidden h-topbar min-w-0 items-center gap-4 bg-chrome px-4 text-fg md:flex xl:gap-5 2xl:gap-6 2xl:px-5">
      {/* The wordmark sits on its own white plate (BRAND 6: never on a coloured background); the mark is a green square and needs none. */}
      <NavLink to="/" className="shrink-0 rounded xl:bg-chrome-fg xl:px-2 xl:py-1" aria-label="Q-Tech Solutions, home">
        {/* Lazy: the top bar is hidden on phones, and a hidden lazy image is never downloaded (perf/lcp). */}
        <BrandImage name="logo-wordmark" alt="" width={124} height={30} loading="lazy" className="block h-[30px] w-auto max-xl:hidden" />
        <BrandImage name="logo-mark" alt="" width={28} height={28} loading="lazy" className="block size-[28px] xl:hidden" />
      </NavLink>

      <nav aria-label="Main" className="flex min-w-0 gap-1 self-stretch 2xl:ml-2">
        {items.map(item => (
          <NavLink
            key={item.key}
            to={item.path}
            title={item.label}
            // No aria-label: the name is the label (sr-only when squeezed) then NeedsCount's words, "RFQs, 4 need you", so the
            // visible text is always part of the name (axe label-content-name-mismatch).
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
                <NeedsCount n={counts?.[item.key]} className="max-lg:hidden" />
                {dots?.[item.key] ? <LateDot className="max-lg:hidden" /> : null}
                {isActive ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-2 bottom-0 h-1 rounded-t bg-brand-green xl:inset-x-3" /> : null}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* The search key hint sits beside the button, drawn over its right end (inside the 2xl:pr-16 padding), not inside it: text inside
          a button must be part of its name (axe label-content-name-mismatch at 2xl, where the hint shows); the name stays the action, the
          key is aria-keyshortcuts. Below 2xl the hint hides, so the tooltip carries the key (consistency spec 4.3). */}
      <div className="relative ml-auto shrink-0">
        <button
          type="button"
          onClick={onSearch}
          title={`Search or jump to (${hint})`}
          aria-label="Search or jump to"
          aria-keyshortcuts={hint === '⌘K' ? 'Meta+K' : 'Control+K'}
          className={cn(
            'flex h-control items-center gap-2 rounded border border-line-strong bg-surface text-left text-sm text-fg-muted',
            'transition-colors duration-fast ease-out hover:border-line-input',
            'w-control justify-center lg:w-[150px] lg:justify-start lg:pl-3 lg:pr-2 xl:w-[220px] 2xl:w-[280px] 2xl:pr-16',
          )}
        >
          <Icon icon={Search} />
          <span aria-hidden="true" className="flex-1 truncate max-lg:hidden xl:hidden">
            Search
          </span>
          <span aria-hidden="true" className="flex-1 truncate max-xl:hidden">
            Search or jump to
          </span>
        </button>
        <Kbd aria-hidden className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 max-2xl:hidden">
          {hint}
        </Kbd>
      </div>

      <NewMenu role={user.role} className="shrink-0 max-lg:w-control max-lg:px-0" labelClass="max-lg:sr-only" />

      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs font-medium text-fg-muted max-2xl:hidden">{ROLE_LABEL[user.role] ?? user.role}</span>
        <AccountMenu user={user} />
      </div>
    </header>
  )
}
