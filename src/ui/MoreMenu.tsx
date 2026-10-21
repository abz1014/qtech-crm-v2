import type { ReactNode } from 'react'
import { ChevronDown, Ellipsis } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'

/*
 * MoreMenu (round-2 spec 5.3): the page-level "More" menu of a detail page, generalised from the RFQ header's More menu and
 * OrderMoreMenu. The items are ordinary `MenuItem`s (src/ui/Popover) passed as children.
 *   desktop (default)  a text button "More" with ChevronDown, the RFQ pattern
 *   touch              an `Ellipsis` icon button at the 44 px touch size, for the phone bar or the sticky action bar
 * Row-level menus are not this: they stay a small icon `…` with aria-label "More for {name}".
 *
 * `label` names the menu (and the touch button, which has no text); the desktop button always reads "More".
 */
export interface MoreMenuProps {
  /** MenuItem, MenuGroup and at most one MenuSeparator. */
  children: ReactNode
  /** The Ellipsis icon at touch size (phone bar, sticky action bar). Default: the desktop text button. */
  touch?: boolean
  /** Accessible name of the menu, and of the touch button. Default "More actions". */
  label?: string
  /** Which side of the trigger the menu opens on. A bottom bar passes "top". */
  side?: 'top' | 'bottom'
  align?: 'start' | 'end'
  /** Classes for the trigger button ("max-md:hidden" to keep it to desktop). */
  className?: string
  /** Classes for the menu ("min-w-[300px]" for long item labels). */
  menuClassName?: string
  disabled?: boolean
}

export function MoreMenu({ children, touch = false, label = 'More actions', side, align = 'end', className, menuClassName, disabled }: MoreMenuProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {touch ? (
          <Button size="touch" variant="quiet" icon={Ellipsis} aria-label={label} aria-haspopup="menu" disabled={disabled} className={className} />
        ) : (
          <Button aria-haspopup="menu" disabled={disabled} className={className}>
            More
            <Icon icon={ChevronDown} size="sm" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent variant="menu" align={align} side={side} aria-label={label} className={cn(menuClassName)}>
        {children}
      </PopoverContent>
    </Popover>
  )
}
