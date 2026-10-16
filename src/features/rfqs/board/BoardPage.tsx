import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CircleCheck, Plus, Search, Users, X } from 'lucide-react'
import { useClosedCount, useClosedRfqs, useOpenRfqs, useRfqValues } from '@/features/rfqs/board/hooks'
import {
  applyOwner,
  applyQuery,
  applyState,
  defaultOwner,
  failureReference,
  PAGE_SIZE,
  pageSummary,
  STATE_FILTERS,
  stateCounts,
  type BoardRow,
  type OwnerFilter,
  type StateFilter,
} from '@/features/rfqs/board/model'
import { BidCell, ClarificationCell, ClosedCard, CompanyCell, DueCell, OpenCard, OutcomeCell, OwnerCell, ReceivedCell, SourcingCell } from '@/features/rfqs/board/BoardParts'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Icon } from '@/ui/Icon'
import { TextField } from '@/ui/form/TextField'

/*
 * RFQ board (R06). Open RFQs in the order the work is due: due date first, then priority. The filters
 * are an owner switch (Mine or All; Mine is the default for sales) and a state filter driven by the
 * sourcing state in v_rfq_state, each with live counts. A second tab pages through RFQs that are won
 * or closed. Where you are (tab, owner, state, page) lives in the address, so a reload or a shared
 * link lands on the same view. An empty open list is the goal state.
 * The toolbar is drawn in the DataTable mockup: a filter box (`/` focuses it, Esc clears), the Open and
 * Closed switch, and the Comfortable or Compact density, which is remembered per person on this device.
 */
type TabKey = 'open' | 'closed'

const isState = (v: string | null): v is StateFilter => STATE_FILTERS.some(s => s.value === v)

type Density = 'comfortable' | 'compact'
const DENSITY_KEY = 'qtech.rfqs.density'
const readDensity = (): Density => {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'comfortable'
  } catch {
    return 'comfortable'
  }
}

const errorProps = (q: { refetch: () => unknown; error: Error | null; errorUpdatedAt: number }) => ({
  title: 'Couldn’t load RFQs',
  message: 'Your changes are safe. Check your connection and try again.',
  onRetry: () => void q.refetch(),
  at: new Date(q.errorUpdatedAt || Date.now()),
  reference: failureReference(q.errorUpdatedAt, q.error?.message ?? ''),
})

