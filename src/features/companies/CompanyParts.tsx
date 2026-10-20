import { useEffect, useId, useRef, type ReactNode } from 'react'
import type { CompanyRole } from '@/features/companies/api'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { StatusBadge } from '@/ui/StatusBadge'

/*
 * Small page parts the company screens share, built from tokens only (g2-company.html: .g-panel,
 * .kv). INVENTORY lists Panel and KeyValue as composites; they live here until a second screen
 * needs them, then they move to src/ui.
 */

/** A titled card: header with the title, an optional (i) tip beside it, a muted meta line, and actions on the right. */
export function Panel({
  title,
  info,
  meta,
  actions,
  children,
  footer,
  className,
}: {
  title: ReactNode
  /** An InfoTip (src/ui/InfoTip): the rule behind the panel, kept off the page. */
  info?: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
}) {
  const headingId = useId()
  const heading = (
    <h2 id={headingId} className="text-base font-semibold">
      {title}
    </h2>
  )
  return (
    <section aria-labelledby={headingId} className={cn('min-w-0 rounded border bg-surface', className)}>
      <header className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 pl-5 pr-4">
        {info ? (
          <span className="-my-1 flex items-center gap-1">
            {heading}
            {info}
          </span>
        ) : (
          heading
        )}
        {meta ? <span className="min-w-0 text-sm text-fg-muted">{meta}</span> : null}
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </header>
      {children}
      {footer ? <footer className="rounded-b border-t bg-sunken px-5 py-3 text-xs text-fg-muted">{footer}</footer> : null}
    </section>
  )
}

/** Label on the left, value on the right, a hairline between rows. */
export function KeyValue({ rows }: { rows: { key: string; value: ReactNode }[] }) {
  return (
    <dl className="grid">
      {rows.map(r => (
        <div key={r.key} className="flex items-baseline justify-between gap-4 border-t py-2 text-sm first:border-t-0">
          <dt className="text-fg-muted">{r.key}</dt>
          <dd className="m-0 min-w-0 text-right">{r.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The derived role as a chip. "Both" is drawn as a light customer chip that says what it means ("Customer & supplier")
 * instead of the dark ink chip, the heaviest mark on the list for the least useful fact (UX audit 9a).
 */
export function RoleChip({ role, className }: { role: CompanyRole; className?: string }) {
  return role === 'both' ? (
    <StatusBadge dimension="company-role" value="customer" label="Customer & supplier" className={className} />
  ) : (
    <StatusBadge dimension="company-role" value={role} className={className} />
  )
}

/** "Replied 5 of 6 · quoted 4": the numbers set in the number face so the counts stand out from the words. */
export function CountText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d+)/).map((part, i) =>
        /^\d+$/.test(part) ? (
          <span key={i} className="num font-medium">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  )
}

/** A quiet line of small print. */
export function Fine({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('text-xs text-fg-muted', className)}>{children}</p>
}

/**
 * The inline step before a remove: the row is replaced by the question, with Remove and Cancel. If the
 * database or a reference check refuses, `error` takes its place in plain words and the only action left
 * is Close, so nothing looks half done. Focus lands on Cancel, the safe choice.
 */
export function ConfirmRemove({
  title,
  detail,
  busy,
  error,
  onConfirm,
  onCancel,
  className,
}: {
  title: string
  detail?: string
  busy?: boolean
  error?: string | null
  onConfirm: () => void
  onCancel: () => void
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button[data-cancel]')?.focus()
  }, [error])
  return (
    <div
      ref={ref}
      role={error ? 'alert' : 'group'}
      aria-label={error ? undefined : title}
      className={cn(
        'grid gap-2 rounded border px-3 py-3 text-sm',
        error ? 'border-tone-danger-fg/25 bg-tone-danger-bg' : 'border-tone-warning-fg/25 bg-tone-warning-bg',
        className,
      )}
    >
      <p className="font-medium text-pretty">{error ?? title}</p>
      {!error && detail ? <p className="text-xs text-fg-2 text-pretty">{detail}</p> : null}
      <div className="flex gap-2">
        {error ? null : (
          <Button size="sm" variant="danger" busy={busy} onClick={onConfirm}>
            Remove
          </Button>
        )}
        <Button size="sm" data-cancel onClick={onCancel} disabled={busy}>
          {error ? 'Close' : 'Cancel'}
        </Button>
      </div>
    </div>
  )
}
