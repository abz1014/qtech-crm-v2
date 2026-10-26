import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { Check, CircleAlert, CircleCheck, Download, TriangleAlert } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { downloadCSV, generateCSV } from '@/lib/csvExport'
import { computeReconciliationExceptions, countBySeverity, type ReconciliationException } from '@/lib/reconciliation'
import { useSession } from '@/app/session'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { NeedsCount } from '@/ui/Tag'
import { StatusText } from '@/ui/StatusText'
import { MoneyFrame, MoneySubHeader } from '@/features/money/MoneyFrame'
import { InfoTip } from '@/ui/InfoTip'
import { useOrderMargins, useReconciliationInput } from '@/features/money/hooks'
import { useUnchecked } from '@/features/money/exceptions/checked'

/*
 * Money > Month end > Mistakes to fix (M07; was "Exceptions", owner glossary 2026-10-19): the reconciliation checks over the money
 * views, for an admin, reached from the Month end checklist. Each line is one fact with the customer and order it is about,
 * by severity. It is not a data-quality score: it lists what needs a human look, and says "all in balance" when nothing does.
 * Always checks everything (no period filter): an old mistake is still a mistake.
 * Round 3: the customer leads each line; View order is a button at the end; "Mark as checked" takes a finding off the list
 * (and off Month end's count) for this person on this device, until its figures change (exceptions/checked.ts). The page's one
 * green button is View order on the first open finding: the obvious next step. Export CSV is a quiet link.
 */
function Row({ e, customer, first, onCheck }: { e: ReconciliationException; customer: string | null; first: boolean; onCheck: () => void }) {
  const critical = e.severity === 'critical'
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)] items-start gap-3 border-t px-5 py-3 first:border-t-0 md:grid-cols-[24px_minmax(0,1fr)_auto]" data-severity={e.severity}>
      <Icon icon={critical ? CircleAlert : TriangleAlert} size="lg" className={critical ? 'mt-[1px] text-tone-danger-fg' : 'mt-[1px] text-tone-warning-fg'} />
      <div className="grid min-w-0 gap-1">
        <span className="sr-only">{critical ? 'Critical.' : 'Warning.'}</span>
        <b className="text-base font-semibold">{e.category}</b>
        <p className="text-sm text-pretty">
          {customer ? <span className="font-medium">{customer} · </span> : null}
          {e.message}
        </p>
      </div>
      <div className="col-start-2 flex flex-wrap items-center gap-2 md:col-start-3 md:justify-end">
        <Button variant="quiet" icon={Check} onClick={onCheck} className="max-md:h-touch">
          Mark as checked
        </Button>
        {e.orderId ? (
          // A link (it goes somewhere), drawn as a button; the first open finding's is the page's one green button.
          <Link
            to={`/orders/${e.orderId}`}
            data-variant={first ? 'primary' : undefined}
            className={cn(
              'inline-flex h-control items-center rounded border px-3 text-sm font-medium transition-colors duration-fast max-md:h-touch',
              first ? 'border-primary bg-primary text-primary-foreground hover:bg-primary-hover' : 'border-line-strong bg-surface text-fg hover:bg-sunken',
            )}
          >
            View order
          </Link>
        ) : null}
      </div>
    </li>
  )
}

