import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Clock } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { formatAmount } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { qk } from '@/features/queryKeys'
import { monthKeyLabel } from '@/features/money/expenses/model'
import { MoneySubHeader, MoneyFrame } from '@/features/money/MoneyFrame'
import { loadGstMonths } from '@/features/money/monthEnd/api'
import { loadGstFilings } from '@/features/money/accounts/api'
import { gstLines, GST_PAY_DAY, GST_RETURN_DAY, type GstLine } from '@/features/money/accounts/gstModel'

/*
 * Money > Accounts > GST to FBR (P6-B). Admin only. Per month: GST charged on invoices, less GST paid on purchases, is what is to
 * pay; due the 15th of the next month, the return the 18th; then who paid and the payment slip number (PSID). Plain words, 16 px,
 * one column below 768 px (a card a month, no sideways scroll at 320 px). Nothing is edited here: the PSID and the deposit are
 * stamped on the invoices (Invoices, a month at a time), and this page reads them back.
 */
const rs = (v: string | number) => formatAmount(v, 'never')

export function GstToFbrPage() {
  const today = businessToday()
  const months = useQuery({ queryKey: qk.money.monthEnd.gst(), queryFn: loadGstMonths, staleTime: 0 })
  const filings = useQuery({ queryKey: [...qk.money.monthEnd.gst(), 'filings'], queryFn: loadGstFilings, staleTime: 0 })
  const lines = useMemo(() => (months.data && filings.data ? gstLines(months.data, filings.data, today) : null), [months.data, filings.data, today])
  const failed = months.isError || filings.isError
  return (
    <MoneyFrame active={null}>
      <MoneySubHeader back={{ to: '/money', label: 'Money' }} title="GST to FBR" />
      <p className="max-w-prose text-base text-fg-2">
        GST charged on invoices, less GST paid on purchases, is what you pay FBR. Pay by the {GST_PAY_DAY}th of the next month and file the return by
        the {GST_RETURN_DAY}th.
      </p>
      {failed ? (
        <p role="alert" className="rounded-row border border-tone-danger-fg/30 bg-tone-danger-bg px-4 py-3 text-base text-tone-danger-fg">
          The GST months could not be loaded.{' '}
          <button type="button" className="font-medium underline" onClick={() => void Promise.all([months.refetch(), filings.refetch()])}>
            Try again
          </button>
        </p>
      ) : !lines ? (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      ) : lines.length === 0 ? (
        <p className="rounded-panel border bg-surface px-5 py-4 text-base text-fg-2">No invoices yet, so no GST to pay.</p>
      ) : (
        <ul className="grid gap-3" data-testid="gst-months">
          {lines.map(l => (
            <MonthCard key={l.month} l={l} />
          ))}
        </ul>
      )}
      <p className="text-base text-fg-2">
        To stamp a month&rsquo;s payment slip number and deposit date, open{' '}
        <Link to="/money/gst-register" className="font-medium text-primary underline underline-offset-2">
          Invoices
        </Link>
        . The month&rsquo;s full GST and FBR report is under{' '}
        <Link to="/money/reports/gst" className="font-medium text-primary underline underline-offset-2">
          Reports
        </Link>
        .
      </p>
    </MoneyFrame>
  )
}

const TONE: Record<GstLine['tone'], string> = {
  paid: 'border-line bg-surface',
  ok: 'border-line bg-surface',
  soon: 'border-transparent bg-block-today text-block-today-fg',
  late: 'border-transparent bg-block-late text-block-late-fg',
  nothing: 'border-line bg-block-quiet text-block-quiet-fg',
}

function MonthCard({ l }: { l: GstLine }) {
  return (
    <li className={cn('grid gap-3 rounded-panel border px-5 py-4 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_minmax(0,14rem)] md:items-center', TONE[l.tone])} data-testid={`gst-${l.month}`}>
      <div className="grid gap-px">
        <h2 className="text-lg font-semibold">{monthKeyLabel(l.month)}</h2>
        <span className="text-base">{l.invoiceCount === 1 ? '1 invoice' : `${l.invoiceCount} invoices`}</span>
      </div>
      <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-base">
        <dt>GST charged</dt>
        <dd className="num text-right">{rs(l.charged)}</dd>
        <dt>GST paid on purchases</dt>
        <dd className="num text-right">{l.paidOnPurchases === null ? 'not shown' : `− ${rs(l.paidOnPurchases)}`}</dd>
        <dt className="border-t pt-1 font-semibold">To pay</dt>
        <dd className="num border-t pt-1 text-right text-lg font-semibold" data-testid={`topay-${l.month}`}>
          {rs(l.toPay)}
        </dd>
        {Number(l.credit) > 0 ? (
          <>
            <dt className="text-fg-2">GST paid on purchases is more by</dt>
            <dd className="num text-right text-fg-2">{rs(l.credit)}</dd>
          </>
        ) : null}
      </dl>
      <Status l={l} />
    </li>
  )
}

function Status({ l }: { l: GstLine }) {
  if (l.tone === 'paid')
    return (
      <div className="grid gap-px text-base" data-testid={`status-${l.month}`}>
        <span className="inline-flex items-center gap-2 font-medium text-tone-success-fg">
          <Icon icon={CircleCheck} />
          Paid{l.paidOn ? ` ${formatDay(l.paidOn)}` : ''}
        </span>
        {l.psids.length > 0 ? <span className="num [overflow-wrap:anywhere]">Payment slip no. (PSID) {l.psids.join(', ')}</span> : null}
        {Number(l.deposited) > 0 ? <span className="num text-fg-2">Deposited PKR {rs(l.deposited)}</span> : null}
      </div>
    )
  if (l.tone === 'nothing')
    return (
      <div className="text-base" data-testid={`status-${l.month}`}>
        Nothing to pay
      </div>
    )
  return (
    <div className="grid gap-px text-base" data-testid={`status-${l.month}`}>
      <span className="inline-flex items-center gap-2 font-medium">
        <Icon icon={l.tone === 'late' ? CircleAlert : Clock} />
        {l.tone === 'late' ? `Late: was due ${formatDay(l.payBy)}` : `Pay by ${formatDay(l.payBy)}`}
      </span>
      <span>Return by {formatDay(l.returnBy)}</span>
      {l.psids.length > 0 ? <span className="num [overflow-wrap:anywhere]">PSID {l.psids.join(', ')} (not deposited yet)</span> : null}
    </div>
  )
}
