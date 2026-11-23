import { Fragment, useState } from 'react'
import { ChevronDown, Clock, Copy, Ellipsis, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'
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
import { ToggleButton } from '@/ui/ToggleButton'
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
import { lastPriceChip, type MemoryRow } from '@/lib/memory'
import type { FxLatestRow, InquiryRow, QuoteLineRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { useRemoveQuoteLine, useRestoreQuoteLine } from '@/features/rfqs/hooks'
import { comparePrices, type ComparedLine, type RateTable } from '@/features/rfqs/lib/comparePrices'
import { itemCoverage } from '@/features/rfqs/lib/detailView'
import { qtyText } from '@/features/rfqs/lib/enquiryDraft'
import { reasonForItem, reasonLabel } from '@/features/rfqs/lib/cantQuote'
import { askedAbout } from '@/features/rfqs/lib/askedItems'
import type { SupplierSuggestion } from '@/features/rfqs/lib/supplierSuggestion'

/*
 * Items and supplier prices (g2-rfq-detail "Items and supplier replies", R07; the supplier comparison of R25; reworked by the UX
 * audit of 2026-10-19). One panel: its header with the counts, Add item and one tip that says how prices are compared; the rate
 * bar; then every item with what each supplier quoted for it, in supplier-name order.
 *
 * Each price is ONE line: the supplier, the price in the currency it was quoted in, the lead time and the stock. Nothing is
 * converted to PKR until the person asks (owner, 16 Nov 2026): "Show in PKR" in the panel header (off to start, remembered in this
 * browser) adds the PKR figure at today's rate, the rate bar, and under each line the rate and its age and the rate captured when
 * the price was entered. The last price for the item opens under the line (rows start closed). NO SUPPLIER IS SINGLED OUT (owner decision 2026-10-29): no "Recommended", "Lowest" or
 * "Cheapest" mark, no reasons, no ranking; the suppliers are listed by name. A price with no usable rate is shown and never blocks anything (BUILD_PLAN A3/A4); it is not compared.
 * Entering replies lives once per supplier in Suppliers asked (SuppliersAsked.tsx opens SupplierReplies.tsx).
 *
 * Fewer actions on show (grade-A 9 fix 3): a price line has ONE control, its chevron; its "..." menu (Edit reply, Copy price,
 * Remove reply) shows once the line is open. Phone (grade-A 6 fix 2): the items are an accordion. An item with prices (or a
 * cannot quote) is its header line until tapped, one open at a time, the first such item open to start; an item only waiting is
 * its header and chip, the "Waiting on" line left to Suppliers asked.
 *
 * An engineer (owner decision 2026-10-22: no prices anywhere) gets the same items with who replied, lead time and stock only: no
 * price column, no own-currency figure, no rate bar, no marks or Cheapest tag/line, no price details, no chevron and no row menu
 * (Edit reply and Copy price are price work). The lines come without prices (listInquiries), so they are listed by supplier name.
 */

/** "Show in PKR", remembered per browser. Storage can be missing or blocked (private window): then it is off each visit. */
const SHOW_PKR_KEY = 'qtech.rfq.showPkr'
function useShowPkr(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return window.localStorage.getItem(SHOW_PKR_KEY) === '1'
    } catch {
      return false
    }
  })
  const set = (next: boolean) => {
    setOn(next)
    try {
      if (next) window.localStorage.setItem(SHOW_PKR_KEY, '1')
      else window.localStorage.removeItem(SHOW_PKR_KEY)
    } catch {
      // Not remembered; the choice still holds on this page.
    }
  }
  return [on, set]
}

/** From this many items, a list that is only waiting starts folded. */
const FOLD_FROM = 5

const daysBetween = (from: string, to: string) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000)

