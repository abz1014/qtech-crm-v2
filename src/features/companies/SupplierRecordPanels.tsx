import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Circle, CircleAlert, CircleCheck, CircleDashed, CircleDot, Lock, type LucideIcon } from 'lucide-react'
import { useFxLatest } from '@/features/rfqs/hooks'
import { formatRate } from '@/lib/money'
import type { DeliveryRow, QuoteOutcome, QuoteRow, SupplierRecord } from '@/features/companies/supplierRecord'
import { Panel } from '@/features/companies/CompanyParts'
import { formatShortDate } from '@/lib/formatDay'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'

/*
 * The supplier panels R02 left out (R18; g2-company.html): recent quotes with the PKR value at the time, deliveries from
 * purchase orders and delivery dates, and "Open with them". Every line is a fact with its count; there is no score, no
 * ranking and no percentage. What each row says is decided in supplierRecord.ts (pure, tested); this file lays it out.
 */

const CHIP = 'inline-flex h-5 w-fit items-center gap-[6px] whitespace-nowrap rounded-round px-2 text-xs'
const OUTCOME: Record<QuoteOutcome, { label: string; icon: LucideIcon; cls: string }> = {
  quoted: { label: 'Quoted', icon: CircleCheck, cls: 'bg-tone-success-bg text-tone-success-fg' },
  'ordered-here': { label: 'Ordered here', icon: CircleCheck, cls: 'bg-tone-success-bg text-tone-success-fg' },
  'ordered-elsewhere': { label: 'Ordered elsewhere', icon: Circle, cls: 'border border-line-strong text-fg-2' },
  'not-ordered': { label: 'Not ordered', icon: Circle, cls: 'border border-line-strong text-fg-2' },
  'quoted-open': { label: 'Quoted, RFQ open', icon: CircleDot, cls: 'bg-tone-info-bg text-tone-info-fg' },
  waiting: { label: 'Waiting for a reply', icon: CircleDot, cls: 'bg-tone-info-bg text-tone-info-fg' },
  'no-reply': { label: 'No reply', icon: CircleDashed, cls: 'border border-dashed border-line-strong text-fg-muted' },
  declined: { label: "Couldn't offer", icon: Circle, cls: 'border border-line-strong text-fg-2' },
}

/** One outcome chip with its icon, as drawn in the company mockup. Used by the quotes and the enquiries lists. */
export function OutcomeChip({ outcome, label }: { outcome: QuoteOutcome; label?: string }) {
  const o = OUTCOME[outcome]
  return (
    <span className={cn(CHIP, o.cls)}>
      <Icon icon={o.icon} size="chip" />
      {label ?? o.label}
    </span>
  )
}

/** The label above a field. On a phone only the numbers need one; date, RFQ, item and outcome read on their own. */
function Label({ children, phone = true }: { children: string; phone?: boolean }) {
  return <span className={cn('text-xs text-fg-muted md:sr-only', !phone && 'sr-only')}>{children}</span>
}

function LoadError({ title, onRetry }: { title: string; onRetry: () => void }) {
  return (
    <div className="p-4">
      <Banner
        tone="danger"
        title={title}
        action={
          <Button size="sm" onClick={onRetry}>
            Try again
          </Button>
        }
      >
        Nothing was changed. Check your connection and try again.
      </Banner>
    </div>
  )
}

function ListSkeleton({ label }: { label: string }) {
  return (
    <div className="grid gap-3 p-5" aria-busy="true" aria-label={label}>
      <Skeleton className="h-5 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-5 w-3/4" />
    </div>
  )
}

// ------------------------------------------------------------------------------------------------ recent quotes

const QHEAD = 'hidden border-b bg-sunken px-5 py-2 text-xs text-fg-muted md:grid md:grid-cols-[84px_92px_minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] md:gap-4'
const QROW = 'grid grid-cols-2 gap-x-4 gap-y-2 border-t px-5 py-3 first:border-t-0 md:grid-cols-[84px_92px_minmax(0,1.5fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]'

