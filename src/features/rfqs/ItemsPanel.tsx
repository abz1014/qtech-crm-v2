import { useState } from 'react'
import { Ban, ChevronDown, Clock, Copy, Ellipsis, Pencil, Plus, ThumbsUp, Trash2, TriangleAlert } from 'lucide-react'
import { useSeesPrices } from '@/app/session'
import { cn } from '@/lib/utils'
import { businessToday } from '@/lib/dates'
import { copyToClipboard } from '@/lib/clipboard'
import { formatDay } from '@/lib/formatDay'
import { formatAmount, formatPaisa, formatRate, fxStaleness } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { StatusBadge } from '@/ui/StatusBadge'
import { useToast } from '@/ui/useToast'
import { LastPriceChipView } from '@/features/rfqs/LastPriceChip'
import { DetailPanel } from '@/features/rfqs/DetailPanel'
import { RateBar } from '@/features/rfqs/RateBar'
import { InfoTip } from '@/ui/InfoTip'
import { focusReplyInput } from '@/features/rfqs/replyFocus'
import { buildRateBar } from '@/features/fx/ratesModel'
import { ReasonBlock } from '@/features/rfqs/ranking/RankParts'
import { bandSizeOf, evidenceOf, reasonsFor, sellNote, whyNotCheapest, type RankRow } from '@/features/rfqs/lib/ranking/reasons'
import { lastPriceChip, type MemoryRow } from '@/lib/memory'
import type { FxLatestRow, InquiryRow, QuoteLineRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { useRemoveQuoteLine, useRestoreQuoteLine, useSetItemDecline } from '@/features/rfqs/hooks'
import { CANT_QUOTE_REASONS, comparePrices, itemCoverage, qtyText, reasonForItem, reasonLabel, type ComparedLine, type RateTable, type SupplierSuggestion } from '@/features/rfqs/lib'

/*
 * Items and supplier prices (g2-rfq-detail "Items and supplier replies", R07; the supplier comparison of R25; reworked by the UX
 * audit of 2026-10-19). One panel: its header with the counts, Add item and one tip that says how prices are compared; the rate
 * bar; then every item with what each supplier quoted for it, best first.
 *
 * Each price is ONE line: the supplier, the price in PKR at today's rate (the figure people compare), the lead time and the stock.
 * The supplier's own currency and figure, the rate and its age, the rate captured when the price was entered, the last price for
 * the item and the ranking's reasons open under the line (rows start closed). One mark per item: "Recommended" on the database's
 * rank 1 (rank_item_quotes, R25); when the cheapest is someone else (the 2% rule ordered them by delivery record) a plain
 * "Cheapest: ..." line says so. Without the ranking (still loading, or one price only) the lowest of two or more comparable prices
 * is marked "Lowest price". A price with no usable rate is shown and never blocks anything (BUILD_PLAN A3/A4); it is not compared.
 * Entering replies lives in the next panel, one row per supplier (SupplierReplies.tsx).
 *
 * An engineer (owner decision 2026-10-22: no prices anywhere) gets the same items with who replied, lead time and stock only: no
 * price column, no rate bar, no marks, no price details, no row menu (Edit reply and Copy price are price work). The lines come
 * without prices (listInquiries), so they are listed by supplier name.
 */

const daysBetween = (from: string, to: string) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000)

// Every row is its own grid, so the tracks are fixed to line up; sized for 16px text ("≈ PKR 1,234,567", "Not in stock").
const COLS = 'md:grid-cols-[minmax(0,1fr)_176px_minmax(0,136px)_128px_72px]'
const HEAD = `hidden gap-x-4 px-5 py-2 text-sm text-fg-muted md:grid ${COLS}`
/** Phone: the supplier and the price on one line, lead time, stock and the two buttons on the next (the mark, when there is one, above). */
const ROW = `relative grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 border-t px-5 py-3 md:gap-x-4 ${COLS}`
/** An engineer's row: the supplier, lead time and stock (no price, no buttons). */
const COLS_NO_PRICES = 'md:grid-cols-[minmax(0,1fr)_minmax(0,136px)_128px]'
const HEAD_NO_PRICES = `hidden gap-x-4 px-5 py-2 text-sm text-fg-muted md:grid ${COLS_NO_PRICES}`
const ROW_NO_PRICES = `relative grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-1 border-t px-5 py-3 md:gap-x-4 ${COLS_NO_PRICES}`

