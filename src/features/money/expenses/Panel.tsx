import type { ReactNode, SelectHTMLAttributes } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { CARD, FOLD_CARD } from '@/ui/card'
import { Icon } from '@/ui/Icon'
import { controlClass } from '@/ui/form/fieldContext'

/*
 * The Expenses page's side cards (Forest 60-expenses and 62-claims-recurring: To approve, Claims to repay, Cash in hand, Recurring):
 * one Forest card each, the title over a one-line summary, the state at the right (who acts next, as an icon and a word), then the
 * body under a hairline. `headingId` names the section. The phone draws the same blocks as fold rows on PHONE_FOLD.
 */
export function PanelCard({
  headingId,
  title,
  summary,
  status,
  actions,
  children,
  className,
  ...rest
}: {
  headingId: string
  title: ReactNode
  summary?: ReactNode
  /** Who acts next (StatusText), right of the title. */
  status?: ReactNode
  /** Buttons for the whole card (Add recurring, Record all), under the summary. */
  actions?: ReactNode
  children?: ReactNode
  className?: string
  'data-testid'?: string
}) {
  return (
    <section aria-labelledby={headingId} className={cn(CARD, 'grid min-w-0 overflow-clip', className)} data-testid={rest['data-testid']}>
      <header className={cn('grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 px-card pb-4 pt-5', children ? 'border-b' : null)}>
        <h2 id={headingId} className="type-section min-w-0 [overflow-wrap:anywhere]">
          {title}
        </h2>
        {status ? <span className="col-start-2 row-start-1 self-center justify-self-end">{status}</span> : null}
        {summary ? <p className="col-span-2 min-w-0 text-sm text-fg-2 [overflow-wrap:anywhere]">{summary}</p> : null}
        {actions ? <div className="col-span-2 flex flex-wrap items-center gap-2 pt-2">{actions}</div> : null}
      </header>
      {children}
    </section>
  )
}

/** A side card folded to one row on a phone (60-expenses at 375): the fold row as a card on the canvas. Pass it as FoldRow className. */
export const PHONE_FOLD = cn(FOLD_CARD, 'shadow-e1')

/** A text box in the Forest control look: 40 with a mouse, the 44 tap target on a phone, 16 px text. */
export const FIELD = cn(controlClass, 'text-base max-md:h-touch')

/**
 * A native <select> (the best list on a phone, and it keeps the optgroups) drawn like the app's Select: the control look, a chevron,
 * 40 with a mouse and 44 on a phone, 16 px text.
 */
export function NativeSelect({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative min-w-0">
      <select {...rest} className={cn(FIELD, 'appearance-none pr-10 read-only:border-line-input read-only:bg-surface read-only:text-fg', className)}>
        {children}
      </select>
      <Icon icon={ChevronDown} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-fg-muted" />
    </div>
  )
}
