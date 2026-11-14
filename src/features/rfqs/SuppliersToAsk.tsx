import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardCheck, Copy, FileCheck, MessageSquareReply } from 'lucide-react'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Checkbox } from '@/ui/form/Checkbox'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { PartialNote, ReasonParts } from '@/features/rfqs/ranking/RankParts'
import type { RfqItemRow } from '@/features/rfqs/api'
import { DetailPanel } from '@/features/rfqs/DetailPanel'
import { FindSupplier, type FoundSupplier } from '@/features/rfqs/FindSupplier'
import type { SupplierSuggestion } from '@/features/rfqs/lib'

/*
 * "Suppliers to ask" (g2-rfq-detail, empty state): the suggested suppliers with the reason for each, the ones who supplied the
 * item before already ticked, and one button that copies a message listing every item and records the asking. The same list
 * is what "Ask suppliers" (the page's green button while nobody is asked) and "Ask more suppliers" open in a dialog. Suggestions
 * come from R03 (the reasons) and R17 (the memory); nothing is scored. Inside a reason the supplier with the better record comes
 * first (A8), and the order behind it is cited (number, the date we placed it, days to delivery).
 * The card's button is not green: the page has one green button, and while nobody is asked it is the header's Ask suppliers.
 * Supplier flow D: with more than one item, "Items to ask about" lists them with a tick each (all ticked in the card; in the dialog
 * the items that still need a price). The message lists only the ticked items, and the ask records them (0140).
 */
const copyLabel = (n: number) => `Copy message for ${n} ${n === 1 ? 'supplier' : 'suppliers'}`

/** Who is asked: only the name and the id are used. */
export type TickedSupplier = Pick<SupplierSuggestion, 'supplierId' | 'name'>

/**
 * The ticked suppliers, starting with the pre-ticked ones; a tick or untick by hand is kept. A supplier found or added with
 * "Search or add a supplier" who is not in the suggestions is listed under "Added manually", ticked.
 */
function useTicks(suggestions: readonly SupplierSuggestion[] | undefined) {
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [added, setAdded] = useState<FoundSupplier[]>([])
  const listed = (id: string) => (suggestions ?? []).some(s => s.supplierId === id)
  const isTicked = (s: SupplierSuggestion) => touched[s.supplierId] ?? s.preTicked
  const extras = added.filter(a => !listed(a.id))
  const addedTicked = (a: FoundSupplier) => touched[a.id] ?? true
  const ticked: TickedSupplier[] = [
    ...(suggestions ?? []).filter(isTicked),
    ...extras.filter(addedTicked).map(a => ({ supplierId: a.id, name: a.name })),
  ]
  return {
    isTicked,
    ticked,
    extras,
    addedTicked,
    set: (id: string, on: boolean) => setTouched(t => ({ ...t, [id]: on })),
    pick: (f: FoundSupplier) => {
      setTouched(t => ({ ...t, [f.id]: true }))
      setAdded(a => (a.some(x => x.id === f.id) ? a : [...a, f]))
    },
  }
}

/** The ticked items, starting with `initial`; a tick or untick by hand is kept. */
function useItemTicks(items: readonly RfqItemRow[], initial: (item: RfqItemRow) => boolean) {
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const isTicked = (it: RfqItemRow) => touched[it.id] ?? initial(it)
  return { isTicked, ticked: items.filter(isTicked), set: (id: string, on: boolean) => setTouched(t => ({ ...t, [id]: on })) }
}

/** "Items to ask about": one tick per item. Not shown for an RFQ with one item (there is nothing to choose). */
function ItemPicks({ items, t }: { items: readonly RfqItemRow[]; t: ReturnType<typeof useItemTicks> }) {
  if (items.length < 2) return null
  return (
    <ul data-slot="ask-items" aria-label="Items to ask about" className="border-t">
      <li className="border-b bg-sunken px-5 py-2 text-base font-semibold">
        Items to ask about <span className="font-regular text-fg-muted">{`· ${t.ticked.length} of ${items.length}`}</span>
      </li>
      {items.map(it => {
        const id = `ask-item-${it.id}`
        return (
          // The tick sits on the first line of a name that wraps (the box's own top offset; on touch its 44px target, less 13px).
          <li key={it.id} className="relative flex min-w-0 items-start gap-3 border-b px-5 py-2 last:border-b-0">
            <Checkbox
              id={id}
              checked={t.isTicked(it)}
              onCheckedChange={v => t.set(it.id, v === true)}
              aria-label={`Item ${it.number}: ${it.description}`}
              className="[@media(pointer:coarse)]:mt-[calc((var(--lh-sm)-18px)/2-13px)]"
            />
            <label htmlFor={id} className="min-w-0 text-sm after:absolute after:inset-0 after:cursor-pointer">
              <span className="num mr-2 text-fg-muted">{it.number}</span>
              {it.description}
            </label>
          </li>
        )
      })}
    </ul>
  )
}

