import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { pastedText } from '@/lib/docread/htmlTable'
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
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e) || inFileDrop(e.target) || !takesDrops(pathRef.current)) return
      e.preventDefault()
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e) || inFileDrop(e.target) || !takesDrops(pathRef.current)) return
      const dropped = [...(e.dataTransfer?.files ?? [])]
      if (dropped.length === 0) return
      e.preventDefault()
      start({ files: dropped })
    }
    document.addEventListener('paste', onPaste)
    document.addEventListener('dragover', onOver)
    document.addEventListener('drop', onDrop)
    return () => {
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('dragover', onOver)
      document.removeEventListener('drop', onDrop)
    }
  }, [start])

  const openCapture = useCallback(() => navigateRef.current('/enquiries/new'), [])
  const api = useMemo<CaptureApi>(() => ({ openCapture }), [openCapture])
  return <CaptureContext.Provider value={api}>{children}</CaptureContext.Provider>
}
