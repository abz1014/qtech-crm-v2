import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { useResolved } from '@/lib/useResolved'
import type { StatusDimension } from '@/lib/status'

/*
 * StatusBadge (D08 section 02): shape + colour + label, never colour alone. The
 * glyph and label come from the registry (src/lib/status.ts); the colours come
 * from the data-status map in tokens.css through --status-fg / --status-bg.
 * The glyph is 16px (12 with smaller text) and the label medium weight, so neutral,
 * info and success chips differ by shape and word, not by colour alone. Height is
 * --chip-h (24, or 20) and grows with the text rather than clipping it.
 */
interface StatusBadgeProps {
  dimension: StatusDimension
  /** A view output ("floated_awaiting") or a slug ("awaiting"). An unknown value throws in development and tests. */
  value: string
  /** Replaces the registry label when the situation is more specific ("Due today"). Keep the meaning. */
  label?: string
  /** Mono suffix such as a count or age ("2 of 5", "14 days"). */
  detail?: string
  className?: string
}

export function StatusBadge({ dimension, value, label, detail, className }: StatusBadgeProps) {
  const s = useResolved(dimension, value)
  return (
    <span
      data-status={s?.key ?? 'unknown'}
      style={{
        borderStyle: 'var(--status-border-style, solid)',
        borderColor: 'color-mix(in srgb, var(--status-fg, var(--tone-neutral-fg)) 24%, transparent)',
      }}
      className={cn(
        'inline-flex min-h-chip items-center gap-[6px] whitespace-nowrap rounded border bg-status-bg py-px pl-[6px] pr-2 text-xs font-medium leading-none text-status-fg',
        !s && 'bg-tone-neutral-bg text-tone-neutral-fg',
        className,
      )}
    >
      {s ? <Icon icon={s.icon} size="chip" className="size-icon-chip" /> : null}
      {label ?? s?.label ?? 'Unknown'}
      {detail ? <span className="num font-regular">{detail}</span> : null}
    </span>
  )
}
