import { Fragment } from 'react'
import { Link, useLocation, useNavigate, type Location, type NavigateFunction } from 'react-router-dom'
import { activeLink, tabLinks, type CountKey, type NavKey, type ShellLink, type ShellLinkId } from '@/app/navConfig'
import type { SessionUser } from '@/app/session'
import { ChevronLeft, CircleHelp, Search, X } from 'lucide-react'
import { useMobileBarConfig, type MobileBarConfig } from '@/app/shell/MobileBarContext'
import { AccountMenu } from '@/app/shell/AccountMenu'
import { NewMenu } from '@/app/shell/NewMenu'
import { useHelp } from '@/features/help/useHelp'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { LateDot } from '@/ui/LateDot'
import { NeedsCount } from '@/ui/Tag'
import { cn } from '@/lib/utils'

/** Whether there is a previous screen in this app to go back to. BrowserRouter keeps an index in history.state; elsewhere (tests) the first entry's key is 'default'. */
function hasPreviousScreen(location: Location): boolean {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx
  return typeof idx === 'number' ? idx > 0 : location.key !== 'default'
}

/** Runs the bar's back (or close): a route, an onClick, or the previous screen with `fallback` when there is none. */
function leave(config: MobileBarConfig, navigate: NavigateFunction, location: Location): void {
  const lead = config.back ?? config.close
  const fallback = config.fallback ?? '/'
  if (typeof lead === 'string' && lead !== 'history') return void navigate(lead)
  if (typeof lead === 'object' && lead.onClick) return lead.onClick()
  if (typeof lead === 'object' && lead.to) return void navigate(lead.to)
  if (hasPreviousScreen(location)) navigate(-1)
  else navigate(fallback, { replace: true })
}

/**
 * Phone top band (below 768), forest (data-surface="navy"; 86-phone-shell.html#ps-band). Default: the page title first, then the
 * magnifier (Search), Help and the account initial, --topbar-h tall. Create is the + in the bottom bar (the old "New" word broke the
 * title at 320, R-004), so the title has the room: it wraps, it is never cut.
 * A screen can ask for the one-bar form through useMobileBar(): chevron-left or x, its own title, and one slot on the
 * right for its actions (86-phone-shell.html#ps-detail). Search, Help and the initial are not shown then.
 */
