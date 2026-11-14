import { NoPrimary } from '@/ui/NoPrimary'
import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useIssueDialog } from '@/features/quotations/useIssueDialog'
import { CloudOff } from 'lucide-react'
import { useSession } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { NotFoundPage } from '@/app/pages/NotFoundPage'
import { cn } from '@/lib/utils'
import { lazyWithReload } from '@/lib/importWithReload'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { Button } from '@/ui/Button'
import { DetailHeader } from '@/ui/DetailHeader'
import { EmptyState } from '@/ui/EmptyState'
import { Skeleton } from '@/ui/Skeleton'
import { StickyActionBar } from '@/ui/StickyActionBar'
import { useJobFacts } from '@/features/jobs/hooks'
import { useJobData } from '@/features/jobs/useJobData'
import { StageBlock } from '@/features/jobs/StageBar'
import { StageSections } from '@/features/jobs/StageSections'
import { CancelledOrders, ContactRow, MoneyRow, NotesFilesRow } from '@/features/jobs/JobSide'
import { JobSlot, type JobContext } from '@/features/jobs/slots'
import { jobNext } from '@/features/jobs/lib/nextStep'
import { jobHasMore } from '@/features/jobs/lib/hasMore'
import { stageModel, STOPS } from '@/features/jobs/lib/stages'
import { stageIndexOf } from '@/features/jobs/deleteJob/model'
import { jobLabel, laneOfJob } from '@/features/jobs/lib/listModel'
import type { JobFacts } from '@/features/jobs/api'
import { JobKeyFacts } from '@/features/jobs/JobKeyFacts'
import { jobKeyFacts } from '@/features/jobs/lib/keyFacts'
import { businessToday } from '@/lib/dates'
import { WonDialogHost } from '@/features/jobs/WonDialogHost'

/*
 * The Job page (redesign phase 5, P5-C; clarity redesign L1): /jobs/:key, one page for a customer request from enquiry to payment.
 *   Phone bar   the customer, and "Job 139" on the right (the h1 is for a screen reader there)
 *   Header      (computer) the way back to the job's lane (Sell, Deliver, Money; Jobs for an engineer), the title, Owner and site, More
 *   Hero        Forest (30-job-page.html): "Next step · Job 139", who acts next, the step in one sentence, its detail; on a computer the
 *               ONE green button sits in it. An engineer's reads "Where it stands", with the On site card under it.
 *   Track       "Stage 5 of 7 · Delivery" over the seven stops, then the key facts: Customer PO (admin and sales), Supplier, Delivery
 *   Two cards   the seven steps (StageSections), then Contact, Money (PKR) (admin), Add to this job, Notes and files: rows, all
 *               closed; the step the job is at is marked, not opened. On a computer the steps and the rest are two columns.
 * Reads: the job (the view and the enquiry or order, with the names) in one round, then every panel at once; the app starts both
 * before the page is drawn (prefetch.ts). An engineer asks for no price and no money row; the database hides priced files.
 */
// Only an engineer sees it: its visit dialog, photo capture and delivery buttons stay out of everyone else's download (perf/lcp).
const EngineerActions = lazyWithReload(() => import('@/features/jobs/EngineerActions').then(m => ({ default: m.EngineerActions })))
const EngineerAddRow = lazyWithReload(() => import('@/features/jobs/EngineerActions').then(m => ({ default: m.EngineerAddRow })))
const EngineerPapers = lazyWithReload(() => import('@/features/jobs/EngineerActions').then(m => ({ default: m.EngineerPapers })))

function Shell({ children, bar = false }: { children: ReactNode; bar?: boolean }) {
  return <div className={cn('mx-auto w-full max-w-detail px-4 pb-16 pt-4 md:px-8 md:pt-6', bar && 'max-md:pb-[calc(var(--control-lg-h)+2rem)]')}>{children}</div>
}

