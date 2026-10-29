import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, CloudOff, FileDown, ShieldAlert } from 'lucide-react'
import { useSession, useSeesPrices } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { businessToday } from '@/lib/dates'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Button } from '@/ui/Button'
import { DetailHeader } from '@/ui/DetailHeader'
import { EmptyState } from '@/ui/EmptyState'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { Checkbox } from '@/ui/form/Checkbox'
import { Select } from '@/ui/form/Select'
import { useToast } from '@/ui/useToast'
import { useJobFacts } from '@/features/jobs/hooks'
import { jobLabel } from '@/features/jobs/lib/listModel'
import { downloadBlob } from '@/features/quotations/lib/sharePdf'
import { useRfqHeader, useRfqInquiries, useRfqItems } from '@/features/rfqs/hooks'
import { useCompanyProfile } from '@/features/settings/hooks'
import { buildStatement, DEFAULT_SORT, orderNote, type QuotedRow, type SortKey, type SortSpec, type StatementSection, type SupplierTotal } from '@/features/statement/model'
import { generateStatementPdf } from '@/features/statement/pdf/generate'

/*
 * The Comparative Statement of one job (owner request, 2026-10-29): /jobs/<key>/statement. For each item, one row per supplier that
 * quoted it, with the unit cost, the line total (quantity x unit cost), lead time, weight, country of origin and any note. "Export PDF"
 * makes the same sheet as an A4 landscape PDF with the company letterhead.
 *
 * It SELECTS NOTHING: no "cheapest", no "recommended", nothing ticked, rows in supplier-name order. A person may sort by a column; the
 * sort only moves rows. Totals are per supplier and per currency and are never added across currencies. The statement is cost, not a
 * selling price: the CRM works out no selling price and no margin. Which supplier to buy from is chosen by a person, per item, in the
 * Create order dialog; the quotation's prices are typed by a person.
 *
 * Admin and sales only. The database refuses an engineer the prices this page is made of (migration 0081), and this page draws a
 * notice for an engineer before it asks for anything.
 */

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-detail px-4 pb-16 pt-4 md:px-8 md:pt-6">{children}</div>
}

export default function StatementPage() {
  const { key: raw } = useParams()
  const key = raw ? decodeURIComponent(raw) : undefined
  const sees = useSeesPrices()
  const session = useSession()
  if (session.status === 'signed-in' && !sees) {
    return (
      <Shell>
        <div data-testid="statement-no-access">
        <EmptyState
          mood="warning"
          icon={ShieldAlert}
          title="The comparative statement is for admins and sales"
          actions={
            key ? (
              <Link to={`/jobs/${encodeURIComponent(key)}`} className="inline-flex h-control items-center rounded border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-sunken">
                Back to the job
              </Link>
            ) : undefined
          }
        >
          It shows what suppliers charge, and engineers do not see prices.
        </EmptyState>
        </div>
      </Shell>
    )
  }
  if (!key || !sees) return null
  return <StatementLoader jobKey={key} />
}

function StatementLoader({ jobKey }: { jobKey: string }) {
  const facts = useJobFacts(jobKey)
  useMobileBar({ title: 'Comparative statement', back: 'history', fallback: `/jobs/${encodeURIComponent(jobKey)}`, hideTabs: true })
  if (facts.isPending) return <PageSkeleton />
  if (facts.isError && !facts.data) {
    return (
      <Shell>
        <EmptyState
          mood="error"
          icon={CloudOff}
          title="Couldn't open the statement"
          actions={
            <Button variant="primary" onClick={() => void facts.refetch()}>
              Try again
            </Button>
          }
        >
          Nothing was changed. Check your connection and try again.
        </EmptyState>
      </Shell>
    )
  }
  if (!facts.data) return <NotFoundPage />
  const { job } = facts.data
  if (!job.rfqId) {
    return (
      <Shell>
        <EmptyState
          title="There is nothing to compare"
          actions={
            <Link to={`/jobs/${encodeURIComponent(jobKey)}`} className="inline-flex h-control items-center rounded border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-sunken">
              Back to the job
            </Link>
          }
        >
          {`${jobLabel(job.key)} was made as an order, with no enquiry, so no supplier was asked for a price.`}
        </EmptyState>
      </Shell>
    )
  }
  return <Statement jobKey={jobKey} rfqId={job.rfqId} />
}

