import { NoPrimary } from '@/ui/NoPrimary'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, CircleCheck, Link2, Search } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { MoneyFrame, MoneySubHeader } from '@/features/money/MoneyFrame'
import type { ProposalView } from '@/features/money/review/api'
import { useFindMatches, useLinkAllCertain, useLinkOne, useReviewItems, useSetReview } from '@/features/money/review/hooks'
import { countProposals, proposalKey, reviewProgress, sortReview, visibleProposals, type ReviewItem, type ReviewState } from '@/features/money/review/model'

/*
 * Money > Review imported (P2-B, admin only; /money/review-imported). Plan section (e), "History and imported records", option (b):
 * an imported order or invoice whose money or goods are still open is looked at ONCE. "Still open" keeps it live (it follows the
 * normal rules and stays on To do); "Settled, keep as history" closes it (its open balance reads 0 and an order's costs are marked
 * complete). Above the list, "Find matches" proposes which imported order each imported invoice belongs to (same customer, PO,
 * amount): the certain ones can be linked in one tap, the likely ones are accepted or turned down one by one. Progress is
 * "n of N decided". Nothing is hidden: a record stays here until the owner decides. 16 px text, 44 px taps, one green button.
 */
export function ReviewImportedPage() {
  const q = useReviewItems()
  const [settledHere, setSettledHere] = useState<{ item: ReviewItem; state: ReviewState }[]>([])
  const items = useMemo(() => sortReview(q.data ?? []), [q.data])
  const progress = reviewProgress(items, settledHere.filter(s => s.state === 'settled').length)
  const pct = progress.total === 0 ? 100 : Math.round((progress.decided / progress.total) * 100)

  // Each row decides on its own mutation (useDecide): a second tap on another row must not lose the first row's result, Undo or error.
  const decided = (item: ReviewItem, state: ReviewState) =>
    setSettledHere(list => (state === 'to_review' ? list.filter(s => s.item.id !== item.id) : [...list.filter(s => s.item.id !== item.id), { item, state }]))

  return (
    <MoneyFrame active={null}>
      <NoPrimary />
      <MoneySubHeader back={{ to: '/money', label: 'Money' }} title="Review imported" />
      <p className="max-w-prose text-base text-fg-2">
        Records imported from the old system that still show money or goods open. Decide each one once: still open, or settled and kept as history. Nothing is hidden
        until you decide.
      </p>
      <Matches />
      <section aria-labelledby="review-h" className="rounded-panel border bg-surface">
        <header className="grid gap-2 border-b px-5 py-4">
          <h2 id="review-h" className="text-lg font-semibold" data-testid="review-progress">
            {progress.decided} of {progress.total} decided
          </h2>
          <div className="h-3 overflow-hidden rounded bg-selected" role="progressbar" aria-label="Decided" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
            <div className="h-full bg-brand-green" style={{ width: `${pct}%` }} />
          </div>
        </header>
        {q.isPending ? (
          <div className="grid gap-3 p-5" aria-busy="true">
            <Skeleton className="h-16" />
            <Skeleton className="h-16" />
          </div>
        ) : q.isError ? (
          <p role="alert" className="px-5 py-4 text-base text-tone-danger-fg">
            The records could not be loaded.{' '}
            <button type="button" className="font-medium underline" onClick={() => void q.refetch()}>
              Try again
            </button>
          </p>
        ) : items.length === 0 && settledHere.length === 0 ? (
          <EmptyState icon={CircleCheck} title="Nothing to review">
            Every imported record is either settled history or already reviewed.
          </EmptyState>
        ) : (
          <ul className="divide-y" data-testid="review-list">
            {items.map(i => (
              <Row key={i.kind + i.id} item={i} onDecided={decided} />
            ))}
            {settledHere
              .filter(s => s.state === 'settled')
              .map(s => (
                <SettledRow key={s.item.kind + s.item.id} item={s.item} onDecided={decided} />
              ))}
          </ul>
        )}
      </section>
    </MoneyFrame>
  )
}

/** One record's decision: its own mutation, its own toast and its own error line. */
function useDecide(item: ReviewItem, onDecided: (item: ReviewItem, state: ReviewState) => void) {
  const set = useSetReview()
  const { toast } = useToast()
  const [error, setError] = useState<string | null>(null)
  const decide = (state: ReviewState) => {
    setError(null)
    set.mutate(
      { kind: item.kind, id: item.id, state },
      {
        onSuccess: () => {
          onDecided(item, state)
          toast({ title: state === 'settled' ? 'Kept as history' : state === 'live' ? 'Kept open' : 'Back to review', body: `${item.title} · ${item.company}`, tone: 'success' })
        },
        onError: e => setError(mapPgError(e).message),
      },
    )
  }
  return { decide, busy: set.isPending, error }
}

function SettledRow({ item, onDecided }: { item: ReviewItem; onDecided: (item: ReviewItem, state: ReviewState) => void }) {
  const { decide, busy, error } = useDecide(item, onDecided)
  return (
    <li className="grid gap-2 px-5 py-4 text-base sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center" data-testid="review-settled-here">
      <span className="min-w-0">
        <b className="font-semibold">{item.title}</b> · {item.company}
        <span className="mt-1 inline-flex items-center gap-2 text-tone-success-fg sm:ml-3">
          <Icon icon={CircleCheck} />
          Settled, kept as history
        </span>
      </span>
      <Button size="touch" variant="quiet" onClick={() => decide('to_review')} disabled={busy} className="text-base">
        Undo
      </Button>
      {error ? (
        <p role="alert" className="text-tone-danger-fg sm:col-span-2">
          {error}
        </p>
      ) : null}
    </li>
  )
}

