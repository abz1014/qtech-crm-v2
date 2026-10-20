import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { CloudOff, FileQuestion, RefreshCw } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { recordRfqVisit } from '@/lib/capture/recents'
import { Button } from '@/ui/Button'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import { useFxLatest, useRfqHeader, useRfqInquiries, useRfqItems, useSupplierCandidates, useSupplierMemory, useSupplierStatsFor } from '@/features/rfqs/hooks'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import * as rfqApi from '@/features/rfqs/api'
import { qk } from '@/features/queryKeys'
import { primaryAction, suggestSuppliers, toRateTable, type RfqPrimary, type SuggestionItem } from '@/features/rfqs/lib'
import { RfqActionBar, RfqHeaderBlock, type HeaderFacts } from '@/features/rfqs/RfqHeaderBlock'
import { useQuotations } from '@/features/quotations/hooks'
import { useOrdersForRfq } from '@/features/orders/hooks'
import { ItemsPanel } from '@/features/rfqs/ItemsPanel'
import { SupplierReplies } from '@/features/rfqs/SupplierReplies'
import { useRankedQuotes } from '@/features/rfqs/ranking/hooks'
import { DetailPanel } from '@/features/rfqs/DetailPanel'
import { AddItemDialog } from '@/features/rfqs/AddItemDialog'
import { SuppliersAsked } from '@/features/rfqs/SuppliersAsked'
import { canChaseInquiry } from '@/features/rfqs/replyFocus'
import { FloatDialog, SuppliersToAskCard } from '@/features/rfqs/SuppliersToAsk'
import { withShortlist } from '@/features/rfqs/askList'
import { useAskSuppliers } from '@/features/rfqs/useAskSuppliers'
import { QuotationsPanel } from '@/features/quotations/QuotationsPanel'
import { ClarificationsPanel } from '@/features/rfqs/ClarificationsPanel'
import { AttachmentsPanel } from '@/features/rfqs/AttachmentsPanel'
import { ConvertDialog } from '@/features/orders/ConvertDialog'
import { useWonDialog } from '@/features/orders/useWonDialog'

/*
 * RFQ detail (R07; g2-rfq-detail.html; the parity audit's Part C; the UX audit of 2026-10-19). The header has the company, at most
 * two chips and ONE green button chosen by state (lib/nextAction.ts: Ask suppliers, Issue quotation, Mark won; the supplier chase
 * while waiting for prices), with everything else in More. Left column: "Items and supplier prices" (Add item, the rate bar,
 * then each item with one line per price, best first, one Recommended mark), "Replies from suppliers" (one row per supplier, open
 * while a reply is expected) and the Quotations table. Right rail: "Suppliers asked" (memory lines, the chase as a short preview,
 * Ask more suppliers) or, while nobody has been asked, "Suppliers to ask"; then the questions for the customer (R09) and the files
 * (R10). Phone: one bar (back, the number) and a sticky action bar with the same green action, Chase and More.
 *
 * FE-2 entry burden, listed for the commit:
 *   required     a price (greater than zero) for each item the supplier quoted. Nothing else is required.
 *                An added item needs its description only.
 *   pre-filled   currency (supplier's last currency, else the country map, else PKR), the supplier's lead time and stock
 *                when they were saved before, quantity 1 for a new item, the date (today).
 *   optional     lead time, stock, a per-item "can't quote" reason.
 *   interactions supplier reply: one typed price per item, then "Save reply" (currency never typed; the reply is open while expected).
 *                can't quote: 1 tap. chase: 1 tap for the supplier shown (Copy and mark chased), 1 tap Chase on any other.
 *                mark quotation sent (no PDF): 2 taps (More, choose). close or lose: 2 taps (More, choose the reason).
 *
 * A missing exchange rate never blocks anything (BUILD_PLAN A3/A4): the line shows "not compared, no rate".
 */

