import { forwardRef, useId, useRef, type ComponentPropsWithoutRef, type ElementRef, type KeyboardEvent, type ReactNode } from 'react'
import * as RadixPopover from '@radix-ui/react-popover'
import { Check, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * Popover (INVENTORY: U03; D08 section 13). Two variants on one Radix primitive:
 *   menu         actions, --control-h items, hint on the right, one divider at most. role="menu";
 *                Up/Down/Home/End move, Enter or Space runs the item, Esc closes. A MenuItem with `checked`
 *                is a menuitemradio (one choice of a few, such as Text size), shown with a tick.
 *   information  anchored detail that needs more than a tooltip but less than a panel. No form inside.
 * Opens 4px below its trigger. Esc, outside click and selecting an item close it; focus returns to the trigger.
 */
export const Popover = RadixPopover.Root
export const PopoverTrigger = RadixPopover.Trigger
export const PopoverAnchor = RadixPopover.Anchor
export const PopoverClose = RadixPopover.Close

type ContentProps = Omit<ComponentPropsWithoutRef<typeof RadixPopover.Content>, 'role'> & {
  variant?: 'menu' | 'information'
  /** information only: 'dialog' names it as one (InfoTip). The menu variant is always role="menu". */
  role?: 'dialog'
}

const FOCUSABLE_ITEM = '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled])'

export const PopoverContent = forwardRef<ElementRef<typeof RadixPopover.Content>, ContentProps>(function PopoverContent(
  { variant = 'information', role, className, sideOffset = 4, align = 'start', onKeyDown, onOpenAutoFocus, children, ...rest },
  ref,
) {
  const isMenu = variant === 'menu'
  const inner = useRef<HTMLDivElement | null>(null)
  const handleKey = (e: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(e)
    if (!isMenu || e.defaultPrevented) return
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>(FOCUSABLE_ITEM)]
    if (!items.length) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    let next = -1
    if (e.key === 'ArrowDown') next = (at + 1) % items.length
    else if (e.key === 'ArrowUp') next = (at - 1 + items.length) % items.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = items.length - 1
    if (next >= 0) {
      e.preventDefault()
      items[next].focus()
    }
  }
  return (
    <RadixPopover.Portal>
      <RadixPopover.Content
        ref={node => {
          inner.current = node
          if (typeof ref === 'function') ref(node)
          else if (ref) ref.current = node
        }}
        role={isMenu ? 'menu' : role}
        sideOffset={sideOffset}
        align={align}
        collisionPadding={8}
        onKeyDown={handleKey}
        onOpenAutoFocus={e => {
          onOpenAutoFocus?.(e)
          if (!isMenu || e.defaultPrevented) return
          e.preventDefault()
          inner.current?.querySelector<HTMLElement>(FOCUSABLE_ITEM)?.focus()
        }}
        className={cn(
          'z-50 animate-rise-4 rounded bg-surface shadow-pop focus:outline-none',
          isMenu ? 'min-w-[200px] p-1' : 'max-w-[320px] p-4 text-sm',
          className,
        )}
        {...rest}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  )
})

interface MenuItemProps extends Omit<ComponentPropsWithoutRef<'button'>, 'children'> {
  children: ReactNode
  icon?: LucideIcon
  /** Right-aligned hint: a date, a shortcut. */
  hint?: ReactNode
  danger?: boolean
  /** Keep the popover open after the item runs. Default closes it. */
  keepOpen?: boolean
  /** One choice of a few (role menuitemradio): true shows the tick. Put the choices in a MenuGroup. */
  checked?: boolean
}

/** A --control-h menu row (40, 32 with smaller text). Put the items inside `PopoverContent variant="menu"`. */
export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  { children, icon, hint, danger, keepOpen, checked, className, onClick, ...rest },
  ref,
) {
  const radio = checked !== undefined
  const row = (
    <button
      ref={ref}
      type="button"
      role={radio ? 'menuitemradio' : 'menuitem'}
      aria-checked={radio ? checked : undefined}
      tabIndex={-1}
      onClick={onClick}
      className={cn(
        'flex h-control w-full items-center gap-2 rounded px-2 text-left text-sm transition-colors duration-fast ease-out',
        'hover:bg-sunken focus-visible:bg-selected focus-visible:outline-offset-[-2px] disabled:text-fg-disabled disabled:hover:bg-transparent',
        danger ? 'text-tone-danger-fg' : 'text-fg',
        className,
      )}
      {...rest}
    >
      {icon ? <Icon icon={icon} className={danger ? '' : 'text-fg-muted'} /> : null}
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {hint ? <span className="shrink-0 text-xs text-fg-muted">{hint}</span> : null}
      {radio ? <Icon icon={Check} className={cn('text-primary', !checked && 'invisible')} /> : null}
    </button>
  )
  return keepOpen ? row : <RadixPopover.Close asChild>{row}</RadixPopover.Close>
})

/** A named run of menuitemradio choices inside a menu ("Text size: Normal, Smaller"), with its name shown above them. */
export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  const id = useId()
  return (
    <div role="group" aria-labelledby={id} className="grid">
      <span id={id} className="px-2 pb-1 pt-2 text-xs font-medium text-fg-muted">
        {label}
      </span>
      {children}
    </div>
  )
}

/** The single divider a menu may carry. */
export function MenuSeparator() {
  return <div role="separator" className="my-1 h-px bg-line" />
}
