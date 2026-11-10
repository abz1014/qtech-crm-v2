import type { ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * FoldRow (clarity redesign step 0): one closed row that opens a body. A hairline, no box.
 *   [state icon] Title ............ summary  >
 * The row is 44 to 52 px tall and stays on one line at 375 px at Normal text: the title keeps its words, the summary is short. At Larger
 * text, or with a long reference, the summary wraps to a second line instead of being cut (nothing is clipped).
 * The state is an icon plus a word that only a screen reader hears; the icon never speaks for itself. The accessible name
 * reads title first, then the state word ("Quotation Done 3 items"), then the summary.
 */
export interface FoldRowState {
  icon: LucideIcon
  /** Heard by a screen reader, not drawn: "Done", "Waiting", "Not started". */
  word: string
  /** The icon's colour class; default is the muted ink. */
  className?: string
}

/** The summary's colour: none (the quiet default), success (green), warning (brown: the step the job waits at). */
export type FoldRowTone = 'success' | 'warning' | 'danger'
const TONE: Record<FoldRowTone, string> = { success: 'text-tone-success-fg', warning: 'text-tone-warning-fg font-semibold', danger: 'text-tone-danger-fg font-semibold' }

export interface FoldRowProps {
  state: FoldRowState
  title: string
  /** A count or a value ("3 items", "PKR 182,400", "PO-20481/KHI-0092-A"). Required: a closed row always says something. */
  summary: ReactNode
  open: boolean
  onToggle: () => void
  /** The id of the element that holds the body. It is rendered here, only while the row is open. */
  controlsId: string
  children?: ReactNode
  className?: string
  /** The wrapper's id (a ?stage= link and the ruler find the row by it). */
  id?: string
  /** Rendered as data-stage on the wrapper. */
  dataStage?: string
  /** Gives the body role="region" and this name ("Quotation stage"). */
  bodyLabel?: string
  /** Colours the summary. */
  tone?: FoldRowTone
  /** The title in the muted ink (a step not reached yet). */
  muted?: boolean
  /** The summary holds a figure that must never be cut (a money amount): when it does not fit beside the title, the whole summary moves under it. */
  figure?: boolean
  /** A row that does not open: no button, no chevron (a step this job does not have). */
  disabled?: boolean
}

export function FoldRow({ state, title, summary, open, onToggle, controlsId, children, className, id, dataStage, bodyLabel, tone, muted = false, disabled = false, figure = false }: FoldRowProps) {
  const lead = <Icon icon={state.icon} className={cn('order-first', state.className ?? 'text-fg-muted')} />
  const words = (
    <>
      <span className={cn('shrink-0', muted && 'font-medium text-fg-muted')}>{title}</span>
      <span className="sr-only">{state.word}</span>
      {lead}
      <span className={cn('type-body flex-1 text-right [overflow-wrap:anywhere]', figure ? 'min-w-[min-content]' : 'min-w-0', tone ? TONE[tone] : 'text-fg-2')}>{summary}</span>
    </>
  )
  return (
    <div id={id} className={cn('border-b', className)} data-fold-row="" data-stage={dataStage}>
      {disabled ? (
        <div className={cn('type-row flex min-h-touch w-full items-center gap-3 py-2 text-left', figure && 'flex-wrap gap-y-0')}>
          {words}
          <span className="size-4 shrink-0" aria-hidden="true" />
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={controlsId}
          onClick={onToggle}
          className={cn('type-row flex min-h-touch w-full items-center gap-3 py-2 text-left hover:bg-sunken', figure && 'flex-wrap gap-y-0')}
        >
          {words}
          <Icon icon={ChevronRight} className={cn('text-fg-muted transition-transform', open && 'rotate-90')} />
        </button>
      )}
      {open && !disabled ? (
        <div id={controlsId} role={bodyLabel ? 'region' : undefined} aria-label={bodyLabel} className="pb-3">
          {children}
        </div>
      ) : null}
    </div>
  )
}