export function BoardPage() {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const [params, setParams] = useSearchParams()

  const tab: TabKey = params.get('tab') === 'closed' ? 'closed' : 'open'
  const owner: OwnerFilter = params.get('owner') === 'all' ? 'all' : params.get('owner') === 'mine' ? 'mine' : defaultOwner(user?.role ?? '')
  const state: StateFilter = isState(params.get('state')) ? (params.get('state') as StateFilter) : 'all'
  const page = Math.max(0, (Number(params.get('page')) || 1) - 1)
  const [query, setQuery] = useState('')
  const [density, setDensity] = useState<Density>(readDensity)
  const filterRef = useRef<HTMLInputElement>(null)
  const q = query.trim()
  const compact = density === 'compact'

  const pickDensity = (d: string) => {
    const next: Density = d === 'compact' ? 'compact' : 'comfortable'
    setDensity(next)
    try {
      localStorage.setItem(DENSITY_KEY, next)
    } catch {
      /* private window: the choice lasts for this visit only */
    }
  }

  // "/" jumps to the filter box, unless the person is already typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.closest('[role="dialog"]'))) return
      e.preventDefault()
      filterRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const change = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }

  const open = useOpenRfqs()
  // Value is money: engineers never see it, and for them the request is never made.
  const canSeeMoney = user?.role === 'admin' || user?.role === 'sales'
  const values = useRfqValues(canSeeMoney)
  const closed = useClosedRfqs(page, tab === 'closed')
  const closedCount = useClosedCount()

  // Owner narrows first, so the state counts always add up to what the owner switch shows.
  const byOwner = useMemo(() => applyOwner(open.data ?? [], owner, user?.id ?? null), [open.data, owner, user?.id])
  const counts = useMemo(() => stateCounts(byOwner), [byOwner])
  const shown = useMemo(() => applyQuery(applyState(byOwner, state), q), [byOwner, state, q])
  const mineCount = useMemo(() => applyOwner(open.data ?? [], 'mine', user?.id ?? null).length, [open.data, user?.id])
  const overdue = useMemo(() => (open.data ?? []).filter(r => r.isOverdue).length, [open.data])

  const openColumns = useMemo<Column<BoardRow>[]>(
    () => [
      { id: 'company', header: 'Company', value: r => r.companyName, sortable: true, cell: r => <CompanyCell row={r} compact={compact} /> },
      { id: 'due', header: 'Due', kind: 'date', value: r => r.dueOn, sortable: true, width: compact ? 230 : 150, cell: r => <DueCell row={r} compact={compact} /> },
      { id: 'items', header: 'Items', kind: 'num', value: r => r.itemsTotal, width: 80, hideBelowMd: true, cell: r => <span className="num">{r.itemsTotal}</span> },
      { id: 'sourcing', header: 'Sourcing', value: r => r.sourcingState, width: compact ? 260 : 190, cell: r => <SourcingCell row={r} compact={compact} /> },
      { id: 'clarification', header: 'Questions', value: r => r.clarificationState, width: 240, hideBelowMd: true, cell: r => <ClarificationCell row={r} /> },
      { id: 'bid', header: 'Bid', value: r => r.bidState, width: 160, hideBelowMd: true, cell: r => <BidCell row={r} /> },
      ...(canSeeMoney
        ? [{ id: 'value', header: 'Value (PKR net)', kind: 'money' as const, value: (r: BoardRow) => values.data?.[r.rfqId] ?? null, width: 150, hideBelowMd: true, sortable: true }]
        : []),
      { id: 'owner', header: 'Owner', value: r => r.ownerName, sortable: true, width: 130, hideBelowMd: true, cell: r => <OwnerCell row={r} /> },
    ],
    [compact, canSeeMoney, values.data],
  )
  const closedColumns = useMemo<Column<BoardRow>[]>(
    () => [
      { id: 'company', header: 'Company', value: r => r.companyName, cell: r => <CompanyCell row={r} compact={compact} /> },
      { id: 'outcome', header: 'Outcome', value: r => r.outcome, width: 220, cell: r => <OutcomeCell row={r} /> },
      { id: 'received', header: 'Received', kind: 'date', value: r => r.receivedOn, width: 150, hideBelowMd: true, cell: r => <ReceivedCell row={r} /> },
      { id: 'owner', header: 'Owner', value: r => r.ownerName, width: 130, hideBelowMd: true, cell: r => <OwnerCell row={r} /> },
    ],
    [compact],
  )

  const navigate = useNavigate()
  const newRfq = () => navigate('/rfqs/new')
  const openRow = (r: BoardRow) => navigate(`/rfqs/${r.rfqId}`)

  const total = open.data?.length ?? 0
  const filtered = owner === 'mine' || state !== 'all'
  const reset = () => change({ owner: 'all', state: null })

  const clearQuery = () => {
    setQuery('')
    filterRef.current?.focus()
  }
  const noMatch = (
    <EmptyState title={`No RFQs match “${q}”`} actions={<Button onClick={clearQuery}>Clear filter</Button>}>
      The filter covers RFQ number, customer and customer ref. Try fewer words or clear the filter.
    </EmptyState>
  )

  const emptyOpen = q && total > 0 ? noMatch : !filtered && total === 0 ? (
    <EmptyState
      mood="goal"
      title="Every bid is in"
      actions={
        <Button variant="primary" icon={Plus} onClick={newRfq}>
          New RFQ
        </Button>
      }
    >
      Nothing is open and nothing is due in the next 5 days. New RFQs appear here as soon as you start one.
    </EmptyState>
  ) : owner === 'mine' && mineCount === 0 && state === 'all' ? (
    <EmptyState
      mood="goal"
      title="None of your RFQs are open. Nice."
      actions={
        <Button icon={Users} onClick={() => change({ owner: 'all' })}>
          Show everyone’s ({total})
        </Button>
      }
    >
      Everything assigned to you is won or closed.
    </EmptyState>
  ) : (
    <EmptyState
      title="No RFQs in this view"
      actions={
        <Button icon={X} onClick={reset}>
          Show all open RFQs
        </Button>
      }
    >
      Nothing matches this owner and state. Clear the filters to see every open RFQ.
    </EmptyState>
  )

  const closedShown = useMemo(() => applyQuery(closed.data?.rows ?? [], q), [closed.data, q])

  const filterBox = (
    <div className="relative w-[220px] max-w-full">
      <span className="pointer-events-none absolute inset-y-0 left-[10px] grid place-items-center text-fg-muted">
        <Icon icon={Search} />
      </span>
      <TextField
        ref={filterRef}
        className="pl-8"
        placeholder="Filter RFQs"
        aria-label="Filter RFQs"
        aria-keyshortcuts="/"
        autoComplete="off"
        value={query}
        onChange={e => setQuery(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Escape' && query) {
            e.preventDefault()
            setQuery('')
          }
        }}
      />
    </div>
  )
  const listBar = (
    <>
      {filterBox}
      <SegmentedControl
        aria-label="Which RFQs"
        value={tab}
        onValueChange={v => change({ tab: v === 'closed' ? 'closed' : null, page: null })}
        options={[
          { value: 'open', label: 'Open', count: open.isSuccess ? total : undefined },
          { value: 'closed', label: 'Closed', count: closedCount.isSuccess ? closedCount.data : undefined },
        ]}
      />
    </>
  )
  const densityBar = (
    <SegmentedControl
      aria-label="Density"
      className="ml-auto"
      value={density}
      onValueChange={pickDensity}
      options={[
        { value: 'comfortable', label: 'Comfortable' },
        { value: 'compact', label: 'Compact' },
      ]}
    />
  )

  const lede = open.isSuccess
    ? total === 0
      ? 'Nothing is waiting on you.'
      : `${total} open${overdue ? `, ${overdue} overdue` : ''}. Earliest due date first, priority RFQs ahead of the rest.`
    : 'Open RFQs, earliest due date first.'

  return (
    <div className="mx-auto grid w-full max-w-table grid-cols-[minmax(0,1fr)] content-start gap-4 px-4 pb-12 pt-6 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">RFQs</h1>
          <p className="text-sm text-fg-muted">{lede}</p>
        </div>
        <Button variant="primary" icon={Plus} onClick={newRfq}>
          New RFQ
        </Button>
      </header>

      <div className="min-w-0">
        {tab === 'open' ? (
          <DataTable
            label="Open RFQs"
            columns={openColumns}
            rows={shown}
            getRowId={r => r.rfqId}
            twoLine={!compact}
            density={density}
            densitySwitch={false}
            mobileRow={r => <OpenCard row={r} />}
            onRowOpen={openRow}
            loading={open.isPending}
            error={open.isError ? errorProps(open) : null}
            summary={open.isSuccess ? `Showing ${shown.length} of ${total} open RFQs` : undefined}
            toolbar={
              <div className="grid w-full gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  {listBar}
                  {densityBar}
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <SegmentedControl
                  aria-label="Whose RFQs"
                  value={owner}
                  onValueChange={v => change({ owner: v })}
                  options={[
                    { value: 'mine', label: 'Mine', count: open.isSuccess ? mineCount : undefined },
                    { value: 'all', label: 'All', count: open.isSuccess ? total : undefined },
                  ]}
                />
                <SegmentedControl
                  aria-label="Sourcing state"
                  value={state}
                  onValueChange={v => change({ state: v === 'all' ? null : v })}
                  options={STATE_FILTERS.map(s => ({ ...s, count: open.isSuccess ? counts[s.value] : undefined }))}
                />
                </div>
              </div>
            }
            empty={emptyOpen}
          />
        ) : (
          <>
          <DataTable
            label="Closed and won RFQs"
            columns={closedColumns}
            rows={closedShown}
            getRowId={r => r.rfqId}
            twoLine={!compact}
            density={density}
            densitySwitch={false}
            mobileRow={r => <ClosedCard row={r} />}
            onRowOpen={openRow}
            loading={closed.isPending}
            error={closed.isError ? errorProps(closed) : null}
            summary={closed.isSuccess ? pageSummary(page, PAGE_SIZE, closed.data.total) : undefined}
            toolbar={
              <div className="flex w-full flex-wrap items-center gap-3">
                {listBar}
                {densityBar}
              </div>
            }
            empty={
              q && (closed.data?.rows.length ?? 0) > 0 ? (
                noMatch
              ) : (
                <EmptyState icon={CircleCheck} title="Nothing closed or won yet">
                  RFQs that are won, or closed with a reason, are kept here.
                </EmptyState>
              )
            }
          />
          {closed.isSuccess && closed.data.total > PAGE_SIZE ? (
            <nav aria-label="Pages" className="flex items-center justify-end gap-2 pt-3">
              <span className="num mr-2 text-xs text-fg-muted">
                Page {page + 1} of {Math.ceil(closed.data.total / PAGE_SIZE)}
              </span>
              <Button size="sm" icon={ChevronLeft} disabled={page === 0 || closed.isFetching} onClick={() => change({ page: page <= 1 ? null : String(page) })}>
                Previous
              </Button>
              <Button
                size="sm"
                icon={ChevronRight}
                disabled={(page + 1) * PAGE_SIZE >= closed.data.total || closed.isFetching}
                onClick={() => change({ page: String(page + 2) })}
              >
                Next
              </Button>
            </nav>
          ) : null}
          </>
        )}
      </div>
    </div>
  )
}
