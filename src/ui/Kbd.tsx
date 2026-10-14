import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Key hint (`⌘K`, `Esc`, `Enter`). Decorative: the control it sits in names the action. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-b-2 border-line-strong bg-surface px-1',
        'font-sans text-xs font-medium leading-none text-fg-muted',
        className,
      )}
    >
      {children}
    </kbd>
  )
}
