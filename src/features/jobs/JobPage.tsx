import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CloudOff } from 'lucide-react'
import { useSession } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { cn } from '@/lib/utils'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Button } from '@/ui/Button'
import { DetailHeader } from '@/ui/DetailHeader'
import { EmptyState } from '@/ui/EmptyState'
import { NextStepBox } from '@/ui/NextStepBox'
import { Skeleton } from '@/ui/Skeleton'
import { StickyActionBar } from '@/ui/StickyActionBar'
import { useJobFacts } from '@/features/jobs/hooks'
import { useJobData } from '@/features/jobs/useJobData'
import { StageBar } from '@/features/jobs/StageBar'
import { StageSections } from '@/features/jobs/StageSections'
import { CancelledOrders, ContactPanel, MoneyPanel, NotesFilesPanel } from '@/features/jobs/JobSide'
import { JobSlot, type JobContext } from '@/features/jobs/slots'
import { jobNext } from '@/features/jobs/lib/nextStep'
import { currentStopIndex, officeDetail, stageModel } from '@/features/jobs/lib/stages'
import { jobLabel } from '@/features/jobs/lib/listModel'
import type { JobFacts } from '@/features/jobs/api'

/*
 * The Job page (redesign phase 5, P5-C): /jobs/:key, one page for a customer request from enquiry to payment.
 *   Header      the customer, "Job 139", owner, their reference, the items in one line
 *   Ruler       the seven stops (StageBar); a stop opens its stage below
 *   Next step   one sentence and ONE green button. In this read-only release the button opens the action on the old RFQ or order
 *               page (lib/nextStep.ts says which); the actions move onto this page stage by stage (P5-D1, P5-D2)
 *   Stages      an accordion, the current stage open (StageSections), with the slots other lanes plug into (slots.tsx)
 *   Right       Contact, Money for this job (admin only), Notes and files, Cancelled orders
 * Reads: the job (the view and the enquiry or order, with the names) in one round, then every panel at once; the app starts both
 * before the page is drawn (prefetch.ts). An engineer asks for no price and no money panel; the database hides priced files.
 */
function Shell({ children, bar = false }: { children: ReactNode; bar?: boolean }) {
  return <div className={cn('mx-auto w-full max-w-detail px-4 pb-16 pt-4 md:px-8 md:pt-6', bar && 'max-md:pb-[calc(var(--control-lg-h)+2rem)]')}>{children}</div>
}

function PageSkeleton() {
  return (
    <Shell>
      <div role="status" className="grid gap-4" aria-busy="true" aria-label="Loading job">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-96 max-w-full" />
        <Skeleton className="h-5 w-72 max-w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-16 w-full" />
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
          <div className="grid gap-4">
            <Skeleton className="h-32" />
            <Skeleton className="h-40" />
          </div>
        </div>
      </div>
    </Shell>
  )
}

export default function JobPage() {
  const { key: raw } = useParams()
  const key = raw ? decodeURIComponent(raw) : undefined
  const facts = useJobFacts(key)
  if (facts.isPending) return <PageSkeleton />
  if (facts.isError && !facts.data) {
    return (
      <Shell>
        <EmptyState
          mood="error"
          icon={CloudOff}
          title="Couldn't open this job"
          actions={
            <Button onClick={() => void facts.refetch()} variant="primary">
              Try again
            </Button>
          }
        >
          Nothing was changed. Check your connection and try again.
        </EmptyState>
      </Shell>
    )
  }
  if (!facts.data) return <NotFoundPage />
  return <JobView facts={facts.data} />
}

