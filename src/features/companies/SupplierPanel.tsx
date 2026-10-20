import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useSupplierActivity, useSupplierRecordView, useSupplierStats } from '@/features/companies/hooks'
import { Deliveries, OutcomeChip, RecentQuotes } from '@/features/companies/SupplierRecordPanels'
import { deliveryLine, factNotes, supplierFacts, type SupplierFacts } from '@/features/companies/supplierFacts'
import type { SupplierEnquiry } from '@/features/companies/api'
import { CountText, Fine, Panel } from '@/features/companies/CompanyParts'
import type { LastContactPart, SupplierRecord } from '@/features/companies/supplierRecord'
import { businessToday } from '@/lib/dates'
import { formatShortDate } from '@/lib/formatDay'
import { rfqRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { InfoTip } from '@/ui/InfoTip'
import { Skeleton } from '@/ui/Skeleton'
import { Tag } from '@/ui/Tag'

/*
 * The supplier's history, most useful first (UX audit 2026-10-19, 9b): what they quoted, how their deliveries went, then
 * "What we know" as a few plain counts, then every enquiry. Facts come from our own enquiries, quotes and deliveries
 * (v_supplier_stats, v_supplier_activity); each rate carries its counts, imported rows stay marked, nothing is scored or
 * ranked (DATA_MODEL section 5c). The rules behind the numbers sit behind one (i) tip instead of on the page.
 */
export function SupplierPanel({ companyId }: { companyId: string }) {
  const record = useSupplierRecordView(companyId)
  const activity = useSupplierActivity(companyId)
  const retryRecord = () => void record.query.refetch()

  return (
    <>
      <RecentQuotes view={record.view} loading={record.query.isPending} error={record.query.isError} onRetry={retryRecord} enquiriesAnchor="enquiries" />
      <Deliveries view={record.view} loading={record.query.isPending} error={record.query.isError} onRetry={retryRecord} today={record.today} />
      <WhatWeKnow companyId={companyId} view={record.view} today={record.today} />
      <EnquiryList rows={activity.data} loading={activity.isPending} error={activity.isError} onRetry={() => void activity.refetch()} />
    </>
  )
}

/** "What we know": the counts, one short row each. The squares and the rule-explaining sub-lines are gone; the tip holds the rules. */
function WhatWeKnow({ companyId, view, today }: { companyId: string; view: SupplierRecord | null; today: string }) {
  const stats = useSupplierStats(companyId)
  const facts = useMemo(() => supplierFacts(stats.data ?? null), [stats.data])

  if (stats.isPending) {
    return (
      <Panel title="What we know">
        <div className="grid gap-3 p-5" aria-busy="true" aria-label="Loading what we know">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Panel>
    )
  }
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

  return (
    <Panel
      title="What we know"
      info={
        <InfoTip label="About these numbers">
          <span className="grid gap-2">
            {factNotes(facts, view?.span ?? null).map(n => (
              <span key={n}>{n}</span>
            ))}
          </span>
        </InfoTip>
      }
      meta={facts.lowData ? undefined : 'Last 24 months'}
      actions={facts.provenance.importedOnly ? <Tag dashed>Imported only</Tag> : null}
    >
      {facts.empty ? (
        <div className="grid gap-1 px-5 py-5 text-sm">
          <p className="font-medium text-fg">No enquiries yet.</p>
          <Fine>The counts start with the first RFQ they are asked about.</Fine>
        </div>
      ) : (
        <dl className="grid sm:grid-cols-2">
          <Fact label="Enquiries">
            <CountText text={facts.enquirySummary} />
          </Fact>
          <Fact label="Deliveries">
            <CountText text={deliveryLine(facts)} />
          </Fact>
          <Fact label="Usual reply time">
            <ReplyTime facts={facts} />
          </Fact>
          <Fact label="Chosen">
            {facts.chosen.kind === 'known' ? (
              <>
                <span className="num font-medium">{facts.chosen.chosen}</span> of <span className="num font-medium">{facts.chosen.of}</span> times
              </>
            ) : (
              <span className="text-fg-muted">Nothing ordered yet</span>
            )}
          </Fact>
          <Fact label="Last contacted" wide>
            <LastContact facts={facts} what={view?.lastContact ?? null} today={today} />
          </Fact>
        </dl>
      )}
    </Panel>
  )
}

/** One fact: the label over the value. Two to a row from the small breakpoint; `wide` takes the whole row. */
function Fact({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={cn('grid content-start gap-1 border-t px-5 py-3 first:border-t-0', wide ? 'sm:col-span-2' : 'sm:odd:border-r sm:[&:nth-child(2)]:border-t-0')}>
      <dt className="text-sm text-fg-muted">{label}</dt>
      <dd className="m-0 min-w-0 text-base text-pretty">{children}</dd>
    </div>
  )
}

function ReplyTime({ facts }: { facts: SupplierFacts }) {
  const r = facts.replyTime
  if (r.kind === 'known') {
    return (
      <>
        About <span className="num font-medium">{r.days}</span> {r.days === 1 ? 'day' : 'days'}
      </>
    )
  }
  return <span className="text-fg-muted">{r.importedOnly ? 'Not shown for imported replies' : 'Not enough replies yet'}</span>
}

/** "24 Oct · Enquiry sent for RFQ-0171. No reply yet." with the RFQ as a link. */
function LastContact({ facts, what, today }: { facts: SupplierFacts; what: LastContactPart[] | null; today: string }) {
  if (!facts.lastContact) return <span className="text-fg-muted">Nothing recorded yet</span>
  return (
    <span>
      <span className="num">{formatShortDate(facts.lastContact, today)}</span>
      {' · '}
      {what ? (
        what.map((p, i) =>
          typeof p === 'string' ? (
            <span key={i}>{p}</span>
          ) : (
            <Link key={i} to={`/rfqs/${p.rfqId}`} className="num rounded text-primary hover:underline" aria-label={`Open ${p.ref}`}>
              {p.ref}
            </Link>
          ),
        )
      ) : (
        <span>{facts.provenance.importedOnly ? 'Imported.' : 'Contact on record.'}</span>
      )}
    </span>
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
        cell: r => <RfqLink r={r} />,
        width: 130,
      },
      {
        id: 'outcome',
        header: 'Outcome',
        value: r => outcome(r, today).value,
        cell: r => <OutcomeCell r={r} today={today} />,
      },
      {
        id: 'reply',
        header: 'Reply time',
        kind: 'num',
        value: r => (r.isLegacy ? null : r.replyDays),
        cell: r => <ReplyDays r={r} />,
        hideBelowMd: true,
        width: 130,
      },
    ],
    [today],
  )
  return (
    <div id="enquiries" className="scroll-mt-20">
      <Panel title="Recent enquiries" meta="Last 24 months">
        <DataTable
          label="Recent enquiries"
          columns={columns}
          rows={rows ?? []}
          getRowId={r => r.inquiryId}
          loading={loading}
          error={error ? { title: "Couldn't load the enquiries", message: 'Nothing was changed.', onRetry } : null}
          empty={<p className="px-5 py-6 text-sm text-fg-muted">No enquiry sent to them yet.</p>}
          mobileRow={r => (
            <div className="grid gap-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <RfqLink r={r} />
                <span className="num text-sm text-fg-muted">{formatShortDate(r.sentOn, today)}</span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <OutcomeCell r={r} today={today} />
                <span className="text-sm">
                  <ReplyDays r={r} />
                </span>
              </div>
            </div>
          )}
        />
      </Panel>
    </div>
  )
}

