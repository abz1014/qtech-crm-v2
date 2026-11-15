import { NoPrimary } from '@/ui/NoPrimary'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatShortDate } from '@/lib/formatDay'
import { DataTable, type Column } from '@/ui/DataTable'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { SumBar } from '@/ui/SumBar'
import { CARD } from '@/ui/card'
import { useFloatReport, useOutcomes, useRepeatCustomers, useTurnaround } from '@/features/reports/hooks'
import {
  daysText,
  monthLabel,
  showPct,
  summariseFloat,
  summariseOutcomes,
  summariseRepeat,
  summariseTurnaround,
  type FloatLine,
  type ReasonLine,
  type RepeatRow,
  type TurnaroundRow,
} from '@/features/reports/model'

/*
 * The enquiry and customer reports (P01), now a part of Money > Reports (owner decision 2026-10-19). Admin and sales. Counts
 * only, never money, read from what the team already records; the database views count over all time, so the section says so.
 * Three numbers lead (win rate, RFQs won, customers who came back); each report below is one line with its headline, and opens
 * to its figures and table. The labels are the questions they answer, in plain words. Forest 59-reports #rp-enquiries: the
 * glance tiles a card, each report a fold card (question over headline, chevron right), its figures and a flat table inside.
 */
export function SalesReports() {
  const outcomes = useOutcomes()
  const repeat = useRepeatCustomers()
  const o = outcomes.data ? summariseOutcomes(outcomes.data) : null
  const r = repeat.data ? summariseRepeat(repeat.data) : null
  return (
    // The page title (Reports frame h1) already names it: only the scope line here, not the title twice.
    <section aria-label="RFQs and customers" className="grid gap-card-gap">
      <NoPrimary />
      <p className="type-body text-fg-2">All time, counts only</p>
      {o && r ? (
        o.total === 0 && r.customers === 0 ? (
          <p className={cn(CARD, 'type-body p-card text-fg-2')}>Not enough data yet. These fill in as RFQs are won or closed and orders are placed.</p>
        ) : (
          <SumBar
            label="At a glance"
            className="rounded-card shadow-e1"
            items={[
              { label: 'Win rate', figure: showPct(o.winRate), sub: o.winRate === null ? 'No RFQ decided yet' : `Of the ${o.won + o.closed} RFQs decided` },
              { label: 'RFQs won', count: o.won, sub: `${o.open} still open` },
            ]}
          />
        )
      ) : outcomes.isLoading || repeat.isLoading ? (
        <GlanceLoading />
      ) : null}
      {/* Forest 59-reports #enq-sections: each report is its own fold card, a card gap between them. */}
      <div className="grid gap-card-gap">
        <OutcomesReport />
        <FloatReport />
        <TurnaroundReport />
        <RepeatReport />
      </div>
    </section>
  )
}

/** The headline figures while they load: the two tiles' shape, not a grey bar. */
function GlanceLoading() {
  return (
    <div role="status" aria-label="Loading the headline figures" className={cn(CARD, 'grid grid-cols-2 gap-px overflow-hidden bg-line')}>
      {[0, 1].map(i => (
        <div key={i} className="grid gap-2 bg-surface px-5 py-4 max-sm:px-4">
          <Skeleton className="w-[6rem]" />
          <Skeleton className="h-6 w-16" />
          <Skeleton className="w-[8rem]" />
        </div>
      ))}
    </div>
  )
}

/** One report, one line until it is opened: the question, its headline figure, and the figures and table inside. */
function Section({ id, title, headline, children }: { id: string; title: string; headline: ReactNode; children: ReactNode }) {
  return (
    // Forest .qb-fold: a card; closed it reads the question over its headline, the chevron on the right; open, the figures sit
    // under a hairline. The summary is the whole top of the card, so the tap target is the card's full width.
    <details id={id} className={cn(CARD, 'group overflow-hidden')}>
      <summary className="grid min-h-touch cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 px-card py-4 transition-colors duration-fast hover:bg-sunken motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
        <span className="grid min-w-0 gap-1">
          <h2 className="type-section [overflow-wrap:anywhere]">{title}</h2>
          <span className="type-body text-fg-2">{headline}</span>
        </span>
        <Icon icon={ChevronDown} className="text-fg-muted transition-transform duration-fast group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="grid min-w-0 gap-4 border-t px-card pb-card pt-5">{children}</div>
    </details>
  )
}