function PriceCell({ r }: { r: QuoteRow }) {
  const p = r.price
  if (p.state === 'hidden') {
    return (
      <span className="inline-flex items-start gap-2 text-sm text-fg-muted md:text-right">
        <Icon icon={Lock} size="sm" className="mt-[2px]" />
        Price on file, currency unverified
      </span>
    )
  }
  if (p.state === 'none') return <span className="text-sm text-fg-muted">—</span>
  const cur = (p.amount ?? '').split(' ')[0]
  return (
    <span className="num whitespace-nowrap text-sm">
      <span className="mr-1 font-sans text-xs text-fg-muted">{cur}</span>
      {p.figure}
    </span>
  )
}

function PkrCell({ r }: { r: QuoteRow }) {
  const p = r.price
  if (p.state === 'hidden') return <span className="text-sm text-fg-muted">No rate was captured</span>
  if (p.state === 'none') return <span className="text-sm text-fg-muted text-pretty">{r.pkrNote}</span>
  if (p.inPkr) return <span className="text-sm text-fg-muted">Already in PKR</span>
  if (p.pkr) {
    return (
      <span className="grid gap-[2px]">
        <span className="num text-sm">
          <span className="mr-1 font-sans text-xs text-fg-muted">≈</span>
          {p.pkr}
        </span>
        {p.rate ? <span className="num text-xs text-fg-muted">{`at ${p.rate}`}</span> : null}
      </span>
    )
  }
  return <span className="text-sm text-fg-muted">No rate was captured</span>
}

function ItemCell({ r }: { r: QuoteRow }) {
  return (
    <span className="grid min-w-0 gap-[2px]">
      <span className="line-clamp-2 break-words text-sm font-medium" title={r.item}>
        {r.item}
        {r.qty ? <span className="num ml-1 font-regular text-fg-muted">{r.qty.startsWith('+') ? r.qty : `×${r.qty}`}</span> : null}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
        {r.brand ? <span>{r.brand}</span> : null}
        {r.imported ? <Tag dashed>Imported</Tag> : null}
      </span>
      {r.itemNote ? <span className="text-xs text-fg-muted">{r.itemNote}</span> : null}
      {r.ago ? <span className="text-xs text-tone-warning-fg">{`${r.dateText}, ${r.ago}`}</span> : null}
    </span>
  )
}

function OutcomeCell({ r }: { r: QuoteRow }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <OutcomeChip outcome={r.outcome} />
      {r.orderRef ? <Tag>{r.orderRef}</Tag> : null}
    </span>
  )
}

