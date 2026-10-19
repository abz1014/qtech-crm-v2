import { useState } from 'react'
import { Ban, ChevronDown, Clock, Copy, Ellipsis, Info, Pencil, Plus, Trash2, TriangleAlert } from 'lucide-react'
import { useSession } from '@/app/session'
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
import { SupplierReplies } from '@/features/rfqs/SupplierReplies'
import { focusReplyInput } from '@/features/rfqs/replyFocus'
import { buildRateBar } from '@/features/fx/ratesModel'
import { RankBadge, RankNoteBar, ReasonBlock } from '@/features/rfqs/ranking/RankParts'
import { bandSizeOf, evidenceOf, rankChip, reasonsFor, type RankRow } from '@/features/rfqs/lib/ranking/reasons'
import { lastPriceChip, type MemoryRow } from '@/lib/memory'
import type { FxLatestRow, InquiryRow, QuoteLineRow, RfqHeader, RfqItemRow } from '@/features/rfqs/api'
import { useRemoveQuoteLine, useRestoreQuoteLine, useSetItemDecline } from '@/features/rfqs/hooks'
import {
  CANT_QUOTE_REASONS,
  comparePrices,
  comparisonNote,
  itemCoverage,
  qtyText,
  reasonForItem,
  reasonLabel,
  type ComparedLine,
  type RateTable,
  type SupplierSuggestion,
} from '@/features/rfqs/lib'

/*
 * Items and supplier replies (g2-rfq-detail "Items and supplier replies", R07). One panel: its header with the counts and Add
 * item, the rate bar, the reply boxes (one per supplier: the owner kept reply entry per supplier), then every item with what
 * each supplier quoted for it. Every price is shown in the supplier's own currency first, then in PKR at TODAY's rate. The lowest
 * is marked by comparePrices (R15) only among lines that can be compared; a line with no usable rate says "not compared, no rate"
 * quietly and never blocks anything (BUILD_PLAN A3/A4). The rate captured when the price was entered is shown beside today's, with
 * its own age band.
 */

const daysBetween = (from: string, to: string) => Math.round((Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10)) - Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10))) / 86_400_000)

const COLS = 'md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,0.9fr)_104px_32px]'
const HEAD = `hidden px-5 py-2 text-xs text-fg-muted md:grid md:gap-4 ${COLS}`
const ROW = `grid gap-x-4 gap-y-2 border-t px-5 py-3 ${COLS}`
/** A8 (R25): with the ranking there is a column for the rank before the supplier, and one more tap target (the reasons) in the last. */
const RCOLS = 'md:grid-cols-[30px_minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1.5fr)_minmax(0,0.9fr)_104px_72px]'
const RHEAD = `hidden px-5 py-2 text-xs text-fg-muted md:grid md:gap-4 ${RCOLS}`
const RROW = `relative grid gap-x-4 gap-y-2 border-t px-5 py-3 max-md:grid-cols-[26px_minmax(0,1fr)] ${RCOLS}`
/** On the phone every cell but the rank sits in the second column; the reasons and the last-price chip run under the whole row. */
const IN2 = 'max-md:col-start-2'

function Label({ children }: { children: string }) {
  return <span className="text-xs text-fg-muted md:sr-only">{children}</span>
}

