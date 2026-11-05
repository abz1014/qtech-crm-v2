import { NoPrimary } from '@/ui/NoPrimary'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { FilePlus2 } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { DataTable, type Column } from '@/ui/DataTable'
import { NoResults } from '@/ui/NoResults'
import { PageHeader } from '@/ui/PageHeader'
import { SegmentedControl } from '@/ui/SegmentedControl'
import { StatusText } from '@/ui/StatusText'
import { TableFilter } from '@/ui/TableFilter'
import { EmptyState } from '@/ui/EmptyState'
import { useCustomerPos, useJobSearch, useJobsList } from '@/features/jobs/hooks'
import type { JobRow } from '@/features/jobs/api'
import { StageLine, StageMini } from '@/features/jobs/StageBar'
import { StageFilter } from '@/features/jobs/StageFilter'
import { jobNext } from '@/features/jobs/lib/nextStep'
import { byRecent, chipCounts, defaultChip, inChip, inStage, isChip, itemsSummary, jobLabel, normalizeStage, stagesFor, STAGE_LABEL, type Chip, type StageFilter as Stage, type Who } from '@/features/jobs/lib/listModel'
import { stageModel } from '@/features/jobs/lib/stages'
import { lazyShown } from '@/lib/lazyDialog'

// Downloaded the first time it opens (+ New > Order without enquiry arrives as /orders?new=1, which the old-address redirect carries here).
const NewOrderDialog = lazyShown(() => import('@/features/orders/NewOrderDialog').then(m => m.NewOrderDialog))

/*
 * Jobs (redesign phase 5, P5-B). One row per customer request from enquiry to payment ("Job 139"; "Job O-45" for an order with no
 * enquiry). Three chips: Mine, Open and History; History is exactly the rows the database marks is_history (closed, settled or lost
 * work), never red, never a task. Columns: Job, Customer, Customer PO (admin and sales only), Items, Where it stands, Next step, Owner. A phone gets cards.
 * Under the chips a stage filter (All, Orders, Waiting for supplier, To deliver, To invoice, To be paid; an engineer has the first four), in ?stage=.
 *
 * One search: the box here and the command palette (Ctrl K) call the same function (features/jobs/api.ts findJobs), so "Job 139",
 * an RFQ-, ORD-, QT- or PO- number, an invoice number, a customer reference or the customer's name land on the same jobs. A search
 * ignores the chips (a number must find its job wherever it lives). The list holds no money, for anyone: an engineer sees this page
 * as the office does. The route is reachable by address only until the navigation switch (P5-F).
 */
const LABEL: Record<Chip, string> = { mine: 'Mine', open: 'Open', history: 'History' }

/** What a stage filter finds, said after "No open jobs": "No open jobs to invoice". */
const STAGE_EMPTY: Record<Stage, string> = { orders: 'with an order', supplier: 'waiting for a supplier', deliver: 'to deliver', invoice: 'to invoice', payment: 'to be paid' }

function NextText({ job, role, card }: { job: JobRow; role: Who['role']; card?: boolean }) {
  // On a card an imported job wears an "Imported" tag, so its step does not repeat the word.
  const n = jobNext({ stage: job.stage, stageDetail: job.stageDetail, role: role === '' ? 'sales' : role, imported: job.imported }, { imported: card ? 'tag' : 'prefix' })
  return n.text ? (
    <StatusText tone={n.tone} className="whitespace-normal">
      {n.text}
    </StatusText>
  ) : (
    <span className="text-fg-muted">—</span>
  )
}

function JobCell({ job }: { job: JobRow }) {
  return (
    <span className="grid min-w-[5.5rem] gap-px whitespace-normal">
      <span className="num whitespace-nowrap font-medium">{jobLabel(job.key)}</span>
      {job.repeatOf ? <span className="text-sm text-fg-muted">{`Repeat of ${jobLabel(job.repeatOf)}`}</span> : null}
    </span>
  )
}

function CustomerCell({ job }: { job: JobRow }) {
  return (
    <span className="grid min-w-[160px] max-w-[320px] gap-px whitespace-normal">
      <span className="line-clamp-2 min-w-0 font-medium [overflow-wrap:anywhere]" title={job.companyName}>
        {job.companyName}
      </span>
      {job.siteName ? (
        <span className="line-clamp-1 min-w-0 text-sm text-fg-muted [overflow-wrap:anywhere]" title={job.siteName}>
          {job.siteName}
        </span>
      ) : null}
    </span>
  )
}

