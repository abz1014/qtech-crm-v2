import { useMemo, useRef, useState } from 'react'
import { Pencil, Plus, Split } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/form/Checkbox'
import { NumberInput } from '@/ui/form/NumberInput'
import { Select } from '@/ui/form/Select'
import { DataTable, type Column } from '@/ui/DataTable'
import { useToast } from '@/ui/useToast'
import type { LegPo, OrderHeader, OrderItemRow, OrderLegRow } from '@/features/orders/api'
import { useSetGroupPrice, useSetItemRates, useUpdateItem } from '@/features/orders/hooks'
import { SplitLineDialog } from '@/features/orders/SplitLineDialog'
import { groupItems } from '@/features/orders/lib/splitGroups'
import { AddLineDialog } from '@/features/orders/AddDialogs'
import { legLetter } from '@/features/orders/lib/legModel'
import { isExemptAll, lineGstPaisa, lineNetPaisa, STANDARD_GST } from '@/features/orders/lib/orderMath'
import { formatAmount } from '@/lib/money'

/*
 * The order's items (O03; g2-order-detail.html "Items"). GST is per line (DATA_MODEL 2.13): each line's rate is a small select, and
 * "Exempt the whole order from GST" sets every line to 0 in one tap (and back, with an Undo). A line can be marked a service
 * (commissioning or a service charge): it has no goods leg. "Add line" adds one.
 *
 * Admin and sales see and edit the prices; an engineer is shown the lines (what, how many, which leg) and no price, GST or supplier
 * figure: those columns are not even requested for them (DECISIONS 2026-10-15, O01/O03).
 *
 * A legacy order whose price basis is unknown shows the prices "as typed" and question marks where net, GST and gross cannot be told
 * (the mockup's "basis unknown" frame). At tablet width (below 1024) quantity, unit price and the GST amount fold into the item line.
 */
const RATES = [0, 5, 10, 17, 18]

