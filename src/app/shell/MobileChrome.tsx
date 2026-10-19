import { NavLink, useNavigate } from 'react-router-dom'
import { navItemsForRole, type NavItem, type NavKey } from '@/app/navConfig'
import type { SessionUser } from '@/app/session'
import { ChevronLeft, Import, Search, X } from 'lucide-react'
import { useMobileBarConfig } from '@/app/shell/MobileBarContext'
import { AccountMenu } from '@/app/shell/AccountMenu'
import { CAPTURE_LABEL } from '@/app/shell/TopBar'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { CountBadge } from '@/ui/Tag'
import { cn } from '@/lib/utils'

/**
 * Phone header (below 768). Default: logo mark, the current destination as the title, search, the paste-or-photo
 * action and the avatar, --topbar-h tall. Room is tight at the bigger text size, so the logo mark goes below 400 px
 * (the Today tab is home) and the action keeps only its icon below 360 px; the title truncates last.
 * A screen can ask for the back / close form through useMobileBar(): chevron-left or x, its own title, and one
 * slot on the right (g2-login-team-settings phone frames).
 */
export function MobileBar({ user, title, onSearch, onCapture }: { user: SessionUser; title: string; onSearch?: () => void; onCapture?: () => void }) {
  const navigate = useNavigate()
  const config = useMobileBarConfig()
  const lead = config?.back ?? config?.close
  if (config && lead) {
    const isBack = Boolean(config.back)
    const label = config.back?.label ?? (isBack ? 'Back' : 'Close')
    return (
      <header className="flex h-topbar items-center gap-1 border-b bg-surface px-2 md:hidden">
        <Button
          variant="quiet"
          size="touch"
          icon={isBack ? ChevronLeft : X}
          aria-label={label}
          onClick={() => {
            if (lead.onClick) lead.onClick()
            else if (lead.to) navigate(lead.to)
            else navigate(-1)
          }}
        />
        <p className="min-w-0 flex-1 truncate text-lg font-semibold tracking-snug">{config.title ?? title}</p>
        {config.action ? <div className="flex shrink-0 items-center">{config.action}</div> : null}
      </header>
    )
  }
  return (
    <header className="flex h-topbar items-center gap-1 border-b bg-surface pl-4 pr-2 md:hidden max-[399px]:pl-3">
      <NavLink to="/" aria-label="Q-Tech, home" className="mr-2 shrink-0 rounded max-[399px]:hidden">
        <img src="/brand/logo-mark.png" alt="" width={28} height={28} className="block size-[28px]" />
      </NavLink>
      {/* Not a heading: every screen draws its own h1, and two h1s on a phone is wrong. */}
      <p className="min-w-0 flex-1 truncate text-base font-semibold tracking-snug">{config?.title ?? title}</p>
      {config?.action ?? <Button variant="quiet" size="touch" icon={Search} aria-label="Search" onClick={onSearch} />}
      {onCapture ? (
        <Button variant="primary" size="touch" icon={Import} aria-label={CAPTURE_LABEL} onClick={onCapture} className="max-[359px]:w-touch max-[359px]:px-0">
          <span aria-hidden="true" className="max-[359px]:hidden">
            {CAPTURE_LABEL}
          </span>
        </Button>
      ) : null}
      <AccountMenu user={user} touch />
    </header>
  )
}

/**
 * Phone tab bar (below 768): the same destinations as the top bar (5 or 6, from navConfig), same role filter,
 * icon over label, 20px glyphs, brand-green indicator on the active one, and the top bar's counts as a badge on
 * the icon. Each column is at least as wide as its label, so "Companies" never clips, even at 320 px.
 * Respects the home-bar safe area. Targets are taller than 44px.
 */
export function BottomTabs({
  role,
  counts,
  items: given,
}: {
  role: string
  counts?: Partial<Record<NavKey, number>>
  /** Default: the role's list from navConfig (the gallery passes a fixed one). */
  items?: readonly NavItem[]
}) {
  const items = given ?? navItemsForRole(role)
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
                'relative grid min-h-touch min-w-0 justify-items-center content-center gap-[2px] py-2 text-xs font-medium',
                isActive ? 'text-fg' : 'text-fg-2 hover:text-fg',
              )
            }
          >
            {({ isActive }) => (
              <>
                {isActive ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-3 -top-px h-indicator bg-brand-green" /> : null}
                <span className="relative">
                  <Icon icon={item.icon} size="lg" />
                  {count != null && count > 0 ? <CountBadge count={count} /> : null}
                </span>
                <span className="whitespace-nowrap">
                  {item.label}
                  {count != null && count > 0 ? <span className="sr-only">{` ${count}`}</span> : null}
                </span>
              </>
            )}
          </NavLink>
        )
      })}
    </nav>
  )
}