/** A report's figures while they load: four tiles' shape. */
/** A phone row (59-reports .rp-cardrow): the name and its main count on one line, the other figures in words under it. */
function CardRow({ name, figure, children }: { name: ReactNode; figure: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 py-1">
      <span className="min-w-0 font-medium [overflow-wrap:break-word]">{name}</span>
      <span className="num text-right">{figure}</span>
      <span className="col-span-2 text-sm text-fg-2">{children}</span>
    </div>
  )
}
const reasonCard = (r: ReasonLine) => (
  <CardRow name={r.label} figure={String(r.count)}>
    Share of the lost ones <span className="num">{showPct(r.share)}</span>
  </CardRow>
)
const floatCard = (r: FloatLine) => (
  <CardRow name={r.label} figure={`${r.rfqs} ${r.rfqs === 1 ? 'RFQ' : 'RFQs'}`}>
    {r.state === 'not_floated' ? null : <>Items priced <span className="num">{`${r.itemsQuoted} of ${r.itemsTotal}`}</span> · </>}
    won <span className="num">{r.won}</span> · lost <span className="num">{r.closed}</span> · open <span className="num">{r.open}</span>
    <span className="block">
      Won of decided <span className="num">{showPct(r.winRate)}</span>
    </span>
  </CardRow>
)
const turnaroundCard = (r: TurnaroundRow) => (
  <CardRow name={monthLabel(r.month)} figure={`${r.asked} asked`}>
    answered <span className="num">{r.answered}</span> · still open <span className="num">{r.open}</span>
    <span className="block">
      Average to answer <span className="num">{daysText(r.avgDays)}</span>
    </span>
  </CardRow>
)
const repeatCard = (r: RepeatRow) => (
  <CardRow
    name={
      <Link to={`/companies/${r.companyId}`} className="text-primary underline-offset-4 hover:underline">
        {r.name}
      </Link>
    }
    figure={`${r.orders} ${r.orders === 1 ? 'order' : 'orders'}`}
  >
    Came back {r.isRepeat ? 'Yes' : 'No'}
    {r.lastOrderOn ? ` · last order ${formatShortDate(r.lastOrderOn, undefined, true)}` : ''}
  </CardRow>
)

const Loading = ({ label }: { label: string }) => (
  <div role="status" aria-label={label} className="grid grid-cols-2 gap-px overflow-hidden rounded-panel border bg-line md:grid-cols-4">
    {[0, 1, 2, 3].map(i => (
      <div key={i} className="grid gap-2 bg-surface px-5 py-4 max-sm:px-4">
        <Skeleton className="w-[5rem]" />
        <Skeleton className="h-5 w-12" />
      </div>
    ))}
  </div>
)

/** A closed line's headline: the figure, "Not enough data yet", "Could not load" after a failed read, or "…" while it loads. */
function headlineOf<T>(q: { isError: boolean }, s: T | null, ready: (s: T) => boolean, say: (s: T) => string): string {
  if (q.isError) return 'Could not load'
  if (!s) return '…'
  return ready(s) ? say(s) : 'Not enough data yet'
}

