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
import { InfoTip } from '@/ui/InfoTip'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'

/*
 * The supplier's record (R18; g2-company.html): recent quotes with the PKR value at the time, deliveries from purchase
 * orders and delivery dates, and "Open with them". Every line is a fact with its count; there is no score, no ranking and
 * no percentage. What each row says is decided in supplierRecord.ts (pure, tested); this file lays it out. The notes that
 * explained the columns are in an (i) tip on each panel (UX audit 2026-10-19).
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

/** The label above a field on a phone (the column header names it from md up). */
function Label({ children }: { children: string }) {
  return <span className="text-xs text-fg-muted md:sr-only">{children}</span>
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

/** "Latest 10 of 23" when the list is cut short; nothing when everything is shown. */
function latestOf(shown: number, total: number): ReactNode {
  return total > shown ? (
    <>
      Latest <span className="num">{shown}</span> of <span className="num">{total}</span>
    </>
  ) : undefined
}

// ------------------------------------------------------------------------------------------------ recent quotes

/*
 * Three columns, so the row reads at 1366 with the side column and at 1024 too: what (item, with the date, the RFQ, the
 * brand and the lead time under it), the price (original currency, then the PKR value at the time), and what came of it.
 */
const QGRID = 'md:grid-cols-[minmax(0,1fr)_minmax(0,176px)_minmax(0,176px)] md:gap-x-5'
const QHEAD = cn('hidden border-b bg-sunken px-5 py-2 text-sm text-fg-muted md:grid', QGRID)
const QROW = cn('grid grid-cols-2 gap-x-4 gap-y-3 border-t px-5 py-3 first:border-t-0', QGRID)

function PriceCell({ r }: { r: QuoteRow }) {
  const p = r.price
  if (p.state === 'hidden') {
    return (
      <span className="inline-flex items-start gap-2 text-sm text-fg-muted md:justify-end md:text-right">
        <Icon icon={Lock} size="sm" className="mt-[3px]" />
        Price on file, currency unverified
      </span>
    )
  }
  if (p.state === 'none') return <span className="text-sm text-fg-muted text-pretty">{r.pkrNote ?? '—'}</span>
  const cur = (p.amount ?? '').split(' ')[0]
  return (
    <span className="grid gap-[2px] md:justify-items-end">
      <span className="num whitespace-nowrap">
        <span className="mr-1 font-sans text-sm text-fg-muted">{cur}</span>
        {p.figure}
      </span>
      {p.pkr ? (
        <span className="num whitespace-nowrap text-sm text-fg-2">
          <span className="mr-1 font-sans text-fg-muted">≈ PKR</span>
          {p.pkr}
        </span>
      ) : null}
      {p.pkr && p.rate ? <span className="num text-xs text-fg-muted">{`at ${p.rate}`}</span> : null}
      {!p.pkr && !p.inPkr ? <span className="text-xs text-fg-muted">No rate captured</span> : null}
    </span>
  )
}

function ItemCell({ r }: { r: QuoteRow }) {
  return (
    <span className="grid min-w-0 gap-1">
      <span className="line-clamp-2 break-words font-medium" title={r.item}>
        {r.item}
        {r.qty ? <span className="num ml-1 font-regular text-fg-muted">{r.qty.startsWith('+') ? r.qty : `×${r.qty}`}</span> : null}
      </span>
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-fg-muted">
        <span className="num">{r.dateText}</span>
        <Link to={`/rfqs/${r.rfqId}`} className="w-fit rounded hover:underline" aria-label={`Open ${r.rfqRef}`}>
          <Tag>{r.rfqRef}</Tag>
        </Link>
        {r.brand ? <span>{r.brand}</span> : null}
        {r.imported ? <Tag dashed>Imported</Tag> : null}
      </span>
      {r.leadTime ? <span className="text-sm text-fg-2 text-pretty">Lead time: {r.leadTime}</span> : null}
      {r.itemNote ? <span className="text-sm text-fg-muted">{r.itemNote}</span> : null}
      {/* the date is on the line above; this line only says how old it is */}
      {r.ago ? <span className="text-sm text-tone-warning-fg">{r.ago}</span> : null}
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
}: {
  view: SupplierRecord | null
  loading: boolean
  error: boolean
  onRetry: () => void
  enquiriesAnchor: string
}) {
  return (
    <Panel
      title="Recent quotes"
      info={
        <InfoTip label="About the prices">
          <span className="grid gap-2">
            <span>Each price is in the currency they quoted. “≈ PKR” uses the rate saved when the quote was typed in, not today’s.</span>
            <span>A locked price is on file, but its currency was never checked, so it is not shown.</span>
          </span>
        </InfoTip>
      }
      meta={view ? latestOf(view.quotes.length, view.quoteCount) : undefined}
      actions={
        <a href={`#${enquiriesAnchor}`} className="rounded text-sm font-medium text-primary hover:underline">
          All enquiries
        </a>
      }
    >
      {loading ? (
        <ListSkeleton label="Loading recent quotes" />
      ) : error ? (
        <LoadError title="Couldn't load the recent quotes" onRetry={onRetry} />
      ) : !view || view.quotes.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-muted">No quotes from them yet.</p>
      ) : (
        <div>
          <div className={QHEAD} aria-hidden="true">
            <span>Item</span>
            <span className="text-right">Quoted price</span>
            <span>Outcome</span>
          </div>
          <ul>
            {view.quotes.map(r => (
              <li key={r.key} className={QROW}>
                <div className="col-span-2 grid content-start md:col-span-1">
                  <ItemCell r={r} />
                </div>
                <div className="grid content-start gap-1 md:justify-items-end md:text-right">
                  <Label>Quoted price</Label>
                  <PriceCell r={r} />
                </div>
                <div className="grid content-start gap-1">
                  <Label>Outcome</Label>
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

const DGRID = 'md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] md:gap-x-5'
const DHEAD = cn('hidden border-b bg-sunken px-5 py-2 text-sm text-fg-muted md:grid', DGRID)
const DROW = cn('grid grid-cols-2 gap-x-4 gap-y-3 border-t px-5 py-3 first:border-t-0', DGRID)

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
      {aside ? <span className="text-sm text-fg-muted">{aside}</span> : null}
    </span>
  )
}

export function Deliveries({ view, loading, error, onRetry, today }: { view: SupplierRecord | null; loading: boolean; error: boolean; onRetry: () => void; today: string }) {
  return (
    <Panel
      title="Deliveries"
      info={
        <InfoTip label="About the dates">
          Expected and delivered dates come from each supplier order. “est.” marks an imported date: an estimate, so lateness is a guide only.
        </InfoTip>
      }
      meta={view ? latestOf(view.deliveries.length, view.deliveryCount) : undefined}
    >
      {loading ? (
        <ListSkeleton label="Loading deliveries" />
      ) : error ? (
        <LoadError title="Couldn't load the deliveries" onRetry={onRetry} />
      ) : !view || view.deliveries.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-muted">No deliveries from them yet.</p>
      ) : (
        <div>
          <div className={DHEAD} aria-hidden="true">
            <span>Order</span>
            <span>Expected</span>
            <span>Delivered</span>
            <span>Result</span>
          </div>
          <ul>
            {view.deliveries.map(r => (
              <li key={r.key} className={DROW}>
                <div className="grid content-start justify-items-start gap-1">
                  <Label>Order</Label>
                  <span className="num">{r.orderRef}</span>
                  {r.po ? <Tag>{r.po}</Tag> : r.estimated ? <Tag dashed>Imported</Tag> : <span className="text-sm text-fg-muted">No PO</span>}
                </div>
                <div className="grid content-start gap-1">
                  <Label>Expected</Label>
                  <DateText iso={r.expectedOn} today={today} estimated={r.estimated} />
                </div>
                <div className="grid content-start gap-1">
                  <Label>Delivered</Label>
                  <DateText iso={r.receivedOn} today={today} estimated={r.estimated} />
                </div>
                <div className="grid content-start gap-1">
                  <Label>Result</Label>
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
  if (!iso) return <span className="text-fg-muted">—</span>
  return (
    <span className="num">
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
              <span className="text-fg-muted">Enquiries</span>
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
              <span className="shrink-0 text-fg-muted">Supplier orders</span>
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
