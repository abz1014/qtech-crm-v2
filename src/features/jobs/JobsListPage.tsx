import { NoPrimary } from '@/ui/NoPrimary'
import { useMemo } from 'react'
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
import { useJobSearch, useJobsList } from '@/features/jobs/hooks'
import type { JobRow } from '@/features/jobs/api'
import { StageMini } from '@/features/jobs/StageBar'
import { jobNext } from '@/features/jobs/lib/nextStep'
import { byRecent, chipCounts, defaultChip, inChip, isChip, jobLabel, type Chip, type Who } from '@/features/jobs/lib/listModel'
import { stageModel } from '@/features/jobs/lib/stages'

/*
 * Jobs (redesign phase 5, P5-B). One row per customer request from enquiry to payment ("Job 139"; "Job O-45" for an order with no
 * enquiry). Three chips: Mine, Open and History; History is exactly the rows the database marks is_history (closed, settled or lost
 * work), never red, never a task. Columns: Job, Customer, Items, Where it stands, Next step, Owner. A phone gets cards.
 *
 * One search: the box here and the command palette (Ctrl K) call the same function (features/jobs/api.ts findJobs), so "Job 139",
 * an RFQ-, ORD-, QT- or PO- number, an invoice number, a customer reference or the customer's name land on the same jobs. A search
 * ignores the chips (a number must find its job wherever it lives). The list holds no money, for anyone: an engineer sees this page
 * as the office does. The route is reachable by address only until the navigation switch (P5-F).
 */
const LABEL: Record<Chip, string> = { mine: 'Mine', open: 'Open', history: 'History' }

function NextText({ job, role }: { job: JobRow; role: Who['role'] }) {
  const n = jobNext({ stage: job.stage, stageDetail: job.stageDetail, role: role === '' ? 'sales' : role })
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
    <span className="grid gap-px whitespace-normal">
      <span className="num font-medium">{jobLabel(job.key)}</span>
      {job.repeatOf ? <span className="text-sm text-fg-muted">{`Repeat of ${jobLabel(job.repeatOf)}`}</span> : null}
    </span>
  )
}

function CustomerCell({ job }: { job: JobRow }) {
  return (
    <span className="grid min-w-[160px] max-w-[320px] gap-px whitespace-normal">
      <span className="font-medium">{job.companyName}</span>
      {job.siteName ? <span className="text-sm text-fg-muted">{job.siteName}</span> : null}
    </span>
  )
}

function JobCard({ job, role }: { job: JobRow; role: Who['role'] }) {
  return (
    <span className="grid gap-1">
      <span className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 font-medium">{job.companyName}</span>
        <span className="num shrink-0 text-base text-fg-muted">{jobLabel(job.key)}</span>
      </span>
      {job.items ? <span className="min-w-0 text-base text-fg-2 [overflow-wrap:anywhere]">{job.items}</span> : null}
      <StageMini job={{ stage: job.stage, stageDetail: job.stageDetail, kind: job.kind, office: role === 'engineer' }} />
      <span className="text-base">
        <NextText job={job} role={role} />
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

  const all = useMemo(() => jobs.data ?? [], [jobs.data])
  const counts = useMemo(() => chipCounts(all, who), [all, who])
  const searching = text.trim() !== ''
  const found = useJobSearch(text)
  const rows = useMemo(() => (searching ? (found.data ?? []) : all.filter(j => inChip(j, chip, who)).sort(byRecent)), [searching, found.data, all, chip, who])

  const columns: Column<JobRow>[] = [
    { id: 'job', header: 'Job', value: j => j.key, sortable: true, cell: j => <JobCell job={j} /> },
    { id: 'customer', header: 'Customer', value: j => j.companyName, sortable: true, cell: j => <CustomerCell job={j} /> },
    {
      id: 'items',
      header: 'Items',
      value: j => j.items,
      hideBelowMd: true,
      cell: j => <span className="block min-w-[160px] max-w-[320px] whitespace-normal text-fg-2 [overflow-wrap:anywhere]">{j.items || <span className="text-fg-muted">No items yet</span>}</span>,
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
  ) : chip === 'mine' && counts.open > 0 ? (
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
        mobileRow={j => <JobCard job={j} role={role} />}
        onRowOpen={j => navigate(`/jobs/${encodeURIComponent(j.key)}`)}
        loading={loading}
        error={error ? { title: "Couldn't load the jobs", message: 'Nothing was changed. Check your connection and try again.', onRetry: () => void error.refetch() } : null}
        summary={jobs.isSuccess ? (searching ? `${rows.length} ${rows.length === 1 ? 'job' : 'jobs'} found, in every list` : `Showing ${rows.length} ${LABEL[chip].toLowerCase()} ${rows.length === 1 ? 'job' : 'jobs'}`) : undefined}
        toolbar={
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
            <SegmentedControl
              aria-label="Which jobs"
              value={searching ? '' : chip}
              onValueChange={v => change({ chip: v === defaultChip(role) ? null : v })}
              options={(['mine', 'open', 'history'] as const).map(c => ({ value: c, label: LABEL[c] }))}
            />
            <TableFilter
              label="Search jobs"
              hint="Finds a job by its number, customer, item, RFQ, order, quotation, PO or invoice number, in every list. Ctrl K finds the same jobs."
              value={text}
              onChange={v => change({ q: v })}
              className="min-w-0 max-sm:basis-full sm:max-w-[360px] sm:flex-1"
            />
          </div>
        }
        empty={empty}
      />
    </div>
  )
}
