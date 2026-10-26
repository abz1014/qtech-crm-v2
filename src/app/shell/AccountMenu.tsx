import { Suspense } from 'react'
import { useUpgrade } from '@/app/shell/useUpgrade'
import type { SessionUser } from '@/app/session'
import { Avatar } from '@/ui/Avatar'
import { cn } from '@/lib/utils'
import { lazyWithReload } from '@/lib/importWithReload'

// The menu itself (Radix popover, Help, install, version) is downloaded after the first paint, or when it is reached for (useUpgrade).
const loadImpl = () => import('@/app/shell/AccountMenuImpl').then(m => ({ default: m.AccountMenuImpl }))
const AccountMenuImpl = lazyWithReload(loadImpl)

/*
 * Account menu: the top-bar avatar opens a menu (see AccountMenuImpl). This is the avatar as first drawn, with the menu behind it.
 */
function Trigger({ user, touch, more }: { user: SessionUser; touch: boolean; more: { onClick?: () => void; onPointerEnter?: () => void; onFocus?: () => void } }) {
  return (
    <button
      type="button"
      aria-haspopup="menu"
      className={cn('grid place-items-center rounded-round transition-opacity duration-fast ease-out hover:opacity-85', touch && 'size-touch')}
      {...more}
    >
      <span className="sr-only">Account menu, </span>
      <Avatar name={user.name} />
    </button>
  )
}

export function AccountMenu({ user, touch = false }: { user: SessionUser; touch?: boolean }) {
  const up = useUpgrade(loadImpl)
  if (!up.on) return <Trigger user={user} touch={touch} more={{ onClick: up.upgradeAndOpen, onPointerEnter: up.upgrade, onFocus: up.upgrade }} />
  return (
    <Suspense fallback={<Trigger user={user} touch={touch} more={{}} />}>
      <AccountMenuImpl user={user} touch={touch} defaultOpen={up.openFirst} />
    </Suspense>
  )
}
