import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Upload } from 'lucide-react'
import { pastedText } from '@/lib/docread/htmlTable'
import { cn } from '@/lib/utils'
import { useSession } from '@/app/session'
import { CARD } from '@/ui/card'
import { Icon } from '@/ui/Icon'
import { purgeExpired, safely } from '@/lib/capture/store'
import { CaptureContext, type CaptureApi } from '@/app/capture/useCapture'

/*
 * Capture provider (R22, reshaped by P4: the six-destination Paste or photo sheet is gone). What is left is the way things arrive:
 *   - A file dropped, or text or a picture pasted, on To do or on the Jobs list starts a New enquiry with it (/enquiries/new reads it
 *     the way a PDF or a paste is always read there).
 *   - On a job's page the same paste or drop goes to "Add to this job" (features/jobs/AddToJob.tsx listens for it itself).
 *   - The Android share target still lands on /capture (the service worker keeps the item for 7 days); that page offers "New
 *     enquiry" or "Add to job…" (features/capture/CaptureRoute.tsx).
 * Nothing else reacts to a paste or a drop: a paste into a field is the field's. The intake screens read their own.
 * While a file is dragged over Home or the Jobs list, the whole window says so (Forest 21-new-enquiry #ne-overlay, F-072 / F-620):
 * "Drop to start a New RFQ" on the scrim. Only for the people who start RFQs (admin and sales; an engineer's Create is the camera).
 * It is a picture of what a drop does, not a control: pointer events pass through, so the drop still lands on the page.
 */
/** The intake screens read what is pasted or dropped themselves: New RFQ and New enquiry. */
const onIntake = (path: string) => path.startsWith('/rfqs/new') || path.startsWith('/enquiries/new')
/** To do and the Jobs list start a New enquiry from a paste or a drop (P4-A). */
const takesDrops = (path: string) => path === '/todo' || path === '/jobs' || path === '/todo/' || path === '/jobs/'

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return Boolean(el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName)))
}
const inFileDrop = (t: EventTarget | null) => Boolean((t as HTMLElement | null)?.closest?.('[aria-label="Add files"]'))
/** Another dialog is open (the palette, a confirm): a paste then belongs to it. */
const otherDialogOpen = () => document.querySelector('[role="dialog"]') !== null

export function CaptureProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const session = useSession()
  const startsRfqs = session.status === 'signed-in' && session.user.role !== 'engineer'
  const startsRef = useRef(startsRfqs)
  startsRef.current = startsRfqs
  // The overlay: files are being dragged over the window, on a screen where a drop starts a New RFQ.
  const [dragging, setDragging] = useState(false)
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const pathRef = useRef(pathname)
  pathRef.current = pathname

  // Items kept on this device by the share target are forgotten after 7 days.
  useEffect(() => {
    void safely(() => purgeExpired(), 0)
  }, [])

  const start = useCallback((input: { text?: string; files?: File[] }) => {
    navigateRef.current('/enquiries/new', { state: { capture: { id: crypto.randomUUID(), text: input.text ?? '', files: input.files ?? [] } } })
  }, [])

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target) || onIntake(pathRef.current) || !takesDrops(pathRef.current) || otherDialogOpen()) return
      const files = [...(e.clipboardData?.files ?? [])]
      const text = e.clipboardData ? pastedText(e.clipboardData) : ''
      if (!files.length && !text.trim()) return
      e.preventDefault()
      start({ text, files })
    }
    const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes('Files'))
    // dragenter / dragleave fire for every element crossed: a count of the ones entered tells when the drag has left the window.
    let depth = 0
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || !takesDrops(pathRef.current) || !startsRef.current) return
      depth += 1
      setDragging(!inFileDrop(e.target))
    }
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const end = () => {
      depth = 0
      setDragging(false)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e) || inFileDrop(e.target) || !takesDrops(pathRef.current)) return
      e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      end()
      if (!hasFiles(e) || inFileDrop(e.target) || !takesDrops(pathRef.current)) return
      const dropped = [...(e.dataTransfer?.files ?? [])]
      if (dropped.length === 0) return
      e.preventDefault()
      start({ files: dropped })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') end()
    }
    document.addEventListener('paste', onPaste)
    document.addEventListener('dragenter', onEnter)
    document.addEventListener('dragleave', onLeave)
    document.addEventListener('dragend', end)
    document.addEventListener('dragover', onOver)
    document.addEventListener('drop', onDrop)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('dragenter', onEnter)
      document.removeEventListener('dragleave', onLeave)
      document.removeEventListener('dragend', end)
      document.removeEventListener('dragover', onOver)
      document.removeEventListener('drop', onDrop)
      document.removeEventListener('keydown', onKey)
    }
  }, [start])

  const openCapture = useCallback(() => navigateRef.current('/enquiries/new'), [])
  const api = useMemo<CaptureApi>(() => ({ openCapture }), [openCapture])
  // Leaving Home or the Jobs list (or signing in as someone who does not start RFQs) takes the overlay away.
  const shown = dragging && startsRfqs && takesDrops(pathname)
  return (
    <CaptureContext.Provider value={api}>
      {children}
      {shown ? <DropOverlay /> : null}
    </CaptureContext.Provider>
  )
}

/** The whole-window drop overlay: the scrim, and in its middle the dashed drop card (Forest .qb-drop-overlay, .qb-drop). */
function DropOverlay() {
  return (
    <div data-testid="drop-overlay" className="pointer-events-none fixed inset-0 z-dialog grid animate-fade-in place-items-center bg-scrim p-gutter">
      <div
        role="status"
        className={cn(
          CARD,
          'grid w-full max-w-dialog animate-rise-6 justify-items-center gap-2 border-2 border-dashed border-brand-700 p-card text-center shadow-e3 md:py-10',
        )}
      >
        <span className="grid size-12 place-items-center rounded-pill bg-brand-100 text-brand-700">
          <Icon icon={Upload} size="xl" />
        </span>
        <p className="m-0 mt-1 text-lg font-bold text-fg text-balance">Drop to start a New RFQ</p>
        <p className="m-0 max-w-prose text-base text-fg-2 text-pretty">A PDF, a photo or a spreadsheet. It is read on this device. Nothing is saved until you create the job.</p>
      </div>
    </div>
  )
}
