import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CircleCheck, Plus, Search, Users, X } from 'lucide-react'
import { useSession } from '@/app/session'
import { formatShortDate } from '@/lib/formatDay'
import { orderRef } from '@/lib/refs'
import { businessToday } from '@/lib/dates'
import { resolveStatus, type StatusDimension } from '@/lib/status'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { Select } from '@/ui/form/Select'
import { TextField } from '@/ui/form/TextField'
import { Icon } from '@/ui/Icon'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { StatusBadge } from '@/ui/StatusBadge'
import { Tab, TabList, TabPanel, Tabs } from '@/ui/Tabs'
import type { OrderListRow } from '@/features/orders/api'
import { useOrdersList } from '@/features/orders/hooks'
import { NewOrderDialog } from '@/features/orders/NewOrderDialog'
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
 * Orders list (O04). Every order with its state dimensions as chips and a filter for each one: goods, commissioning, and for admin and
 * sales invoicing and payment. The lifecycle is the tab (Active, Done, Cancelled); the owner switch is Mine or All (for an engineer,
 * "Mine" is the jobs they are assigned to); a search finds an order by number, customer PO, customer or site. Filters combine with AND
 * and live in the address, so a reload or a shared link lands on the same view.
 *
 * There is no approved mockup for this screen (BUILD_PLAN FE-1 item 2), so it is composed from the RFQ board's pattern: header with the
 * main action, tabs with counts, a toolbar, DataTable with phone cards, and the same empty, loading and error states. Money columns
 * (invoicing, payment, gross) are never requested for an engineer.
 */
const LABEL: Record<Dimension, string> = { goods: 'Goods', commissioning: 'Commissioning', invoicing: 'Invoicing', payment: 'Payment' }
const STATUS_DIM: Record<Dimension, StatusDimension> = { goods: 'goods', commissioning: 'commissioning', invoicing: 'invoicing', payment: 'payment' }

const valueLabel = (dim: Dimension, value: string) => resolveStatus(STATUS_DIM[dim], value).label

function Chip({ dim, value }: { dim: Dimension; value: string | null }) {
  return value ? <StatusBadge dimension={STATUS_DIM[dim]} value={value} /> : <span className="text-fg-muted">—</span>
}

function CustomerCell({ row }: { row: OrderListRow }) {
  return (
    <span className="grid min-w-0 gap-px">
      <span className="truncate font-medium">{row.companyName}</span>
      <span className="truncate text-xs text-fg-muted">{row.siteName ?? ' '}</span>
    </span>
  )
}

function OrderCell({ row }: { row: OrderListRow }) {
  return (
    <span className="grid min-w-0 gap-px">
      <span className="num font-medium">{orderRef(row.number)}</span>
      <span className="num truncate text-xs text-fg-muted">{row.customerPo ? `PO ${row.customerPo}` : ' '}</span>
    </span>
  )
}

