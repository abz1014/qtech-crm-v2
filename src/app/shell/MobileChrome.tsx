import { NavLink, useNavigate } from 'react-router-dom'
import { navItemsForRole } from '@/app/navConfig'
import type { SessionUser } from '@/app/session'
import { ChevronLeft, Search, X } from 'lucide-react'
import { useMobileBarConfig } from '@/app/shell/MobileBarContext'
import { AccountMenu } from '@/app/shell/AccountMenu'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { cn } from '@/lib/utils'

/**
 * Phone header (below 768). Default: logo mark, the current destination as the title, search, avatar. 52px.
 * A screen can ask for the back / close form through useMobileBar(): chevron-left or x, its own title, and one
 * slot on the right (g2-login-team-settings phone frames).
 */
export function MobileBar({ user, title, onSearch }: { user: SessionUser; title: string; onSearch?: () => void }) {
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
    <header className="flex h-topbar items-center gap-1 border-b bg-surface pl-4 pr-2 md:hidden">
      <NavLink to="/" aria-label="Q-Tech, home" className="mr-2 shrink-0 rounded">
        <img src="/brand/logo-mark.png" alt="" width={28} height={28} className="block size-[28px]" />
      </NavLink>
      {/* Not a heading: every screen draws its own h1, and two h1s on a phone is wrong. */}
      <p className="flex-1 truncate text-lg font-semibold tracking-snug">{config?.title ?? title}</p>
      {config?.action ?? <Button variant="quiet" size="touch" icon={Search} aria-label="Search" onClick={onSearch} />}
      <AccountMenu user={user} touch />
    </header>
  )
}

/**
 * Phone tab bar (below 768): the same destinations as the top bar, same role
 * filter, icon over label, 20px glyphs, brand-green indicator on the active one.
 * Respects the home-bar safe area. Targets are taller than 44px.
 */
export function BottomTabs({ role }: { role: string }) {
  const items = navItemsForRole(role)
  return (
    <nav
      aria-label="Main"
      className="grid border-t bg-surface pb-[env(safe-area-inset-bottom,0px)] md:hidden"
      style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
    >
      {items.map(item => (
        <NavLink
          key={item.key}
          to={item.path}
          className={({ isActive }) =>
            cn(
              'relative grid min-h-touch min-w-0 justify-items-center content-center gap-[2px] py-2 text-xs font-medium',
              isActive ? 'text-fg' : 'text-fg-muted hover:text-fg',
            )
          }
        >
          {({ isActive }) => (
            <>
              {isActive ? <span aria-hidden="true" className="pointer-events-none absolute inset-x-[14px] -top-px h-indicator bg-brand-green" /> : null}
              <Icon icon={item.icon} size="lg" />
              <span className="whitespace-nowrap">{item.label}</span>
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
