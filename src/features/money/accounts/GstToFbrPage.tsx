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
import { loadGstFilings, loadWhtDeducted } from '@/features/money/accounts/api'
import { orderRef } from '@/lib/refs'
import { gstLines, type GstLine } from '@/features/money/accounts/gstModel'
import { dayWords } from '@/features/settings/gstDeadlines'
import { useGstDeadlines } from '@/features/settings/hooks'
import { useSession } from '@/app/session'

/*
 * Money > Accounts > GST to FBR (P6-B). Admin only. Per month: GST charged on invoices, less GST paid on purchases, is what is to
 * pay; due on the pay-by day of the next month and the return on the file-by day (both set in Settings > Tax deadlines); then who paid and the payment slip number (PSID). Plain words, 16 px,
 * one column below 768 px (a card a month, no sideways scroll at 320 px). Nothing is edited here: the PSID and the deposit are
 * stamped on the invoices (Invoices, a month at a time), and this page reads them back.
 */
const rs = (v: string | number) => formatAmount(v, 'never')

export function GstToFbrPage() {
  const today = businessToday()
  const months = useQuery({ queryKey: qk.money.monthEnd.gst(), queryFn: loadGstMonths, staleTime: 0 })
  const filings = useQuery({ queryKey: [...qk.money.monthEnd.gst(), 'filings'], queryFn: loadGstFilings, staleTime: 0 })
  const dl = useGstDeadlines()
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const lines = useMemo(
    () => (months.data && filings.data && !dl.isPending ? gstLines(months.data, filings.data, today, 6, dl.deadlines) : null),
    [months.data, filings.data, today, dl.isPending, dl.deadlines],
  )
  const failed = months.isError || filings.isError
  return (
    <MoneyFrame active={null}>
      <MoneySubHeader back={{ to: '/money', label: 'Money' }} title="GST to FBR" />
      <p className="max-w-prose text-base text-fg-2">
        GST charged on invoices, less GST paid on purchases, is what you pay FBR. Pay by the <span data-testid="gst-pay-day">{dayWords(dl.deadlines.payDay)}</span> of the next month and
        file the return by the <span data-testid="gst-return-day">{dayWords(dl.deadlines.returnDay)}</span>.{' '}
        <Link to="/settings/tax-deadlines" className="font-medium text-primary underline underline-offset-2">
          {isAdmin ? 'Change these days' : 'See these days'}
        </Link>
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
          <Skeleton className="h-[6rem]" />
          <Skeleton className="h-[6rem]" />
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
      {isAdmin ? <WhtDeducted /> : null}
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
        {l.tone === 'late' ? `Late: was due ${formatDay(l.payBy)}` : `Pay by ${formatDay(l.payBy)}${l.payOverridden ? ' (date moved)' : ''}`}
      </span>
      <span>Return by {formatDay(l.returnBy)}{l.returnOverridden ? ' (date moved)' : ''}</span>
      {l.psids.length > 0 ? <span className="num [overflow-wrap:anywhere]">PSID {l.psids.join(', ')} (not deposited yet)</span> : null}
    </div>
  )
}

/**
 * WHT deducted by customers (0116): the tax customers held back when they paid, listed by month with a flag for a missing certificate.
 * It is a tax credit to claim, not money received: the payment's cash is what In vs out and the bank check count.
 */
function WhtDeducted() {
  const q = useQuery({ queryKey: [...qk.money.monthEnd.gst(), 'wht'], queryFn: loadWhtDeducted, staleTime: 0 })
  const rows = q.data ?? []
  const months = Array.from(new Set(rows.map(r => r.month))).sort().reverse()
  const missing = rows.filter(r => r.certificateMissing).length
  return (
    <section aria-label="WHT deducted by customers" className="grid gap-3 rounded-panel border bg-surface px-5 py-4" data-testid="wht-deducted">
      <h2 className="text-lg font-semibold">WHT deducted by customers</h2>
      <p className="text-base text-fg-2">
        Tax your customers held back when they paid. It is not money received; it settles the invoice together with the cash. Keep each certificate to claim the credit.
      </p>
      {q.isError ? (
        <p role="alert" className="text-base text-tone-danger-fg">The list could not be loaded.</p>
      ) : q.isPending ? (
        <Skeleton className="h-[4rem]" />
      ) : rows.length === 0 ? (
        <p className="text-base text-fg-2">No customer has deducted withholding tax yet.</p>
      ) : (
        <>
          {missing > 0 ? (
            <p role="status" className="font-medium text-tone-warning-fg" data-testid="wht-missing">
              {missing === 1 ? '1 payment has' : `${missing} payments have`} no certificate number yet.
            </p>
          ) : null}
          {months.map(m => {
            const list = rows.filter(r => r.month === m)
            const total = list.reduce((s, r) => s + r.amount, 0)
            return (
              <div key={m} className="grid gap-1" data-testid={`wht-${m.slice(0, 7)}`}>
                <h3 className="flex items-baseline justify-between gap-3 text-base font-semibold">
                  <span>{monthKeyLabel(m.slice(0, 7))}</span>
                  <span className="num">PKR {rs(total)}</span>
                </h3>
                <ul className="grid gap-1">
                  {list.map(r => (
                    <li key={r.paymentId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-row border px-3 py-2 text-base">
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        <Link to={`/orders/${r.orderId}#payments`} className="num font-medium text-primary underline underline-offset-2">
                          {orderRef(r.orderNumber)}
                        </Link>{' '}
                        {r.companyName ?? ''} · {formatDay(r.receivedOn)}
                      </span>
                      <span className="num">PKR {rs(r.amount)}</span>
                      {r.certificateMissing ? (
                        <span className="font-medium text-tone-warning-fg">No certificate yet</span>
                      ) : (
                        <span className="num text-fg-2">Certificate {r.certificateNo}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )
          })}
        </>
      )}
    </section>
  )
}