function PageSkeleton() {
  return (
    <Shell>
      <div role="status" className="grid gap-4" aria-busy="true" aria-label="Loading the comparative statement">
        <Skeleton className="h-4 w-[10rem]" />
        <Skeleton className="h-[2.25rem] w-[24rem] max-w-full" />
        <Skeleton className="h-[10rem] w-full" />
        <Skeleton className="h-[10rem] w-full" />
      </div>
    </Shell>
  )
}

const COLUMNS: Array<{ key: SortKey | null; label: string; align?: 'right'; help?: string }> = [
  { key: 'supplier', label: 'Supplier' },
  { key: 'unit', label: 'Unit cost', align: 'right' },
  { key: 'total', label: 'Line total', align: 'right' },
  { key: 'lead', label: 'Lead time' },
  { key: 'weight', label: 'Weight each', align: 'right' },
  { key: null, label: 'Weight total', align: 'right' },
  { key: 'origin', label: 'Country of origin' },
  { key: null, label: 'Notes' },
]

/** The columns of an item's quotes, as a grid: the table roles are on the elements (the raw table tags are for DataTable only). */
const ROW = 'grid grid-cols-[minmax(11rem,1.5fr)_minmax(8rem,1fr)_minmax(9rem,1fr)_minmax(7rem,1fr)_minmax(6rem,0.8fr)_minmax(6rem,0.8fr)_minmax(8rem,1fr)_minmax(8rem,1.2fr)] items-start'
const TOTAL_ROW = 'grid grid-cols-[minmax(12rem,2fr)_minmax(7rem,1fr)_minmax(10rem,1.5fr)] items-start'

const SORT_CHOICES = [
  { value: 'supplier:asc', label: 'Supplier name, A to Z' },
  { value: 'supplier:desc', label: 'Supplier name, Z to A' },
  { value: 'unit:asc', label: 'Unit cost, low to high' },
  { value: 'unit:desc', label: 'Unit cost, high to low' },
  { value: 'total:asc', label: 'Line total, low to high' },
  { value: 'total:desc', label: 'Line total, high to low' },
  { value: 'lead:asc', label: 'Lead time, shortest first' },
  { value: 'lead:desc', label: 'Lead time, longest first' },
  { value: 'weight:asc', label: 'Weight, light to heavy' },
  { value: 'weight:desc', label: 'Weight, heavy to light' },
  { value: 'origin:asc', label: 'Country of origin, A to Z' },
  { value: 'origin:desc', label: 'Country of origin, Z to A' },
]

