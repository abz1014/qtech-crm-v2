import { useRef, useState } from 'react'
import { Paperclip } from 'lucide-react'
import { businessToday } from '@/lib/dates'
import { intakeFiles } from '@/lib/fileIntake'
import { mapPgError } from '@/lib/pgErrors'
import { rfqRef } from '@/lib/refs'
import { Button } from '@/ui/Button'
import { useToast } from '@/ui/useToast'
import type { RfqHeader } from '@/features/rfqs/api'
import { useSetBidSent, useUploadAttachment } from '@/features/rfqs/hooks'
import { attachmentPath } from '@/features/rfqs/lib'

/** The quote documents we send: a PDF, a spreadsheet, a Word file or a photo of a printed one. */
export const QUOTE_ACCEPT = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'image/png',
  'image/jpeg',
] as const

/*
 * "Attach our quotation" (quote first, owner 24 Nov 2026): the quotation was made outside the CRM, so the file we sent the customer is
 * saved with the job's files (tagged with prices, so an engineer never sees it) and the quotation is marked sent today, the same
 * as More, Mark quotation sent. The job then waits for the customer's order. A second file only adds the file.
 */
export function AttachQuote({ rfq }: { rfq: RfqHeader }) {
  const { toast } = useToast()
  const input = useRef<HTMLInputElement>(null)
  const [sending, setSending] = useState(false)
  const upload = useUploadAttachment(rfq.id)
  const bid = useSetBidSent(rfq.id)
  const ref = rfqRef(rfq.number)

  const onPick = async (file: File | undefined) => {
    if (!file) return
    setSending(true)
    try {
      const [taken] = await intakeFiles([file], { accept: QUOTE_ACCEPT })
      if (!taken || taken.error) {
        toast({ title: 'The quotation was not attached', body: `${file.name}: ${taken?.error ?? 'it could not be read.'}`, tone: 'danger' })
        return
      }
      await upload.mutateAsync({ clarificationId: null, file: taken.file, path: attachmentPath(rfq.id, crypto.randomUUID(), taken.file.name, taken.file.type) })
      if (rfq.quotedOn) {
        toast({ title: 'Quotation attached', body: `${taken.file.name} · ${ref}`, tone: 'success' })
        return
      }
      await bid.mutateAsync(businessToday())
      toast({
        title: 'Quotation attached and marked sent',
        body: `${taken.file.name} · ${ref}`,
        undo: {
          onUndo: async () => {
            await bid.mutateAsync(null)
          },
          settledTitle: 'Quotation attached and marked sent',
          undoneTitle: 'Quotation kept in the files, not marked sent',
        },
      })
    } catch (err) {
      toast({ title: 'Could not attach the quotation', body: mapPgError(err, { entity: 'file' }).message, tone: 'danger' })
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      <input
        ref={input}
        type="file"
        accept={QUOTE_ACCEPT.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="attach-quote-input"
        onChange={e => {
          const f = e.target.files?.[0]
          e.target.value = ''
          void onPick(f)
        }}
      />
      <Button variant="secondary" icon={Paperclip} busy={sending} busyLabel="Attaching" onClick={() => input.current?.click()}>
        Attach our quotation
      </Button>
    </>
  )
}
