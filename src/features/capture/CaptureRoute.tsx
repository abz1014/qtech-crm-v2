import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { Camera, ChevronRight, FilePlus2, Inbox, PackageOpen, Paperclip, Search, Share2 } from 'lucide-react'
import { useSession } from '@/app/session'
import { useMobileBar } from '@/app/shell/MobileBarContext'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { buttonStyles } from '@/ui/buttonStyles'
import { CARD } from '@/ui/card'
import { controlClass } from '@/ui/form/fieldContext'
import { Icon } from '@/ui/Icon'
import { NoPrimary } from '@/ui/NoPrimary'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { getCapture, listCaptures, safely, takeBackFromSignIn, type CaptureItem } from '@/lib/capture/store'
import { countsText } from '@/features/capture/model'
import { useJobSearch, useJobsList } from '@/features/jobs/hooks'
import { byRecent, inChip, itemsSummary, type Who } from '@/features/jobs/lib/listModel'
import type { JobRow } from '@/features/jobs/api'

/**
 * /capture is where the Android share target lands (the service worker stores the shared item for 7 days and redirects here with
 * ?share=<id>), and where a sign-in redirect returns to. Two choices, nothing else (P4-B, the six-destination sheet is gone):
 *   New enquiry   the shared message, PDF or photo is read as a customer's enquiry (/enquiries/new)
 *   Add to job…   pick the job with a search box; the job page reads the kept item by its id (?shared=<id>, so a reload keeps it) and adds it
 * An engineer sees only Add to job: they add a photo or a note, and start no enquiry.
 * Opened with no ?share (the engineer's "Photo or note" button) there is nothing shared: the page asks which job, and the job page opens
 * its photo-or-note box (state.photoOrNote). Nothing is deleted here: the job page deletes a kept item only after it saved it.
 */
const files = (item: CaptureItem): File[] => item.files.map(f => new File([f.blob], f.name, { type: f.type }))

/** Forest 44-capture (.cp-main): one narrow centred column on the canvas, the same frame for every state of this route. */
const COLUMN = 'mx-auto grid w-full min-w-0 max-w-xl grid-cols-[minmax(0,1fr)] content-start gap-4 px-gutter pb-16 pt-6 md:pt-8'
/** The page title with its glyph (.cp-title): heavy, wraps, never widens the column. */
const TITLE = 'flex items-center gap-3 text-2xl font-heavy tracking-tight text-pretty [overflow-wrap:anywhere] max-md:text-xl'

