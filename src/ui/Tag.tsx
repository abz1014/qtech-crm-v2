import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** Tag: a mono identifier (ORD-0038, RFQ-0177) or brand tag. Dashed when the value is not firm. */
export function Tag({ children, dashed, className }: { children: ReactNode; dashed?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'num inline-flex min-h-chip items-center whitespace-nowrap rounded border px-[6px] py-px text-xs leading-none',
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
    <span className={cn('num inline-grid h-[var(--lh-xs)] min-w-[var(--lh-xs)] place-items-center rounded-round bg-selected px-[6px] text-xs leading-none text-fg', className)}>
      {children}
    </span>
  )
}

/**
 * CountBadge: a count pinned to the top-right of an icon (the phone tabs show the top bar's counts this way).
 * Two px under the xs size so it stays small beside a 20px glyph, never under 11px (Smaller text); over 99 reads "99+". Decorative: the
 * control it sits in says the count in words for screen readers.
 */
export function CountBadge({ count, className }: { count: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      data-count=""
      className={cn(
        'num absolute -top-[6px] left-[calc(100%-7px)] inline-grid h-[max(16px,calc(var(--lh-xs)-2px))] min-w-[max(16px,calc(var(--lh-xs)-2px))] place-items-center',
        'rounded-round bg-primary px-[5px] text-[length:max(11px,calc(var(--text-xs)-2px))] font-medium leading-none text-primary-foreground ring-2 ring-surface',
        className,
      )}
    >
      {count > 99 ? '99+' : count}
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
      <span className="num text-xs text-fg-2">{`${done} of ${total}`}</span>
    </span>
  )
}

/*
 * ProgressBar (components-01, "3 of 5 items covered"): the continuous 6px bar for a card or a panel, where
 * ProgressSegments is the n-of-m form for a table row. The fill is brand green on the selected track; an
 * optional marker (a 2px ink tick, such as "today" on a schedule) sits at `marker` percent. The bar is an image
 * to assistive tech, named by `label` ("3 of 5 items covered"), so the sentence is always on the page too.
 */
export function ProgressBar({
  done,
  total,
  label,
  marker,
  className,
}: {
  done: number
  total: number
  label?: string
  /** 0 to 100: a tick on the track. */
  marker?: number
  className?: string
}) {
  const pct = total <= 0 ? 0 : Math.min(100, Math.max(0, (done / total) * 100))
  return (
    <div role="img" aria-label={label ?? `${done} of ${total}`} className={cn('relative h-[6px] rounded-round bg-selected', className)}>
      <i className="absolute inset-y-0 left-0 rounded-round bg-brand-green" style={{ width: `${pct}%` }} />
      {marker !== undefined ? <b className="absolute -bottom-1 -top-1 -ml-px w-[2px] rounded-[1px] bg-fg" style={{ left: `${marker}%` }} /> : null}
    </div>
  )
}
