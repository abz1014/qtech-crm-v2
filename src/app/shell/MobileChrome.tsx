import { NavLink, useLocation, useNavigate, type Location, type NavigateFunction } from 'react-router-dom'
import { navItemsForRole, type CountKey, type NavItem, type NavKey } from '@/app/navConfig'
import type { SessionUser } from '@/app/session'
import { ChevronLeft, Import, Search, X } from 'lucide-react'
import { useMobileBarConfig, type MobileBarConfig } from '@/app/shell/MobileBarContext'
import { AccountMenu } from '@/app/shell/AccountMenu'
import { NewMenu } from '@/app/shell/NewMenu'
import { CAPTURE_LABEL } from '@/app/shell/TopBar'
import { Button } from '@/ui/Button'
import { BrandImage } from '@/ui/BrandImage'
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
 * Phone header (below 768), navy (data-surface="navy"). Default: logo mark, the current destination as the title, search, the paste-or-photo
 * action (an outlined 44 px icon button, never green: the screen's own button is the one primary) and the avatar, --topbar-h
 * tall. Room is tight at the bigger text size, so the logo mark goes below 400 px (the Today tab is home); the title truncates last.
 * A screen can ask for the one-bar form through useMobileBar(): chevron-left or x, its own title, and one slot on the
 * right for its actions (g2-login-team-settings phone frames). Logo, search, paste-or-photo and the avatar are not shown then.
 */
export function MobileBar({ user, title, onSearch, onCapture }: { user: SessionUser; title: string; onSearch?: () => void; onCapture?: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const config = useMobileBarConfig()
  const actions = config?.actions ?? config?.action
  if (config && (config.back ?? config.close)) {
    const isBack = Boolean(config.back)
    const label = (typeof config.back === 'object' ? config.back.label : undefined) ?? (isBack ? 'Back' : 'Close')
    return (
      <header data-mobile-bar="detail" data-surface="navy" className="flex h-topbar items-center gap-1 bg-chrome px-2 text-fg md:hidden">
        <Button variant="quiet" size="touch" icon={isBack ? ChevronLeft : X} aria-label={label} onClick={() => leave(config, navigate, location)} />
        <p className="min-w-0 flex-1 break-words font-display text-lg font-semibold leading-tight max-[399px]:text-base">{config.title ?? title}</p>
        {actions ? <div className="flex shrink-0 items-center">{actions}</div> : null}
      </header>
    )
  }
  return (
    <header data-mobile-bar="default" data-surface="navy" className="flex h-topbar items-center gap-1 bg-chrome pl-4 pr-2 text-fg md:hidden max-[399px]:pl-3">
      <NavLink to="/" aria-label="Q-Tech, home" className="mr-2 shrink-0 rounded max-[399px]:hidden">
        <BrandImage name="logo-mark" alt="" width={28} height={28} className="block size-[28px]" />
      </NavLink>
      {/* Not a heading: every screen draws its own h1, and two h1s on a phone is wrong. */}
      <p className="min-w-0 flex-1 break-words font-display text-lg font-heavy leading-tight max-[399px]:text-base">{config?.title ?? title}</p>
      {actions ?? <Button variant="quiet" size="touch" icon={Search} aria-label="Search" onClick={onSearch} />}
      <NewMenu role={user.role} iconOnly size="touch" />
      {onCapture ? (
        // Icon only and secondary (audit X1): the screen's own green button is the one primary on a phone; the name is "Paste or photo".
        <Button variant="secondary" size="touch" icon={Import} aria-label={CAPTURE_LABEL} onClick={onCapture} />
      ) : null}
      <AccountMenu user={user} touch />
    </header>
  )
}

/**
 * Phone tab bar (below 768): the same destinations as the top bar (5 or 6, from navConfig), same role filter,
 * icon over label, 20px glyphs, brand-green indicator on the active one, and the top bar's "needs you" counts as a
 * solid warning badge on the icon (NeedsCount badge). Each column is at least as wide as its label, so "Companies" never clips, even at 320 px.
 * Respects the home-bar safe area. Targets are taller than 44px.
 * Not drawn while a screen asks for `hideTabs` (it has its own sticky action bar).
 */
export function BottomTabs({
  role,
  counts,
  dots,
  items: given,
}: {
  role: string
  counts?: Partial<Record<CountKey, number>>
  /** A red dot, no number (Money while an invoice is late). */
  dots?: Partial<Record<NavKey, boolean>>
  /** Default: the role's list from navConfig (the gallery passes a fixed one). */
  items?: readonly NavItem[]
}) {
  const items = given ?? navItemsForRole(role)
  const config = useMobileBarConfig()
  if (config?.hideTabs) return null
  return (
    <nav
      aria-label="Main"
      className="grid border-t bg-surface pb-[env(safe-area-inset-bottom,0px)] md:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(min-content, 1fr))` }}
    >
      {items.map(item => {
        const count = counts?.[item.key]
        return (
          <NavLink
            key={item.key}
            to={item.path}
            className={({ isActive }) =>
              cn(
                // Under 360 px six 16 px labels need the tight tracking to share the width (the shell-widths check at 320).
                'relative grid min-h-touch min-w-0 justify-items-center content-center gap-[2px] py-2 text-xs font-medium max-[359px]:tracking-tight',
                isActive ? 'text-fg' : 'text-fg-2 hover:text-fg',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-3 -top-px h-1 rounded-b bg-brand-green" /> : null}
                <span className="relative">
                  <Icon icon={item.icon} size="lg" />
                  {/* Solid warning badge on the icon. Nothing for 0. The link's name says it in words ("RFQs, 4 need you"). */}
                  <NeedsCount n={count} badge silent />
                  {dots?.[item.key] ? <LateDot badge silent /> : null}
                </span>
                <span className="whitespace-nowrap">
                  {item.label}
                  {count ? <span className="sr-only">{`, ${count} need you`}</span> : null}
                  {dots?.[item.key] ? <span className="sr-only">, an invoice is late</span> : null}
                </span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
