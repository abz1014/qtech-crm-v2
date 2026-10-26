import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { pkr } from '@/lib/formRules'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { Checkbox } from '@/ui/form/Checkbox'
import { invalidateAfter } from '@/features/invalidation'
import { setRfqClosed } from '@/features/rfqs/api'
import { addDays } from '@/features/rfqs/lib/dateText'
import { snoozeItem, unsnoozeItem } from '@/features/today/api'
import { useBusinessToday, useTodayView } from '@/features/today/hooks'
import { buildTeam } from '@/features/today/teamModel'
import { headerDate } from '@/features/today/text'
import { REVIEW_RULE, STILL_LIVE_DAYS, buildReview, reviewCount, type ReviewKind, type ReviewRow } from '@/features/today/weeklyReview'
import type { Role } from '@/features/today/types'

/*
 * Weekly review (redesign phase 3, P3-C1; admin only, route /todo/review): about 10 minutes every Monday. Where old and stuck work goes
 * instead of turning red on everybody's list. Four lists (weeklyReview.ts) and, for each row, three answers:
 *   Still live     keep it; it stays out of the next two reviews (a snooze under its own review key)
 *   Chase          go to the record and chase it (Copy reminder and Record payment for a payment)
 *   Close as lost  close the RFQ (quotation and enquiry rows); Undo reopens it
 * Tick several rows for Still live or Close selected as lost together. Nothing is decided for anyone: every change has an Undo.
 */
const SECTIONS: ReadonlyArray<{ kind: ReviewKind; title: string; why: string }> = [
  { kind: 'quotation', title: 'Quotations with no decision after 10 working days', why: 'Ask the customer, or let it go.' },
  { kind: 'enquiry', title: 'Enquiries with no supplier asked after 10 days', why: 'Ask suppliers now, or close it.' },
  { kind: 'goods', title: 'Goods more than 14 days late', why: 'Chase the supplier, or move the date.' },
  { kind: 'payment', title: 'Payments more than 30 days late', why: 'They also stay at the top of To do.' },
]

const CLOSE_NOTE: Record<'quotation' | 'enquiry', string> = {
  quotation: 'Weekly review: no decision from the customer',
  enquiry: 'Weekly review: no supplier was asked',
}

export default function ReviewPage() {
  const session = useSession()
  if (session.status !== 'signed-in' || session.user.role !== 'admin') return null
  return <ReviewBody user={{ id: session.user.id, role: 'admin' }} />
}

