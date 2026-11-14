import type { ReactNode } from 'react'
import { Check, CircleAlert, Minus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import type { StepTone } from '@/lib/status'
import { STEP_CHIP } from '@/features/jobs/lib/stepChip'
import { stageModel, type JobStanding, type StopState, type StopView } from '@/features/jobs/lib/stages'

/*
 * The job's ruler (redesign plan, "Stage bar"): seven stops, the current one the earliest not finished, parallel sub-states written
 * under their stop. Colour is never alone: every stop has a mark (a tick, a ringed dot, a dash, a cross) and its name.
 *   - track:   the Job page's seven dots on one line (Forest .qb-track), names under them from 768 px, the head line on a phone
 *   - block:   the Job page's hero ("Next step") and the track card (StageBlock)
 *   - mini:    the seven-part bar and the words, one line, for a list row
 * A direct order (job O-45) draws Enquiry and Quotation as "none"; a lost or cancelled job ends with its reason.
 */
const SEG: Record<StopState, string> = {
  done: 'bg-tone-success-fg',
  current: 'bg-chrome',
  future: 'bg-line-strong',
  none: 'bg-line',
  stopped: 'bg-line',
}

/** The state in words, for screen readers (the dot's mark and the label's weight carry it for the eye). */
const STATE_WORD: Record<StopState, string> = { done: 'done', current: 'now', future: 'not yet', none: 'not part of this job', stopped: 'not reached' }

// Forest .qb-track: a filled forest dot with a tick (done), a ringed dot (now), an empty dot (not yet), dashed (not part of this job).
const DOT: Record<StopState, string> = {
  done: 'border-brand-700 bg-brand-700 text-chrome-fg',
  current: 'border-brand-500 bg-brand-100 text-brand-700 shadow-current',
  future: 'border-deep bg-surface text-fg-muted',
  none: 'border-dashed border-line-strong bg-deep text-fg-muted',
  stopped: 'border-tone-danger-fg bg-surface text-tone-danger-fg',
}

function Mark({ s }: { s: StopView }) {
  // A heavy stroke (the mockup's 3): at 16 px the default 1.75 stroke is too faint to read as a tick on the forest dot.
  const Glyph = s.state === 'done' ? Check : s.state === 'none' ? Minus : s.state === 'stopped' ? X : null
  if (Glyph) return <Glyph aria-hidden="true" className="size-4 shrink-0" strokeWidth={3} />
  if (s.state === 'current') return <span className="size-3 rounded-pill bg-brand-700" />
  return null
}

/**
 * The seven stops (30-job-page.html, .qb-track): a dot per stop on one line, the line filled up to the stop the job is at. On a
 * computer each stop has its name and, under it, the parallel sub-state ("2 of 3 delivered", "advance received"); on a phone the head
 * line ("Stage 5 of 7 · Delivery") says it and the names are read by a screen reader only. Colour is never alone: every dot has a mark.
 */
export function StageTrack({ job }: { job: JobStanding }) {
  const m = stageModel(job)
  return (
    <ol className="grid grid-cols-7" aria-label="Stages of this job" data-stage-bar>
      {m.stops.map(s => {
        const lit = s.state === 'done' || s.state === 'current'
        return (
          <li key={s.name} className="relative grid min-w-0 content-start justify-items-center gap-2 text-center" aria-current={s.state === 'current' ? 'step' : undefined}>
            {s.index > 0 ? <span aria-hidden="true" className={cn('absolute left-[calc(-50%+var(--sp-4))] right-[calc(50%+var(--sp-4))] top-4 h-1 -translate-y-1/2 rounded-pill', lit ? 'bg-brand-500' : 'bg-deep')} /> : null}
            <span aria-hidden="true" className={cn('relative grid size-8 place-items-center rounded-pill border-2', DOT[s.state], s.half && 'outline outline-2 outline-offset-2 outline-brand-500')}>
              <Mark s={s} />
            </span>
            <span className={cn('min-w-0 text-sm [overflow-wrap:anywhere] max-md:sr-only', s.state === 'current' ? 'font-heavy text-fg' : s.state === 'done' ? 'text-fg-2' : 'text-fg-muted')}>
              {s.shown}
              <span className="sr-only">{`, ${STATE_WORD[s.state]}`}</span>
            </span>
            {s.note ? <span className="min-w-0 text-sm text-tone-warning-fg [overflow-wrap:anywhere] max-md:hidden">{s.note}</span> : null}
            {s.state === 'none' ? <span className="text-sm text-fg-muted max-md:hidden">none</span> : null}
          </li>
        )
      })}
    </ol>
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

/** A job card's stage, in two lines of one idea: "Stage 5 of 7 · Delivery" and a thin bar under it. The words carry the meaning; the bar is decoration. */
export function StageLine({ job }: { job: JobStanding }) {
  const m = stageModel(job)
  return (
    <span className="grid gap-1" data-stage-line>
      <span className="text-base text-fg-2">{m.phoneLabel}</span>
      <span className="flex gap-[3px]" aria-hidden="true">
        {m.stops.map(s => (
          <span key={s.name} className={cn('h-[6px] flex-1 rounded-round', SEG[s.state])} />
        ))}
      </span>
    </span>
  )
}

const CHIP = STEP_CHIP

/** "2 of 3 delivered, installation planned 28 Nov" as sentences: "2 of 3 delivered. Installation planned 28 Nov." */
const sentences = (detail: string | null) =>
  (detail ?? '')
    .split(', ')
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => `${p[0].toUpperCase()}${p.slice(1)}.`)
    .join(' ')

/**
 * The Job page's top (Forest, 30-job-page.html): the hero and the track card.
 *   Hero    on the forest: "Next step · Job 139" (an engineer reads "Where it stands"), who acts next as a chip, the step in one
 *           sentence, its detail, and on a computer the page's one green button. It is the page's "Next step" region.
 *   Track   "Stage 5 of 7 · Delivery" over the seven stops, then the key facts under a hairline. A lost or cancelled job ends with its
 *           reason instead of the stage line.
 */
export function StageBlock({
  job,
  label,
  text,
  tone,
  action,
  facts,
  between,
}: {
  job: JobStanding
  /** "Next step · Job 139", or "Where it stands" for an engineer. */
  label: string
  /** The step in one sentence ("Waiting for the goods"). */
  text: string
  tone: StepTone
  /** The page's one green button (a computer only; a phone has the sticky bar). */
  action?: ReactNode
  /** The key facts line, under the track. */
  facts?: ReactNode
  /** Drawn between the hero and the track (an engineer's On site card, on a computer). */
  between?: ReactNode
}) {
  const m = stageModel(job)
  const chip = CHIP[tone]
  const detail = m.ending ? null : sentences(m.detail)
  const title = text || (m.ending ?? m.label)
  return (
    <>
      <section aria-label="Next step" data-stage-block data-surface="navy" className="mt-4 grid gap-4 rounded-card bg-hero p-card text-fg shadow-e2 md:mt-6">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="text-base text-fg-2">{label}</p>
          <span data-tone={tone} className="inline-flex min-h-chip items-center gap-1 rounded-pill border border-line-strong py-px pl-2 pr-3 text-xs font-card leading-none">
            <Icon icon={chip.icon} size="chip" className="size-icon-chip" />
            {chip.word}
          </span>
        </div>
        <h2 className={cn('text-2xl font-heavy tracking-tight [overflow-wrap:anywhere] [text-wrap:balance] max-md:text-xl', tone === 'late' && 'text-tone-danger-bg')} data-next-text>
          {title}
        </h2>
        {detail ? <p className="-mt-2 text-base text-fg-2 [overflow-wrap:anywhere]">{detail}</p> : null}
        {action ? <div className="flex flex-wrap items-center gap-3 max-md:hidden">{action}</div> : null}
      </section>
      {between}
      <section aria-label="Stage of this job" data-stage-track className="mt-4 rounded-card border bg-surface p-card shadow-e1 md:mt-6">
        {m.ending ? (
          <p className="mb-4 flex items-center gap-2 text-lg font-card text-tone-danger-fg" data-stage-ending data-stage-phone>
            <Icon icon={CircleAlert} size="sm" />
            {m.ending}
          </p>
        ) : (
          <p className="mb-4 text-lg font-card" data-stage-phone>
            {m.phoneLabel}
          </p>
        )}
        <StageTrack job={job} />
        {facts}
      </section>
    </>
  )
}
