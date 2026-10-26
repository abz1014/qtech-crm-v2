import { Fragment, useState } from 'react'
import { ChevronDown, Clock, Copy, Ellipsis, Pencil, Plus, ThumbsUp, Trash2, TriangleAlert } from 'lucide-react'
import { useSeesPrices } from '@/app/session'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { businessToday } from '@/lib/dates'
import { copyToClipboard } from '@/lib/clipboard'
import { formatDay } from '@/lib/formatDay'
import { formatAmount, formatPaisa, formatRate, fxStaleness } from '@/lib/money'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { StatusBadge } from '@/ui/StatusBadge'
import { StatusText } from '@/ui/StatusText'
import { agoDays, days } from '@/lib/timeWords'
import { useToast } from '@/ui/useToast'
import { LastPriceChipView } from '@/features/rfqs/LastPriceChip'
import { DetailPanel } from '@/features/rfqs/DetailPanel'
import { ItemMenu } from '@/features/rfqs/ItemEdit'
import { CategoryChip } from '@/features/rfqs/CategoryChip'
import { RateBar } from '@/features/rfqs/RateBar'
import { InfoTip } from '@/ui/InfoTip'
import { focusReplyInput } from '@/features/rfqs/replyFocus'
import { buildRateBar } from '@/features/fx/ratesModel'
import { ReasonBlock } from '@/features/rfqs/ranking/RankParts'
import { bandSizeOf, evidenceOf, reasonsFor, sellNote, whyNotCheapest, type RankRow } from '@/features/rfqs/lib/ranking/reasons'
import { lastPriceChip, type MemoryRow } from '@/lib/memory'
import type { FxLatestRow, InquiryRow, QuoteLineRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { useRemoveQuoteLine, useRestoreQuoteLine } from '@/features/rfqs/hooks'
import { cheapestFirst, comparePrices, itemCoverage, qtyText, reasonForItem, reasonLabel, type ComparedLine, type RateTable, type SupplierSuggestion } from '@/features/rfqs/lib'

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
 * Entering replies lives once per supplier in Suppliers asked (SuppliersAsked.tsx opens SupplierReplies.tsx).
 *
 * Fewer actions on show (grade-A 9 fix 3): a price line has ONE control, its chevron; its "..." menu (Edit reply, Copy price,
 * Remove reply) shows once the line is open. Phone (grade-A 6 fix 2): the items are an accordion. An item with prices (or a
 * can't quote) is its header line until tapped, one open at a time, the first such item open to start; an item only waiting is
 * its header and chip, the "Waiting on" line left to Suppliers asked.
 *
 * An engineer (owner decision 2026-10-22: no prices anywhere) gets the same items with who replied, lead time and stock only: no
 * price column, no own-currency figure, no rate bar, no marks or Cheapest tag/line, no price details, no chevron and no row menu
 * (Edit reply and Copy price are price work). The lines come without prices (listInquiries), so they are listed by supplier name.
 */

const daysBetween = (from: string, to: string) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000)

// Every row is its own grid, so the tracks are fixed to line up; sized for 16px text ("≈ PKR 1,234,567", "Not in stock").
const COLS = 'md:grid-cols-[minmax(0,1fr)_184px_minmax(0,136px)_128px_72px]'
const HEAD = `hidden items-end gap-x-4 px-5 py-2 text-sm text-fg-muted md:grid ${COLS}`
/**
 * Phone (UX audit C3): two lines per supplier. The name (and its mark) across the row with the two buttons at its end; then
 * price · lead time · stock on one wrapping line. On desktop the second line's wrapper dissolves (md:contents) into the columns.
 */
const ROW = `relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t px-5 py-3 md:gap-x-4 ${COLS}`
/** An engineer's row: the supplier, then lead time · stock (no price, no buttons). */
const COLS_NO_PRICES = 'md:grid-cols-[minmax(0,1fr)_minmax(0,136px)_128px]'
const HEAD_NO_PRICES = `hidden items-end gap-x-4 px-5 py-2 text-sm text-fg-muted md:grid ${COLS_NO_PRICES}`
const ROW_NO_PRICES = `relative grid grid-cols-[minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-t px-5 py-3 md:gap-x-4 ${COLS_NO_PRICES}`

interface Entry {
  line: QuoteLineRow
  inquiry: InquiryRow
  c: ComparedLine
}

/** The "Cheapest" tag beside a price, when the Recommended supplier is someone else (UX audit C1). */
function CheapestTag() {
  return (
    <span className="whitespace-nowrap rounded border border-line-strong px-1 font-sans text-sm font-medium text-fg-2" data-cheapest-tag>
      Cheapest
    </span>
  )
}

/**
 * The price people compare: PKR at today's rate when there is a usable rate, with the supplier's own figure in grey under it
 * (UX audit C2); else the supplier's own figure, marked not compared. Desktop: right-aligned, one figure per line. Phone: left-aligned.
 */
function PriceCell({ line, c, cheapest }: { line: QuoteLineRow; c: ComparedLine; cheapest: boolean }) {
  if (line.currency === 'PKR' || c.pkrPaisa !== null) {
    return (
      <span className="inline-grid justify-items-start gap-x-2 md:grid md:justify-items-end">
        <span className="flex flex-wrap items-center gap-x-2 md:justify-end">
          {cheapest ? <CheapestTag /> : null}
          <span className="num whitespace-nowrap text-base font-medium">
            {/* A real space, not a margin: a screen reader reads "≈ PKR 33,600", not "PKR33,600". */}
            <span className="font-sans text-sm font-regular text-fg-muted">{line.currency === 'PKR' ? 'PKR' : '≈ PKR'}</span>{' '}
            {line.currency === 'PKR' ? formatAmount(line.unitPrice, 'auto') : formatPaisa(c.pkrPaisa as bigint, 'auto')}
          </span>
        </span>
        {line.currency === 'PKR' ? null : (
          <span className="num whitespace-nowrap text-sm text-fg-muted" data-own-price>
            {`${line.currency} ${formatAmount(line.unitPrice, 'auto')}`}
          </span>
        )}
      </span>
    )
  }
  return (
    <span className="inline-grid justify-items-start md:grid md:justify-items-end">
      <span className="flex flex-wrap items-center gap-x-2 md:justify-end">
        {cheapest ? <CheapestTag /> : null}
        <span className="num whitespace-nowrap text-base font-medium">
          <span className="font-sans text-sm font-regular text-fg-muted">{line.currency}</span>{' '}
          {formatAmount(line.unitPrice, 'always')}
        </span>
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
        {/* The rate captured at entry: a chip only when it is a problem (Old rate, No rate); a fresh one is its age in words. */}
        {line.currency === 'PKR' ? null : line.fxRatePkr !== null && line.fxRateOn ? (
          <span className="inline-flex flex-wrap items-center gap-2 text-fg-muted">
            <span className="num">{`At entry ${formatRate(line.fxRatePkr)} · ${formatDay(line.fxRateOn)}`}</span>
            {fxStaleness(age ?? 0) === 'fresh' ? (
              <span data-rate-age>{`Rate from ${(age ?? 0) === 0 ? 'today' : agoDays(age ?? 0).toLowerCase()}`}</span>
            ) : (
              <StatusBadge dimension="fx" value={fxStaleness(age ?? 0)} detail={days(age ?? 0)} />
            )}
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

/**
 * The suppliers asked about this item who have not answered yet, as ONE line (grade-B R1): "Waiting on Midlands Valves Ltd", or
 * "Waiting on 3 suppliers" with the names in the title. Who they are, the chase and "Can't quote" live once per supplier in
 * Suppliers asked (SuppliersAsked.tsx), not on every item.
 */
function WaitingLine({ waiting }: { waiting: readonly InquiryRow[] }) {
  const names = waiting.map(w => w.supplierName)
  return (
    <li className="flex items-center gap-2 border-t bg-sunken px-5 py-2 text-fg-2" data-waiting={waiting.map(w => w.supplierId).join(' ')} title={names.join(', ')}>
      <Icon icon={Clock} className="shrink-0 text-fg-muted" />
      <span className="min-w-0 [overflow-wrap:anywhere]">
        Waiting on {waiting.length === 1 ? <b className="font-semibold text-fg">{names[0]}</b> : `${waiting.length} suppliers`}
      </span>
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
  const phone = useMediaQuery('(max-width: 767px)')
  // Phone: the one item open (undefined: the first item with something to show; null: all closed by the person).
  const [openItem, setOpenItem] = useState<string | null | undefined>(undefined)
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
  // Something under the header besides the waiting line: a price or a can't quote.
  const hasBody = (itemId: string) => inquiries.some(i => i.lines.some(l => l.itemId === itemId) || Boolean(reasonForItem(itemId, i)))
  const shownItem = openItem === undefined ? items.find(it => hasBody(it.id))?.id : openItem
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
            // The database's ranking (R25) when it has every line of this item. The rows are always cheapest first (UX audit C1): the
            // Recommended mark stays where the ranking put it, wherever that row lands; lines left out of the comparison come last.
            const rankOf = (l: QuoteLineRow) => ranking?.get(l.id)
            const ranked = prices && lines.length >= 2 && lines.every(({ l }) => rankOf(l) !== undefined)
            // An engineer's lines carry no price: listed by supplier name.
            if (!prices) entries.sort((a, b) => a.inquiry.supplierName.localeCompare(b.inquiry.supplierName))
            else
              entries.sort((a, b) =>
                cheapestFirst({ c: a.c, amount: a.line.unitPrice }, { c: b.c, amount: b.line.unitPrice }, () => {
                  const ra = rankOf(a.line)?.rank ?? null
                  const rb = rankOf(b.line)?.rank ?? null
                  if (ra !== rb) return ra === null ? 1 : rb === null ? -1 : ra - rb
                  return a.inquiry.supplierName.localeCompare(b.inquiry.supplierName)
                }),
              )
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
            // Phone accordion: an item with prices, a can't quote or the warning folds to its header; one open at a time.
            const foldable = phone && !nobodyAsked && (entries.length > 0 || declined.length > 0 || cov.kind === 'uncovered')
            const folded = foldable && shownItem !== item.id
            const bodyId = `item-body-${item.id}`
            return (
              <article key={item.id} aria-label={`Item ${item.number}`} className="min-w-0" data-folded={folded ? '' : undefined}>
                <header className={cn('relative flex flex-wrap items-start gap-x-3 gap-y-2 px-5 pt-4', folded && 'pb-4', phone && !foldable && !nobodyAsked && 'pb-4')}>
                  <span className="num mt-[2px] grid h-6 min-w-6 place-items-center rounded border border-line-strong px-1 text-sm">{item.number}</span>
                  <div className="min-w-0 flex-1 basis-[16rem]">
                    <h3 className="text-base font-medium text-pretty">
                      {foldable ? (
                        // The whole header is the tap target (the button's box stretches over it); the name is its label.
                        <button
                          type="button"
                          aria-expanded={!folded}
                          aria-controls={folded ? undefined : bodyId}
                          onClick={() => setOpenItem(folded ? item.id : null)}
                          className="text-left after:absolute after:inset-0 after:content-['']"
                        >
                          {item.description}
                        </button>
                      ) : (
                        item.description
                      )}
                    </h3>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
                      {q ? <span className="num">{q}</span> : null}
                      {item.brandName ? <Dot>{item.brandName}</Dot> : null}
                      <Dot>
                        <CategoryChip rfqId={rfq.id} item={item} />
                      </Dot>
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
                  {cov.value ? <StatusBadge dimension="item-price" value={cov.value} detail={cov.detail} /> : null}
                  {foldable ? <Icon icon={ChevronDown} className={cn('mt-[2px] shrink-0 text-fg-muted transition-transform', !folded && 'rotate-180')} /> : null}
                  {/* Above the phone header's whole-width tap target (z-10), so the menu is its own button. */}
                  <span className="relative z-10 -my-2 shrink-0">
                    <ItemMenu rfq={rfq} item={item} />
                  </span>
                </header>

                {folded ? null : (
                  <div id={bodyId}>
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
                    ) : entries.length > 0 || declined.length > 0 || (waiting.length > 0 && !phone) ? (
                      <div className="mt-3">
                        {entries.length > 0 && prices ? (
                          <div className={HEAD} aria-hidden="true">
                            <span>Supplier</span>
                            <span className="text-right">Price, PKR today (≈ = converted)</span>
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
                            const isCheapestTag = cheaperElsewhere?.line.id === line.id
                            return (
                              <Fragment key={line.id}>
                                <li
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
                                      <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-sm font-medium text-tone-success-fg">
                                        <Icon icon={ThumbsUp} size="chip" />
                                        {mark === 'recommended' ? 'Recommended' : 'Lowest price'}
                                      </span>
                                    ) : null}
                                  </span>
                                  {/* Phone: price · lead time · stock on the second line (an engineer: lead time · stock). Desktop: the wrapper dissolves into the columns. */}
                                  <span className="col-span-full flex flex-wrap items-start gap-x-2 gap-y-1 md:contents">
                                    {prices ? (
                                      <>
                                        <span className="md:text-right">
                                          <PriceCell line={line} c={c} cheapest={isCheapestTag} />
                                        </span>
                                        <span aria-hidden="true" className={cn('text-fg-muted md:hidden', !line.leadTime && 'hidden')}>
                                          ·
                                        </span>
                                      </>
                                    ) : null}
                                    <span className={cn('min-w-0 text-fg-2', !line.leadTime && 'max-md:hidden')}>
                                      <span className="sr-only">Lead time: </span>
                                      {line.leadTime ?? <span className="text-fg-muted">—</span>}
                                    </span>
                                    <span aria-hidden="true" className={cn('text-fg-muted md:hidden', (line.inStock === null || (!prices && !line.leadTime)) && 'hidden')}>
                                      ·
                                    </span>
                                    <span className={cn('flex items-center gap-2 text-fg-2', line.inStock === null && 'max-md:hidden')}>
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
                                  </span>
                                  {prices ? (
                                    <span className="flex justify-end max-md:col-start-2 max-md:row-start-1 max-md:self-start">
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
                                      {/* The menu waits behind the chevron: one control per price line until it is opened. */}
                                      {open ? <RowMenu rfqId={rfq.id} entry={entry} item={item} /> : null}
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
                                {/* Why the Recommended supplier is not the cheapest, directly under the Recommended row (UX audit C1). */}
                                {prices && cheaperElsewhere && recommended?.line.id === line.id ? (
                                  <li className="px-5 pb-3 text-fg-2" data-cheapest>
                                    Cheapest: <b className="font-semibold text-fg">{cheaperElsewhere.inquiry.supplierName}</b>
                                    {(() => {
                                      const rec = rankOf(recommended.line)
                                      const low = rankOf(cheaperElsewhere.line)
                                      return rec && low ? `. ${recommended.inquiry.supplierName} ${whyNotCheapest(rec, low)}.` : '.'
                                    })()}
                                  </li>
                                ) : null}
                              </Fragment>
                            )
                          })}
                          {declined.map(({ i, reason }) => (
                            <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t px-5 py-2 text-fg-muted" data-declined={i.supplierId}>
                              <span className="min-w-0 break-words font-medium text-fg-2">{i.supplierName}</span>
                              <StatusText dimension="inquiry" value="no-offer" />
                              <span className="text-sm">{reasonLabel(reason)}</span>
                              {i.noOfferOn && !i.itemDeclines[item.id] ? <span className="num text-sm">{`· ${formatDay(i.noOfferOn)}`}</span> : null}
                            </li>
                          ))}
                          {/* Phone: the chip says it is waiting and Suppliers asked says on whom; the line stays on desktop. */}
                          {waiting.length > 0 && !(phone && entries.length === 0 && declined.length === 0) ? <WaitingLine waiting={waiting} /> : null}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}
    </DetailPanel>
  )
}
