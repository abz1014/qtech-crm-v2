import { useEffect, useId, useRef, type ReactNode } from 'react'
import { Check, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'

/*
 * Small page parts the company screens share, built from tokens only (g2-company.html: .g-panel,
 * .kv, .unitchart). INVENTORY lists Panel, KeyValue and UnitChart as composites; they live here until
 * a second screen needs them, then they move to src/ui.
 */

/** A titled card: header with the title, a muted meta line, and actions on the right. */
export function Panel({
  title,
  meta,
  actions,
  children,
  footer,
  className,
}: {
  title: ReactNode
  meta?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  footer?: ReactNode
  className?: string
}) {
  const headingId = useId()
  return (
    <section aria-labelledby={headingId} className={cn('min-w-0 rounded border bg-surface', className)}>
      <header className="flex min-h-[52px] flex-wrap items-center gap-x-3 gap-y-1 border-b py-2 pl-5 pr-4">
        <h2 id={headingId} className="text-base font-semibold">
          {title}
        </h2>
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

export type Unit = 'quoted' | 'declined' | 'waiting' | 'ontime' | 'late'

const UNIT_BOX: Record<Unit, string> = {
  quoted: 'bg-tone-ink-bg text-tone-ink-fg',
  ontime: 'bg-tone-ink-bg text-tone-ink-fg',
  declined: 'border border-fg-2 bg-surface text-fg-2',
  waiting: 'border border-dashed border-line-input bg-surface',
  late: 'border border-tone-danger-fg bg-tone-danger-bg text-tone-danger-fg',
}

/** One square per enquiry or delivery, then a legend that says what each means, with counts. No percentages. */
export function UnitChart({
  units,
  legend,
  label,
}: {
  units: Unit[]
  legend: { unit: Unit; text: string; count: number }[]
  label: string
}) {
  return (
    <div className="grid gap-2">
      <div role="img" aria-label={label} className="flex flex-wrap items-center gap-1">
        {units.map((u, i) => (
          <span key={i} className={cn('grid size-[22px] place-items-center rounded', UNIT_BOX[u])}>
            {u === 'quoted' || u === 'ontime' ? <Icon icon={Check} size="chip" /> : u === 'declined' ? <Icon icon={Minus} size="chip" /> : null}
          </span>
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-fg-muted">
        {legend
          .filter(l => l.count > 0)
          .map(l => (
            <span key={l.unit} className="inline-flex items-center gap-[6px]">
              <i aria-hidden="true" className={cn('inline-block size-[10px] rounded-[2px]', UNIT_BOX[l.unit])} />
              {l.text} <span className="num text-fg-2">{l.count}</span>
            </span>
          ))}
      </div>
    </div>
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
