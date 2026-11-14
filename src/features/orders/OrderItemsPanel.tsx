import { useMemo, useRef, useState } from 'react'
import { Check, Pencil, Plus, SlidersHorizontal, Split, Trash2 } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { businessToday } from '@/lib/dates'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/form/Checkbox'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { DataTable, type Column } from '@/ui/DataTable'
import { Money } from '@/ui/Money'
import { useToast } from '@/ui/useToast'
import type { LegPo, OrderHeader, OrderItemRow, OrderLegRow } from '@/features/orders/api'
import { useSetGroupPrice, useSetItemRates, useUpdateItem } from '@/features/orders/hooks'
import { groupItems } from '@/features/orders/lib/splitGroups'
import { legState, type LegState } from '@/features/orders/lib/legModel'
import { gstOptions, isExemptAll, lineGstPaisa, lineNetPaisa, STANDARD_GST, unitWord } from '@/features/orders/lib/orderMath'
import { formatAmount, formatPaisa } from '@/lib/money'
import { lazyShown } from '@/lib/lazyDialog'
import { useEntryAccess } from '@/features/records/useEntryAccess'

// Downloaded the first time it opens, not with the order page (perf/lcp, lazyDialog.tsx).
const SplitLineDialog = lazyShown(() => import('@/features/orders/SplitLineDialog').then(m => m.SplitLineDialog))
const RemoveLineConfirm = lazyShown(() => import('@/features/orders/RemoveLine').then(m => m.RemoveLineConfirm))
const AddLineDialog = lazyShown(() => import('@/features/orders/AddDialogs').then(m => m.AddLineDialog))

/*
 * The order's items (O03; g2-order-detail.html "Items"), cut to five columns by the UX audit of 2026-10-19 (screens.md 8): Item, Qty,
 * Unit price, Total and Supplier. The item name has the room and wraps. Totals are before GST; the bar under the table gives the GST
 * and the total with GST (the same per-line figures as before: lineNetPaisa and lineGstPaisa, summed in paisa).
 *
 * The per-line controls are behind "Edit GST and lines": the GST rate select per line (DATA_MODEL 2.13), "Exempt the whole order from
 * GST" (one tap, Undo), the Service tick (a service has no supplier) and the row actions (Split line; Edit price on a split item, A8).
 *
 * Admin and sales see and edit the prices; an engineer is shown the lines (what, how many, which supplier) and no price, GST or supplier
 * figure: those columns are not even requested for them (DECISIONS 2026-10-15, O01/O03).
 *
 * A legacy order whose price basis is unknown shows the prices "as typed" (the mockup's "basis unknown" frame). Below 1024 the unit price
 * folds into the item line.
 */

interface Row extends OrderItemRow {
  /** A8: 'head' is the heading row of a split item (several order lines for one RFQ item), 'part' one of its lines. */
  kind: 'row' | 'head' | 'part'
  /** The number as drawn: 3, or 2a and 2b for the parts of a split item 2. */
  no: string
  partIndex?: number
  partCount?: number
  /** Head only: the order lines of the group. */
  members?: OrderItemRow[]
  groupPrice?: number | 'mixed' | null
}

/*
 * The items sit straight on the Order stop's card (mockup 41), not in a card of their own: no edge, corner or shadow, the first and last
 * columns flush with the stop's words, the total row a rule rather than a grey band.
 */
const FLAT = cn(
  'overflow-visible rounded-none border-0 bg-transparent shadow-none',
  '[&_[data-table-toolbar]]:border-0 [&_[data-table-toolbar]]:px-0 [&_[data-table-toolbar]]:pb-3 [&_[data-table-toolbar]]:pt-0',
  '[&_td:first-child]:pl-0 [&_th:first-child]:pl-0 [&_td:last-child]:pr-0 [&_th:last-child]:pr-0',
  '[&_tr[data-row-kind=foot]]:bg-transparent [&_tr[data-row-kind=foot]_td]:border-t-2 [&_tr[data-row-kind=foot]_td]:border-t-fg [&_tr[data-row-kind=foot]_td]:font-semibold',
  '[&_tr[data-card]]:px-0 [&_td[role=cell]]:px-0',
)

