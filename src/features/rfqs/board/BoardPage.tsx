import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight, CircleCheck, Plus, Search, Users, X } from 'lucide-react'
import { useClosedCount, useClosedRfqs, useOpenRfqs, useRfqValues } from '@/features/rfqs/board/hooks'
import {
  applyOwner,
  applyQuery,
  applyStep,
  defaultOwner,
  failureReference,
  isBoardShow,
  NEXT_STEP_LABEL,
  PAGE_SIZE,
  pageSummary,
  stepCounts,
  type BoardRow,
  type BoardShow,
  type NextStep,
  type OwnerFilter,
} from '@/features/rfqs/board/model'
import { ClosedCard, DueCell, NextStepCell, OpenCard, OutcomeCell, OwnerCell, ReceivedCell, RfqCell } from '@/features/rfqs/board/BoardParts'
import { StepFilter } from '@/features/rfqs/board/StepFilter'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { EmptyState } from '@/ui/EmptyState'
import { FirstUseState, NothingYetState } from '@/features/help/FirstUseState'
import { useFirstUse } from '@/features/help/useFirstUse'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { Icon } from '@/ui/Icon'
import { InfoTip } from '@/ui/InfoTip'
import { TextField } from '@/ui/form/TextField'

/*
 * RFQ board (R06; UX audit 2026-10-19). Open RFQs in the order the work is due: due date first, then priority. One filter worded
 * as the next step (All open, Needs suppliers, Waiting for prices, Ready to quote, Quotation sent, Closed) with live counts, and
 * the owner switch (Mine or All; Mine is the default for sales). Each row leads with the company and what was asked, then the
 * code, and one "Next step" column says where it stands. Where you are (what is shown, owner, page) lives in the address, so a
 * reload or a shared link lands on the same view. An empty open list is the goal state.
 * The filter box (`/` focuses it, Esc clears) narrows the open list on this device; on Closed it searches the server, over every
 * closed RFQ (number, customer reference, company and item text), not only the page on screen.
 */
const errorProps = (q: { refetch: () => unknown; error: Error | null; errorUpdatedAt: number }) => ({
  title: 'Couldn’t load RFQs',
  message: 'Your changes are safe. Check your connection and try again.',
  onRetry: () => void q.refetch(),
  at: new Date(q.errorUpdatedAt || Date.now()),
  reference: failureReference(q.errorUpdatedAt, q.error?.message ?? ''),
})

/** The text the closed search sends, a beat after the last key, so each key press is not a request. */
function useSettled(text: string, ms = 300): string {
  const [settled, setSettled] = useState(text)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(text), ms)
    return () => window.clearTimeout(t)
  }, [text, ms])
  return settled
}

