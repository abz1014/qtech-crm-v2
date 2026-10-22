import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CircleCheck, CopyPlus, Users } from 'lucide-react'
import { useSession } from '@/app/session'
import { formatShortDate } from '@/lib/formatDay'
import { orderRef } from '@/lib/refs'
import { businessToday } from '@/lib/dates'
import { resolveStatus, type StatusDimension } from '@/lib/status'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { FilterSheet } from '@/ui/FilterSheet'
import { NoResults } from '@/ui/NoResults'
import { PageHeader } from '@/ui/PageHeader'
import { StatusText } from '@/ui/StatusText'
import { FirstUseState, NothingYetState } from '@/features/help/FirstUseState'
import { useFirstUse } from '@/features/help/useFirstUse'
import { Select } from '@/ui/form/Select'
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
  otherMatches,
  searchGroup,
  TABS,
  type Dimension,
  type ListFilters,
  type OwnerFilter,
} from '@/features/orders/lib/listModel'

/*
 * Orders list (O04), reworked by the UX audit of 2026-10-19 (screens.md 7): each row leads with the customer and what they ordered, then
 * ONE plain "Next step" column (lib/nextStep.ts: "Place the supplier order", "Chase payment: 12 days overdue", "Waiting for the goods")
 * instead of four state chips, then the order number. The lifecycle is the tab (Active, Done, Cancelled); the owner switch is Mine or
 * All (for an engineer, "My jobs": the jobs they are assigned to); a search finds an order by number, customer PO, our supplier PO,
 * customer, site or item, in every tab and for everyone: matches outside this tab or owner come after the list's own under an "Also in
 * Done" / "Also in Active · not yours" divider (UX audit 2026-10-22, area 4). Who acts next (Needs action or Waiting) and the four state filters (goods, commissioning, and for admin and sales invoicing and payment) sit behind one "Filters" button:
 * a small panel on a laptop, a sheet on a phone (where the owner switch goes into the sheet too, so the list starts right under the
 * search). Filters combine with AND and live in the address, so a reload or a shared link lands on the same view.
 *
 * "Repeat a past order" (was "New order") copies a past order: a new order is otherwise made by winning an RFQ. Money (invoicing,
 * payment, value) is never requested for an engineer.
 */
const LABEL: Record<Dimension, string> = { goods: 'Goods', commissioning: 'Commissioning', invoicing: 'Invoicing', payment: 'Payment' }
const STATUS_DIM: Record<Dimension, StatusDimension> = { goods: 'goods', commissioning: 'commissioning', invoicing: 'invoicing', payment: 'payment' }

/**
 * Where two view values share one status word, the filter option adds a detail so the choices stay distinct (spec 1.2 rule 4). The goods
 * details use the order page's words ("Not ordered yet", "Ordered", "No supplier yet"), never "placed".
 */
const FILTER_DETAIL: Partial<Record<string, string>> = {
  'goods:to_source': 'no supplier yet',
  'goods:to_place': 'supplier chosen',
  'goods:received': 'with us',
  'goods:partly_delivered': 'partly delivered',
  'invoicing:not_invoiced': 'nothing invoiced',
  'invoicing:part': 'part invoiced',
  'payment:unpaid': 'nothing paid',
  'payment:part': 'part paid',
}
const valueLabel = (dim: Dimension, value: string) => {
  const detail = FILTER_DETAIL[`${dim}:${value}`]
  const word = resolveStatus(STATUS_DIM[dim], value).label
  return detail ? `${word} · ${detail}` : word
}

/** What "done" means differs by role (v_order_state.is_done): sales are done once it is invoiced; their Next step still says if it is unpaid. */
const doneMeaning = (role: string) =>
  role === 'sales'
    ? 'An order is done for you when the goods are delivered, commissioning is done and it is fully invoiced. If the customer has not paid, its Next step still says so.'
    : role === 'engineer'
      ? 'An order is done for you when the goods are delivered and commissioning is done.'
      : 'An order is done when the goods are delivered, commissioning is done, it is paid and its costs are complete.'

/** The row's one Next step as status text (icon and words, no box; spec 1.2 rule 3). */
function NextStepText({ step }: { step: NextStep }) {
  return (
    <StatusText tone={step.tone} className="whitespace-normal">
      {step.text}
    </StatusText>
  )
}

