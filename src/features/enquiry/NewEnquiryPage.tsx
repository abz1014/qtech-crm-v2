import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FileSpreadsheet, FileText, ImageIcon, Upload } from 'lucide-react'
import { pastedText } from '@/lib/docread/htmlTable'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import IntakeScreen from '@/features/rfqs/IntakeScreen'

/*
 * New enquiry (P4-A, /enquiries/new): the customer's document on one side, what was read from it on the other. The right side IS
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
  const files = useMemo(() => (capture?.files ?? []).filter(f => isReadableFile(f)), [capture])
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
    navigate('/enquiries/new', { replace: true, state: { capture: { id: crypto.randomUUID(), text: '', files: readable } } })
  }

  const text = capture?.text?.trim() || pasted.trim()
  return (
    <div className="grid w-full min-w-0 gap-4 px-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:items-start lg:gap-2 lg:pl-8" data-testid="new-enquiry">
      <aside aria-label="The customer's document" className="grid min-w-0 content-start gap-3 px-4 pb-8 pt-6 max-lg:order-2 lg:sticky lg:top-[-10rem] lg:px-0 lg:pr-4 lg:pt-[12rem]">
        <h2 className="text-lg font-semibold tracking-snug">The customer&rsquo;s document</h2>
        {files.length > 0 ? (
          files.map(f => <Preview key={`${f.name}|${f.size}|${f.lastModified}`} file={f} />)
        ) : text ? null : (
          <DropZone onFiles={take} />
        )}
        {text ? (
          <section aria-label="Pasted text" className="grid gap-2">
            <h3 className="text-base font-medium text-fg-2">Pasted text</h3>
            <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-row border bg-surface p-3 text-base [overflow-wrap:anywhere]" data-testid="source-text">
              {text}
            </pre>
          </section>
        ) : null}
        {files.length > 0 || text ? <ChooseAnother onFiles={take} /> : null}
      </aside>
      <div className="min-w-0 max-lg:order-1">
        <IntakeScreen mode="enquiry" />
      </div>
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
    <figure className="m-0 grid gap-2" data-testid="source-file">
      <figcaption className="flex min-w-0 items-center gap-2 text-base font-medium">
        <Icon icon={pdf ? FileText : image ? ImageIcon : FileSpreadsheet} className="shrink-0 text-fg-muted" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{file.name}</span>
      </figcaption>
      {pdf ? (
        pages === null ? (
          <p className="rounded-row border bg-surface px-4 py-3 text-base text-fg-2">Drawing the first page…</p>
        ) : pages === 'failed' ? (
          <p className="rounded-row border bg-surface px-4 py-3 text-base text-fg-2">The preview could not be drawn. The items are read on the right.</p>
        ) : (
          <div className="grid max-h-[78vh] gap-2 overflow-auto rounded-row border bg-surface p-1">
            {pages.urls.map((u, i) => (
              <img key={u} src={u} alt={`${file.name}, page ${i + 1}`} className="w-full" />
            ))}
            {pages.more > 0 ? <p className="px-3 py-2 text-base text-fg-2">{pages.more === 1 ? '1 more page' : `${pages.more} more pages`} not shown. All of it is read.</p> : null}
          </div>
        )
      ) : url && image ? (
        <img src={url} alt={`The photo ${file.name}`} className="max-h-[78vh] w-full rounded-row border bg-surface object-contain" />
      ) : (
        <p className="rounded-row border bg-surface px-4 py-3 text-base text-fg-2">A spreadsheet has no preview. It is read on this device; the items are on the right.</p>
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
      className={`grid justify-items-start gap-3 rounded-panel border-2 border-dashed px-5 py-8 text-base ${over ? 'border-brand-green bg-block-quiet' : 'border-line-strong bg-surface'}`}
    >
      <Icon icon={Upload} size="lg" className="text-fg-muted" />
      <p className="m-0 font-medium">Drop the customer&rsquo;s PDF, photo or spreadsheet here</p>
      <p className="m-0 text-fg-2">Or paste their message anywhere on this page. Nothing is saved until you create the job.</p>
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
      <Button size="touch" icon={Upload} onClick={() => input.current?.click()} className="text-base">
        Choose a file
      </Button>
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
      <Button size="touch" variant="quiet" onClick={() => input.current?.click()} className="text-base">
        Use a different file
      </Button>
    </div>
  )
}