export function RecentQuotes({
  view,
  loading,
  error,
  onRetry,
  enquiriesAnchor,
  meta,
}: {
  view: SupplierRecord | null
  loading: boolean
  error: boolean
  onRetry: () => void
  enquiriesAnchor: string
  /** Per state: populated, "Everything we have from them" (low data), "Imported rows are marked" (imported only). */
  meta: string
}) {
  return (
    <Panel
      title="Recent quotes"
      meta={meta}
      actions={
        <a href={`#${enquiriesAnchor}`} className="rounded text-sm font-medium text-primary hover:underline">
          All enquiries
        </a>
      }
      footer={
        view && view.quoteCount > view.quotes.length ? (
          <>
            Showing the latest <span className="num">{view.quotes.length}</span> of <span className="num">{view.quoteCount}</span>. Every enquiry is in the list below.
          </>
        ) : null
      }
    >
      {loading ? (
        <ListSkeleton label="Loading recent quotes" />
      ) : error ? (
        <LoadError title="Couldn't load the recent quotes" onRetry={onRetry} />
      ) : !view || view.quotes.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-muted">No quote yet. Prices appear here as soon as one is typed on an RFQ they were asked about.</p>
      ) : (
        <div>
          <div className={QHEAD} aria-hidden="true">
            <span>Date</span>
            <span>RFQ</span>
            <span>Item</span>
            <span className="text-right">Quoted price</span>
            <span>≈ PKR at the time</span>
            <span>Lead time, as written</span>
            <span>Outcome</span>
          </div>
          <ul>
            {view.quotes.map(r => (
              <li key={r.key} className={QROW}>
                <div className="grid content-start gap-1">
                  <Label phone={false}>Date</Label>
                  <span className="num text-sm">{r.dateText}</span>
                </div>
                <div className="grid content-start justify-items-start gap-1">
                  <Label phone={false}>RFQ</Label>
                  <Link to={`/rfqs/${r.rfqId}`} className="w-fit rounded hover:underline" aria-label={`Open ${r.rfqRef}`}>
                    <Tag>{r.rfqRef}</Tag>
                  </Link>
                </div>
                <div className="col-span-2 grid content-start gap-1 md:col-span-1">
                  <Label phone={false}>Item</Label>
                  <ItemCell r={r} />
                </div>
                <div className="grid content-start gap-1 md:justify-items-end">
                  <Label>Quoted price</Label>
                  <PriceCell r={r} />
                </div>
                <div className="grid content-start gap-1">
                  <Label>≈ PKR at the time</Label>
                  <PkrCell r={r} />
                </div>
                <div className="col-span-2 grid content-start gap-1 md:col-span-1">
                  <Label>Lead time, as written</Label>
                  <span className="text-sm text-pretty">{r.leadTime ?? <span className="text-fg-muted">—</span>}</span>
                </div>
                <div className="col-span-2 grid content-start gap-1 md:col-span-1">
                  <Label phone={false}>Outcome</Label>
                  <OutcomeCell r={r} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}

// ------------------------------------------------------------------------------------------------ deliveries

const DHEAD = 'hidden border-b bg-sunken px-5 py-2 text-xs text-fg-muted md:grid md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] md:gap-4'
const DROW = 'grid grid-cols-2 gap-x-4 gap-y-2 border-t px-5 py-3 first:border-t-0 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)]'

function ResultCell({ r }: { r: DeliveryRow }) {
  const x = r.result
  const cls = x.kind === 'late' || x.kind === 'overdue' ? 'bg-tone-danger-bg text-tone-danger-fg' : x.kind === 'ontime' ? 'bg-tone-success-bg text-tone-success-fg' : 'border border-line-strong text-fg-2'
  const aside = x.kind === 'ontime' && x.days > 0 ? `${x.days} ${x.days === 1 ? 'day' : 'days'} early` : null
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className={cn(CHIP, cls)}>
        <Icon icon={x.kind === 'late' || x.kind === 'overdue' ? CircleAlert : x.kind === 'ontime' ? CircleCheck : Circle} size="chip" />
        {x.text}
      </span>
      {aside ? <span className="text-xs text-fg-muted">{aside}</span> : null}
      {r.estimated ? <span className="text-xs text-fg-muted">dates estimated</span> : null}
    </span>
  )
}

export function Deliveries({ view, loading, error, onRetry, today }: { view: SupplierRecord | null; loading: boolean; error: boolean; onRetry: () => void; today: string }) {
  return (
    <Panel
      title="Deliveries"
      meta="Expected against delivered, from purchase orders and delivery dates"
      footer={
        view && view.deliveryCount > view.deliveries.length ? (
          <>
            Showing the latest <span className="num">{view.deliveries.length}</span> of <span className="num">{view.deliveryCount}</span>.
          </>
        ) : null
      }
    >
      {loading ? (
        <ListSkeleton label="Loading deliveries" />
      ) : error ? (
        <LoadError title="Couldn't load the deliveries" onRetry={onRetry} />
      ) : !view || view.deliveries.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-muted">No delivery recorded yet. A purchase order with an expected date starts the list; the received date completes it.</p>
      ) : (
        <div>
          <div className={DHEAD} aria-hidden="true">
            <span>Purchase order</span>
            <span>Order</span>
            <span>Expected</span>
            <span>Delivered</span>
            <span>Result</span>
          </div>
          <ul>
            {view.deliveries.map(r => (
              <li key={r.key} className={DROW}>
                <div className="grid content-start gap-1">
                  <Label>Purchase order</Label>
                  {r.po ? <Tag className="w-fit">{r.po}</Tag> : r.estimated ? <Tag dashed className="w-fit">Imported</Tag> : <span className="text-sm text-fg-muted">No PO issued</span>}
                </div>
                <div className="grid content-start gap-1">
                  <Label>Order</Label>
                  <span className="num text-sm">{r.orderRef}</span>
                </div>
                <div className="grid content-start gap-1">
                  <Label>Expected</Label>
                  <DateText iso={r.expectedOn} today={today} estimated={r.estimated} />
                </div>
                <div className="grid content-start gap-1">
                  <Label>Delivered</Label>
                  <DateText iso={r.receivedOn} today={today} estimated={r.estimated} />
                </div>
                <div className="col-span-2 grid content-start gap-1 md:col-span-1">
                  <Label phone={false}>Result</Label>
                  <ResultCell r={r} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  )
}

function DateText({ iso, today, estimated }: { iso: string | null; today: string; estimated: boolean }): ReactNode {
  if (!iso) return <span className="text-sm text-fg-muted">—</span>
  return (
    <span className="num text-sm">
      {formatShortDate(iso, today)}
      {estimated ? <span className="ml-1 text-fg-muted">est.</span> : null}
    </span>
  )
}

// ------------------------------------------------------------------------------------------------ open with them

export function OpenWithThem({ view, loading, error, onRetry }: { view: SupplierRecord | null; loading: boolean; error: boolean; onRetry: () => void }) {
  const row = 'flex items-baseline justify-between gap-4 border-t py-2 text-sm first:border-t-0'
  return (
    <Panel title="Open with them">
      <div className="px-5 py-3">
        {loading ? (
          <div className="grid gap-2" aria-busy="true" aria-label="Loading what is open with them">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : error ? (
          <Banner tone="danger" title="Couldn't load what is open" action={<Button size="sm" onClick={onRetry}>Try again</Button>}>
            Nothing was changed.
          </Banner>
        ) : view ? (
          <div className="grid">
            <div className={row}>
              <span className="text-fg-muted">Enquiry</span>
              {view.open.enquiries.length === 0 ? (
                <span className="text-fg-muted">None open</span>
              ) : (
                <ul className="grid justify-items-end gap-1 text-right">
                  {view.open.enquiries.map(e => (
                    <li key={e.inquiryId} className="flex flex-wrap items-baseline justify-end gap-x-2">
                      <Link to={`/rfqs/${e.rfqId}`} className="rounded hover:underline" aria-label={`Open ${e.rfqRef}`}>
                        <Tag>{e.rfqRef}</Tag>
                      </Link>
                      <span>
                        waiting, <span className="num">{e.waitingDays}</span> {e.waitingDays === 1 ? 'day' : 'days'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={row}>
              <span className="text-fg-muted">Order leg</span>
              {view.open.legs.length === 0 ? (
                <span className="text-fg-muted">None open</span>
              ) : (
                <ul className="grid justify-items-end gap-1 text-right">
                  {view.open.legs.map(l => (
                    <li key={l.legId} className="flex flex-wrap items-baseline justify-end gap-x-2">
                      <Tag>{l.orderRef}</Tag>
                      <span>{l.text}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className={row}>
              <span className="text-fg-muted">Currency</span>
              <CurrencyValue currency={view.open.currency} />
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  )
}

/** "EUR", or "CNY, rate 38.85, 8 days old" with the age in the warning colour once the rate is no longer fresh (the mockup's low-data board). */
function CurrencyValue({ currency }: { currency: string | null }) {
  const fx = useFxLatest()
  if (!currency) return <span className="text-fg-muted">Not known yet</span>
  const rate = currency === 'PKR' ? null : fx.data?.find(r => r.currency === currency)
  if (!rate) return <span className="num">{currency}</span>
  const age = rate.ageDays === 0 ? 'today' : `${rate.ageDays} ${rate.ageDays === 1 ? 'day' : 'days'} old`
  return (
    <span className="text-right">
      <span className="num">{currency}</span>, rate <span className="num">{formatRate(rate.ratePkr)}</span>,{' '}
      <span className={cn('num', rate.staleness !== 'fresh' && 'text-tone-warning-fg')}>{age}</span>
    </span>
  )
}
