import { useRef, useState } from 'react'
import { FileText, Paperclip } from 'lucide-react'
import { intakeFiles } from '@/lib/fileIntake'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { Icon } from '@/ui/Icon'
import { useToast } from '@/ui/useToast'
import { useFileUrls, useOrderAttachments, useUploadAttachment } from '@/features/rfqs/hooks'
import { attachmentPath } from '@/features/rfqs/lib'

/*
 * The customer's PO document itself (0134), on the order's Customer PO line: "PO file: name.pdf" links and an "Attach PO file" button.
 * One or more files, a PDF or a picture. The upload is tagged is_customer_po and always has_prices (a photographed PO shows prices),
 * so the database hides the row and the file from an engineer. The caller draws this for admin and sales only; `canAdd` is the
 * order's entry rule (somebody else's order, or a cancelled one, shows the files but offers no button).
 */
export const PO_FILE_ACCEPT = ['application/pdf', 'image/png', 'image/jpeg', 'image/heic', 'image/heif'] as const

export function CustomerPoFiles({ orderId, canAdd }: { orderId: string; canAdd: boolean }) {
  const { toast } = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [sending, setSending] = useState(false)
  const files = useOrderAttachments(orderId)
  const upload = useUploadAttachment(undefined, orderId)
  const pos = (files.data ?? []).filter(f => f.isCustomerPo)
  const urls = useFileUrls(
    orderId,
    pos.map(f => f.path),
  )

  const onPick = async (list: File[]) => {
    if (!list.length) return
    setSending(true)
    try {
      const taken = await intakeFiles(list, { accept: PO_FILE_ACCEPT })
      const bad = taken.filter(f => f.error)
      if (bad.length) toast({ title: bad.length === 1 ? 'A file was not added' : `${bad.length} files were not added`, body: bad.map(b => `${b.file.name}: ${b.error}`).join(' '), tone: 'danger' })
      let done = 0
      for (const f of taken.filter(t => !t.error)) {
        try {
          await upload.mutateAsync({ clarificationId: null, file: f.file, path: attachmentPath(orderId, crypto.randomUUID(), f.file.name, f.file.type), isCustomerPo: true })
          done++
        } catch (err) {
          toast({ title: `Could not add ${f.file.name}`, body: mapPgError(err, { entity: 'file' }).message, tone: 'danger' })
        }
      }
      if (done) toast({ title: done === 1 ? 'PO file added' : `${done} PO files added`, tone: 'success' })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-2 grid gap-2 text-base" data-slot="customer-po-files">
      {pos.length > 0 ? (
        <ul className="grid gap-1" aria-label="Customer PO files">
          {pos.map(f => (
            <li key={f.id} className="flex min-w-0 items-start gap-2">
              <span className="shrink-0 text-fg-2">PO file:</span>
              {urls.data?.[f.path] ? (
                <a href={urls.data[f.path]} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 items-start gap-2 rounded text-primary hover:underline">
                  <Icon icon={FileText} className="mt-[3px] shrink-0" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">{f.fileName}</span>
                </a>
              ) : (
                <span className="min-w-0 text-fg-2 [overflow-wrap:anywhere]">{f.fileName}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {canAdd ? (
        <div>
          <input
            ref={input}
            type="file"
            accept={PO_FILE_ACCEPT.join(',')}
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            data-testid="po-file-input"
            onChange={e => {
              const list = [...(e.target.files ?? [])]
              e.target.value = ''
              void onPick(list)
            }}
          />
          <Button size="touch" icon={Paperclip} className="text-base" busy={sending} busyLabel="Adding" onClick={() => input.current?.click()}>
            Attach PO file
          </Button>
        </div>
      ) : null}
    </div>
  )
}
