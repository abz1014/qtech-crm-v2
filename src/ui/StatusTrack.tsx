import { cn } from '@/lib/utils'
import { useResolved } from '@/lib/useResolved'
import { StatusBadge } from '@/ui/StatusBadge'

/*
 * StatusTrack: the three-step track beside a chip, for the invoice courier (TCS)
 * and FBR dimensions (money-01, money-02). The steps are for the eye; the chip's
 * label says the same thing in words.
 */
interface StatusTrackProps {
  dimension: 'tcs' | 'fbr'
  value: string
  className?: string
}

const STEPS = [1, 2, 3] as const

export function StatusTrack({ dimension, value, className }: StatusTrackProps) {
  const s = useResolved(dimension, value)
  const done = s?.step ?? 0
  return (
    <span className={cn('inline-flex items-center gap-2', className)} data-status={s?.key}>
      <span aria-hidden="true" className="inline-flex gap-[2px]">
        {STEPS.map(n => (
          <i
            key={n}
            data-on={n <= done ? '' : undefined}
            className={cn('h-1 w-[14px] rounded-[1px]', n <= done ? 'bg-status-fg' : 'bg-selected ring-1 ring-inset ring-line')}
          />
        ))}
      </span>
      <StatusBadge dimension={dimension} value={value} />
      <span className="sr-only">{`Step ${done} of 3`}</span>
    </span>
  )
}