/** A phone card, five short rows: customer and job number; PO (money roles) and the Imported tag; the items in one line; where it stands; the one next step. */
function JobCard({ job, role, po }: { job: JobRow; role: Who['role']; po?: string }) {
  const items = itemsSummary(job.items)
  return (
    <span className="grid gap-2">
      <span className="flex items-start justify-between gap-3">
        <span className="line-clamp-2 min-w-0 font-semibold [overflow-wrap:anywhere]">{job.companyName}</span>
        <span className="num shrink-0 text-base text-fg-muted">{jobLabel(job.key)}</span>
      </span>
      {po || job.imported ? (
        <span className="flex items-baseline justify-between gap-3">
          {po ? <span className="num min-w-0 text-base text-fg-muted [overflow-wrap:anywhere]">{`PO ${po}`}</span> : <span />}
          {job.imported ? <span className="shrink-0 rounded border border-line px-2 text-base text-fg-muted">Imported</span> : null}
        </span>
      ) : null}
      <span className="line-clamp-1 min-w-0 text-base text-fg-2 [overflow-wrap:anywhere]">{items || <span className="text-fg-muted">No items yet</span>}</span>
      <StageLine job={{ stage: job.stage, stageDetail: job.stageDetail, kind: job.kind, office: role === 'engineer' }} />
      <span className="text-base">
        <NextText job={job} role={role} card />
      </span>
    </span>
  )
}

