import { useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CircleCheck, Plus, Users, X } from 'lucide-react'
import { useClosedCount, useClosedRfqs, useOpenRfqs } from '@/features/rfqs/board/hooks'
import {
  applyOwner,
  applyState,
  defaultOwner,
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
import { Tab, TabList, TabPanel, Tabs } from '@/ui/Tabs'

/*
 * RFQ board (R06). Open RFQs in the order the work is due: due date first, then priority. The filters
 * are an owner switch (Mine or All; Mine is the default for sales) and a state filter driven by the
 * sourcing state in v_rfq_state, each with live counts. A second tab pages through RFQs that are won
 * or closed. Where you are (tab, owner, state, page) lives in the address, so a reload or a shared
 * link lands on the same view. An empty open list is the goal state.
 */
type TabKey = 'open' | 'closed'

const isState = (v: string | null): v is StateFilter => STATE_FILTERS.some(s => s.value === v)

const errorProps = (refetch: () => unknown) => ({
  title: "Couldn't load the RFQs",
  message: 'Nothing was changed. Check your connection and try again.',
  onRetry: () => void refetch(),
})

export function BoardPage() {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const [params, setParams] = useSearchParams()

  const tab: TabKey = params.get('tab') === 'closed' ? 'closed' : 'open'
  const owner: OwnerFilter = params.get('owner') === 'all' ? 'all' : params.get('owner') === 'mine' ? 'mine' : defaultOwner(user?.role ?? '')
  const state: StateFilter = isState(params.get('state')) ? (params.get('state') as StateFilter) : 'all'
  const page = Math.max(0, (Number(params.get('page')) || 1) - 1)

  const change = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }

  const open = useOpenRfqs()
  const closed = useClosedRfqs(page, tab === 'closed')
  const closedCount = useClosedCount()

  // Owner narrows first, so the state counts always add up to what the owner switch shows.
  const byOwner = useMemo(() => applyOwner(open.data ?? [], owner, user?.id ?? null), [open.data, owner, user?.id])
  const counts = useMemo(() => stateCounts(byOwner), [byOwner])
  const shown = useMemo(() => applyState(byOwner, state), [byOwner, state])
  const mineCount = useMemo(() => applyOwner(open.data ?? [], 'mine', user?.id ?? null).length, [open.data, user?.id])
  const overdue = useMemo(() => (open.data ?? []).filter(r => r.isOverdue).length, [open.data])

  const openColumns = useMemo<Column<BoardRow>[]>(
    () => [
      { id: 'company', header: 'Company', value: r => r.companyName, sortable: true, cell: r => <CompanyCell row={r} /> },
      { id: 'due', header: 'Due', kind: 'date', value: r => r.dueOn, sortable: true, width: 150, cell: r => <DueCell row={r} /> },
      { id: 'sourcing', header: 'Sourcing', value: r => r.sourcingState, width: 190, cell: r => <SourcingCell row={r} /> },
      { id: 'clarification', header: 'Questions', value: r => r.clarificationState, width: 240, hideBelowMd: true, cell: r => <ClarificationCell row={r} /> },
      { id: 'bid', header: 'Bid', value: r => r.bidState, width: 160, hideBelowMd: true, cell: r => <BidCell row={r} /> },
      { id: 'owner', header: 'Owner', value: r => r.ownerName, sortable: true, width: 130, hideBelowMd: true, cell: r => <OwnerCell row={r} /> },
    ],
    [],
  )
  const closedColumns = useMemo<Column<BoardRow>[]>(
    () => [
      { id: 'company', header: 'Company', value: r => r.companyName, cell: r => <CompanyCell row={r} /> },
      { id: 'outcome', header: 'Outcome', value: r => r.outcome, width: 220, cell: r => <OutcomeCell row={r} /> },
      { id: 'received', header: 'Received', kind: 'date', value: r => r.receivedOn, width: 150, hideBelowMd: true, cell: r => <ReceivedCell row={r} /> },
      { id: 'owner', header: 'Owner', value: r => r.ownerName, width: 130, hideBelowMd: true, cell: r => <OwnerCell row={r} /> },
    ],
    [],
  )

  const navigate = useNavigate()
  const newRfq = () => navigate('/rfqs/new')
  const openRow = (r: BoardRow) => navigate(`/rfqs/${r.rfqId}`)

  const total = open.data?.length ?? 0
  const filtered = owner === 'mine' || state !== 'all'
  const reset = () => change({ owner: 'all', state: null })

  const emptyOpen = !filtered && total === 0 ? (
    <EmptyState
      mood="goal"
      title="No open RFQs. Nice."
      actions={
        <Button variant="primary" icon={Plus} onClick={newRfq}>
          New RFQ
        </Button>
      }
    >
      Every RFQ is won or closed. New ones appear here as soon as they are logged.
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

      <Tabs className="min-w-0" value={tab} onValueChange={v => change({ tab: v === 'closed' ? 'closed' : null, page: null })}>
        <TabList aria-label="RFQ lists">
          <Tab value="open" count={open.isSuccess ? total : undefined}>
            Open
          </Tab>
          <Tab value="closed" count={closedCount.isSuccess ? closedCount.data : undefined}>
            Closed and won
          </Tab>
        </TabList>

        <TabPanel value="open">
          <DataTable
            label="Open RFQs"
            columns={openColumns}
            rows={shown}
            getRowId={r => r.rfqId}
            twoLine
            mobileRow={r => <OpenCard row={r} />}
            onRowOpen={openRow}
            loading={open.isPending}
            error={open.isError ? errorProps(open.refetch) : null}
            summary={open.isSuccess ? `Showing ${shown.length} of ${total} open RFQs` : undefined}
            toolbar={
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
            }
            empty={emptyOpen}
          />
        </TabPanel>

        <TabPanel value="closed">
          <DataTable
            label="Closed and won RFQs"
            columns={closedColumns}
            rows={closed.data?.rows ?? []}
            getRowId={r => r.rfqId}
            twoLine
            mobileRow={r => <ClosedCard row={r} />}
            onRowOpen={openRow}
            loading={closed.isPending}
            error={closed.isError ? errorProps(closed.refetch) : null}
            summary={closed.isSuccess ? pageSummary(page, PAGE_SIZE, closed.data.total) : undefined}
            empty={
              <EmptyState icon={CircleCheck} title="Nothing closed or won yet">
                RFQs that are won, or closed with a reason, are kept here.
              </EmptyState>
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
        </TabPanel>
      </Tabs>
    </div>
  )
}