interface Entry {
  line: QuoteLineRow
  inquiry: InquiryRow
  c: ComparedLine
}

/** The price people compare: PKR at today's rate when there is a usable rate, else the supplier's own figure, marked not compared. */
function PriceCell({ line, c }: { line: QuoteLineRow; c: ComparedLine }) {
  if (line.currency === 'PKR' || c.pkrPaisa !== null) {
    return (
      <span className="num whitespace-nowrap text-base font-medium">
        {/* A real space, not a margin: a screen reader reads "≈ PKR 33,600", not "PKR33,600". */}
        <span className="font-sans text-sm font-regular text-fg-muted">{line.currency === 'PKR' ? 'PKR' : '≈ PKR'}</span>{' '}
        {line.currency === 'PKR' ? formatAmount(line.unitPrice, 'auto') : formatPaisa(c.pkrPaisa as bigint, 'auto')}
      </span>
    )
  }
  return (
    <span className="grid justify-items-end">
      <span className="num whitespace-nowrap text-base font-medium">
        <span className="font-sans text-sm font-regular text-fg-muted">{line.currency}</span>{' '}
        {formatAmount(line.unitPrice, 'always')}
      </span>
      <span className="text-sm text-fg-muted">{c.notCompared === 'unusable' ? 'not compared, rate too old' : 'not compared, no rate'}</span>
    </span>
  )
}

/** What opens under a price line: the supplier's own figure and the rate behind the PKR, the rate captured at entry, where they are. */
function PriceDetail({ line, inquiry, c, rates }: { line: QuoteLineRow; inquiry: InquiryRow; c: ComparedLine; rates: RateTable }) {
  const today = businessToday()
  const rate = rates[line.currency]
  const where = [inquiry.supplierCity, inquiry.supplierCountry].filter(Boolean).join(', ')
  const age = line.fxRateOn ? Math.max(0, daysBetween(line.fxRateOn, today)) : null
  return (
    <div className="grid gap-1 text-sm text-fg-2" data-price-detail>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="num">
          Quoted {line.currency} {formatAmount(line.unitPrice, 'always')}
        </span>
        {line.currency === 'PKR' ? null : c.pkrPaisa !== null ? (
          <span className={cn('inline-flex items-center gap-1', c.band === 'stale' ? 'text-tone-warning-fg' : 'text-fg-muted')}>
            {c.band === 'stale' ? <Icon icon={TriangleAlert} size="chip" /> : <Icon icon={Clock} size="chip" />}
            <span className="num">
              {c.band === 'stale'
                ? `${line.currency} ${formatRate(rate?.rate ?? 0)}, rate ${c.rateAgeDays} days old`
                : `${line.currency} ${formatRate(rate?.rate ?? 0)}, ${c.rateAgeDays === 0 ? "today's rate" : `rate from ${c.rateAgeDays} ${c.rateAgeDays === 1 ? 'day' : 'days'} ago`}`}
            </span>
          </span>
        ) : (
          <span className="text-fg-muted">{c.notCompared === 'unusable' ? 'not compared — rate too old' : 'not compared — no rate'}</span>
        )}
        {line.currency === 'PKR' ? null : line.fxRatePkr !== null && line.fxRateOn ? (
          <span className="inline-flex flex-wrap items-center gap-2 text-fg-muted">
            <span className="num">{`At entry ${formatRate(line.fxRatePkr)} · ${formatDay(line.fxRateOn)}`}</span>
            <StatusBadge dimension="fx" value={fxStaleness(age ?? 0)} detail={`${age ?? 0} d`} />
          </span>
        ) : (
          <StatusBadge dimension="fx-capture" value="none" />
        )}
      </p>
      {where ? <p className="text-fg-muted">{where}</p> : null}
    </div>
  )
}

