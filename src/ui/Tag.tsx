import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Tag: a mono identifier (ORD-0038, RFQ-0177) or brand tag. Dashed when the value is not firm. */
export function Tag({ children, dashed, className }: { children: ReactNode; dashed?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'num inline-flex h-5 items-center whitespace-nowrap rounded border px-[6px] text-xs leading-none',
        dashed ? 'border-dashed border-line-strong text-fg-muted' : 'border-line-strong bg-surface text-fg-2',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** CountPill: a count beside a tab or group name. */
export function CountPill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={cn('num inline-grid h-4 min-w-4 place-items-center rounded-round bg-selected px-1 text-xs leading-none text-fg', className)}>
      {children}
    </span>
  )
}

/** ProgressSegments: "n of m" as segments, with the count in words beside them. */
export function ProgressSegments({ done, total, className }: { done: number; total: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span aria-hidden="true" className="inline-flex gap-[2px]">
        {Array.from({ length: total }, (_, i) => (
          <i key={i} className={cn('h-1 w-[14px] rounded-[1px]', i < done ? 'bg-brand-green' : 'bg-selected ring-1 ring-inset ring-line')} />
        ))}
      </span>
      <span className="num text-xs text-fg-muted">{`${done} of ${total}`}</span>
    </span>
  )
}
