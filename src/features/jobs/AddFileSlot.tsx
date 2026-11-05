import { useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { RFQ_FILE_ACCEPT, attachmentPath } from '@/features/rfqs/lib'
import { useUploadAttachment } from '@/features/rfqs/hooks'
import { intakeFiles } from '@/lib/fileIntake'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { useToast } from '@/ui/useToast'
import type { JobSlotProps } from '@/features/jobs/slots'

/*
 * "Add file" in the Notes and files panel (slot 'files'): a file for this job, on its order or, before the order, on its enquiry.
 * Admin and sales only (an engineer has job.money false, so nothing is drawn). The customer PO document has its own button on the
 * Order stage ("Attach PO file"), which tags it so it stays hidden from engineers whatever its type.
 */
export default function AddFileSlot({ job }: JobSlotProps) {
  const { toast } = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [sending, setSending] = useState(false)
  const orderId = job.job.orderId ?? undefined
  const rfqId = job.job.rfqId ?? undefined
  const upload = useUploadAttachment(orderId ? undefined : rfqId, orderId)
  const parentId = orderId ?? rfqId
  if (!job.money || !parentId) return null
  const onPick = async (list: File[]) => {
    if (!list.length) return
    setSending(true)
    try {
      const taken = await intakeFiles(list, { accept: RFQ_FILE_ACCEPT })
      const bad = taken.filter(f => f.error)
      if (bad.length) toast({ title: bad.length === 1 ? 'A file was not added' : `${bad.length} files were not added`, body: bad.map(b => `${b.file.name}: ${b.error}`).join(' '), tone: 'danger' })
      let done = 0
      for (const f of taken.filter(t => !t.error)) {
        try {
          await upload.mutateAsync({ clarificationId: null, file: f.file, path: attachmentPath(parentId, crypto.randomUUID(), f.file.name, f.file.type) })
          done++
        } catch (err) {
          toast({ title: `Could not add ${f.file.name}`, body: mapPgError(err, { entity: 'file' }).message, tone: 'danger' })
        }
      }
      if (done) toast({ title: done === 1 ? 'File added' : `${done} files added`, tone: 'success' })
    } finally {
      setSending(false)
    }
  }
  return (
    <>
      <input
        ref={input}
        type="file"
        accept={RFQ_FILE_ACCEPT.join(',')}
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="job-file-input"
        onChange={e => {
          const list = [...(e.target.files ?? [])]
          e.target.value = ''
          void onPick(list)
        }}
      />
      <Button size="touch" variant="quiet" icon={Paperclip} className="text-base" busy={sending} busyLabel="Adding" onClick={() => input.current?.click()}>
        Add file
      </Button>
    </>
  )
}