const STATE_WORDS: Record<LegState, string> = { 'to-place': 'not ordered yet', 'on-order': 'ordered', late: 'late', received: 'delivered', delivered: 'delivered' }

export function OrderItemsPanel({
  order,
  items,
  legs,
  money,
  canEdit,
  basisUnknown,
  pos = [],
}: {
  order: OrderHeader
  items: readonly OrderItemRow[]
  legs: readonly OrderLegRow[]
  money: boolean
  canEdit: boolean
  basisUnknown: boolean
  /** The latest PO of each supplier order: the Split line dialog warns when the line's PO is already issued. */
  pos?: readonly LegPo[]
}) {
  const orderId = order.id
  const { toast } = useToast()
  const today = businessToday()
  const updateItem = useUpdateItem(orderId)
  const setRates = useSetItemRates(orderId)
  const setGroupPrice = useSetGroupPrice(orderId)
  const [adding, setAdding] = useState(false)
  const [splitting, setSplitting] = useState<OrderItemRow | null>(null)
  const [removing, setRemoving] = useState<OrderItemRow | null>(null)
  /** "Edit GST and lines": the per-line controls are shown only while this is on. */
  const [editing, setEditing] = useState(false)
  /** The split item whose selling price is being edited (once for all its parts). */
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [groupDraft, setGroupDraft] = useState<number | null>(null)
  /** The rates before "exempt all", so turning it off puts every line back where it was (this session). */
  const remembered = useRef<Map<string, number>>(new Map())

  const rows: Row[] = useMemo(
    () =>
      groupItems(items).map((d): Row => {
        if (d.kind === 'row') return { ...d.item, kind: 'row', no: d.no }
        if (d.kind === 'part') return { ...d.item, kind: 'part', no: d.no, partIndex: d.partIndex, partCount: d.partCount }
        const first = d.members[0]
        return { ...first, id: d.key, kind: 'head', no: d.no, qty: d.qty, unitPriceNet: typeof d.unitPriceNet === 'number' ? d.unitPriceNet : null, groupPrice: d.unitPriceNet, members: d.members }
      }),
    [items],
  )
  const legOf = (r: Row) => legs.find(l => l.id === r.legId)
  // HW-14: a fully invoiced order's lines are what its invoices (and payments) were made from. Changing a price, quantity or
  // GST there would silently turn it part-invoiced and owing again, so its lines are locked; Add line stays, for an extra.
  const invoicedLock = money && order.state?.invoicing === 'fully_invoiced'
  // Whose entry it is (0092): somebody else's order keeps its prices and GST closed to this person, and says why instead of failing on save.
  const entry = useEntryAccess({ createdBy: order.createdBy ?? null, ownerId: order.owner?.id ?? null })
  const notYours = money && canEdit && !basisUnknown && !invoicedLock && !entry.can
  const editable = money && canEdit && !basisUnknown && !invoicedLock && entry.can
  const showEdit = editable && editing
  const exempt = money && !basisUnknown && isExemptAll(items.map(i => ({ gstRate: i.gstRate ?? STANDARD_GST })))
  const fail = (title: string) => (err: unknown) => toast({ title, body: mapPgError(err, { entity: 'item' }).message, tone: 'danger' })

  const toggleExempt = async (on: boolean) => {
    const before = items.map(i => ({ id: i.id, gstRate: i.gstRate ?? STANDARD_GST }))
    const next = on ? before.map(b => ({ id: b.id, gstRate: 0 })) : before.map(b => ({ id: b.id, gstRate: remembered.current.get(b.id) ?? STANDARD_GST }))
    if (on) before.forEach(b => remembered.current.set(b.id, b.gstRate))
    try {
      await setRates.mutateAsync(next)
      toast({
        title: on ? 'Order exempted from GST' : 'GST restored on every line',
        body: `${items.length} ${items.length === 1 ? 'line' : 'lines'}`,
        undo: {
          onUndo: async () => {
            await setRates.mutateAsync(before)
          },
          settledTitle: on ? 'Order exempted from GST' : 'GST restored on every line',
          undoneTitle: 'Put back as it was',
        },
      })
    } catch (err) {
      fail('Could not change the GST')(err)
    }
  }

  const rate = (r: Row) => r.gstRate ?? STANDARD_GST
  // The heading row of a split item carries no amounts of its own: its parts do, so the totals never count a split item twice.
  const netPaisa = (r: Row) => (r.kind === 'head' || r.unitPriceNet === null ? null : lineNetPaisa({ qty: r.qty, unitPriceNet: r.unitPriceNet }))
  const gstPaisa = (r: Row) => (r.kind === 'head' || r.unitPriceNet === null ? null : lineGstPaisa({ qty: r.qty, unitPriceNet: r.unitPriceNet, gstRate: rate(r) }))
  const net = (r: Row) => {
    const p = netPaisa(r)
    return p === null ? null : p / 100
  }
  const saveGroup = async (r: Row) => {
    if (groupDraft === null || groupDraft <= 0 || !r.members) return setEditingGroup(null)
    try {
      await setGroupPrice.mutateAsync({ ids: r.members.map(m => m.id), unitPriceNet: groupDraft })
      toast({ title: 'Selling price changed', body: `${r.description}: ${formatAmount(groupDraft)} before GST on every part` })
      setEditingGroup(null)
    } catch (err) {
      fail('Could not change the price')(err)
    }
  }
  const canSplit = (r: Row) => editable && r.kind !== 'head' && !r.isService && r.legId !== null && r.qty > 1
  const startGroupEdit = (r: Row) => {
    setGroupDraft(typeof r.groupPrice === 'number' ? r.groupPrice : null)
    setEditingGroup(r.id)
  }

  /** "Dubai Instrumentation · on order", and for admin and sales the supplier's price ("EUR 214 each"). */
  const supplierCell = (r: Row) => {
    if (r.kind === 'head') return <span className="text-fg-muted">{`${r.members?.length ?? 0} suppliers`}</span>
    if (r.isService) return <span className="text-fg-muted">Service</span>
    const leg = legOf(r)
    if (!leg) return <span className="text-fg-muted">No supplier yet</span>
    const st = legState({ placedOn: leg.placedOn, expectedOn: leg.expectedOn, receivedOn: leg.receivedOn, deliveredOn: leg.deliveredOn }, today)
    return (
      <span className="grid max-w-[14rem] gap-px whitespace-normal">
        <span className="break-words font-regular text-fg">
          {leg.supplierName}
        </span>
        <span className="text-xs font-regular text-fg-muted">
          <span className={cn(st === 'late' && 'font-medium text-tone-danger-fg')}>{STATE_WORDS[st]}</span>
          {money ? (
            r.supplierUnitPrice === null ? (
              ` · ${basisUnknown ? 'price not recorded' : 'price not set'}`
            ) : (
              <>
                {' · '}
                <span className="num">{`${leg.currency ?? ''} ${formatAmount(r.supplierUnitPrice)}`}</span> each
              </>
            )
          ) : null}
        </span>
      </span>
    )
  }

  /**
   * A split item's one selling price (A8), edited in the item cell so it works at every width (the Unit price column is hidden below
   * 1024): the amount, Save and Cancel. Enter saves, Escape cancels.
   */
  const groupEditor = (r: Row) => (
    <span className="flex flex-wrap items-center gap-2" role="group" aria-label={`Selling price, ${r.description}`}>
      <NumberInput
        value={groupDraft}
        onChange={setGroupDraft}
        aria-label={`Selling price before GST, PKR, ${r.description}`}
        data-autofocus
        autoFocus
        className="w-[10rem]"
        onKeyDown={e => {
          if (e.key === 'Enter') void saveGroup(r)
          if (e.key === 'Escape') {
            e.stopPropagation()
            setEditingGroup(null)
          }
        }}
      />
      <Button size="sm" variant="primary" onClick={() => void saveGroup(r)} busy={setGroupPrice.isPending} busyLabel="Saving" aria-label={`Save price, ${r.description}`}>
        Save
      </Button>
      <Button size="sm" variant="quiet" onClick={() => setEditingGroup(null)} aria-label="Cancel price edit">
        Cancel
      </Button>
    </span>
  )
  const groupPriceText = (r: Row) =>
    r.groupPrice === 'mixed' ? <span className="text-fg-muted">Mixed</span> : r.unitPriceNet === null ? <span className="text-fg-muted">Not set</span> : <span className="num">{formatAmount(r.unitPriceNet)}</span>
  const itemCell = (r: Row) => (
    <span className="grid min-w-[12rem] grid-cols-[1.5rem_minmax(0,1fr)] items-baseline gap-x-2 whitespace-normal">
      <span className="num text-sm font-regular text-fg-muted">{r.no}</span>
      {r.kind === 'head' ? (
        <span className="grid min-w-0 gap-px">
          <span className="break-words font-medium">
            {r.description}
          </span>
          <span className="inline-flex w-fit items-center gap-1 text-xs font-regular text-fg-muted">
            <Split size={12} aria-hidden="true" />
            split across {r.members?.length ?? 0} suppliers
          </span>
          {editingGroup === r.id ? (
            groupEditor(r)
          ) : money ? (
            // below 1024 the Unit price column is hidden: the one selling price, and its edit, sit here
            <span className="inline-flex items-center gap-1 text-sm lg:hidden">
              {groupPriceText(r)} <span className="text-fg-muted">each</span>
              {editable && !showEdit ? <Button size="sm" variant="quiet" icon={Pencil} aria-label={`Edit price, ${r.description}`} onClick={() => startGroupEdit(r)} /> : null}
            </span>
          ) : null}
        </span>
      ) : r.kind === 'part' ? (
        <span className="grid min-w-0 gap-px">
          <span className="font-regular text-fg-2">
            Part {(r.partIndex ?? 0) + 1} of {r.partCount}
          </span>
          {[r.brandName, r.model].filter(Boolean).length ? <span className="text-xs font-regular text-fg-muted">{[r.brandName, r.model].filter(Boolean).join(' · ')}</span> : null}
        </span>
      ) : (
        <span className="grid min-w-0 gap-px">
          <span className="break-words font-medium">
            {r.description}
          </span>
          <span className="text-xs font-regular text-fg-muted">
            {r.isService ? 'Service' : [r.brandName, r.model].filter(Boolean).join(' · ')}
            {/* below 1024 the unit price folds into the item line */}
            {money && r.unitPriceNet !== null ? (
              <span className="num lg:hidden">
                {r.isService || r.brandName || r.model ? ' · ' : ''}
                {formatAmount(r.unitPriceNet)} each{basisUnknown ? ', as typed' : ''}
              </span>
            ) : null}
            {money && !basisUnknown && !showEdit && rate(r) !== STANDARD_GST ? <span>{` · GST ${rate(r)}%`}</span> : null}
          </span>
        </span>
      )}
    </span>
  )
  const qtyCell = (r: Row) => (
    <span className="num font-regular">
      {r.qty}
      {r.unit ? <span className="text-fg-muted"> {unitWord(r.qty, r.unit)}</span> : null}
    </span>
  )

  const unitCol: Column<Row> = {
    id: 'unit',
    header: basisUnknown ? 'Unit price as typed (PKR)' : 'Unit price (PKR)',
    kind: 'money',
    value: r => r.unitPriceNet,
    cell: r =>
      r.kind !== 'head' ? (
        <Money value={r.unitPriceNet} prefix={false} className="font-regular text-fg-2" />
      ) : (
        <span className="inline-flex items-center justify-end gap-1">
          {groupPriceText(r)}
          {/* a split item's one selling price stays one tap away (A8); the editor opens in the item cell; in edit mode the row's own Edit price does it */}
          {editable && !showEdit && editingGroup !== r.id ? <Button size="sm" variant="quiet" icon={Pencil} aria-label={`Edit price, ${r.description}`} onClick={() => startGroupEdit(r)} /> : null}
        </span>
      ),
    hideBelowLg: true,
  }
  // The line total is the figure that counts: heavier than the unit price beside it (mockup 41).
  const totalCol: Column<Row> = {
    id: 'net',
    header: basisUnknown ? 'Total as typed (PKR)' : 'Total (PKR)',
    kind: 'money',
    value: net,
    total: true,
    cell: r => (net(r) === null ? null : <Money value={net(r)} prefix={false} strong className="font-semibold text-fg" />),
  }
  const gstCol: Column<Row> = {
    id: 'gst',
    header: 'GST',
    kind: 'num',
    value: r => rate(r),
    cell: r =>
      r.kind === 'head' ? null : (
        <Select
          aria-label={`GST rate, line ${r.number}`}
          value={String(rate(r))}
          onChange={e => updateItem.mutate({ id: r.id, patch: { gst_rate: Number(e.target.value) } }, { onError: fail('Could not change the GST') })}
          options={gstOptions(rate(r))}
          className="w-[7.5rem]"
        />
      ),
  }
  const serviceCol: Column<Row> = {
    id: 'service',
    header: 'Service',
    cell: (r: Row) =>
      r.kind === 'head' ? null : (
        <Checkbox
          aria-label={`Service, line ${r.number}`}
          checked={r.isService}
          onCheckedChange={v => updateItem.mutate({ id: r.id, patch: v === true ? { is_service: true, supplier_order_id: null } : { is_service: false } }, { onError: fail('Could not change the line') })}
        />
      ),
  }
  /** The row actions (A8): Split line on any goods line with more than one unit; Edit price on the heading of a split item. */
  const actionsCol: Column<Row> = {
    id: 'actions',
    header: 'Actions',
    hiddenHeader: true,
    cell: r =>
      r.kind === 'head' ? (
        editingGroup === r.id ? null : (
          <Button size="sm" variant="quiet" icon={Pencil} aria-label={`Edit price, ${r.description}`} onClick={() => startGroupEdit(r)}>
            Edit price
          </Button>
        )
      ) : (
        <span className="inline-flex flex-wrap items-center gap-2">
          {canSplit(r) ? (
            <Button size="sm" variant="quiet" icon={Split} aria-label={`Split line ${r.no}`} onClick={() => setSplitting(r)}>
              Split line
            </Button>
          ) : null}
          <Button size="sm" variant="quiet" icon={Trash2} aria-label={`Remove line ${r.no}`} onClick={() => setRemoving(r)}>
            Remove line
          </Button>
        </span>
      ),
  }
  const base: Column<Row>[] = [
    { id: 'item', header: 'Item', value: r => r.description, cell: itemCell },
    { id: 'qty', header: 'Qty', kind: 'num', align: 'left', value: r => r.qty, cell: qtyCell },
  ]
  const supplierCol: Column<Row> = { id: 'supplier', header: 'Supplier', cell: supplierCell, hideBelowMd: true }
  const columns = !money ? [...base, supplierCol] : showEdit ? [...base, unitCol, gstCol, totalCol, serviceCol, actionsCol] : [...base, unitCol, totalCol, supplierCol]

  // The bar under the table: GST and the total with GST, in paisa from the same per-line figures as the Total column.
  const priced = rows.filter(r => netPaisa(r) !== null)
  const netSum = priced.reduce((n, r) => n + (netPaisa(r) as number), 0)
  const gstSum = priced.reduce((n, r) => n + (gstPaisa(r) as number), 0)
  // The GST line sits under the total, right-aligned with the figures (mockup 41), not in the table's own status band.
  const summary = money ? (
    basisUnknown ? (
      'Prices as typed in the old CRM: it did not say whether they include GST'
    ) : priced.length > 0 ? (
      <span className="num text-sm text-fg-2" data-testid="items-gst-summary">
        <span className="font-sans">GST</span> {formatPaisa(BigInt(gstSum), 'auto')} <span className="font-sans">· Total with GST</span> <b className="font-medium text-fg">{formatPaisa(BigInt(netSum + gstSum), 'auto')}</b>
      </span>
    ) : undefined
  ) : undefined

  return (
    <section aria-label="Items" className="min-w-0">
      <DataTable
        label="Order items"
        columns={columns}
        rows={rows}
        getRowId={r => r.id}
        twoLine
        footerLabel={basisUnknown ? 'Total as typed' : `Total before GST, ${items.length} ${items.length === 1 ? 'line' : 'lines'}`}
        className={FLAT}
        toolbar={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-base font-semibold">Items</h2>
            <span className="text-sm text-fg-muted">
              {items.length} {items.length === 1 ? 'line' : 'lines'}
              {rows.some(r => r.kind === 'head') ? ` from ${rows.filter(r => r.kind !== 'part').length} items` : ''}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-2">
              {showEdit && rows.length > 0 ? (
                <Checkbox label="Exempt the whole order from GST" checked={exempt} onCheckedChange={v => void toggleExempt(v === true)} disabled={setRates.isPending} />
              ) : null}
              {editable && rows.length > 0 ? (
                <Button size="sm" variant={editing ? 'secondary' : 'quiet'} icon={editing ? Check : SlidersHorizontal} aria-pressed={editing} onClick={() => setEditing(e => !e)}>
                  {editing ? 'Done editing' : 'Edit GST and lines'}
                </Button>
              ) : null}
              {notYours && rows.length > 0 && entry.note ? (
                <>
                  <span className="text-base text-fg-2" role="note" data-slot="not-yours">
                    {entry.note}
                  </span>
                  <Button size="sm" variant="quiet" icon={SlidersHorizontal} disabled>
                    Edit GST and lines
                  </Button>
                </>
              ) : null}
              {invoicedLock && canEdit && rows.length > 0 ? (
                <span className="text-sm text-fg-muted" role="note">
                  Fully invoiced, so prices and GST are locked to match the invoices. Add a line for anything extra.
                </span>
              ) : null}
              {money && canEdit ? (
                <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>
                  Add line
                </Button>
              ) : null}
            </div>
          </div>
        }
        mobileRow={r =>
          // The phone card (mockup 41): the line number in its own column so every line of words starts at one edge; the line total on the
          // right in mono; quantity times the unit price, then who supplies it. In edit mode the GST choice, Service and the row actions follow.
          r.kind === 'head' ? (
            <span className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2 gap-y-1">
              <span className="num pt-px text-sm text-fg-muted">{r.no}</span>
              <span className="grid min-w-0 gap-1">
                <span className="break-words font-medium">{r.description}</span>
                <span className="inline-flex flex-wrap items-center gap-x-1 text-sm text-fg-muted">
                  <span className="num">{r.qty}</span>
                  {r.unit ? ` ${unitWord(r.qty, r.unit)}` : ''}
                  <Split size={12} aria-hidden="true" className="ml-1" /> split across {r.members?.length ?? 0} suppliers
                </span>
                {money ? (
                  <span className="text-sm text-fg-2">
                    {groupPriceText(r)} <span className="text-fg-muted">each</span>
                  </span>
                ) : null}
                {editable ? (
                  editingGroup === r.id ? (
                    groupEditor(r)
                  ) : (
                    <Button size="sm" variant="quiet" icon={Pencil} className="justify-self-start" aria-label={`Edit price, ${r.description}`} onClick={() => startGroupEdit(r)}>
                      Edit price
                    </Button>
                  )
                ) : null}
              </span>
            </span>
          ) : (
            <span className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-x-2">
              <span className="num pt-px text-sm text-fg-muted">{r.no}</span>
              <span className="grid min-w-0 gap-1">
                <span className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words font-medium">{r.kind === 'part' ? `${r.description}, part ${(r.partIndex ?? 0) + 1} of ${r.partCount}` : r.description}</span>
                  {money && net(r) !== null ? <span className="num shrink-0 font-semibold">{formatAmount(net(r) as number)}</span> : null}
                </span>
                {r.isService || r.brandName || r.model ? (
                  <span className="text-xs text-fg-muted">{r.isService ? 'Service' : [r.brandName, r.model].filter(Boolean).join(' · ')}</span>
                ) : null}
                <span className="text-sm text-fg-2">
                  <span className="num">{r.qty}</span>
                  {r.unit ? ` ${unitWord(r.qty, r.unit)}` : ''}
                  {money && r.unitPriceNet !== null ? (
                    <>
                      <span className="text-fg-muted"> × </span>
                      <span className="num">{formatAmount(r.unitPriceNet)}</span>
                      <span className="text-fg-muted">{basisUnknown ? ' each, as typed' : ' each'}</span>
                    </>
                  ) : null}
                  {money && !basisUnknown && !showEdit && rate(r) !== STANDARD_GST ? <span className="text-fg-muted">{` · GST ${rate(r)}%`}</span> : null}
                </span>
                {r.isService ? null : <span className="text-sm">{supplierCell(r)}</span>}
                {showEdit ? (
                  <span className="mt-1 grid gap-2 border-t pt-3">
                    <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      {gstCol.cell?.(r)}
                      <Checkbox
                        label="Service"
                        aria-label={`Service, line ${r.number}`}
                        checked={r.isService}
                        onCheckedChange={v => updateItem.mutate({ id: r.id, patch: v === true ? { is_service: true, supplier_order_id: null } : { is_service: false } }, { onError: fail('Could not change the line') })}
                      />
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      {canSplit(r) ? (
                        <Button size="sm" variant="quiet" icon={Split} aria-label={`Split line ${r.no}`} onClick={() => setSplitting(r)}>
                          Split line
                        </Button>
                      ) : null}
                      <Button size="sm" variant="quiet" icon={Trash2} aria-label={`Remove line ${r.no}`} onClick={() => setRemoving(r)}>
                        Remove line
                      </Button>
                    </span>
                  </span>
                ) : null}
              </span>
            </span>
          )
        }
        empty={<p className="py-6 text-base text-fg-muted">This order has no lines yet. Add one to start.</p>}
      />
      {/* Below 640 the table is cards and has no total row of its own: the same total, under a rule, so the phone reads it too. */}
      {money && priced.length > 0 ? (
        <p className="flex items-baseline justify-between gap-3 border-t-2 border-t-fg pt-3 font-semibold sm:hidden">
          <span>{basisUnknown ? 'Total as typed' : `Total before GST, ${items.length} ${items.length === 1 ? 'line' : 'lines'}`}</span>
          <span className="num">{formatPaisa(BigInt(netSum), 'auto')}</span>
        </p>
      ) : null}
      {summary ? <p className="mt-2 text-right text-sm text-fg-2 [overflow-wrap:anywhere]">{summary}</p> : null}
      {adding ? <AddLineDialog order={order} items={items} legs={legs} onClose={() => setAdding(false)} /> : null}
      {removing ? <RemoveLineConfirm orderId={orderId} line={removing} lineCount={items.length} onClose={() => setRemoving(null)} /> : null}
      {splitting ? <SplitLineDialog order={order} item={items.find(i => i.id === splitting.id) ?? splitting} legs={legs} pos={pos} onClose={() => setSplitting(null)} /> : null}
    </section>
  )
}
