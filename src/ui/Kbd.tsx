import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Key hint (`⌘K`, `Esc`, `Enter`). Decorative: the control it sits in names the action.
 * `size="inline"` is one text line tall, for a key inside a tooltip or a sentence; the default is a chip.
 * Both heights come from tokens, so the key grows with the text size instead of clipping it.
 */
export function Kbd({
  children,
  size = 'chip',
  className,
  'aria-hidden': ariaHidden,
}: {
  children: ReactNode
  size?: 'chip' | 'inline'
  className?: string
  /** Hide the hint from the accessible name of the control it sits in (axe label-content-name-mismatch): pair it with aria-keyshortcuts there. */
  'aria-hidden'?: boolean
}) {
  return (
    <kbd
      aria-hidden={ariaHidden || undefined}
      className={cn(
        'inline-flex items-center justify-center rounded border border-b-2 border-line-strong bg-surface',
        size === 'chip' ? 'h-chip min-w-chip px-[6px]' : 'h-[var(--lh-xs)] min-w-[var(--lh-xs)] px-1',
        'font-sans text-xs font-medium leading-none text-fg-muted',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
