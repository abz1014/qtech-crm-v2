import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ClipboardPaste, FileSpreadsheet, FileText, ImageIcon, RefreshCw, Upload } from 'lucide-react'
import { pastedText } from '@/lib/docread/htmlTable'
import { cn } from '@/lib/utils'
import { Button } from '@/ui/Button'
import { CARD } from '@/ui/card'
import { Kbd } from '@/ui/Kbd'
import { Skeleton } from '@/ui/Skeleton'
import { Icon } from '@/ui/Icon'
import IntakeScreen from '@/features/rfqs/IntakeScreen'

/*
 * New RFQ (P4-A, /enquiries/new and /rfqs/new, one page): the customer's document on one side, what was read from it on the other. The right side IS
 * the existing intake (features/rfqs/IntakeScreen, read as it always was: PDF, photo, spreadsheet and paste go through PdfIntake,
 * fileIntake and the parsers), in its "enquiry" mode: unsure fields say "Check this" and the one green button is "Create job N".
 * This page adds only the left side and the way a file arrives:
 *   - a file dropped anywhere on To do or on the Jobs list (CaptureProvider) opens this page with it, as does Choose a file here or
 *     a file dropped on this page's own zone: all of them hand the file to the intake the way Capture's "Start a new RFQ" does
 *     (navigation state `capture`), so the intake reads it exactly as it read a captured file;
 *   - pasted text is mirrored on the left so the source stays in view while it is checked.
 * A PDF is drawn page by page by pdf.js (the CSP blocks a PDF frame), a picture is shown as a picture; a spreadsheet has no preview, only its name (it is read on
 * the device, nothing is uploaded to read it).
 */
type Capture = { id: string; text: string; files: File[] }

// Light checks by type or extension (the readers themselves are downloaded only when a file is read).
const isPdfFile = (f: { type?: string; name?: string }) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name ?? '')
const isImageFile = (f: { type?: string; name?: string }) => (f.type ?? '').startsWith('image/') || /\.(png|jpe?g|webp|heic|heif)$/i.test(f.name ?? '')
const isSheetFile = (f: { type?: string; name?: string }) => /\.(xlsx|xls|csv)$/i.test(f.name ?? '') || /spreadsheet|ms-excel|csv/.test(f.type ?? '')
const isReadableFile = (f: { type?: string; name?: string }) => isPdfFile(f) || isImageFile(f) || isSheetFile(f)

const PICK = 'application/pdf,image/*,.xlsx,.xls,.csv'

export default function NewEnquiryPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const capture = (location.state as { capture?: Capture } | null)?.capture
  // A file chosen with the intake's own "Choose PDF or photo" button is read by the intake; it is shown here the way a dropped one is
  // (the newest file replaces the one before). A new capture (a drop, "Use a different file") starts the left side again.
  const [picked, setPicked] = useState<File[]>([])
  const captureId = capture?.id
  useEffect(() => setPicked([]), [captureId])
  const files = useMemo(() => (picked.length > 0 ? picked : (capture?.files ?? [])).filter(f => isReadableFile(f)), [capture, picked])
  const [pasted, setPasted] = useState('')

  // The pasted message is read by the intake itself (it listens for paste); this only shows it beside the result.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const text = e.clipboardData ? pastedText(e.clipboardData) : ''
      if (text.trim().length > 20) setPasted(text)
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  const take = (list: File[]) => {
    const readable = list.filter(f => isReadableFile(f))
    if (readable.length === 0) return
    navigate(location.pathname, { replace: true, state: { capture: { id: crypto.randomUUID(), text: '', files: readable } } })
  }

  const text = capture?.text?.trim() || pasted.trim()
  // Forest 21-new-enquiry: the page head, the steps, then the document card (left from 1024 px) beside the form; the intake draws
  // the page and places this card (IntakeScreen `doc`).
  const doc = (
    <aside aria-label="The customer's document" className={cn(CARD, 'grid min-w-0 content-start gap-4 p-card')}>
      <h2 className="type-section">The customer&rsquo;s document</h2>
      {files.length > 0 ? (
        files.map(f => <Preview key={`${f.name}|${f.size}|${f.lastModified}`} file={f} />)
      ) : text ? null : (
        <DropZone onFiles={take} />
      )}
      {text ? (
        <section aria-label="Pasted text" className="grid min-w-0 gap-2">
          <h3 className="flex items-center gap-2 text-sm font-card text-fg-muted">
            <Icon icon={ClipboardPaste} size="sm" />
            Pasted text
          </h3>
          <pre className="m-0 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-control bg-sunken px-3 py-2 font-mono text-sm leading-6 text-fg-2 [overflow-wrap:anywhere] max-md:text-base" data-testid="source-text">
            {text}
          </pre>
        </section>
      ) : null}
      {files.length > 0 || text ? <ChooseAnother onFiles={take} /> : null}
    </aside>
  )
  return (
    <div className="min-w-0" data-testid="new-enquiry">
      <IntakeScreen mode="enquiry" onFilePicked={f => setPicked([f])} doc={doc} />
    </div>
  )
}

