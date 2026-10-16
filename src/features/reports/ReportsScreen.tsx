import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PageFrame } from '@/app/pages/PageFrame'
import { formatShortDate } from '@/lib/formatDay'
import { DataTable, type Column } from '@/ui/DataTable'
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
 * Reports (P01). Four plain readings of what the team already records, stacked on one page so there is nothing to
 * choose or type: RFQ outcomes by close reason, float coverage and conversion, how fast customers answer questions,
 * and repeat customers. Each is a row of key figures over a table. No report shows money (admin and sales only reach
 * this page; the views return nothing to anyone else).
 *
 * No mockup exists for Reports, so this is composed from the design system: PageFrame, SumBar and DataTable
 * (listed as a deviation in the P01 hand-off).
 */
export default function ReportsScreen() {
  return (
    <PageFrame title="Reports" lede="How enquiries turn into orders. Counts only, read from what you already record." className="max-w-table">
      <OutcomesReport />
      <FloatReport />
      <TurnaroundReport />
      <RepeatReport />
    </PageFrame>
  )
}

function Section({ id, title, lede, children }: { id: string; title: string; lede: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-3 pt-4">
      <header className="grid gap-1">
        <h2 id={id} className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <p className="max-w-prose text-sm text-fg-muted">{lede}</p>
      </header>
      {children}
    </section>
  )
}

const Loading = ({ label }: { label: string }) => <Skeleton className="h-[72px] w-full" aria-label={label} />

// ------------------------------------------------------------------ 1. RFQ outcomes
const reasonColumns: Column<ReasonLine>[] = [
  { id: 'reason', header: 'Why it closed', value: r => r.label },
  { id: 'count', header: 'RFQs', kind: 'num', value: r => r.count, sortable: true },
  { id: 'share', header: 'Share of closed', kind: 'num', value: r => r.share, cell: r => showPct(r.share), sortable: true },
]

function OutcomesReport() {
  const q = useOutcomes()
  const s = q.data ? summariseOutcomes(q.data) : null
  return (
    <Section id="rep-outcomes" title="RFQ outcomes" lede="How many enquiries were won, closed or are still open, and why the closed ones were lost.">
      {s ? (
        <SumBar
          label="RFQ outcome totals"
          items={[
            { label: 'RFQs', count: s.total, sub: 'All time' },
            { label: 'Won', count: s.won, sub: s.winRate === null ? 'None answered yet' : `${s.winRate}% of those answered` },
            { label: 'Closed', count: s.closed, sub: 'Lost or given up' },
            { label: 'Open', count: s.open, sub: 'Not decided yet' },
          ]}
        />
      ) : q.isLoading ? (
        <Loading label="Loading RFQ outcomes" />
      ) : null}
      <DataTable
        label="RFQs closed by reason"
        noun="reasons"
        columns={reasonColumns}
        rows={s?.reasons ?? []}
        getRowId={r => r.key}
        loading={q.isLoading}
        error={q.isError ? { message: 'The outcomes could not be read. Nothing was changed.', onRetry: () => void q.refetch() } : null}
        empty={<span>No RFQ has been closed yet. Closed RFQs appear here with the reason you chose.</span>}
        defaultSort={{ id: 'count', dir: 'desc' }}
      />
    </Section>
  )
}

// ------------------------------------------------------------------ 2. Float coverage and conversion
const floatColumns: Column<FloatLine>[] = [
  { id: 'state', header: 'Where the float stands', value: r => r.label },
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
  { id: 'closed', header: 'Closed', kind: 'num', value: r => r.closed, hideBelowMd: true },
  { id: 'open', header: 'Open', kind: 'num', value: r => r.open, hideBelowMd: true },
  { id: 'rate', header: 'Won of answered', kind: 'num', value: r => r.winRate, cell: r => showPct(r.winRate) },
]

