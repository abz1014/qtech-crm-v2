import type { CSSProperties } from 'react'
import { cn } from '@/lib/utils'
import { formatDay } from '@/lib/formatDay'
import { daysBetween, railState, type DateRailState } from '@/ui/dateRailModel'

export type { DateRailState } from '@/ui/dateRailModel'

/*
 * DateRail (D08 section 12, components-12): where today sits between the day something started and the
 * day it is due. Six states, each a tone plus words, never colour alone:
 *   on-track   neutral: the marker is today, the fill is time already spent
 *   due-soon   warning (the Today pane)
 *   due-today  danger; the label flips to the left of the marker near the end
 *   overdue    the track turns red and the label says how late
 *   done       success; names the day it was done ("Bid sent Wed 25 Nov")
 *   no-date    a dashed line and an honest label, no invented date
 * Dates are always real days ("Tue 1 Dec"), never "in a few days". The fill draws once from the left
 * (reduced motion: no draw-in, through the duration token). Pass `state` to force one, for example the Today
 * pane always shows due-soon; otherwise it is worked out from the dates: done when `doneOn` is set, overdue past
 * the due day, due-today on it, due-soon within 4 days, on-track before that.
 */
const TONE: Record<DateRailState, { fg: string; dot: string }> = {
  'on-track': { fg: 'text-fg-muted', dot: 'bg-fg-muted' },
  'due-soon': { fg: 'text-tone-warning-fg', dot: 'bg-tone-warning-fg' },
  'due-today': { fg: 'text-tone-danger-fg', dot: 'bg-tone-danger-fg' },
  overdue: { fg: 'text-tone-danger-fg', dot: 'bg-tone-danger-fg' },
  done: { fg: 'text-tone-success-fg', dot: 'bg-tone-success-fg' },
  'no-date': { fg: 'text-fg-muted', dot: 'bg-fg-muted' },
}

export interface DateRailProps {
  /** The day it started (YYYY-MM-DD). */
  start: string
  /** The day it is due, or null when there is none. */
  due: string | null
  /** Today in the business timezone (businessToday()). */
  today: string
  /** The day it was done: puts the rail in the done state. */
  doneOn?: string | null
  /** Force a state instead of working it out. */
  state?: DateRailState
  /** The word before the start date. Default "Asked". */
  startLabel?: string
  /** The word before the due date. Default "Bid due". */
  dueLabel?: string
  /** The word before the done date. Default "Bid sent". */
  doneLabel?: string
  /** Replaces the marker label ("Today · 17:00"). */
  todayLabel?: string
  /** The marker label with no date. Default "No bid date on this RFQ". */
  noDateLabel?: string
  /** The rail repeats what the page already says in words: hide it from assistive tech. */
  decorative?: boolean
  className?: string
}

export function DateRail({
  start,
  due,
  today,
  doneOn,
  state,
  startLabel = 'Asked',
  dueLabel = 'Bid due',
  doneLabel = 'Bid sent',
  todayLabel,
  noDateLabel = 'No bid date on this RFQ',
  decorative,
  className,
}: DateRailProps) {
  const st = state ?? railState(due, today, doneOn)
  const total = due ? Math.max(1, daysBetween(start, due)) : 1
  // Due today sits at 96% as in the mockup, so the marker stays on the track and the label has room to flip.
  const pos =
    st === 'done' || st === 'overdue' ? 100 : st === 'no-date' ? 0 : Math.min(st === 'due-today' ? 96 : 100, Math.max(0, (daysBetween(start, today) / total) * 100))
  const late = due ? daysBetween(due, today) : 0

  const label =
    todayLabel ??
    (st === 'overdue'
      ? `${late} ${late === 1 ? 'day' : 'days'} overdue`
      : st === 'done'
        ? `${doneLabel} ${doneOn ? formatDay(doneOn) : ''}`.trim()
        : st === 'no-date'
          ? noDateLabel
          : `Today · ${formatDay(today)}`)
  const side = st === 'no-date' || pos <= 12 ? 'left' : pos >= 75 ? 'right' : 'centre'
  const tone = TONE[st]

  return (
    <div
      data-rail-state={st}
      aria-hidden={decorative ? 'true' : undefined}
      style={{ '--p': `${pos}%` } as CSSProperties}
      className={cn('relative min-w-0 pt-[18px]', className)}
    >
      <span
        className={cn(
          'num absolute left-[var(--p)] top-0 whitespace-nowrap text-xs font-medium leading-[14px]',
          tone.fg,
          side === 'centre' && '-translate-x-1/2',
          side === 'right' && '-translate-x-full',
        )}
      >
        {label}
      </span>
      <div
        className={cn(
          'relative',
          st === 'no-date' ? 'h-0 border-t-2 border-dashed border-line-strong' : 'h-1 rounded-round',
          st === 'overdue' ? 'bg-tone-danger-bg' : st === 'no-date' ? '' : 'bg-selected',
        )}
      >
        {st === 'no-date' ? null : (
          <>
            <i
              className={cn(
                'absolute inset-y-0 left-0 origin-left animate-rail-grow rounded-round',
                st === 'overdue' ? 'bg-tone-danger-fg' : 'bg-fg-muted',
              )}
              style={{ width: 'var(--p)' }}
            />
            <em className={cn('absolute left-[var(--p)] top-1/2 -ml-[5px] -mt-[5px] size-[10px] rounded-round ring-2 ring-surface', tone.dot)} />
          </>
        )}
      </div>
      <div className="num mt-[6px] flex justify-between gap-3 text-xs text-fg-muted">
        <span>{`${startLabel} ${formatDay(start)}`}</span>
        <span>{due ? `${dueLabel} ${formatDay(due)}` : 'No due date'}</span>
      </div>
    </div>
  )
}
