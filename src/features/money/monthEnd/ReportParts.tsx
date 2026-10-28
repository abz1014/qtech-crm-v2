import { useState, type ReactNode } from 'react'
import { CalendarDays, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
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
export const TWO_PROFITS_LABEL = 'Why two profits?'
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
    <span className="inline-flex h-6 items-center gap-[6px] rounded bg-selected px-2 text-xs text-fg-2">
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
}: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
  bodyClassName?: string
}) {
  return (
    <section className={cn('overflow-hidden rounded-panel border bg-surface', className)}>
      <header className="flex min-h-[52px] flex-wrap items-center gap-3 border-b px-5 py-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {meta}
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
    <span className="flex flex-wrap items-center gap-2">
      <label className="inline-flex items-center gap-2 text-sm text-fg-2">
        As of
        <span className="w-[232px] shrink-0">
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
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border bg-line md:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="grid gap-2 bg-surface px-5 py-4">
            <Skeleton className="h-3 w-[6rem]" />
            <Skeleton className="h-5 w-[8rem]" />
            <Skeleton className="h-3 w-[10rem]" />
          </div>
        ))}
      </div>
      <div className="rounded border bg-surface">
        <div className="flex min-h-[52px] items-center border-b px-5">
          <Skeleton className="h-4 w-[10rem]" />
        </div>
        {[0, 1, 2, 3, 4, 5].map(r => (
          <div key={r} className="flex min-h-[48px] items-center gap-4 border-b px-5">
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
    <div role="alert" className="mx-auto mt-8 max-w-[520px] rounded-panel border bg-surface p-6">
      <EmptyState
        mood="error"
        title={title}
        actions={
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        Your payments, expenses and ticks are safe; nothing was changed. Try again, and if it keeps failing, tell the admin.
      </EmptyState>
    </div>
  )
}
