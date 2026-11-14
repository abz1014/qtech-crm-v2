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

/** A row's state chip (Forest 30-job-page .qb-fold chips): Done, Waiting, Not yet. */
export type FoldRowChipTone = 'success' | 'info' | 'warning' | 'danger' | 'neutral'
export interface FoldRowChip {
  icon: LucideIcon
  /** The chip's word, drawn and heard ("Done", "Waiting", "Not yet"). */
  word: string
  tone: FoldRowChipTone
}
const CHIP_TONE: Record<FoldRowChipTone, string> = {
  success: 'border-tone-success-fg/25 bg-tone-success-bg text-tone-success-fg',
  info: 'border-tone-info-fg/25 bg-tone-info-bg text-tone-info-fg',
  warning: 'border-tone-warning-fg/25 bg-tone-warning-bg text-tone-warning-fg',
  danger: 'border-tone-danger-fg/25 bg-tone-danger-bg text-tone-danger-fg',
  neutral: 'border-dashed border-line-strong bg-tone-neutral-bg text-tone-neutral-fg',
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
  /**
   * The state as a drawn chip, right of the words (the Job page's steps). The row then reads in two lines, the title over the summary,
   * with no leading icon. The chip's word is part of the name; the state word is still heard first when it says something else
   * ("Delivery, Now, Waiting, 2 of 3 delivered").
   */
  chip?: FoldRowChip
}

export function FoldRow({ state, title, summary, open, onToggle, controlsId, children, className, id, dataStage, bodyLabel, tone, muted = false, disabled = false, figure = false, chip }: FoldRowProps) {
  const summaryTone = tone ? TONE[tone] : 'text-fg-2'
  const words = chip ? (
    // Two lines: the title over the summary, the chip to the right (DOM order keeps the name "Title State Chip Summary").
    <>
      <span className={cn('col-start-1 row-start-1 min-w-0 [overflow-wrap:anywhere]', muted && 'font-medium text-fg-2')}>{title}</span>
      {chip.word === state.word ? null : <span className="sr-only">{state.word}</span>}
      <span className={cn('col-start-2 row-span-2 row-start-1 inline-flex min-h-chip items-center gap-1 self-center whitespace-nowrap rounded-pill border py-px pl-2 pr-3 text-xs font-card leading-none', CHIP_TONE[chip.tone])}>
        <Icon icon={chip.icon} size="chip" className="size-icon-chip" />
        {chip.word}
      </span>
      <span className={cn('col-start-1 row-start-2 min-w-0 text-sm font-regular [overflow-wrap:anywhere]', tone ? summaryTone : 'text-fg-muted')}>{summary}</span>
    </>
  ) : figure ? (
    // A figure: [icon | title ... summary | chevron]. When the figure does not fit beside the title it moves under it, still to the right,
    // and the chevron keeps its own column at the right (it wrapped under the row with the figure at 375 before).
    <>
      <span className="col-start-2 row-start-1 flex min-w-0 flex-wrap items-baseline gap-x-3">
        <span className={cn('shrink-0', muted && 'font-medium text-fg-muted')}>{title}</span>
        <span className="sr-only">{state.word}</span>
        <span className={cn('type-body ml-auto min-w-[min-content] text-right [overflow-wrap:anywhere]', summaryTone)}>{summary}</span>
      </span>
      <Icon icon={state.icon} className={cn('col-start-1 row-start-1', state.className ?? 'text-fg-muted')} />
    </>
  ) : (
    <>
      <span className={cn('shrink-0', muted && 'font-medium text-fg-muted')}>{title}</span>
      <span className="sr-only">{state.word}</span>
      <Icon icon={state.icon} className={cn('order-first', state.className ?? 'text-fg-muted')} />
      <span className={cn('type-body min-w-0 flex-1 text-right [overflow-wrap:anywhere]', summaryTone)}>{summary}</span>
    </>
  )
  // With a chip: a grid of [words | chip | chevron] over two lines; a figure: a grid of [icon | words | chevron]; else the one line.
  const line = chip
    ? 'grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-px py-3'
    : figure
      ? 'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 py-2'
      : 'flex items-center gap-3 py-2'
  const chevron = chip ? 'col-start-3 row-span-2 row-start-1' : figure ? 'col-start-3 row-start-1' : ''
  return (
    <div id={id} className={cn('border-b', className)} data-fold-row="" data-stage={dataStage}>
      {disabled ? (
        <div className={cn('type-row min-h-touch w-full text-left', line)}>
          {words}
          <span className={cn('size-4 shrink-0', chevron)} aria-hidden="true" />
        </div>
      ) : (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={controlsId}
          onClick={onToggle}
          className={cn('type-row min-h-touch w-full text-left transition-colors duration-fast hover:bg-sunken', line, chip && '-mx-2 w-[calc(100%+var(--sp-4))] rounded-row px-2')}
        >
          {words}
          <Icon icon={ChevronRight} className={cn('text-fg-muted transition-transform duration-fast motion-reduce:transition-none', chevron, open && 'rotate-90')} />
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
