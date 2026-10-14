import { NavLink } from 'react-router-dom'
import { navItemsForRole } from '@/app/navConfig'
import type { SessionUser } from '@/app/session'
import { Search } from 'lucide-react'
import { AccountMenu } from '@/app/shell/AccountMenu'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { cn } from '@/lib/utils'

/** Phone header (below 768): logo mark, the current destination as the title, search, avatar. 52px. */
export function MobileBar({ user, title, onSearch }: { user: SessionUser; title: string; onSearch?: () => void }) {
  return (
    <header className="flex h-topbar items-center gap-1 border-b bg-surface pl-4 pr-2 md:hidden">
      <NavLink to="/" aria-label="Q-Tech, home" className="mr-2 shrink-0 rounded">
        <img src="/brand/logo-mark.png" alt="" width={28} height={28} className="block size-[28px]" />
      </NavLink>
      {/* Not a heading: every screen draws its own h1, and two h1s on a phone is wrong. */}
      <p className="flex-1 truncate text-lg font-semibold tracking-snug">{title}</p>
      <Button variant="quiet" size="touch" icon={Search} aria-label="Search" onClick={onSearch} />
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
