import { Suspense, useRef, useState } from 'react'
import { Building2, FileText, Plus } from 'lucide-react'
import type { PdfSubject } from '@/lib/docread/pdfText'
import type { readDocument as ReadDocument } from '@/features/rfqs/lib/readPdf'
import type { SenderHint } from '@/features/companies/api'
import { useCompanyForSender } from '@/features/companies/hooks'
import { lazyWithReload } from '@/lib/importWithReload'
import type { IntakeCompany } from '@/features/rfqs/CompanyPicker'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'

// The file and reply readers (src/lib/docread: PDF text, the on-device picture reader, the quote parser) are downloaded the first
// time a file or a reply is read, not with the RFQ page (perf/lcp).
const readDocument: typeof ReadDocument = (...args) => import('@/features/rfqs/lib/readPdf').then(m => m.readDocument(...args))
// The new-company form (and its form library) is downloaded when it is opened (perf/lcp).
const CreateCompanyInline = lazyWithReload(() => import('@/features/companies/CreateCompanyInline').then(m => ({ default: m.CreateCompanyInline })))

/*
 * PDFs, pictures and the sender, for New RFQ and a supplier's reply (owner decision 2026-10-20, item 3; pictures: owner priority
 * the same day). A PDF or a picture (a screenshot, a photo taken now with the phone's camera) is read on this device
 * (src/lib/docread, nothing is uploaded to read it) and its text goes where a paste goes. A scan, a locked or a damaged file, a
 * picture that could not be read clearly gets the reader's own plain sentence. The file itself is kept and attached as before.
 */

/**
 * "Choose PDF or photo" (New RFQ) or "Read a PDF or photo" (a supplier's reply): a button over a hidden file input. On a phone
 * the picker offers the camera and the gallery. A picture shows its progress on the button ("Reading the image… 40%") and can
 * be cancelled.
 */
export function PdfPickButton({
  label,
  subject,
  onText,
  onFile,
  onMessage,
  size,
}: {
  label: string
  subject: PdfSubject
  onText: (text: string, from: 'pdf' | 'photo') => void
  onFile?: (file: File) => void
  onMessage: (message: string | null) => void
  size?: 'sm'
}) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const reading = useRef<AbortController | null>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf,image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid={`pdf-input-${subject}`}
        onChange={async e => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file) return
          const ctrl = new AbortController()
          reading.current = ctrl
          setBusy(file.type === 'application/pdf' || /\.pdf$/i.test(file.name) ? 'Reading the PDF' : 'Reading the image…')
          onMessage(null)
          try {
            onFile?.(file)
            const r = await readDocument(file, subject, { signal: ctrl.signal, onProgress: p => setBusy(p.message) })
            if ('text' in r) onText(r.text, r.from)
            else if ('message' in r) onMessage(r.message)
          } finally {
            if (reading.current === ctrl) reading.current = null
            setBusy(null)
          }
        }}
      />
      <Button size={size} icon={FileText} busy={busy !== null} busyLabel={<span aria-live="polite">{busy}</span>} onClick={() => input.current?.click()}>
        {label}
      </Button>
      {busy !== null && busy !== 'Reading the PDF' ? (
        <Button size={size} variant="quiet" onClick={() => reading.current?.abort()}>
          Cancel
        </Button>
      ) : null}
    </>
  )
}

const WHY = { email: 'Their email is on file', domain: 'Their email domain is on file', phone: 'Their phone number is on file', name: 'Same name on file' } as const

/**
 * The company the enquiry came from, offered as one tap: "Use <Company>". When nothing on file matches and the text names the
 * company, it can be added right here (the same inline create as the company picker; sales and admin only).
 */
export function SenderSuggestion({ hint, canCreate, onUse }: { hint: SenderHint; canCreate: boolean; onUse: (c: IntakeCompany) => void }) {
  const found = useCompanyForSender(hint)
  const [creating, setCreating] = useState(false)
  if (found.isPending || found.isError) return null
  const hit = found.data
  if (hit) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border bg-sunken px-3 py-2 text-sm">
        <Icon icon={Building2} className="text-fg-muted" />
        <span className="min-w-0 flex-1">
          <span className="text-fg-2">From the text: </span>
          <strong className="font-medium">{hit.name}</strong>
          <span className="block text-xs text-fg-muted">{WHY[hit.why]}</span>
        </span>
        <Button size="sm" variant="primary" onClick={() => onUse({ id: hit.id, name: hit.name, country: hit.country, city: hit.city ?? null, role: hit.role })}>
          Use {hit.name}
        </Button>
      </div>
    )
  }
  if (!hint.name || !canCreate) return null
  return creating ? (
    <Suspense fallback={null}>
      <CreateCompanyInline
        initialName={hint.name}
        onCancel={() => setCreating(false)}
        onCreated={c => onUse({ id: c.id, name: c.name, country: null, city: c.city ?? null, role: 'prospect' })}
      />
    </Suspense>
  ) : (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded border bg-sunken px-3 py-2 text-sm">
      <Icon icon={Building2} className="text-fg-muted" />
      <span className="min-w-0 flex-1">
        <span className="text-fg-2">From the text: </span>
        <strong className="font-medium">{hint.name}</strong>
        <span className="block text-xs text-fg-muted">Not on file yet</span>
      </span>
      <Button size="sm" icon={Plus} onClick={() => setCreating(true)}>
        Add {hint.name} as a new company
      </Button>
    </div>
  )
}