interface Row extends OrderItemRow {
  letter: string | null
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

const Q = <span className="text-fg-muted">?</span>

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
  /** The latest PO of each leg: the Split line dialog warns when the line's PO is already issued. */
  pos?: readonly LegPo[]
}) {
  const orderId = order.id
  const { toast } = useToast()
  const updateItem = useUpdateItem(orderId)
  const setRates = useSetItemRates(orderId)
  const setGroupPrice = useSetGroupPrice(orderId)
  const [adding, setAdding] = useState(false)
  const [splitting, setSplitting] = useState<OrderItemRow | null>(null)
  /** The split item whose selling price is being edited (once for all its parts). */
  const [editingGroup, setEditingGroup] = useState<string | null>(null)
  const [groupDraft, setGroupDraft] = useState<number | null>(null)
  /** The rates before "exempt all", so turning it off puts every line back where it was (this session). */
  const remembered = useRef<Map<string, number>>(new Map())

  const rows: Row[] = useMemo(() => {
    const letterOf = (i: OrderItemRow) => (i.legId ? legLetter(Math.max(0, legs.findIndex(l => l.id === i.legId))) : null)
    return groupItems(items).map((d): Row => {
      if (d.kind === 'row') return { ...d.item, letter: letterOf(d.item), kind: 'row', no: d.no }
      if (d.kind === 'part') return { ...d.item, letter: letterOf(d.item), kind: 'part', no: d.no, partIndex: d.partIndex, partCount: d.partCount }
      const first = d.members[0]
      return { ...first, id: d.key, letter: null, kind: 'head', no: d.no, qty: d.qty, unitPriceNet: typeof d.unitPriceNet === 'number' ? d.unitPriceNet : null, groupPrice: d.unitPriceNet, members: d.members }
    })
  }, [items, legs])
  const legOf = (r: Row) => legs.find(l => l.id === r.legId)
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
  const net = (r: Row) => (r.kind === 'head' || r.unitPriceNet === null ? null : lineNetPaisa({ qty: r.qty, unitPriceNet: r.unitPriceNet }) / 100)
  const gst = (r: Row) => (r.kind === 'head' || r.unitPriceNet === null ? null : lineGstPaisa({ qty: r.qty, unitPriceNet: r.unitPriceNet, gstRate: rate(r) }) / 100)
  const saveGroup = async (r: Row) => {
    if (groupDraft === null || groupDraft <= 0 || !r.members) return setEditingGroup(null)
    try {
      await setGroupPrice.mutateAsync({ ids: r.members.map(m => m.id), unitPriceNet: groupDraft })
      toast({ title: 'Selling price changed', body: `${r.description}: ${formatAmount(groupDraft)} net on both parts` })
      setEditingGroup(null)
    } catch (err) {
      fail('Could not change the price')(err)
    }
  }
  const canSplit = (r: Row) => money && canEdit && !basisUnknown && r.kind !== 'head' && !r.isService && r.legId !== null && r.qty > 1

  const itemCell = (r: Row) =>
    r.kind === 'head' ? (
      <span className="grid min-w-0 gap-px">
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <span className="truncate font-medium">{r.description}</span>
          <span className="inline-flex h-5 items-center gap-1 rounded border border-line-strong px-[6px] text-xs font-medium text-fg-2">
            <Split size={12} aria-hidden="true" />
            split across {r.members?.length ?? 0} suppliers
          </span>
        </span>
        {money && canEdit ? <span className="truncate text-xs text-fg-muted">Change the selling price once: all parts update</span> : null}
      </span>
    ) : r.kind === 'part' ? (
      <span className="grid min-w-0 gap-px">
        <span className="truncate">
          Part {(r.partIndex ?? 0) + 1} of {r.partCount}
        </span>
        <span className="truncate text-xs text-fg-muted">{r.brandName ?? ' '}</span>
      </span>
    ) : (
    <span className="grid min-w-0 gap-px">
      <span className="truncate">{r.description}</span>
      <span className="truncate text-xs text-fg-muted">
        {r.isService ? 'Service' : (r.brandName ?? ' ')}
        {/* tablet: quantity and unit price fold into the item line */}
        {money && r.unitPriceNet !== null ? (
          <span className="num lg:hidden">
            {' '}
            · {r.qty}
            {r.unit ? ` ${r.unit}` : ''} × {formatAmount(r.unitPriceNet)} {basisUnknown ? 'as typed' : `net, GST ${rate(r)}%`}
          </span>
        ) : null}
      </span>
    </span>
  )
  const qtyCell = (r: Row) => (
    <span className="num">
      {r.qty}
      {r.unit ? <span className="text-fg-muted"> {r.unit}</span> : null}
    </span>
  )
  const legCell = (r: Row) =>
    r.kind === 'head' ? null : r.letter ? (
      <span aria-label={`Leg ${r.letter}`} className="inline-grid size-5 place-items-center rounded bg-fg text-xs font-medium text-surface">
        {r.letter}
      </span>
    ) : (
      <span className="text-fg-muted">{r.isService ? '—' : 'Not sourced'}</span>
    )

  const base: Column<Row>[] = [
    { id: 'n', header: '#', kind: 'num', value: r => r.number, cell: r => <span className="num text-fg-muted">{r.no}</span>, width: 44 },
    { id: 'item', header: 'Item', value: r => r.description, cell: itemCell },
    { id: 'qty', header: 'Qty', kind: 'num', value: r => r.qty, cell: qtyCell, width: 80, hideBelowLg: money },
  ]
  const priced: Column<Row>[] = [
    {
      id: 'unit',
      header: basisUnknown ? 'Unit price as typed' : 'Unit net (PKR)',
      kind: 'money',
      value: r => r.unitPriceNet,
      cell: r =>
        r.kind !== 'head' ? undefined : editingGroup === r.id ? (
          <NumberInput
            value={groupDraft}
            onChange={setGroupDraft}
            aria-label={`Selling price, net PKR, ${r.description}`}
            data-autofocus
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') void saveGroup(r)
              if (e.key === 'Escape') {
                e.stopPropagation()
                setEditingGroup(null)
              }
            }}
          />
        ) : r.groupPrice === 'mixed' ? (
          <span className="text-fg-muted">Mixed</span>
        ) : r.unitPriceNet === null ? (
          <span className="text-fg-muted">Not set</span>
        ) : (
          <span className="num">{formatAmount(r.unitPriceNet)}</span>
        ),
      width: 130,
      hideBelowLg: true,
    },
    {
      id: 'gst',
      header: 'GST',
      kind: 'num',
      value: r => rate(r),
      width: 96,
      cell: r =>
        r.kind === 'head' ? null : basisUnknown ? (
          Q
        ) : canEdit ? (
          <Select
            aria-label={`GST rate, line ${r.number}`}
            value={String(rate(r))}
            onChange={e => updateItem.mutate({ id: r.id, patch: { gst_rate: Number(e.target.value) } }, { onError: fail('Could not change the GST') })}
            options={[...new Set([...RATES, rate(r)])].sort((a, b) => a - b).map(v => ({ value: String(v), label: `${v}%` }))}
            className="h-[28px] py-0 text-sm"
          />
        ) : (
          <span className="num">{rate(r)}%</span>
        ),
    },
    basisUnknown
      ? { id: 'net', header: 'Line as typed (PKR)', kind: 'money', value: r => (r.kind === 'head' || r.unitPriceNet === null ? null : lineNetPaisa({ qty: r.qty, unitPriceNet: r.unitPriceNet }) / 100), total: true, width: 150 }
      : { id: 'net', header: 'Line net (PKR)', kind: 'money', value: net, total: true, width: 130 },
    basisUnknown
      ? { id: 'lgst', header: 'Line GST (PKR)', kind: 'num', value: () => null, cell: () => Q, width: 130, hideBelowLg: true }
      : { id: 'lgst', header: 'Line GST (PKR)', kind: 'money', value: gst, total: true, width: 130, hideBelowLg: true },
    basisUnknown
      ? { id: 'gross', header: 'Line gross (PKR)', kind: 'num', value: () => null, cell: () => Q, width: 140 }
      : { id: 'gross', header: 'Line gross (PKR)', kind: 'money', value: r => (net(r) === null ? null : (net(r) as number) + (gst(r) as number)), total: true, width: 140 },
    {
      id: 'supplier',
      header: 'Supplier unit price',
      align: 'right',
      width: 150,
      cell: r => {
        if (r.kind === 'head') return null
        if (r.isService) return <span className="text-fg-muted">Service, no supplier</span>
        if (r.supplierUnitPrice === null) return <span className="text-fg-muted">{basisUnknown ? 'Not recorded' : 'Not set'}</span>
        const ccy = legOf(r)?.currency ?? ''
        return (
          <span className="num">
            <span className="mr-1 text-xs text-fg-muted">{ccy}</span>
            {formatAmount(r.supplierUnitPrice)}
          </span>
        )
      },
    },
  ]
  const tail: Column<Row>[] = [
    { id: 'leg', header: 'Leg', width: 84, cell: legCell },
    ...(money && canEdit && !basisUnknown
      ? ([
          {
            id: 'service',
            header: 'Service',
            width: 84,
            hideBelowLg: true,
            cell: (r: Row) =>
              r.kind === 'head' ? null : (
              <Checkbox
                aria-label={`Service, line ${r.number}`}
                checked={r.isService}
                onCheckedChange={v =>
                  updateItem.mutate({ id: r.id, patch: v === true ? { is_service: true, supplier_order_id: null } : { is_service: false } }, { onError: fail('Could not change the line') })
                }
              />
            ),
          },
        ] satisfies Column<Row>[])
      : []),
  ]
  /** The row actions (A8): Split line on any goods line with more than one unit; Edit price on the heading of a split item. */
  const actions: Column<Row>[] =
    money && canEdit && !basisUnknown
      ? [
          {
            id: 'actions',
            header: 'Actions',
            hiddenHeader: true,
            width: 124,
            cell: r =>
              r.kind === 'head' ? (
                editingGroup === r.id ? (
                  <span className="flex gap-1">
                    <Button size="sm" variant="primary" onClick={() => void saveGroup(r)} busy={setGroupPrice.isPending} busyLabel="Saving" aria-label={`Save price, ${r.description}`}>
                      Save
                    </Button>
                    <Button size="sm" variant="quiet" onClick={() => setEditingGroup(null)} aria-label="Cancel price edit">
                      Cancel
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon={Pencil}
                    aria-label={`Edit price, ${r.description}`}
                    onClick={() => {
                      setGroupDraft(typeof r.groupPrice === 'number' ? r.groupPrice : null)
                      setEditingGroup(r.id)
                    }}
                  >
                    Edit price
                  </Button>
                )
              ) : canSplit(r) ? (
                <Button size="sm" variant="quiet" icon={Split} aria-label={`Split line ${r.no}`} onClick={() => setSplitting(r)}>
                  Split line
                </Button>
              ) : null,
          },
        ]
      : []
  const columns = money ? [...base, ...priced, ...tail, ...actions] : [...base, ...tail]

  const goods = rows.filter(r => !r.isService && r.kind !== 'head')
  const unpricedGoods = goods.filter(r => r.supplierUnitPrice === null).length
  const summary = money
    ? basisUnknown
      ? 'Net and gross cannot be told apart'
      : goods.length > 0
        ? unpricedGoods === 0
          ? `Every goods ${goods.length === 1 ? 'line has' : 'lines have'} a supplier price`
          : `${unpricedGoods} of ${goods.length} goods lines have no supplier price yet`
        : undefined
    : undefined

  return (
    <section aria-label="Items" className="min-w-0 rounded border bg-surface">
      <DataTable
        label="Order items"
        columns={columns}
        rows={rows}
        getRowId={r => r.id}
        twoLine
        density="compact"
        footerLabel={basisUnknown ? 'Total as typed' : `Order total, ${items.length} ${items.length === 1 ? 'line' : 'lines'}`}
        summary={summary}
        toolbar={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-base font-semibold">Items</h2>
            <span className="text-sm text-fg-muted">
              {items.length} {items.length === 1 ? 'line' : 'lines'}
              {rows.some(r => r.kind === 'head') ? ` from ${rows.filter(r => r.kind !== 'part').length} items` : ''}
              {money ? (basisUnknown ? ' · prices as typed in the old CRM' : ' · GST at line level · net, GST and gross in PKR') : ''}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-4">
              {money && canEdit && !basisUnknown && rows.length > 0 ? (
                <Checkbox label="Exempt the whole order from GST" checked={exempt} onCheckedChange={v => void toggleExempt(v === true)} disabled={setRates.isPending} />
              ) : null}
              {money && canEdit ? (
                <Button icon={Plus} onClick={() => setAdding(true)}>
                  Add line
                </Button>
              ) : null}
            </div>
          </div>
        }
        mobileRow={r =>
          r.kind === 'head' ? (
            <span className="grid gap-1">
              <span className="text-sm font-medium">{r.description}</span>
              <span className="text-xs text-fg-muted">
                <span className="num">{r.qty}</span>
                {r.unit ? ` ${r.unit}` : ''} · split across {r.members?.length ?? 0} suppliers
              </span>
              {money && canEdit && !basisUnknown ? (
                editingGroup === r.id ? (
                  <span className="flex items-center gap-2">
                    <NumberInput value={groupDraft} onChange={setGroupDraft} aria-label={`Selling price, net PKR, ${r.description}`} onKeyDown={e => e.key === 'Enter' && void saveGroup(r)} />
                    <Button size="sm" variant="primary" onClick={() => void saveGroup(r)} busy={setGroupPrice.isPending} busyLabel="Saving" aria-label={`Save price, ${r.description}`}>
                      Save
                    </Button>
                  </span>
                ) : (
                  <Button
                    size="sm"
                    variant="quiet"
                    icon={Pencil}
                    className="justify-self-start"
                    aria-label={`Edit price, ${r.description}`}
                    onClick={() => {
                      setGroupDraft(typeof r.groupPrice === 'number' ? r.groupPrice : null)
                      setEditingGroup(r.id)
                    }}
                  >
                    Edit price
                  </Button>
                )
              ) : null}
            </span>
          ) : (
          <span className="grid gap-1">
            <span className="flex items-start justify-between gap-3">
              <span className="min-w-0 text-sm font-medium">{r.description}</span>
              {legCell(r)}
            </span>
            <span className="text-xs text-fg-muted">
              {r.qty}
              {r.unit ? ` ${r.unit}` : ''}
              {r.isService ? ' · Service' : r.brandName ? ` · ${r.brandName}` : ''}
              {money && r.unitPriceNet !== null ? ` · PKR ${formatAmount(r.unitPriceNet)} ${basisUnknown ? 'as typed' : `net · GST ${rate(r)}%`}` : ''}
            </span>
            {canSplit(r) ? (
              <Button size="sm" variant="quiet" icon={Split} className="justify-self-start" aria-label={`Split line ${r.no}`} onClick={() => setSplitting(r)}>
                Split line
              </Button>
            ) : null}
          </span>
          )
        }
        empty={<p className="px-4 py-6 text-sm text-fg-muted">This order has no lines yet. Add one to start.</p>}
      />
      {adding ? <AddLineDialog order={order} items={items} legs={legs} onClose={() => setAdding(false)} /> : null}
      {splitting ? <SplitLineDialog order={order} item={items.find(i => i.id === splitting.id) ?? splitting} legs={legs} pos={pos} onClose={() => setSplitting(null)} /> : null}
    </section>
  )
}
