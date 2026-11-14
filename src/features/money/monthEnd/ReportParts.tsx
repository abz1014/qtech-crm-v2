import { useState, type ReactNode } from 'react'
import { CalendarDays, CircleAlert, Download, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { CARD } from '@/ui/card'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { Skeleton } from '@/ui/Skeleton'
import { DateInput } from '@/ui/form/DateInput'

/* The small parts every Month-end report is made of (g2-month-end: g-panel, the "By payment date" tag, Export CSV, loading and error). */

/**
 * The two profits (round 3, money correctness b): Profit and loss counts MONEY RECEIVED (payments net of GST) less costs paid in
 * the month (v_month_pnl); Money in and out also shows profit ON INVOICES (v_month_profit). Both are right; they are labelled
 * so they are never read as one number, and the same (i) explains the gap on both pages.
 */
export const TWO_PROFITS_LABEL = 'Profit on invoices and profit on cash'
export function TwoProfitsTip() {
  return (
    <InfoTip label={TWO_PROFITS_LABEL}>
      Profit and loss counts money received in the month, GST taken out, less costs paid in the month. Money in and out also shows
      profit on invoices: sales on their invoice date, less the costs of those orders. They differ when customers pay later than
      they are invoiced, or a supplier is paid in another month.
    </InfoTip>
  )
}

export function ExportCsvButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button size="sm" icon={Download} onClick={onClick} disabled={disabled}>
      Export CSV
    </Button>
  )
}

/** "By payment date": the clock a report counts on, so two reports are never read as one (money-07 clock tag). */
export function ClockTag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex min-h-6 items-center gap-1 whitespace-nowrap rounded-pill bg-brand-100 px-2 text-xs font-medium text-fg-2">
      <Icon icon={CalendarDays} size="chip" />
      {children}
    </span>
  )
}

export function Panel({
  title,
  meta,
  actions,
  children,
  className,
  bodyClassName,
  flat,
}: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  bodyClassName?: string
  /**
   * Was desktop clarity (lane D2: no box from 768 up). Forest (57/58/59 .qb-card--flush): every panel is the one card on every width,
   * so the prop no longer changes the look; it is kept so callers need not change.
   */
  flat?: boolean
}) {
  void flat
  return (
    <section className={cn(CARD, 'overflow-hidden', className)}>
      <header className="flex min-h-head flex-wrap items-center gap-x-3 gap-y-2 border-b px-card py-3">
        {/* Title and its note ("i") stay together: the note sits beside the last line of a long title, never alone on a line of its own.
            When title and note do not fit one line (a phone), the note moves under the title whole: it never squeezes the title into a column. */}
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <h2 className="min-w-0 text-lg font-heavy">{title}</h2>
          {meta}
        </div>
        <span className="flex-1" />
        {actions}
      </header>
      {children ? <div className={bodyClassName}>{children}</div> : null}
    </section>
  )
}

/**
 * The exact as-of date, behind "Change date" (round 3, M4: the month pager is the page's one date control). Closed: a quiet
 * "Change date" button. Open, or a date chosen: the date field and "Back to month end".
 */
/**
 * An overdue amount's age band: the late buckets are said by an icon and a word as well as the tint, so a reader who cannot tell the
 * tints apart (or reads a printout) still sees which are late. The early buckets stay plain.
 */
export function AgeBand({ bucket, children, className }: { bucket: string; children?: ReactNode; className?: string }) {
  if (bucket !== '61-90' && bucket !== '90+') return <>{children}</>
  const severe = bucket === '90+'
  return (
    <span className={cn('inline-grid justify-items-end gap-px rounded-control px-2 py-1', severe ? 'bg-tone-danger-bg' : 'bg-tone-warning-bg', className)}>
      <span className={cn('inline-flex items-center gap-1 text-xs font-medium', severe ? 'text-tone-danger-fg' : 'text-tone-warning-fg')}>
        <Icon icon={severe ? CircleAlert : TriangleAlert} size="sm" />
        {severe ? 'Over 90 days' : 'Over 60 days'}
      </span>
      {children}
    </span>
  )
}

export function AsOfControl({ asOf, chosen, onChange }: { asOf: string; chosen: boolean; onChange: (iso: string | null) => void }) {
  const [open, setOpen] = useState(false)
  if (!open && !chosen) {
    return (
      <Button variant="quiet" icon={CalendarDays} onClick={() => setOpen(true)} className="max-md:h-touch">
        Change date
      </Button>
    )
  }
  return (
    // F-783: the field fills the row on a phone (it was a fixed 232 px beside its word, too wide for 320 at Larger text).
    <span className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <label className="flex min-w-0 flex-[1_1_12rem] items-center gap-2 text-sm text-fg-2 sm:flex-none">
        As of
        <span className="w-full min-w-0 flex-1 sm:w-[15rem] sm:flex-none">
          <DateInput aria-label="As of date" value={asOf} onChange={v => v && onChange(v)} defaultToday={false} />
        </span>
      </label>
      <Button
        variant="quiet"
        onClick={() => {
          onChange(null)
          setOpen(false)
        }}
        className="max-md:h-touch"
      >
        Back to month end
      </Button>
    </span>
  )
}

export function ReportLoading({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="grid gap-4">
      <div className={cn(CARD, 'grid grid-cols-2 gap-px overflow-hidden bg-line md:grid-cols-4')}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="grid gap-2 bg-surface px-card py-4">
            <Skeleton className="h-3 w-[6rem]" />
            <Skeleton className="h-5 w-[8rem]" />
            <Skeleton className="h-3 w-[10rem]" />
          </div>
        ))}
      </div>
      <div className={cn(CARD, 'overflow-hidden')}>
        <div className="flex min-h-head items-center border-b px-card py-3">
          <Skeleton className="h-4 w-[10rem]" />
        </div>
        {[0, 1, 2, 3, 4, 5].map(r => (
          <div key={r} className="flex min-h-row items-center gap-4 border-b px-card last:border-b-0">
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-[5rem]" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ReportError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div role="alert" className={cn(CARD, 'mx-auto mt-8 w-full max-w-prose p-card')}>
      <EmptyState
        mood="error"
        title={title}
        actions={
          <Button variant="secondary" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        Nothing was changed. Payments, expenses and ticks are kept. Try again, and if the error continues, tell the admin.
      </EmptyState>
    </div>
  )
}
