import { Check, Minus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { stageModel, type JobStanding, type StopState, type StopView } from '@/features/jobs/lib/stages'

/*
 * The job's ruler (redesign plan, "Stage bar"): seven stops, the current one the earliest not finished, parallel sub-states written
 * under their stop. Colour is never alone: every stop has a mark (a tick, its number, a dash, a cross) and its name.
 *   - desktop: the full ruler, each stop a button that opens its stage below when `onSelect` is given
 *   - phone:   "Stage 4 of 7 · Supplier order" over a thin seven-part bar (the full ruler would be seven names at 320 px)
 *   - mini:    the seven-part bar and the words, one line, for a list row
 * A direct order (job O-45) draws Enquiry and Quotation as "none"; a lost or cancelled job ends with its reason.
 */
const DOT: Record<StopState, string> = {
  done: 'bg-tone-success-bg text-tone-success-fg border-tone-success-fg',
  current: 'bg-chrome text-chrome-fg border-chrome',
  future: 'bg-surface text-fg-muted border-line-strong border-dashed',
  none: 'bg-sunken text-fg-muted border-line border-dashed',
  stopped: 'bg-sunken text-fg-muted border-line',
}
const SEG: Record<StopState, string> = {
  done: 'bg-tone-success-fg',
  current: 'bg-chrome',
  future: 'bg-line-strong',
  none: 'bg-line',
  stopped: 'bg-line',
}

function Mark({ s }: { s: StopView }) {
  if (s.state === 'done') return <Icon icon={Check} size="sm" />
  if (s.state === 'none') return <Icon icon={Minus} size="sm" />
  if (s.state === 'stopped') return <Icon icon={X} size="sm" />
  return <span className="num text-sm font-semibold">{s.index + 1}</span>
}

/** The state in words, for screen readers and for the stop's tooltip. */
const STATE_WORD: Record<StopState, string> = { done: 'done', current: 'now', future: 'not yet', none: 'not part of this job', stopped: 'not reached' }

export function StageBar({ job, onSelect, className }: { job: JobStanding; onSelect?: (index: number) => void; className?: string }) {
  const m = stageModel(job)
  return (
    <div className={cn('grid gap-3', className)} data-stage-bar>
      {/* phone form */}
      <div className="md:hidden">
        <p className="text-base font-semibold" data-stage-phone>
          {m.phoneLabel}
        </p>
        {m.current !== null && m.ending === null && m.detail ? <p className="text-base text-fg-2">{m.detail}</p> : null}
        <div className="mt-2 flex gap-1" aria-hidden="true">
          {m.stops.map(s => (
            <span key={s.name} className={cn('h-2 flex-1 rounded-round', SEG[s.state])} />
          ))}
        </div>
      </div>
      {/* desktop ruler */}
      <ol className="hidden grid-cols-7 gap-1 md:grid" aria-label="Stages of this job">
        {m.stops.map(s => {
          const body = (
            <>
              <span className="relative flex w-full items-center justify-center">
                <span aria-hidden="true" className={cn('absolute left-0 right-1/2 h-[2px]', s.index === 0 ? 'bg-transparent' : s.state === 'done' || s.state === 'current' ? 'bg-tone-success-fg' : 'bg-line-strong')} />
                <span aria-hidden="true" className={cn('absolute left-1/2 right-0 h-[2px]', s.index === 6 ? 'bg-transparent' : s.state === 'done' ? 'bg-tone-success-fg' : 'bg-line-strong')} />
                <span className={cn('relative z-[1] flex h-8 w-8 items-center justify-center rounded-round border-2', DOT[s.state], s.half && 'ring-2 ring-tone-success-fg ring-offset-2')}>
                  <Mark s={s} />
                </span>
              </span>
              <span className={cn('mt-2 text-center text-sm', s.state === 'current' ? 'font-semibold text-fg' : s.state === 'done' ? 'font-medium text-fg-2' : 'text-fg-muted')}>
                {s.shown}
                <span className="sr-only">{`, ${STATE_WORD[s.state]}`}</span>
              </span>
              {s.note ? <span className="mt-px text-center text-sm text-fg-2">{s.note}</span> : null}
              {s.state === 'none' ? <span className="mt-px text-center text-sm text-fg-muted">none</span> : null}
            </>
          )
          return (
            <li key={s.name} className="flex min-w-0 flex-col items-stretch" aria-current={s.state === 'current' ? 'step' : undefined}>
              {onSelect && s.state !== 'none' ? (
                <button type="button" onClick={() => onSelect(s.index)} className="flex min-h-touch min-w-0 flex-col items-stretch rounded px-1 py-1 hover:bg-sunken">
                  {body}
                </button>
              ) : (
                <div className="flex min-w-0 flex-col items-stretch px-1 py-1">{body}</div>
              )}
            </li>
          )
        })}
      </ol>
      {m.ending ? (
        <p className="text-base font-semibold text-tone-danger-fg" data-stage-ending>
          {m.ending}
        </p>
      ) : null}
    </div>
  )
}

/** The list row's one line: the seven-part bar over the stop and its detail. */
export function StageMini({ job }: { job: JobStanding }) {
  const m = stageModel(job)
  return (
    <span className="grid min-w-[160px] gap-1 whitespace-normal" data-stage-mini>
      <span className="flex w-[7rem] gap-[3px]" aria-hidden="true">
        {m.stops.map(s => (
          <span key={s.name} className={cn('h-[6px] flex-1 rounded-round', SEG[s.state])} />
        ))}
      </span>
      <span className="text-sm">{m.label}</span>
    </span>
  )
}
