import { useId, useState } from 'react'
import { ChevronDown, CircleCheck, Clock } from 'lucide-react'
import { formatAmount } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { useMyTarget } from '@/features/today/hooks'
import { millions, targetWorking, type TargetWorking } from '@/features/today/targetModel'

/*
 * Target tile (g2-today-b2 "Target tile, with the working"). The person's OWN quarter only: my_target_progress() takes
 * no parameters, so nobody else's number can reach this component. A status, never a task: it creates no list item and
 * sends no reminder. The day line opens the working, so every figure shows where it came from.
 */
const pkr = (n: number) => `PKR ${formatAmount(n)}`

export function TargetTile({ today, className }: { today: string; className?: string }) {
  const q = useMyTarget()
  const [open, setOpen] = useState(false)
  const panel = useId()

  if (q.isPending) return <div className={cn('grid gap-2 p-4', className)} aria-busy="true"><Skeleton className="h-4 w-1/2" /><Skeleton className="h-6 w-2/3" /><Skeleton className="h-2 w-full" /></div>
  if (q.isError) {
    return (
      <div className={cn('p-4 text-sm text-fg-muted', className)}>
        Your target could not be read. <button type="button" className="underline" onClick={() => void q.refetch()}>Try again</button>
      </div>
    )
  }
  const w = q.data ? targetWorking(q.data, today) : null
  if (!w) {
    const quarter = q.data?.quarter ?? Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1
    return (
      <section aria-label={`Your Q${quarter} target`} className={cn('grid gap-1 p-4', className)}>
        <p className="text-sm text-fg-muted">Your Q{quarter} target</p>
        <p className="text-base font-semibold">No target set for Q{quarter}</p>
        <p className="text-sm text-fg-muted">Ask an admin to set one in Settings, under Targets. Nothing else on Today depends on it.</p>
      </section>
    )
  }
  return (
    <section aria-label={`Your ${w.label} target`} className={cn('grid gap-2 p-4', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <p className="whitespace-nowrap text-sm text-fg-muted">Your {w.label} target</p>
        <Status w={w} />
      </div>
      <p className="text-lg">
        <span className="num font-medium" title={`Exact: ${pkr(w.achieved)}`}>{pkr(w.achieved)}</span>{' '}
        <span className="num text-xs text-fg-muted">of {pkr(w.target)}</span>
      </p>
      <div className="grid gap-1">
        <p className="num text-xs" style={{ paddingLeft: `min(${w.markerPct}%, calc(100% - 9rem))` }}>
          on pace PKR {millions(w.onPace)}
        </p>
        <div
          role="img"
          aria-label={`Achieved ${pkr(w.achieved)} of ${pkr(w.target)}; on pace today ${pkr(w.onPaceExact)}`}
          title={`Exact: achieved ${w.achieved}, on pace ${w.onPaceExact}, target ${w.target}`}
          className="relative h-2 overflow-hidden rounded bg-selected"
        >
          <span className="absolute inset-y-0 left-0 bg-brand-green" style={{ width: `${w.fillPct}%` }} />
          {w.markerPct > w.fillPct ? (
            <span
              className="absolute inset-y-0"
              style={{
                left: `${w.fillPct}%`,
                width: `${w.markerPct - w.fillPct}%`,
                // the shortfall is hatched: the gap to where you should be, not a second amount
                backgroundImage: 'repeating-linear-gradient(135deg, var(--tone-warning-fg) 0 1.5px, transparent 1.5px 4px)',
              }}
            />
          ) : null}
          <span className="absolute inset-y-0 w-px bg-fg" style={{ left: `${w.markerPct}%` }} />
        </div>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 justify-self-start rounded text-xs text-fg-muted hover:text-fg"
      >
        <span className="num">Day {w.dayOfQuarter} of {w.daysInQuarter}</span>
        <Icon icon={ChevronDown} size="chip" className={cn('transition-transform duration-fast', open && 'rotate-180')} />
        <span>· {w.daysLeft} days left</span>
      </button>
      {open ? (
        <div id={panel} className="grid gap-1 rounded bg-sunken p-3 text-xs">
          <Row k={`Target for ${w.label} (${w.startText} to ${w.endText})`} v={pkr(w.target)} />
          <Row k="Share of the quarter gone" v={`${w.dayOfQuarter} ÷ ${w.daysInQuarter} days`} />
          <Row k="On pace today" v={pkr(w.onPace)} />
          <Row k="Achieved so far" v={`− ${pkr(w.achieved)}`} />
          <div className="my-1 border-t" />
          <Row k={w.status === 'ahead' ? 'Ahead of pace' : 'Behind pace'} v={pkr(w.status === 'ahead' ? w.ahead : w.behind)} strong />
          <p className="mt-1 text-fg-muted">
            Net cash received by you since {w.startText}, GST left out. Shown to the nearest PKR 10,000: exact on pace {formatAmount(w.onPaceExact)}
            {w.status === 'ahead' ? `, ahead ${formatAmount(w.aheadExact)}` : `, behind ${formatAmount(w.behindExact)}`}.
            {w.excludedCount > 0 ? ` ${w.excludedCount} ${w.excludedCount === 1 ? 'payment is' : 'payments are'} not counted yet (basis unknown).` : ''}
          </p>
        </div>
      ) : null}
    </section>
  )
}

function Status({ w }: { w: TargetWorking }) {
  if (w.status === 'ahead') {
    return (
      <span className="num inline-flex items-center gap-1 whitespace-nowrap text-xs text-tone-success-fg sm:text-sm">
        <Icon icon={CircleCheck} size="sm" /> {pkr(w.ahead)} ahead of pace
      </span>
    )
  }
  if (w.status === 'on_pace') return <span className="inline-flex items-center gap-1 text-sm text-tone-success-fg"><Icon icon={CircleCheck} size="sm" /> On pace</span>
  return (
    <span className="num inline-flex items-center gap-1 whitespace-nowrap text-xs text-tone-warning-fg sm:text-sm">
      <Icon icon={Clock} size="sm" /> {pkr(w.behind)} behind pace
    </span>
  )
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className={cn('flex justify-between gap-3', strong && 'font-medium text-tone-warning-fg')}>
      <span>{k}</span>
      <span className="num">{v}</span>
    </div>
  )
}
