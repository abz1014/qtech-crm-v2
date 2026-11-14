import { Suspense, useEffect, useState, type ReactNode } from 'react'
import { visitTypeLabel } from '@/features/orders/lib/visit'
import { isContentDrawn, whenContentDrawn } from '@/lib/afterContent'
import { lazyWithReload } from '@/lib/importWithReload'
import { Button } from '@/ui/Button'
import { Skeleton } from '@/ui/Skeleton'
import { useWonDialog } from '@/features/orders/useWonDialog'
import { CircleCheck, CircleDashed, CircleDot, CircleX, Minus, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { orderRef } from '@/lib/refs'
import { FoldRow, type FoldRowChip, type FoldRowChipTone } from '@/ui/FoldRow'
import { STEP_CHIP as CHIP } from '@/features/jobs/lib/stepChip'
import type { StepTone } from '@/lib/status'
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
export const WITH_OFFICE = 'With the office'
const dash = <span className="text-fg-muted">—</span>
const day = (iso: string | null | undefined) => (iso ? <span className="num">{formatShortDate(iso, businessToday())}</span> : dash)

function Table({ head, rows, label }: { head: readonly string[]; rows: ReactNode[][]; label: string }) {
  const right = (h: string) => /^(Qty|Amount|Each)/.test(h)
  // A money column is as wide as its figure ("2,244,360"), never narrower: the figure is not cut or pushed out of its box at 320 px (clarity L4).
  const cols = { gridTemplateColumns: `minmax(0,1.6fr) ${head
    .slice(1)
    .map(h => (/^Amount/.test(h) ? 'auto' : 'minmax(0,1fr)'))
    .join(' ')}` }
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

function buildSections(facts: JobFacts, d: JobData, model: StageModel, ctx: JobContext, markWon: () => void, meta: ReactNode): Section[] {
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
    <Note>This job started as an order, without an RFQ.</Note>
  ) : (
    <div className="grid gap-2">
      {meta}
      <p className="text-base text-fg-2">
        {facts.contact ? `From ${facts.contact.name}. ` : ''}
        {facts.dueOn ? <>Answer due {day(facts.dueOn)}.</> : null}
      </p>
      {items.length ? (
        <Table head={['Item', 'Qty']} label="Items asked for" rows={items.map(i => [i.description, <span key="q" className="num">{`${i.qty}${i.unit ? ` ${i.unit}` : ''}`}</span>])} />
      ) : (
        <Note>No items yet.</Note>
      )}
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
    </div>
  )

  const orderBody = !job.orderId ? (
    <div className="grid gap-2">
      <Note>{direct ? 'The order is not available.' : "There is no order yet. It starts when the customer's order arrives and the RFQ is marked won."}</Note>
      {/* once quoted, Mark won is the next-step band's green button: not repeated here */}
      {!direct && ctx.money && job.stage !== 'lost' && job.stage !== 'quoted' ? (
        <p>
          <Button onClick={markWon}>Mark won</Button>
        </p>
      ) : null}
    </div>
  ) : (
    <div className="grid gap-2">
      {direct ? meta : null}
      <p className="text-base text-fg-2">
        {order?.orderedOn ? <>Ordered {day(order.orderedOn)}. </> : null}
        {ctx.money && order?.paymentTermsDays != null ? `Payment terms ${order.paymentTermsDays} days. ` : ''}
      </p>
      {/* the order lines, Edit GST and lines and Remove line are the slot below (orders/jobSlots/OrderWork) */}
    </div>
  )

  const legBody = !job.orderId ? (
    <Note>Starts once the order is placed.</Note>
  ) : legs.length ? (
    <div className="grid gap-2">
      {/* the supplier orders and their buttons are the slot below (orders/jobSlots/SupplierOrderWork) */}
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

  // One short line per row (clarity redesign): "30 Jun · 32 items", "1 of 10 answered", "Ordered 9 Jul". The customer's PO is not here:
  // it is in the key facts line under the stage block, once. A step not reached says "Not yet".
  const lastDelivered = legs
    .map(l => l.deliveredOn)
    .filter((x): x is string => Boolean(x))
    .sort()
    .at(-1)
  const installation = order?.needsCommissioning
    ? order.doneOn
      ? `${visitTypeLabel(order.visitType) || 'Installation'} done`
      : order.plannedOn
        ? `${visitTypeLabel(order.visitType) || 'Installation'} planned ${formatShortDate(order.plannedOn, today)}`
        : 'Installation needs a date'
    : null
  const deliveryState = !job.orderId
    ? 'Not yet'
    : legs.length === 0
      ? 'No goods'
      : delivered === legs.length && lastDelivered
        ? `Delivered ${formatShortDate(lastDelivered, today)}`
        : delivered > 0
          ? `${delivered} of ${legs.length} delivered`
          : 'Not delivered yet'
  const summaries: ReactNode[] = [
    direct
      ? 'No RFQ: this job started as an order'
      : [facts.receivedOn ? formatShortDate(facts.receivedOn, today) : null, items.length ? `${items.length} ${items.length === 1 ? 'item' : 'items'}` : null].filter(Boolean).join(' · ') || 'RFQ',
    direct ? 'No quotation' : asked ? `${answered} of ${asked} answered` : 'No supplier asked yet',
    job.orderId ? (order?.orderedOn ? `Ordered ${formatShortDate(order.orderedOn, today)}` : orderRef(order?.number ?? 0)) : 'Waiting for the customer',
    legs.length ? (delivered > 0 ? `${delivered} of ${legs.length} delivered` : `${legs.length} supplier ${legs.length === 1 ? 'order' : 'orders'}`) : job.orderId ? 'To source and place' : 'Not yet',
    detailFor(4) ?? (installation && !order?.doneOn ? installation : deliveryState),
    ctx.money ? (invoices.length ? `${invoices.length} ${invoices.length === 1 ? 'invoice' : 'invoices'}` : job.orderId ? 'Not invoiced yet' : 'Not yet') : WITH_OFFICE,
    ctx.money ? (m ? (m.balance <= 0 && m.settled > 0 ? 'Paid' : m.settled > 0 ? 'Part paid' : 'Not paid yet') : 'Not yet') : WITH_OFFICE,
  ]

  return STOPS.map((stop, index) => ({ stop, shown: model.stops[index].shown, index, state: state(index), summary: summaries[index], body: bodies[index] }))
}

/** From 768 px each step is its own white card; on a phone the rows share the one card above. */
const CARD = 'px-card md:rounded-card md:border-b-0 md:bg-surface md:shadow-e1'

export const NO_ENQUIRY_ROW = 'No RFQ or quotation: this job started as an order'

/** The drawn chip per row (Forest 30-job-page): Done, Not yet; the step the job is at says who acts next, as the hero's chip does. */
const CHIP_TONE: Record<StepTone, FoldRowChipTone> = { now: 'warning', waiting: 'info', late: 'danger', done: 'success', inert: 'neutral' }
function chipOf(state: StopState, current: StepTone): FoldRowChip {
  if (state === 'done') return { icon: CircleCheck, word: 'Done', tone: 'success' }
  if (state === 'current') return { ...CHIP[current], tone: CHIP_TONE[current] }
  if (state === 'future') return { icon: CircleDashed, word: 'Not yet', tone: 'neutral' }
  if (state === 'stopped') return { icon: CircleX, word: 'Not reached', tone: 'neutral' }
  return { icon: Minus, word: 'None', tone: 'neutral' }
}

const STATE: Record<StopState, { icon: LucideIcon; word: string; className: string }> = {
  done: { icon: CircleCheck, word: 'Done', className: 'text-tone-success-fg' },
  current: { icon: CircleDot, word: 'Now', className: 'text-fg' },
  future: { icon: CircleDashed, word: 'Not yet', className: 'text-fg-muted' },
  none: { icon: Minus, word: 'Not part of this job', className: 'text-fg-muted' },
  stopped: { icon: CircleX, word: 'Not reached', className: 'text-fg-muted' },
}

/**
 * The job's seven steps (Forest 30-job-page): each step is one FoldRow, closed, in its natural order, with its state as a chip (Done,
 * Waiting, Not yet). On a phone they are one card of hairline rows; from 768 px each step is its own card. The step the job is at has
 * the brand edge (a left bar on a phone, a ring on a computer); it is not moved and not opened. The ids (stage-N) stay with their rows,
 * so ?stage= links and the ruler still find them.
 */
export function StageSections({ facts, data, model, ctx, open, onToggle, meta, tone = 'now' }: { facts: JobFacts; data: JobData; model: StageModel; ctx: JobContext; open: number | null; onToggle: (index: number) => void; meta?: ReactNode; tone?: StepTone }) {
  const [, setWon] = useWonDialog()
  const built = buildSections(facts, data, model, ctx, () => setWon(true), meta)
  // A job that began as an order has no enquiry and no quotation: one grey row says so, instead of two rows that each say it.
  const merged = facts.job.kind === 'direct'
  const sections = merged ? built.slice(2) : built
  return (
    <div className="grid min-w-0 overflow-hidden rounded-card bg-surface shadow-e1 max-md:[&>:last-child]:border-b-0 md:gap-2 md:overflow-visible md:rounded-none md:bg-transparent md:shadow-none" data-stages>
      {merged ? (
        <div id="stage-0" data-stage="RFQ" data-fold-row="" className={cn('flex min-h-touch items-center gap-3 border-b py-3 text-fg-muted', CARD)}>
          <Icon icon={Minus} />
          <p className="type-body min-w-0">
            <span id="stage-1" data-stage="Quotation" />
            {NO_ENQUIRY_ROW}
          </p>
        </div>
      ) : null}
      {sections.map(s => {
        const none = s.state === 'none'
        const isOpen = open === s.index && !none
        // The money steps are the office's: an engineer's rows say so, whatever their mark, and so does the quotation while the job waits at it.
        const withOffice = !ctx.money && (s.stop === 'Invoice' || s.stop === 'Payment' || (s.state === 'current' && s.stop === 'Quotation'))
        const current = s.state === 'current'
        return (
          <FoldRow
            key={s.stop}
            id={`stage-${s.index}`}
            dataStage={s.stop}
            controlsId={`stage-body-${s.index}`}
            bodyLabel={`${s.shown} stage`}
            state={STATE[s.state]}
            title={s.shown}
            summary={withOffice ? WITH_OFFICE : s.state === 'future' ? 'Not yet' : s.summary}
            chip={chipOf(s.state, tone)}
            className={cn(CARD, current && 'relative before:absolute before:inset-y-0 before:left-0 before:w-1 before:bg-brand-500 md:before:hidden md:ring-2 md:ring-inset md:ring-brand-500')}
            muted={s.state === 'future' || none || s.state === 'stopped'}
            disabled={none}
            open={isOpen}
            onToggle={() => onToggle(s.index)}
          >
            <div className="grid gap-3">
              {s.body}
              <JobSlot name={stageSlot(s.stop)} context={ctx} />
            </div>
          </FoldRow>
        )
      })}
    </div>
  )
}