// Every row is its own grid, so the tracks are fixed to line up; sized for 16px text ("≈ PKR 1,234,567", "Not in stock").
const COLS = 'lg:grid-cols-[minmax(0,1fr)_10.5rem_minmax(0,7rem)_7rem_4.5rem]'
const HEAD = `hidden items-end gap-x-4 px-0 pb-2 pt-3 text-sm font-semibold text-fg-muted lg:grid ${COLS}`
/**
 * Phone (UX audit C3): two lines per supplier. The name (and its mark) across the row with the two buttons at its end; then
 * price · lead time · stock on one wrapping line. On desktop the second line's wrapper dissolves (lg:contents) into the columns.
 */
const ROW = `relative grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-t px-0 py-3 lg:gap-x-4 ${COLS}`
/** An engineer's row: the supplier, then lead time · stock (no price, no buttons). */
const COLS_NO_PRICES = 'lg:grid-cols-[minmax(0,1fr)_minmax(0,7rem)_7rem]'
const HEAD_NO_PRICES = `hidden items-end gap-x-4 px-0 pb-2 pt-3 text-sm font-semibold text-fg-muted lg:grid ${COLS_NO_PRICES}`
const ROW_NO_PRICES = `relative grid grid-cols-[minmax(0,1fr)] items-center gap-x-3 gap-y-1 border-t px-0 py-3 lg:gap-x-4 ${COLS_NO_PRICES}`

interface Entry {
  line: QuoteLineRow
  inquiry: InquiryRow
  c: ComparedLine
}

function PriceCell({ line, c, showPkr }: { line: QuoteLineRow; c: ComparedLine; showPkr: boolean }) {
  if (!showPkr) {
    // The price as the supplier quoted it: "EUR 1,250.00", "PKR 29,000". No conversion, no "not compared".
    return (
      <span className="whitespace-nowrap num text-base font-bold" data-price>
        <span className="font-sans text-sm font-medium text-fg-muted">{line.currency}</span>{' '}
        {formatAmount(line.unitPrice, line.currency === 'PKR' ? 'auto' : 'always')}
      </span>
    )
  }
  if (line.currency === 'PKR' || c.pkrPaisa !== null) {
    return (
      <span className="inline-grid justify-items-start gap-x-2 lg:grid lg:justify-items-end">
        <span className="flex flex-wrap items-center gap-x-2 lg:justify-end">
          <span className="whitespace-nowrap num text-base font-bold" data-price>
            {/* A real space, not a margin: a screen reader reads "≈ PKR 33,600", not "PKR33,600". */}
            <span className="font-sans text-sm font-medium text-fg-muted">{line.currency === 'PKR' ? 'PKR' : '≈ PKR'}</span>{' '}
            {line.currency === 'PKR' ? formatAmount(line.unitPrice, 'auto') : formatPaisa(c.pkrPaisa as bigint, 'auto')}
          </span>
        </span>
        {line.currency === 'PKR' ? null : (
          <span className="whitespace-nowrap num text-sm text-fg-muted" data-own-price>
            {`${line.currency} ${formatAmount(line.unitPrice, 'auto')}`}
          </span>
        )}
      </span>
    )
  }
  return (
    <span className="inline-grid justify-items-start lg:grid lg:justify-items-end">
      <span className="flex flex-wrap items-center gap-x-2 lg:justify-end">
        <span className="whitespace-nowrap num text-base font-bold" data-price>
          <span className="font-sans text-sm font-medium text-fg-muted">{line.currency}</span>{' '}
          {formatAmount(line.unitPrice, 'always')}
        </span>
      </span>
      <span className="text-sm text-fg-muted">{c.notCompared === 'unusable' ? 'not compared, rate too old' : 'not compared, no rate'}</span>
    </span>
  )
}

