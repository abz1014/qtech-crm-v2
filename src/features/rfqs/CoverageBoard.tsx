import { useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react'
import { Check, Clock, Minus, Search, X, type LucideIcon } from 'lucide-react'
import { useSeesPrices } from '@/app/session'
import { cn } from '@/lib/utils'
import { formatAmount } from '@/lib/money'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { TextField } from '@/ui/form/TextField'
import type { InquiryRow, RfqItemRow } from '@/features/rfqs/api'
import { DetailPanel } from '@/features/rfqs/DetailPanel'
import { qtyText } from '@/features/rfqs/lib/enquiryDraft'
import { reasonForItem, reasonLabel } from '@/features/rfqs/lib/cantQuote'
import {
  cellStatus,
  filterItems,
  gapOf,
  gapText,
  groupByBrand,
  isAsked,
  itemSummary,
  openWords,
  pricesWord,
  REACH_WORDS,
  shortNames,
  showBoard,
  STATUS_WORDS,
  supplierReach,
  type BoardFilter,
  type CellStatus,
} from '@/features/rfqs/lib/coverage'

/*
 * The coverage board and the gap bar (owner's lean cut of docs/design/supplier-replies-mockup.html, 23 Nov 2026).
 *
 * Gap bar: once a supplier is asked, the items nobody has priced, named ("item 27 (WIKA)"), how many of them a supplier still has to
 * answer, "Show them" (the No price filter) and "Ask another supplier for these N" (the usual ask dialog with exactly those items
 * ticked). No money in it, so an engineer sees it too.
 *
 * Board: rows are the items, columns the suppliers asked, each cell one status icon (priced, quoting later, cannot quote, replied
 * but left it out, no reply yet, not asked). The last column counts the prices. A cell opens every supplier's answer for that item,
 * A to Z. The unit price shows there only for admin and sales (an engineer's lines carry no price). The board says who answered,
 * never who is cheaper: nothing is ranked or marked.
 */

/** EnquiryWork's "Show them" scrolls to this id. */
const BOARD_ID = 'coverage-board'

const LOOK: Record<CellStatus, { icon: LucideIcon | null; dot: string }> = {
  priced: { icon: Check, dot: 'bg-tone-success-bg text-tone-success-fg' },
  later: { icon: Clock, dot: 'bg-tone-warning-bg text-tone-warning-fg' },
  cannot: { icon: X, dot: 'bg-tone-danger-bg text-tone-danger-fg' },
  'left-out': { icon: Minus, dot: 'bg-deep text-fg-muted' },
  'no-reply': { icon: null, dot: 'border border-dashed border-line-strong' },
  'not-asked': { icon: null, dot: '' },
}

/** Diagonal hairlines in the border colour: "not asked". */
const HATCH: CSSProperties = { backgroundImage: 'repeating-linear-gradient(135deg, var(--border) 0 1.5px, transparent 1.5px 7px)' }

function StatusDot({ status, className }: { status: CellStatus; className?: string }) {
  if (status === 'not-asked') return <span aria-hidden="true" className={cn('inline-block size-6 rounded-round', className)} style={HATCH} />
  const look = LOOK[status]
  return (
    <span aria-hidden="true" className={cn('inline-grid size-6 shrink-0 place-items-center rounded-round', look.dot, className)}>
      {look.icon ? <Icon icon={look.icon} size="sm" /> : null}
    </span>
  )
}

const LEGEND: CellStatus[] = ['priced', 'later', 'cannot', 'left-out', 'no-reply', 'not-asked']

function Legend() {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3 text-sm text-fg-2" aria-label="What the icons mean">
      {LEGEND.map(s => (
        <li key={s} className="inline-flex items-center gap-2">
          <StatusDot status={s} />
          {s === 'left-out' ? 'Replied, item left out' : STATUS_WORDS[s]}
        </li>
      ))}
    </ul>
  )
}

/** The items nobody has priced yet, with the two ways forward. Renders nothing when every item has a price. */
export function GapBar({ items, inquiries, onShow, onAsk }: { items: readonly RfqItemRow[]; inquiries: readonly InquiryRow[]; onShow: () => void; onAsk: (itemIds: string[]) => void }) {
  const gap = useMemo(() => gapOf(items, inquiries), [items, inquiries])
  if (gap.items.length === 0 || !inquiries.some(isAsked)) return null
  const t = gapText(gap)
  const n = gap.items.length
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-control border border-tone-danger-fg/25 bg-tone-danger-bg px-4 py-3" data-gap-bar={n}>
      <p className="min-w-0 flex-1 basis-[16rem] text-fg-2">
        <b className="font-semibold text-tone-danger-fg">{t.lead}</b> {t.list}
        {t.open ? ` ${t.open}` : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onShow}>
          Show them
        </Button>
        <Button size="sm" onClick={() => onAsk(gap.items.map(it => it.id))}>
          {`Ask another supplier for ${n === 1 ? 'this one' : `these ${n}`}`}
        </Button>
      </div>
    </div>
  )
}

