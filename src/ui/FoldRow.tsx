import type { ReactNode } from 'react'
import { ChevronRight, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'

/*
 * FoldRow (clarity redesign step 0): one closed row that opens a body. A hairline, no box.
 *   [state icon] Title ............ summary  >
 * The row is 44 to 52 px tall and stays on one line at 375 px: the title keeps its words, the summary is cut with an ellipsis.
 * The state is an icon plus a word that only a screen reader hears; the icon never speaks for itself. The accessible name
 * reads title first, then the state word ("Quotation Done 3 items"), then the summary.
 */
export interface FoldRowState {
  icon: LucideIcon
  /** Heard by a screen reader, not drawn: "Done", "Waiting", "Not started". */
  word: string
}

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
}

export function FoldRow({ state, title, summary, open, onToggle, controlsId, children, className }: FoldRowProps) {
  return (
    <div className={cn('border-b', className)} data-fold-row="">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={controlsId}
        onClick={onToggle}
        className="type-row flex min-h-touch w-full items-center gap-3 py-2 text-left hover:bg-sunken"
      >
        <span className="shrink-0">{title}</span>
        <span className="sr-only">{state.word}</span>
        <Icon icon={state.icon} className="order-first text-fg-muted" />
        <span className="type-body min-w-0 flex-1 truncate text-right text-fg-2">{summary}</span>
        <Icon icon={ChevronRight} className={cn('text-fg-muted transition-transform', open && 'rotate-90')} />
      </button>
      {open ? (
        <div id={controlsId} className="pb-3">
          {children}
        </div>
      ) : null}
    </div>
  )
}
