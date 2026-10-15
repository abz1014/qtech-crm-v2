import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { intakeFiles, type AddedFile } from '@/lib/fileIntake'
import {
  createCapture,
  deleteCapture,
  getCapture,
  listCaptures,
  purgeExpired,
  safely,
  type CaptureItem,
} from '@/lib/capture/store'
import { RFQ_FILE_ACCEPT } from '@/features/rfqs/lib/clarifications'
import { CaptureContext, type CaptureApi, type CaptureNotice, type Draft } from '@/app/capture/useCapture'

const CaptureSheet = lazy(() => import('@/features/capture/CaptureSheet'))

/*
 * Capture provider (R22). One draft for the whole shell, so every way in lands in the same place:
 *   - Android share target: the service worker stored the item and redirected to /capture (CaptureRoute opens it).
 *   - iPhone and anyone: the Capture button, the "C" key and the palette action open the sheet; paste, "Choose photos" and
 *     "Choose files" add to it.
 *   - Desktop: paste (Ctrl or Cmd V) or drop anywhere in the window opens the sheet with it already added.
 * The draft is kept in IndexedDB on this device as soon as it has content (7 days), so sign-in redirects and reloads lose nothing.
 */
const emptyDraft = (): Draft => ({ id: crypto.randomUUID(), source: 'pick', text: '', files: [] })

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
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [notice, setNotice] = useState<CaptureNotice>(null)
  const [dragging, setDragging] = useState(false)
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
      if (kept[0] && !dirty.current) await load(kept[0])
    })()
  }, [load])

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
      void intakeFiles(input.files, { accept: RFQ_FILE_ACCEPT }).then(added => setDraft(d => ({ ...d, files: [...d.files, ...added] })))
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
          } else {
            setNotice('expired')
          }
        } else if (draftRef.current.text.trim() || draftRef.current.files.length) {
          setNotice('back')
        }
        setOpen(true)
      })()
    },
    [load],
  )

  // Paste, drop and the C key, anywhere in the app.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      if (e.defaultPrevented || isEditable(e.target) || pathRef.current.startsWith('/rfqs/new')) return
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
      if (!hasFiles(e) || inFileDrop(e.target) || pathRef.current.startsWith('/rfqs/new')) return
      depth += 1
      setDragging(true)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e) || inFileDrop(e.target) || pathRef.current.startsWith('/rfqs/new')) return
      e.preventDefault()
    }
    const onLeave = () => {
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent) => {
      depth = 0
      setDragging(false)
      if (!hasFiles(e) || inFileDrop(e.target) || pathRef.current.startsWith('/rfqs/new')) return
      e.preventDefault()
      add({ files: [...(e.dataTransfer?.files ?? [])] }, 'drop')
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'c' || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.defaultPrevented) return
      if (isEditable(e.target) || document.querySelector('[role="dialog"]')) return  // also when the sheet is open: C is then just a letter
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

  const api = useMemo<CaptureApi>(
    () => ({ open, draft, notice, dragging, openCapture, close, setText, add, removeFile, discard, openShared }),
    [open, draft, notice, dragging, openCapture, close, setText, add, removeFile, discard, openShared],
  )

  return (
    <CaptureContext.Provider value={api}>
      {children}
      {open ? (
        <Suspense fallback={null}>
          <CaptureSheet />
        </Suspense>
      ) : null}
    </CaptureContext.Provider>
  )
}

