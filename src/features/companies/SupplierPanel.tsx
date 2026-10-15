import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Info } from 'lucide-react'
import { useCompanyBrands, useSupplierActivity, useSupplierBrandQuotes, useSupplierRecordView, useSupplierStats } from '@/features/companies/hooks'
import { Deliveries, RecentQuotes } from '@/features/companies/SupplierRecordPanels'
import { supplierFacts, type SupplierFacts } from '@/features/companies/supplierFacts'
import type { SupplierEnquiry } from '@/features/companies/api'
import { Fine, Panel, UnitChart, type Unit } from '@/features/companies/CompanyParts'
import { businessToday } from '@/lib/dates'
import { formatDay, formatShortDate } from '@/lib/formatDay'
import { rfqRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { StatusBadge } from '@/ui/StatusBadge'
import { Tag } from '@/ui/Tag'

/*
 * "What we know" (supplier side; g2-company.html boards 1 to 3). Facts derived from our own
 * enquiries, quotes and deliveries (v_supplier_stats, v_supplier_activity). Each rate carries its
 * counts, a measure appears only when there is enough behind it, imported history is marked wherever
 * it feeds a number, and nothing is scored or ranked (DATA_MODEL section 5c).
 */
export function SupplierPanel({ companyId }: { companyId: string }) {
  const stats = useSupplierStats(companyId)
  const activity = useSupplierActivity(companyId)
  const facts = useMemo(() => supplierFacts(stats.data ?? null), [stats.data])
  const record = useSupplierRecordView(companyId)

  if (stats.isPending) return <PanelSkeleton />
  if (stats.isError) {
    return (
      <Banner
        tone="danger"
        title="Couldn't load what we know about this supplier"
        action={
          <Button size="sm" onClick={() => void stats.refetch()}>
            Try again
          </Button>
        }
      >
        Nothing was changed. Check your connection and try again.
      </Banner>
    )
  }
  if (!facts) return null

  const tag = facts.provenance.importedOnly ? 'Imported history only' : facts.lowData ? 'Low data' : facts.provenance.hasImported ? 'Includes imported history' : null

  return (
    <>
      <Panel
        title="What we know"
        meta="From our own enquiries, quotes and deliveries, last 24 months"
        actions={tag ? <Tag dashed>{tag}</Tag> : null}
        footer={<Provenance facts={facts} />}
      >
        {facts.empty ? (
          <div className="grid gap-1 px-5 py-6 text-sm">
            <p className="font-medium text-fg">No enquiries yet.</p>
            <Fine>Float an RFQ to this supplier and the facts appear here as the answers come in. Nothing needs typing.</Fine>
          </div>
        ) : (
          <div className="grid md:grid-cols-2">
            <Section title="Brands" sub="Evidence we hold, not what the supplier claims." className="md:border-r">
              <BrandFacts companyId={companyId} />
            </Section>
            <Section title="Enquiries" sub={facts.enquirySummary} className="border-t md:border-t-0">
              <EnquiryUnits facts={facts} />
              <FactRows
                rows={[
                  { key: 'Usual reply time', value: <ReplyTime facts={facts} /> },
                  { key: 'Chosen', value: <Chosen facts={facts} /> },
                ]}
              />
            </Section>
            <Section title="Deliveries" sub={deliverySub(facts)} className="border-t md:border-r">
              <DeliveryUnits facts={facts} />
            </Section>
            <Section title="Last contacted" className="border-t">
              <FactRows rows={[{ key: facts.lastContact ? formatDay(facts.lastContact) : 'No contact', value: <LastContact facts={facts} what={record.view?.lastContactText ?? null} /> }]} />
            </Section>
          </div>
        )}
      </Panel>
      <RecentQuotes
        view={record.view}
        loading={record.query.isPending}
        error={record.query.isError}
        onRetry={() => void record.query.refetch()}
        enquiriesAnchor="enquiries"
      />
      <Deliveries view={record.view} loading={record.query.isPending} error={record.query.isError} onRetry={() => void record.query.refetch()} today={record.today} />
      <EnquiryList rows={activity.data} loading={activity.isPending} error={activity.isError} onRetry={() => void activity.refetch()} />
    </>
  )
}

function PanelSkeleton() {
  return (
    <Panel title="What we know">
      <div className="grid gap-3 p-5" aria-busy="true" aria-label="Loading what we know">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </Panel>
  )
}

function Section({ title, sub, children, className }: { title: string; sub?: string; children: ReactNode; className?: string }) {
  return (
    <section className={cn('grid min-w-0 content-start gap-3 px-5 pb-5 pt-4', className)}>
      <div className="grid gap-[2px]">
        <h3 className="text-sm font-semibold">{title}</h3>
        {sub ? <p className="text-xs text-fg-muted">{sub}</p> : null}
      </div>
      {children}
    </section>
  )
}

function FactRows({ rows }: { rows: { key: string; value: ReactNode }[] }) {
  return (
    <div className="grid">
      {rows.map(r => (
        <div key={r.key} className="grid gap-x-3 border-t py-[9px] text-sm first:border-t-0 sm:grid-cols-[148px_minmax(0,1fr)]">
          <span className="text-fg-muted">{r.key}</span>
          <span className="min-w-0 text-pretty">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

function EnquiryUnits({ facts }: { facts: SupplierFacts }) {
  if (facts.asked === 0) return <Fine>No enquiry is old enough to judge yet.</Fine>
  const units: Unit[] = [
    ...Array<Unit>(facts.quoted).fill('quoted'),
    ...Array<Unit>(facts.declined).fill('declined'),
    ...Array<Unit>(facts.waiting).fill('waiting'),
  ]
  return (
    <UnitChart
      units={units}
      label={`${facts.asked} enquiries: ${facts.quoted} quoted, ${facts.declined} could not offer, ${facts.waiting} no reply`}
      legend={[
        { unit: 'quoted', text: 'quoted', count: facts.quoted },
        { unit: 'declined', text: "couldn't offer", count: facts.declined },
        { unit: 'waiting', text: 'no reply', count: facts.waiting },
      ]}
    />
  )
}

function deliverySub(f: SupplierFacts) {
  return f.deliveries.kind === 'known' ? `Late ${f.deliveries.late} of ${f.deliveries.total}` : undefined
}

function DeliveryUnits({ facts }: { facts: SupplierFacts }) {
  const d = facts.deliveries
  if (d.kind === 'none') {
    return (
      <Fine>
        <span className="font-medium text-fg">No deliveries recorded yet.</span> The first purchase order to this supplier starts the count.
      </Fine>
    )
  }
  const onTime = d.total - d.late
  return (
    <div className="grid gap-2">
      <UnitChart
        units={[...Array<Unit>(onTime).fill('ontime'), ...Array<Unit>(d.late).fill('late')]}
        label={`${d.total} deliveries: ${onTime} on time, ${d.late} late`}
        legend={[
          { unit: 'ontime', text: 'on time', count: onTime },
          { unit: 'late', text: 'late', count: d.late },
        ]}
      />
      {d.medianDaysLate !== null ? <Fine>Late ones usually ran about {Math.round(d.medianDaysLate)} days over.</Fine> : null}
    </div>
  )
}

function ReplyTime({ facts }: { facts: SupplierFacts }) {
  const r = facts.replyTime
  if (r.kind === 'known') {
    return (
      <>
        About <span className="num font-medium">{r.days}</span> {r.days === 1 ? 'day' : 'days'}
        <Fine>
          Middle value of the <span className="num">{r.logged}</span> replies logged in this CRM.
          {r.importedLeftOut > 0 ? (
            <>
              {' '}
              <span className="num">{r.importedLeftOut}</span> imported {r.importedLeftOut === 1 ? 'reply has' : 'replies have'} no real date and {r.importedLeftOut === 1 ? 'is' : 'are'} left out.
            </>
          ) : null}
        </Fine>
      </>
    )
  }
  return (
    <>
      <span className="text-fg-muted">{r.importedOnly ? 'Not shown.' : 'Not enough replies yet.'}</span>
      <Fine>
        {r.importedOnly
          ? 'Imported replies carry the import date, not the day the supplier answered. A real figure starts once 3 replies are logged here.'
          : `Needs 3 logged replies. There ${r.logged === 1 ? 'is' : 'are'} ${r.logged}.`}
      </Fine>
    </>
  )
}

function Chosen({ facts }: { facts: SupplierFacts }) {
  const c = facts.chosen
  if (c.kind === 'none') {
    return (
      <>
        <span className="text-fg-muted">Nothing ordered yet.</span>
        <Fine>No quoted item has gone to an order.</Fine>
      </>
    )
  }
  return (
    <>
      <span className="num font-medium">{c.chosen}</span> of <span className="num font-medium">{c.of}</span> times
      <Fine>A quoted item was later ordered, and the order went on a leg with them.</Fine>
    </>
  )
}

function LastContact({ facts, what }: { facts: SupplierFacts; what: string | null }) {
  if (!facts.lastContact) return <span className="text-fg-muted">Nothing recorded yet.</span>
  return <span>{what ?? 'Contact on record.'}</span>
}

/** The brands and families they carry, each with how many times they quoted one of its items. A count, never a rating. */
function BrandFacts({ companyId }: { companyId: string }) {
  const carried = useCompanyBrands(companyId)
  const counts = useSupplierBrandQuotes(companyId)
  if (carried.isPending) return <Skeleton className="h-5 w-2/3" />
  if (carried.isError) return <Fine>The brands did not load. Reload the page to try again.</Fine>
  if (carried.data.length === 0) return <Fine>No brand listed yet. One is added by itself when they quote an item of it.</Fine>
  return (
    <ul className="grid">
      {carried.data.map(b => {
        const n = counts.data?.[b.brandId] ?? 0
        return (
          <li key={b.brandId} className="flex items-baseline justify-between gap-3 border-t py-[9px] text-sm first:border-t-0">
            <span className="min-w-0 break-words font-medium">
              {b.name}
              {b.kind === 'family' ? <span className="sr-only"> (product family)</span> : null}
            </span>
            <span className="shrink-0 text-fg-muted">
              {counts.isPending ? '' : n > 0 ? (
                <>
                  quoted <span className="num text-fg-2">{n}</span>×
                </>
              ) : (
                'listed, no quote yet'
              )}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Provenance({ facts }: { facts: SupplierFacts }) {
  const p = facts.provenance
  return (
    <div className="flex items-start gap-3">
      <Icon icon={Info} size="sm" className="mt-[1px]" />
      <p className="text-pretty">
        <b className="font-medium text-fg-2">Where this comes from.</b> Counts are derived from enquiries, quote lines, purchase orders and received dates. Nothing here is typed in.{' '}
        {p.hasImported ? (
          <>
            <b className="font-medium text-fg-2">Includes imported history:</b> <span className="num">{p.legacyAsked}</span> of <span className="num">{facts.asked}</span>{' '}
            enquiries came from the old CRM
            {p.pricesHidden > 0 ? (
              <>
                , <span className="num">{p.pricesHidden}</span> {p.pricesHidden === 1 ? 'price is' : 'prices are'} hidden because the currency was never verified
              </>
            ) : null}
            , and imported replies are left out of reply times.
          </>
        ) : (
          <>Everything here was logged in this CRM. With few enquiries the page shows facts only, and no pattern is implied.</>
        )}
      </p>
    </div>
  )
}

function EnquiryList({ rows, loading, error, onRetry }: { rows: SupplierEnquiry[] | undefined; loading: boolean; error: boolean; onRetry: () => void }) {
  const today = businessToday()
  const columns = useMemo<Column<SupplierEnquiry>[]>(
    () => [
      { id: 'sent', header: 'Sent', kind: 'date', value: r => r.sentOn, cell: r => <span className="num">{formatShortDate(r.sentOn, today)}</span>, sortable: true, width: 120 },
      {
        id: 'rfq',
        header: 'RFQ',
        value: r => r.rfqNumber,
        cell: r => (
          <Link to={`/rfqs/${r.rfqId}`} className="rounded hover:underline">
            <Tag>{r.rfqNumber ? rfqRef(r.rfqNumber) : 'RFQ'}</Tag>
          </Link>
        ),
        width: 130,
      },
      {
        id: 'outcome',
        header: 'Outcome',
        value: r => outcome(r, today).value,
        cell: r => {
          const o = outcome(r, today)
          return (
            <span className="inline-flex items-center gap-2">
              <StatusBadge dimension="inquiry" value={o.value} label={o.label} />
              {r.isLegacy ? <Tag dashed>Imported</Tag> : null}
            </span>
          )
        },
      },
      {
        id: 'reply',
        header: 'Reply time',
        kind: 'num',
        value: r => (r.isLegacy ? null : r.replyDays),
        cell: r => (r.isLegacy ? <span className="text-fg-muted">Not shown</span> : r.replyDays === null ? <span className="text-fg-muted">None yet</span> : <span className="num">{r.replyDays === 1 ? '1 day' : `${r.replyDays} days`}</span>),
        hideBelowMd: true,
        width: 130,
      },
    ],
    [today],
  )
  return (
    <div id="enquiries" className="scroll-mt-20">
    <Panel title="Recent enquiries" meta="Every enquiry sent to them in the last 24 months">
      <DataTable
        label="Recent enquiries"
        columns={columns}
        rows={rows ?? []}
        getRowId={r => r.inquiryId}
        loading={loading}
        error={error ? { title: "Couldn't load the enquiries", message: 'Nothing was changed.', onRetry } : null}
        empty={<p className="px-5 py-6 text-sm text-fg-muted">No enquiry has been sent to this supplier yet.</p>}
        density="compact"
      />
    </Panel>
    </div>
  )
}

function daysBetween(a: string, b: string) {
  const d = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
  return Math.round((d(b) - d(a)) / 86_400_000)
}

function outcome(r: SupplierEnquiry, today: string): { value: 'quoted' | 'no-offer' | 'awaiting'; label: string } {
  if (r.quoted) return { value: 'quoted', label: 'Quoted' }
  if (r.noOffer) return { value: 'no-offer', label: "Couldn't offer" }
  return { value: 'awaiting', label: r.sentOn && daysBetween(r.sentOn, today) >= 7 ? 'No reply' : 'Waiting for a reply' }
}
