import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CircleAlert, CircleCheck, CopyPlus, ListFilter, Users, X } from 'lucide-react'
import { useSession } from '@/app/session'
import { formatShortDate } from '@/lib/formatDay'
import { orderRef } from '@/lib/refs'
import { businessToday } from '@/lib/dates'
import { resolveStatus, type StatusDimension } from '@/lib/status'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { EmptyState } from '@/ui/EmptyState'
import { Select } from '@/ui/form/Select'
import { Icon } from '@/ui/Icon'
import { Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { TableFilter } from '@/ui/TableFilter'
import { Tab, TabList, TabPanel, Tabs } from '@/ui/Tabs'
import type { OrderListRow } from '@/features/orders/api'
import { useOrdersList } from '@/features/orders/hooks'
import { NewOrderDialog } from '@/features/orders/NewOrderDialog'
import { listNextStep, type NextStep } from '@/features/orders/lib/nextStep'
import {
  ALL,
  DIMENSION_VALUES,
  dimensionCounts,
  filterRows,
  hasFilters,
  isTab,
  defaultOwner,
  TABS,
  tabCounts,
  type Dimension,
  type ListFilters,
  type OwnerFilter,
} from '@/features/orders/lib/listModel'

/*
 * Orders list (O04), reworked by the UX audit of 2026-10-19 (screens.md 7): each row leads with the customer and what they ordered, then
 * ONE plain "Next step" column (lib/nextStep.ts: "Place the supplier order", "Chase payment: 12 days overdue", "Waiting for the goods")
 * instead of four state chips, then the order number. The lifecycle is the tab (Active, Done, Cancelled); the owner switch is Mine or
 * All (for an engineer, "My jobs": the jobs they are assigned to); a search finds an order by number, customer PO, customer, site or
 * item. The four state filters (goods, commissioning, and for admin and sales invoicing and payment) sit behind one "Filters" button:
 * a small panel on a laptop, a sheet on a phone (where the owner switch goes into the sheet too, so the list starts right under the
 * search). Filters combine with AND and live in the address, so a reload or a shared link lands on the same view.
 *
 * "Repeat a past order" (was "New order") copies a past order: a new order is otherwise made by winning an RFQ. Money (invoicing,
 * payment, value) is never requested for an engineer.
 */
const LABEL: Record<Dimension, string> = { goods: 'Goods', commissioning: 'Commissioning', invoicing: 'Invoicing', payment: 'Payment' }
const STATUS_DIM: Record<Dimension, StatusDimension> = { goods: 'goods', commissioning: 'commissioning', invoicing: 'invoicing', payment: 'payment' }

const valueLabel = (dim: Dimension, value: string) => resolveStatus(STATUS_DIM[dim], value).label

/** What "done" means differs by role (v_order_state.is_done): sales are done once it is invoiced; their Next step still says if it is unpaid. */
const doneMeaning = (role: string) =>
  role === 'sales'
    ? 'An order is done for you when the goods are delivered, commissioning is done and it is fully invoiced. If the customer has not paid, its Next step still says so.'
    : role === 'engineer'
      ? 'An order is done for you when the goods are delivered and commissioning is done.'
      : 'An order is done when the goods are delivered, commissioning is done, it is paid and its costs are complete.'

function NextStepText({ step }: { step: NextStep }) {
  return (
    <span
      data-tone={step.tone}
      className={cn(
        'inline-flex items-start gap-[6px] whitespace-normal',
        step.tone === 'late' && 'font-medium text-tone-danger-fg',
        step.tone === 'now' && 'font-medium text-fg',
        (step.tone === 'waiting' || step.tone === 'done') && 'text-fg-muted',
      )}
    >
      {step.tone === 'late' ? <Icon icon={CircleAlert} size="sm" className="mt-[3px] shrink-0" /> : step.tone === 'done' ? <Icon icon={CircleCheck} size="sm" className="mt-[3px] shrink-0" /> : null}
      {step.text}
    </span>
  )
}

function CustomerCell({ row }: { row: OrderListRow }) {
  return (
    <span className="grid min-w-[180px] max-w-[460px] gap-px whitespace-normal">
      <span className="font-medium">
        {row.companyName}
        {row.siteName ? <span className="font-regular text-fg-muted">{` · ${row.siteName}`}</span> : null}
      </span>
      <span className="line-clamp-1 text-sm text-fg-2">{row.what ? `${row.what}${row.moreLines ? ' + more' : ''}` : <span className="text-fg-muted">No lines yet</span>}</span>
    </span>
  )
}

function OrderCell({ row }: { row: OrderListRow }) {
  return (
    <span className="grid min-w-0 gap-px">
      <span className="num">{orderRef(row.number)}</span>
      <span className="truncate text-xs text-fg-muted">{[row.customerPo ? `PO ${row.customerPo}` : null, row.ownerName].filter(Boolean).join(' · ') || ' '}</span>
    </span>
  )
}

function OrderCard({ row, step }: { row: OrderListRow; step: NextStep }) {
  return (
    <span className="grid gap-1">
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 font-medium">{row.companyName}</span>
        <span className="num shrink-0 text-sm text-fg-muted">{orderRef(row.number)}</span>
      </span>
      {row.what ? <span className="line-clamp-2 text-sm text-fg-2">{`${row.what}${row.moreLines ? ' + more' : ''}`}</span> : null}
      <span className="text-sm">
        <NextStepText step={step} />
      </span>
    </span>
  )
}

export default function OrdersListPage() {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const role = (user?.role ?? '') as 'admin' | 'sales' | 'engineer' | ''
  const money = role === 'admin' || role === 'sales'
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const phone = useMediaQuery('(max-width: 639px)')
  const [creating, setCreating] = useState(false)
  const [sheet, setSheet] = useState(false)

  const orders = useOrdersList(role === '' ? null : role)

  const query = params.toString()
  const filters = useMemo<ListFilters>(() => {
    const p = new URLSearchParams(query)
    const tabParam = p.get('tab')
    return {
      tab: isTab(tabParam) ? tabParam : 'active',
      owner: (p.get('owner') === 'all' ? 'all' : p.get('owner') === 'mine' ? 'mine' : defaultOwner(role)) as OwnerFilter,
      goods: p.get('goods') ?? ALL,
      commissioning: p.get('commissioning') ?? ALL,
      invoicing: money ? (p.get('invoicing') ?? ALL) : ALL,
      payment: money ? (p.get('payment') ?? ALL) : ALL,
      text: p.get('q') ?? '',
    }
  }, [query, role, money])
  const change = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      // 'all' is a real choice for the owner switch; for a dimension it means no filter, so it leaves the address
      if (v === null || v === '' || (v === ALL && k !== 'owner')) next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }

  const who = useMemo(() => ({ userId: user?.id ?? null, role }), [user?.id, role])
  const all = useMemo(() => orders.data ?? [], [orders.data])
  const shown = useMemo(() => filterRows(all, filters, who), [all, filters, who])
  const counts = useMemo(() => tabCounts(all, filters, who), [all, filters, who])
  const mineCount = useMemo(() => filterRows(all, { ...filters, owner: 'mine' }, who).length, [all, filters, who])
  const allCount = useMemo(() => filterRows(all, { ...filters, owner: 'all' }, who).length, [all, filters, who])
  const dimCounts = useMemo(
    () => ({
      goods: dimensionCounts(all, 'goods', filters, who),
      commissioning: dimensionCounts(all, 'commissioning', filters, who),
      invoicing: dimensionCounts(all, 'invoicing', filters, who),
      payment: dimensionCounts(all, 'payment', filters, who),
    }),
    [all, filters, who],
  )

  const today = businessToday()
  const steps = useMemo(() => new Map(all.map(r => [r.id, listNextStep(r, role, today)])), [all, role, today])
  const stepOf = (r: OrderListRow) => steps.get(r.id) ?? listNextStep(r, role, today)
  // R2-05: Active orders split by who acts next. "Needs action" is a late or now step; everything else waits on someone else.
  const needsAction = (r: OrderListRow) => {
    const t = stepOf(r).tone
    return t === 'late' || t === 'now'
  }
  const showParam = params.get('show')
  const split = filters.tab === 'active' && (showParam === 'need' || showParam === 'waiting') ? showParam : 'all'
  const needCount = shown.filter(needsAction).length
  const rows = split === 'need' ? shown.filter(needsAction) : split === 'waiting' ? shown.filter(r => !needsAction(r)) : shown
  const columns: Column<OrderListRow>[] = [
    { id: 'customer', header: 'Customer and items', value: r => r.companyName, sortable: true, cell: r => <CustomerCell row={r} /> },
    // text columns sorted by a number (the urgency rank, the order number): compareCells compares text numerically
    { id: 'next', header: 'Next step', value: r => stepOf(r).rank, sortable: true, cell: r => <NextStepText step={stepOf(r)} /> },
    { id: 'order', header: 'Order', value: r => r.number, sortable: true, cell: r => <OrderCell row={r} /> },
    ...(money ? ([{ id: 'gross', header: 'Value (PKR)', kind: 'money', value: (r: OrderListRow) => r.gross, sortable: true, hideBelowLg: true }] satisfies Column<OrderListRow>[]) : []),
    {
      id: 'ordered',
      header: 'Ordered',
      kind: 'date',
      value: r => r.orderedOn,
      sortable: true,
      hideBelowMd: true,
      cell: r => (r.orderedOn ? <span className="num">{formatShortDate(r.orderedOn, today)}</span> : <span className="text-fg-muted">—</span>),
    },
  ]

  const filtered = hasFilters(filters, role)
  const dimsOn = (['goods', 'commissioning', 'invoicing', 'payment'] as const).filter(d => filters[d] !== ALL).length
  const reset = () => change({ owner: defaultOwner(role) === 'mine' ? 'all' : null, goods: null, commissioning: null, invoicing: null, payment: null, q: null, show: null })
  const total = all.filter(r => r.lifecycle === filters.tab).length
  const ownerLabel = role === 'engineer' ? 'My jobs' : 'Mine'

  const dimSelect = (dim: Dimension) => {
    const current = filters[dim]
    return (
      <label key={dim} className="grid gap-1 text-sm">
        <span className="text-fg-muted">{LABEL[dim]}</span>
        <Select
          aria-label={`${LABEL[dim]} state`}
          value={current === ALL ? '' : current}
          placeholder="Any"
          onChange={e => change({ [dim]: e.target.value || null })}
          className="w-full"
          options={DIMENSION_VALUES[dim].map(v => ({ value: v, label: `${valueLabel(dim, v)} (${dimCounts[dim].get(v) ?? 0})` }))}
        />
      </label>
    )
  }
  const dims = (
    <div className="grid gap-3">
      {dimSelect('goods')}
      {dimSelect('commissioning')}
      {money ? dimSelect('invoicing') : null}
      {money ? dimSelect('payment') : null}
    </div>
  )
  const ownerSwitch = (
    <SegmentedControl
      aria-label="Whose orders"
      value={filters.owner}
      onValueChange={v => change({ owner: v })}
      fill={phone}
      options={[
        { value: 'mine', label: ownerLabel, count: orders.isSuccess ? mineCount : undefined },
        { value: 'all', label: 'All', count: orders.isSuccess ? allCount : undefined },
      ]}
    />
  )
  const filterLabel = dimsOn > 0 ? `Filters (${dimsOn})` : 'Filters'

  const empty =
    !filtered && total === 0 ? (
      filters.tab === 'active' ? (
        <EmptyState
          mood="goal"
          title="No active orders"
          actions={
            money ? (
              <Button icon={CopyPlus} onClick={() => setCreating(true)}>
                Repeat a past order
              </Button>
            ) : undefined
          }
        >
          Every order is done or cancelled. Mark an RFQ won to start one, or repeat a past order.
        </EmptyState>
      ) : (
        <EmptyState icon={CircleCheck} title={filters.tab === 'done' ? 'Nothing is done yet' : 'Nothing has been cancelled'}>
          {filters.tab === 'done' ? doneMeaning(role) : 'Cancelled orders stay on record here, with their reason.'}
        </EmptyState>
      )
    ) : filters.owner === 'mine' && mineCount === 0 && allCount > 0 && !filters.text && dimsOn === 0 ? (
      <EmptyState
        mood="goal"
        title={role === 'engineer' ? 'No jobs are assigned to you' : 'None of your orders are in this list'}
        actions={
          <Button icon={Users} onClick={() => change({ owner: 'all' })}>
            Show everyone&rsquo;s ({allCount})
          </Button>
        }
      >
        {role === 'engineer' ? 'Jobs you are put on appear here.' : 'Orders you own appear here.'}
      </EmptyState>
    ) : (
      <EmptyState
        title="No orders match"
        actions={
          <Button icon={X} onClick={reset}>
            Clear the filters
          </Button>
        }
      >
        Nothing here matches the search and filters you chose.
      </EmptyState>
    )

  const lede = orders.isSuccess ? `${counts.active} active · ${counts.done} done · ${counts.cancelled} cancelled` : 'From the customer’s PO to delivery and payment.'

  const table = (label: string) => (
    <DataTable
      label={label}
      columns={columns}
      rows={rows}
      getRowId={r => r.id}
      twoLine
      densitySwitch={false}
      defaultSort={{ id: 'order', dir: 'desc' }}
      mobileRow={r => <OrderCard row={r} step={stepOf(r)} />}
      onRowOpen={r => navigate(`/orders/${r.id}`)}
      loading={orders.isPending}
      error={orders.isError ? { title: "Couldn't load the orders", message: 'Nothing was changed. Check your connection and try again.', onRetry: () => void orders.refetch() } : null}
      summary={orders.isSuccess ? `Showing ${rows.length} of ${total} ${filters.tab} ${total === 1 ? 'order' : 'orders'}` : undefined}
      toolbar={
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          {phone ? null : ownerSwitch}
          {filters.tab === 'active' ? (
            <SegmentedControl
              aria-label="Who acts next"
              value={split}
              onValueChange={v => change({ show: v === 'all' ? null : v })}
              options={[
                { value: 'all', label: 'All', count: orders.isSuccess ? shown.length : undefined },
                { value: 'need', label: 'Needs action', count: orders.isSuccess ? needCount : undefined },
                { value: 'waiting', label: 'Waiting', count: orders.isSuccess ? shown.length - needCount : undefined },
              ]}
            />
          ) : null}
          <TableFilter label="Search orders" placeholder="Customer, item, order or PO" value={filters.text} onChange={v => change({ q: v })} className="min-w-0 flex-1 sm:max-w-[320px]" />
          {phone ? (
            <Button icon={ListFilter} onClick={() => setSheet(true)} aria-label={dimsOn > 0 || filters.owner !== defaultOwner(role) ? `Filter, ${dimsOn + (filters.owner !== defaultOwner(role) ? 1 : 0)} on` : 'Filter'}>
              Filter
            </Button>
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <Button icon={ListFilter} variant={dimsOn > 0 ? 'secondary' : 'quiet'}>
                  {filterLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-[280px]">
                <div className="grid gap-3 p-1">
                  {dims}
                  {dimsOn > 0 ? (
                    <Button size="sm" variant="quiet" icon={X} className="justify-self-start" onClick={() => change({ goods: null, commissioning: null, invoicing: null, payment: null })}>
                      Clear these filters
                    </Button>
                  ) : null}
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      }
      empty={empty}
    />
  )

  return (
    <div className="mx-auto grid w-full max-w-table grid-cols-[minmax(0,1fr)] content-start gap-4 px-4 pb-12 pt-6 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="text-sm text-fg-muted">{lede}</p>
        </div>
        {money ? (
          <Button icon={CopyPlus} onClick={() => setCreating(true)}>
            Repeat a past order
          </Button>
        ) : null}
      </header>

      <Tabs className="min-w-0" value={filters.tab} onValueChange={v => change({ tab: v === 'active' ? null : v })}>
        <TabList aria-label="Order lists">
          {TABS.map(t => (
            <Tab key={t.value} value={t.value} count={orders.isSuccess ? counts[t.value] : undefined}>
              {t.label}
            </Tab>
          ))}
        </TabList>
        <TabPanel value="active">{table('Active orders')}</TabPanel>
        <TabPanel value="done">{table('Done orders')}</TabPanel>
        <TabPanel value="cancelled">{table('Cancelled orders')}</TabPanel>
      </Tabs>
      {phone && sheet ? (
        <Dialog open onOpenChange={o => !o && setSheet(false)}>
          <DialogContent
            title="Filter orders"
            icon={ListFilter}
            footer={
              <>
                {filtered ? (
                  <Button className="mr-auto" icon={X} onClick={reset}>
                    Clear
                  </Button>
                ) : null}
                <Button variant="primary" data-cancel onClick={() => setSheet(false)}>
                  {`Show ${shown.length} ${shown.length === 1 ? 'order' : 'orders'}`}
                </Button>
              </>
            }
          >
            <div className="grid gap-4">
              {ownerSwitch}
              {dims}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
      {creating ? <NewOrderDialog onClose={() => setCreating(false)} /> : null}
    </div>
  )
}
