import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { useResolved } from '@/lib/useResolved'
import type { StatusDimension } from '@/lib/status'

/*
 * StatusBadge (D08 section 02): shape + colour + label, never colour alone. The
 * glyph and label come from the registry (src/lib/status.ts); the colours come
 * from the data-status map in tokens.css through --status-fg / --status-bg.
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
        'inline-flex h-5 items-center gap-[5px] whitespace-nowrap rounded border bg-status-bg pl-[6px] pr-2 text-xs font-medium leading-none text-status-fg',
        !s && 'bg-tone-neutral-bg text-tone-neutral-fg',
        className,
      )}
    >
      {s ? <Icon icon={s.icon} size="chip" /> : null}
      {label ?? s?.label ?? 'Unknown'}
      {detail ? <span className="num font-regular">{detail}</span> : null}
    </span>
  )
}