export function MobileBar({ user, title, onSearch }: { user: SessionUser; title: string; onSearch?: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const config = useMobileBarConfig()
  const { openHelp } = useHelp()
  const actions = config?.actions ?? config?.action
  if (config && (config.back ?? config.close)) {
    const isBack = Boolean(config.back)
    const label = (typeof config.back === 'object' ? config.back.label : undefined) ?? (isBack ? 'Back' : 'Close')
    return (
      <header data-mobile-bar="detail" data-surface="navy" className="flex h-topbar items-center gap-1 bg-chrome px-2 text-fg md:hidden">
        <Button variant="quiet" size="touch" icon={isBack ? ChevronLeft : X} aria-label={label} onClick={() => leave(config, navigate, location)} />
        <p className="min-w-0 flex-1 break-words font-display text-lg font-heavy leading-tight max-[399px]:text-base">{config.title ?? title}</p>
        {config.subtitle ? <p className="num shrink-0 text-base font-medium text-fg-muted">{config.subtitle}</p> : null}
        {actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
      </header>
    )
  }
  return (
    <header data-mobile-bar="default" data-surface="navy" className="flex h-topbar items-center gap-1 bg-chrome pl-4 pr-2 text-fg md:hidden max-[359px]:pl-3 max-[359px]:pr-1">
      {/* Not a heading: every screen draws its own h1, and two h1s on a phone is wrong. */}
      <p className="min-w-0 flex-1 break-words font-display text-lg font-heavy leading-tight max-[399px]:text-base">{config?.title ?? title}</p>
      {actions ?? <Button variant="quiet" size="touch" icon={Search} aria-label="Search" onClick={onSearch} />}
      <Button variant="quiet" size="touch" icon={CircleHelp} aria-label="Help" onClick={() => openHelp()} />
      <AccountMenu user={user} touch />
    </header>
  )
}

/**
 * Phone bottom bar (below 768; 86-phone-shell.html#ps-bars). Admin and sales: Home, Sell, the + (Create sheet), Deliver, Money. Engineer:
 * Home, Camera, I paid, Jobs, and no Create (02-navigation.html, engineer bar). Icon in a pill over the word; the current one gets the
 * tint pill and a heavier word (aria-current, never colour alone). Home carries the one number as a solid badge on its icon, Money a red
 * dot while an invoice is late; the link's name says both in words. Every target is at least 48 tall; the bar pads for the home-bar inset.
 * Not drawn while a screen asks for `hideTabs` (it has its own sticky action bar: the Job page, the company page, Lock a month).
 */
export function BottomTabs({
  role,
  counts,
  dots,
  links: given,
  current: named,
}: {
  role: string
  counts?: Partial<Record<CountKey, number>>
  /** A red dot, no number (Money while an invoice is late). */
  dots?: Partial<Record<NavKey, boolean>>
  /** Default: the role's bar from navConfig (the gallery passes a fixed one). */
  links?: readonly ShellLink[]
  /** Default: the link of the current address (the gallery names one). */
  current?: ShellLinkId
}) {
  const links = given ?? tabLinks(role)
  const { pathname, search } = useLocation()
  const config = useMobileBarConfig()
  if (config?.hideTabs || links.length === 0) return null
  const current = named ? links.find(l => l.id === named) : activeLink(links, pathname, search)
  const engineer = role === 'engineer'
  // The office's + sits in the middle, between the two lanes (Home, Sell, +, Deliver, Money).
  const plusAt = engineer ? -1 : Math.min(2, links.length)
  const columns = links.length + (plusAt >= 0 ? 1 : 0)
  return (
    <nav
      aria-label="Main"
      data-tabbar={engineer ? 'engineer' : 'office'}
      className="grid min-h-tabbar items-center gap-1 border-t bg-surface px-2 pb-[calc(var(--sp-2)+env(safe-area-inset-bottom,0px))] pt-2 shadow-e3 md:hidden"
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {links.map((link, at) => {
        const on = link.id === current?.id
        const count = link.count ? counts?.[link.count] : undefined
        const dot = link.count ? dots?.[link.count] === true : false
        const camera = link.id === 'camera'
        return (
          <Fragment key={link.id}>
            {at === plusAt ? <NewMenu role={role} variant="tab" /> : null}
            <Link
              to={link.to}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'grid min-h-touch min-w-0 justify-items-center content-center gap-1 rounded-control py-1 text-xs transition-transform duration-fast active:scale-press',
                on ? 'font-heavy text-brand-700' : 'font-semibold text-fg-2 hover:text-fg',
                camera && 'text-brand-700',
              )}
            >
              <span
                className={cn(
                  'relative grid place-items-center rounded-pill',
                  camera ? 'h-12 w-16 bg-brand-700 text-primary-foreground shadow-e2' : 'h-8 w-12',
                  on && !camera && 'bg-brand-100',
                )}
              >
                <Icon icon={link.icon} size="lg" />
                {/* Solid warning badge on the icon. Nothing for 0. The link's name says it in words ("Home, 4 due now"). */}
                <NeedsCount n={count} badge silent />
                {dot ? <LateDot badge silent /> : null}
              </span>
              <span className="max-w-full whitespace-nowrap">
                {link.label}
                {count ? <span className="sr-only">{`, ${count} due now`}</span> : null}
                {dot ? <span className="sr-only">, an invoice is late</span> : null}
              </span>
            </Link>
          </Fragment>
        )
      })}
    </nav>
  )
}
