import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { intakeFiles, type AddedFile } from '@/lib/fileIntake'
import { useToast } from '@/ui/useToast'
import { LoadBoundary } from '@/ui/LoadBoundary'
import { useRetryableLazy } from '@/lib/importWithReload'
import { blockingOverlayOpen, shortcutsEnabled } from '@/ui/useShortcutsSetting'
import {
  createCapture,
  deleteCapture,
  getCapture,
  listCaptures,
  purgeExpired,
  safely,
  takeBackFromSignIn,
  type CaptureItem,
} from '@/lib/capture/store'
import { RFQ_FILE_ACCEPT } from '@/features/rfqs/lib/clarifications'
import { CaptureContext, type CaptureApi, type CaptureNotice, type Draft } from '@/app/capture/useCapture'

// Loaded when first opened. With no signal the chunk may not be there: the sheet then fails on its own (a toast with Try
// again), never the whole app; the draft lives here, so nothing typed or added is lost (hunt HE-2).
const loadCaptureSheet = () => import('@/features/capture/CaptureSheet')

/*
 * Capture provider (R22). One draft for the whole shell, so every way in lands in the same place:
 *   - Android share target: the service worker stored the item and redirected to /capture (CaptureRoute opens it).
 *   - iPhone and anyone: the Capture button, the "C" key and the palette action open the sheet; paste, "Choose photos" and
 *     "Choose files" add to it.
 *   - Desktop: paste (Ctrl or Cmd V) or drop anywhere in the window opens the sheet with it already added.
 * The draft is kept in IndexedDB on this device as soon as it has content (7 days), so sign-in redirects and reloads lose nothing.
 */
const emptyDraft = (): Draft => ({ id: crypto.randomUUID(), source: 'pick', text: '', files: [] })

/** The intake screens read what is pasted or dropped themselves: New RFQ and New enquiry. */
const onIntake = (path: string) => path.startsWith('/rfqs/new') || path.startsWith('/enquiries/new')
/** To do and the Jobs list take a dropped file straight to New enquiry (P4-A). */
const takesDrops = (path: string) => path === '/todo' || path === '/jobs' || path === '/todo/' || path === '/jobs/'

const isEditable = (t: EventTarget | null) => {
  const el = t as HTMLElement | null
  return Boolean(el && (el.isContentEditable || /^(input|textarea|select)$/i.test(el.tagName)))
}
const inFileDrop = (t: EventTarget | null) => Boolean((t as HTMLElement | null)?.closest?.('[aria-label="Add files"]'))
/** Another dialog is open (the palette, a confirm). The Capture sheet itself does not count: marked by data-capture-body. */
const otherDialogOpen = () => [...document.querySelectorAll('[role="dialog"]')].some(d => !d.querySelector('[data-capture-body]'))

async function toFiles(item: CaptureItem): Promise<AddedFile[]> {
  return intakeFiles(
    item.files.map(f => new File([f.blob], f.name, { type: f.type })),
    { accept: RFQ_FILE_ACCEPT },
  )
}