/** "Won 50% when asked, 0% when not"; a side with nothing decided yet says so on its own. */
function askingHeadline(asked: number | null, notAsked: number | null): string {
  if (asked === null && notAsked === null) return 'Nothing decided yet'
  const part = (v: number | null, when: string) => (v === null ? `nothing decided ${when}` : `won ${v}% ${when}`)
  const text = `${part(asked, 'when asked')}, ${part(notAsked, 'when not')}`
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// ------------------------------------------------------------------ 1. Won and lost
const reasonColumns: Column<ReasonLine>[] = [
  { id: 'reason', header: 'Why RFQs were lost', value: r => r.label },
  { id: 'count', header: 'RFQs', kind: 'num', value: r => r.count, sortable: true },
  { id: 'share', header: 'Share of the lost ones', kind: 'num', value: r => r.share, cell: r => showPct(r.share), sortable: true },
]

function OutcomesReport() {
  const q = useOutcomes()
  const s = q.data ? summariseOutcomes(q.data) : null
  return (
    <Section
      id="rep-outcomes"
      title="RFQs won and lost, with the reasons"
      headline={headlineOf(
        q,
        s,
        x => x.total > 0,
        x => `${x.won} won, ${x.closed} lost, ${x.open} open`,
      )}
    >
      {s && s.total > 0 ? (
        <SumBar
          label="RFQ outcome totals"
          items={[
            { label: 'RFQs', count: s.total, sub: 'All time' },
            { label: 'Won', count: s.won, sub: s.winRate === null ? 'None decided yet' : `${s.winRate}% of those decided` },
            { label: 'Lost', count: s.closed, sub: 'Lost or given up' },
            { label: 'Still open', count: s.open, sub: 'Not decided yet' },
          ]}
        />
      ) : q.isLoading ? (
        <Loading label="Loading RFQ outcomes" />
      ) : null}
      <DataTable
        flat
        label="RFQs lost, by reason"
        noun="reasons"
        columns={reasonColumns}
        rows={s?.reasons ?? []}
        mobileRow={reasonCard}
        getRowId={r => r.key}
        loading={q.isLoading}
        error={q.isError ? { message: 'The outcomes could not be read. Nothing was changed.', onRetry: () => void q.refetch() } : null}
        empty={<span>No RFQ has been closed yet. Closed RFQs appear here with the reason selected.</span>}
        defaultSort={{ id: 'count', dir: 'desc' }}
      />
    </Section>
  )
}

// ------------------------------------------------------------------ 2. Asking suppliers
const floatColumns: Column<FloatLine>[] = [
  { id: 'state', header: 'Where it stands', value: r => r.label },
  { id: 'rfqs', header: 'RFQs', kind: 'num', value: r => r.rfqs },
  { id: 'items', header: 'Items priced', kind: 'num', value: r => r.itemsQuoted, cell: r => (r.state === 'not_floated' ? '' : `${r.itemsQuoted} of ${r.itemsTotal}`), hideBelowMd: true },
  { id: 'won', header: 'Won', kind: 'num', value: r => r.won },
  { id: 'closed', header: 'Lost', kind: 'num', value: r => r.closed, hideBelowMd: true },
  { id: 'open', header: 'Open', kind: 'num', value: r => r.open, hideBelowMd: true },
  { id: 'rate', header: 'Won of decided', kind: 'num', value: r => r.winRate, cell: r => showPct(r.winRate) },
]

function FloatReport() {
  const q = useFloatReport()
  const s = q.data ? summariseFloat(q.data) : null
  return (
    <Section
      id="rep-float"
      title="Effect of asking suppliers for prices on wins"
      headline={headlineOf(
        q,
        s,
        x => x.lines.length > 0,
        x => askingHeadline(x.floatedWinRate, x.notFloatedWinRate),
      )}
    >
      {s && s.lines.length > 0 ? (
        <SumBar
          label="Asking suppliers totals"
          items={[
            { label: 'RFQs sent to suppliers', count: s.floatedRfqs },
            { label: 'Items that got a price', figure: showPct(s.coverage), sub: `${s.floatedItemsQuoted} of ${s.floatedItems} items on RFQs sent to suppliers` },
            { label: 'Won when sent to suppliers', figure: showPct(s.floatedWinRate), sub: 'Of those decided' },
            { label: 'Won when not sent', figure: showPct(s.notFloatedWinRate), sub: 'Of the others decided' },
          ]}
        />
      ) : q.isLoading ? (
        <Loading label="Loading asking suppliers" />
      ) : null}
      <DataTable
        flat
        label="Asking suppliers"
        noun="groups"
        columns={floatColumns}
        rows={s?.lines ?? []}
        mobileRow={floatCard}
        getRowId={r => r.state}
        loading={q.isLoading}
        error={q.isError ? { message: 'This report could not be read. Nothing was changed.', onRetry: () => void q.refetch() } : null}
        empty={<span>No RFQ yet. Once RFQs exist they are grouped here by how far asking suppliers has got.</span>}
      />
    </Section>
  )
}

// ------------------------------------------------------------------ 3. How fast customers answer
const turnaroundColumns: Column<TurnaroundRow>[] = [
  { id: 'month', header: 'First asked in', kind: 'date', value: r => r.month, cell: r => monthLabel(r.month) },
  { id: 'asked', header: 'Asked', kind: 'num', value: r => r.asked },
  { id: 'answered', header: 'Answered', kind: 'num', value: r => r.answered },
  { id: 'withdrawn', header: 'Not needed', kind: 'num', value: r => r.withdrawn, hideBelowMd: true },
  { id: 'open', header: 'Still open', kind: 'num', value: r => r.open },
  { id: 'avg', header: 'Average to answer', kind: 'num', value: r => r.avgDays, cell: r => daysText(r.avgDays) },
  { id: 'slow', header: 'Slowest', kind: 'num', value: r => r.slowestDays, cell: r => daysText(r.slowestDays), hideBelowMd: true },
]

function TurnaroundReport() {
  const q = useTurnaround()
  const s = q.data ? summariseTurnaround(q.data) : null
  return (
    <Section
      id="rep-turnaround"
      title="How fast customers answer questions"
      headline={headlineOf(
        q,
        s,
        x => x.asked > 0,
        x => (x.avgDays === null ? `${x.asked} asked, none answered yet` : `${daysText(x.avgDays)} on average`),
      )}
    >
      {s && s.asked > 0 ? (
        <SumBar
          label="Customer answer totals"
          items={[
            { label: 'Questions asked', count: s.asked },
            { label: 'Answered', count: s.answered },
            { label: 'Still waiting', count: s.open },
            { label: 'Average to answer', figure: daysText(s.avgDays), sub: 'First asked to answered' },
          ]}
        />
      ) : q.isLoading ? (
        <Loading label="Loading how fast customers answer" />
      ) : null}
      <DataTable
        flat
        label="How fast customers answer"
        noun="months"
        columns={turnaroundColumns}
        rows={s?.rows ?? []}
        mobileRow={turnaroundCard}
        getRowId={r => r.month}
        loading={q.isLoading}
        error={q.isError ? { message: 'This report could not be read. Nothing was changed.', onRetry: () => void q.refetch() } : null}
        empty={<span>No question has been asked of a customer yet. Months appear here once one is.</span>}
      />
    </Section>
  )
}

// ------------------------------------------------------------------ 4. Customers who came back
const repeatColumns: Column<RepeatRow>[] = [
  {
    id: 'name',
    header: 'Customer',
    value: r => r.name,
    cell: r => (
      <Link to={`/companies/${r.companyId}`} className="font-medium text-primary underline-offset-4 hover:underline">
        {r.name}
      </Link>
    ),
    sortable: true,
  },
  { id: 'orders', header: 'Orders', kind: 'num', value: r => r.orders, sortable: true },
  { id: 'repeat', header: 'Came back', value: r => (r.isRepeat ? 'Yes' : 'No'), hideBelowMd: true },
  { id: 'first', header: 'First order', kind: 'date', value: r => r.firstOrderOn, cell: r => (r.firstOrderOn ? formatShortDate(r.firstOrderOn, undefined, true) : ''), hideBelowMd: true },
  { id: 'last', header: 'Last order', kind: 'date', value: r => r.lastOrderOn, cell: r => (r.lastOrderOn ? formatShortDate(r.lastOrderOn, undefined, true) : '') },
  { id: 'rfqs', header: 'RFQs', kind: 'num', value: r => r.rfqs, hideBelowMd: true },
]

function RepeatReport() {
  const q = useRepeatCustomers()
  const s = q.data ? summariseRepeat(q.data) : null
  return (
    <Section
      id="rep-repeat"
      title="Returning customers"
      headline={headlineOf(
        q,
        s,
        x => x.customers > 0,
        x => `${x.repeat} of ${x.customers} came back`,
      )}
    >
      {s && s.customers > 0 ? (
        <SumBar
          label="Repeat customer totals"
          items={[
            { label: 'Customers with orders', count: s.customers },
            { label: 'Orders', count: s.orders, sub: 'Not cancelled' },
            { label: 'Came back', count: s.repeat, sub: 'Two or more orders' },
            { label: 'Share who came back', figure: showPct(s.share) },
          ]}
        />
      ) : q.isLoading ? (
        <Loading label="Loading repeat customers" />
      ) : null}
      <DataTable
        flat
        label="Customers who came back"
        noun="customers"
        columns={repeatColumns}
        rows={s?.rows ?? []}
        mobileRow={repeatCard}
        getRowId={r => r.companyId}
        loading={q.isLoading}
        error={q.isError ? { message: 'The customers could not be read. Nothing was changed.', onRetry: () => void q.refetch() } : null}
        empty={<span>No customer has an order yet. They appear here as soon as one is placed.</span>}
        exportCsv={{ filename: 'repeat-customers' }}
        defaultSort={{ id: 'orders', dir: 'desc' }}
      />
    </Section>
  )
}