function FloatReport() {
  const q = useFloatReport()
  const s = q.data ? summariseFloat(q.data) : null
  return (
    <Section
      id="rep-float"
      title="Float coverage and conversion"
      lede="Of the RFQs you floated to suppliers, how many items got a price, and whether floating leads to wins."
    >
      {s ? (
        <SumBar
          label="Float totals"
          items={[
            { label: 'RFQs floated', count: s.floatedRfqs },
            { label: 'Items priced', figure: showPct(s.coverage), sub: `${s.floatedItemsQuoted} of ${s.floatedItems} items on floated RFQs` },
            { label: 'Won when floated', figure: showPct(s.floatedWinRate), sub: 'Of floated RFQs that have an answer' },
            { label: 'Won when not floated', figure: showPct(s.notFloatedWinRate), sub: 'Of the others that have an answer' },
          ]}
        />
      ) : q.isLoading ? (
        <Loading label="Loading float coverage" />
      ) : null}
      <DataTable
        label="Float coverage"
        noun="groups"
        columns={floatColumns}
        rows={s?.lines ?? []}
        getRowId={r => r.state}
        loading={q.isLoading}
        error={q.isError ? { message: 'The float report could not be read. Nothing was changed.', onRetry: () => void q.refetch() } : null}
        empty={<span>No RFQ yet. Once RFQs exist they are grouped here by how far their float has got.</span>}
      />
    </Section>
  )
}

// ------------------------------------------------------------------ 3. Clarification turnaround
const turnaroundColumns: Column<TurnaroundRow>[] = [
  { id: 'month', header: 'First asked in', kind: 'date', value: r => r.month, cell: r => monthLabel(r.month) },
  { id: 'asked', header: 'Asked', kind: 'num', value: r => r.asked },
  { id: 'answered', header: 'Answered', kind: 'num', value: r => r.answered },
  { id: 'withdrawn', header: 'Withdrawn', kind: 'num', value: r => r.withdrawn, hideBelowMd: true },
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
      title="Clarification turnaround"
      lede="How long customers take to answer a question once you have asked it, by the month it was first asked."
    >
      {s ? (
        <SumBar
          label="Clarification totals"
          items={[
            { label: 'Questions asked', count: s.asked },
            { label: 'Answered', count: s.answered },
            { label: 'Still waiting', count: s.open },
            { label: 'Average to answer', figure: daysText(s.avgDays), sub: 'First asked to answered' },
          ]}
        />
      ) : q.isLoading ? (
        <Loading label="Loading clarification turnaround" />
      ) : null}
      <DataTable
        label="Clarification turnaround"
        noun="months"
        columns={turnaroundColumns}
        rows={s?.rows ?? []}
        getRowId={r => r.month}
        loading={q.isLoading}
        error={q.isError ? { message: 'The turnaround could not be read. Nothing was changed.', onRetry: () => void q.refetch() } : null}
        empty={<span>No question has been asked of a customer yet. Months appear here once one is.</span>}
      />
    </Section>
  )
}

// ------------------------------------------------------------------ 4. Repeat customers
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
  { id: 'repeat', header: 'Repeat', value: r => (r.isRepeat ? 'Yes' : 'No'), hideBelowMd: true },
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
      title="Repeat customers"
      lede="Customers with at least one order, and who came back for a second. Cancelled orders are not counted."
    >
      {s ? (
        <SumBar
          label="Repeat customer totals"
          items={[
            { label: 'Customers with orders', count: s.customers },
            { label: 'Orders', count: s.orders, sub: 'Not cancelled' },
            { label: 'Came back', count: s.repeat, sub: 'Two or more orders' },
            { label: 'Repeat share', figure: showPct(s.share) },
          ]}
        />
      ) : q.isLoading ? (
        <Loading label="Loading repeat customers" />
      ) : null}
      <DataTable
        label="Repeat customers"
        noun="customers"
        columns={repeatColumns}
        rows={s?.rows ?? []}
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