/** The "..." on a price row (C-33): Edit reply, Copy price, Remove reply. */
function RowMenu({ rfqId, entry, item }: { rfqId: string; entry: Entry; item: RfqItemRow }) {
  const { toast } = useToast()
  const remove = useRemoveQuoteLine(rfqId)
  const restore = useRestoreQuoteLine(rfqId)
  const { line, inquiry } = entry
  const price = `${line.currency} ${formatAmount(line.unitPrice, 'always')}`
  const doRemove = async () => {
    try {
      await remove.mutateAsync({ inquiryId: inquiry.id, itemId: item.id })
      toast({
        title: 'Reply removed',
        body: `${inquiry.supplierName} · item ${item.number} · ${price}`,
        undo: {
          onUndo: async () => {
            await restore.mutateAsync(line)
          },
          settledTitle: 'Reply removed',
          undoneTitle: 'Reply put back',
        },
      })
    } catch (err) {
      toast({ title: 'Could not remove the reply', body: mapPgError(err, { entity: 'reply' }).message, tone: 'danger' })
    }
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="quiet" size="sm" icon={Ellipsis} aria-label={`More for ${inquiry.supplierName}`} />
      </PopoverTrigger>
      <PopoverContent variant="menu" align="end" aria-label={`More for ${inquiry.supplierName}`}>
        <MenuItem icon={Pencil} onClick={() => focusReplyInput(inquiry.id, item.id)}>
          Edit reply
        </MenuItem>
        <MenuItem
          icon={Copy}
          onClick={() =>
            void copyToClipboard(price).then(ok => toast(ok ? { title: 'Price copied', body: price, tone: 'success' } : { title: 'Could not copy the price', tone: 'danger' }))
          }
        >
          Copy price
        </MenuItem>
        <MenuSeparator />
        <MenuItem icon={Trash2} danger onClick={() => void doRemove()}>
          Remove reply
        </MenuItem>
      </PopoverContent>
    </Popover>
  )
}

/** A supplier asked about this item who has not answered it: one line, "Waiting on X · asked ...", and a Can't quote menu (C-37). */
function WaitingRow({ rfqId, inquiry, item }: { rfqId: string; inquiry: InquiryRow; item: RfqItemRow }) {
  const { toast } = useToast()
  const decline = useSetItemDecline(rfqId)
  const chase = inquiry.lastChasedOn ? `, chased ${formatDay(inquiry.lastChasedOn)}` : ''
  const record = async (reason: string) => {
    try {
      await decline.mutateAsync({ inquiryId: inquiry.id, itemId: item.id, reason })
      toast({
        title: "Marked can't quote",
        body: `${inquiry.supplierName} · item ${item.number} · ${reasonLabel(reason)}`,
        undo: {
          onUndo: async () => {
            await decline.mutateAsync({ inquiryId: inquiry.id, itemId: item.id, reason: null })
          },
          settledTitle: "Marked can't quote",
          undoneTitle: "Can't quote taken back",
        },
      })
    } catch (err) {
      toast({ title: "Could not mark can't quote", body: mapPgError(err, { entity: 'reply' }).message, tone: 'danger' })
    }
  }
  return (
    <li className="flex items-center gap-x-4 border-t bg-sunken px-5 py-2 text-sm" data-waiting={inquiry.supplierId}>
      <span className="flex min-w-0 flex-1 items-center gap-2 text-fg-2">
        <Icon icon={Clock} className="shrink-0 text-fg-muted" />
        <span className="min-w-0 [overflow-wrap:anywhere]">
          Waiting on <b className="font-semibold text-fg">{inquiry.supplierName}</b>
          <span className="text-fg-muted">{` · asked ${formatDay(inquiry.sentOn as string)}${chase}`}</span>
        </span>
      </span>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" aria-label={`Can't quote, ${inquiry.supplierName}, item ${item.number}`}>
            {"Can't quote"}
            <Icon icon={ChevronDown} size="sm" />
          </Button>
        </PopoverTrigger>
        <PopoverContent variant="menu" align="end" aria-label="Reason">
          <p role="none" className="px-2 pb-1 pt-1 text-sm text-fg-muted">
            One tap records the reason
          </p>
          {CANT_QUOTE_REASONS.map(r => (
            <MenuItem key={r.key} onClick={() => void record(r.key)}>
              {r.label}
            </MenuItem>
          ))}
        </PopoverContent>
      </Popover>
    </li>
  )
}

