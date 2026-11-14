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
import { PICK_BLEED, PICK_BOX, PICK_GROUP, PICK_NOTE, PICK_ROW, QuietChip, SuppliedBeforeChip } from '@/features/rfqs/supplierLook'
import { cn } from '@/lib/utils'
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

/** "Items to ask about": one tick per item, in its own box under the suppliers. Not shown for an RFQ with one item (there is nothing to choose). */
function ItemPicks({ items, t, bleed }: { items: readonly RfqItemRow[]; t: ReturnType<typeof useItemTicks>; bleed?: boolean }) {
  if (items.length < 2) return null
  return (
    <ul data-slot="ask-items" aria-label="Items to ask about" className={cn(PICK_BOX, bleed && PICK_BLEED)}>
      <li className={PICK_GROUP}>
        Items to ask about <span className="num font-regular text-fg-muted">{`· ${t.ticked.length} of ${items.length}`}</span>
      </li>
      {items.map(it => {
        const id = `ask-item-${it.id}`
        return (
          <li key={it.id} className={cn(PICK_ROW, 'py-2')}>
            <Checkbox id={id} checked={t.isTicked(it)} onCheckedChange={v => t.set(it.id, v === true)} aria-label={`Item ${it.number}: ${it.description}`} />
            <label htmlFor={id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-2 text-base [overflow-wrap:anywhere] after:absolute after:inset-0 after:cursor-pointer">
              <span className="num text-fg-muted">{it.number}</span>
              <span>{it.description}</span>
            </label>
          </li>
        )
      })}
    </ul>
  )
}

/** The name, and the city on its own line under it (.qb-pick__who). */
function Who({ id, name, city }: { id: string; name: string; city?: string | null }) {
  return (
    <label htmlFor={id} className="grid min-w-0 gap-px [overflow-wrap:anywhere] after:absolute after:inset-0 after:cursor-pointer">
      <span className="type-row">{name}</span>
      {city ? <span className="text-sm text-fg-muted">{city}</span> : null}
    </label>
  )
}

/** The suppliers found or added with "Search or add a supplier", ticked, under "Added manually" (inside the pick box). */
function Added({ t }: { t: ReturnType<typeof useTicks> }) {
  if (t.extras.length === 0) return null
  return (
    <ul data-slot="added-suppliers" className="border-t first:border-t-0">
      <li className={PICK_GROUP}>Added manually</li>
      {t.extras.map(a => {
        const id = `ask-${a.id}`
        return (
          <li key={a.id} className={PICK_ROW}>
            <Checkbox id={id} checked={t.addedTicked(a)} onCheckedChange={v => t.set(a.id, v === true)} aria-label={a.name} />
            <Who id={id} name={a.name} city={a.city} />
          </li>
        )
      })}
    </ul>
  )
}

function PickRows({ suggestions, isTicked, onTick }: { suggestions: readonly SupplierSuggestion[]; isTicked: (s: SupplierSuggestion) => boolean; onTick: (id: string, on: boolean) => void }) {
  return (
    <ul className="border-t first:border-t-0">
      {suggestions.map((s, n) => {
        const id = `ask-${s.supplierId}`
        const heading = n === 0 || suggestions[n - 1].groupKey !== s.groupKey
        return (
          <Fragment key={s.supplierId}>
            {heading ? <li className={PICK_GROUP}>{s.groupLabel}</li> : null}
            <li className={PICK_ROW}>
              <Checkbox id={id} checked={isTicked(s)} onCheckedChange={v => onTick(s.supplierId, v === true)} aria-label={s.name} />
              <div className="grid min-w-0 gap-1">
                <Who id={id} name={s.name} city={s.city} />
                {s.suppliedBefore ? <SuppliedBeforeChip /> : null}
                <p className="text-sm text-fg-2 [overflow-wrap:anywhere]">{s.reason}</p>
                {s.evidence ? (
                  <p className="flex items-start gap-2 text-sm text-fg-2" data-evidence>
                    <Icon icon={FileCheck} size="sm" className="mt-1 text-fg-muted" />
                    <span className="min-w-0 text-pretty">
                      <ReasonParts reason={s.evidence} />
                    </span>
                  </p>
                ) : null}
                {s.record ? (
                  <p className={s.record.tone === 'warn' ? 'text-sm font-medium text-tone-warning-fg' : 'text-sm text-fg-muted'} data-record>
                    <ReasonParts reason={s.record} />
                  </p>
                ) : null}
              </div>
            </li>
          </Fragment>
        )
      })}
    </ul>
  )
}

/** The suppliers in one hairline box: the coverage line, the suggestions under their reason headings, the ones added by hand. */
function PickBox({
  suggestions,
  t,
  coverage,
  partial,
  bleed,
}: {
  suggestions: readonly SupplierSuggestion[]
  t: ReturnType<typeof useTicks>
  coverage?: string | null
  partial?: boolean
  bleed?: boolean
}) {
  if (suggestions.length === 0 && t.extras.length === 0) return <Empty coverage={coverage} bleed={bleed} />
  return (
    <div className={cn(PICK_BOX, bleed && PICK_BLEED)} data-pick>
      {suggestions.length === 0 ? (
        <Empty coverage={coverage} inBox />
      ) : (
        <>
          {coverage ? (
            <p className={PICK_NOTE} data-coverage>
              {coverage}
            </p>
          ) : null}
          {partial ? (
            <div className={PICK_NOTE}>
              <PartialNote />
            </div>
          ) : null}
          <PickRows suggestions={suggestions} isTicked={t.isTicked} onTick={t.set} />
        </>
      )}
      <Added t={t} />
    </div>
  )
}

/** Shaped like the list it waits for: a heading band and two supplier rows. */
function PickSkeleton({ bleed }: { bleed?: boolean }) {
  return (
    <div role="status" aria-busy="true" aria-label="Finding suppliers" className={cn(PICK_BOX, bleed && PICK_BLEED)}>
      <div className="bg-deep px-4 py-2">
        <Skeleton className="h-5 w-1/3" />
      </div>
      {[0, 1].map(n => (
        <div key={n} className={PICK_ROW}>
          <Skeleton className="size-6" />
          <div className="grid gap-2">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

function Empty({ coverage, inBox, bleed }: { coverage?: string | null; inBox?: boolean; bleed?: boolean }) {
  return (
    <p className={cn('text-base text-fg-muted', inBox ? 'px-4 py-3' : cn('rounded-control border border-dashed px-4 py-3', bleed && 'mx-card'))} data-empty>
      {coverage ?? 'No supplier on file deals in these categories or carries a brand in this RFQ yet.'} Add the brands a supplier carries on its company page, or ask anyone from{' '}
      <Link to="/companies" className="font-medium text-primary underline underline-offset-2">
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
    <DetailPanel title="Suppliers to ask" tip={<QuietChip className="ml-2">suggested</QuietChip>} dataSlot="suppliers-to-ask">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 pt-4">
        {suggestions === undefined ? (
          <PickSkeleton />
        ) : (
          <>
            <PickBox suggestions={suggestions} t={t} coverage={coverage} partial={partial} />
            <FindSupplier excludeIds={excludeIds} onPick={t.pick} />
            <ItemPicks items={items} t={it} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <Button icon={Copy} className="h-auto min-h-control whitespace-normal py-2 text-left leading-snug" busy={busy} busyLabel="Copying" disabled={none} onClick={() => onAsk(t.ticked, it.ticked)}>
                {t.ticked.length === 0 ? 'Tick a supplier to ask' : it.ticked.length === 0 ? 'Tick an item to ask about' : copyLabel(t.ticked.length)}
              </Button>
              <Button variant="quiet" icon={ClipboardCheck} disabled={none || busy} onClick={() => onRecord(t.ticked, it.ticked)}>
                Record as asked
              </Button>
              {onReplyFrom ? (
                <Button variant="quiet" icon={MessageSquareReply} className="h-auto min-h-control whitespace-normal py-2 text-left leading-snug" onClick={onReplyFrom}>
                  Enter reply from another supplier
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>
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
          <div className="-mx-card">
            <PickSkeleton bleed />
          </div>
        ) : (
          <>
            <div className="-mx-card">
              <PickBox suggestions={suggestions} t={t} coverage={coverage} partial={partial} bleed />
            </div>
            <FindSupplier excludeIds={excludeIds} onPick={t.pick} />
            {items.length > 1 ? (
              <div className="-mx-card">
                <ItemPicks items={items} t={it} bleed />
              </div>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
