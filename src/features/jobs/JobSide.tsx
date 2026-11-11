import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Ban, FileText, MessageCircle, Phone, RotateCcw, User, Wallet } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { orderRef } from '@/lib/refs'
import { cancelReasonLabel } from '@/features/orders/lib/cancel'
import { waLink } from '@/lib/messageLinks'
import { isFinalMargin } from '@/lib/money'
import { Money } from '@/ui/Money'
import { Icon } from '@/ui/Icon'
import { Button } from '@/ui/Button'
import { FoldRow } from '@/ui/FoldRow'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { mapPgError } from '@/lib/pgErrors'
import { useCancelOrder } from '@/features/orders/hooks'
import { qk } from '@/features/queryKeys'
import { signFileUrls, type AttachmentRow } from '@/features/rfqs/api'
import type { JobFacts } from '@/features/jobs/api'
import type { JobData } from '@/features/jobs/useJobData'
import { HasPricesToggle } from '@/features/rfqs/HasPricesToggle'
import { JobSlot, type JobContext } from '@/features/jobs/slots'
import { latestQuotation } from '@/features/jobs/lib/latestQuotation'
import { ImportedNote } from '@/features/jobs/ImportedNote'

/*
 * The rest of the job page's one list (clarity redesign), after the seven steps: Contact (name, Call, WhatsApp always in view), Money (PKR)
 * (admin only), Add to this job, Notes and files, and the orders that were cancelled inside this job. Each is one hairline row, closed
 * until opened; an empty one says so in its one line. An engineer's list has no Money row, and the database hides every file that
 * carries prices from them (attachments.has_prices, migration 0100), so no filter is needed here.
 */
const linkBtn =
  'inline-flex min-h-touch items-center gap-2 rounded border border-line-strong bg-surface px-3 text-base font-semibold text-fg hover:bg-sunken'

