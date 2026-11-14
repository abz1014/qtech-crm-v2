import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRightLeft, Undo2 } from 'lucide-react'
import { formatDay } from '@/lib/formatDay'
import { formatAmount } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { InfoTip } from '@/ui/InfoTip'
import { Money } from '@/ui/Money'
import { Panel, ConfirmRemove, Fine, KeyValue } from '@/features/companies/CompanyParts'
import { ApplyCreditDialog } from '@/features/money/credit/ApplyCreditDialog'
import { RefundDialog } from '@/features/money/credit/RefundDialog'
import { useCompanyCredit, useRemoveCreditEntry } from '@/features/money/credit/hooks'
import { creditEvents, showCredit, type CreditEvent } from '@/features/money/credit/model'

/*
 * "Credit balance PKR X" on the company page (0126, 0127). Admin only: it is not rendered for anyone else, and the database refuses
 * every read and write of it. The balance is what the customer's orders hold above what they are worth (an overpayment, or a credit
 * note on a paid invoice) less what was refunded and what was put against another order. Two actions: Refund (cash out) and Apply to
 * an order (an allocation: no cash moves). Shown only when there is credit to give or a refund or applied credit to read.
 * Forest (55-credit-statement #cr-ok): the company page's card look (Panel card), the balance as the card's one big figure, the three
 * sums under it, and the refunds and applied credit as hairline lines inside the card's padding, newest first.
 */
export function CreditPanel({ companyId, companyName, isAdmin }: { companyId: string; companyName: string; isAdmin: boolean }) {
  const q = useCompanyCredit(companyId, isAdmin)
  const [refund, setRefund] = useState(false)
  const [apply, setApply] = useState(false)
  if (!isAdmin) return null
  if (q.isError)
    return (
      <Panel card title="Credit balance">
        <div className="px-5 pb-3" data-testid="credit-error">
          <p role="alert" className="mb-2 text-sm text-fg-2">
            The credit balance could not be loaded. Nothing was changed. Check the connection and try again.
          </p>
          <Button size="sm" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </div>
      </Panel>
    )
  if (!q.data) return null
  const { summary, refunds, applications, orderRefs, jobKeys } = q.data
  if (!showCredit(summary, refunds.length, applications.length)) return null
  const events = creditEvents(refunds, applications)
  const give = summary.balance > 0
  return (
    <>
      <Panel
        card
        title="Credit balance"
        info={
          <InfoTip label="About the credit balance">
            Money this customer has paid above what their orders are worth, including a credit note on an invoice already paid, less refunds
            and credit applied to other orders. Refund it, or apply it to an order of theirs that still has a balance due.
          </InfoTip>
        }
        actions={
          give ? (
            <>
              <Button size="sm" onClick={() => setRefund(true)}>
                Refund
              </Button>
              <Button size="sm" icon={ArrowRightLeft} onClick={() => setApply(true)}>
                Apply to an order
              </Button>
            </>
          ) : null
        }
      >
        <div className="grid gap-2 px-5 pb-3" data-testid="credit-balance">
          <p className="num min-w-0 text-kpi font-heavy tracking-snug text-fg [overflow-wrap:anywhere]">
            <span className="sr-only">Credit balance </span>
            <span className="mr-2 font-heavy">PKR</span>
            {formatAmount(summary.balance)}
          </p>
          <KeyValue
            rows={[
              { key: 'Overpaid', value: <Money value={summary.overpaid} /> },
              { key: 'Refunded', value: <Money value={summary.refunded} /> },
              { key: 'Applied to orders', value: <Money value={summary.applied} /> },
            ]}
          />
        </div>
        {events.length > 0 ? (
          <ul className="mx-5 mb-1 border-t" aria-label="Refunds and applied credit">
            {events.map(e => (
              <CreditLine key={e.key} companyId={companyId} event={e} orderRef={e.orderId ? (orderRefs[e.orderId] ?? null) : null} jobKey={e.orderId ? (jobKeys[e.orderId] ?? null) : null} />
            ))}
          </ul>
        ) : null}
      </Panel>
      <RefundDialog open={refund} onOpenChange={setRefund} companyId={companyId} companyName={companyName} credit={summary} />
      <ApplyCreditDialog open={apply} onOpenChange={setApply} companyId={companyId} companyName={companyName} credit={summary} />
    </>
  )
}

function CreditLine({ companyId, event, orderRef, jobKey }: { companyId: string; event: CreditEvent; orderRef: string | null; jobKey: string | null }) {
  const remove = useRemoveCreditEntry(companyId)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = event.kind === 'refund' ? 'Refunded' : 'Applied to'
  return (
    <li className="grid gap-2 border-t py-3 text-sm first:border-t-0">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="font-semibold">{label}</span>
          {orderRef && event.orderId ? (
            <>
              {' '}
              <Link to={jobKey ? `/jobs/${encodeURIComponent(jobKey)}` : `/orders/${event.orderId}`} className="num rounded font-semibold text-primary underline decoration-1 underline-offset-2 hover:text-fg">
                {orderRef}
              </Link>
            </>
          ) : null}
          <Fine className="mt-px">
            {formatDay(event.date)}
            {event.detail ? ` · ${event.detail}` : ''}
          </Fine>
        </span>
        <Money value={event.amount} className="shrink-0" />
        {!asking ? (
          <Button size="sm" variant="quiet" icon={Undo2} aria-label={`Remove this ${event.kind === 'refund' ? 'refund' : 'applied credit'}`} onClick={() => setAsking(true)} />
        ) : null}
      </div>
      {asking ? (
        <ConfirmRemove
          title={event.kind === 'refund' ? 'Remove this refund?' : 'Take this credit back from the order?'}
          detail={event.kind === 'refund' ? 'The customer holds that credit again. Use this only for a refund recorded by mistake.' : 'The amount is due on the order again and the customer holds the credit again.'}
          busy={remove.isPending}
          error={error}
          onCancel={() => {
            setAsking(false)
            setError(null)
          }}
          onConfirm={() => {
            setError(null)
            remove.mutate(
              { kind: event.kind, id: event.key.slice(2) },
              { onSuccess: () => setAsking(false), onError: e => setError(mapPgError(e).message) },
            )
          }}
        />
      ) : null}
    </li>
  )
}