function CustomerCell({ row }: { row: OrderListRow }) {
  return (
    <span className="grid min-w-[180px] max-w-[460px] gap-px whitespace-normal">
      <span className="font-medium">
        {row.companyName}
        {row.siteName ? <span className="font-regular text-fg-muted">{` · ${row.siteName}`}</span> : null}
      </span>
      <span className="min-w-0 text-sm text-fg-2 [overflow-wrap:anywhere]">{row.what ? `${row.what}${row.moreLines ? ' + more' : ''}` : <span className="text-fg-muted">No lines yet</span>}</span>
    </span>
  )
}

/**
 * The order code over its customer PO and owner. The second line wraps inside the cell (table cells are nowrap by default), so a
 * long PO never runs into the Value column beside it ("PO CPC/PO/INST/2219 · Test Admin" over "10,558,640", UX audit 2026-10-22 O1).
 */
function OrderCell({ row }: { row: OrderListRow }) {
  return (
    <span className="grid min-w-[140px] max-w-[240px] gap-px whitespace-normal">
      <span className="num">{orderRef(row.number)}</span>
      <span className="min-w-0 text-sm text-fg-muted [overflow-wrap:break-word]">{[row.customerPo ? `PO ${row.customerPo}` : null, row.ownerName].filter(Boolean).join(' · ') || ' '}</span>
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
      {row.what ? <span className="min-w-0 text-sm text-fg-2 [overflow-wrap:anywhere]">{`${row.what}${row.moreLines ? ' + more' : ''}`}</span> : null}
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
  const bySplit = (r: OrderListRow) => split === 'all' || r.lifecycle !== 'active' || (split === 'need') === needsAction(r)
  const own = shown.filter(bySplit)
  // A typed search reaches every tab and every owner: the other matches follow this list's own, each group under its divider.
  const searching = filters.text.trim() !== ''
  const others = useMemo(() => otherMatches(all, filters, who), [all, filters, who]).filter(bySplit)
  const rank = (r: OrderListRow) => searchGroup(r, filters, who).rank
  const rows = others.length ? [...own, ...[...others].sort((a, b) => rank(a) - rank(b))] : own
  const groupOf = others.length
    ? (r: OrderListRow) => {
        const g = searchGroup(r, filters, who)
        return { key: g.key, label: g.label }
      }
    : undefined
  const columns: Column<OrderListRow>[] = [
    { id: 'customer', header: 'Customer and items', value: r => r.companyName, sortable: true, cell: r => <CustomerCell row={r} /> },
    // text columns sorted by a number (the urgency rank, the order number): compareCells compares text numerically
    { id: 'next', header: 'Next step', value: r => stepOf(r).rank, sortable: true, cell: r => <NextStepText step={stepOf(r)} /> },
    { id: 'order', header: 'Order', value: r => r.number, sortable: true, cell: r => <OrderCell row={r} /> },
    ...(money ? ([{ id: 'gross', header: 'Value (PKR)', kind: 'money', value: (r: OrderListRow) => r.gross, sortable: true }] satisfies Column<OrderListRow>[]) : []),
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
  const firstUse = useFirstUse('orders', user?.id ?? '', role, orders.isSuccess && filters.tab === 'active' && filters.owner === 'mine' && mineCount === 0 && !filters.text && dimsOn === 0)
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
        { value: 'mine', label: ownerLabel },
        { value: 'all', label: 'All' },
      ]}
    />
  )
  // On a phone the owner switch lives in the sheet, so it counts as a filter there when it is off its default.
  const ownerOff = phone && filters.owner !== defaultOwner(role)
  const clearSheet = () => change({ goods: null, commissioning: null, invoicing: null, payment: null, show: null, ...(phone ? { owner: null } : {}) })
  // R2-05: the active orders split by who acts next, the first choice in Filters. Its counts are words in the options, as the states'.
  const splitSelect = (
    <label className="grid gap-1 text-sm">
      <span className="text-fg-muted">Who acts next</span>
      <Select
        aria-label="Who acts next"
        value={split === 'all' ? '' : split}
        placeholder="Any"
        onChange={e => change({ show: e.target.value || null })}
        className="w-full"
        options={[
          { value: 'need', label: orders.isSuccess ? `Needs action (${needCount})` : 'Needs action' },
          { value: 'waiting', label: orders.isSuccess ? `Waiting (${shown.length - needCount})` : 'Waiting' },
        ]}
      />
    </label>
  )

  const empty = firstUse.isNew ? (
      <FirstUseState screen="orders" role={role} onEveryone={() => change({ owner: 'all' })} everyoneCount={allCount} className="mx-5 my-4" />
    ) : !filtered && all.length === 0 && filters.tab === 'active' ? (
      // No order has ever been made (a new CRM): "Every order is done or cancelled" would be untrue.
      <NothingYetState screen="orders" />
    ) : !filtered && total === 0 ? (
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
      <NoResults
        query={filters.text}
        // a search looks in every tab and at everyone's orders; with no text the tab and the owner switch narrow the list
        scope={searching ? 'every order (active, done and cancelled, everyone’s)' : `${filters.tab} orders`}
        fields="customer, site, item, order number, customer PO and supplier PO"
        filtersOn={[
          ...(!searching && filters.owner === 'mine' ? [ownerLabel] : []),
          ...(['goods', 'commissioning', 'invoicing', 'payment'] as const).filter(d => filters[d] !== ALL).map(d => `${LABEL[d]}: ${valueLabel(d, filters[d])}`),
          ...(split === 'need' ? ['Needs action'] : split === 'waiting' ? ['Waiting'] : []),
        ]}
        onClear={reset}
      />
    )

  // Words, not pills (consistency spec 2.2 #15): the active orders split by who acts next.
  const activeMine = useMemo(
    () => filterRows(all, { ...filters, tab: 'active', goods: ALL, commissioning: ALL, invoicing: ALL, payment: ALL, text: '' }, who),
    [all, filters, who],
  )
  const activeNeed = activeMine.filter(needsAction).length
  const lede = orders.isSuccess
    ? activeMine.length === 0
      ? 'No active orders.'
      : `${activeNeed} need you · ${activeMine.length - activeNeed} waiting`
    : 'From the customer’s PO to delivery and payment.'

  const table = (label: string) => (
    <DataTable
      label={label}
      columns={columns}
      rows={rows}
      getRowId={r => r.id}
      group={groupOf}
      twoLine
      // R2-05: the active list starts with the most urgent step first (late, then now, then waiting); done and cancelled newest first
      defaultSort={filters.tab === 'active' ? { id: 'next', dir: 'asc' } : { id: 'order', dir: 'desc' }}
      mobileRow={r => <OrderCard row={r} step={stepOf(r)} />}
      onRowOpen={r => navigate(`/orders/${r.id}`)}
      loading={orders.isPending}
      error={orders.isError ? { title: "Couldn't load the orders", message: 'Nothing was changed. Check your connection and try again.', onRetry: () => void orders.refetch() } : null}
      summary={
        orders.isSuccess
          ? `Showing ${own.length} of ${total} ${filters.tab} ${total === 1 ? 'order' : 'orders'}${others.length ? ` · ${others.length} more found in other lists` : ''}`
          : undefined
      }
      toolbar={
        // One row (UX audit 2026-10-22, O2/O3): Mine or All, the search, and the one Filters button. "Who acts next" lives behind
        // Filters with the state filters (no "Any" segment: no choice is no filter). On a phone the search takes the whole first line
        // (it is never cut off at 320 to 430 px) and Filters, which then holds Mine or All too, wraps under it.
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
          {phone ? null : ownerSwitch}
          <TableFilter label="Search orders" hint="Finds an order by customer, site, item, order number, customer PO or supplier PO, in every tab." value={filters.text} onChange={v => change({ q: v })} className="min-w-0 max-sm:basis-full sm:max-w-[360px] sm:flex-1" />
          <FilterSheet title="Filter orders" on={dimsOn + (split !== 'all' ? 1 : 0) + (ownerOff ? 1 : 0)} shown={rows.length} noun={['order', 'orders']} onClear={clearSheet} phoneOnly={ownerSwitch}>
            {filters.tab === 'active' ? splitSelect : null}
            {dims}
          </FilterSheet>
        </div>
      }
      empty={empty}
    />
  )

  return (
    <div className="mx-auto grid w-full max-w-table grid-cols-[minmax(0,1fr)] content-start gap-4 px-4 pb-12 pt-6 md:px-8">
      <PageHeader
        title="Orders"
        lede={lede}
        // The list's one green action (rubric: exactly one green button per screen), as New RFQ is on the RFQ list.
        primary={
          money ? (
            <Button variant="primary" icon={CopyPlus} onClick={() => setCreating(true)}>
              Repeat a past order
            </Button>
          ) : undefined
        }
      />

      <Tabs className="min-w-0" value={filters.tab} onValueChange={v => change({ tab: v === 'active' ? null : v })}>
        <TabList aria-label="Order lists">
          {TABS.map(t => (
            <Tab key={t.value} value={t.value}>
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