function Row({ item, onDecided }: { item: ReviewItem; onDecided: (item: ReviewItem, state: ReviewState) => void }) {
  const { decide: onDecide, busy, error } = useDecide(item, onDecided)
  const live = item.state === 'live'
  return (
    <li className="grid gap-3 px-5 py-4 text-base lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center" data-testid={`review-${item.kind}-${item.id}`}>
      <div className="grid min-w-0 gap-px">
        <span>
          <b className="font-semibold">{item.title}</b> · {item.company}
        </span>
        <span className="text-fg-2 [overflow-wrap:anywhere]">{item.facts}</span>
        {live ? (
          <span className="inline-flex items-center gap-2 text-tone-warning-fg">
            <Icon icon={Check} />
            Kept open: it is on To do
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {live ? null : (
          <Button size="touch" onClick={() => onDecide('live')} disabled={busy} className="text-base">
            Still open
          </Button>
        )}
        <Button size="touch" onClick={() => onDecide('settled')} disabled={busy} className="text-base">
          Settled, keep as history
        </Button>
      </div>
      {error ? (
        <p role="alert" className="text-tone-danger-fg lg:col-span-2">
          {error}
        </p>
      ) : null}
    </li>
  )
}

/** "Find matches": which imported order each imported invoice belongs to. Proposals only until the owner accepts. */
function Matches() {
  const find = useFindMatches()
  const linkOne = useLinkOne()
  const linkAll = useLinkAllCertain()
  const { toast } = useToast()
  const [found, setFound] = useState<ProposalView[] | null>(null)
  const [rejected, setRejected] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const shown = found ? visibleProposals(found, rejected) : []
  const counts = countProposals(shown)

  const run = () => {
    setError(null)
    find.mutate(undefined, { onSuccess: list => setFound(list), onError: e => setError(mapPgError(e).message) })
  }
  const accept = (p: ProposalView) => {
    setError(null)
    linkOne.mutate(
      { invoiceId: p.invoiceId, orderId: p.orderId },
      {
        onSuccess: () => {
          toast({ title: 'Linked', body: `${p.invoice} is on ${p.order}`, tone: 'success' })
          run() // every proposal that shared this invoice or order has changed
        },
        onError: e => setError(mapPgError(e).message),
      },
    )
  }
  const all = () => {
    setError(null)
    // exactly the certain proposals on screen: the ones turned down with "Not this" are not in `shown`
    linkAll.mutate(shown.filter(p => p.confidence === 'certain'), {
      onSuccess: n => {
        toast({ title: n === 1 ? 'Linked 1 invoice' : `Linked ${n} invoices`, body: 'Only the certain matches', tone: 'success' })
        run()
      },
      onError: e => {
        setError(mapPgError(e).message)
        run() // some may have been linked before the failure
      },
    })
  }

  return (
    <section aria-labelledby="match-h" className="rounded-panel border bg-surface">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-5 py-4">
        <h2 id="match-h" className="text-lg font-semibold">
          Link invoices to their orders
        </h2>
        <span className="flex-1" />
        <Button size="touch" icon={Search} onClick={run} busy={find.isPending} busyLabel="Looking" className="text-base">
          Find matches
        </Button>
        {counts.certain > 0 ? (
          <Button size="touch" variant="primary" icon={Link2} onClick={all} busy={linkAll.isPending} busyLabel="Linking" className="text-base">
            Link all certain
          </Button>
        ) : null}
      </header>
      {error ? (
        <p role="alert" className="border-b px-5 py-3 text-base text-tone-danger-fg">
          {error}
        </p>
      ) : null}
      {found === null ? (
        <p className="px-5 py-4 text-base text-fg-2">Imported invoices came without their orders. Find matches proposes them: the same customer, the PO number and the amount. Nothing is linked until you say so.</p>
      ) : shown.length === 0 ? (
        <p className="px-5 py-4 text-base text-fg-2" data-testid="no-matches">
          No matches left to propose.
        </p>
      ) : (
        <>
          <p className="border-b px-5 py-3 text-base text-fg-2" data-testid="match-counts">
            {counts.certain} certain, {counts.likely} likely
          </p>
          <ul className="divide-y" data-testid="match-list">
            {shown.map(p => (
              <li key={proposalKey(p)} className="grid gap-3 px-5 py-4 text-base lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center" data-confidence={p.confidence}>
                <div className="grid min-w-0 gap-px">
                  <span>
                    <b className="font-semibold">{p.invoice}</b> <span className="text-fg-2">({p.invoiceFacts})</span> on{' '}
                    <Link to={`/orders/${p.orderId}`} className="font-semibold text-primary underline-offset-2 hover:underline">
                      {p.order}
                    </Link>
                    {p.orderFacts ? <span className="text-fg-2"> ({p.orderFacts})</span> : null}
                  </span>
                  <span className="text-fg-2">
                    {p.company} · <b className={p.confidence === 'certain' ? 'font-semibold text-tone-success-fg' : 'font-semibold text-tone-warning-fg'}>{p.confidence === 'certain' ? 'Certain' : 'Likely'}</b>
                  </span>
                  <span className="text-fg-2 [overflow-wrap:anywhere]">{p.reasons.join('; ')}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button size="touch" onClick={() => accept(p)} disabled={linkOne.isPending || linkAll.isPending} className="text-base">
                    Accept
                  </Button>
                  <Button size="touch" variant="quiet" onClick={() => setRejected(r => new Set([...r, proposalKey(p)]))} className="text-base">
                    Not this
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}