function PageSkeleton() {
  return (
    <Shell>
      <div role="status" className="grid gap-4" aria-busy="true" aria-label="Loading job">
        <Skeleton className="h-4 w-[10rem]" />
        <Skeleton className="h-[2.25rem] w-[24rem] max-w-full" />
        <Skeleton className="h-5 w-[18rem] max-w-full" />
        {/* the hero and the track card */}
        <Skeleton className="h-[10rem] w-full rounded-card" />
        <Skeleton className="h-[8rem] w-full rounded-card" />
        <div className="grid items-start gap-card-gap lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid gap-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
          <div className="grid gap-4">
            <Skeleton className="h-[8rem] rounded-card" />
            <Skeleton className="h-[10rem] rounded-card" />
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
          title="Could not open this job"
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

/**
 * Where the job page leads back to: the lane the Jobs list puts this job in (laneOfJob, so the list and the link always agree): Sell
 * for an RFQ with no order, Deliver for an order. An engineer has Jobs.
 */
function backTo(job: JobFacts['job'], role: 'admin' | 'sales' | 'engineer'): { label: string; to: string } {
  if (role === 'engineer') return { label: 'Jobs', to: '/jobs' }
  return laneOfJob(job) === 'deliver' ? { label: 'Deliver', to: '/jobs?lane=deliver' } : { label: 'Sell', to: '/jobs?lane=sell' }
}

function JobView({ facts }: { facts: JobFacts }) {
  const session = useSession()
  const role = (session.status === 'signed-in' ? session.user.role : 'engineer') as 'admin' | 'sales' | 'engineer'
  const [params, setParams] = useSearchParams()
  const phone = useMediaQuery('(max-width: 767px)')
  const { job } = facts
  const data = useJobData(facts, role)
  const model = useMemo(() => stageModel({ stage: job.stage, stageDetail: job.stageDetail, kind: job.kind, office: role === 'engineer' }), [job.stage, job.stageDetail, job.kind, role])
  const ctx = useMemo<JobContext>(() => ({ job, role, money: role !== 'engineer' }), [job, role])
  const imported = Boolean(job.imported || data.order.data?.imported)
  const next = jobNext({ stage: job.stage, stageDetail: job.stageDetail, role, imported })

  // Every step starts closed (clarity redesign): the step the job is at is marked in the list, not opened.
  const [open, setOpen] = useState<number | null>(null)
  const [, openIssue] = useIssueDialog()
  // A link that carries ?issue=1 (the RFQ page's own address for the Issue quotation dialog) lands on the stage that holds it.
  const wantsIssue = params.get('issue') === '1'
  // Issuing the quotation moves the job on (to Order); the Issue dialog lives in the Quotation step, so while the dialog is open the step stays.
  const dialogOpen = useRef(wantsIssue)
  dialogOpen.current = wantsIssue
  useEffect(() => {
    if (!dialogOpen.current) setOpen(null)
  }, [job.key])
  useEffect(() => {
    if (wantsIssue) setOpen(1)
  }, [wantsIssue])
  // ?stage=payment (a stop name, lower case, dashes) opens that stop: the delete-job guide links to where each step is cleared.
  const stageParam = params.get('stage')
  useEffect(() => {
    const i = stageIndexOf(stageParam, STOPS)
    if (i === null) return
    setOpen(i)
    requestAnimationFrame(() => document.getElementById(`stage-${i}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }, [stageParam, job.key])
  // On a phone the row that opens is brought into view, so its body is not left below the fold.
  const toggle = (i: number) => {
    const opening = open !== i
    setOpen(opening ? i : null)
    if (opening && phone) requestAnimationFrame(() => document.getElementById(`stage-${i}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }
  const select = (i: number) => {
    setOpen(i)
    requestAnimationFrame(() => document.getElementById(`stage-${i}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  // The lane lights Sell or Deliver on the rail for a job opened from Home or Search (no ?from=); an engineer has Jobs.
  useMobileBar({ title: job.companyName, subtitle: jobLabel(job.key), back: 'history', fallback: '/jobs', hideTabs: true, lane: role === 'engineer' ? undefined : laneOfJob(job) })

  // The enquiry-side steps are done on this page (P5-D1): the button opens the Quotation stage, or the same dialog the RFQ page opens
  // (?issue=1, ?won=1). The order-side steps are done here too (P5-D2): the button opens the stage that holds the action (choose a
  // supplier, place, deliver, invoice, collect), in place.
  const onRfq = Boolean(next.button && next.on === 'rfq' && job.rfqId)
  const inPlace = next.button && next.on === 'order' && job.orderId && next.stop !== undefined ? next.stop : null
  const act = () => {
    if (inPlace !== null) return select(inPlace)
    if (!onRfq) return
    const p = new URLSearchParams(params)
    if (next.query === 'won=1') {
      p.set('won', '1')
      setParams(p, { replace: true })
      return
    }
    // the same opener as the Quotations block: on a computer it adds a history entry, so Back closes the dialog and stays on the page (HW-9)
    if (next.query === 'issue=1') openIssue(true)
    select(1)
  }
  // An engineer's one green button is on the site card (EngineerActions: Delivered today, Installed today, Add photo or note), so the
  // band's "Open the order" is not a second one; the card has the link.
  // On the forest hero it is lime (Forest 30-job-page); the phone's sticky bar is white, so there it is the green button.
  const button = role !== 'engineer' && (onRfq || inPlace !== null) ? (
    <Button variant={phone ? 'primary' : 'lime'} size={phone ? 'touch' : 'lg'} onClick={act}>
      {next.button}
    </Button>
  ) : undefined

  // The line that used to sit under the title: it is the first thing in the Enquiry step now (and in the Order step of a job with no enquiry).
  const metaLine = [job.ownerName ? `Owner ${job.ownerName}` : 'No owner yet', facts.customerRef ? `Their ref ${facts.customerRef}` : null, facts.site?.name ?? null, job.items || null].filter(Boolean).join(' · ')
  const meta = (
    <p className="text-base text-fg-2 [overflow-wrap:anywhere]" data-job-meta>
      {metaLine}
    </p>
  )

  const items = data.orderItems.data
  const keyFacts = job.orderId
    ? jobKeyFacts({ order: data.order.data, legs: data.legs.data, money: ctx.money, cancelled: Boolean(data.order.data?.cancelledOn), servicesOnly: Boolean(items && items.length > 0 && items.every(i => i.isService)), today: businessToday() })
    : null

  return (
    <Shell bar>
      {role === 'engineer' || !button ? <NoPrimary /> : null}
      <DetailHeader
        name={job.companyName}
        nameHref={`/companies/${job.companyId}`}
        code={jobLabel(job.key)}
        back={backTo(job, role)}
        sub={
          <>
            <p className="mt-1 text-sm text-fg-2 [overflow-wrap:anywhere] max-md:hidden" data-job-owner>
              {[job.ownerName ? `Owner ${job.ownerName}` : 'No owner yet', facts.site?.name ?? null].filter(Boolean).join(' · ')}
            </p>
            {job.repeatOf ? (
              <p className="mt-2 text-base">
                <Link to={`/jobs/${encodeURIComponent(job.repeatOf)}`} className="inline-flex min-h-touch items-center rounded font-medium text-primary underline-offset-4 hover:underline">
                  {`Repeat of ${jobLabel(job.repeatOf)}`}
                </Link>
              </p>
            ) : null}
          </>
        }
        more={phone ? undefined : <JobSlot name="next-step" context={ctx} />}
        phoneSrOnly
      />

      <StageBlock
        job={{ stage: job.stage, stageDetail: job.stageDetail, kind: job.kind, office: role === 'engineer' }}
        label={role === 'engineer' ? 'Where it stands' : `Next step · ${jobLabel(job.key)}`}
        text={next.text}
        tone={next.tone}
        action={phone ? undefined : button}
        facts={keyFacts ? <JobKeyFacts facts={keyFacts} /> : null}
        between={
          // An engineer: the On site buttons are a card under the hero on a computer and the sticky bar on a phone. Contact and Add photo or note are rows of the side column.
          role === 'engineer' && !phone ? (
            <Suspense fallback={null}>
              <EngineerActions facts={facts} data={data} />
            </Suspense>
          ) : null
        }
      />
      {phone && (button || jobHasMore(ctx)) ? (
        <StickyActionBar label="Job actions" primary={button} secondary={<JobSlot name="next-step" context={ctx} />} className={button ? undefined : 'left-auto rounded-tl-panel'} />
      ) : null}
      {job.rfqId ? <WonDialogHost rfqId={job.rfqId} /> : null}
      <div
        data-work
        className="mt-4 grid min-w-0 items-start gap-card-gap md:mt-6 lg:grid-cols-[minmax(0,1fr)_340px]"
      >
        <StageSections facts={facts} data={data} model={model} ctx={ctx} open={open} onToggle={toggle} meta={meta} tone={next.tone} />
        <aside aria-label="About this job" className="min-w-0 rounded-card border bg-surface px-card py-2 shadow-e1 [&>:last-child]:border-b-0">
          <ContactRow facts={facts} showWhere={role === 'engineer'} />
          {role === 'admin' ? <MoneyRow data={data} hasOrder={Boolean(job.orderId)} /> : null}
          <CancelledOrders data={data} money={role !== 'engineer'} />
          {role === 'engineer' ? (
            <Suspense fallback={<div className="min-h-touch border-b" />}>
              <EngineerAddRow facts={facts} data={data} />
            </Suspense>
          ) : (
            <JobSlot name="side" context={ctx} />
          )}
          <NotesFilesRow facts={facts} data={data} ctx={ctx} />
        </aside>
      </div>
      {role === 'engineer' && phone ? (
        <Suspense fallback={null}>
          <EngineerActions facts={facts} data={data} />
        </Suspense>
      ) : null}
      {role === 'engineer' ? (
        <Suspense fallback={null}>
          <EngineerPapers data={data} />
        </Suspense>
      ) : null}
    </Shell>
  )
}
