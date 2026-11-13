import { Link, useLocation } from 'react-router-dom'
import { Camera, PanelLeft } from 'lucide-react'
import { activeLink, railLinks, type CountKey, type NavKey, type ShellLink, type ShellLinkId } from '@/app/navConfig'
import { ROLE_LABEL, type SessionUser } from '@/app/session'
import { NewMenu } from '@/app/shell/NewMenu'
import { limeButtonClass, railTextClass } from '@/app/shell/railStyle'
import { BrandImage } from '@/ui/BrandImage'
import { Icon } from '@/ui/Icon'
import { LateDot } from '@/ui/LateDot'
import { NeedsCount } from '@/ui/Tag'
import { initials } from '@/lib/initials'
import { cn } from '@/lib/utils'

/*
 * The forest rail (gate 2; 02-navigation.html "Option A, Lanes: desktop"), from 768 up. 240 wide from 1024, 72 (icons, words read out)
 * from 768 to 1023 (gate 2 question 2) and whenever the person collapses it (kept on this device). Top to bottom:
 *   the logo (home), the lime button (Create for admin and sales; Take photo for an engineer, who starts nothing else),
 *   the lanes (admin and sales: Home, Sell, Deliver, Money, then Companies under a divider; engineer: Home, I paid, Jobs),
 *   Collapse (1024 up), and the person's name and role.
 * The current lane is the lime pill (word and pill, never colour alone: aria-current). Home carries the one number (what is due now),
 * Money a red dot while an invoice is late. Engineers get their own list (navConfig railLinks), never a hidden office one.
 */
interface RailProps {
  user: SessionUser
  /** "Needs you" counts (Home's). Nothing is shown for 0 or absent. */
  counts?: Partial<Record<CountKey, number>>
  /** A red dot, no number (Money while an invoice is late). */
  dots?: Partial<Record<NavKey, boolean>>
  collapsed: boolean
  onToggle: () => void
  /** Default: the role's lanes from navConfig. The gallery passes a fixed list so its photo does not move with navConfig. */
  links?: readonly ShellLink[]
  /** Default: the lane of the current address. The gallery names one so its photo has a current lane. */
  current?: ShellLinkId
}

const pill = 'relative flex min-h-control items-center gap-3 rounded-pill text-base font-semibold transition-colors duration-fast ease-out'

export function Rail({ user, counts, dots, collapsed, onToggle, links: given, current: named }: RailProps) {
  const { pathname, search } = useLocation()
  const links = given ?? railLinks(user.role)
  const current = named ? links.find(l => l.id === named) : activeLink(links, pathname, search)
  const text = railTextClass(collapsed)
  const shape = collapsed ? 'justify-center px-0' : 'px-4 max-lg:justify-center max-lg:px-0'
  return (
    // One landmark around the whole rail (axe region): the lanes inside are the Main navigation.
    <aside
      aria-label="Menu"
      data-surface="navy"
      data-rail={collapsed ? 'collapsed' : 'expanded'}
      className={cn(
        'hidden min-h-0 flex-col overflow-y-auto overflow-x-hidden bg-chrome text-fg md:row-span-2 md:flex',
        collapsed ? 'w-nav-collapsed' : 'w-nav-collapsed lg:w-nav',
      )}
    >
      <Link to="/" aria-label="Q-Tech Solutions, home" className={cn('flex shrink-0 items-center gap-3 px-5 pb-3 pt-5 font-heavy text-lg', collapsed ? 'justify-center px-0' : 'max-lg:justify-center max-lg:px-0')}>
        {/* Lazy: the rail is hidden on phones, and a hidden lazy image is never downloaded (perf/lcp). */}
        <BrandImage name="logo-mark" alt="" width={32} height={32} loading="lazy" className="block size-8 shrink-0 rounded-control" />
        <span aria-hidden="true" className={collapsed ? 'hidden' : 'truncate max-lg:hidden'}>
          Q-Tech
        </span>
      </Link>

      <div className={cn('shrink-0 pb-4 pt-2', collapsed ? 'px-3' : 'px-3 lg:px-4')}>
        {user.role === 'engineer' ? (
          <Link to="/capture" title="Take photo" className={limeButtonClass(collapsed)}>
            <Icon icon={Camera} size="lg" />
            <span className={text}>Take photo</span>
          </Link>
        ) : (
          <NewMenu role={user.role} variant="rail" collapsed={collapsed} />
        )}
      </div>

      <nav aria-label="Main" className="shrink-0 px-3">
        <ul className="grid gap-1">
          {links.map(link => {
            const on = link.id === current?.id
            const count = link.count ? counts?.[link.count] : undefined
            const dot = link.count ? dots?.[link.count] === true : false
            return (
              <li key={link.id}>
                {link.apart ? <hr aria-hidden="true" className="mx-2 my-3 border-0 border-t border-chrome-edge" /> : null}
                <Link
                  to={link.to}
                  title={link.label}
                  aria-current={on ? 'page' : undefined}
                  className={cn(pill, shape, on ? 'bg-lime-300 font-heavy text-lime-on hover:bg-lime-hover' : 'text-fg hover:bg-chrome-field')}
                >
                  <span className="relative grid shrink-0 place-items-center">
                    <Icon icon={link.icon} size="lg" />
                    {/* While the words are hidden the number and the dot sit on the icon; the link's name still says them. */}
                    {/* Pulled in over the icon (left-1), so a "99+" stays inside the 72 px rail. */}
                    <NeedsCount n={count} badge silent className={cn('left-1', collapsed ? undefined : 'lg:hidden')} />
                    {dot ? <LateDot badge silent className={collapsed ? undefined : 'lg:hidden'} /> : null}
                  </span>
                  <span data-nav-label="" className={cn(text, 'min-w-0 flex-1')}>
                    {link.label}
                  </span>
                  <NeedsCount n={count} silent className={collapsed ? 'hidden' : 'max-lg:hidden'} />
                  {dot ? <LateDot silent className={collapsed ? 'hidden' : 'max-lg:hidden'} /> : null}
                  {count ? <span className="sr-only">{`, ${count} due now`}</span> : null}
                  {dot ? <span className="sr-only">, an invoice is late</span> : null}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="mt-auto shrink-0 px-3 pt-4 max-lg:hidden">
        <button
          type="button"
          aria-pressed={collapsed}
          title={collapsed ? 'Expand the menu' : 'Collapse the menu'}
          onClick={onToggle}
          className={cn(pill, shape, 'w-full text-fg-2 hover:bg-chrome-field hover:text-fg')}
        >
          <Icon icon={PanelLeft} size="lg" />
          <span className={text}>Collapse</span>
        </button>
      </div>

      <div className={cn('mt-4 flex shrink-0 items-center gap-3 border-t border-chrome-edge p-4 max-lg:mt-auto', collapsed ? 'justify-center px-0' : 'max-lg:justify-center max-lg:px-0')}>
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-round bg-brand-100 text-sm font-heavy text-brand-700">
          {initials(user.name)}
        </span>
        <span className={cn(collapsed ? 'sr-only' : 'grid min-w-0 max-lg:sr-only')}>
          <span className="truncate text-sm font-semibold" title={user.name}>
            {user.name}
          </span>
          <span className="text-xs text-fg-2">{ROLE_LABEL[user.role] ?? user.role}</span>
        </span>
      </div>
    </aside>
  )
}
