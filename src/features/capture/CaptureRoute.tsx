import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Camera, FilePlus2, Search, Share2 } from 'lucide-react'
import { useSession } from '@/app/session'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { useToast } from '@/ui/useToast'
import { getCapture, listCaptures, safely, takeBackFromSignIn, type CaptureItem } from '@/lib/capture/store'
import { countsText } from '@/features/capture/model'
import { useJobSearch } from '@/features/jobs/hooks'

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
      if (found && takeBackFromSignIn()) toast({ title: 'Your shared item is back', body: 'Choose where it goes to finish.' })
    })()
    return () => {
      live = false
    }
    // the toast function is stable enough: this reads the kept item once per share
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!id) return <JobFirst />

  if (item === undefined) return <div className="px-4 py-8 text-base text-fg-2">Opening what you shared…</div>

  if (item === null)
    return (
      <div className="mx-auto grid max-w-xl gap-4 px-4 py-8" data-testid="share-gone">
        <h1 className="text-2xl font-semibold tracking-tight">Nothing to add</h1>
        <p className="text-base text-fg-2">That shared item is no longer on this device (shared items are kept for 7 days). Share it again from WhatsApp, or start from a job.</p>
        <div>
          <Button size="touch" onClick={() => navigate('/jobs')} className="text-base">
            Open Jobs
          </Button>
        </div>
      </div>
    )

  const text = item.text.trim()
  const canEnquire = role === 'admin' || role === 'sales'
  const summary = countsText(item.source, item.text, item.files)

  return (
    <div className="mx-auto grid max-w-xl gap-5 px-4 py-8" data-testid="share-target">
      <header className="grid gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Icon icon={Share2} className="text-fg-muted" />
          Shared with Q-Tech CRM
        </h1>
        <p className="text-base text-fg-2">{summary}</p>
      </header>
      {text ? <pre className="max-h-[12rem] overflow-auto whitespace-pre-wrap rounded-row border bg-surface p-3 text-base [overflow-wrap:anywhere]">{text.length > 600 ? `${text.slice(0, 600)}…` : text}</pre> : null}
      {item.files.length > 0 ? (
        <ul className="grid gap-1 text-base" aria-label="Shared files">
          {item.files.map(f => (
            <li key={`${f.name}|${f.size}`} className="[overflow-wrap:anywhere]">
              {f.name}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {canEnquire ? (
          <Button
            variant="primary"
            size="touch"
            icon={FilePlus2}
            onClick={() => navigate('/enquiries/new', { replace: true, state: { capture: { id: item.id, text: item.text, files: files(item) } } })}
            className="text-base"
          >
            New enquiry
          </Button>
        ) : null}
        <Button size="touch" icon={Search} onClick={() => setPicking(p => !p)} aria-expanded={picking} className="text-base">
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
function JobPicker({ onPick }: { onPick: (key: string) => void }) {
  const [find, setFind] = useState('')
  const jobs = useJobSearch(find)
  return (
    <section aria-label="Pick the job" className="grid gap-3 rounded-panel border bg-surface p-4">
      <label className="grid gap-1 text-base font-medium">
        Find the job
        <input
          autoFocus
          value={find}
          onChange={e => setFind(e.target.value)}
          placeholder="Customer, job number or item"
          className="min-h-touch rounded border border-line-input bg-surface px-3 text-base font-regular"
        />
      </label>
      {find.trim() === '' ? null : jobs.isPending ? (
        <p className="text-base text-fg-2">Looking…</p>
      ) : (jobs.data ?? []).length === 0 ? (
        <p className="text-base text-fg-2">No job found. Try the customer’s name or the job number.</p>
      ) : (
        <ul className="grid gap-2" aria-label="Jobs found">
          {(jobs.data ?? []).slice(0, 8).map(j => (
            <li key={j.key}>
              <button
                type="button"
                onClick={() => onPick(j.key)}
                className="grid min-h-touch w-full gap-px rounded border border-line-strong bg-surface px-3 py-2 text-left hover:bg-sunken"
              >
                <span className="text-base font-semibold">
                  Job {j.key} · {j.companyName}
                </span>
                <span className="text-base text-fg-2 [overflow-wrap:anywhere]">{j.items}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** /capture with nothing shared (the engineer's Photo or note button): choose the job; its page opens the photo-or-note box. */
function JobFirst() {
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
    <div className="mx-auto grid max-w-xl gap-5 px-4 py-8" data-testid="photo-or-note">
      <header className="grid gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <Icon icon={Camera} className="text-fg-muted" />
          Photo or note
        </h1>
        <p className="text-base text-fg-2">Which job is it for? Then take the photo or write the note.</p>
      </header>
      <JobPicker onPick={key => navigate(`/jobs/${encodeURIComponent(key)}`, { replace: true, state: { photoOrNote: true } })} />
      {kept.length > 0 ? (
        <section aria-label="Shared earlier" className="grid gap-2">
          <h2 className="text-base font-semibold">Shared earlier, not added yet</h2>
          <ul className="grid gap-2">
            {kept.map(k => (
              <li key={k.id}>
                <Link to={`/capture?share=${encodeURIComponent(k.id)}`} className="inline-flex min-h-touch items-center text-base font-semibold text-primary hover:underline">
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