export default function JobsListPage() {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const role = (user?.role ?? '') as Who['role']
  const money = role === 'admin' || role === 'sales'
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const jobs = useJobsList(role === '' ? null : user?.role ?? null)
  const who = useMemo<Who>(() => ({ userId: user?.id ?? null, role }), [user?.id, role])

  const [creating, setCreating] = useState(false)
  const openNew = params.get('new') === '1'
  useEffect(() => {
    if (!openNew || role === '') return
    if (money) setCreating(true)
    setParams(
      p => {
        const next = new URLSearchParams(p)
        next.delete('new')
        return next
      },
      { replace: true },
    )
  }, [openNew, role, money, setParams])

  const text = params.get('q') ?? ''
  const chipParam = params.get('chip')
  const chip: Chip = isChip(chipParam) ? chipParam : defaultChip(role)
  const change = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    setParams(next, { replace: true })
  }

  // The customer's PO number: money roles only. An engineer's list never asks for it (the hook is off), so no request carries it.
  const pos = useCustomerPos(money)
  const poOf = (j: JobRow) => (j.orderId ? pos.data?.get(j.orderId) : undefined)

  const all = useMemo(() => jobs.data ?? [], [jobs.data])
  const counts = useMemo(() => chipCounts(all, who), [all, who])
  const searching = text.trim() !== ''
  const found = useJobSearch(text)
  // A search ignores the chip and the stage; otherwise the stage (when one is picked and offered) narrows the chip's jobs.
  const stage = searching ? null : normalizeStage(params.get('stage'), role, chip)
  const rows = useMemo(
    () => (searching ? (found.data ?? []) : all.filter(j => inChip(j, chip, who) && (stage === null || inStage(j, stage))).sort(byRecent)),
    [searching, found.data, all, chip, who, stage],
  )

  const columns: Column<JobRow>[] = [
    { id: 'job', header: 'Job', value: j => j.key, sortable: true, cell: j => <JobCell job={j} /> },
    { id: 'customer', header: 'Customer', value: j => j.companyName, sortable: true, cell: j => <CustomerCell job={j} /> },
    ...(money
      ? [
          {
            id: 'po',
            header: 'Customer PO',
            value: (j: JobRow) => poOf(j) ?? '',
            sortable: true,
            hideBelowMd: true,
            cell: (j: JobRow) => {
              const po = poOf(j)
              return po ? <span className="num whitespace-normal [overflow-wrap:anywhere]">{po}</span> : <span className="text-fg-muted">—</span>
            },
          } satisfies Column<JobRow>,
        ]
      : []),
    {
      id: 'items',
      header: 'Items',
      value: j => j.items,
      hideBelowMd: true,
      // One line (a long item list would make the row, and with it every row of a windowed list, very tall); the whole list is the title.
      cell: j => (
        <span className="line-clamp-1 min-w-[160px] max-w-[320px] whitespace-normal text-fg-2 [overflow-wrap:anywhere]" title={j.items || undefined}>
          {itemsSummary(j.items) || <span className="text-fg-muted">No items yet</span>}
        </span>
      ),
    },
    {
      id: 'stands',
      header: 'Where it stands',
      value: j => stageModel({ stage: j.stage, stageDetail: j.stageDetail, kind: j.kind }).current ?? 99,
      sortable: true,
      cell: j => <StageMini job={{ stage: j.stage, stageDetail: j.stageDetail, kind: j.kind, office: role === 'engineer' }} />,
    },
    { id: 'next', header: 'Next step', cell: j => <NextText job={j} role={role} /> },
    { id: 'owner', header: 'Owner', value: j => j.ownerName ?? '', sortable: true, hideBelowMd: true, cell: j => j.ownerName ?? <span className="text-fg-muted">No owner</span> },
  ]

  const loading = jobs.isPending || (searching && found.isPending)
  const error = jobs.isError ? jobs : searching && found.isError ? found : null
  const lede = jobs.isSuccess ? `${counts.open} open · ${counts.history} in history` : 'Every customer request, from enquiry to payment.'

  const empty = searching ? (
    <NoResults query={text} scope="every job (open and history)" fields="job number, customer, item, RFQ, order, quotation, PO and invoice number" onClear={() => change({ q: null })} />
  ) : chip === 'mine' && stage === null && counts.open > 0 ? (
    <EmptyState
      mood="goal"
      title={role === 'engineer' ? 'No jobs are assigned to you' : 'None of your jobs are open'}
      actions={
        <Button onClick={() => change({ chip: 'open' })}>
          Show every open job ({counts.open})
        </Button>
      }
    >
      {role === 'engineer' ? 'Jobs you are put on appear here.' : 'Jobs you own appear here.'}
    </EmptyState>
  ) : stage !== null ? (
    <EmptyState
      title={chip === 'history' ? 'No orders in history' : `No ${chip === 'mine' ? 'jobs of yours' : 'open jobs'} ${STAGE_EMPTY[stage]}`}
      actions={<Button onClick={() => change({ stage: null })}>{chip === 'history' ? 'Show all history' : chip === 'mine' ? 'Show all my jobs' : 'Show all open jobs'}</Button>}
    >
      {`Nothing is at "${STAGE_LABEL[stage]}" right now.`}
    </EmptyState>
  ) : chip === 'history' ? (
    <EmptyState title="Nothing in history yet">A job moves here once it is paid and installed, lost, or cancelled with no money open.</EmptyState>
  ) : (
    <EmptyState mood="goal" title="No open jobs">
      Every job is done. A new enquiry starts one.
    </EmptyState>
  )

  return (
    <div className="mx-auto grid w-full max-w-table grid-cols-[minmax(0,1fr)] content-start gap-4 px-4 pb-12 pt-6 md:px-8">
      {money ? null : <NoPrimary />}
      <PageHeader
        title="Jobs"
        lede={lede}
        primary={
          money ? (
            <Button variant="primary" icon={FilePlus2} onClick={() => navigate('/enquiries/new')}>
              New enquiry
            </Button>
          ) : undefined
        }
      />
      <DataTable
        label="Jobs"
        sortParam="sort"
        columns={columns}
        rows={rows}
        getRowId={j => j.key}
        twoLine
        defaultSort={null}
        mobileRow={j => <JobCard job={j} role={role} po={money ? poOf(j) : undefined} />}
        onRowOpen={j => navigate(`/jobs/${encodeURIComponent(j.key)}`)}
        loading={loading}
        error={error ? { title: "Couldn't load the jobs", message: 'Nothing was changed. Check your connection and try again.', onRetry: () => void error.refetch() } : null}
        summary={jobs.isSuccess && rows.length > 0 ? (searching ? `${rows.length} ${rows.length === 1 ? 'job' : 'jobs'} found, in every list` : `Showing ${rows.length} ${LABEL[chip].toLowerCase()} ${rows.length === 1 ? 'job' : 'jobs'}${stage ? ` · ${STAGE_LABEL[stage]}` : ''}`) : undefined}
        toolbar={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
            <SegmentedControl
              aria-label="Which jobs"
              value={searching ? '' : chip}
              onValueChange={v => change({ chip: v === defaultChip(role) ? null : v, stage: normalizeStage(params.get('stage'), role, v as Chip) })}
              options={(['mine', 'open', 'history'] as const).map(c => ({ value: c, label: LABEL[c] }))}
            />
            <TableFilter
              label="Search jobs"
              hint="Finds a job by its number, customer, item, RFQ, order, quotation, PO or invoice number, in every list. Ctrl K finds the same jobs."
              value={text}
              onChange={v => change({ q: v })}
              className="min-w-0 max-sm:basis-full sm:max-w-[360px] sm:flex-1"
            />
            {searching ? null : (
              <div className="min-w-0 basis-full">
                <StageFilter value={stage} stages={stagesFor(role, chip)} onChange={s => change({ stage: s })} />
              </div>
            )}
          </div>
        }
        empty={empty}
      />
      {creating ? <NewOrderDialog onClose={() => setCreating(false)} /> : null}
    </div>
  )
}
