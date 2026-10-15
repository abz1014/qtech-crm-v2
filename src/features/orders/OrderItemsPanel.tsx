import { useMemo, useRef } from 'react'
import { mapPgError } from '@/lib/pgErrors'
import { Checkbox } from '@/ui/form/Checkbox'
import { Select } from '@/ui/form/Select'
import { DataTable, type Column } from '@/ui/DataTable'
import { useToast } from '@/ui/useToast'
import type { OrderItemRow, OrderLegRow } from '@/features/orders/api'
import { useSetItemRates, useUpdateItem } from '@/features/orders/hooks'
import { legLetter } from '@/features/orders/lib/legModel'
import { isExemptAll, lineGstPaisa, lineNetPaisa, STANDARD_GST } from '@/features/orders/lib/orderMath'
import { formatAmount } from '@/lib/money'

/*
 * The order's items (O03; g2-order-detail.html "Items"). GST is per line (DATA_MODEL 2.13): each line's rate is a small select, and
 * "Exempt from GST" sets every line to 0 in one tap (and back to the standard rate, with an Undo). A line can be marked a service
 * (commissioning or a service charge): it has no goods leg. Admin and sales see and edit the prices; an engineer is shown the
 * lines (what, how many, which leg) and no price, GST or supplier figure: those columns are not even requested for them.
 */
const RATES = [0, 5, 10, 17, 18]

interface Row extends OrderItemRow {
  letter: string | null
}

export function OrderItemsPanel({
  orderId,
  items,
  legs,
  money,
  canEdit,
}: {
  orderId: string
  items: readonly OrderItemRow[]
  legs: readonly OrderLegRow[]
  money: boolean
  canEdit: boolean
}) {
  const { toast } = useToast()
  const updateItem = useUpdateItem(orderId)
  const setRates = useSetItemRates(orderId)
  /** The rates before "exempt all", so turning it off puts every line back where it was (this session). */
  const remembered = useRef<Map<string, number>>(new Map())

  const rows: Row[] = useMemo(
    () => items.map(i => ({ ...i, letter: i.legId ? legLetter(Math.max(0, legs.findIndex(l => l.id === i.legId))) : null })),
    [items, legs],
  )
  const legOf = (r: Row) => legs.find(l => l.id === r.legId)
  const exempt = money && isExemptAll(items.map(i => ({ gstRate: i.gstRate ?? STANDARD_GST })))
  const fail = (title: string) => (err: unknown) => toast({ title, body: mapPgError(err, { entity: 'item' }).message, tone: 'danger' })

  const toggleExempt = async (on: boolean) => {
    const before = items.map(i => ({ id: i.id, gstRate: i.gstRate ?? STANDARD_GST }))
    const next = on
      ? before.map(b => ({ id: b.id, gstRate: 0 }))
      : before.map(b => ({ id: b.id, gstRate: remembered.current.get(b.id) ?? STANDARD_GST }))
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
      <span className="truncate text-xs text-fg-muted">{r.isService ? 'Service' : (r.brandName ?? ' ')}</span>
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
      <span className="text-fg-muted">{r.isService ? 'No leg' : 'Not sourced'}</span>
    )

  const base: Column<Row>[] = [
    { id: 'n', header: '#', kind: 'num', value: r => r.number, width: 44 },
    { id: 'item', header: 'Item', value: r => r.description, cell: itemCell },
    { id: 'qty', header: 'Qty', kind: 'num', value: r => r.qty, cell: qtyCell, width: 80 },
  ]
  const priced: Column<Row>[] = [
    { id: 'unit', header: 'Unit net (PKR)', kind: 'money', value: r => r.unitPriceNet, width: 120 },
    {
      id: 'gst',
      header: 'GST',
      kind: 'num',
      value: r => rate(r),
      width: 96,
      cell: r =>
        canEdit ? (
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
    { id: 'net', header: 'Line net (PKR)', kind: 'money', value: net, total: true, width: 130 },
    { id: 'lgst', header: 'Line GST (PKR)', kind: 'money', value: gst, total: true, width: 130 },
    { id: 'gross', header: 'Line gross (PKR)', kind: 'money', value: r => (net(r) === null ? null : (net(r) as number) + (gst(r) as number)), total: true, width: 140 },
    {
      id: 'supplier',
      header: 'Supplier unit price',
      align: 'right',
      width: 150,
      cell: r => {
        if (r.isService) return <span className="text-fg-muted">Service, no supplier</span>
        if (r.supplierUnitPrice === null) return <span className="text-fg-muted">Not set</span>
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
    ...(money && canEdit
      ? ([
          {
            id: 'service',
            header: 'Service',
            width: 84,
            cell: (r: Row) => (
              <Checkbox
                aria-label={`Service, line ${r.number}`}
                checked={r.isService}
                onCheckedChange={v =>
                  updateItem.mutate(
                    { id: r.id, patch: v === true ? { is_service: true, supplier_order_id: null } : { is_service: false } },
                    { onError: fail('Could not change the line') },
                  )
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

  return (
    <section aria-label="Items" className="min-w-0 rounded border bg-surface">
      <DataTable
        label="Order items"
        columns={columns}
        rows={rows}
        getRowId={r => r.id}
        twoLine
        density="compact"
        footerLabel={`Order total, ${rows.length} ${rows.length === 1 ? 'line' : 'lines'}`}
        summary={money && goods.length > 0 ? `${unpricedGoods === 0 ? 'Every' : `${goods.length - unpricedGoods} of ${goods.length}`} goods ${goods.length === 1 ? 'line has' : 'lines have'} a supplier price${unpricedGoods > 0 ? ` (${unpricedGoods} not set)` : ''}` : undefined}
        toolbar={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
            <h2 className="text-base font-semibold">Items</h2>
            <span className="text-sm text-fg-muted">
              {rows.length} {rows.length === 1 ? 'line' : 'lines'}
              {money ? ' · GST at line level · net, GST and gross in PKR' : ''}
            </span>
            {money && canEdit && rows.length > 0 ? (
              <div className="ml-auto">
                <Checkbox label="Exempt the whole order from GST" checked={exempt} onCheckedChange={v => void toggleExempt(v === true)} disabled={setRates.isPending} />
              </div>
            ) : null}
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
              {money && r.unitPriceNet !== null ? ` · PKR ${formatAmount(r.unitPriceNet)} net · GST ${rate(r)}%` : ''}
            </span>
          </span>
        )}
        empty={<p className="px-4 py-6 text-sm text-fg-muted">This order has no lines.</p>}
      />
    </section>
  )
}
