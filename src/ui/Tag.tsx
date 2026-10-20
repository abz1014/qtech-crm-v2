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

/*
 * NeedsCount (consistency spec 2.1): the ONLY number drawn beside a nav item, tab, segmented option or toggle, and it always
 * means "items that need someone on our side to act". Any other count is written in words (a lede, a footer, "Waiting · 5").
 *   <NeedsCount n={4} />                    warning tint, mono; screen readers hear ", 4 need you"
 *   <NeedsCount n={2} variant="danger" />   critical items (Things to check)
 *   <NeedsCount n={4} badge />              solid warning dot pinned to the top-right of an icon (phone tabs); needs a
 *                                           `relative` parent. Over 99 reads "99+".
 * Renders nothing for 0 (or a missing count): a pill is never shown for zero. `sr` replaces the spoken words when
 * ", N need you" does not fit ("2 critical"); pass it without the leading comma.
 */
export function NeedsCount({
  n,
  variant = 'warning',
  badge = false,
  sr,
  className,
}: {
  n: number | null | undefined
  variant?: 'warning' | 'danger'
  badge?: boolean
  sr?: string
  className?: string
}) {
  if (!n || n <= 0) return null
  const shown = badge && n > 99 ? '99+' : String(n)
  return (
    <>
      <span
        aria-hidden="true"
        data-needs-count={variant}
        className={cn(
          'num inline-grid place-items-center rounded-round leading-none',
          badge
            ? cn(
                'absolute -top-[6px] left-[calc(100%-7px)] h-[max(16px,calc(var(--lh-xs)-2px))] min-w-[max(16px,calc(var(--lh-xs)-2px))] px-[5px]',
                'text-[length:max(11px,calc(var(--text-xs)-2px))] font-medium text-surface ring-2 ring-surface',
                variant === 'danger' ? 'bg-tone-danger-fg' : 'bg-tone-warning-fg',
              )
            : cn(
                'h-[var(--lh-xs)] min-w-[var(--lh-xs)] px-[6px] text-xs font-medium',
                variant === 'danger' ? 'bg-tone-danger-bg text-tone-danger-fg' : 'bg-tone-warning-bg text-tone-warning-fg',
              ),
          className,
        )}
      >
        {shown}
      </span>
      <span className="sr-only">{`, ${sr ?? `${n} need you`}`}</span>
    </>
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