function Preview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null)
  const [pages, setPages] = useState<{ urls: string[]; more: number } | 'failed' | null>(null)
  const pdf = isPdfFile(file)
  const image = isImageFile(file)
  // A picture is shown as it is (img-src allows blob:). A PDF cannot go in a frame (the CSP blocks blob: frames): its first pages are
  // drawn by pdf.js (pdfPreview.ts).
  useEffect(() => {
    if (!image || typeof URL.createObjectURL !== 'function') return
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file, image])
  useEffect(() => {
    if (!pdf) return
    let live = true
    let drawn: string[] = []
    const ctl = new AbortController()
    void import('@/features/enquiry/pdfPreview').then(m => m.renderPdfPreview(file, { signal: ctl.signal })).then(r => {
      if (!live) {
        r?.urls.forEach(u => URL.revokeObjectURL(u))
        return
      }
      drawn = r?.urls ?? []
      setPages(r ?? 'failed')
    })
    return () => {
      live = false
      ctl.abort()
      drawn.forEach(u => URL.revokeObjectURL(u))
    }
  }, [file, pdf])
  return (
    <figure className="m-0 grid min-w-0 gap-3" data-testid="source-file">
      <figcaption className="flex min-w-0 items-center gap-2 text-base font-bold">
        <Icon icon={pdf ? FileText : image ? ImageIcon : FileSpreadsheet} className="shrink-0 text-brand-700" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{file.name}</span>
      </figcaption>
      {pdf ? (
        pages === null ? (
          <div className="grid gap-2">
            <p role="status" className="text-sm text-fg-muted">Drawing the first page…</p>
            {/* shaped like a page: a sheet with a heading line and text lines */}
            <div aria-hidden="true" className="grid aspect-[3/4] max-h-[28rem] content-start gap-3 rounded-control border bg-surface p-5 shadow-e1">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="w-11/12" />
              <Skeleton className="w-4/5" />
              <Skeleton className="w-3/5" />
            </div>
          </div>
        ) : pages === 'failed' ? (
          <p className="rounded-control bg-sunken px-3 py-3 text-base text-fg-2">The preview could not be drawn. The items are read on the right.</p>
        ) : (
          <div className="grid max-h-[78vh] gap-3 overflow-auto rounded-control bg-deep p-3">
            {pages.urls.map((u, i) => (
              <img key={u} src={u} alt={`${file.name}, page ${i + 1}`} className="w-full rounded-control border bg-surface shadow-e1" />
            ))}
            {pages.more > 0 ? <p className="px-1 text-sm text-fg-2">{pages.more === 1 ? '1 more page' : `${pages.more} more pages`} not shown. All of it is read.</p> : null}
          </div>
        )
      ) : url && image ? (
        <img src={url} alt={`The photo ${file.name}`} className="max-h-[78vh] w-full rounded-control border bg-deep object-contain" />
      ) : (
        <p className="rounded-control bg-sunken px-3 py-3 text-base text-fg-2">A spreadsheet has no preview. It is read on this device. The items are on the right.</p>
      )}
    </figure>
  )
}

function DropZone({ onFiles }: { onFiles: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div
      data-testid="enquiry-dropzone"
      onDragOver={e => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={e => {
        e.preventDefault()
        setOver(false)
        onFiles([...e.dataTransfer.files])
      }}
      // Forest .qb-drop: a dashed card, centred; it turns the pale green with a forest edge while a file is over it (or a control in it
      // has focus).
      className={cn(
        'grid min-h-[10rem] min-w-0 content-center justify-items-center gap-2 rounded-card border-2 border-dashed p-5 text-center text-base transition-colors duration-fast ease-out focus-within:border-brand-700 focus-within:bg-brand-100',
        over ? 'border-brand-700 bg-brand-100' : 'border-line-input bg-surface',
      )}
    >
      <Icon icon={Upload} size="xl" className="text-brand-700" />
      <p className="m-0 max-w-[26rem] font-bold text-fg text-balance">Drop the customer&rsquo;s PDF, photo or spreadsheet here</p>
      <p className="m-0 max-w-[26rem] text-sm text-fg-2 text-pretty">Or paste their message anywhere on this page. Nothing is saved until the job is created.</p>
      <input
        ref={input}
        type="file"
        accept={PICK}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="enquiry-file-input"
        onChange={e => {
          const list = [...(e.target.files ?? [])]
          e.target.value = ''
          onFiles(list)
        }}
      />
      <Button size="lg" icon={Upload} onClick={() => input.current?.click()} className="mt-2 max-md:h-touch">
        Choose a file
      </Button>
      <span className="text-sm text-fg-muted max-md:hidden [@media(pointer:coarse)]:hidden">
        <Kbd size="inline">Ctrl</Kbd> <Kbd size="inline">V</Kbd> pastes the message
      </span>
    </div>
  )
}

function ChooseAnother({ onFiles }: { onFiles: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div>
      <input
        ref={input}
        type="file"
        accept={PICK}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={e => {
          const list = [...(e.target.files ?? [])]
          e.target.value = ''
          onFiles(list)
        }}
      />
      <Button variant="quiet" icon={RefreshCw} onClick={() => input.current?.click()} className="max-md:h-touch">
        Use a different file
      </Button>
    </div>
  )
}