function Shell({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-[1440px] px-4 pb-6 pt-6 md:px-8 md:pb-16">{children}</div>
}

/** The loading skeleton mirrors the page: crumb, title, chips, actions, the meta cells, an items panel with rows, and the rail cards (C-15). */
function PageSkeleton() {
  return (
    <Shell>
      <div className="grid gap-4" aria-busy="true" aria-label="Loading RFQ">
        <Skeleton className="h-4 w-40" />
        <div className="flex flex-wrap items-start justify-between gap-4">
          <Skeleton className="h-9 w-96 max-w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-8 w-32" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[64, 112, 160, 120].map(w => (
            <Skeleton key={w} className="h-5" style={{ width: w }} />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-px rounded border md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[76px] rounded-none max-md:[&:nth-child(n+5)]:hidden" />
          ))}
        </div>
        <div className="mt-2 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-px rounded border">
            <Skeleton className="h-16 rounded-none" />
            <Skeleton className="h-24 rounded-none" />
            <Skeleton className="h-24 rounded-none" />
            <Skeleton className="h-24 rounded-none" />
          </div>
          <div className="grid gap-4">
            <Skeleton className="h-40" />
            <Skeleton className="h-32" />
            <Skeleton className="h-24" />
          </div>
        </div>
      </div>
    </Shell>
  )
}

const timeOf = (ms: number) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Karachi' })

export default function RfqDetailScreen() {
  const { id } = useParams()
  const header = useRfqHeader(id)
  const items = useRfqItems(id)
  const inquiries = useRfqInquiries(id)

  // Start the id-only reads now, in the same round as the header, instead of when the panels mount after it (P04: they were a second and
  // third wave). The panels read the same query keys, so they find the data already there. Nothing here needs the header's data.
  const client = useQueryClient()
  useEffect(() => {
    if (!id) return
    void client.prefetchQuery({ queryKey: qk.rfqs.part(id, 'clarifications'), queryFn: () => rfqApi.listClarifications(id) })
    void client.prefetchQuery({ queryKey: qk.rfqs.part(id, 'attachments'), queryFn: () => rfqApi.listAttachments(id) })
    void client.prefetchQuery({ queryKey: qk.fx.latest(), queryFn: rfqApi.listFxLatest, staleTime: 60_000 })
    void client.prefetchQuery({ queryKey: qk.intake.suppliers(), queryFn: rfqApi.listSupplierCandidates, staleTime: 60_000 })
  }, [id, client])

  // Capture offers recently opened RFQs first (R22): note this visit, on this device only.
  const openedId = header.data?.id
  useEffect(() => {
    if (openedId) recordRfqVisit(openedId)
  }, [openedId])

  if (header.isPending) return <PageSkeleton />
  if (header.isError && !header.data) {
    return (
      <Shell>
        <EmptyState
          mood="error"
          title="Couldn't load this RFQ"
          actions={
            <>
              <Button variant="primary" icon={RefreshCw} onClick={() => void header.refetch()}>
                Try again
              </Button>
              <Link to="/rfqs" className="inline-flex h-control items-center rounded border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-sunken">
                Back to RFQs
              </Link>
            </>
          }
        >
          Nothing was changed. Check your connection and try again.
        </EmptyState>
      </Shell>
    )
  }
  if (!header.data) {
    return (
      <Shell>
        <EmptyState
          icon={FileQuestion}
          title="This RFQ isn't here"
          actions={
            <Link to="/rfqs" className="inline-flex h-control items-center rounded border border-primary bg-primary px-3 text-sm font-medium text-primary-foreground">
              All RFQs
            </Link>
          }
        >
          The link may be wrong, or the RFQ was removed. Open the RFQ list to find it.
        </EmptyState>
      </Shell>
    )
  }
  return <Loaded rfq={header.data} headerAt={header.dataUpdatedAt} items={items} inquiries={inquiries} />
}