function Statement({ jobKey, rfqId }: { jobKey: string; rfqId: string }) {
  const { toast } = useToast()
  const session = useSession()
  const header = useRfqHeader(rfqId)
  const items = useRfqItems(rfqId)
  const inquiries = useRfqInquiries(rfqId)
  const profile = useCompanyProfile()
  const [showNoReply, setShowNoReply] = useState(false)
  const [sort, setSort] = useState<SortSpec>(DEFAULT_SORT)
  const [busy, setBusy] = useState(false)
  const phone = useMediaQuery('(max-width: 767px)')

  const statement = useMemo(() => buildStatement(items.data ?? [], inquiries.data ?? [], { showNoReply, sort }), [items.data, inquiries.data, showNoReply, sort])
  const back = `/jobs/${encodeURIComponent(jobKey)}`

  if (header.isPending || items.isPending || inquiries.isPending) return <PageSkeleton />
  if (!header.data || items.isError || inquiries.isError) {
    return (
      <Shell>
        <EmptyState
          mood="error"
          icon={CloudOff}
          title="The supplier prices did not load"
          actions={
            <Button
              variant="primary"
              onClick={() => {
                void header.refetch()
                void items.refetch()
                void inquiries.refetch()
              }}
            >
              Try again
            </Button>
          }
        >
          Nothing was changed. Check your connection and try again.
        </EmptyState>
      </Shell>
    )
  }
  const rfq = header.data
  const reference = `${jobLabel(jobKey)} (${rfqRef(rfq.number)})`
  const quotedAny = statement.totals.length > 0

  const clickSort = (k: SortKey) => setSort(s => (s.key === k ? { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }))

  const exportPdf = async () => {
    if (!profile.data || busy) return
    setBusy(true)
    try {
      const blob = await generateStatementPdf(
        {
          statement,
          reference,
          customer: rfq.company.name,
          date: businessToday(),
          preparedBy: session.status === 'signed-in' ? session.user.name : '',
          showNoReply,
          orderNote: orderNote(sort),
        },
        profile.data,
      )
      downloadBlob(blob, `Comparative-statement-${jobLabel(jobKey).replace(/\s+/g, '-')}.pdf`)
      toast({ title: 'Comparative statement exported', body: reference, tone: 'success' })
    } catch (err) {
      toast({ title: 'Could not make the PDF', body: mapPgError(err).message, tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Shell>
      <DetailHeader
        name="Comparative statement"
        code={jobLabel(jobKey)}
        breadcrumb={[{ label: 'Jobs', to: '/jobs' }, { label: jobLabel(jobKey), to: back, mono: true }, { label: 'Comparative statement' }]}
        meta={[rfq.company.name, rfqRef(rfq.number)]}
      />

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-3" data-testid="statement-toolbar">
        <Checkbox
          checked={showNoReply}
          onCheckedChange={v => setShowNoReply(v === true)}
          label="Show suppliers that did not reply"
          aria-label="Show suppliers that did not reply"
        />
        <p className="min-w-0 flex-1 basis-[16rem] text-base text-fg-2" data-testid="statement-order-note">
          {orderNote(sort)}
        </p>
        <Button
          variant="primary"
          size={phone ? 'touch' : undefined}
          icon={FileDown}
          onClick={() => void exportPdf()}
          busy={busy}
          busyLabel="Making the PDF"
          disabled={!profile.data || (items.data ?? []).length === 0}
        >
          Export PDF
        </Button>
      </div>

      {phone ? (
        <label className="mt-3 grid gap-1 text-base text-fg-2">
          Sort the rows by
          <Select
            aria-label="Sort the rows by"
            options={SORT_CHOICES}
            value={`${sort.key}:${sort.dir}`}
            onChange={e => {
              const [key, dir] = e.target.value.split(':')
              setSort({ key: key as SortKey, dir: dir as SortSpec['dir'] })
            }}
          />
        </label>
      ) : null}

      {(items.data ?? []).length === 0 ? (
        <p className="mt-6 text-base text-fg-muted">This enquiry has no items yet.</p>
      ) : (
        <div className="mt-4 grid gap-4" data-testid="statement">
          {statement.sections.map(sec => (
            <ItemSection key={sec.item.id} sec={sec} sort={sort} onSort={clickSort} showNoReply={showNoReply} phone={phone} />
          ))}
          <Totals totals={statement.totals} quotedAny={quotedAny} phone={phone} />
        </div>
      )}
    </Shell>
  )
}

function ItemSection({ sec, sort, onSort, showNoReply, phone }: { sec: StatementSection; sort: SortSpec; onSort: (k: SortKey) => void; showNoReply: boolean; phone: boolean }) {
  const { item } = sec
  return (
    <section aria-label={`Item ${item.number}`} className="min-w-0 rounded-panel border bg-surface" data-statement-item={item.number}>
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b bg-sunken px-4 py-3">
        <h2 className="min-w-0 flex-1 basis-[16rem] break-words text-base font-semibold">
          <span className="num mr-2 text-fg-muted">{item.number}</span>
          {item.description}
        </h2>
        <span className="num text-base text-fg-2">{`Quantity ${sec.quantityText}`}</span>
      </header>
      {sec.rows.length === 0 && !(showNoReply && sec.noQuote.length > 0) ? (
        <p className="px-4 py-4 text-base text-fg-muted">No supplier has quoted this item yet.</p>
      ) : phone ? (
        <ul className="divide-y">
          {sec.rows.map(r => (
            <RowCard key={r.lineId} r={r} />
          ))}
          {showNoReply
            ? sec.noQuote.map(r => (
                <li key={`n-${r.supplierId}`} className="grid gap-1 px-4 py-4 text-fg-muted" data-statement-noreply={r.supplierName}>
                  <span className="text-base font-medium">{r.supplierName}</span>
                  <span className="text-base">{r.reason}</span>
                </li>
              ))
            : null}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <div role="table" aria-label={`Quotes for item ${item.number}`} className="min-w-[56rem] text-left text-base">
            <div role="rowgroup">
              <div role="row" className={cn(ROW, 'border-b text-sm text-fg-muted')}>
                {COLUMNS.map(c => {
                  const active = c.key !== null && sort.key === c.key
                  return (
                    <div
                      key={c.label}
                      role="columnheader"
                      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : c.key ? 'none' : undefined}
                      className={cn('px-4 py-2 font-medium', c.align === 'right' && 'text-right')}
                    >
                      {c.key ? (
                        <button
                          type="button"
                          onClick={() => onSort(c.key as SortKey)}
                          className={cn('inline-flex items-center gap-1 rounded hover:text-fg', c.align === 'right' && 'flex-row-reverse', active && 'text-fg')}
                          aria-label={`Sort by ${c.label.toLowerCase()}`}
                        >
                          {c.label}
                          {active ? <Icon icon={sort.dir === 'asc' ? ArrowUp : ArrowDown} size="chip" /> : null}
                        </button>
                      ) : (
                        c.label
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
            <div role="rowgroup">
              {sec.rows.map(r => (
                <div key={r.lineId} role="row" className={cn(ROW, 'border-b last:border-b-0')} data-statement-row={r.supplierName}>
                  <div role="rowheader" className="min-w-0 break-words px-4 py-3 font-medium">
                    {r.supplierName}
                  </div>
                  <div role="cell" className="num whitespace-nowrap px-4 py-3 text-right">
                    <span className="mr-1 font-sans text-sm text-fg-muted">{r.currency}</span>
                    {r.unitCostText}
                  </div>
                  <div role="cell" className="num whitespace-nowrap px-4 py-3 text-right">
                    <span className="mr-1 font-sans text-sm text-fg-muted">{r.currency}</span>
                    {r.totalText}
                  </div>
                  <div role="cell" className="min-w-0 break-words px-4 py-3">
                    {r.leadTime ?? <span className="text-fg-muted">Not stated</span>}
                  </div>
                  <div role="cell" className="num whitespace-nowrap px-4 py-3 text-right">
                    {r.weightEachText ?? <span className="font-sans text-fg-muted">Not stated</span>}
                  </div>
                  <div role="cell" className="num whitespace-nowrap px-4 py-3 text-right">
                    {r.weightTotalText ?? <span className="font-sans text-fg-muted">Not stated</span>}
                  </div>
                  <div role="cell" className="min-w-0 break-words px-4 py-3">
                    {r.origin ?? <span className="text-fg-muted">Not stated</span>}
                  </div>
                  <div role="cell" className="min-w-0 break-words px-4 py-3 text-fg-2">
                    {r.note ?? ''}
                  </div>
                </div>
              ))}
              {showNoReply
                ? sec.noQuote.map(r => (
                    <div key={`n-${r.supplierId}`} role="row" className={cn(ROW, 'border-b text-fg-muted last:border-b-0')} data-statement-noreply={r.supplierName}>
                      <div role="rowheader" className="min-w-0 break-words px-4 py-3">
                        {r.supplierName}
                      </div>
                      <div role="cell" className="col-span-7 px-4 py-3">
                        {r.reason}
                      </div>
                    </div>
                  ))
                : null}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

/** One supplier's quote for one item on a phone: its name, then each fact under its label. */
function RowCard({ r }: { r: QuotedRow }) {
  const facts: Array<[string, ReactNode]> = [
    ['Unit cost', <span key="u" className="num">{`${r.currency} ${r.unitCostText}`}</span>],
    ['Line total', <span key="t" className="num">{`${r.currency} ${r.totalText}`}</span>],
    ['Lead time', r.leadTime ?? <span className="text-fg-muted">Not stated</span>],
    ['Weight each', r.weightEachText ?? <span className="text-fg-muted">Not stated</span>],
    ['Weight total', r.weightTotalText ?? <span className="text-fg-muted">Not stated</span>],
    ['Country of origin', r.origin ?? <span className="text-fg-muted">Not stated</span>],
  ]
  if (r.note) facts.push(['Notes', r.note])
  return (
    <li className="grid gap-2 px-4 py-4" data-statement-row={r.supplierName}>
      <p className="break-words text-base font-medium">{r.supplierName}</p>
      <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-3 gap-y-1 text-base">
        {facts.map(([label, value]) => (
          <Fragment key={label}>
            <dt className="text-fg-muted">{label}</dt>
            <dd className="m-0 break-words">{value}</dd>
          </Fragment>
        ))}
      </dl>
    </li>
  )
}

function Totals({ totals, quotedAny, phone }: { totals: SupplierTotal[]; quotedAny: boolean; phone: boolean }) {
  if (!quotedAny) return null
  return (
    <section aria-label="Totals per supplier" className="min-w-0 rounded-panel border bg-surface" data-statement-totals>
      <header className="border-b bg-sunken px-4 py-3">
        <h2 className="text-base font-semibold">Totals per supplier</h2>
        <p className="mt-1 text-base text-fg-2">Quantity times unit cost, added up for each supplier in its own currency. A total only covers the items that supplier quoted.</p>
      </header>
      {phone ? (
        <ul className="divide-y">
          {totals.map(t => (
            <li key={t.supplierId} className="grid gap-1 px-4 py-4" data-statement-total={t.supplierName}>
              <p className="break-words text-base font-medium">{t.supplierName}</p>
              <p className="text-base text-fg-muted">{`${t.itemsQuoted} of ${t.itemCount} items quoted`}</p>
              {t.byCurrency.map(c => (
                <p key={c.currency} className="num text-base">
                  <span className="mr-1 font-sans text-sm text-fg-muted">{c.currency}</span>
                  {c.totalText}
                </p>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto">
          <div role="table" aria-label="Totals per supplier" className="min-w-[32rem] text-left text-base">
            <div role="rowgroup">
              <div role="row" className={cn(TOTAL_ROW, 'border-b text-sm text-fg-muted')}>
                <div role="columnheader" className="px-4 py-2 font-medium">
                  Supplier
                </div>
                <div role="columnheader" className="px-4 py-2 font-medium">
                  Items quoted
                </div>
                <div role="columnheader" className="px-4 py-2 text-right font-medium">
                  Total cost
                </div>
              </div>
            </div>
            <div role="rowgroup">
              {totals.map(t => (
                <div key={t.supplierId} role="row" className={cn(TOTAL_ROW, 'border-b last:border-b-0')} data-statement-total={t.supplierName}>
                  <div role="rowheader" className="min-w-0 break-words px-4 py-3 font-medium">
                    {t.supplierName}
                  </div>
                  <div role="cell" className="num px-4 py-3">{`${t.itemsQuoted} of ${t.itemCount}`}</div>
                  <div role="cell" className="num px-4 py-3 text-right">
                    {t.byCurrency.map(c => (
                      <span key={c.currency} className="block whitespace-nowrap">
                        <span className="mr-1 font-sans text-sm text-fg-muted">{c.currency}</span>
                        {c.totalText}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