export function CoverageBoard({
  items,
  inquiries,
  filter,
  onFilter,
}: {
  items: readonly RfqItemRow[]
  inquiries: readonly InquiryRow[]
  filter: BoardFilter
  onFilter: (f: BoardFilter) => void
}) {
  const asked = useMemo(() => inquiries.filter(isAsked), [inquiries])
  const short = useMemo(() => shortNames(asked.map(i => i.supplierName)), [asked])
  const [search, setSearch] = useState('')
  const [goTo, setGoTo] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const counts = useMemo(
    () => ({
      all: items.length,
      'no-price': filterItems(items, asked, 'no-price', '').length,
      later: filterItems(items, asked, 'later', '').length,
    }),
    [items, asked],
  )
  const shown = useMemo(() => filterItems(items, asked, filter, search), [items, asked, filter, search])
  const groups = groupByBrand(shown)
  const grouped = groupByBrand(items).length > 1
  const cols: CSSProperties = { gridTemplateColumns: `minmax(14rem, 1fr) repeat(${asked.length}, minmax(4.5rem, 5rem)) minmax(9rem, max-content)` }
  const opened = open ? items.find(it => it.id === open) : undefined
  // Under 5 items and 3 suppliers asked the items list says it all (EnquiryWork asks the same before drawing this).
  if (!showBoard(items.length, asked.length)) return null

  const jump = () => {
    const n = Number(goTo.trim())
    const it = items.find(x => x.number === n)
    if (!it) return
    if (!shown.includes(it)) {
      onFilter('all')
      setSearch('')
    }
    // after the filter has let the row back in
    window.setTimeout(() => {
      const row = document.querySelector<HTMLElement>(`[data-board-item="${CSS.escape(it.id)}"]`)
      row?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      row?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    }, 0)
  }
  const onGoKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      jump()
    }
  }

  return (
    <div id={BOARD_ID} className="min-w-0 scroll-mt-[5rem]">
      <DetailPanel title="Items by supplier" dataSlot="coverage-board">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-3">
          <SegmentedControl
            aria-label="Show items"
            value={filter}
            onValueChange={v => onFilter(v as BoardFilter)}
            options={[
              { value: 'all', label: `All · ${counts.all}` },
              { value: 'no-price', label: `No price · ${counts['no-price']}` },
              { value: 'later', label: `Quoting later · ${counts.later}` },
            ]}
          />
          <span className="min-w-0 flex-1 basis-[12rem]">
            <TextField type="search" aria-label="Search item, brand, part" placeholder="Search item, brand, part" prefix={<Icon icon={Search} size="sm" />} value={search} onChange={e => setSearch(e.target.value)} />
          </span>
          <span className="flex items-center gap-2">
            <span className="w-[8rem]">
              <TextField inputMode="numeric" aria-label="Go to item no." placeholder="Go to item no." value={goTo} onChange={e => setGoTo(e.target.value.replace(/\D/g, ''))} onKeyDown={onGoKey} />
            </span>
            <Button size="sm" onClick={jump} disabled={!goTo}>
              Go
            </Button>
          </span>
        </div>
        <Legend />
        <div className="max-h-[70vh] overflow-auto rounded-control border" data-board-scroll>
          <div role="table" aria-label="Items by supplier" aria-rowcount={shown.length + 1} className="grid w-max min-w-full" style={cols}>
            <div role="row" className="contents">
              <span role="columnheader" className="sticky left-0 top-0 z-sticky flex items-end border-b border-r bg-deep px-4 py-2 text-sm font-semibold text-fg-2">
                Item
              </span>
              {asked.map((i, n) => {
                const reach = supplierReach(i.supplierCountry)
                return (
                  <span
                    key={i.id}
                    role="columnheader"
                    title={i.supplierName}
                    aria-label={reach ? `${i.supplierName}, ${REACH_WORDS[reach]}` : i.supplierName}
                    className="sticky top-0 z-base grid content-end justify-items-center border-b bg-deep px-2 py-2 text-center"
                  >
                    <span className="max-w-full truncate text-sm font-semibold text-fg">{short[n]}</span>
                    {reach ? <span className="text-xs text-fg-muted">{reach === 'local' ? 'Local' : 'Intl'}</span> : null}
                  </span>
                )
              })}
              <span role="columnheader" className="sticky right-0 top-0 z-sticky flex items-end border-b border-l bg-deep px-4 py-2 text-sm font-semibold text-fg-2">
                Prices
              </span>
            </div>
            {shown.length === 0 ? (
              <div role="row" className="contents">
                <span role="cell" className="col-span-full px-4 py-6 text-fg-muted">
                  No item matches.
                </span>
              </div>
            ) : null}
            {groups.map(g => {
              const noPrice = g.items.filter(it => itemSummary(asked, it.id).noPrice).length
              return [
                grouped ? (
                  <div key={`g-${g.brand}`} role="row" className="contents">
                    <span role="cell" className="col-span-full border-b bg-sunken px-4 py-2 text-sm font-semibold text-fg-2" data-brand-group={g.brand}>
                      <span className="sticky left-4">
                        {`${g.brand} · ${g.items.length} ${g.items.length === 1 ? 'item' : 'items'}`}
                        {noPrice ? <span className="text-tone-danger-fg">{` · ${noPrice} with no price`}</span> : null}
                      </span>
                    </span>
                  </div>
                ) : null,
                ...g.items.map(it => {
                  const s = itemSummary(asked, it.id)
                  const q = qtyText(it.qty, it.unit)
                  const more = openWords(s.counts)
                  return (
                    <div key={it.id} role="row" className="contents" data-board-item={it.id}>
                      <span role="rowheader" className="sticky left-0 z-base grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-2 border-b border-r bg-surface px-4 py-2">
                        <span className="num mt-px grid h-6 min-w-6 place-items-center rounded-round border border-line-strong px-1 text-sm font-medium">{it.number}</span>
                        <span className="min-w-0">
                          <span className="block max-w-[16rem] text-base font-medium [overflow-wrap:anywhere]">{it.description}</span>
                          <span className="block text-sm text-fg-muted">{[it.brandName, q].filter(Boolean).join(' · ')}</span>
                        </span>
                      </span>
                      {asked.map(i => {
                        const st = cellStatus(i, it.id)
                        return (
                          <span key={i.id} role="cell" className="grid place-items-center border-b px-1 py-1" style={st === 'not-asked' ? HATCH : undefined} data-cell={st}>
                            <button
                              type="button"
                              onClick={() => setOpen(it.id)}
                              aria-label={`${i.supplierName}, item ${it.number}: ${STATUS_WORDS[st].toLowerCase()}`}
                              className="grid size-control-sm place-items-center rounded-round hover:bg-selected"
                            >
                              {st === 'not-asked' ? null : <StatusDot status={st} />}
                            </button>
                          </span>
                        )
                      })}
                      <span role="cell" className="sticky right-0 z-base grid content-center border-b border-l bg-surface px-4 py-2" data-prices={s.counts.priced}>
                        <span className={cn('text-sm font-semibold', s.noPrice ? 'text-tone-danger-fg' : 'text-fg')}>{pricesWord(s.counts.priced)}</span>
                        {more ? <span className="whitespace-nowrap text-xs text-fg-muted">{more}</span> : null}
                      </span>
                    </div>
                  )
                }),
              ]
            })}
          </div>
        </div>
        <p className="pt-2 text-sm text-fg-muted">The board shows who answered, not prices. Select a cell to see every reply for that item.</p>
      </DetailPanel>
      {opened ? <ItemAnswers item={opened} inquiries={asked} onClose={() => setOpen(null)} /> : null}
    </div>
  )
}