function RfqLink({ r }: { r: SupplierEnquiry }) {
  return (
    <Link to={`/rfqs/${r.rfqId}`} className="rounded hover:underline">
      <Tag>{r.rfqNumber ? rfqRef(r.rfqNumber) : 'RFQ'}</Tag>
    </Link>
  )
}

function OutcomeCell({ r, today }: { r: SupplierEnquiry; today: string }) {
  const o = outcome(r, today)
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <OutcomeChip outcome={o.value} label={o.label} />
      {r.isLegacy ? <Tag dashed>Imported</Tag> : null}
    </span>
  )
}

function ReplyDays({ r }: { r: SupplierEnquiry }) {
  if (r.isLegacy) return <span className="text-fg-muted">Not shown</span>
  if (r.replyDays === null) return <span className="text-fg-muted">No reply yet</span>
  return <span className="num">{r.replyDays === 1 ? '1 day' : `${r.replyDays} days`}</span>
}

function daysBetween(a: string, b: string) {
  const d = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
  return Math.round((d(b) - d(a)) / 86_400_000)
}

function outcome(r: SupplierEnquiry, today: string): { value: 'quoted' | 'declined' | 'waiting' | 'no-reply'; label: string } {
  if (r.quoted) return { value: 'quoted', label: 'Quoted' }
  if (r.noOffer) return { value: 'declined', label: "Couldn't offer" }
  return r.sentOn && daysBetween(r.sentOn, today) >= 7 ? { value: 'no-reply', label: 'No reply' } : { value: 'waiting', label: 'Waiting for a reply' }
}
