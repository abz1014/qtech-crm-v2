import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Copy, FileCheck } from 'lucide-react'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Checkbox } from '@/ui/form/Checkbox'
import { Icon } from '@/ui/Icon'
import { Skeleton } from '@/ui/Skeleton'
import { ReasonParts } from '@/features/rfqs/ranking/RankParts'
import type { RfqItemRow } from '@/features/rfqs/api'
import { DetailPanel } from '@/features/rfqs/DetailPanel'
import type { SupplierSuggestion } from '@/features/rfqs/lib'

/*
 * "Suppliers to ask" (g2-rfq-detail, empty state): the suggested suppliers with the reason for each, the ones who supplied the
 * item before already ticked, and one button that copies a message listing every item and records the asking. The same list
 * is what "Ask suppliers" (the page's green button while nobody is asked) and "Ask more suppliers" open in a dialog. Suggestions
 * come from R03 (the reasons) and R17 (the memory); nothing is scored. Inside a reason the supplier with the better record comes
 * first (A8), and the order behind it is cited (number, the date we placed it, days to delivery).
 * The card's button is not green: the page has one green button, and while nobody is asked it is the header's Ask suppliers.
 */
const copyLabel = (n: number) => `Copy message for ${n} ${n === 1 ? 'supplier' : 'suppliers'}`

/** The ticked suppliers, starting with the pre-ticked ones; a tick or untick by hand is kept. */
function useTicks(suggestions: readonly SupplierSuggestion[] | undefined) {
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const isTicked = (s: SupplierSuggestion) => touched[s.supplierId] ?? s.preTicked
  const ticked = (suggestions ?? []).filter(isTicked)
  return { isTicked, ticked, set: (id: string, on: boolean) => setTouched(t => ({ ...t, [id]: on })) }
}

function PickList({
  suggestions,
  isTicked,
  onTick,
}: {
  suggestions: readonly SupplierSuggestion[]
  isTicked: (s: SupplierSuggestion) => boolean
  onTick: (id: string, on: boolean) => void
}) {
  return (
    <ul>
      {suggestions.map(s => {
        const id = `ask-${s.supplierId}`
        return (
          <li key={s.supplierId} className="relative grid gap-[2px] border-t px-5 py-3 first:border-t-0">
            <div className="flex min-w-0 items-center gap-3">
              <Checkbox id={id} checked={isTicked(s)} onCheckedChange={v => onTick(s.supplierId, v === true)} aria-label={s.name} />
              <label htmlFor={id} className="min-w-0 text-sm font-medium after:absolute after:inset-0 after:cursor-pointer">
                {s.name}
                {s.city ? <span className="ml-2 text-xs font-regular text-fg-muted">{s.city}</span> : null}
              </label>
            </div>
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
        )
      })}
    </ul>
  )
}

function Empty() {
  return (
    <p className="px-5 py-4 text-sm text-fg-muted">
      No supplier on file carries a brand in this RFQ yet. Add the brands a supplier carries on its company page, or ask anyone from{' '}
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
}: {
  /** Undefined while they load. */
  suggestions: readonly SupplierSuggestion[] | undefined
  items: readonly RfqItemRow[]
  busy: boolean
  onAsk: (ticked: readonly SupplierSuggestion[]) => void
}) {
  const t = useTicks(suggestions)
  return (
    <DetailPanel title="Suppliers to ask" pill="suggested" dataSlot="suppliers-to-ask">
      {suggestions === undefined ? (
        <div role="status" className="grid gap-2 p-5" aria-busy="true" aria-label="Finding suppliers">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : suggestions.length === 0 ? (
        <Empty />
      ) : (
        <>
          <PickList suggestions={suggestions} isTicked={t.isTicked} onTick={t.set} />
          <div className="border-t px-5 py-3">
            <Button icon={Copy} busy={busy} busyLabel="Copying" disabled={t.ticked.length === 0 || items.length === 0} onClick={() => onAsk(t.ticked)}>
              {t.ticked.length === 0 ? 'Tick a supplier to ask' : copyLabel(t.ticked.length)}
            </Button>
          </div>
        </>
      )}
    </DetailPanel>
  )
}

/** "Ask suppliers" / "Ask more suppliers": the same list in a dialog, for the items that still need a price (all of them when none does). */
export function FloatDialog({
  title = 'Ask more suppliers',
  suggestions,
  itemCount,
  busy,
  onAsk,
  onClose,
}: {
  title?: string
  suggestions: readonly SupplierSuggestion[] | undefined
  itemCount: number
  busy: boolean
  onAsk: (ticked: readonly SupplierSuggestion[]) => void
  onClose: () => void
}) {
  const t = useTicks(suggestions)
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
            <Button variant="primary" icon={Copy} busy={busy} busyLabel="Copying" disabled={t.ticked.length === 0} onClick={() => onAsk(t.ticked)}>
              {t.ticked.length === 0 ? 'Tick a supplier' : copyLabel(t.ticked.length)}
            </Button>
          </>
        }
      >
        {suggestions === undefined ? (
          <Skeleton className="h-24" />
        ) : suggestions.length === 0 ? (
          <Empty />
        ) : (
          <div className="-mx-5 -my-2">
            <PickList suggestions={suggestions} isTicked={t.isTicked} onTick={t.set} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
