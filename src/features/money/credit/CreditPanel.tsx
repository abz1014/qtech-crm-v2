import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRightLeft, Undo2 } from 'lucide-react'
import { formatDay } from '@/lib/formatDay'
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
 * "Credit balance Rs X" on the company page (0117, 0118). Admin only: it is not rendered for anyone else, and the database refuses
 * every read and write of it. The balance is what the customer's orders hold above what they are worth (an overpayment, or a credit
 * note on a paid invoice) less what was refunded and what was put against another order. Two actions: Refund (cash out) and Apply to
 * an order (an allocation: no cash moves). Shown only when there is credit to give or a refund or applied credit to read.
 */
export function CreditPanel({ companyId, companyName, isAdmin }: { companyId: string; companyName: string; isAdmin: boolean }) {
  const q = useCompanyCredit(companyId, isAdmin)
  const [refund, setRefund] = useState(false)
  const [apply, setApply] = useState(false)
  if (!isAdmin || !q.data) return null
  const { summary, refunds, applications, orderRefs } = q.data
  if (!showCredit(summary, refunds.length, applications.length)) return null
  const events = creditEvents(refunds, applications)
  const give = summary.balance > 0
  return (
    <>
      <Panel
        title="Credit balance"
        info={
          <InfoTip label="About the credit balance">
            Money this customer has paid above what their orders are worth, including a credit note on an invoice they already paid, less what
            you refunded and what you put against another order. Refund it, or apply it to an order of theirs that still owes.
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
        <div className="px-5 py-3" data-testid="credit-balance">
          <p className="mb-2 text-sm text-fg-muted">
            <span className="sr-only">Credit balance </span>
            <Money value={summary.balance} size="xl" strong />
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
          <ul className="border-t" aria-label="Refunds and applied credit">
            {events.map(e => (
              <CreditLine key={e.key} companyId={companyId} event={e} orderRef={e.orderId ? (orderRefs[e.orderId] ?? null) : null} />
            ))}
          </ul>
        ) : null}
      </Panel>
      <RefundDialog open={refund} onOpenChange={setRefund} companyId={companyId} companyName={companyName} credit={summary} />
      <ApplyCreditDialog open={apply} onOpenChange={setApply} companyId={companyId} companyName={companyName} credit={summary} />
    </>
  )
}

function CreditLine({ companyId, event, orderRef }: { companyId: string; event: CreditEvent; orderRef: string | null }) {
  const remove = useRemoveCreditEntry(companyId)
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const label = event.kind === 'refund' ? 'Refunded' : 'Applied to'
  return (
    <li className="grid gap-2 border-t px-5 py-3 text-sm first:border-t-0">
      <div className="flex items-baseline gap-3">
        <span className="min-w-0 flex-1">
          <span className="font-medium">{label}</span>
          {orderRef && event.orderId ? (
            <>
              {' '}
              <Link to={`/orders/${event.orderId}`} className="num underline decoration-1 underline-offset-2 hover:text-fg">
                {orderRef}
              </Link>
            </>
          ) : null}
          <Fine className="mt-0.5">
            {formatDay(event.date)}
            {event.detail ? ` · ${event.detail}` : ''}
          </Fine>
        </span>
        <Money value={event.amount} />
        {!asking ? (
          <Button size="sm" variant="quiet" icon={Undo2} aria-label={`Remove this ${event.kind === 'refund' ? 'refund' : 'applied credit'}`} onClick={() => setAsking(true)} />
        ) : null}
      </div>
      {asking ? (
        <ConfirmRemove
          title={event.kind === 'refund' ? 'Remove this refund?' : 'Take this credit back off the order?'}
          detail={event.kind === 'refund' ? 'The customer holds that credit again. Use this only for a refund recorded by mistake.' : 'The order owes that amount again and the customer holds the credit again.'}
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