function Loaded({
  rfq,
  headerAt,
  items,
  inquiries,
}: {
  rfq: RfqHeader
  headerAt: number
  items: ReturnType<typeof useRfqItems>
  inquiries: ReturnType<typeof useRfqInquiries>
}) {
  const [wonOpen, setWonOpen] = useWonDialog()
  const fx = useFxLatest()
  const rates = useMemo(() => toRateTable(fx.data ?? []), [fx.data])
  const itemList = useMemo<RfqItemRow[]>(() => items.data ?? [], [items.data])
  const inquiryList = useMemo<InquiryRow[]>(() => inquiries.data ?? [], [inquiries.data])
  const [adding, setAdding] = useState(false)
  const [floating, setFloating] = useState(false)
  const today = businessToday()
  const { ask, busy: asking } = useAskSuppliers(rfq, inquiryList)

  // Who could be asked: every supplier on file except the customer and those already asked, with the reason for each (R03).
  const candidates = useSupplierCandidates(true)
  const askedIds = useMemo(() => new Set(inquiryList.map(i => i.supplierId)), [inquiryList])
  const candidateList = useMemo(() => (candidates.data ?? []).filter(c => c.id !== rfq.company.id && !askedIds.has(c.id)), [candidates.data, rfq.company.id, askedIds])
  const suggestionItems = useMemo<SuggestionItem[]>(
    () => itemList.map(i => ({ id: i.id, description: i.description, brandId: i.brandId, brandName: i.brandName, familyId: i.familyId, familyName: i.familyName })),
    [itemList],
  )

  // "Last price for this item" (R17) for the suppliers who replied, and the memory behind the suggestions, in one batched read per
  // distinct item. It never blocks the page: if it fails, the chips and the reasons are simply absent.
  const memoryItems = useMemo(() => itemList.map(i => ({ key: i.id, description: i.description, brandId: i.brandId, familyId: i.familyId })), [itemList])
  const memorySuppliers = useMemo(
    () => [...new Set([...inquiryList.filter(i => i.lines.length > 0).map(i => i.supplierId), ...candidateList.map(c => c.id)])].sort(),
    [inquiryList, candidateList],
  )
  const memory = useSupplierMemory(memoryItems, memorySuppliers, memorySuppliers.length > 0 && itemList.length > 0 && candidates.isSuccess, rfq.id)
  const suggestions = useMemo(
    () => (candidates.isSuccess ? suggestSuppliers(suggestionItems, { suppliers: candidateList, memory: memory.data ?? {} }, { today }).suppliers : undefined),
    [candidates.isSuccess, suggestionItems, candidateList, memory.data, today],
  )
  const stats = useSupplierStatsFor(useMemo(() => inquiryList.map(i => i.supplierId), [inquiryList]))

  const hasPrices = inquiryList.some(i => i.lines.length > 0)
  // A8 (R25): the ranking of every quote (the order, the reasons). Asked for once there is a price; the page works without it.
  const ranking = useRankedQuotes(rfq.id, hasPrices)
  const chaseSuppliers = inquiryList.filter(i => canChaseInquiry(i, itemList)).length
  const chaseCustomer = rfq.state?.waiting ?? 0
  const loadError = items.isError || inquiries.isError
  const loading = items.isPending || inquiries.isPending
  // Asked: sent, or answered "cannot quote". A supplier only on the shortlist (saved without asking) is not asked yet: it comes first
  // in the Ask list, already ticked, and asking it stamps its inquiry sent (review item 3).
  const askedCount = inquiryList.filter(i => i.sentOn || i.noOfferOn).length
  const nobodyAsked = !loading && !loadError && askedCount === 0
  const askList = useMemo(() => withShortlist(inquiryList, itemList, suggestions), [inquiryList, itemList, suggestions])

  // The one green button (owner decision 2026-10-19): chosen by state. Until the items and replies are in, there is none.
  const quotations = useQuotations(rfq.id)
  const orders = useOrdersForRfq(rfq.id)
  const quotationCount = quotations.data?.length ?? 0
  const primary: RfqPrimary =
    loading || loadError
      ? 'none'
      : primaryAction({
          outcome: rfq.state?.outcome ?? 'open',
          hasOrder: (orders.data ?? []).some(o => !o.cancelledOn),
          sourcingState: rfq.state?.sourcing_state,
          bidState: rfq.state?.bid_state,
          hasPrices,
          quotationCount,
          itemCount: itemList.length,
          chaseable: chaseSuppliers,
        })
  const awaiting = inquiryList.filter(i => i.sentOn && !i.noOfferOn && i.lines.length === 0).length
  const facts: HeaderFacts = { primary, itemCount: itemList.length, quotationCount, onAsk: () => setFloating(true), awaiting }

  const askFrom = async (ticked: readonly { supplierId: string; name: string }[], list: RfqItemRow[]) =>
    ask({ supplierIds: ticked.map(t => t.supplierId), names: ticked.map(t => t.name), items: list })

  return (
    <Shell>
      <RfqHeaderBlock rfq={rfq} facts={facts} />
      {/* data-slot="convert-dialog" (O01): the Create order dialog, open while the address carries ?won=1. */}
      {wonOpen && inquiries.data ? <ConvertDialog rfq={rfq} inquiries={inquiries.data} rates={rates} onClose={() => setWonOpen(false)} /> : null}
      {loadError ? (
        <p className="mt-3 text-sm text-fg-muted" role="status">
          {`Showing the details saved on this device at ${timeOf(headerAt)}. Replies and questions did not load.`}
        </p>
      ) : null}
      <div className="mt-6 grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 gap-6">
          {loadError ? (
            <DetailPanel title="Items and supplier replies">
              <EmptyState
                mood="error"
                icon={CloudOff}
                title="Supplier replies did not load"
                className="items-start justify-items-start px-5 text-left"
                actions={
                  <>
                    <Button
                      variant="primary"
                      icon={RefreshCw}
                      onClick={() => {
                        void items.refetch()
                        void inquiries.refetch()
                      }}
                    >
                      Try again
                    </Button>
                    <Link to="/rfqs" className="inline-flex h-control items-center rounded border border-line-strong bg-surface px-3 text-sm font-medium hover:bg-sunken">
                      Back to RFQs
                    </Link>
                  </>
                }
              >
                The connection dropped before the replies arrived. Nothing was changed and nothing you typed is lost. Try again, or come back when you are online.
              </EmptyState>
              <dl className="grid gap-1 px-5 pb-5 text-sm">
                <div className="flex gap-4">
                  <dt className="w-24 text-fg-muted">Last loaded</dt>
                  <dd className="num m-0">{`${timeOf(headerAt)} today`}</dd>
                </div>
                {(() => {
                  const code = (inquiries.error as { code?: string } | null)?.code ?? (items.error as { code?: string } | null)?.code
                  return code ? (
                    <div className="flex gap-4">
                      <dt className="w-24 text-fg-muted">Reference</dt>
                      <dd className="num m-0">{code}</dd>
                    </div>
                  ) : null
                })()}
              </dl>
            </DetailPanel>
          ) : loading ? (
            <div className="grid gap-4" aria-busy="true" aria-label="Loading items and replies">
              <Skeleton className="h-56 w-full" />
              <Skeleton className="h-56 w-full" />
            </div>
          ) : (
            <>
              <ItemsPanel
                rfq={rfq}
                items={itemList}
                inquiries={inquiryList}
                rates={rates}
                fxRows={fx.data ?? []}
                memory={memory.data}
                suggestions={suggestions}
                ranking={ranking.byLine}
                onAddItem={() => setAdding(true)}
                onCopyEnquiry={(s, item) => void askFrom([s], [item])}
              />
              <SupplierReplies rfq={rfq} items={itemList} inquiries={inquiryList} rates={rates} />
            </>
          )}
          <QuotationsPanel rfq={rfq} inquiries={inquiryList} itemCount={itemList.length} />
        </div>
        <aside className="grid min-w-0 gap-6" aria-label="Suppliers, questions and files">
          {loadError ? (
            <DetailPanel title="Suppliers asked">
              <p className="px-5 py-4 text-sm text-fg-muted">Not loaded. Try again to see who has replied.</p>
            </DetailPanel>
          ) : loading ? (
            <Skeleton className="h-40 w-full" />
          ) : nobodyAsked ? (
            <SuppliersToAskCard
              suggestions={askList}
              items={itemList}
              busy={asking}
              onAsk={ticked => void askFrom(ticked, itemList)}
            />
          ) : (
            <SuppliersAsked rfq={rfq} items={itemList} inquiries={inquiryList} stats={stats.data} onFloat={() => setFloating(true)} />
          )}
          <ClarificationsPanel rfq={rfq} inquiries={inquiryList} />
          <AttachmentsPanel rfqId={rfq.id} compact />
        </aside>
      </div>
      <RfqActionBar rfq={rfq} facts={facts} chaseSuppliers={chaseSuppliers} chaseCustomer={chaseCustomer} />
      {adding ? <AddItemDialog rfq={rfq} onClose={() => setAdding(false)} /> : null}
      {floating ? (
        <FloatDialog
          title={askedCount > 0 ? 'Ask more suppliers' : 'Ask suppliers'}
          suggestions={askList}
          itemCount={(itemList.filter(it => !inquiryList.some(i => i.lines.some(l => l.itemId === it.id))).length || itemList.length) as number}
          busy={asking}
          onClose={() => setFloating(false)}
          onAsk={ticked => {
            const needing = itemList.filter(it => !inquiryList.some(i => i.lines.some(l => l.itemId === it.id)))
            void askFrom(ticked, needing.length > 0 ? needing : itemList).then(ok => ok && setFloating(false))
          }}
        />
      ) : null}
    </Shell>
  )
}