/** "Search or add a supplier", and the ones found or added so far, ticked. */
function FindAndAdded({ t, excludeIds }: { t: ReturnType<typeof useTicks>; excludeIds?: ReadonlySet<string> }) {
  return (
    <>
      {t.extras.length > 0 ? (
        <ul data-slot="added-suppliers">
          <li className="border-t bg-sunken px-5 py-2 text-base font-semibold">Added manually</li>
          {t.extras.map(a => {
            const id = `ask-${a.id}`
            return (
              <li key={a.id} className="relative flex min-w-0 items-center gap-3 border-t px-5 py-3">
                <Checkbox id={id} checked={t.addedTicked(a)} onCheckedChange={v => t.set(a.id, v === true)} aria-label={a.name} />
                <label htmlFor={id} className="min-w-0 text-sm font-medium after:absolute after:inset-0 after:cursor-pointer">
                  {a.name}
                  {a.city ? <span className="ml-2 text-xs font-regular text-fg-muted">{a.city}</span> : null}
                </label>
              </li>
            )
          })}
        </ul>
      ) : null}
      <div className="border-t px-5 py-3">
        <FindSupplier excludeIds={excludeIds} onPick={t.pick} />
      </div>
    </>
  )
}

function PickList({
  suggestions,
  isTicked,
  onTick,
  coverage,
  partial,
}: {
  suggestions: readonly SupplierSuggestion[]
  coverage?: string | null
  partial?: boolean
  isTicked: (s: SupplierSuggestion) => boolean
  onTick: (id: string, on: boolean) => void
}) {
  return (
    <ul>
      {coverage ? (
        <li className="border-b border-dashed px-5 py-3 text-base text-fg-2" data-coverage>
          {coverage}
        </li>
      ) : null}
      {partial ? (
        <li className="border-b border-dashed px-5 py-3">
          <PartialNote />
        </li>
      ) : null}
      {suggestions.map((s, n) => {
        const id = `ask-${s.supplierId}`
        const heading = n === 0 || suggestions[n - 1].groupKey !== s.groupKey
        return (
          <Fragment key={s.supplierId}>
          {heading ? <li className="border-t bg-sunken px-5 py-2 text-base font-semibold first:border-t-0">{s.groupLabel}</li> : null}
          <li className="relative grid gap-[2px] border-t px-5 py-3 first:border-t-0">
            <div className="flex min-w-0 items-center gap-3">
              <Checkbox id={id} checked={isTicked(s)} onCheckedChange={v => onTick(s.supplierId, v === true)} aria-label={s.name} />
              <label htmlFor={id} className="min-w-0 text-sm font-medium after:absolute after:inset-0 after:cursor-pointer">
                {s.name}
                {s.city ? <span className="ml-2 text-xs font-regular text-fg-muted">{s.city}</span> : null}
              </label>
            </div>
            {s.suppliedBefore ? (
              <p className="pl-[30px]">
                <span className="relative inline-flex min-h-chip items-center whitespace-nowrap rounded border border-tone-success-fg px-[6px] text-xs font-semibold text-tone-success-fg" data-badge="supplied-before">
                  Supplied this item before
                </span>
              </p>
            ) : null}
            <p className="pl-[30px] text-xs text-fg-muted">{s.reason}</p>
            {s.evidence ? (
              <p className="flex items-start gap-[6px] pl-[30px] text-xs text-fg-2" data-evidence>
                <Icon icon={FileCheck} size="chip" className="mt-[2px] text-fg-muted" />
                <span className="text-pretty">
                  <ReasonParts reason={s.evidence} />
                </span>
              </p>
            ) : null}
            {s.record ? (
              <p className={s.record.tone === 'warn' ? 'pl-[30px] text-xs font-medium text-tone-warning-fg' : 'pl-[30px] text-xs text-fg-2'} data-record>
                <ReasonParts reason={s.record} />
              </p>
            ) : null}
          </li>
          </Fragment>
        )
      })}
    </ul>
  )
}

function Empty({ coverage }: { coverage?: string | null }) {
  return (
    <p className="px-5 py-4 text-sm text-fg-muted">
      {coverage ?? 'No supplier on file deals in these categories or carries a brand in this RFQ yet.'} Add the brands a supplier carries on its company page, or ask anyone from{' '}
      <Link to="/companies" className="underline underline-offset-2">
        Companies
      </Link>
      .
    </p>
  )
}

