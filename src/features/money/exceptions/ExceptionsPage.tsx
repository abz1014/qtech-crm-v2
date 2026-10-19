import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CircleAlert, CircleCheck, Download, TriangleAlert } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { downloadCSV, generateCSV } from '@/lib/csvExport'
import { computeReconciliationExceptions, countBySeverity, type ReconciliationException } from '@/lib/reconciliation'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'
import { MoneyFrame, MoneySubHeader } from '@/features/money/MoneyFrame'
import { Tip } from '@/features/money/Tip'
import { useReconciliationInput } from '@/features/money/hooks'

/*
 * Money > Month end > Things to check (M07; was "Exceptions", owner glossary 2026-10-19): the reconciliation checks over the money
 * views, for an admin, reached from the Month end checklist. Each line is one fact with the order it
 * is about, newest category first by severity. It is not a data-quality score: it lists what needs a human look, and says "all in
 * balance" when nothing does. Always checks everything (no period filter): an old mistake is still a mistake.
 */
function Row({ e }: { e: ReconciliationException }) {
  const critical = e.severity === 'critical'
  return (
    <li className="flex items-start gap-3 border-t px-5 py-3 first:border-t-0" data-severity={e.severity}>
      <Icon icon={critical ? CircleAlert : TriangleAlert} size="lg" className={critical ? 'mt-[1px] text-tone-danger-fg' : 'mt-[1px] text-tone-warning-fg'} />
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="sr-only">{critical ? 'Critical.' : 'Warning.'}</span>
          <Tag className="h-6 px-2 font-sans text-sm">{e.category}</Tag>
          {e.orderId ? (
            <Link to={`/orders/${e.orderId}`} className="rounded text-sm font-medium text-primary hover:underline">
              View order
            </Link>
          ) : null}
        </div>
        <p className="text-sm text-pretty">{e.message}</p>
      </div>
    </li>
  )
}

export function ExceptionsPage() {
  const q = useReconciliationInput(true)
  const list = useMemo(() => (q.data ? computeReconciliationExceptions(q.data) : []), [q.data])
  const counts = countBySeverity(list)

  const exportCsv = () => {
    const rows = list.map(e => [e.severity, e.category, e.message, e.orderId ?? '', e.invoiceId ?? ''])
    downloadCSV(generateCSV(['Severity', 'Category', 'Message', 'Order id', 'Invoice id'], rows), `Reconciliation_${businessToday()}.csv`)
  }

  return (
    <MoneyFrame active="month-end">
      <MoneySubHeader
        back={{ to: '/money/month-end', label: 'Month end' }}
        title="Things to check"
        meta={
          <Tip label="things to check">
            Checked, in every month: customer payments against the order total, invoices against the order, costs against the expected cost
            and the POs, dates in sequence, the GST on each invoice, the TCS trail and tax deposit, and orders where nobody has said whether
            GST is included in the price.
          </Tip>
        }
        actions={
          <Button icon={Download} onClick={exportCsv} disabled={list.length === 0}>
            Export CSV
          </Button>
        }
      />
      <section aria-labelledby="exceptions-h" className="min-w-0 rounded border bg-surface">
        <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b px-5 py-4">
          <h3 id="exceptions-h" className="text-base font-semibold">
            What does not add up
          </h3>
          <div className="ml-auto flex flex-wrap items-center gap-2 text-sm" aria-live="polite">
            {counts.critical > 0 ? (
              <span className="inline-flex h-6 items-center rounded-round bg-tone-danger-bg px-2 font-medium text-tone-danger-fg">
                <span className="num mr-1">{counts.critical}</span> critical
              </span>
            ) : null}
            {counts.warning > 0 ? (
              <span className="inline-flex h-6 items-center rounded-round bg-tone-warning-bg px-2 font-medium text-tone-warning-fg">
                <span className="num mr-1">{counts.warning}</span> {counts.warning === 1 ? 'warning' : 'warnings'}
              </span>
            ) : null}
            {q.data && list.length === 0 ? <span className="inline-flex h-6 items-center rounded-round bg-tone-success-bg px-2 font-medium text-tone-success-fg">All clear</span> : null}
          </div>
        </header>
        {q.isPending ? (
          <div className="grid gap-3 p-5" aria-busy="true" aria-label="Checking the money records">
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
        ) : list.length === 0 ? (
          <p className="flex items-center gap-2 px-5 py-6 text-sm text-fg-2" data-testid="exceptions-clear">
            <Icon icon={CircleCheck} size="lg" className="text-tone-success-fg" />
            Nothing to check. Orders, payments, invoices and costs are in balance and in sequence.
          </p>
        ) : (
          <ul aria-label="Things to check">
            {list.map(e => (
              <Row key={e.key} e={e} />
            ))}
          </ul>
        )}
      </section>
    </MoneyFrame>
  )
}