function JobView({ facts }: { facts: JobFacts }) {
  const session = useSession()
  const role = (session.status === 'signed-in' ? session.user.role : 'engineer') as 'admin' | 'sales' | 'engineer'
  const navigate = useNavigate()
  const phone = useMediaQuery('(max-width: 767px)')
  const { job } = facts
  const data = useJobData(facts, role)
  const model = useMemo(() => stageModel({ stage: job.stage, stageDetail: role === 'engineer' ? officeDetail(job.stageDetail) : job.stageDetail, kind: job.kind }), [job.stage, job.stageDetail, job.kind, role])
  const ctx = useMemo<JobContext>(() => ({ job, role, money: role !== 'engineer' }), [job, role])
  const next = jobNext({ stage: job.stage, stageDetail: job.stageDetail, role })

  // The current stage opens first; a finished job opens its last stage.
  const current = currentStopIndex(job.stage, job.stageDetail)
  const first = current === null ? null : Math.min(current, 6)
  const [open, setOpen] = useState<number | null>(first)
  useEffect(() => setOpen(first), [first, job.key])
  const toggle = (i: number) => setOpen(o => (o === i ? null : i))
  const select = (i: number) => {
    setOpen(i)
    requestAnimationFrame(() => document.getElementById(`stage-${i}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  useMobileBar({ title: jobLabel(job.key), back: 'history', fallback: '/jobs', hideTabs: true })

  const target =
    next.button && next.on === 'rfq' && job.rfqId
      ? `/rfqs/${job.rfqId}${next.query ? `?${next.query}` : ''}`
      : next.button && next.on === 'order' && job.orderId
        ? `/orders/${job.orderId}`
        : null
  const button = target && next.button ? (
    <Button variant="primary" size={phone ? 'touch' : 'lg'} onClick={() => navigate(target)}>
      {next.button}
    </Button>
  ) : undefined

  const meta = [
    job.ownerName ? `Owner ${job.ownerName}` : 'No owner yet',
    facts.customerRef ? `Their ref ${facts.customerRef}` : null,
    facts.site?.name ?? null,
    job.items || null,
  ]

  return (
    <Shell bar>
      <DetailHeader
        name={job.companyName}
        nameHref={`/companies/${job.companyId}`}
        code={jobLabel(job.key)}
        breadcrumb={[{ label: 'Jobs', to: '/jobs' }, { label: jobLabel(job.key), mono: true }]}
        meta={meta}
      >
        {job.repeatOf ? (
          <p className="mt-2 text-base">
            <Link to={`/jobs/${encodeURIComponent(job.repeatOf)}`} className="inline-flex min-h-touch items-center rounded font-medium text-primary underline-offset-4 hover:underline">
              {`Repeat of ${jobLabel(job.repeatOf)}`}
            </Link>
          </p>
        ) : null}
        {facts.orderNumber !== null ? <p className="mt-2 text-base text-fg-muted">{`Order ${String(facts.orderNumber).padStart(4, '0')}, with no enquiry before it.`}</p> : null}
      </DetailHeader>

      <div className="mt-4 rounded-panel border bg-surface px-4 py-4">
        <StageBar job={{ stage: job.stage, stageDetail: role === 'engineer' ? officeDetail(job.stageDetail) : job.stageDetail, kind: job.kind }} onSelect={select} />
      </div>

      <NextStepBox
        text={next.text || 'Nothing to do'}
        tone={next.tone === 'late' ? 'late' : next.button ? 'action' : 'quiet'}
        action={
          phone ? undefined : (
            <span className="flex flex-wrap items-center gap-2">
              <JobSlot name="next-step" context={ctx} />
              {button}
            </span>
          )
        }
      />
      {phone && button ? (
        <StickyActionBar label="Job actions" primary={button} secondary={<JobSlot name="next-step" context={ctx} />} />
      ) : null}

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 gap-4">
          <StageSections facts={facts} data={data} model={model} ctx={ctx} open={open} onToggle={toggle} />
        </div>
        <aside aria-label="About this job" className="grid min-w-0 gap-4">
          <ContactPanel facts={facts} />
          {role === 'admin' ? <MoneyPanel data={data} /> : null}
          <JobSlot name="side" context={ctx} />
          <NotesFilesPanel facts={facts} data={data} ctx={ctx} />
          <CancelledOrders data={data} />
        </aside>
      </div>
    </Shell>
  )
}