export default function CaptureRoute() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const session = useSession()
  const role = session.status === 'signed-in' ? session.user.role : ''
  const id = params.get('share')
  const [item, setItem] = useState<CaptureItem | null | undefined>(undefined)
  const [picking, setPicking] = useState(false)
  useEffect(() => {
    let live = true
    void (async () => {
      const found = id ? await safely(() => getCapture(id), null) : null
      if (!live) return
      setItem(found)
      if (found && takeBackFromSignIn()) toast({ title: 'Shared item restored', body: 'Choose where it goes to finish.' })
    })()
    return () => {
      live = false
    }
    // the toast function is stable enough: this reads the kept item once per share
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!id) return <JobFirst />

  if (item === undefined)
    return (
      // Shaped like what is coming: the title, the counts line, the message box and the two choices.
      <div className={COLUMN} role="status" aria-busy="true">
        <p className="text-base text-fg-2">Opening the shared item…</p>
        <Skeleton className="h-8 w-3/4" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-[8rem] rounded-card" />
        <div className="flex gap-2">
          <Skeleton className="h-control-lg w-[9rem]" />
          <Skeleton className="h-control-lg w-[9rem]" />
        </div>
      </div>
    )

  if (item === null)
    return (
      <div className={COLUMN}>
        <section className={cn(CARD, 'grid justify-items-start gap-3 p-card')} data-testid="share-gone">
          <span className="grid size-12 place-items-center rounded-pill bg-deep text-fg-2" aria-hidden="true">
            <Icon icon={PackageOpen} size="xl" />
          </span>
          <h1 className="type-section">Nothing to add</h1>
          <p className="text-base text-fg-2">That shared item is no longer on this device (shared items are kept for up to 7 days, and signing out clears them). Share it again from WhatsApp, or start from a job.</p>
          <Button variant="primary" size="lg" onClick={() => navigate('/jobs')} className="mt-1 max-md:h-touch">
            Open Jobs
          </Button>
        </section>
      </div>
    )

  const text = item.text.trim()
  const canEnquire = role === 'admin' || role === 'sales'
  const summary = countsText(item.source, item.text, item.files)

  return (
    <div className={COLUMN} data-testid="share-target">
      <header className="grid gap-1">
        <h1 className={TITLE}>
          <TitleGlyph icon={Share2} />
          Shared with Q-Tech CRM
        </h1>
        <p className="text-base text-fg-2">{summary}</p>
      </header>
      {text || item.files.length > 0 ? (
        <section aria-label="What was shared" className={cn(CARD, 'grid gap-3 p-card')}>
          {text ? (
            <pre tabIndex={0} aria-label="Shared message" className="m-0 max-h-[12rem] overflow-auto whitespace-pre-wrap rounded-control bg-sunken px-3 py-2 font-sans text-base leading-6 text-fg [overflow-wrap:anywhere]">
              {text.length > 600 ? `${text.slice(0, 600)}…` : text}
            </pre>
          ) : null}
          {item.files.length > 0 ? (
            <ul className="m-0 grid list-none gap-2 p-0 text-base" aria-label="Shared files">
              {item.files.map(f => (
                <li key={`${f.name}|${f.size}`} className="flex min-w-0 items-center gap-2 rounded-control border px-3 py-2 [overflow-wrap:anywhere]">
                  <Icon icon={Paperclip} size="sm" className="shrink-0 text-fg-muted" />
                  <span className="min-w-0">{f.name}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
      {/* Two choices and nothing else; an engineer starts no RFQ, so the New RFQ button is not drawn for them. */}
      <div className="flex flex-wrap gap-2">
        {canEnquire ? (
          <Button
            variant="primary"
            size="lg"
            icon={FilePlus2}
            onClick={() => navigate('/enquiries/new', { replace: true, state: { capture: { id: item.id, text: item.text, files: files(item) } } })}
            className="max-md:h-touch max-md:flex-1"
          >
            New RFQ
          </Button>
        ) : null}
        <Button size="lg" icon={Search} onClick={() => setPicking(p => !p)} aria-expanded={picking} className="max-md:h-touch max-md:flex-1">
          Add to job…
        </Button>
      </div>
      {picking ? (
        <JobPicker
          onPick={key => navigate(`/jobs/${encodeURIComponent(key)}?shared=${encodeURIComponent(item.id)}`, { replace: true })}
        />
      ) : null}
    </div>
  )
}

/** Search for the job and tap it. Shared by Add to job… (a kept share) and Photo or note (nothing shared). */
function JobPicker({ onPick, showMine = false }: { onPick: (key: string) => void; showMine?: boolean }) {
  const [find, setFind] = useState('')
  const jobs = useJobSearch(find)
  return (
    <section aria-label="Pick the job" className={cn(CARD, 'grid gap-4 p-card')}>
      <label className="grid gap-2 text-sm font-card text-fg">
        Find the job
        <span className="relative min-w-0">
          <Icon icon={Search} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input
          // Photo or note (showMine) lists the person's jobs under the box: the keyboard must not open over them.
          autoFocus={!showMine}
          value={find}
          onChange={e => setFind(e.target.value)}
          placeholder="Customer, job number or item"
          className={cn(controlClass, 'pl-10 md:h-control-lg md:text-base')}
        />
        </span>
      </label>
      {find.trim() === '' ? showMine ? <MyActiveJobs onPick={onPick} /> : null : jobs.isPending ? (
        <ChoiceSkeleton />
      ) : (jobs.data ?? []).length === 0 ? (
        <p className="flex items-start gap-2 rounded-control bg-sunken px-3 py-3 text-base text-fg-2">
          <Icon icon={Inbox} className="mt-[calc((var(--lh-base)-16px)/2)] shrink-0 text-fg-muted" />
          <span className="min-w-0">No job found. Try the customer&apos;s name or the job number.</span>
        </p>
      ) : (
        <ul className="m-0 grid list-none gap-2 p-0" aria-label="Jobs found">
          {(jobs.data ?? []).slice(0, 8).map(j => (
            <JobChoice key={j.key} job={j} onPick={onPick} />
          ))}
        </ul>
      )}
    </section>
  )
}

function JobChoice({ job: j, onPick }: { job: Pick<JobRow, 'key' | 'companyName' | 'items'>; onPick: (key: string) => void }) {
  return (
    <li>
      {/* Forest .cp-choice: a tile per job, the job number green and heavy like the lists, the chevron says it opens. */}
      <button
        type="button"
        onClick={() => onPick(j.key)}
        className="group grid min-h-row w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 rounded-control border bg-surface px-4 py-3 text-left transition-[background-color,border-color,transform] duration-fast ease-out hover:border-line-strong hover:bg-selected active:scale-press"
      >
        <span className="grid min-w-0 gap-px">
          <span className="text-base font-bold text-fg [overflow-wrap:anywhere]">
            <span className="num text-primary">Job {j.key}</span> · {j.companyName}
          </span>
          <span className="text-sm text-fg-2 [overflow-wrap:anywhere]">{j.items}</span>
        </span>
        <Icon icon={ChevronRight} className="text-fg-muted transition-transform duration-fast ease-out group-hover:translate-x-1" />
      </button>
    </li>
  )
}

/**
 * The engineer's active jobs (the Jobs list's "Mine" chip, never History), under the search box, so the usual pick is one tap.
 * The same list data and filter as the Jobs list; a row carries the job number, the customer and the items, no price and no customer PO.
 */
function MyActiveJobs({ onPick }: { onPick: (key: string) => void }) {
  const session = useSession()
  const user = session.status === 'signed-in' ? session.user : null
  const list = useJobsList(user?.role ?? null)
  const who = useMemo<Who>(() => ({ userId: user?.id ?? null, role: (user?.role ?? '') as Who['role'] }), [user?.id, user?.role])
  const mine = useMemo(() => (list.data ?? []).filter(j => inChip(j, 'mine', who)).sort(byRecent), [list.data, who])
  if (list.isPending) return <ChoiceSkeleton />
  if (list.isError) return null // the search box above still finds any job
  if (mine.length === 0)
    return (
      <p className="flex items-start gap-2 rounded-control bg-sunken px-3 py-3 text-base text-fg-2">
        <Icon icon={Inbox} className="mt-[calc((var(--lh-base)-16px)/2)] shrink-0 text-fg-muted" />
        <span className="min-w-0">No job is on your list yet. Search above finds any job by customer, number or item.</span>
      </p>
    )
  return (
    <div className="grid gap-2">
      <h2 className="text-sm font-card text-fg-muted">Your jobs</h2>
      <ul className="m-0 grid list-none gap-2 p-0" aria-label="Your jobs">
        {mine.map(j => (
          <JobChoice key={j.key} job={{ key: j.key, companyName: j.companyName, items: itemsSummary(j.items) }} onPick={onPick} />
        ))}
      </ul>
    </div>
  )
}

/** /capture with nothing shared (the engineer's Photo or note button): choose the job; its page opens the photo-or-note box. */
function JobFirst() {
  useMobileBar({ title: 'Photo or note' })
  const navigate = useNavigate()
  const [kept, setKept] = useState<CaptureItem[]>([])
  useEffect(() => {
    let live = true
    void safely(() => listCaptures(), []).then(list => live && setKept(list))
    return () => {
      live = false
    }
  }, [])
  return (
    <div className={COLUMN} data-testid="photo-or-note">
      <NoPrimary />
      <header className="grid gap-1">
        <h1 className={TITLE}>
          <TitleGlyph icon={Camera} />
          Photo or note
        </h1>
        <p className="text-base text-fg-2">Which job is it for? Then take the photo or write the note.</p>
      </header>
      <JobPicker showMine onPick={key => navigate(`/jobs/${encodeURIComponent(key)}`, { replace: true, state: { photoOrNote: true } })} />
      {kept.length > 0 ? (
        <section aria-label="Shared earlier" className={cn(CARD, 'grid gap-3 p-card')}>
          <h2 className="type-section">Shared earlier, not added yet</h2>
          <ul className="m-0 grid list-none gap-2 p-0">
            {kept.map(k => (
              <li key={k.id}>
                <Link to={`/capture?share=${encodeURIComponent(k.id)}`} className={cn(buttonStyles({ variant: 'quiet' }), 'h-auto min-h-touch justify-start whitespace-normal px-2 py-2 text-left text-base')}>
                  <Icon icon={Share2} className="shrink-0" />
                  {countsText(k.source, k.text, k.files)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

/** Loading jobs: three tiles shaped like the job choices. */
function ChoiceSkeleton() {
  return (
    <div role="status" aria-busy="true" className="grid gap-2">
      <span className="sr-only">Looking…</span>
      {[0, 1, 2].map(i => (
        <div key={i} aria-hidden="true" className="grid min-h-row gap-2 rounded-control border px-4 py-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="w-3/4" />
        </div>
      ))}
    </div>
  )
}

/** The glyph beside a page title: the forest glyph on its pale green tile, so it holds its own beside the heavy title. */
function TitleGlyph({ icon }: { icon: LucideIcon }) {
  return (
    <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-control bg-brand-100 text-brand-700">
      <Icon icon={icon} size="lg" />
    </span>
  )
}