function OrderCard({ row, money }: { row: OrderListRow; money: boolean }) {
  return (
    <span className="grid gap-2">
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate font-medium">{row.companyName}</span>
        <span className="num shrink-0 text-sm text-fg-2">{orderRef(row.number)}</span>
      </span>
      <span className="flex flex-wrap gap-2">
        <Chip dim="goods" value={row.goods} />
        {row.commissioning !== 'n_a' ? <Chip dim="commissioning" value={row.commissioning} /> : null}
        {money ? <Chip dim="invoicing" value={row.invoicing} /> : null}
        {money ? <Chip dim="payment" value={row.payment} /> : null}
      </span>
      <span className="text-xs text-fg-muted">
        {row.siteName ? `${row.siteName} · ` : ''}
        {row.customerPo ? `PO ${row.customerPo} · ` : ''}
        {row.ownerName ?? 'No owner'}
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
  const [creating, setCreating] = useState(false)

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
  const columns = useMemo<Column<OrderListRow>[]>(
    () => [
      { id: 'order', header: 'Order', value: r => r.number, kind: 'num', align: 'left', sortable: true, width: 140, cell: r => <OrderCell row={r} /> },
      { id: 'customer', header: 'Customer', value: r => r.companyName, sortable: true, cell: r => <CustomerCell row={r} /> },
      { id: 'goods', header: 'Goods', value: r => r.goods, width: 130, cell: r => <Chip dim="goods" value={r.goods} /> },
      { id: 'commissioning', header: 'Commissioning', value: r => r.commissioning, width: 140, hideBelowMd: true, cell: r => <Chip dim="commissioning" value={r.commissioning} /> },
      ...(money
        ? ([
            { id: 'invoicing', header: 'Invoicing', value: (r: OrderListRow) => r.invoicing, width: 140, hideBelowLg: true, cell: (r: OrderListRow) => <Chip dim="invoicing" value={r.invoicing} /> },
            { id: 'payment', header: 'Payment', value: (r: OrderListRow) => r.payment, width: 120, hideBelowLg: true, cell: (r: OrderListRow) => <Chip dim="payment" value={r.payment} /> },
            { id: 'gross', header: 'Gross (PKR)', kind: 'money', value: (r: OrderListRow) => r.gross, sortable: true, width: 120, hideBelowLg: true },
          ] satisfies Column<OrderListRow>[])
        : []),
      { id: 'owner', header: 'Owner', value: r => r.ownerName, sortable: true, width: 110, hideBelowMd: true, cell: r => <span className="truncate">{r.ownerName ?? <span className="text-fg-muted">—</span>}</span> },
      {
        id: 'ordered',
        header: 'Ordered',
        kind: 'date',
        value: r => r.orderedOn,
        sortable: true,
        width: 90,
        hideBelowMd: true,
        cell: r => (r.orderedOn ? <span className="num">{formatShortDate(r.orderedOn, today)}</span> : <span className="text-fg-muted">—</span>),
      },
    ],
    [money, today],
  )

  const filtered = hasFilters(filters, role)
  const reset = () => change({ owner: defaultOwner(role) === 'mine' ? 'all' : null, goods: null, commissioning: null, invoicing: null, payment: null, q: null })
  const total = all.filter(r => r.lifecycle === filters.tab).length
  const ownerLabel = role === 'engineer' ? 'My jobs' : 'Mine'

  const dimSelect = (dim: Dimension) => {
    const current = filters[dim]
    return (
      <Select
        key={dim}
        aria-label={`${LABEL[dim]} state`}
        value={current === ALL ? '' : current}
        placeholder={`${LABEL[dim]}: all`}
        onChange={e => change({ [dim]: e.target.value || null })}
        className="h-control w-auto min-w-[144px] max-sm:w-full"
        options={DIMENSION_VALUES[dim].map(v => ({ value: v, label: `${valueLabel(dim, v)} (${dimCounts[dim].get(v) ?? 0})` }))}
      />
    )
  }

  const empty =
    !filtered && total === 0 ? (
      filters.tab === 'active' ? (
        <EmptyState
          mood="goal"
          title="No active orders"
          actions={
            money ? (
              <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
                New order
              </Button>
            ) : undefined
          }
        >
          Every order is done or cancelled. Win an RFQ, or log an order that came in on WhatsApp, to start one.
        </EmptyState>
      ) : (
        <EmptyState icon={CircleCheck} title={filters.tab === 'done' ? 'Nothing is done yet' : 'Nothing has been cancelled'}>
          {filters.tab === 'done' ? 'An order is done when goods are delivered, commissioning is done and the money side is finished.' : 'Cancelled orders stay on record here, with their reason.'}
        </EmptyState>
      )
    ) : filters.owner === 'mine' && mineCount === 0 && allCount > 0 && !filters.text && filters.goods === ALL && filters.commissioning === ALL && filters.invoicing === ALL && filters.payment === ALL ? (
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
        Nothing in this list has all of the states and the search you chose. Clear the filters to see every order.
      </EmptyState>
    )

  const lede = orders.isSuccess ? `${counts.active} active · ${counts.done} done · ${counts.cancelled} cancelled` : 'Orders from purchase order to delivery and payment.'

  const table = (label: string) => (
    <DataTable
      label={label}
      columns={columns}
      rows={shown}
      getRowId={r => r.id}
      twoLine
      defaultSort={{ id: 'order', dir: 'desc' }}
      mobileRow={r => <OrderCard row={r} money={money} />}
      onRowOpen={r => navigate(`/orders/${r.id}`)}
      loading={orders.isPending}
      error={orders.isError ? { title: "Couldn't load the orders", message: 'Nothing was changed. Check your connection and try again.', onRetry: () => void orders.refetch() } : null}
      summary={orders.isSuccess ? `Showing ${shown.length} of ${total} ${filters.tab} ${total === 1 ? 'order' : 'orders'}` : undefined}
      footerLabel={undefined}
      toolbar={
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2">
          <SegmentedControl
            aria-label="Whose orders"
            className="max-sm:w-full"
            value={filters.owner}
            onValueChange={v => change({ owner: v })}
            options={[
              { value: 'mine', label: ownerLabel, count: orders.isSuccess ? mineCount : undefined },
              { value: 'all', label: 'All', count: orders.isSuccess ? allCount : undefined },
            ]}
          />
          {dimSelect('goods')}
          {dimSelect('commissioning')}
          {money ? dimSelect('invoicing') : null}
          {money ? dimSelect('payment') : null}
          <div className="relative ml-auto min-w-[200px] max-w-[320px] flex-1 max-sm:w-full max-sm:max-w-none">
            <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
            <TextField
              aria-label="Search orders"
              placeholder="Order, PO, customer or site"
              value={filters.text}
              onChange={e => change({ q: e.target.value })}
              style={{ paddingLeft: 36 }}
              autoComplete="off"
            />
          </div>
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
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New order
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
      {creating ? <NewOrderDialog onClose={() => setCreating(false)} /> : null}
    </div>
  )
}
