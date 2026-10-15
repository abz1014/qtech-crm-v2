import { useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Checkbox } from '@/ui/form/Checkbox'
import { Select } from '@/ui/form/Select'
import { DataTable, type Column } from '@/ui/DataTable'
import { useToast } from '@/ui/useToast'
import type { OrderHeader, OrderItemRow, OrderLegRow } from '@/features/orders/api'
import { useSetItemRates, useUpdateItem } from '@/features/orders/hooks'
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
}

const Q = <span className="text-fg-muted">?</span>

export function OrderItemsPanel({
  order,
  items,
  legs,
  money,
  canEdit,
  basisUnknown,
}: {
  order: OrderHeader
  items: readonly OrderItemRow[]
  legs: readonly OrderLegRow[]
  money: boolean
  canEdit: boolean
  basisUnknown: boolean
}) {
  const orderId = order.id
  const { toast } = useToast()
  const updateItem = useUpdateItem(orderId)
  const setRates = useSetItemRates(orderId)
  const [adding, setAdding] = useState(false)
  /** The rates before "exempt all", so turning it off puts every line back where it was (this session). */
  const remembered = useRef<Map<string, number>>(new Map())

  const rows: Row[] = useMemo(() => items.map(i => ({ ...i, letter: i.legId ? legLetter(Math.max(0, legs.findIndex(l => l.id === i.legId))) : null })), [items, legs])
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
            try {
              await setRates.mutateAsync(before)
            } catch (err) {
              fail('Could not undo')(err)
            }
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
  const net = (r: Row) => (r.unitPriceNet === null ? null : lineNetPaisa({ qty: r.qty, unitPriceNet: r.unitPriceNet }) / 100)
  const gst = (r: Row) => (r.unitPriceNet === null ? null : lineGstPaisa({ qty: r.qty, unitPriceNet: r.unitPriceNet, gstRate: rate(r) }) / 100)

  const itemCell = (r: Row) => (
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
    r.letter ? (
      <span aria-label={`Leg ${r.letter}`} className="inline-grid size-5 place-items-center rounded bg-fg text-xs font-medium text-surface">
        {r.letter}
      </span>
    ) : (
      <span className="text-fg-muted">{r.isService ? '—' : 'Not sourced'}</span>
    )

  const base: Column<Row>[] = [
    { id: 'n', header: '#', kind: 'num', value: r => r.number, width: 44 },
    { id: 'item', header: 'Item', value: r => r.description, cell: itemCell },
    { id: 'qty', header: 'Qty', kind: 'num', value: r => r.qty, cell: qtyCell, width: 80, hideBelowLg: money },
  ]
  const priced: Column<Row>[] = [
    { id: 'unit', header: basisUnknown ? 'Unit price as typed' : 'Unit net (PKR)', kind: 'money', value: r => r.unitPriceNet, width: 130, hideBelowLg: true },
    {
      id: 'gst',
      header: 'GST',
      kind: 'num',
      value: r => rate(r),
      width: 96,
      cell: r =>
        basisUnknown ? (
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
      ? { id: 'net', header: 'Line as typed (PKR)', kind: 'money', value: r => (r.unitPriceNet === null ? null : lineNetPaisa({ qty: r.qty, unitPriceNet: r.unitPriceNet }) / 100), total: true, width: 150 }
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
            cell: (r: Row) => (
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
  const columns = money ? [...base, ...priced, ...tail] : [...base, ...tail]

  const goods = rows.filter(r => !r.isService)
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
        footerLabel={basisUnknown ? 'Total as typed' : `Order total, ${rows.length} ${rows.length === 1 ? 'line' : 'lines'}`}
        summary={summary}
        toolbar={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-base font-semibold">Items</h2>
            <span className="text-sm text-fg-muted">
              {rows.length} {rows.length === 1 ? 'line' : 'lines'}
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
        mobileRow={r => (
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
          </span>
        )}
        empty={<p className="px-4 py-6 text-sm text-fg-muted">This order has no lines yet. Add one to start.</p>}
      />
      {adding ? <AddLineDialog order={order} items={items} legs={legs} onClose={() => setAdding(false)} /> : null}
    </section>
  )
}
