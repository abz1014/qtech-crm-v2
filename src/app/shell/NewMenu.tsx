import { Suspense } from 'react'
import { Plus } from 'lucide-react'
import { newEntries } from '@/app/shell/newEntries'
import { useUpgrade } from '@/app/shell/useUpgrade'
import { Button } from '@/ui/Button'
import { cn } from '@/lib/utils'
import { lazyWithReload } from '@/lib/importWithReload'

// The menu itself (Radix popover) is downloaded after the first paint, or when it is reached for (useUpgrade).
const loadImpl = () => import('@/app/shell/NewMenuImpl').then(m => ({ default: m.NewMenuImpl }))
const NewMenuImpl = lazyWithReload(loadImpl)

/*
 * "+ New" (redesign phase 3, plan section (c)): see NewMenuImpl. This is the button as first drawn, with the menu behind it.
 */
export interface NewMenuProps {
  role: string
  className?: string
  labelClass?: string
  iconOnly?: boolean
  size?: 'md' | 'touch'
}

export function NewMenu(props: NewMenuProps) {
  const { role, className, labelClass, iconOnly = false, size = 'md' } = props
  const up = useUpgrade(loadImpl)
  if (newEntries(role).length === 0) return null
  const trigger = (more: { onClick?: () => void; onPointerEnter?: () => void; onFocus?: () => void }) => (
    // Outlined, never green: each screen has its own one primary button (audit X1).
    <Button variant="secondary" size={size} icon={Plus} aria-label={iconOnly ? 'New' : undefined} className={cn(className)} aria-haspopup="menu" {...more}>
      {iconOnly ? null : <span className={labelClass}>New</span>}
    </Button>
  )
  if (!up.on) return trigger({ onClick: up.upgradeAndOpen, onPointerEnter: up.upgrade, onFocus: up.upgrade })
  return (
    <Suspense fallback={trigger({})}>
      <NewMenuImpl {...props} defaultOpen={up.openFirst} />
    </Suspense>
  )
}
