import type { ReactNode } from 'react'
import { CalendarDays, Download } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { DateInput } from '@/ui/form/DateInput'

/* The small parts every Month-end report is made of (g2-month-end: g-panel, the "By payment date" tag, Export CSV, loading and error). */

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
    <section className={cn('overflow-hidden rounded border bg-surface', className)}>
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

/** The as-of date: typed or picked, empty again to go back to the month's end. */
export function AsOfField({ value, onChange }: { value: string; onChange: (iso: string) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-fg-muted">
      As of
      <span className="w-[200px]">
        <DateInput aria-label="As of date" value={value} onChange={v => v && onChange(v)} defaultToday={false} className="h-[28px] text-xs" />
      </span>
    </label>
  )
}

export function ReportLoading({ label }: { label: string }) {
  return (
    <div aria-busy="true" aria-label={label} className="grid gap-4">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded border bg-line md:grid-cols-4">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="grid gap-2 bg-surface px-5 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
        ))}
      </div>
      <div className="rounded border bg-surface">
        <div className="flex min-h-[52px] items-center border-b px-5">
          <Skeleton className="h-4 w-40" />
        </div>
        {[0, 1, 2, 3, 4, 5].map(r => (
          <div key={r} className="flex min-h-[48px] items-center gap-4 border-b px-5">
            <Skeleton className="h-3 flex-1" />
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ReportError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div role="alert" className="mx-auto mt-8 max-w-[520px] rounded border bg-surface p-6">
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
