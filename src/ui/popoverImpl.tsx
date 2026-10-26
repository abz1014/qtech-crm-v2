import {
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type KeyboardEvent,
} from 'react'
import * as RadixPopover from '@radix-ui/react-popover'
import { useBackToClose } from '@/lib/useBackToClose'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { rememberMenuTrigger } from '@/ui/menuTrigger'
import { OpenState } from '@/ui/popoverStore'

/*
 * The Radix half of Popover (src/ui/Popover.tsx says why it is a module of its own): downloaded once the page has drawn, or when a
 * menu is first reached for. Everything here is the previous implementation, unchanged.
 */
/**
 * Radix's Root, with its open state known here so phone Back can close an open menu or popover instead of leaving the
 * page (hunt HE-19; dialogs and sheets already do this with useBackToClose). Controlled or uncontrolled, as Radix's.
 */
export function PopoverImpl({ open: openProp, defaultOpen, onOpenChange, ...rest }: ComponentPropsWithoutRef<typeof RadixPopover.Root>) {
  const [own, setOwn] = useState(defaultOpen ?? false)
  const open = openProp ?? own
  const controlled = openProp !== undefined
  const set = useCallback(
    (next: boolean) => {
      if (!controlled) setOwn(next)
      onOpenChange?.(next)
    },
    [controlled, onOpenChange],
  )
  const state = useMemo(() => ({ open, close: () => set(false) }), [open, set])
  return (
    <OpenState.Provider value={state}>
      <RadixPopover.Root {...rest} open={open} onOpenChange={set} />
    </OpenState.Provider>
  )
}
export const PopoverTriggerImpl = RadixPopover.Trigger
export const PopoverAnchorImpl = RadixPopover.Anchor
export const PopoverCloseImpl = RadixPopover.Close

export type ContentProps = Omit<ComponentPropsWithoutRef<typeof RadixPopover.Content>, 'role'> & {
  variant?: 'menu' | 'information'
  /** information only: 'dialog' names it as one (InfoTip). The menu variant is always role="menu". */
  role?: 'dialog'
}

const FOCUSABLE_ITEM = '[role="menuitem"]:not([disabled]),[role="menuitemradio"]:not([disabled])'

export const PopoverContentImpl = forwardRef<ElementRef<typeof RadixPopover.Content>, ContentProps>(function PopoverContent(
  { variant = 'information', role, className, sideOffset = 4, align = 'start', onKeyDown, onOpenAutoFocus, children, ...rest },
  ref,
) {
  const isMenu = variant === 'menu'
  const inner = useRef<HTMLDivElement | null>(null)
  const state = useContext(OpenState)
  // Phones only: there Back is the way out of a menu; on a desktop an extra history entry per menu would be noise.
  const phone = useMediaQuery('(max-width: 767.98px)')
  useBackToClose(Boolean(state?.open), () => state?.close(), { enabled: phone && state !== null })
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
        // A labelled information popover is a dialog (an aria-label on a role-less div is ignored, WCAG 4.1.2).
        role={isMenu ? 'menu' : (role ?? (rest['aria-label'] || rest['aria-labelledby'] ? 'dialog' : undefined))}
        onClickCapture={isMenu ? () => rememberMenuTrigger(inner.current) : undefined}
        onKeyDownCapture={isMenu ? e => (e.key === 'Enter' || e.key === ' ') && rememberMenuTrigger(inner.current) : undefined}
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
          isMenu ? 'max-h-[var(--radix-popover-content-available-height)] min-w-[200px] overflow-y-auto p-1' : 'max-w-[320px] p-4 text-sm',
          className,
        )}
        {...rest}
      >
        {children}
      </RadixPopover.Content>
    </RadixPopover.Portal>
  )
})

