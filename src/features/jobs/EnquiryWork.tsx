import { Suspense, useMemo, useState } from 'react'
import { X } from 'lucide-react'
import { useSeesPrices } from '@/app/session'
import { businessToday } from '@/lib/dates'
import { useChannelPreference } from '@/lib/useChannelPreference'
import { lazyWithReload } from '@/lib/importWithReload'
import { Button } from '@/ui/Button'
import { MessageActions } from '@/ui/MessageActions'
import { Skeleton } from '@/ui/Skeleton'
import { DetailPanel } from '@/features/rfqs/DetailPanel'
import { ItemsPanel } from '@/features/rfqs/ItemsPanel'
import type { InquiryRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { useFxLatest, useRfqHeader, useRfqInquiries, useRfqItems, useSupplierCandidates, useSupplierMemory, useSupplierStatsFor } from '@/features/rfqs/hooks'
import { toRateTable } from '@/features/rfqs/lib/comparePrices'
import { quotationSent } from '@/features/rfqs/lib/nextAction'
import type { SuggestionItem } from '@/features/rfqs/lib/supplierSuggestion'
import { useSuggestLib } from '@/features/rfqs/useSuggestLib'
import { useSuggestionExtras } from '@/features/rfqs/useSuggestionExtras'
import { canChaseInquiry } from '@/features/rfqs/replyFocus'
import { useAskSuppliers, useLastAsk, type AskResult } from '@/features/rfqs/useAskSuppliers'
import { useRankedQuotes } from '@/features/rfqs/ranking/hooks'
import type { ChaseMode } from '@/features/rfqs/SuppliersAsked'
import { useQuotations } from '@/features/quotations/hooks'
import { useOrdersForRfq } from '@/features/orders/forRfq'

/*
 * The enquiry side of the job, on the job page (redesign P5-D1): ask suppliers, enter their prices, send the quotation, Mark won.
 * Every piece is the component the RFQ page already uses (SuppliersToAskCard, SuppliersAsked with its reply dialog, ItemsPanel,
 * QuotationsPanel with its Issue quotation dialog, FloatDialog, ConvertDialog), as the old RFQ page (removed 2026-10-30) wired them.
 * The dialogs open by the address (?issue=1, ?won=1), so the next-step button of the job page opens the same dialogs.
 */
const QuotationsPanel = lazyWithReload(() => import('@/features/quotations/QuotationsPanel').then(m => ({ default: m.QuotationsPanel })))
const SuppliersAsked = lazyWithReload(() => import('@/features/rfqs/SuppliersAsked').then(m => ({ default: m.SuppliersAsked })))
const SuppliersToAskCard = lazyWithReload(() => import('@/features/rfqs/SuppliersToAsk').then(m => ({ default: m.SuppliersToAskCard })))
const FloatDialog = lazyWithReload(() => import('@/features/rfqs/SuppliersToAsk').then(m => ({ default: m.FloatDialog })))
const AddItemDialog = lazyWithReload(() => import('@/features/rfqs/AddItemDialog').then(m => ({ default: m.AddItemDialog })))

/** After an ask: the one enquiry (copied already) with Open in WhatsApp / Open in email for each supplier asked. */
function SendToEachCard({ ask, inquiries, onClose }: { ask: AskResult; inquiries: readonly InquiryRow[]; onClose: () => void }) {
  const [channel, setChannel] = useChannelPreference()
  const asked = ask.supplierIds.map(id => inquiries.find(i => i.supplierId === id)).filter((i): i is InquiryRow => Boolean(i))
  if (asked.length === 0) return null
  return (
    <DetailPanel
      title="Send it to each supplier"
      meta={<span className="text-sm text-fg-muted">Copied already. Open each chat, or paste it.</span>}
      actions={
        <Button size="sm" variant="quiet" icon={X} onClick={onClose} aria-label="Close send to each supplier">
          Done
        </Button>
      }
    >
      <ul className="grid divide-y" data-slot="send-to-each">
        {asked.map(i => (
          <li key={i.id} className="grid gap-2 px-5 py-3">
            <b className="text-sm font-medium">{i.supplierName}</b>
            <MessageActions
              size="sm"
              to={{ name: i.contactName ?? i.supplierName, phone: i.contactPhone, email: i.contactEmail }}
              text={ask.text}
              email={{ subject: 'Request for quotation' }}
              copy={false}
              channel={channel}
              onChannelChange={setChannel}
            />
          </li>
        ))}
      </ul>
    </DetailPanel>
  )
}

/** The work of the Quotation stage: suppliers to ask or asked (with their replies), the items with prices, and the quotations. */
export default function EnquiryWork({ rfqId }: { rfqId: string }) {
  const header = useRfqHeader(rfqId)
  const items = useRfqItems(rfqId)
  const inquiries = useRfqInquiries(rfqId)
  if (header.isPending || items.isPending || inquiries.isPending) return <Skeleton className="h-[10rem] w-full" />
  if (!header.data || items.isError || inquiries.isError) {
    return <p className="text-base text-fg-muted">The supplier details did not load. Reload the page to try again.</p>
  }
  return <Work rfq={header.data} itemList={items.data ?? []} inquiryList={inquiries.data ?? []} />
}

function Work({ rfq, itemList, inquiryList }: { rfq: RfqHeader; itemList: RfqItemRow[]; inquiryList: InquiryRow[] }) {
  const prices = useSeesPrices()
  const fx = useFxLatest()
  const rates = useMemo(() => toRateTable(fx.data ?? []), [fx.data])
  const [adding, setAdding] = useState(false)
  const [floating, setFloating] = useState(false)
  const today = businessToday()
  const { ask, busy: asking } = useAskSuppliers(rfq, inquiryList)
  const [lastAsk, clearLastAsk] = useLastAsk(rfq.id)

  const candidates = useSupplierCandidates(true)
  const askedIds = useMemo(() => new Set(inquiryList.map(i => i.supplierId)), [inquiryList])
  const candidateList = useMemo(() => (candidates.data ?? []).filter(c => c.id !== rfq.company.id && !askedIds.has(c.id)), [candidates.data, rfq.company.id, askedIds])
  const suggestionItems = useMemo<SuggestionItem[]>(
    () => itemList.map(i => ({ id: i.id, description: i.description, brandId: i.brandId, brandName: i.brandName, familyId: i.familyId, familyName: i.familyName })),
    [itemList],
  )
  const memoryItems = useMemo(() => itemList.map(i => ({ key: i.id, description: i.description, brandId: i.brandId, familyId: i.familyId })), [itemList])
  const memorySuppliers = useMemo(() => [...new Set([...inquiryList.filter(i => i.lines.length > 0).map(i => i.supplierId), ...candidateList.map(c => c.id)])].sort(), [inquiryList, candidateList])
  const memory = useSupplierMemory(memoryItems, memorySuppliers, memorySuppliers.length > 0 && itemList.length > 0 && candidates.isSuccess, rfq.id)
  const lib = useSuggestLib()
  const extras = useSuggestionExtras(suggestionItems, candidateList, today, candidates.isSuccess, lib)
  const suggestResult = useMemo(
    () => (lib && candidates.isSuccess ? lib.suggestSuppliers(extras.items, { suppliers: candidateList, memory: memory.data ?? {}, ...extras.extra }, { today }) : undefined),
    [lib, candidates.isSuccess, extras.items, extras.extra, candidateList, memory.data, today],
  )
  const suggestions = suggestResult?.suppliers
  const coverage = lib && suggestResult ? lib.coverageLine(suggestResult.uncovered) : null
  const stats = useSupplierStatsFor(useMemo(() => inquiryList.map(i => i.supplierId), [inquiryList]))
  const hasPrices = inquiryList.some(i => i.lines.length > 0)
  const ranking = useRankedQuotes(rfq.id, hasPrices)
  const askedCount = inquiryList.filter(i => i.sentOn || i.noOfferOn).length
  const nobodyAsked = askedCount === 0
  const askList = useMemo(() => (lib ? lib.withShortlist(inquiryList, itemList, suggestions) : []), [lib, inquiryList, itemList, suggestions])
  const quotations = useQuotations(prices ? rfq.id : undefined)
  const orders = useOrdersForRfq(rfq.id)
  const quotationCount = quotations.data?.length ?? 0
  const open = (rfq.state?.outcome ?? 'open') === 'open' && !(orders.data ?? []).some(o => !o.cancelledOn)
  const sent = quotationSent({ bidState: rfq.state?.bid_state, quotationCount })
  const chaseMode: ChaseMode = !open || sent ? 'none' : hasPrices ? 'button' : 'card'
  const askFrom = async (ticked: readonly { supplierId: string; name: string }[], list: RfqItemRow[]) => ask({ supplierIds: ticked.map(t => t.supplierId), names: ticked.map(t => t.name), items: list })
  const chaseable = inquiryList.filter(i => canChaseInquiry(i, itemList)).length

  return (
    <div className="grid gap-4" data-enquiry-work data-chaseable={chaseable}>
      {lastAsk ? <SendToEachCard ask={lastAsk} inquiries={inquiryList} onClose={clearLastAsk} /> : null}
      <Suspense fallback={<Skeleton className="h-[10rem] w-full" />}>
        {nobodyAsked ? (
          <SuppliersToAskCard suggestions={askList} items={itemList} busy={asking} onAsk={ticked => void askFrom(ticked, itemList)} />
        ) : (
          <SuppliersAsked rfq={rfq} items={itemList} inquiries={inquiryList} stats={stats.data} rates={rates} chase={chaseMode} onFloat={() => setFloating(true)} />
        )}
      </Suspense>
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
      <Suspense fallback={<Skeleton className="h-[8rem] w-full" />}>
        <QuotationsPanel rfq={rfq} inquiries={inquiryList} itemCount={itemList.length} />
      </Suspense>
      {adding ? (
        <Suspense fallback={null}>
          <AddItemDialog rfq={rfq} onClose={() => setAdding(false)} />
        </Suspense>
      ) : null}
      {floating ? (
        <Suspense fallback={null}>
          <FloatDialog
            title={askedCount > 0 ? 'Ask more suppliers' : 'Ask suppliers'}
            suggestions={askList}
 coverage={coverage}
            itemCount={(itemList.filter(it => !inquiryList.some(i => i.lines.some(l => l.itemId === it.id))).length || itemList.length) as number}
            busy={asking}
            onClose={() => setFloating(false)}
            onAsk={ticked => {
              const needing = itemList.filter(it => !inquiryList.some(i => i.lines.some(l => l.itemId === it.id)))
              void askFrom(ticked, needing.length > 0 ? needing : itemList).then(r => r.ok && setFloating(false))
            }}
          />
        </Suspense>
      ) : null}
    </div>
  )
}
