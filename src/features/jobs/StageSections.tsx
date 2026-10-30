import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { visitTypeLabel } from '@/features/orders/lib/visit'
import { isContentDrawn, whenContentDrawn } from '@/lib/afterContent'
import { lazyWithReload } from '@/lib/importWithReload'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Skeleton'
import { useWonDialog } from '@/features/orders/useWonDialog'
import { Link } from 'react-router-dom'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { orderRef } from '@/lib/refs'
import { Icon } from '@/ui/Icon'
import { Money } from '@/ui/Money'
import type { JobFacts } from '@/features/jobs/api'
import type { JobData } from '@/features/jobs/useJobData'
import { JobSlot, type JobContext } from '@/features/jobs/slots'
import { stageSlot } from '@/features/jobs/slotRegistry'
import { quotationRef } from '@/features/jobs/lib/refs'
import { STOPS, type StageModel, type StopName, type StopState } from '@/features/jobs/lib/stages'

// The enquiry side's real components (P5-D1): downloaded when the Quotation stage is first opened, not with the job page.
const EnquiryWork = lazyWithReload(() => import('@/features/jobs/EnquiryWork'))

/** The enquiry work is downloaded once the page's content is drawn (immediately on any later page), not before the first paint (perf: LCP). */
function LaterEnquiryWork({ rfqId, jobKey }: { rfqId: string; jobKey: string }) {
  const [ready, setReady] = useState(isContentDrawn())
  useEffect(() => {
    if (!ready) whenContentDrawn(() => setReady(true))
  }, [ready])
  return ready ? <EnquiryWork rfqId={rfqId} jobKey={jobKey} /> : <Skeleton className="h-[10rem] w-full" />
}

/*
 * The job's stages as an accordion (plan "Page layout": the current stage open, earlier ones folded to one line each, later ones grey).
 * Read-only in this release: each section folds what the RFQ page and the order page already hold, read through the same hooks. The
 * actions arrive stage by stage in the slots under each body (slots.tsx). An engineer's sections hold no amount, and Invoice and
 * Payment say "Handled by the office".
 */
const dash = <span className="text-fg-muted">—</span>
const day = (iso: string | null | undefined) => (iso ? <span className="num">{formatShortDate(iso, businessToday())}</span> : dash)

