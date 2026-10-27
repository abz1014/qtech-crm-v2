import {
  cloneElement,
  forwardRef,
  isValidElement,
  useContext,
  useEffect,
  useId,
  useState,
  type ComponentPropsWithoutRef,
  type ReactElement,
  type ReactNode,
} from 'react'
import { Check, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { OpenState, preloadPopover, usePopoverImpl, Want } from '@/ui/popoverStore'
import type * as Impl from '@/ui/popoverImpl'

/*
 * Popover (INVENTORY: U03; D08 section 13). Two variants on one Radix primitive:
 *   menu         actions, --control-h items, hint on the right, one divider at most. role="menu";
 *                Up/Down/Home/End move, Enter or Space runs the item, Esc closes. A MenuItem with `checked`
 *                is a menuitemradio (one choice of a few, such as Text size), shown with a tick.
 *   information  anchored detail that needs more than a tooltip but less than a panel. No form inside.
 * Opens 4px below its trigger. Esc, outside click and selecting an item close it; focus returns to the trigger.
 *
 * Radix (popper, floating-ui, presence, about a fifth of every page's first download) lives in popoverImpl.tsx and is downloaded
 * after the first paint (preloadPopover, called by the shell), or at once when a trigger is reached for. Until then a trigger is a
 * plain button that asks for it; a click before it has arrived opens the popover the moment it has (defaultOpen). The tests load it
 * up front (src/test/setup.ts), so a popover there is the real one from the start.
 */

type RootProps = ComponentPropsWithoutRef<typeof import('@radix-ui/react-popover').Root>

/** A popover. Controlled or uncontrolled, as Radix's. */
export function Popover(props: RootProps) {
  const mod = usePopoverImpl()
  const [wanted, setWanted] = useState(false)
  const openNow = props.open ?? props.defaultOpen ?? false
  useEffect(() => {
    if (openNow) void preloadPopover()
  }, [openNow])
  if (!mod) {
    return (
      <Want.Provider
        value={() => {
          setWanted(true)
          // A controlled popover (open={...}) ignores defaultOpen: ask its owner to open it, as Radix's trigger would have.
          if (props.open === false) props.onOpenChange?.(true)
          void preloadPopover()
        }}
      >
        {props.children}
      </Want.Provider>
    )
  }
  return <mod.PopoverImpl {...props} defaultOpen={props.defaultOpen ?? wanted} />
}

type TriggerProps = ComponentPropsWithoutRef<typeof import('@radix-ui/react-popover').Trigger>

export const PopoverTrigger = forwardRef<HTMLButtonElement, TriggerProps>(function PopoverTrigger({ asChild, children, onClick, ...rest }, ref) {
  const mod = usePopoverImpl()
  const want = useContext(Want)
  if (mod) {
    return (
      <mod.PopoverTriggerImpl ref={ref} asChild={asChild} onClick={onClick} {...rest}>
        {children}
      </mod.PopoverTriggerImpl>
    )
  }
  const press = (e: React.MouseEvent<HTMLButtonElement>) => {
    onClick?.(e)
    if (!e.defaultPrevented) want?.()
  }
  const reach = () => void preloadPopover()
  if (asChild && isValidElement(children)) {
    const child = children as ReactElement<Record<string, unknown>>
    const own = child.props.onClick as ((e: React.MouseEvent<HTMLButtonElement>) => void) | undefined
    return cloneElement(child, {
      ref,
      'aria-haspopup': 'dialog',
      'aria-expanded': false,
      onPointerEnter: reach,
      onFocus: reach,
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
        own?.(e)
        press(e)
      },
    } as Record<string, unknown>)
  }
  return (
    <button ref={ref} type="button" aria-haspopup="dialog" aria-expanded={false} onPointerEnter={reach} onFocus={reach} onClick={press} {...rest}>
      {children}
    </button>
  )
})

export function PopoverAnchor({ children }: { children?: ReactNode; asChild?: boolean }) {
  const mod = usePopoverImpl()
  return mod ? <mod.PopoverAnchorImpl asChild>{children as ReactElement}</mod.PopoverAnchorImpl> : <>{children}</>
}

export function PopoverClose({ children, ...rest }: ComponentPropsWithoutRef<typeof import('@radix-ui/react-popover').Close>) {
  const mod = usePopoverImpl()
  return mod ? <mod.PopoverCloseImpl {...rest}>{children}</mod.PopoverCloseImpl> : null
}

export const PopoverContent = forwardRef<HTMLDivElement, Impl.ContentProps>(function PopoverContent(props, ref) {
  const mod = usePopoverImpl()
  return mod ? <mod.PopoverContentImpl ref={ref} {...props} /> : null
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
  const state = useContext(OpenState)
  const row = (
    <button
      ref={ref}
      type="button"
      role={radio ? 'menuitemradio' : 'menuitem'}
      aria-checked={radio ? checked : undefined}
      tabIndex={-1}
      onClick={e => {
        onClick?.(e)
        // Choosing an item closes the menu (the Radix Close this used to wrap), unless the item keeps it open.
        if (!keepOpen && !e.defaultPrevented) state?.close()
      }}
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
  return row
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
