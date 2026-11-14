import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CircleAlert, CircleCheck, Clock } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatDay } from '@/lib/formatDay'
import { formatAmount } from '@/lib/money'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { TextField } from '@/ui/form/TextField'
import { mapPgError } from '@/lib/pgErrors'
import { Skeleton } from '@/ui/Skeleton'
import { CARD } from '@/ui/card'
import { qk } from '@/features/queryKeys'
import { monthKeyLabel } from '@/features/money/expenses/model'
import { MoneySubHeader, MoneyFrame } from '@/features/money/MoneyFrame'
import { loadGstMonths } from '@/features/money/monthEnd/api'
import { loadGstFilings, loadWhtDeducted, saveWhtCertificate, type WhtRow } from '@/features/money/accounts/api'
import { signReceipt } from '@/features/money/expenses/api'
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
        GST charged on invoices, less GST paid on purchases, is the amount payable to FBR. Pay by the <span data-testid="gst-pay-day">{dayWords(dl.deadlines.payDay)}</span> of the next month and
        file the return by the <span data-testid="gst-return-day">{dayWords(dl.deadlines.returnDay)}</span>.{' '}
        <Link to="/settings/tax-deadlines" className="font-medium text-primary underline underline-offset-2">
          {isAdmin ? 'Change these days' : 'See these days'}
        </Link>
      </p>
      {failed ? (
        <p role="alert" className={cn(CARD, 'flex flex-wrap items-center gap-x-3 gap-y-2 p-card text-base font-medium text-tone-danger-fg')}>
          <Icon icon={CircleAlert} className="shrink-0" />
          <span>The GST months could not be loaded.</span>
          <Button size="sm" variant="secondary" onClick={() => void Promise.all([months.refetch(), filings.refetch()])}>
            Try again
          </Button>
        </p>
      ) : !lines ? (
        // shaped like the month cards: the month, the three figures, the status
        <div className="grid gap-3" aria-busy="true" aria-label="Loading the GST months">
          {[0, 1, 2].map(i => (
            <div key={i} className={cn(CARD, 'grid gap-4 p-card md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_minmax(0,15rem)] md:items-center md:gap-6')}>
              <span className="grid gap-2">
                <Skeleton className="h-5 w-[8rem]" />
                <Skeleton className="h-3 w-[5rem]" />
              </span>
              <span className="grid gap-2">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-4 w-full" />
              </span>
              <span className="grid gap-2">
                <Skeleton className="h-4 w-[9rem]" />
                <Skeleton className="h-3 w-[7rem]" />
              </span>
            </div>
          ))}
        </div>
      ) : lines.length === 0 ? (
        <p className={cn(CARD, 'p-card text-base text-fg-2')}>No invoices yet, so no GST to pay.</p>
      ) : (
        <ul className="grid gap-3" data-testid="gst-months">
          {lines.map(l => (
            <MonthCard key={l.month} l={l} />
          ))}
        </ul>
      )}
      {isAdmin ? <WhtDeducted /> : null}
      <p className="max-w-prose text-base text-fg-2" data-testid="gst-foot">
        To stamp a month&apos;s payment slip number and deposit date, open{' '}
        <Link to="/money/gst-register" className="font-medium text-primary underline underline-offset-2">
          Invoices
        </Link>
        . The month&apos;s full GST and FBR report is under{' '}
        <Link to="/money/reports/gst" className="font-medium text-primary underline underline-offset-2">
          Reports
        </Link>
        .
      </p>
    </MoneyFrame>
  )
}

/* Forest (58-money-checks #gst-cards): every month is the one white card; the state is the status line's icon and ink, never a tinted card. */
const STATUS_INK: Record<GstLine['tone'], string> = {
  paid: 'text-tone-success-fg',
  ok: 'text-fg',
  soon: 'text-tone-warning-fg',
  late: 'text-tone-danger-fg',
  nothing: 'text-fg-2',
}

