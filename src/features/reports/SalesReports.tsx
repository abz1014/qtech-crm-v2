import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { formatShortDate } from '@/lib/formatDay'
import { DataTable, type Column } from '@/ui/DataTable'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { SumBar } from '@/ui/SumBar'
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
 * to its figures and table. The labels are the questions they answer, in plain words. No mockup exists, so this is composed from
 * the design system: SumBar and DataTable.
 */
export function SalesReports() {
  const outcomes = useOutcomes()
  const repeat = useRepeatCustomers()
  const o = outcomes.data ? summariseOutcomes(outcomes.data) : null
  const r = repeat.data ? summariseRepeat(repeat.data) : null
  return (
    <section aria-labelledby="rep-sales" className="grid gap-3">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id="rep-sales" className="text-lg font-semibold tracking-snug">
          Enquiries and customers
        </h3>
        <span className="text-sm text-fg-muted">All time, counts only</span>
      </header>
      {o && r ? (
        o.total === 0 && r.customers === 0 ? (
          <p className="rounded border bg-surface px-5 py-4 text-sm text-fg-2">Not enough data yet. These fill in as RFQs are won or closed and orders are placed.</p>
        ) : (
          <SumBar
            label="At a glance"
            items={[
              { label: 'Win rate', figure: showPct(o.winRate), sub: o.winRate === null ? 'No RFQ decided yet' : `Of the ${o.won + o.closed} RFQs decided` },
              { label: 'RFQs won', count: o.won, sub: `${o.open} still open` },
              { label: 'Customers who came back', count: r.repeat, sub: r.customers ? `Of ${r.customers} with an order` : 'No customer has an order yet' },
            ]}
          />
        )
      ) : outcomes.isLoading || repeat.isLoading ? (
        <Skeleton className="h-[88px] w-full" aria-label="Loading the headline figures" />
      ) : null}
      <div className="grid overflow-hidden rounded border bg-surface">
        <OutcomesReport />
        <FloatReport />
        <TurnaroundReport />
        <RepeatReport />
      </div>
    </section>
  )
}

/** One report, one line until it is opened: the question, its headline figure, and the figures and table inside. */
function Section({ id, title, headline, children }: { id: string; title: string; headline: ReactNode; children: ReactNode }) {
  return (
    <details id={id} className="group border-t first:border-t-0">
      <summary className="flex min-h-touch cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 hover:bg-sunken [&::-webkit-details-marker]:hidden">
        <Icon icon={ChevronRight} size="sm" className="text-fg-muted transition-transform duration-fast group-open:rotate-90" />
        <h4 className="text-base font-medium">{title}</h4>
        <span className="flex-1" />
        <span className="text-sm text-fg-2">{headline}</span>
      </summary>
      <div className="grid gap-3 border-t bg-canvas px-5 py-4">{children}</div>
    </details>
  )
}

const Loading = ({ label }: { label: string }) => <Skeleton className="h-[72px] w-full" aria-label={label} />

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
  { id: 'reason', header: 'Why we lost it', value: r => r.label },
  { id: 'count', header: 'RFQs', kind: 'num', value: r => r.count, sortable: true },
  { id: 'share', header: 'Share of the lost ones', kind: 'num', value: r => r.share, cell: r => showPct(r.share), sortable: true },
]

function OutcomesReport() {
  const q = useOutcomes()
  const s = q.data ? summariseOutcomes(q.data) : null
  return (
    <Section
      id="rep-outcomes"
      title="How many RFQs did we win, and why did we lose the others?"
      headline={headlineOf(q, s, x => x.total > 0, x => `${x.won} won, ${x.closed} lost, ${x.open} open`)}
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
        label="RFQs lost, by reason"
        noun="reasons"
        columns={reasonColumns}
        rows={s?.reasons ?? []}
        getRowId={r => r.key}
        loading={q.isLoading}
        error={q.isError ? { message: 'The outcomes could not be read. Nothing was changed.', onRetry: () => void q.refetch() } : null}
        empty={<span>No RFQ has been closed yet. Closed RFQs appear here with the reason you chose.</span>}
        defaultSort={{ id: 'count', dir: 'desc' }}
        densitySwitch={false}
      />
    </Section>
  )
}