function PkrCell({ line, c, rates }: { line: QuoteLineRow; c: ComparedLine; rates: RateTable }) {
  const today = businessToday()
  const rate = rates[line.currency]
  if (line.currency === 'PKR') return <span className="text-xs text-fg-muted">PKR, no conversion</span>
  const captured =
    line.fxRatePkr !== null && line.fxRateOn ? (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
        <span className="num">{`At entry ${formatRate(line.fxRatePkr)} · ${formatDay(line.fxRateOn)}`}</span>
        <StatusBadge dimension="fx" value={fxStaleness(Math.max(0, daysBetween(line.fxRateOn, today)))} detail={`${Math.max(0, daysBetween(line.fxRateOn, today))} d`} />
      </span>
    ) : (
      <StatusBadge dimension="fx-capture" value="none" />
    )
  return (
    <span className="grid gap-1">
      {c.pkrPaisa !== null ? (
        <>
          <span className="num text-sm">
            <span className="mr-1 font-sans text-xs text-fg-muted">≈ PKR</span>
            {formatPaisa(c.pkrPaisa)}
          </span>
          {c.band === 'stale' ? (
            <span className="flex items-center gap-1 text-xs text-tone-warning-fg">
              <Icon icon={TriangleAlert} size="chip" />
              {`${line.currency} ${formatRate(rate?.rate ?? 0)}, rate ${c.rateAgeDays} days old`}
            </span>
          ) : (
            <span className="flex items-center gap-1 text-xs text-fg-muted">
              <Icon icon={Clock} size="chip" />
              {`${line.currency} ${formatRate(rate?.rate ?? 0)}, ${c.rateAgeDays === 0 ? "today's rate" : `rate from ${c.rateAgeDays} ${c.rateAgeDays === 1 ? 'day' : 'days'} ago`}`}
            </span>
          )}
        </>
      ) : (
        <span className="inline-flex w-fit items-center gap-1 rounded-round bg-selected px-2 py-[2px] text-xs text-fg-2">
          <Icon icon={Info} size="chip" />
          {c.notCompared === 'unusable' ? 'not compared — rate too old' : 'not compared — no rate'}
        </span>
      )}
      {captured}
    </span>
  )
}