function MonthCard({ l }: { l: GstLine }) {
  return (
    <li className={cn(CARD, 'grid gap-4 p-card md:grid-cols-[minmax(0,11rem)_minmax(0,1fr)_minmax(0,15rem)] md:items-center md:gap-6')} data-testid={`gst-${l.month}`} data-tone={l.tone}>
      <div className="grid gap-1">
        <h2 className="text-lg font-heavy">{monthKeyLabel(l.month)}</h2>
        <span className="text-sm text-fg-2">{l.invoiceCount === 1 ? '1 invoice' : `${l.invoiceCount} invoices`}</span>
      </div>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-base">
        <dt className="text-fg-2">GST charged</dt>
        <dd className="num text-right">{rs(l.charged)}</dd>
        <dt className="text-fg-2">GST paid on purchases</dt>
        <dd className="num text-right">{l.paidOnPurchases === null ? 'not shown' : `− ${rs(l.paidOnPurchases)}`}</dd>
        <dt className="mt-1 border-t pt-2 font-heavy">To pay</dt>
        <dd className="num mt-1 border-t pt-2 text-right text-lg font-heavy" data-testid={`topay-${l.month}`}>
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

/** Each payment slip on its own line with the day its money went in (a month can be paid in more than one deposit). */
function PsidDays({ l }: { l: GstLine }) {
  return (
    <ul className="grid gap-px" aria-label="Payment slips">
      {l.psidDeposits.map(d => (
        <li key={d.psid} className="num text-fg-2 [overflow-wrap:anywhere]" data-testid={`psid-${d.psid}`}>
          PSID {d.psid}, {d.on ? `deposited ${formatDay(d.on)}` : 'not deposited yet'}
        </li>
      ))}
    </ul>
  )
}

function Status({ l }: { l: GstLine }) {
  if (l.tone === 'paid')
    return (
      <div className="grid gap-px text-base" data-testid={`status-${l.month}`}>
        <span className={cn('inline-flex items-center gap-2 font-heavy', STATUS_INK.paid)}>
          <Icon icon={CircleCheck} />
          Paid{l.paidOn ? ` ${formatDay(l.paidOn)}` : ''}
        </span>
        {l.psidDeposits.length > 1 ? <PsidDays l={l} /> : l.psids.length > 0 ? <span className="num text-fg-2 [overflow-wrap:anywhere]">Payment slip no. (PSID) {l.psids.join(', ')}</span> : null}
        {Number(l.deposited) > 0 ? <span className="num text-fg-2">Deposited PKR {rs(l.deposited)}</span> : null}
      </div>
    )
  if (l.tone === 'nothing')
    return (
      <div className={cn('inline-flex items-center gap-2 text-base font-medium', STATUS_INK.nothing)} data-testid={`status-${l.month}`}>
        <Icon icon={CircleCheck} />
        Nothing to pay
      </div>
    )
  return (
    <div className="grid gap-px text-base" data-testid={`status-${l.month}`}>
      <span className={cn('inline-flex items-center gap-2 font-heavy', STATUS_INK[l.tone])}>
        <Icon icon={l.tone === 'late' ? CircleAlert : Clock} />
        {l.tone === 'late' ? `Late: was due ${formatDay(l.payBy)}` : `Pay by ${formatDay(l.payBy)}${l.payOverridden ? ' (date moved)' : ''}`}
      </span>
      <span className="text-fg-2">Return by {formatDay(l.returnBy)}{l.returnOverridden ? ' (date moved)' : ''}</span>
      {/* live bug 24: a PSID whose deposit is recorded said "(not deposited yet)" while the month was still open. Each slip now says its own day. */}
      {l.psidDeposits.some(d => d.on) ? <PsidDays l={l} /> : l.psids.length > 0 ? <span className="num text-fg-2 [overflow-wrap:anywhere]">PSID {l.psids.join(', ')} (not deposited yet)</span> : null}
    </div>
  )
}

/**
 * One payment's certificate: the number and/or the file the customer sent (0128). The missing flag is gone when either exists. The row says
 * which it has, opens the file, and offers Add / Change: a number, a file, or both, each optional.
 */
function WhtCertificate({ row, onSaved }: { row: WhtRow; onSaved: () => void }) {
  const client = useQueryClient()
  const [open, setOpen] = useState(false)
  const [number, setNumber] = useState(row.certificateNo ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const openFile = async () => {
    try {
      window.open(await signReceipt(row.certificatePath as string), '_blank', 'noopener')
    } catch (e) {
      setError(mapPgError(e).message)
    }
  }
  const save = async () => {
    const nextNumber = number.trim()
    const numberChanged = nextNumber !== (row.certificateNo ?? '')
    if (!numberChanged && !file) {
      setOpen(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await saveWhtCertificate({ paymentId: row.paymentId, number: numberChanged ? nextNumber : null, file, oldPath: row.certificatePath })
      await client.invalidateQueries({ queryKey: qk.money.monthEnd.gst() })
      setOpen(false)
      setFile(null)
      onSaved()
    } catch (e) {
      setError(mapPgError(e).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="flex min-w-0 flex-wrap items-baseline justify-end gap-x-3 gap-y-1">
      {row.certificateMissing ? (
        <span className="font-medium text-tone-warning-fg">No certificate yet</span>
      ) : (
        <span className="num text-fg-2">
          {row.certificateNo ? `Certificate ${row.certificateNo}` : 'Certificate file'}
          {row.certificatePath ? (
            <>
              {' '}
              <button type="button" onClick={() => void openFile()} className="rounded font-medium text-primary underline underline-offset-2" aria-label={`Open the certificate file of ${orderRef(row.orderNumber)}`}>
                {row.certificateName ?? 'Open file'}
              </button>
            </>
          ) : null}
        </span>
      )}
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="rounded font-medium text-primary underline underline-offset-2" aria-label={`${row.certificateMissing ? 'Add' : 'Change'} the certificate of ${orderRef(row.orderNumber)}`}>
          {row.certificateMissing ? 'Add certificate' : 'Change'}
        </button>
      ) : null}
      {open ? (
        <span className="grid w-full gap-2 pt-1 md:max-w-md" data-testid="wht-edit">
          <label className="grid gap-1 text-sm">
            <span>Certificate or challan number</span>
            <TextField value={number} onChange={e => setNumber(e.target.value)} autoComplete="off" aria-label="Certificate number" />
          </label>
          <label className="grid gap-1 text-sm">
            <span>Certificate file (photo or PDF), optional</span>
            <input type="file" accept="image/*,application/pdf" aria-label="Certificate file" onChange={e => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
          </label>
          {error ? <span role="alert" className="text-sm text-tone-danger-fg">{error}</span> : null}
          <span className="flex gap-2">
            <Button size="sm" variant="primary" busy={busy} busyLabel="Saving" onClick={() => void save()}>
              Save
            </Button>
            <Button size="sm" variant="quiet" disabled={busy} onClick={() => { setOpen(false); setError(null) }}>
              Cancel
            </Button>
          </span>
        </span>
      ) : error ? (
        <span role="alert" className="w-full text-sm text-tone-danger-fg">{error}</span>
      ) : null}
    </span>
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
    <section aria-label="WHT deducted by customers" className={cn(CARD, 'grid gap-3 p-card')} data-testid="wht-deducted">
      <h2 className="text-lg font-heavy">WHT deducted by customers</h2>
      <p className="text-base text-fg-2">
        Tax that customers held back when they paid. It is not money received. It settles the invoice together with the cash. Keep each certificate to claim the credit.
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
              {missing === 1 ? '1 payment has' : `${missing} payments have`} no certificate number or file yet.
            </p>
          ) : null}
          {months.map(m => {
            const list = rows.filter(r => r.month === m)
            const total = list.reduce((s, r) => s + r.amount, 0)
            return (
              <div key={m} className="grid gap-1" data-testid={`wht-${m.slice(0, 7)}`}>
                <h3 className="flex items-baseline justify-between gap-3 pt-1 text-base font-heavy">
                  <span>{monthKeyLabel(m.slice(0, 7))}</span>
                  <span className="num">PKR {rs(total)}</span>
                </h3>
                <ul className="grid gap-1">
                  {list.map(r => (
                    <li key={r.paymentId} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-row border bg-canvas px-3 py-2 text-base">
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        <Link to={`/orders/${r.orderId}#payments`} className="num font-medium text-primary underline underline-offset-2">
                          {orderRef(r.orderNumber)}
                        </Link>{' '}
                        {r.companyName ?? ''} · {formatDay(r.receivedOn)}
                      </span>
                      <span className="num">PKR {rs(r.amount)}</span>
                      <WhtCertificate row={r} onSaved={() => void q.refetch()} />
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