/** Contact is never folded: the person, and Call and WhatsApp, are the reason a phone opens this page on site. */
/** `showWhere`: the person's title and the site address under the name (an engineer needs the address; the office has it elsewhere). */
export function ContactRow({ facts, showWhere = false }: { facts: JobFacts; showWhere?: boolean }) {
  const c = facts.contact
  if (!c) {
    return (
      <section aria-label="Contact" className="flex min-h-touch items-center gap-3 border-b py-2">
        <Icon icon={User} className="text-fg-muted" />
        <h2 className="type-row">Contact</h2>
        <p className="type-body min-w-0 flex-1 text-right text-fg-muted">No contact person is set</p>
      </section>
    )
  }
  const wa = waLink(c.phone, '')
  const where = [c.jobTitle, facts.site?.name, facts.site?.address].filter(Boolean).join(' · ')
  return (
    <section aria-label="Contact" className="border-b py-2">
      <div className="flex min-h-touch items-center gap-3">
        <Icon icon={User} className="text-fg-muted" />
        <h2 className="type-row">Contact</h2>
        <p className="type-body min-w-0 flex-1 text-right text-fg-2 [overflow-wrap:anywhere]">{c.name}</p>
      </div>
      {where && showWhere ? <p className="type-body pb-2 pl-8 text-fg-2 [overflow-wrap:anywhere]">{where}</p> : null}
      <div data-row-actions="" className="flex flex-wrap gap-2 pb-2 pl-8">
        {c.phone ? (
          <a className={linkBtn} href={`tel:${c.phone.replace(/[^\d+]/g, '')}`} aria-label={`Call ${c.name}, ${c.phone}`}>
            <Icon icon={Phone} />
            Call
          </a>
        ) : null}
        {wa ? (
          <a className={linkBtn} href={wa.url} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${c.name}`}>
            <Icon icon={MessageCircle} />
            WhatsApp
          </a>
        ) : null}
      </div>
    </section>
  )
}

const MONEY_STATE = { icon: Wallet, word: '' }

/**
 * Admin only. One row, "Money (PKR) / Still to collect N", that opens the full figures. With no order yet (an enquiry-stage job) the
 * order-money query is switched off, so it never leaves "pending": the row asks about the order only when the job has one, and otherwise
 * says plainly that there is no money yet, with the quoted value when a quotation was sent. "Costs not entered yet" while the costs are
 * 0; the profit is "Not known yet" until the costs are marked final. The balance in the row is the order page's own `order-balance`.
 */
export function MoneyRow({ data, hasOrder }: { data: JobData; hasOrder: boolean }) {
  const [open, setOpen] = useState(false)
  const m = data.orderMoney.data
  const row = (summary: ReactNode, body: ReactNode) => (
    <FoldRow state={MONEY_STATE} title="Money (PKR)" summary={summary} figure open={open} onToggle={() => setOpen(o => !o)} controlsId="job-money-body" bodyLabel="Money for this job">
      {body}
    </FoldRow>
  )
  if (!hasOrder) {
    const q = latestQuotation(data.quotations.data)
    return row(
      q ? (
        <>
          Quoted <Money value={q.netTotal + q.gstTotal} prefix={false} strong />
        </>
      ) : (
        'None yet'
      ),
      <>
        {q ? (
          <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-base">
            <dt className="text-fg-2">Quoted (with GST)</dt>
            <dd className="pl-4 text-right"><Money value={q.netTotal + q.gstTotal} /></dd>
          </dl>
        ) : (
          <p className="text-base text-fg-muted">No money yet: no quotation has been sent.</p>
        )}
        <p className="mt-2 text-base text-fg-muted">{q ? 'Nothing is owed until the customer places an order.' : 'Money appears here once a quotation is sent and an order is placed.'}</p>
      </>,
    )
  }
  if (!m) {
    return row(
      data.orderMoney.isError ? 'Not loaded' : 'Loading',
      data.orderMoney.isError ? (
        <p className="text-base text-fg-muted">
          Could not load the money for this job. Nothing was changed.{' '}
          <button type="button" className="font-medium text-fg underline" onClick={() => void data.orderMoney.refetch()}>
            Try again
          </button>
        </p>
      ) : (
        <div role="status" aria-busy="true" aria-label="Loading the money for this job" className="grid gap-3">
          {[0, 1, 2, 3].map(i => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      ),
    )
  }
  const costs = m.actualCost ?? 0
  const final = isFinalMargin(m.marginState as never)
  return row(
    <>
      Still to collect{' '}
      <span data-testid="order-balance">
        <Money value={m.balance} prefix={false} strong />
      </span>
    </>,
    <>
      <dl className="grid grid-cols-[1fr_auto] gap-y-2 text-base">
        <dt className="text-fg-2">Sale (with GST)</dt>
        <dd className="pl-4 text-right"><Money value={m.grossTarget} /></dd>
        <dt className="text-fg-2">Received</dt>
        <dd className="pl-4 text-right"><Money value={m.settled} prefix={false} /></dd>
        <dt className="border-t pt-2 font-semibold">Still to collect</dt>
        <dd className="border-t pl-4 pt-2 text-right"><Money value={m.balance} prefix={false} strong /></dd>
        <dt className="text-fg-2">Costs so far</dt>
        <dd className="pl-4 text-right">{costs > 0 ? <Money value={costs} prefix={false} /> : <span className="text-fg-muted">Costs not entered yet</span>}</dd>
        <dt className="text-fg-2">Profit</dt>
        <dd className="pl-4 text-right">{final && m.margin !== null ? <Money value={m.margin} prefix={false} /> : <span className="text-fg-muted">Not known yet</span>}</dd>
      </dl>
      {!final && costs > 0 ? <p className="mt-3 text-base text-fg-muted">Freight and clearing may still come. Profit shows when the costs are marked final.</p> : null}
    </>,
  )
}

interface TimelineEntry {
  at: string
  kind: 'note' | 'file'
  text: string
  file?: AttachmentRow
  from?: 'rfq' | 'order'
}

const FILES_STATE = { icon: FileText, word: '' }

/** "3 notes · 4 files", or "None yet". The count is of what the timeline below holds. */
function countLine(notes: number, files: number): string {
  const parts = [notes ? `${notes} ${notes === 1 ? 'note' : 'notes'}` : null, files ? `${files} ${files === 1 ? 'file' : 'files'}` : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'None yet'
}

export function NotesFilesRow({ facts, data, ctx }: { facts: JobFacts; data: JobData; ctx: JobContext }) {
  const [open, setOpen] = useState(false)
  const today = businessToday()
  const rfqFiles = data.rfqFiles.data ?? []
  const orderFiles = data.orderFiles.data ?? []
  const files = [...rfqFiles, ...orderFiles]
  const paths = files.map(f => f.path).sort()
  const urls = useQuery({ queryKey: qk.jobs.fileUrls(paths.join('|')), queryFn: () => signFileUrls(paths), enabled: paths.length > 0 && open, staleTime: 8 * 60_000 })
  const notes = [facts.notes, data.order.data?.notes && data.order.data.notes !== facts.notes ? data.order.data.notes : null].filter((n): n is string => Boolean(n && n.trim()))
  const entries: TimelineEntry[] = [
    ...notes.map(n => ({ at: facts.receivedOn ?? '', kind: 'note' as const, text: n })),
    ...files.map(f => ({ at: f.createdAt.slice(0, 10), kind: 'file' as const, text: f.fileName, file: f, from: (rfqFiles.includes(f) ? 'rfq' : 'order') as 'rfq' | 'order' })),
  ].sort((a, b) => b.at.localeCompare(a.at))
  return (
    <>
      <FoldRow state={FILES_STATE} title="Notes and files" summary={countLine(notes.length, files.length)} open={open} onToggle={() => setOpen(o => !o)} controlsId="job-notes-body" bodyLabel="Notes and files">
        <div className="grid gap-3">
          <div className="flex justify-end">
            <JobSlot name="files" context={ctx} />
          </div>
          {entries.length === 0 ? (
            <p className="text-base text-fg-muted">No notes or files yet.</p>
          ) : (
            <ul className="grid gap-3">
              {entries.map((e, i) => (
                <li key={`${e.kind}-${i}`} className="grid grid-cols-[4.5rem_1fr] gap-3 text-base">
                  <span className="num pt-px text-stamp text-fg-muted">{e.at ? formatShortDate(e.at, today) : ''}</span>
                  {e.kind === 'file' && e.file ? (
                    <span className="grid min-w-0 gap-1">
                      {urls.data?.[e.file.path] ? (
                        <a href={urls.data[e.file.path]} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-start gap-2 rounded text-primary hover:underline">
                          <Icon icon={FileText} className="mt-[3px] shrink-0" />
                          <span className="min-w-0 [overflow-wrap:anywhere]">{e.text}</span>
                        </a>
                      ) : (
                        <span className="inline-flex min-w-0 items-start gap-2 text-fg-2">
                          <Icon icon={FileText} className="mt-[3px] shrink-0 text-fg-muted" />
                          <span className="min-w-0 [overflow-wrap:anywhere]">{e.text}</span>
                        </span>
                      )}
                      {e.file.isCustomerPo ? <span className="w-fit rounded border border-line-strong px-2 text-base font-semibold text-fg-2">Customer PO</span> : null}
                      <HasPricesToggle att={e.file} rfqId={e.from === 'rfq' ? (facts.job.rfqId ?? undefined) : undefined} orderId={e.from === 'order' ? (facts.job.orderId ?? undefined) : undefined} />
                    </span>
                  ) : (
                    <span className="min-w-0 whitespace-pre-line [overflow-wrap:anywhere]">{e.text}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </FoldRow>
      {/* 0135: the old system's free text, closed until opened, admin and sales only (an engineer's page draws and asks nothing) */}
      <ImportedNote rfqId={facts.job.rfqId} orderId={facts.job.orderId} role={ctx.role} />
    </>
  )
}

/** A cancelled order is history inside its job; a cancel followed by a reorder stays one job. */
function ReopenOrder({ id, number, reason, cancelledOn }: { id: string; number: number; reason: string | null; cancelledOn: string }) {
  const { toast } = useToast()
  const cancel = useCancelOrder(id)
  const ref = orderRef(number)
  return (
    <Button
      size="sm"
      variant="quiet"
      icon={RotateCcw}
      busy={cancel.isPending}
      aria-label={`Reopen order ${ref}`}
      onClick={async () => {
        try {
          // the reason goes with the date: the database refuses a reason on an active order
          await cancel.mutateAsync({ cancelled_on: null, cancel_reason: null })
          toast({
            title: 'Order reopened',
            body: ref,
            undo: {
              onUndo: async () => {
                await cancel.mutateAsync({ cancelled_on: cancelledOn, cancel_reason: reason })
              },
              settledTitle: 'Order reopened',
              undoneTitle: 'Cancelled again',
            },
          })
        } catch (err) {
          toast({ title: 'Could not reopen', body: mapPgError(err, { entity: 'order' }).message, tone: 'danger' })
        }
      }}
    >
      Reopen order
    </Button>
  )
}

const CANCELLED_STATE = { icon: Ban, word: '' }

export function CancelledOrders({ data, money = false }: { data: JobData; money?: boolean }) {
  const [open, setOpen] = useState(false)
  const rows = data.cancelled.data ?? []
  if (rows.length === 0) return null
  const today = businessToday()
  return (
    <FoldRow state={CANCELLED_STATE} title="Cancelled orders" summary={String(rows.length)} open={open} onToggle={() => setOpen(o => !o)} controlsId="job-cancelled-body" bodyLabel="Cancelled orders">
      <ul className="grid gap-2 text-base">
        {rows.map(o => (
          <li key={o.id}>
            <span className="num font-medium">{orderRef(o.number)}</span>{' '}
            <span className="text-fg-2">{`cancelled ${formatShortDate(o.cancelledOn, today)}${cancelReasonLabel(o.reason) ? `: ${cancelReasonLabel(o.reason)}` : ''}`}</span>
            {money ? <ReopenOrder id={o.id} number={o.number} reason={o.reason ?? null} cancelledOn={o.cancelledOn} /> : null}
          </li>
        ))}
      </ul>
    </FoldRow>
  )
}