export function SuppliersToAskCard({
  suggestions,
  items,
  busy,
  onAsk,
  onRecord,
  onReplyFrom,
  excludeIds,
  coverage,
  partial,
}: {
  /** A read behind the order failed. */
  partial?: boolean
  /** Undefined while they load. */
  suggestions: readonly SupplierSuggestion[] | undefined
  /** The coverage line: no supplier on file deals in a category of this RFQ. */
  coverage?: string | null
  items: readonly RfqItemRow[]
  busy: boolean
  /** Never found by "Search or add a supplier": the customer itself. */
  excludeIds?: ReadonlySet<string>
  /** The ticked suppliers and the ticked items: the message lists only those items. */
  onAsk: (ticked: readonly TickedSupplier[], items: readonly RfqItemRow[]) => void
  /** "Record as asked": the ticked suppliers are recorded as asked about the ticked items, nothing is copied. */
  onRecord: (ticked: readonly TickedSupplier[], items: readonly RfqItemRow[]) => void
  /** "Enter reply from another supplier"; left out for a person who does not see prices. */
  onReplyFrom?: () => void
}) {
  const t = useTicks(suggestions)
  const it = useItemTicks(items, () => true)
  const none = t.ticked.length === 0 || it.ticked.length === 0
  return (
    <DetailPanel title="Suppliers to ask" pill="suggested" dataSlot="suppliers-to-ask">
      {suggestions === undefined ? (
        <div role="status" className="grid gap-2 p-5" aria-busy="true" aria-label="Finding suppliers">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : (
        <>
          {suggestions.length === 0 ? <Empty coverage={coverage} /> : <PickList suggestions={suggestions} isTicked={t.isTicked} onTick={t.set} coverage={coverage} partial={partial} />}
          <FindAndAdded t={t} excludeIds={excludeIds} />
          <ItemPicks items={items} t={it} />
          <div className="flex flex-wrap items-center gap-2 border-t px-5 py-3">
            <Button icon={Copy} className="h-auto min-h-control whitespace-normal py-2 leading-snug text-left" busy={busy} busyLabel="Copying" disabled={none} onClick={() => onAsk(t.ticked, it.ticked)}>
              {t.ticked.length === 0 ? 'Tick a supplier to ask' : it.ticked.length === 0 ? 'Tick an item to ask about' : copyLabel(t.ticked.length)}
            </Button>
            <Button variant="quiet" icon={ClipboardCheck} disabled={none || busy} onClick={() => onRecord(t.ticked, it.ticked)}>
              Record as asked
            </Button>
            {onReplyFrom ? (
              <Button variant="quiet" icon={MessageSquareReply} className="h-auto min-h-control whitespace-normal py-2 leading-snug text-left" onClick={onReplyFrom}>
                Enter reply from another supplier
              </Button>
            ) : null}
          </div>
        </>
      )}
    </DetailPanel>
  )
}

/**
 * "Ask suppliers" / "Ask more suppliers": the same list in a dialog. The items that still need a price start ticked (all of them
 * when none does, or when `needing` is left out).
 */
export function FloatDialog({
  title = 'Ask more suppliers',
  suggestions,
  items,
  needing,
  busy,
  onAsk,
  onRecord,
  excludeIds,
  onClose,
  coverage,
  partial,
}: {
  title?: string
  excludeIds?: ReadonlySet<string>
  onRecord: (ticked: readonly TickedSupplier[], items: readonly RfqItemRow[]) => void
  partial?: boolean
  coverage?: string | null
  suggestions: readonly SupplierSuggestion[] | undefined
  items: readonly RfqItemRow[]
  /** The ids of the items that still need a price. */
  needing?: ReadonlySet<string>
  busy: boolean
  onAsk: (ticked: readonly TickedSupplier[], items: readonly RfqItemRow[]) => void
  onClose: () => void
}) {
  const t = useTicks(suggestions)
  const pre = needing && needing.size > 0 ? needing : null
  const it = useItemTicks(items, x => (pre ? pre.has(x.id) : true))
  const none = t.ticked.length === 0 || it.ticked.length === 0
  const itemCount = it.ticked.length
  return (
    <Dialog open busy={busy} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title={title}
        context={`${itemCount} ${itemCount === 1 ? 'item' : 'items'} in the message`}
        icon={Copy}
        footer={
          <>
            <Button data-cancel onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button icon={ClipboardCheck} disabled={none || busy} onClick={() => onRecord(t.ticked, it.ticked)}>
              Record as asked
            </Button>
            <Button variant="primary" icon={Copy} busy={busy} busyLabel="Copying" disabled={none} onClick={() => onAsk(t.ticked, it.ticked)}>
              {t.ticked.length === 0 ? 'Tick a supplier' : it.ticked.length === 0 ? 'Tick an item' : copyLabel(t.ticked.length)}
            </Button>
          </>
        }
      >
        {suggestions === undefined ? (
          <Skeleton className="h-[6rem]" />
        ) : (
          <div className="-mx-5 -my-2">
            {suggestions.length === 0 ? <Empty coverage={coverage} /> : <PickList suggestions={suggestions} isTicked={t.isTicked} onTick={t.set} coverage={coverage} partial={partial} />}
            <FindAndAdded t={t} excludeIds={excludeIds} />
            <ItemPicks items={items} t={it} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
