import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { useResolved } from '@/lib/useResolved'
import { TONE_ICON, TONE_OF_STEP, type StatusDimension, type StepTone, type Tone } from '@/lib/status'

/*
 * StatusText (DESIGN_SYSTEM section 6): a state as an icon and a word, no box, with an optional second line.
 * Used for every Next step column, status-strip cells, history rows and money reports; the tinted chip
 * (StatusBadge) is kept for the chip row under a title and for state columns. Colour is never alone: the
 * icon comes from the tone (or the registry's override) and the word always shows. Body size (text-sm).
 *
 *   <StatusText tone="now" detail="12 days">Send a reminder</StatusText>
 *   <StatusText dimension="goods" value="on_order" detail="Due 3 Nov" />
 *
 * The registry form also draws the "hidden" keys (Open, Active, Not needed): they never get a chip, but
 * they may be written as text.
 */

const STEP_OF_TONE: Record<Tone, StepTone> = { danger: 'late', warning: 'now', info: 'waiting', success: 'done', neutral: 'inert' }

/** Text and icon colours per tone (rule 5): we act = strong text, amber icon; waiting / done / inert = muted text. */
const TEXT: Record<StepTone, string> = {
  late: 'font-medium text-tone-danger-fg',
  now: 'font-medium text-fg',
  waiting: 'text-fg-muted',
  done: 'text-fg-muted',
  inert: 'text-fg-muted',
}
const ICON: Record<StepTone, string> = {
  late: 'text-tone-danger-fg',
  now: 'text-tone-warning-fg',
  waiting: 'text-tone-info-fg',
  done: 'text-tone-success-fg',
  inert: 'text-tone-neutral-fg',
}

interface Common {
  /** A second line under the word (a date, an amount, "12 days"). */
  detail?: ReactNode
  className?: string
}

type StatusTextProps =
  | (Common & {
      tone: StepTone
      /** The word(s): "Send a reminder", "Paid". */
      children: ReactNode
      /** Overrides the tone's glyph (only the registry overrides: Ban, Lock, CalendarClock, CircleDashed). */
      icon?: LucideIcon
      dimension?: never
      value?: never
      label?: never
    })
  | (Common & {
      dimension: StatusDimension
      /** A view output ("floated_awaiting") or a slug ("awaiting"). An unknown value throws in development and tests. */
      value: string
      /** Replaces the registry word when the situation is more specific ("Due today"). Keep the meaning. */
      label?: string
      /** A second line, as `detail`. */
      children?: ReactNode
      tone?: never
      icon?: never
    })

export function StatusText(props: StatusTextProps) {
  if (props.dimension !== undefined) return <FromRegistry {...props} />
  return <StatusTextView tone={props.tone} icon={props.icon} detail={props.detail} className={props.className} label={props.children} />
}

function FromRegistry({
  dimension,
  value,
  label,
  detail,
  children,
  className,
}: {
  dimension: StatusDimension
  value: string
  label?: string
  detail?: ReactNode
  children?: ReactNode
  className?: string
}) {
  const s = useResolved(dimension, value)
  const step = s ? STEP_OF_TONE[s.tone] : 'inert'
  return (
    <StatusTextView
      tone={step}
      icon={s?.icon}
      statusKey={s?.key}
      detail={detail ?? children}
      className={className}
      label={label ?? s?.label ?? 'Unknown'}
    />
  )
}

function StatusTextView({
  tone,
  icon,
  label,
  detail,
  statusKey,
  className,
}: {
  tone: StepTone
  icon?: LucideIcon
  label: ReactNode
  detail?: ReactNode
  statusKey?: string
  className?: string
}) {
  return (
    <span data-tone={tone} data-status-text={statusKey} className={cn('inline-flex items-start gap-[6px] text-sm', className)}>
      <Icon icon={icon ?? TONE_ICON[TONE_OF_STEP[tone]]} size="sm" className={cn('mt-[3px]', ICON[tone])} />
      <span className="grid min-w-0 gap-px">
        <span className={TEXT[tone]}>{label}</span>
        {detail !== undefined && detail !== null && detail !== '' ? <span className="text-sm text-fg-muted">{detail}</span> : null}
      </span>
    </span>
  )
}