export function ExceptionsPage() {
  const session = useSession()
  const userId = session.status === 'signed-in' ? session.user.id : null
  const q = useReconciliationInput(true)
  const margins = useOrderMargins(true)
  const list = useMemo(() => (q.data ? computeReconciliationExceptions(q.data) : []), [q.data])
  const { open, checked, mark } = useUnchecked(userId, list)
  const [showChecked, setShowChecked] = useState(false)
  const counts = countBySeverity(open)
  const customerOf = useMemo(() => new Map((margins.data ?? []).map(m => [m.orderId, m.companyName])), [margins.data])
  const firstWithOrder = open.find(e => e.orderId)?.key

  const exportCsv = () => {
    const rows = list.map(e => [e.severity, e.category, e.orderId ? (customerOf.get(e.orderId) ?? '') : '', e.message, e.orderId ?? '', e.invoiceId ?? ''])
    downloadCSV(generateCSV(['Severity', 'Category', 'Customer', 'Message', 'Order id', 'Invoice id'], rows), `Reconciliation_${businessToday()}.csv`)
  }

  return (
    <MoneyFrame active="month-end">
      <MoneySubHeader
        back={{ to: '/money/month-end', label: 'Month end' }}
        title="Mistakes to fix"
        meta={
          <InfoTip label="About mistakes to fix">
            Checked, in every month: customer payments against the order total, invoices against the order, costs against the expected cost
            and the POs, dates in sequence, the GST on each invoice, sending to the customer and the tax deposit, and orders where nobody has
            said whether GST is included in the price. Mark as checked hides a finding on this device until its figures change.
          </InfoTip>
        }
        actions={
          <button
            type="button"
            onClick={exportCsv}
            disabled={list.length === 0}
            className="inline-flex min-h-touch items-center gap-1 rounded text-sm font-medium text-fg-2 hover:text-fg hover:underline disabled:text-fg-disabled md:min-h-0"
          >
            <Icon icon={Download} size="sm" />
            Export CSV
          </button>
        }
      />
      <section aria-labelledby="exceptions-h" className="min-w-0 rounded-panel border bg-surface">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-4">
          <h3 id="exceptions-h" className="text-base font-semibold">
            What does not add up
          </h3>
          {/* The needs-you counts as NeedsCount pills (spec 2.2 #22: danger for critical), the word beside each; "All clear" as text. */}
          <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2 text-sm" aria-live="polite">
            {counts.critical > 0 ? (
              <span className="inline-flex items-center gap-2 text-fg-2" data-count="critical">
                <NeedsCount n={counts.critical} variant="danger" sr={`${counts.critical} critical`} />
                <span aria-hidden="true">critical</span>
              </span>
            ) : null}
            {counts.warning > 0 ? (
              <span className="inline-flex items-center gap-2 text-fg-2" data-count="warning">
                <NeedsCount n={counts.warning} sr={`${counts.warning} ${counts.warning === 1 ? 'warning' : 'warnings'}`} />
                <span aria-hidden="true">{counts.warning === 1 ? 'warning' : 'warnings'}</span>
              </span>
            ) : null}
            {q.data && open.length === 0 ? <StatusText tone="done">All clear</StatusText> : null}
          </div>
        </header>
        {q.isPending ? (
          <div role="status" className="grid gap-3 p-5" aria-busy="true" aria-label="Checking the money records">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : q.isError ? (
          <div className="p-4">
            <Banner
              tone="danger"
              title="Couldn't run the checks"
              action={
                <Button size="sm" onClick={() => void q.refetch()}>
                  Try again
                </Button>
              }
            >
              Nothing was changed. Check your connection and try again.
            </Banner>
          </div>
        ) : open.length === 0 ? (
          <p className="flex items-center gap-2 px-5 py-6 text-sm text-fg-2" data-testid="exceptions-clear">
            <Icon icon={CircleCheck} size="lg" className="text-tone-success-fg" />
            {checked.length ? 'Nothing left to check.' : 'Nothing to check. Orders, payments, invoices and costs are in balance and in sequence.'}
          </p>
        ) : (
          <ul aria-label="Mistakes to fix">
            {open.map(e => (
              <Row key={e.key} e={e} customer={e.orderId ? (customerOf.get(e.orderId) ?? null) : null} first={e.key === firstWithOrder} onCheck={() => mark(e, true)} />
            ))}
          </ul>
        )}
        {checked.length > 0 ? (
          <div className="border-t px-5 py-2">
            <Button variant="quiet" size="sm" onClick={() => setShowChecked(s => !s)} aria-expanded={showChecked} className="max-md:h-touch">
              {showChecked ? 'Hide the checked ones' : `${checked.length} marked as checked`}
            </Button>
            {showChecked ? (
              <ul aria-label="Marked as checked" className="grid gap-1 pb-2">
                {checked.map(e => (
                  <li key={e.key} className="flex flex-wrap items-center justify-between gap-2 text-sm text-fg-2">
                    <span className="min-w-0">
                      {e.category}: {e.message}
                    </span>
                    <Button variant="quiet" size="sm" onClick={() => mark(e, false)} className="max-md:h-touch">
                      Put back
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>
    </MoneyFrame>
  )
}