/** What opens under a price line: the supplier's own figure and the rate behind the PKR, the rate captured at entry, where they are. */
function PriceDetail({ line, inquiry, c, rates, showPkr }: { line: QuoteLineRow; inquiry: InquiryRow; c: ComparedLine; rates: RateTable; showPkr: boolean }) {
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
        {line.currency === 'PKR' || !showPkr ? null : c.pkrPaisa !== null ? (
          <span className={cn('inline-flex items-center gap-1', c.band === 'stale' ? 'text-tone-warning-fg' : 'text-fg-muted')}>
            {c.band === 'stale' ? <Icon icon={TriangleAlert} size="chip" /> : <Icon icon={Clock} size="chip" />}
            <span className="num">
              {c.band === 'stale'
                ? `${line.currency} ${formatRate(rate?.rate ?? 0)}, rate ${c.rateAgeDays} days old`
                : `${line.currency} ${formatRate(rate?.rate ?? 0)}, ${c.rateAgeDays === 0 ? "today's rate" : `rate from ${c.rateAgeDays} ${c.rateAgeDays === 1 ? 'day' : 'days'} ago`}`}
            </span>
          </span>
        ) : (
          <span className="inline-flex flex-wrap items-center gap-x-3 text-fg-muted">
            {c.notCompared === 'unusable' ? 'not compared — rate too old' : 'not compared — no rate'}
            <Link to="/settings/exchange-rates" className="rounded font-medium underline underline-offset-2 hover:text-fg">
              {`Add ${line.currency} rate`}
            </Link>
          </span>
        )}
        {/* The rate captured at entry: a chip only when it is a problem (Old rate, No rate); a fresh one is its age in words. */}
        {line.currency === 'PKR' || !showPkr ? null : line.fxRatePkr !== null && line.fxRateOn ? (
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
 * Why a supplier cannot quote this item: its own reason, or the whole inquiry's "cannot quote" when they were asked about the item
 * (supplier flow D: a supplier never asked about an item has not said no to it).
 */
function declinedReason(itemId: string, inquiry: InquiryRow): string | null {
  return inquiry.itemDeclines[itemId] ?? (askedAbout(inquiry, itemId) ? reasonForItem(itemId, inquiry) : null)
}

/** The suppliers worth asking about one item, each with "Copy message" (it copies the message for this item and records the ask). */
function AskForItem({ suggestions, item, onCopyEnquiry }: { suggestions: readonly SupplierSuggestion[]; item: RfqItemRow; onCopyEnquiry: (supplier: SupplierSuggestion, item: RfqItemRow) => void }) {
  if (suggestions.length === 0) return null
  return (
    <ul className="rounded-b-control border border-t-0">
      {suggestions.map(s => (
        <li key={s.supplierId} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3 first:border-t-0">
          <span className="min-w-0 flex-1 basis-[14rem] [overflow-wrap:anywhere]">
            <b className="type-row block">{s.name}</b>
            <span className="text-sm text-fg-muted">{s.reason}</span>
          </span>
          <Button size="sm" icon={Copy} onClick={() => onCopyEnquiry(s, item)} aria-label={`Copy message for ${s.name}`}>
            Copy message
          </Button>
        </li>
      ))}
    </ul>
  )
}

/**
 * The suppliers asked about this item who have not answered yet, as ONE line (grade-B R1): "Waiting on Midlands Valves Ltd", or
 * "Waiting on 3 suppliers" with the names in the title. Who they are, the chase and "Cannot quote" live once per supplier in
 * Suppliers asked (SuppliersAsked.tsx), not on every item.
 */
function WaitingLine({ waiting, later = false }: { waiting: readonly InquiryRow[]; later?: boolean }) {
  const names = waiting.map(w => w.supplierName)
  const who = waiting.length === 1 ? <b className="font-semibold text-fg">{names[0]}</b> : `${waiting.length} suppliers`
  return (
    <li
      className="mt-2 flex items-center gap-2 rounded-control bg-deep px-3 py-2 text-fg-2"
      data-waiting={later ? undefined : waiting.map(w => w.supplierId).join(' ')}
      data-quoting-later={later ? waiting.map(w => w.supplierId).join(' ') : undefined}
      title={names.join(', ')}
    >
      <Icon icon={Clock} className="shrink-0 text-fg-muted" />
      {/* 0145: a supplier that priced other items and said "please wait" for this one. */}
      <span className="min-w-0 [overflow-wrap:anywhere]">{later ? <>Quoting later: {who}</> : <>Waiting on {who}</>}</span>
    </li>
  )
}

/** The dot before an item of the meta line: a 16px cell, so the line can be pulled left into a clipped edge (a dot that starts a wrapped line is clipped, never dangling). */
function Bullet() {
  return (
    <span aria-hidden="true" className="flex h-5 w-4 shrink-0 items-center justify-center">
      <span className="size-1 rounded-round bg-fg-muted" />
    </span>
  )
}

function Dot({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center">
      <Bullet />
      {children}
    </span>
  )
}

/** The panel's one explanation of the figures. It says nothing about which supplier is better: the CRM never suggests one. */
function HowCompared({ showPkr }: { showPkr: boolean }) {
  return (
    <InfoTip label="How are prices shown?">
      {showPkr ? (
        <>
          <p>Every price is shown in PKR at today&apos;s rate, with the supplier&apos;s own figure under it. Suppliers are listed by name.</p>
          <p className="mt-2">A price with no current rate is shown as the supplier gave it. Add the rate in Exchange rates to see it in PKR.</p>
        </>
      ) : (
        <p>Every price is shown in the currency the supplier quoted. Suppliers are listed by name. Turn on Show in PKR to see each price in PKR at today&apos;s rate.</p>
      )}
      <p className="mt-2">The comparative statement lays the replies side by side. You choose the supplier, per item, when you create the order.</p>
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
  onAddItem,
  onCopyEnquiry,
  board = false,
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
  onAddItem: () => void
  onCopyEnquiry: (supplier: SupplierSuggestion, item: RfqItemRow) => void
  /**
   * The coverage board shows above (CoverageBoard.tsx): it says who has not replied on each item and the gap bar names the items
   * with no price, so the "Waiting on" lines and the "N of M items have no price" box are left out here. The prices, the cannot
   * quote rows, the quoting later line and every item action stay.
   */
  board?: boolean
}) {
  const today = businessToday()
  // Every price (supplier, selling, spread) is for admin and sales only (owner decision 2026-10-22); an engineer's lines carry none.
  const prices = useSeesPrices()
  const [pkrOn, setPkrOn] = useShowPkr()
  // Only worth offering when a price is in another currency; an engineer sees no prices, so never PKR either.
  const foreign = inquiries.some(i => i.lines.some(l => l.currency !== 'PKR'))
  const showPkr = prices && pkrOn
  const [opened, setOpened] = useState<Readonly<Record<string, boolean>>>({})
  const phone = useMediaQuery('(max-width: 767px)')
  // Phone: the one item open (undefined: the first item with something to show; null: all closed by the person).
  const [openItem, setOpenItem] = useState<string | null | undefined>(undefined)
  const responders = inquiries.filter(i => i.lines.length > 0)
  // Asked at all: sent, or answered "cannot quote" (a supplier only on the shortlist is not asked yet).
  const askedCount = inquiries.filter(i => i.sentOn || i.noOfferOn).length
  const rateBar = showPkr
    ? buildRateBar(
        fxRows,
        inquiries.flatMap(i => i.lines.map(l => l.currency)),
      )
    : []
  const nobodyAsked = inquiries.length === 0
  // Something under the header besides the waiting line: a price or a cannot quote.
  const hasBody = (itemId: string) => inquiries.some(i => i.lines.some(l => l.itemId === itemId) || Boolean(declinedReason(itemId, i)))
  // Desktop: the column names show once, over the first item that has prices (they were repeated over every item).
  const headItemId = items.find(it => inquiries.some(i => i.lines.some(l => l.itemId === it.id)))?.id
  const shownItem = openItem === undefined ? items.find(it => hasBody(it.id))?.id : openItem
  // Asked, but nothing back on any item yet: every item would say the same "Waiting for prices" (owner, 18 Nov 2026: 31 items said
  // it 62 times). The panel says it once; a long list starts folded behind "Show items", and the items carry no chip of their own.
  const waitedOn = (itemId: string) => inquiries.some(i => i.sentOn && !i.noOfferOn && i.lines.length === 0 && !i.itemDeclines[itemId] && askedAbout(i, itemId))
  const allWaiting = !nobodyAsked && items.length > 0 && items.every(it => !hasBody(it.id) && waitedOn(it.id))
  const [showItems, setShowItems] = useState(false)
  // Items no supplier who replied has priced. Past two, one line over the list says it, not a red box on every item (owner, 18 Nov 2026).
  const uncoveredIds = new Set(
    items
      .filter(it => {
        const n = inquiries.reduce((k, i) => k + i.lines.filter(l => l.itemId === it.id).length, 0)
        const waits = inquiries.filter(i => i.sentOn && !i.noOfferOn && i.lines.length === 0 && !i.itemDeclines[it.id] && askedAbout(i, it.id)).length
        const resp = responders.filter(i => askedAbout(i, it.id) || i.lines.some(l => l.itemId === it.id)).length
        const askedFor = inquiries.filter(i => (i.sentOn || i.noOfferOn) && askedAbout(i, it.id)).length
        return itemCoverage(n, waits, resp, askedFor).kind === 'uncovered'
      })
      .map(it => it.id),
  )
  const manyUncovered = uncoveredIds.size > 2 && !board
  const listFolded = allWaiting && items.length > FOLD_FROM && !showItems
  return (
    <DetailPanel
      title={prices ? 'Items and supplier prices' : 'Items and supplier replies'}
      tip={!nobodyAsked && prices ? <HowCompared showPkr={showPkr} /> : null}
      dataSlot="items"
      meta={
        <>
          {items.length} {items.length === 1 ? 'item' : 'items'}
          {nobodyAsked ? ' · no supplier asked yet' : ''}
        </>
      }
      actions={
        <>
          {prices && !nobodyAsked && foreign ? (
            <ToggleButton pressed={showPkr} onPressedChange={setPkrOn} data-show-pkr>
              Show in PKR
            </ToggleButton>
          ) : null}
          <Button icon={Plus} onClick={onAddItem}>
            Add item
          </Button>
        </>
      }
    >
      {!nobodyAsked && rateBar.length > 0 ? <RateBar entries={rateBar} /> : null}
      {nobodyAsked && items.length > 0 ? (
        <p className="mt-4 rounded-control border border-dashed px-4 py-3 text-fg-2">
          <b className="font-semibold text-fg">Ask a supplier first.</b> Replies are entered under Suppliers asked.
        </p>
      ) : null}
      {allWaiting ? (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-control bg-deep px-4 py-3 text-fg-2" data-all-waiting>
          <Icon icon={Clock} className="shrink-0 text-fg-muted" />
          <span className="min-w-0 flex-1">
            <b className="font-semibold text-fg">No prices yet.</b> {items.length === 1 ? 'The item is' : `All ${items.length} items are`} waiting on the suppliers asked.
          </span>
          {items.length > FOLD_FROM ? (
            <Button size="sm" variant="quiet" icon={ChevronDown} className={cn('[&_svg]:transition-transform', showItems && '[&_svg]:rotate-180')} aria-expanded={showItems} onClick={() => setShowItems(v => !v)}>
              {showItems ? 'Hide items' : 'Show items'}
            </Button>
          ) : null}
        </div>
      ) : null}
      {manyUncovered ? (
        <div role="status" className="mt-3 flex items-start gap-3 rounded-control border border-tone-danger-fg/25 bg-tone-danger-bg px-4 py-3" data-many-uncovered={uncoveredIds.size}>
          <Icon icon={TriangleAlert} className="mt-1 text-tone-danger-fg" />
          <p className="text-fg-2">
            <b className="font-semibold text-fg">{`${uncoveredIds.size} of ${items.length} items have no price.`}</b> The suppliers who replied did not quote them. Ask another supplier before the quotation is due.
          </p>
        </div>
      ) : null}
      {items.length === 0 ? (
        <p className="mt-4 rounded-control border border-dashed px-4 py-6 text-fg-muted">This RFQ has no items yet. Add the first one to start asking for prices.</p>
      ) : listFolded ? null : (
        <div className="divide-y">
          {items.map(item => {
            const entries: Entry[] = []
            const lines = inquiries.flatMap(i => i.lines.filter(l => l.itemId === item.id).map(l => ({ l, i })))
            const cmp = comparePrices(
              lines.map(({ l }) => ({ id: l.id, amount: l.unitPrice, currency: l.currency })),
              rates,
            )
            for (const { l, i } of lines) entries.push({ line: l, inquiry: i, c: cmp.lines.find(x => x.id === l.id) as ComparedLine })
            // Suppliers are listed by name, never by price, and nothing is marked (owner decision 2026-10-29).
            entries.sort((x, y) => x.inquiry.supplierName.localeCompare(y.inquiry.supplierName))
            const declined = inquiries
              .filter(i => !i.lines.some(l => l.itemId === item.id))
              .map(i => ({ i, reason: declinedReason(item.id, i) }))
              .filter(d => d.reason)
            // Still waiting: asked about this item (supplier flow D), nothing back from them at all, and not declined for this item. A
            // supplier who answered other items and left this one is not waiting on it (the chase card still asks for it).
            const waiting = inquiries.filter(i => i.sentOn && !i.noOfferOn && i.lines.length === 0 && !i.itemDeclines[item.id] && !i.itemWaits?.[item.id] && askedAbout(i, item.id))
            const later = inquiries.filter(i => i.itemWaits?.[item.id] && !i.itemDeclines[item.id] && !i.lines.some(l => l.itemId === item.id))
            // Only the suppliers asked about this item count for it; one who priced it unasked counts too.
            const itemResponders = responders.filter(i => askedAbout(i, item.id) || i.lines.some(l => l.itemId === item.id))
            const askedForItem = inquiries.filter(i => (i.sentOn || i.noOfferOn) && askedAbout(i, item.id)).length
            const cov = itemCoverage(lines.length, waiting.length, itemResponders.length, askedForItem)
            // Others were asked, but nobody about this item: it says so, with the suppliers worth asking.
            const unasked = cov.kind === 'unasked' && askedCount > 0
            const q = qtyText(item.qty, item.unit)
            const forThis = (suggestions ?? []).filter(s => s.coversItemIds.includes(item.id)).slice(0, 3)
            // Phone accordion: an item with prices, a cannot quote or the warning folds to its header; one open at a time.
            const foldable = phone && !nobodyAsked && (entries.length > 0 || declined.length > 0 || cov.kind === 'uncovered' || unasked)
            const folded = foldable && shownItem !== item.id
            const bodyId = `item-body-${item.id}`
            return (
              <article key={item.id} aria-label={`Item ${item.number}`} className="min-w-0" data-folded={folded ? '' : undefined}>
                {/* A grid, so the number stays beside the title and the fold chevron and menu stay at the right of the first row at any
                    width; below lg the chip drops under the title, from lg it sits before the chevron. */}
                <header className={cn('relative grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2 px-0 pt-4 lg:grid-cols-[auto_minmax(0,1fr)_auto_auto] lg:pt-3', folded && 'pb-4', phone && !foldable && !nobodyAsked && 'pb-4')}>
                  <span className="num col-start-1 row-start-1 mt-px grid h-6 min-w-6 place-items-center rounded-round border border-line-strong px-1 text-sm font-medium">{item.number}</span>
                  <div className="col-start-2 row-start-1 min-w-0">
                    <h3 className="text-pretty text-base font-medium [overflow-wrap:anywhere]">
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
                  </div>
                  {/* The quantity, brand and category under the title, across to the right edge (the chevron and menu sit on the title's line only). */}
                  <p className="col-span-2 col-start-2 row-start-2 -mt-1 min-w-0 overflow-x-clip text-sm text-fg-muted lg:col-span-3">
                    <span className="-ml-4 flex flex-wrap items-center gap-y-1">
                      {q ? <span className="num pl-4">{q}</span> : null}
                      {item.brandName ? <Dot>{item.brandName}</Dot> : null}
                      <Dot>
                        <CategoryChip rfqId={rfq.id} item={item} />
                      </Dot>
                    </span>
                  </p>
                  {/* "Priced" is said once, on each supplier's row (Suppliers asked): an item with prices shows its price rows, not a second chip. */}
                  {/* An item others were asked about but nobody about this one says so folded too: Needs suppliers. */}
                  {unasked || (cov.value && cov.value !== 'priced' && !allWaiting) ? (
                    <span className="col-start-2 row-start-3 justify-self-start lg:col-start-3 lg:row-start-1">
                      <StatusBadge dimension="item-price" value={unasked ? 'unasked' : (cov.value as string)} detail={cov.detail} />
                    </span>
                  ) : null}
                  <span className="col-start-3 row-start-1 flex shrink-0 items-start gap-x-1 lg:col-start-4">
                    {foldable ? <Icon icon={ChevronDown} className={cn('mt-1 shrink-0 text-fg-muted transition-transform duration-base ease-out', !folded && 'rotate-180')} /> : null}
                    {/* Above the phone header's whole-width tap target (z-base), so the menu is its own button. */}
                    <span className="relative z-base -my-2 shrink-0">
                      <ItemMenu rfq={rfq} item={item} />
                    </span>
                  </span>
                </header>

                {folded ? null : (
                  <div id={bodyId}>
                    {cov.kind === 'uncovered' && !manyUncovered ? (
                      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-0 px-0">
                        <div role="status" className={cn('flex items-start gap-3 border border-tone-danger-fg/25 bg-tone-danger-bg px-4 py-3', forThis.length > 0 ? 'rounded-t-control' : 'rounded-control')}>
                          <Icon icon={TriangleAlert} className="mt-1 text-tone-danger-fg" />
                          <p className="text-fg-2">
                            <b className="font-semibold text-fg">
                              {itemResponders.length > 0
                                ? `None of the ${itemResponders.length} ${itemResponders.length === 1 ? 'supplier' : 'suppliers'} who replied quoted this item.`
                                : 'Every supplier asked said they cannot quote it.'}
                            </b>{' '}
                            {waiting.length > 0 ? `${waiting.map(w => w.supplierName).join(', ')} ${waiting.length === 1 ? 'has' : 'have'} not replied yet. ` : ''}
                            Ask another supplier before the quotation is due.
                          </p>
                        </div>
                        <AskForItem suggestions={forThis} item={item} onCopyEnquiry={onCopyEnquiry} />
                      </div>
                    ) : null}

                    {unasked ? (
                      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] gap-0 px-0" data-unasked={item.id}>
                        <p role="status" className={cn('border bg-deep px-4 py-3 text-fg-2', forThis.length > 0 ? 'rounded-t-control' : 'rounded-control')}>
                          <b className="font-semibold text-fg">No supplier has been asked about this item.</b> Ask a supplier before the quotation is due.
                        </p>
                        <AskForItem suggestions={forThis} item={item} onCopyEnquiry={onCopyEnquiry} />
                      </div>
                    ) : null}

                    {nobodyAsked || allWaiting ? null : entries.length > 0 || declined.length > 0 || (!phone && (board ? later.length > 0 : waiting.length > 0)) ? (
                      <div className="mt-3 lg:mt-1">
                        {entries.length > 0 && prices ? (
                          item.id !== headItemId ? null : <div className={HEAD} aria-hidden="true">
                            <span>Supplier</span>
                            <span className="text-right">{showPkr ? 'Price, PKR today' : 'Price'}</span>
                            <span>Lead time</span>
                            <span>Stock</span>
                            <span />
                          </div>
                        ) : entries.length > 0 ? (
                          item.id !== headItemId ? null : <div className={HEAD_NO_PRICES} aria-hidden="true">
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
                            const open = opened[line.id] ?? false
                            const detailId = `price-detail-${line.id}`
                            return (
                              <Fragment key={line.id}>
                                <li
                                  className={prices ? ROW : ROW_NO_PRICES}
                                  data-price-row=""
                                  data-compared={prices && c.compared && c.pkrPaisa !== null ? '' : undefined}
                                >
                                  {/* The mark sits with the name (no column of its own), so the name keeps its width at 16px text. */}
                                  <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                                    <span className="type-row min-w-0 break-words">{inquiry.supplierName}</span>
                                  </span>
                                  {/* Phone: price · lead time · stock on the second line (an engineer: lead time · stock). Desktop: the wrapper dissolves into the columns. */}
                                  <span className="col-span-full flex flex-wrap items-start gap-x-2 gap-y-1 lg:contents">
                                    {prices ? (
                                      <>
                                        {/* Phone: a price with a second line (its own currency, or "not compared") takes the whole line, and lead time and stock follow under it. */}
                                        <span className={cn('lg:text-right', showPkr && line.currency !== 'PKR' && 'max-lg:basis-full')}>
                                          <PriceCell line={line} c={c} showPkr={showPkr} />
                                        </span>
                                        <span aria-hidden="true" className={cn('text-fg-muted lg:hidden', (!line.leadTime || (showPkr && line.currency !== 'PKR')) && 'hidden')}>
                                          ·
                                        </span>
                                      </>
                                    ) : null}
                                    <span className={cn('min-w-0 text-fg-2', !line.leadTime && 'max-lg:hidden')}>
                                      <span className="sr-only">Lead time: </span>
                                      {line.leadTime ?? <span className="text-fg-muted">—</span>}
                                    </span>
                                    <span aria-hidden="true" className={cn('text-fg-muted lg:hidden', (line.inStock === null || (!prices && !line.leadTime)) && 'hidden')}>
                                      ·
                                    </span>
                                    <span className={cn('flex items-center gap-2 text-fg-2', line.inStock === null && 'max-lg:hidden')}>
                                      {line.inStock === null ? (
                                        <span className="text-fg-muted">
                                          <span className="sr-only">Stock: </span>—
                                        </span>
                                      ) : (
                                        <>
                                          <i aria-hidden="true" className={`size-2 rounded-round ${line.inStock ? 'bg-tone-success-fg' : 'border border-fg-muted'}`} />
                                          {line.inStock ? 'In stock' : 'Not in stock'}
                                        </>
                                      )}
                                    </span>
                                  </span>
                                  {prices ? (
                                    <span className="flex justify-end max-lg:col-start-2 max-lg:row-start-1 max-lg:self-start">
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
                                    <div id={detailId} className="col-span-full grid gap-2 pb-1 lg:col-start-2">
                                      <PriceDetail line={line} inquiry={inquiry} c={c} rates={rates} showPkr={showPkr} />
                                      {chip ? <LastPriceChipView chip={chip} showPkr={showPkr} /> : null}
                                    </div>
                                  ) : null}
                                </li>
                              </Fragment>
                            )
                          })}
                          {declined.map(({ i, reason }) => (
                            <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t px-0 py-3 text-fg-muted" data-declined={i.supplierId}>
                              <span className="type-row min-w-0 break-words text-fg-2">{i.supplierName}</span>
                              <StatusBadge dimension="inquiry" value="no-offer" />
                              <span className="text-sm">
                                {reasonLabel(reason)}
                                {i.noOfferOn && !i.itemDeclines[item.id] ? <span className="num whitespace-nowrap">{` · ${formatDay(i.noOfferOn)}`}</span> : null}
                              </span>
                            </li>
                          ))}
                          {/* Phone: the chip says it is waiting and Suppliers asked says on whom; the line stays on desktop. Nothing back on any
                              item: the panel says it once, so no item repeats it. */}
                          {later.length > 0 ? <WaitingLine waiting={later} later /> : null}
                          {waiting.length > 0 && !board && !(phone && entries.length === 0 && declined.length === 0) ? <WaitingLine waiting={waiting} /> : null}
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