function ReviewBody({ user }: { user: { id: string; role: Role } }) {
  useMobileBar({ title: 'Weekly review', back: { to: '/todo', label: 'To do' } })
  const today = useBusinessToday()
  const navigate = useNavigate()
  const client = useQueryClient()
  const { toast } = useToast()
  const { data, query } = useTodayView(user, today)
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const review = useMemo(() => (data ? buildReview({ today, rfqs: data.rfqs, legs: data.legs, receivables: data.receivables, snoozes: data.snoozes }) : null), [data, today])
  const rows = useMemo(() => (review ? Object.values(review).flat() : []), [review])
  const selected = rows.filter(r => ticked.has(r.key))
  const closable = selected.filter(r => r.kind === 'quotation' || r.kind === 'enquiry')
  const stale = useMemo(() => (data ? buildTeam(data, today, '').filter(p => p.stale.length > 0) : []), [data, today])
  const total = review ? reviewCount(review) : 0

  const toggle = (k: string) =>
    setTicked(s => {
      const n = new Set(s)
      if (n.has(k)) n.delete(k)
      else n.add(k)
      return n
    })

  const run = async (work: () => Promise<void>, fail: string) => {
    setBusy(true)
    try {
      await work()
      setTicked(new Set())
    } catch (err) {
      toast({ title: fail, body: mapPgError(err).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const stillLive = (list: readonly ReviewRow[]) =>
    run(async () => {
      const until = addDays(today, STILL_LIVE_DAYS) as string
      await Promise.all(list.map(r => snoozeItem({ rule: REVIEW_RULE[r.kind], subjectId: r.subjectId, untilOn: until })))
      invalidateAfter(client, 'today.snooze', {})
      toast({
        title: list.length === 1 ? 'Still live' : `${list.length} still live`,
        body: 'They come back in two weeks if nothing has changed.',
        tone: 'success',
        undo: {
          onUndo: async () => {
            await Promise.all(list.map(r => unsnoozeItem({ rule: REVIEW_RULE[r.kind], subjectId: r.subjectId })))
            invalidateAfter(client, 'today.snooze', {})
          },
        },
      })
    }, 'Could not save it')

  const closeLost = (list: readonly ReviewRow[]) => {
    const rfqs = list.filter(r => r.rfqId && (r.kind === 'quotation' || r.kind === 'enquiry'))
    return run(async () => {
      await Promise.all(rfqs.map(r => setRfqClosed({ rfqId: r.rfqId as string, closedOn: today, reason: 'other', note: CLOSE_NOTE[r.kind as 'quotation' | 'enquiry'] })))
      rfqs.forEach(r => invalidateAfter(client, 'rfq.close', { rfqId: r.rfqId as string }))
      toast({
        title: rfqs.length === 1 ? 'Closed as lost' : `${rfqs.length} closed as lost`,
        body: 'They are in History. Undo opens them again.',
        tone: 'success',
        undo: {
          onUndo: async () => {
            await Promise.all(rfqs.map(r => setRfqClosed({ rfqId: r.rfqId as string, closedOn: null, reason: null, note: null })))
            rfqs.forEach(r => invalidateAfter(client, 'rfq.close', { rfqId: r.rfqId as string }))
          },
        },
      })
    }, 'Could not close it')
  }

  return (
    <div className="mx-auto grid max-w-[920px] gap-5 px-4 py-5 md:px-6" data-review>
      <header className="grid gap-1">
        <Link to="/todo" className="inline-flex min-h-touch items-center gap-1 justify-self-start rounded text-base font-medium text-primary underline-offset-2 hover:underline max-md:hidden">
          <Icon icon={ChevronLeft} size="sm" /> To do
        </Link>
        <h1 className="text-2xl font-heavy tracking-tight">Weekly review</h1>
        <p className="text-base text-fg-muted">
          {headerDate(today)}
          {review ? <> · <b className="num font-medium text-fg" data-review-count>{total}</b> to decide · about 10 minutes</> : null}
        </p>
      </header>

      {query.isPending ? (
        <div role="status" aria-busy="true" aria-label="Loading the review" className="grid gap-3">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      ) : query.isError || !review ? (
        <EmptyState mood="error" title="The review could not load" actions={<Button onClick={() => void query.refetch()}>Try again</Button>}>
          Nothing was changed. Check your connection and try again.
        </EmptyState>
      ) : (
        <>
          {total === 0 ? (
            <EmptyState mood="goal" title="Nothing to decide this week">
              No quotation, enquiry, delivery or payment has been waiting past its limit.
            </EmptyState>
          ) : null}

          {selected.length > 0 ? (
            <div role="region" aria-label="Selected" className="sticky top-0 z-10 flex flex-wrap items-center gap-2 rounded-panel border bg-surface p-3 shadow-pop" data-bulk>
              <span className="mr-auto text-base font-semibold">
                <span className="num">{selected.length}</span> selected
              </span>
              <Button disabled={busy} onClick={() => void stillLive(selected)}>
                Still live
              </Button>
              <Button disabled={busy || closable.length === 0} onClick={() => void closeLost(closable)}>
                Close selected as lost
              </Button>
              <Button variant="quiet" onClick={() => setTicked(new Set())}>
                Clear
              </Button>
            </div>
          ) : null}

          {SECTIONS.map(s =>
            review[s.kind].length === 0 ? null : (
              <section key={s.kind} aria-label={s.title} data-kind={s.kind} className="grid gap-2 rounded-panel border bg-surface p-3 md:p-4">
                <div className="flex flex-wrap items-baseline gap-x-3 px-1">
                  <h2 className="text-lg font-semibold">{s.title}</h2>
                  <span className="text-base text-fg-muted">{s.why}</span>
                </div>
                <ul className="grid gap-2">
                  {review[s.kind].map(r => (
                    <Row
                      key={r.key}
                      row={r}
                      owner={r.ownerId ? data?.names[r.ownerId] : undefined}
                      ticked={ticked.has(r.key)}
                      busy={busy}
                      onTick={() => toggle(r.key)}
                      onStillLive={() => void stillLive([r])}
                      onClose={() => void closeLost([r])}
                      onGo={href => navigate(href)}
                    />
                  ))}
                </ul>
              </section>
            ),
          )}

          {stale.length > 0 ? (
            <section aria-label="Older than 30 days, per person" className="grid gap-2 rounded-panel border bg-surface p-4">
              <h2 className="text-lg font-semibold">Older than 30 days, per person</h2>
              <p className="text-base text-fg-muted">Shown in grey on their own lists, so they are not lost.</p>
              <ul className="flex flex-wrap gap-2">
                {stale.map(p => (
                  <li key={p.id} className="rounded-round bg-sunken px-3 py-1 text-base">
                    {p.name} <span className="num font-semibold">{p.stale.length}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  )
}

function Row({ row, owner, ticked, busy, onTick, onStillLive, onClose, onGo }: { row: ReviewRow; owner?: string; ticked: boolean; busy: boolean; onTick: () => void; onStillLive: () => void; onClose: () => void; onGo: (href: string) => void }) {
  const closable = row.kind === 'quotation' || row.kind === 'enquiry'
  const tone = row.tone === 'danger' ? 'text-tone-danger-fg' : row.tone === 'warning' ? 'text-tone-warning-fg' : 'text-fg-muted'
  const act = (label: string, onClick: () => void, extra?: ReactNode) => (
    <Button variant="secondary" disabled={busy} onClick={onClick} aria-label={`${label}: ${row.title}`}>
      {label}
      {extra}
    </Button>
  )
  return (
    <li data-row={row.key} className={cn('grid gap-2 rounded-row bg-canvas px-3 py-3 md:grid-cols-[auto_minmax(0,1fr)_auto] md:items-center md:gap-3', ticked && 'ring-2 ring-inset ring-fg')}>
      <Checkbox aria-label={`Select ${row.title}`} checked={ticked} onCheckedChange={onTick} disabled={busy} />
      <div className="grid min-w-0 gap-px">
        <span className="min-w-0 text-base font-semibold [overflow-wrap:anywhere]">{row.title}</span>
        <span className={cn('min-w-0 text-base [overflow-wrap:anywhere]', tone)}>
          {row.detail}
          {row.amount ? <> · <span className="num">{pkr(row.amount)}</span></> : null}
        </span>
        {owner ? <span className="text-base text-fg-muted">{owner}</span> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        {act('Still live', onStillLive)}
        {row.kind === 'payment' ? (
          <>
            {act('Chase', () => onGo(row.href))}
            {act('Record payment', () => onGo(`/money/receivables?pay=1&order=${row.orderId}`))}
          </>
        ) : (
          act('Chase', () => onGo(row.href))
        )}
        {closable ? act('Close as lost', onClose) : null}
      </div>
    </li>
  )
}