/** Every supplier asked and their answer for one item, A to Z by name. The price only for a person who sees prices. */
function ItemAnswers({ item, inquiries, onClose }: { item: RfqItemRow; inquiries: readonly InquiryRow[]; onClose: () => void }) {
  const prices = useSeesPrices()
  const rows = [...inquiries].sort((a, b) => a.supplierName.localeCompare(b.supplierName))
  const q = qtyText(item.qty, item.unit)
  return (
    <Dialog open onOpenChange={o => (o ? null : onClose())}>
      <DialogContent title={item.description} context={[`Item ${item.number}`, item.brandName, q].filter(Boolean).join(' · ')} placement="side">
        <p className="text-sm text-fg-muted">{prices ? 'Suppliers in A to Z order. Prices are not ranked.' : 'Suppliers in A to Z order.'}</p>
        <ul className="mt-2 divide-y" data-item-answers={item.id}>
          {rows.map(i => {
            const st = cellStatus(i, item.id)
            const line = i.lines.find(l => l.itemId === item.id)
            const reach = supplierReach(i.supplierCountry)
            const reason = st === 'cannot' ? reasonForItem(item.id, i) : null
            const detail = [
              st === 'cannot' && reason ? `${STATUS_WORDS.cannot}: ${reasonLabel(reason)}` : STATUS_WORDS[st],
              line?.leadTime ?? '',
              line && line.inStock !== null ? (line.inStock ? 'in stock' : 'not in stock') : '',
            ].filter(Boolean)
            return (
              <li key={i.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 py-3" data-answer={st}>
                <StatusDot status={st} className="mt-px" />
                <span className="min-w-0">
                  <b className="type-row [overflow-wrap:anywhere]">{i.supplierName}</b>
                  {reach ? <span className="text-sm text-fg-muted">{` · ${REACH_WORDS[reach]}`}</span> : null}
                  <span className="block text-sm text-fg-2">{detail.join(' · ')}</span>
                </span>
                {prices && line && line.unitPrice != null ? (
                  <span className="num whitespace-nowrap text-base font-semibold" data-answer-price>
                    <span className="text-sm font-medium text-fg-muted">{line.currency}</span> {formatAmount(line.unitPrice, line.currency === 'PKR' ? 'auto' : 'always')}
                  </span>
                ) : null}
              </li>
            )
          })}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