// ------------------------------------------------------------------ 2. Asking suppliers
const floatColumns: Column<FloatLine>[] = [
  { id: 'state', header: 'Where it stands', value: r => r.label },
  { id: 'rfqs', header: 'RFQs', kind: 'num', value: r => r.rfqs },
  {
    id: 'items',
    header: 'Items priced',
    kind: 'num',
    value: r => r.itemsQuoted,
    cell: r => (r.state === 'not_floated' ? '' : `${r.itemsQuoted} of ${r.itemsTotal}`),
    hideBelowMd: true,
  },
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
      title="Does asking suppliers for prices help us win?"
      headline={headlineOf(q, s, x => x.lines.length > 0, x => askingHeadline(x.floatedWinRate, x.notFloatedWinRate))}
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
        label="Asking suppliers"
        noun="groups"
        columns={floatColumns}
        rows={s?.lines ?? []}
        getRowId={r => r.state}
        loading={q.isLoading}
        error={q.isError ? { message: 'This report could not be read. Nothing was changed.', onRetry: () => void q.refetch() } : null}
        empty={<span>No RFQ yet. Once RFQs exist they are grouped here by how far asking suppliers has got.</span>}
        densitySwitch={false}
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
      title="How fast do customers answer our questions?"
      headline={headlineOf(q, s, x => x.asked > 0, x => (x.avgDays === null ? `${x.asked} asked, none answered yet` : `${daysText(x.avgDays)} on average`))}
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
        label="How fast customers answer"
        noun="months"
        columns={turnaroundColumns}
        rows={s?.rows ?? []}
        getRowId={r => r.month}
        loading={q.isLoading}
        error={q.isError ? { message: 'This report could not be read. Nothing was changed.', onRetry: () => void q.refetch() } : null}
        empty={<span>No question has been asked of a customer yet. Months appear here once one is.</span>}
        densitySwitch={false}
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
      <Link to={`/companies/${r.companyId}`} className="font-medium text-fg hover:underline">
        {r.name}
      </Link>
    ),
    sortable: true,
  },
  { id: 'orders', header: 'Orders', kind: 'num', value: r => r.orders, sortable: true },
  { id: 'repeat', header: 'Came back', value: r => (r.isRepeat ? 'Yes' : 'No'), hideBelowMd: true },
  {
    id: 'first',
    header: 'First order',
    kind: 'date',
    value: r => r.firstOrderOn,
    cell: r => (r.firstOrderOn ? formatShortDate(r.firstOrderOn, undefined, true) : ''),
    hideBelowMd: true,
  },
  {
    id: 'last',
    header: 'Last order',
    kind: 'date',
    value: r => r.lastOrderOn,
    cell: r => (r.lastOrderOn ? formatShortDate(r.lastOrderOn, undefined, true) : ''),
  },
  { id: 'rfqs', header: 'RFQs', kind: 'num', value: r => r.rfqs, hideBelowMd: true },
]

function RepeatReport() {
  const q = useRepeatCustomers()
  const s = q.data ? summariseRepeat(q.data) : null
  return (
    <Section
      id="rep-repeat"
      title="Which customers come back?"
      headline={headlineOf(q, s, x => x.customers > 0, x => `${x.repeat} of ${x.customers} came back`)}
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
        label="Customers who came back"
        noun="customers"
        columns={repeatColumns}
        rows={s?.rows ?? []}
        getRowId={r => r.companyId}
        loading={q.isLoading}
        error={q.isError ? { message: 'The customers could not be read. Nothing was changed.', onRetry: () => void q.refetch() } : null}
        empty={<span>No customer has an order yet. They appear here as soon as one is placed.</span>}
        exportCsv={{ filename: 'repeat-customers' }}
        defaultSort={{ id: 'orders', dir: 'desc' }}
        densitySwitch={false}
      />
    </Section>
  )
}