function Dot({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="size-[3px] rounded-round bg-fg-muted" />
      {children}
    </span>
  )
}

/** The panel's one explanation of how the order is decided (was a note above every item). */
function HowCompared() {
  return (
    <InfoTip label="How are prices compared?">
      <p>Every price is turned into PKR at today&apos;s rate, and the list for each item starts with the best.</p>
      <p className="mt-2">
        The cheapest is recommended, unless other suppliers are within 2% of it. Among those, the better delivery record wins; if the records
        are the same, the supplier we have ordered from more often; then the one we ordered from most recently; then the lower price.
      </p>
      <p className="mt-2">A price with no current rate is shown but not compared. Add the rate in Exchange rates and the list sorts itself.</p>
    </InfoTip>
  )
}

export function ItemsPanel({
  rfq,
  items,
  inquiries,
  rates,
  fxRows,
  memory,
  suggestions,
  ranking,
  onAddItem,
  onCopyEnquiry,
}: {
  rfq: RfqHeader
  items: RfqItemRow[]
  inquiries: InquiryRow[]
  rates: RateTable
  fxRows: readonly FxLatestRow[]
  /** supplier_item_memory() rows by item id (R17). Absent while loading or if the read failed: the chips are then left out. */
  memory?: Readonly<Record<string, readonly MemoryRow[] | undefined>>
  /** Suppliers worth asking that have not been asked yet (R03). Absent while loading: the uncovered block then has no list. */
  suggestions?: readonly SupplierSuggestion[]
  /** rank_item_quotes() rows by quote line id (R25). Absent while loading or if the read failed: the plain comparison is shown. */
  ranking?: ReadonlyMap<string, RankRow>
  onAddItem: () => void
  onCopyEnquiry: (supplier: SupplierSuggestion, item: RfqItemRow) => void
}) {
  const today = businessToday()
  // Every price (supplier, selling, spread) is for admin and sales only (owner decision 2026-10-22); an engineer's lines carry none.
  const prices = useSeesPrices()
  const showSell = prices
  const [opened, setOpened] = useState<Readonly<Record<string, boolean>>>({})
  const responders = inquiries.filter(i => i.lines.length > 0)
  // Asked at all: sent, or answered "cannot quote" (a supplier only on the shortlist is not asked yet).
  const askedCount = inquiries.filter(i => i.sentOn || i.noOfferOn).length
  const pricedItems = items.filter(it => inquiries.some(i => i.lines.some(l => l.itemId === it.id))).length
  const rateBar = prices
    ? buildRateBar(
        fxRows,
        inquiries.flatMap(i => i.lines.map(l => l.currency)),
      )
    : []
  const nobodyAsked = inquiries.length === 0
  return (
    <DetailPanel
      title={prices ? 'Items and supplier prices' : 'Items and supplier replies'}
      tip={!nobodyAsked && prices ? <HowCompared /> : null}
      dataSlot="items"
      meta={
        <>
          {items.length} {items.length === 1 ? 'item' : 'items'} ·{' '}
          {nobodyAsked ? 'nobody asked yet' : `${inquiries.length} ${inquiries.length === 1 ? 'supplier' : 'suppliers'} asked · ${pricedItems} ${pricedItems === 1 ? 'item has' : 'items have'} ${prices ? 'a price' : 'a reply'}`}
        </>
      }
      actions={
        <Button icon={Plus} onClick={onAddItem}>
          Add item
        </Button>
      }
    >
      {!nobodyAsked && rateBar.length > 0 ? <RateBar entries={rateBar} /> : null}
      {nobodyAsked && items.length > 0 ? (
        <p className="border-b px-5 py-4 text-fg-2">
          <b className="font-semibold text-fg">Ask suppliers for prices.</b> One tap copies a message listing every item, ready to paste into WhatsApp or email.
        </p>
      ) : null}
      {items.length === 0 ? (
        <p className="px-5 py-6 text-fg-muted">This RFQ has no items yet. Add the first one to start asking for prices.</p>
      ) : (
        <div className="divide-y">
          {items.map(item => {
            const entries: Entry[] = []
            const lines = inquiries.flatMap(i => i.lines.filter(l => l.itemId === item.id).map(l => ({ l, i })))
            const cmp = comparePrices(
              lines.map(({ l }) => ({ id: l.id, amount: l.unitPrice, currency: l.currency })),
              rates,
            )
            for (const { l, i } of lines) entries.push({ line: l, inquiry: i, c: cmp.lines.find(x => x.id === l.id) as ComparedLine })
            // The database's ranking (R25) when it has every line of this item; else the plain order: cheapest first among the compared, then the lines left out.
            const rankOf = (l: QuoteLineRow) => ranking?.get(l.id)
            const ranked = prices && lines.length >= 2 && lines.every(({ l }) => rankOf(l) !== undefined)
            if (!prices) {
              entries.sort((a, b) => a.inquiry.supplierName.localeCompare(b.inquiry.supplierName))
            } else if (ranked) {
              entries.sort((a, b) => {
                const ra = rankOf(a.line) as RankRow
                const rb = rankOf(b.line) as RankRow
                if ((ra.rank === null) !== (rb.rank === null)) return ra.rank === null ? 1 : -1
                if (ra.rank !== null && rb.rank !== null && ra.rank !== rb.rank) return ra.rank - rb.rank
                return a.inquiry.supplierName.localeCompare(b.inquiry.supplierName)
              })
            } else {
              entries.sort((a, b) => {
                if (a.c.compared !== b.c.compared) return a.c.compared ? -1 : 1
                if (a.c.pkrPaisa !== null && b.c.pkrPaisa !== null) return a.c.pkrPaisa < b.c.pkrPaisa ? -1 : a.c.pkrPaisa > b.c.pkrPaisa ? 1 : 0
                return a.line.unitPrice - b.line.unitPrice
              })
            }
            const itemRanks = ranked ? entries.map(e => rankOf(e.line) as RankRow) : []
            const bandSize = bandSizeOf(itemRanks)
            const rankedCount = itemRanks.filter(r => r.rank !== null).length
            // One mark per item: the database's rank 1 when two or more lines are ranked; else the plain lowest of two or more.
            const markOf = (e: Entry): 'recommended' | 'lowest' | null => {
              if (ranked) return rankedCount >= 2 && rankOf(e.line)?.rank === 1 ? 'recommended' : null
              return prices && e.c.lowest ? 'lowest' : null
            }
            const recommended = ranked && rankedCount >= 2 ? entries.find(e => rankOf(e.line)?.rank === 1) : undefined
            const cheapest = prices ? entries.find(e => e.c.lowest) : undefined
            const cheaperElsewhere = recommended && cheapest && cheapest.line.id !== recommended.line.id ? cheapest : undefined
            const sell = ranked ? sellNote(itemRanks, showSell) : null
            const declined = inquiries
              .filter(i => !i.lines.some(l => l.itemId === item.id))
              .map(i => ({ i, reason: reasonForItem(item.id, i) }))
              .filter(d => d.reason)
            // Still waiting: asked, nothing back from them at all, and not declined for this item. A supplier who answered other items
            // and left this one is not waiting on it (the chase card still asks for it).
            const waiting = inquiries.filter(i => i.sentOn && !i.noOfferOn && i.lines.length === 0 && !i.itemDeclines[item.id])
            const cov = itemCoverage(lines.length, waiting.length, responders.length, askedCount)
            const q = qtyText(item.qty, item.unit)
            const forThis = (suggestions ?? []).filter(s => s.coversItemIds.includes(item.id)).slice(0, 3)
            return (
              <article key={item.id} aria-label={`Item ${item.number}`} className="min-w-0">
                <header className="flex flex-wrap items-start gap-x-3 gap-y-2 px-5 pt-4">
                  <span className="num mt-[2px] grid h-6 min-w-6 place-items-center rounded border border-line-strong px-1 text-sm">{item.number}</span>
                  <div className="min-w-0 flex-1 basis-[16rem]">
                    <h3 className="text-base font-medium text-pretty">{item.description}</h3>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
                      {q ? <span className="num">{q}</span> : null}
                      {item.brandName ? <Dot>{item.brandName}</Dot> : null}
                      {item.familyName ? <Dot>{item.familyName}</Dot> : null}
                      {!item.brandName && !item.familyName ? <Dot>No brand given</Dot> : null}
                      {sell ? (
                        <span data-sell-note={sell.kind} className="inline-flex items-center gap-2">
                          <span aria-hidden="true" className="size-[3px] rounded-round bg-fg-muted" />
                          {sell.kind === 'none' ? (
                            sell.text
                          ) : (
                            <span>
                              Our price <span className="num font-medium text-fg-2">{sell.amount}</span> {sell.text}
                            </span>
                          )}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <StatusBadge
                    dimension={cov.kind === 'none' ? 'inquiry' : 'sourcing'}
                    value={cov.kind === 'covered' ? 'covered' : cov.kind === 'partly' ? 'partly-covered' : cov.kind === 'uncovered' ? 'no-offer' : cov.kind === 'unasked' ? 'not-floated' : 'awaiting'}
                    label={cov.label}
                  />
                </header>

                {cov.kind === 'uncovered' ? (
                  <div className="mt-3 grid gap-0 px-5">
                    <div role="status" className="flex items-start gap-3 rounded-t border border-tone-danger-fg/25 bg-tone-danger-bg px-4 py-3">
                      <Icon icon={TriangleAlert} className="mt-[2px] text-tone-danger-fg" />
                      <p className="text-fg-2">
                        <b className="font-semibold text-fg">
                          {responders.length > 0
                            ? `None of the ${responders.length} ${responders.length === 1 ? 'supplier' : 'suppliers'} who replied quoted this item.`
                            : 'Every supplier asked said they cannot quote it.'}
                        </b>{' '}
                        {waiting.length > 0 ? `${waiting.map(w => w.supplierName).join(', ')} ${waiting.length === 1 ? 'has' : 'have'} not replied yet. ` : ''}
                        Ask someone else before the quotation is due.
                      </p>
                    </div>
                    {forThis.length > 0 ? (
                      <ul className="rounded-b border border-t-0 bg-surface">
                        {forThis.map(s => (
                          <li key={s.supplierId} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3 first:border-t-0">
                            <span className="min-w-0 flex-1 basis-[14rem]">
                              <b className="block font-semibold">{s.name}</b>
                              <span className="text-sm text-fg-muted">{s.reason}</span>
                            </span>
                            <Button size="sm" icon={Copy} onClick={() => onCopyEnquiry(s, item)} aria-label={`Copy message for ${s.name}`}>
                              Copy message
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                {nobodyAsked ? (
                  <p className="px-5 pb-4 pt-3 text-fg-muted">No supplier has been asked about this item.</p>
                ) : entries.length > 0 || declined.length > 0 || waiting.length > 0 ? (
                  <div className="mt-3">
                    {entries.length > 0 && prices ? (
                      <div className={HEAD} aria-hidden="true">
                        <span>Supplier</span>
                        <span className="text-right">Price, PKR today</span>
                        <span>Lead time</span>
                        <span>Stock</span>
                        <span />
                      </div>
                    ) : entries.length > 0 ? (
                      <div className={HEAD_NO_PRICES} aria-hidden="true">
                        <span>Supplier</span>
                        <span>Lead time</span>
                        <span>Stock</span>
                      </div>
                    ) : null}
                    <ul>
                      {entries.map(entry => {
                        const { line, inquiry, c } = entry
                        const memRow = memory?.[item.id]?.find(r => r.supplier_id === inquiry.supplierId)
                        const chip = lastPriceChip(memRow, today)
                        const rk = ranked ? (rankOf(line) as RankRow) : null
                        const reasons = rk ? reasonsFor(rk, { showSell, bandSize, evidence: evidenceOf(memRow), names: { brand: item.brandName, family: item.familyName } }) : null
                        const open = opened[line.id] ?? false
                        const mark = markOf(entry)
                        const detailId = `price-detail-${line.id}`
                        return (
                          <li
                            key={line.id}
                            className={cn(prices ? ROW : ROW_NO_PRICES, rk && rk.rank === null && 'bg-canvas')}
                            data-lowest={prices && c.lowest ? '' : undefined}
                            data-recommended={mark === 'recommended' ? '' : undefined}
                            data-compared={prices && c.compared && c.pkrPaisa !== null ? '' : undefined}
                            data-ranked={rk ? (rk.rank ?? 'none') : undefined}
                          >
                            {/* The mark sits with the name (no column of its own), so the name keeps its width at 16px text. */}
                            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                              <span className="min-w-0 break-words font-medium">{inquiry.supplierName}</span>
                              {mark ? (
                                <span className="inline-flex min-h-6 shrink-0 items-center gap-1 whitespace-nowrap rounded border border-tone-success-fg/25 bg-tone-success-bg px-2 text-sm font-medium text-tone-success-fg">
                                  <Icon icon={ThumbsUp} size="chip" />
                                  {mark === 'recommended' ? 'Recommended' : 'Lowest price'}
                                </span>
                              ) : null}
                            </span>
                            {prices ? (
                              <span className="text-right max-md:col-span-2">
                                <PriceCell line={line} c={c} />
                              </span>
                            ) : null}
                            <span className="min-w-0 text-fg-2">
                              <span className="sr-only">Lead time: </span>
                              {line.leadTime ?? <span className="text-fg-muted">—</span>}
                            </span>
                            <span className="flex items-center gap-2 text-fg-2">
                              {line.inStock === null ? (
                                <span className="text-fg-muted">
                                  <span className="sr-only">Stock: </span>—
                                </span>
                              ) : (
                                <>
                                  <i aria-hidden="true" className={`size-[6px] rounded-round ${line.inStock ? 'bg-tone-success-fg' : 'border border-fg-muted'}`} />
                                  {line.inStock ? 'In stock' : 'Not in stock'}
                                </>
                              )}
                            </span>
                            {prices ? (
                              <span className="flex justify-end">
                                <Button
                                  variant="quiet"
                                  size="sm"
                                  aria-expanded={open}
                                  aria-controls={open ? detailId : undefined}
                                  aria-label={`${open ? 'Hide' : 'Show'} details for ${inquiry.supplierName}`}
                                  onClick={() => setOpened(o => ({ ...o, [line.id]: !open }))}
                                  icon={ChevronDown}
                                  className={cn('[&_svg]:transition-transform', open && '[&_svg]:rotate-180')}
                                />
                                <RowMenu rfqId={rfq.id} entry={entry} item={item} />
                              </span>
                            ) : null}
                            {open && prices ? (
                              <div id={detailId} className="col-span-full grid gap-2 pb-1 md:col-start-2">
                                <PriceDetail line={line} inquiry={inquiry} c={c} rates={rates} />
                                {chip ? <LastPriceChipView chip={chip} /> : null}
                                {rk && reasons ? <ReasonBlock set={reasons} supplier={inquiry.supplierName} unrankedCurrency={rk.rank === null ? line.currency : null} /> : null}
                              </div>
                            ) : null}
                          </li>
                        )
                      })}
                      {cheaperElsewhere && recommended ? (
                        <li className="flex items-start gap-2 border-t px-5 py-2 text-sm text-fg-2" data-cheapest>
                          <span>
                            Cheapest: <b className="font-semibold text-fg">{cheaperElsewhere.inquiry.supplierName}</b>
                            {(() => {
                              const rec = rankOf(recommended.line)
                              const low = rankOf(cheaperElsewhere.line)
                              return rec && low ? `. ${recommended.inquiry.supplierName} ${whyNotCheapest(rec, low)}.` : '.'
                            })()}
                          </span>
                        </li>
                      ) : null}
                      {declined.map(({ i, reason }) => (
                        <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-5 py-2 text-fg-muted" data-declined={i.supplierId}>
                          <span className="min-w-0 break-words font-medium text-fg-2">{i.supplierName}</span>
                          <span className="inline-flex h-6 items-center gap-[5px] rounded border border-line-strong bg-surface px-2 text-sm font-medium text-fg-2">
                            <Icon icon={Ban} size="chip" />
                            {"Can't quote"}
                          </span>
                          <span className="text-sm">{reasonLabel(reason)}</span>
                          {i.noOfferOn && !i.itemDeclines[item.id] ? <span className="num text-sm">{`· ${formatDay(i.noOfferOn)}`}</span> : null}
                        </li>
                      ))}
                      {waiting.map(w => (
                        <WaitingRow key={w.id} rfqId={rfq.id} inquiry={w} item={item} />
                      ))}
                    </ul>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </DetailPanel>
  )
}