function Table({ head, rows, label }: { head: readonly string[]; rows: ReactNode[][]; label: string }) {
  const cols = { gridTemplateColumns: `minmax(0,1.6fr) ${head
    .slice(1)
    .map(() => 'minmax(0,1fr)')
    .join(' ')}` }
  const right = (h: string) => /^(Qty|Amount|Each)/.test(h)
  return (
    <div role="table" aria-label={label} className="text-sm">
      <div role="row" style={cols} className="grid gap-x-2 px-1 py-2 text-fg-muted">
        {head.map(h => (
          <div key={h} role="columnheader" className={cn('font-medium', right(h) && 'text-right')}>
            {h}
          </div>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={i} role="row" style={cols} className="grid gap-x-2 border-t px-1 py-3">
          {r.map((c, j) => (
            <div key={j} role="cell" className={cn('min-w-0 [overflow-wrap:anywhere]', right(head[j]) && 'text-right')}>
              {c}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

const Note = ({ children }: { children: ReactNode }) => <p className="py-2 text-base text-fg-2">{children}</p>

interface Section {
  stop: StopName
  shown: string
  index: number
  state: StopState
  summary: ReactNode
  body: ReactNode
}

function buildSections(facts: JobFacts, d: JobData, model: StageModel, ctx: JobContext, markWon: () => void): Section[] {
  const { job } = facts
  const direct = job.kind === 'direct'
  const today = businessToday()
  const items = d.items.data ?? []
  const inquiries = d.inquiries.data ?? []
  const quotes = d.quotations.data ?? []
  const order = d.order.data ?? null
  const legs = d.legs.data ?? []
  const invoices = d.invoices.data ?? []
  const m = d.orderMoney.data ?? null
  const answered = inquiries.filter(i => i.noOfferOn || i.itemsQuoted > 0).length
  const asked = inquiries.filter(i => i.sentOn || i.noOfferOn).length
  const delivered = legs.filter(l => l.deliveredOn).length
  const office = <Note>Handled by the office.</Note>
  const state = (i: number) => model.stops[i].state
  const detailFor = (i: number) => model.stops[i].note

  const enquiryBody = direct ? (
    <Note>This job started as an order, without an enquiry.</Note>
  ) : (
    <div className="grid gap-2">
      <p className="text-base text-fg-2">
        {facts.contact ? `From ${facts.contact.name}. ` : ''}
        {facts.customerRef ? `Their reference ${facts.customerRef}. ` : ''}
        {facts.dueOn ? <>Answer due {day(facts.dueOn)}.</> : null}
      </p>
      {items.length ? (
        <Table head={['Item', 'Qty']} label="Items asked for" rows={items.map(i => [i.description, <span key="q" className="num">{`${i.qty}${i.unit ? ` ${i.unit}` : ''}`}</span>])} />
      ) : (
        <Note>No items yet.</Note>
      )}
      {rfqLink(job.rfqId, 'Open the enquiry page')}
    </div>
  )

  const supplierRows = inquiries.map(i => [
    <span key="s" className="font-medium">{i.supplierName}</span>,
    i.sentOn ? day(i.sentOn) : <span className="text-fg-muted">Not asked yet</span>,
    i.noOfferOn ? 'No price yet' : i.itemsQuoted > 0 ? `Priced, ${i.itemsQuoted} ${i.itemsQuoted === 1 ? 'item' : 'items'}` : i.sentOn ? 'Waiting' : '—',
  ])
  const quotationBody = direct ? (
    <Note>No quotation: this job started as an order.</Note>
  ) : job.rfqId ? (
    // Ask suppliers, their replies and prices, the items, the quotation and Issue quotation: the RFQ page's own components.
    <Suspense fallback={<Skeleton className="h-[10rem] w-full" />}>
      <LaterEnquiryWork rfqId={job.rfqId} jobKey={job.key} />
    </Suspense>
  ) : (
    <div className="grid gap-3">
      {inquiries.length ? <Table head={['Supplier', 'Asked', 'Answer']} label="Suppliers asked" rows={supplierRows} /> : <Note>No supplier has been asked yet.</Note>}
      {ctx.money && quotes.length ? (
        <Table
          head={['Quotation', 'Issued', 'Valid until']}
          label="Quotations"
          rows={quotes.map(q => [<span key="n" className="num font-medium">{`${quotationRef(q.number, q.issuedOn)}${q.revision ? ` R${q.revision}` : ''}`}</span>, day(q.issuedOn), day(q.validUntil)])}
        />
      ) : null}
      {rfqLink(job.rfqId, 'Open the enquiry page')}
    </div>
  )

  const orderBody = !job.orderId ? (
    <div className="grid gap-2">
      <Note>{direct ? 'The order is not available.' : "There is no order yet. It starts when the customer's order arrives and the enquiry is marked won."}</Note>
      {/* once quoted, Mark won is the next-step band's green button: not repeated here */}
      {!direct && ctx.money && job.stage !== 'lost' && job.stage !== 'quoted' ? (
        <p>
          <Button onClick={markWon}>Mark won</Button>
        </p>
      ) : null}
    </div>
  ) : (
    <div className="grid gap-2">
      <p className="text-base text-fg-2">
        {order?.orderedOn ? <>Ordered {day(order.orderedOn)}. </> : null}
        {ctx.money && order?.customerPo ? `Customer's order no. ${order.customerPo}. ` : ''}
        {ctx.money && order?.paymentTermsDays != null ? `Payment terms ${order.paymentTermsDays} days. ` : ''}
      </p>
      {/* the order lines, Edit GST and lines and Remove line are the slot below (orders/jobSlots/OrderWork) */}
      {ctx.money ? orderLink(job.orderId, 'Open the order page') : null}
    </div>
  )

  const legBody = !job.orderId ? (
    <Note>Starts once the order is placed.</Note>
  ) : legs.length ? (
    <div className="grid gap-2">
      {/* the supplier orders and their buttons are the slot below (orders/jobSlots/SupplierOrderWork) */}
      {ctx.money ? orderLink(job.orderId, 'Open the order page') : null}
    </div>
  ) : (
    <Note>No supplier order yet. Choose a supplier for each line below.</Note>
  )

  const deliveryBody = !job.orderId ? (
    <Note>Starts when the goods arrive.</Note>
  ) : (
    <div className="grid gap-1 text-base text-fg-2">
      <p>{legs.length ? `${delivered} of ${legs.length} supplier ${legs.length === 1 ? 'order' : 'orders'} delivered to the customer.` : 'No goods to deliver.'}</p>
      {order?.needsCommissioning ? (
        <p>
          {order.doneOn ? <>{visitTypeLabel(order.visitType) || 'Installation'} done {day(order.doneOn)}.</> : order.plannedOn ? <>{visitTypeLabel(order.visitType) || 'Installation'} planned {day(order.plannedOn)}.</> : 'Installation needs a date.'}
          {d.engineers.data?.length ? ` Engineer: ${d.engineers.data.map(e => e.name).join(', ')}.` : ''}
        </p>
      ) : (
        <p>No installation needed.</p>
      )}
    </div>
  )

  const invoiceBody = !ctx.money ? (
    office
  ) : !job.orderId ? (
    <Note>Invoices start once the goods are delivered.</Note>
  ) : invoices.length ? (
    <Table head={['Invoice', 'Date', 'Amount, PKR']} label="Invoices" rows={invoices.map(v => [<span key="n" className="num font-medium">{v.number ?? 'No number'}</span>, day(v.invoiceDate), <Money key="a" value={v.gross} prefix={false} />])} />
  ) : (
    <Note>Nothing is invoiced yet.</Note>
  )

  const paymentBody = !ctx.money ? (
    office
  ) : !job.orderId ? (
    <Note>Payment starts once there is an order.</Note>
  ) : m ? (
    <div className="grid gap-1 text-base text-fg-2">
      <p>
        Received <Money value={m.settled} strong /> of <Money value={m.grossTarget} />.
      </p>
      <p>
        Still to collect <Money value={m.balance} strong />
        {m.dueOn ? <>, due {day(m.dueOn)}</> : null}.
      </p>
    </div>
  ) : (
    <Note>No payment is recorded yet.</Note>
  )

  const bodies: ReactNode[] = [enquiryBody, quotationBody, orderBody, legBody, deliveryBody, invoiceBody, paymentBody]

  const summaries: ReactNode[] = [
    direct ? 'No enquiry: this job started as an order' : [facts.receivedOn ? `Received ${formatShortDate(facts.receivedOn, today)}` : null, facts.customerRef ? `their ref ${facts.customerRef}` : null, items.length ? `${items.length} ${items.length === 1 ? 'item' : 'items'}` : null].filter(Boolean).join(' · ') || 'Enquiry',
    direct
      ? 'No quotation'
      : [
          ctx.money && quotes.length ? `${quotationRef(quotes[quotes.length - 1].number, quotes[quotes.length - 1].issuedOn)} sent ${formatShortDate(quotes[quotes.length - 1].issuedOn, today)}` : null,
          asked ? `${answered} of ${asked} suppliers answered` : 'No supplier asked yet',
        ]
          .filter(Boolean)
          .join(' · '),
    job.orderId ? [order?.orderedOn ? `Ordered ${formatShortDate(order.orderedOn, today)}` : orderRef(order?.number ?? 0), ctx.money && order?.customerPo ? `customer's order ${order.customerPo}` : null].filter(Boolean).join(' · ') : "Waiting for the customer's order",
    legs.length ? `${legs.length} supplier ${legs.length === 1 ? 'order' : 'orders'}${delivered ? ` · ${delivered} delivered` : ''}` : job.orderId ? 'To source and place' : 'Starts after the order',
    detailFor(4) ?? (order?.needsCommissioning ? (order.doneOn ? `${visitTypeLabel(order.visitType) || 'Installation'} done` : order.plannedOn ? `${visitTypeLabel(order.visitType) || 'Installation'} planned ${formatShortDate(order.plannedOn, today)}` : 'Installation needs a date') : job.orderId ? 'Goods to the customer' : 'Starts after the goods arrive'),
    ctx.money ? (invoices.length ? `${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'}` : 'Invoice after delivery') : 'Handled by the office',
    ctx.money ? (m ? (m.balance <= 0 && m.settled > 0 ? 'Paid' : m.settled > 0 ? 'Part paid, the rest to collect' : 'Not paid yet') : 'Starts after the invoice') : 'Handled by the office',
  ]

  return STOPS.map((stop, index) => ({ stop, shown: model.stops[index].shown, index, state: state(index), summary: summaries[index], body: bodies[index] }))
}

function rfqLink(rfqId: string | null, label: string) {
  return rfqId ? (
    <p>
      <Link to={`/rfqs/${rfqId}`} className="inline-flex min-h-touch items-center rounded text-base font-medium text-primary underline-offset-4 hover:underline">
        {label}
      </Link>
    </p>
  ) : null
}
function orderLink(orderId: string | null, label: string) {
  return orderId ? (
    <p>
      <Link to={`/orders/${orderId}`} className="inline-flex min-h-touch items-center rounded text-base font-medium text-primary underline-offset-4 hover:underline">
        {label}
      </Link>
    </p>
  ) : null
}

const TAG: Record<StopState, string | null> = { done: 'Done', current: 'Now', future: null, none: null, stopped: null }

export function StageSections({ facts, data, model, ctx, open, onToggle }: { facts: JobFacts; data: JobData; model: StageModel; ctx: JobContext; open: number | null; onToggle: (index: number) => void }) {
  const [, setWon] = useWonDialog()
  const sections = buildSections(facts, data, model, ctx, () => setWon(true))
  return (
    <div className="grid gap-2" data-stages>
      {sections.map(s => {
        const none = s.state === 'none'
        const isOpen = open === s.index && !none
        const head = (
          <>
            <Icon icon={ChevronRight} className={cn('shrink-0 text-fg-muted transition-transform', isOpen && 'rotate-90')} />
            <span className={cn('w-[8.5rem] shrink-0 text-left text-base font-semibold', (s.state === 'future' || none || s.state === 'stopped') && 'font-medium text-fg-muted')}>{s.shown}</span>
            <span className="min-w-0 flex-1 text-left text-base text-fg-2 [overflow-wrap:anywhere]">{s.summary}</span>
            {TAG[s.state] ? (
              <span
                className={cn(
                  'inline-flex min-h-chip shrink-0 items-center gap-1 rounded-round px-[10px] text-sm font-medium',
                  s.state === 'done' ? 'bg-tone-success-bg text-tone-success-fg' : 'bg-tone-warning-bg text-tone-warning-fg',
                )}
              >
                {s.state === 'done' ? <Icon icon={Check} size="sm" /> : null}
                {TAG[s.state]}
              </span>
            ) : null}
          </>
        )
        return (
          <section key={s.stop} id={`stage-${s.index}`} data-stage={s.stop} className={cn('rounded-panel border bg-surface', (s.state === 'future' || none) && 'bg-sunken')}>
            <h2 className="text-base">
              {none ? (
                <div className="flex min-h-touch flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 max-sm:[&>span:nth-of-type(2)]:basis-[calc(100%-2rem)]">{head}</div>
              ) : (
                <button
                  type="button"
                  data-nav-strip=""
                  aria-expanded={isOpen}
                  aria-controls={`stage-body-${s.index}`}
                  onClick={() => onToggle(s.index)}
                  className="flex min-h-touch w-full flex-wrap items-center gap-x-2 gap-y-1 rounded-panel px-4 py-2 hover:bg-sunken max-sm:[&>span:nth-of-type(2)]:basis-[calc(100%-2rem)]"
                >
                  {head}
                </button>
              )}
            </h2>
            {isOpen ? (
              <div id={`stage-body-${s.index}`} role="region" aria-label={`${s.shown} stage`} className="grid gap-3 border-t px-4 py-3">
                {s.body}
                <JobSlot name={stageSlot(s.stop)} context={ctx} />
              </div>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}