export function CaptureProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [notice, setNotice] = useState<CaptureNotice>(null)
  const [dragging, setDragging] = useState(0)
  const [resizing, setResizing] = useState<{ id: string; name: string }[]>([])
  const { toast } = useToast()
  const draftRef = useRef(draft)
  draftRef.current = draft
  const pathRef = useRef(pathname)
  pathRef.current = pathname
  const openRef = useRef(open)
  openRef.current = open
  const ready = useRef<Promise<void>>(Promise.resolve())
  const dirty = useRef(false)

  const load = useCallback(async (item: CaptureItem) => {
    const files = await toFiles(item)
    setDraft({ id: item.id, source: item.source, text: item.text, files })
  }, [])

  // On start: drop what expired, and pick up the newest item still kept so a reload or a sign-in loses nothing.
  useEffect(() => {
    ready.current = (async () => {
      await safely(() => purgeExpired(), 0)
      const kept = await safely(() => listCaptures(), [])
      if (!kept[0] || dirty.current) return
      // Shrinking the kept photos takes a while: anything typed, pasted or dropped meanwhile wins over the kept item.
      const files = await toFiles(kept[0])
      if (!dirty.current) setDraft({ id: kept[0].id, source: kept[0].source, text: kept[0].text, files })
    })()
  }, [])

  // Keep the draft on the device once it has content (debounced), and forget it when it is emptied.
  const persist = useCallback(async (d: Draft) => {
    if (!d.text.trim() && d.files.length === 0) return safely(() => deleteCapture(d.id), undefined)
    await safely(
      async () =>
        void (await createCapture({
          id: d.id,
          source: d.source,
          text: d.text,
          files: d.files.filter(f => !f.error).map(f => ({ name: f.file.name, type: f.file.type, size: f.file.size, blob: f.file })),
        })),
      undefined,
    )
  }, [])
  useEffect(() => {
    if (!dirty.current) return
    const t = setTimeout(() => void persist(draft), 300)
    return () => clearTimeout(t)
  }, [draft, persist])

  const setText = useCallback((text: string) => {
    dirty.current = true
    setDraft(d => ({ ...d, text }))
  }, [])

  const add = useCallback<CaptureApi['add']>((input, source) => {
    dirty.current = true
    setNotice(null)
    setOpen(true)
    const text = input.text?.trim()
    if (text || input.files?.length) {
      setDraft(d => ({ ...d, source: d.text || d.files.length ? d.source : source, text: text ? (d.text.trim() ? `${d.text.trimEnd()}\n${text}` : text) : d.text }))
    }
    if (input.files?.length) {
      const marks = input.files.map(f => ({ id: crypto.randomUUID(), name: f.name }))
      setResizing(r => [...r, ...marks])
      void intakeFiles(input.files, { accept: RFQ_FILE_ACCEPT })
        .then(added => setDraft(d => ({ ...d, files: [...d.files, ...added] })))
        .finally(() => setResizing(r => r.filter(m => !marks.some(k => k.id === m.id))))
    }
  }, [])

  const removeFile = useCallback((id: string) => {
    dirty.current = true
    setDraft(d => ({ ...d, files: d.files.filter(f => f.id !== id) }))
  }, [])

  const discard = useCallback(() => {
    const old = draftRef.current.id
    void safely(() => deleteCapture(old), undefined)
    dirty.current = false
    setDraft(emptyDraft())
    setNotice(null)
  }, [])

  const openCapture = useCallback(() => {
    setNotice(null)
    setOpen(true)
  }, [])

  const close = useCallback(() => {
    setOpen(false)
    setNotice(null)
    if (dirty.current) void persist(draftRef.current)
  }, [persist])

  const openShared = useCallback(
    (id: string | null) => {
      void (async () => {
        await ready.current
        if (id) {
          const item = await safely(() => getCapture(id), null)
          if (item) {
            dirty.current = false
            await load(item)
            setNotice(null)
            if (takeBackFromSignIn()) toast({ title: 'Your shared item is back', body: 'Choose where it goes to finish.' })
          } else {
            setNotice('expired')
          }
        } else if (draftRef.current.text.trim() || draftRef.current.files.length) {
          if (takeBackFromSignIn()) toast({ title: 'Your shared item is back', body: 'Choose where it goes to finish.' })
        }
        setOpen(true)
      })()
    },
    [load, toast],
  )

  // Paste, drop and the C key, anywhere in the app.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target) || onIntake(pathRef.current)) return
      if (otherDialogOpen()) return
      const files = [...(e.clipboardData?.files ?? [])]
      const text = e.clipboardData?.getData('text/plain') ?? ''
      if (files.length && document.querySelector('[aria-label="Add files"]') && !openRef.current) return
      if (!files.length && !text.trim()) return
      e.preventDefault()
      add({ text, files }, 'paste')
    }
    const hasFiles = (e: DragEvent) => Boolean(e.dataTransfer?.types.includes('Files'))
    let depth = 0
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e) || inFileDrop(e.target) || onIntake(pathRef.current)) return
      depth += 1
      setDragging(e.dataTransfer?.items.length || 1)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e) || inFileDrop(e.target) || onIntake(pathRef.current)) return
      e.preventDefault()
    }
    const onLeave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(0)
    }
    const onDrop = (e: DragEvent) => {
      depth = 0
      setDragging(0)
      if (!hasFiles(e) || inFileDrop(e.target) || onIntake(pathRef.current)) return
      e.preventDefault()
      const dropped = [...(e.dataTransfer?.files ?? [])]
      // A file dropped on To do or on the Jobs list starts a New enquiry with it; anywhere else it still goes to Paste or photo.
      if (takesDrops(pathRef.current) && dropped.length > 0) {
        navigateRef.current('/enquiries/new', { state: { capture: { id: crypto.randomUUID(), text: '', files: dropped } } })
        return
      }
      add({ files: dropped }, 'drop')
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'c' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return
      // A single-key shortcut: off when the person turned them off, in a text field, and while a dialog (the sheet itself, the
      // Help panel too), alert or menu is open: C is then just a letter.
      if (!shortcutsEnabled() || isEditable(e.target) || blockingOverlayOpen() || document.querySelector('[role="dialog"]')) return
      e.preventDefault()
      setNotice(null)
      setOpen(true)
    }
    document.addEventListener('paste', onPaste)
    document.addEventListener('dragenter', onEnter)
    document.addEventListener('dragover', onOver)
    document.addEventListener('dragleave', onLeave)
    document.addEventListener('drop', onDrop)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('paste', onPaste)
      document.removeEventListener('dragenter', onEnter)
      document.removeEventListener('dragover', onOver)
      document.removeEventListener('dragleave', onLeave)
      document.removeEventListener('drop', onDrop)
      document.removeEventListener('keydown', onKey)
    }
  }, [add])

  const sheet = useRetryableLazy(loadCaptureSheet)
  const retrySheet = sheet.retry
  const onSheetLoadError = useCallback(
    (err: unknown) => {
      setOpen(false)
      retrySheet()
      toast({
        tone: 'danger',
        title: 'Paste or photo could not open',
        body: err instanceof Error && err.name === 'StaleAppError' ? err.message : 'Check your signal, then try again.',
        action: { label: 'Try again', onClick: () => setOpen(true) },
      })
    },
    [toast, retrySheet],
  )

  const api = useMemo<CaptureApi>(
    () => ({ open, draft, notice, dragging, resizing, openCapture, close, setText, add, removeFile, discard, openShared }),
    [open, draft, notice, dragging, resizing, openCapture, close, setText, add, removeFile, discard, openShared],
  )

  return (
    <CaptureContext.Provider value={api}>
      {children}
      {open ? (
        <LoadBoundary key={sheet.attempt} onError={onSheetLoadError}>
          <Suspense fallback={null}>
            <sheet.Component />
          </Suspense>
        </LoadBoundary>
      ) : null}
    </CaptureContext.Provider>
  )
}

