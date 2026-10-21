import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, CircleCheck, Clock } from 'lucide-react'
import { formatAmount } from '@/lib/money'
import { cn } from '@/lib/utils'
import { useSession } from '@/app/session'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { Skeleton } from '@/ui/Skeleton'
import { useMyTarget } from '@/features/today/hooks'
import { millions, targetWorking, type TargetWorking } from '@/features/today/targetModel'

/*
 * Target tile (g2-today-b2 "Target tile, with the working"). The person's OWN quarter only: my_target_progress() takes
 * no parameters, so nobody else's number can reach this component. A status, never a task: it creates no list item and
 * sends no reminder. The day line opens the working, so every figure shows where it came from.
 */
// Whole rupees on the tile and in the working (audit T3: "PKR 3,862,102", not "3,862,101.69"); the hover title keeps the paisa.
const rupees = (n: number) => formatAmount(n, 'never')
const pkr = (n: number) => `PKR ${rupees(n)}`

export function TargetTile({ today, className }: { today: string; className?: string }) {
  const q = useMyTarget()
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
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
    // One small line, not a block: with no target there is nothing to show, and the list above needs the room.
    return (
      <section aria-label={`Your Q${quarter} target`} data-target-empty className={cn('px-4 py-2 text-sm text-fg-muted', className)}>
        No Q{quarter} target set.{' '}
        {isAdmin ? (
          <Link to="/settings/targets" className="font-medium text-primary underline underline-offset-2">
            Set targets
          </Link>
        ) : (
          'The admin sets it.'
        )}
      </section>
    )
  }
  return (
    <section aria-label={`Your ${w.label} target`} className={cn('grid grid-cols-[minmax(0,1fr)] gap-2 p-4', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="whitespace-nowrap text-sm text-fg-muted">Your {w.label} target <InfoTip label="About your target">Money received this quarter on your orders, without GST. Set by the admin.</InfoTip></p>
        <Status w={w} />
      </div>
      <p className="text-lg">
        <span className="num font-medium" title={`Exact: PKR ${formatAmount(w.achieved)}`}>{pkr(w.achieved)}</span>{' '}
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
            Net cash received by you since {w.startText}, GST left out. Shown to the nearest PKR 10,000: exact on pace {rupees(w.onPaceExact)}
            {w.status === 'ahead' ? `, ahead ${rupees(w.aheadExact)}` : `, behind ${rupees(w.behindExact)}`}.
            {w.excludedCount > 0 ? ` ${w.excludedCount} ${w.excludedCount === 1 ? 'payment is' : 'payments are'} not counted yet: nobody has said whether GST is included.` : ''}
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