interface Entry {
  line: QuoteLineRow
  inquiry: InquiryRow
  c: ComparedLine
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
            try {
              await restore.mutateAsync(line)
            } catch (err) {
              toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
            }
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

/** A supplier asked about this item who has not answered it: "Waiting on X", with Add reply and a Can't quote menu (C-37). */
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
            try {
              await decline.mutateAsync({ inquiryId: inquiry.id, itemId: item.id, reason: null })
            } catch (err) {
              toast({ title: 'Could not undo', body: mapPgError(err).message, tone: 'danger' })
            }
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
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t bg-sunken px-5 py-3 text-sm" data-waiting={inquiry.supplierId}>
      <span className="flex min-w-0 flex-1 basis-[16rem] items-center gap-2 text-fg-2">
        <Icon icon={Clock} className="text-fg-muted" />
        <span className="min-w-0">
          Waiting on <b className="font-semibold text-fg">{inquiry.supplierName}</b>
          <span className="text-fg-muted">{` · enquiry sent ${formatDay(inquiry.sentOn as string)}${chase}`}</span>
        </span>
      </span>
      <Button size="sm" onClick={() => focusReplyInput(inquiry.id, item.id)}>
        Add reply
      </Button>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" aria-label={`Can't quote, ${inquiry.supplierName}, item ${item.number}`}>
            {"Can't quote"}
            <Icon icon={ChevronDown} size="sm" />
          </Button>
        </PopoverTrigger>
        <PopoverContent variant="menu" align="end" aria-label="Reason">
          <p role="none" className="px-2 pb-1 pt-1 text-xs text-fg-muted">One tap records the reason</p>
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

function Dot({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span aria-hidden="true" className="size-[3px] rounded-round bg-fg-muted" />
      {children}
    </span>
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
  const session = useSession()
  // The selling price and the spread are for admin and sales only. The database sends an engineer NULLs; this also keeps their notes off the page.
  const showSell = session.status === 'signed-in' && (session.user.role === 'admin' || session.user.role === 'sales')
  const [opened, setOpened] = useState<Readonly<Record<string, boolean>>>({})
  const responders = inquiries.filter(i => i.lines.length > 0)
  const pricedItems = items.filter(it => inquiries.some(i => i.lines.some(l => l.itemId === it.id))).length
  const rateBar = buildRateBar(
    fxRows,
    inquiries.flatMap(i => i.lines.map(l => l.currency)),
  )
  const nobodyAsked = inquiries.length === 0
  return (
    <DetailPanel
      title="Items and supplier replies"
      dataSlot="items"
      meta={
        <>
          {items.length} {items.length === 1 ? 'item' : 'items'} ·{' '}
          {nobodyAsked ? 'nobody asked yet' : `${inquiries.length} ${inquiries.length === 1 ? 'supplier' : 'suppliers'} asked · ${pricedItems} ${pricedItems === 1 ? 'item has' : 'items have'} a price`}
        </>
      }
      actions={
        <Button icon={Plus} onClick={onAddItem}>
          Add item
        </Button>
      }
    >
      {!nobodyAsked ? <RateBar entries={rateBar} /> : null}
      {nobodyAsked && items.length > 0 ? (
        <div className="border-b px-5 py-5">
          <h3 className="text-base font-semibold">Ask suppliers for prices</h3>
          <p className="mt-2 max-w-prose text-sm text-fg-2">
            Pick the suppliers on the right. One tap copies an enquiry listing every item, ready to paste into WhatsApp or email. Replies are typed in under each item as they arrive.
          </p>
        </div>
      ) : null}
      <SupplierReplies rfq={rfq} items={items} inquiries={inquiries} rates={rates} />
      {items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-fg-muted">This RFQ has no items yet. Add the first one to start asking for prices.</p>
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
            const ranked = lines.length >= 2 && lines.every(({ l }) => rankOf(l) !== undefined)
            if (ranked) {
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
            const declined = inquiries
              .filter(i => !i.lines.some(l => l.itemId === item.id))
              .map(i => ({ i, reason: reasonForItem(item.id, i) }))
              .filter(d => d.reason)
            // Still waiting: asked, nothing back from them at all, and not declined for this item. A supplier who answered other items
            // and left this one is not waiting on it (the chase card still asks for it).
            const waiting = inquiries.filter(i => i.sentOn && !i.noOfferOn && i.lines.length === 0 && !i.itemDeclines[item.id])
            const cov = itemCoverage(lines.length, waiting.length, responders.length)
            const chipLabel = ranked && cov.kind === 'covered' ? rankChip(itemRanks) : null
            const q = qtyText(item.qty, item.unit)
            const left = cmp.lines.filter(x => x.pkrPaisa === null).map(x => lines.find(({ l }) => l.id === x.id)?.l.currency as string)
            const stale = cmp.lines.filter(x => x.band === 'stale' && x.rateAgeDays !== null).map(x => ({ currency: lines.find(({ l }) => l.id === x.id)?.l.currency as string, days: x.rateAgeDays as number }))
            const forThis = (suggestions ?? []).filter(s => s.coversItemIds.includes(item.id)).slice(0, 3)
            return (
              <article key={item.id} aria-label={`Item ${item.number}`} className="min-w-0">
                <header className="flex flex-wrap items-start gap-x-3 gap-y-2 px-5 pt-4">
                  <span className="num mt-[2px] grid h-6 min-w-6 place-items-center rounded border border-line-strong px-1 text-xs">{item.number}</span>
                  <div className="min-w-0 flex-1 basis-[16rem]">
                    <h3 className="text-base font-medium text-pretty">{item.description}</h3>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-sm text-fg-muted">
                      {q ? <span className="num">{q}</span> : null}
                      {item.brandName ? <Dot>{item.brandName}</Dot> : null}
                      {item.familyName ? <Dot>{item.familyName}</Dot> : null}
                      {!item.brandName && !item.familyName ? <Dot>No brand given</Dot> : null}
                    </p>
                  </div>
                  <StatusBadge
                    dimension={cov.kind === 'none' ? 'inquiry' : 'sourcing'}
                    value={cov.kind === 'covered' ? 'covered' : cov.kind === 'partly' ? 'partly-covered' : cov.kind === 'uncovered' ? 'no-offer' : 'awaiting'}
                    label={chipLabel ?? cov.label}
                  />
                  {inquiries.length > 0 ? (
                    <Button
                      size="sm"
                      icon={Plus}
                      onClick={() => {
                        const target = waiting[0] ?? inquiries.find(i => !i.noOfferOn) ?? inquiries[0]
                        focusReplyInput(target.id, item.id)
                      }}
                    >
                      Add reply
                    </Button>
                  ) : null}
                </header>

                {cov.kind === 'uncovered' ? (
                  <div className="mt-3 grid gap-0 px-5">
                    <div role="status" className="flex items-start gap-3 rounded-t border border-tone-danger-fg/25 bg-tone-danger-bg px-4 py-3 text-sm">
                      <Icon icon={TriangleAlert} className="mt-[2px] text-tone-danger-fg" />
                      <p className="text-fg-2">
                        <b className="font-semibold text-fg">{`None of the ${responders.length} ${responders.length === 1 ? 'supplier' : 'suppliers'} who replied quoted this item.`}</b>{' '}
                        {waiting.length > 0 ? `${waiting.map(w => w.supplierName).join(', ')} ${waiting.length === 1 ? 'has' : 'have'} not replied yet. ` : ''}
                        Float it to someone else before the customer&apos;s bid is due.
                      </p>
                    </div>
                    {forThis.length > 0 ? (
                      <ul className="rounded-b border border-t-0 bg-surface">
                        {forThis.map(s => (
                          <li key={s.supplierId} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-3 first:border-t-0">
                            <span className="min-w-0 flex-1 basis-[14rem]">
                              <b className="block text-sm font-semibold">{s.name}</b>
                              <span className="text-xs text-fg-muted">{s.reason}</span>
                            </span>
                            <Button size="sm" icon={Copy} onClick={() => onCopyEnquiry(s, item)} aria-label={`Copy enquiry text for ${s.name}`}>
                              Copy enquiry text
                            </Button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ) : null}

                {nobodyAsked ? (
                  <p className="px-5 pb-4 pt-3 text-sm text-fg-muted">No supplier has been asked about this item.</p>
                ) : entries.length > 0 || declined.length > 0 || waiting.length > 0 ? (
                  <div className="mt-3">
                    {ranked ? <RankNoteBar rows={itemRanks} showSell={showSell} /> : null}
                    {entries.length > 0 ? (
                      <div className={ranked ? RHEAD : HEAD} aria-hidden="true">
                        {ranked ? <span /> : null}
                        <span>Supplier</span>
                        <span className="text-right">Price</span>
                        <span>In PKR at today&apos;s rate</span>
                        <span>Lead time</span>
                        <span>Stock</span>
                        <span />
                      </div>
                    ) : null}
                    <ul>
                      {entries.map(entry => {
                        const { line, inquiry, c } = entry
                        const memRow = memory?.[item.id]?.find(r => r.supplier_id === inquiry.supplierId)
                        const chip = lastPriceChip(memRow, today)
                        const rk = ranked ? (rankOf(line) as RankRow) : null
                        const reasons = rk ? reasonsFor(rk, { showSell, bandSize, evidence: evidenceOf(memRow), names: { brand: item.brandName, family: item.familyName } }) : null
                        const open = rk ? (opened[line.id] ?? (bandSize >= 2 && rk.within_band === true)) : false
                        const cell = rk ? IN2 : ''
                        return (
                          <li
                            key={line.id}
                            className={cn(rk ? RROW : ROW, rk && rk.rank === null && 'bg-canvas')}
                            data-lowest={c.lowest ? '' : undefined}
                            data-compared={c.compared && c.pkrPaisa !== null ? '' : undefined}
                            data-ranked={rk ? (rk.rank ?? 'none') : undefined}
                          >
                            {rk ? <RankBadge row={rk} className="mt-[2px] max-md:row-start-1" /> : null}
                            <div className={cn('grid gap-[2px]', cell)}>
                              <Label>Supplier</Label>
                              <span className="min-w-0 break-words text-sm font-medium">{inquiry.supplierName}</span>
                              {inquiry.supplierCity || inquiry.supplierCountry ? <span className="text-xs text-fg-muted">{[inquiry.supplierCity, inquiry.supplierCountry].filter(Boolean).join(', ')}</span> : null}
                            </div>
                            <div className={cn('grid gap-1 md:justify-items-end', cell)}>
                              <Label>Price</Label>
                              <span className="num whitespace-nowrap text-sm font-medium">
                                <span className="mr-1 font-sans text-xs font-regular text-fg-muted">{line.currency}</span>
                                {formatAmount(line.unitPrice, 'always')}
                              </span>
                            </div>
                            <div className={cn('grid content-start gap-1', cell)}>
                              <Label>In PKR at today&apos;s rate</Label>
                              <span className="flex flex-wrap items-start gap-2">
                                {c.lowest ? <StatusBadge dimension="sourcing" value="covered" label="Lowest" /> : null}
                                <PkrCell line={line} c={c} rates={rates} />
                              </span>
                            </div>
                            <div className={cn('grid content-start gap-1', cell)}>
                              <Label>Lead time</Label>
                              <span className="text-sm">{line.leadTime ?? <span className="text-fg-muted">—</span>}</span>
                            </div>
                            <div className={cn('grid content-start gap-1', cell)}>
                              <Label>Stock</Label>
                              <span className="flex items-center gap-2 text-sm">
                                {line.inStock === null ? (
                                  <span className="text-fg-muted">—</span>
                                ) : (
                                  <>
                                    <i aria-hidden="true" className={`size-[6px] rounded-round ${line.inStock ? 'bg-tone-success-fg' : 'border border-fg-muted'}`} />
                                    {line.inStock ? 'In stock' : 'Not in stock'}
                                  </>
                                )}
                              </span>
                            </div>
                            <div className={cn('flex justify-end', rk ? 'max-md:absolute max-md:right-3 max-md:top-2' : 'max-md:order-first')}>
                              {rk ? (
                                <Button
                                  variant="quiet"
                                  size="sm"
                                  aria-expanded={open}
                                  aria-label={`${open ? 'Hide' : 'Show'} reasons for ${inquiry.supplierName}`}
                                  onClick={() => setOpened(o => ({ ...o, [line.id]: !open }))}
                                  icon={ChevronDown}
                                  className={cn('[&_svg]:transition-transform', open && '[&_svg]:rotate-180')}
                                />
                              ) : null}
                              <RowMenu rfqId={rfq.id} entry={entry} item={item} />
                            </div>
                            {rk && reasons ? (
                              <div className="col-[2/-1]">
                                <ReasonBlock set={reasons} open={open} supplier={inquiry.supplierName} unrankedCurrency={rk.rank === null ? line.currency : null} />
                              </div>
                            ) : null}
                            {chip ? rk ? <div className="col-[2/-1]"><LastPriceChipView chip={chip} /></div> : <LastPriceChipView chip={chip} /> : null}
                          </li>
                        )
                      })}
                      {declined.map(({ i, reason }) => (
                        <li key={i.id} className={`${ranked ? `grid gap-x-4 gap-y-2 border-t px-5 py-3 ${RCOLS}` : ROW} text-fg-muted`} data-declined={i.supplierId}>
                          {ranked ? <span aria-hidden="true" className="max-md:hidden" /> : null}
                          <span className="min-w-0 break-words text-sm font-medium text-fg-2">{i.supplierName}</span>
                          <span className="flex flex-wrap items-center gap-2 text-sm md:col-span-5">
                            <span className="inline-flex h-5 items-center gap-[5px] rounded border border-line-strong bg-surface px-2 text-xs font-medium text-fg-2">
                              <Icon icon={Ban} size="chip" />
                              {"Can't quote"}
                            </span>
                            {reasonLabel(reason)}
                            {i.noOfferOn && !i.itemDeclines[item.id] ? <span className="num text-xs">{`· ${formatDay(i.noOfferOn)}`}</span> : null}
                          </span>
                        </li>
                      ))}
                      {waiting.map(w => (
                        <WaitingRow key={w.id} rfqId={rfq.id} inquiry={w} item={item} />
                      ))}
                    </ul>
                    {entries.length > 0 && !ranked ? (
                      <p className="flex items-start gap-2 border-t px-5 py-3 text-xs text-fg-muted">
                        <Icon icon={Info} size="sm" className="mt-[1px]" />
                        <span>{comparisonNote({ comparable: cmp.comparableCount, basis: cmp.basis, notCompared: left, staleRates: stale, lines: entries.length })}</span>
                      </p>
                    ) : null}
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