export function BoardPage() {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const [params, setParams] = useSearchParams()

  // `?tab=closed` is the old address of the Closed list; it still lands there.
  const show: BoardShow = isBoardShow(params.get('show')) ? (params.get('show') as BoardShow) : params.get('tab') === 'closed' ? 'closed' : 'all'
  const closedTab = show === 'closed'
  const owner: OwnerFilter = params.get('owner') === 'all' ? 'all' : params.get('owner') === 'mine' ? 'mine' : defaultOwner(user?.role ?? '')
  const page = Math.max(0, (Number(params.get('page')) || 1) - 1)
  const [query, setQuery] = useState('')
  const filterRef = useRef<HTMLInputElement>(null)
  const q = query.trim()
  const searched = useSettled(closedTab ? q : '')

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
    // The old address (?tab=closed, ?state=...) becomes the new one before the change is applied, so Closed stays Closed.
    if (next.get('tab') === 'closed' && !next.has('show')) next.set('show', 'closed')
    next.delete('tab')
    next.delete('state')
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }

  // A new closed search starts on its first page.
  const lastSearch = useRef(searched)
  useEffect(() => {
    if (lastSearch.current === searched) return
    lastSearch.current = searched
    if (page > 0) change({ page: null })
    // change reads the current params; only a new search should reset the page
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searched])

  const open = useOpenRfqs()
  // Value is money: engineers never see it, and for them the request is never made.
  const canSeeMoney = user?.role === 'admin' || user?.role === 'sales'
  const values = useRfqValues(canSeeMoney)
  const closed = useClosedRfqs(page, searched, closedTab)
  const closedCount = useClosedCount()

  // Owner narrows first, so the step counts always add up to what the owner switch shows.
  const byOwner = useMemo(() => applyOwner(open.data ?? [], owner, user?.id ?? null), [open.data, owner, user?.id])
  const counts = useMemo(() => stepCounts(byOwner), [byOwner])
  const step: 'all' | NextStep = show === 'closed' ? 'all' : show
  const shown = useMemo(() => applyQuery(applyStep(byOwner, step), q), [byOwner, step, q])
  const mineCount = useMemo(() => applyOwner(open.data ?? [], 'mine', user?.id ?? null).length, [open.data, user?.id])
  const overdue = useMemo(() => (open.data ?? []).filter(r => r.isOverdue).length, [open.data])
  // "Need you": the two steps that wait on our side (ask suppliers, send the quotation); the others wait on someone else.
  const needYou = useMemo(() => {
    const c = stepCounts(open.data ?? [])
    return c.suppliers + c.ready
  }, [open.data])

  const openColumns = useMemo<Column<BoardRow>[]>(
    () => [
      { id: 'rfq', header: 'RFQ', value: r => r.companyName, sortable: true, cell: r => <RfqCell row={r} /> },
      { id: 'next', header: 'Next step', value: r => r.sourcingState, width: 250, cell: r => <NextStepCell row={r} /> },
      { id: 'due', header: 'Due', kind: 'date', value: r => r.dueOn, sortable: true, width: 140, cell: r => <DueCell row={r} /> },
      ...(canSeeMoney
        ? [{ id: 'value', header: 'Value (PKR net)', kind: 'money' as const, value: (r: BoardRow) => values.data?.[r.rfqId] ?? null, width: 130, sortable: true }]
        : []),
      { id: 'owner', header: 'Owner', value: r => r.ownerName, sortable: true, width: 120, hideBelowMd: true, cell: r => <OwnerCell row={r} /> },
    ],
    [canSeeMoney, values.data],
  )
  const closedColumns = useMemo<Column<BoardRow>[]>(
    () => [
      { id: 'rfq', header: 'RFQ', value: r => r.companyName, cell: r => <RfqCell row={r} /> },
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
  const filtered = owner === 'mine' || step !== 'all'
  const reset = () => change({ owner: 'all', show: null })

  const clearQuery = () => {
    setQuery('')
    filterRef.current?.focus()
  }
  const noMatch = (
    <EmptyState title={`No RFQs match “${q}”`} actions={<Button onClick={clearQuery}>Clear filter</Button>}>
      {closedTab
        ? 'Searched every closed and won RFQ by number, customer, their reference and item. Try fewer words or clear the filter.'
        : 'The filter covers the RFQ number, the customer, their reference and the first item. Try fewer words or clear the filter.'}
    </EmptyState>
  )

  const firstUse = useFirstUse('rfqs', user?.id ?? '', user?.role ?? '', open.isSuccess && owner === 'mine' && mineCount === 0 && step === 'all' && !q)
  // "Every quotation is out or closed" is only true once there has been an RFQ: with none open and none closed or won (a new
  // CRM), the board says what will appear here instead. Until the closed count answers, the neutral line shows (never a false "done").
  const neverAny = total === 0 && !(closedCount.isSuccess && closedCount.data > 0)
  const emptyOpen = q && total > 0 ? noMatch : !filtered && neverAny ? (
    <NothingYetState screen="rfqs" />
  ) : !filtered && total === 0 ? (
    <EmptyState
      mood="goal"
      title="No open RFQs"
      actions={
        <Button variant="primary" icon={Plus} onClick={newRfq}>
          New RFQ
        </Button>
      }
    >
      Every quotation is out or closed. New RFQs appear here as soon as you start one.
    </EmptyState>
  ) : owner === 'mine' && mineCount === 0 && step === 'all' && firstUse.isNew ? (
    <FirstUseState screen="rfqs" role={user?.role ?? ''} className="mx-5 my-4" />
  ) : owner === 'mine' && mineCount === 0 && step === 'all' ? (
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
      title={step === 'all' ? 'No RFQs here' : `Nothing at “${NEXT_STEP_LABEL[step]}”`}
      actions={
        <Button icon={X} onClick={reset}>
          Show all open RFQs
        </Button>
      }
    >
      Nothing matches this owner and next step. Show every open RFQ instead.
    </EmptyState>
  )

  const filterBox = (
    <div className="relative w-[260px] max-w-full max-sm:w-full">
      <span className="pointer-events-none absolute inset-y-0 left-[10px] grid place-items-center text-fg-muted">
        <Icon icon={Search} />
      </span>
      <TextField
        ref={filterRef}
        className="pl-8"
        placeholder={closedTab ? 'Search closed RFQs' : 'Filter RFQs'}
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

  const toolbar = (
    <div className="flex w-full flex-wrap items-center gap-3">
      {/* Mine or All narrows the open RFQs; the Closed list is everyone's (as before), so the switch is not drawn there. */}
      {closedTab ? null : (
        <SegmentedControl
          aria-label="Whose RFQs"
          large
          value={owner}
          onValueChange={v => change({ owner: v, page: null })}
          options={[
            { value: 'mine', label: 'Mine' },
            { value: 'all', label: 'All' },
          ]}
        />
      )}
      <div className="min-w-0 flex-1">
        <StepFilter
          value={show}
          onChange={v => change({ show: v === 'all' ? null : v, page: null })}
          needs={open.isSuccess ? { suppliers: counts.suppliers, ready: counts.ready } : {}}
        />
      </div>
      <InfoTip label="About next steps">Needs suppliers → Waiting for prices → Ready to quote → Quotation sent → Won or closed.</InfoTip>
    </div>
  )

  const lede = open.isSuccess
    ? total === 0
      ? 'Nothing is waiting on you.'
      : [`${total} open`, needYou ? `${needYou} need you` : null, overdue ? `${overdue} overdue` : null].filter(Boolean).join(' · ')
    : 'Open RFQs, earliest due date first.'

  const closedSummary = closed.isSuccess ? pageSummary(page, PAGE_SIZE, closed.data.total) : undefined

  return (
    <div className="mx-auto grid w-full max-w-table grid-cols-[minmax(0,1fr)] content-start gap-4 px-4 pb-12 pt-6 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="grid gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">RFQs</h1>
          <p className="text-sm text-fg-muted">{lede}</p>
        </div>
        {/* Phone: New RFQ beside the title, the filter box on its own line under them. */}
        <div className="flex items-center gap-3 max-sm:contents">
          <div className="max-sm:order-last max-sm:w-full">{filterBox}</div>
          <Button variant="primary" icon={Plus} onClick={newRfq}>
            New RFQ
          </Button>
        </div>
      </header>

      <div className="min-w-0">
        {!closedTab ? (
          <DataTable
            label="Open RFQs"
            columns={openColumns}
            rows={shown}
            getRowId={r => r.rfqId}
            twoLine
            densitySwitch={false}
            mobileRow={r => <OpenCard row={r} />}
            onRowOpen={openRow}
            loading={open.isPending}
            error={open.isError ? errorProps(open) : null}
            summary={open.isSuccess ? `Showing ${shown.length} of ${total} open RFQs` : undefined}
            toolbar={toolbar}
            empty={emptyOpen}
          />
        ) : (
          <>
            <DataTable
              label="Closed and won RFQs"
              columns={closedColumns}
              rows={closed.data?.rows ?? []}
              getRowId={r => r.rfqId}
              twoLine
              densitySwitch={false}
              mobileRow={r => <ClosedCard row={r} />}
              onRowOpen={openRow}
              loading={closed.isPending}
              error={closed.isError ? errorProps(closed) : null}
              summary={closedSummary}
              toolbar={toolbar}
              empty={
                searched ? (
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
                <span className="num mr-2 text-sm text-fg-muted">
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
