import { useEffect, useState } from 'react'
import { mapPgError } from '@/lib/pgErrors'
import type { AddedFile } from '@/lib/fileIntake'
import { Panel } from '@/features/companies/CompanyParts'
import { FileDrop } from '@/ui/form/FileDrop'
import { FileRow } from '@/ui/form/FileRow'
import { Skeleton } from '@/ui/Skeleton'
import { useToast } from '@/ui/useToast'
import { AttachmentItem } from '@/features/rfqs/FileBits'
import { recordOrderVisit } from '@/lib/capture/recents'
import { useFileUrls, useOrderAttachments, useRfqAttachments, useClarifications, useUploadAttachment } from '@/features/rfqs/hooks'
import { attachmentPath, RFQ_FILE_ACCEPT } from '@/features/rfqs/lib'

/*
 * Files on the RFQ, or on an order (R10, R22; DATA_MODEL 2.20, decision D). Drop, paste or choose: photos are shrunk in the browser, anything over
 * 5 MB or of another type is refused with the reason beside it (FileDrop and FileRow, U07), and HEIC photos are accepted.
 * Files go to the private rfq-files bucket at {rfq_id}/{uuid}.{ext}. Nothing is typed: the name is the file's own.
 *
 *   FE-2  add a file   drop, paste or 1 tap on Choose files. 0 typed. Required: the file. Nothing else.
 */

export function AttachmentsPanel({ rfqId, orderId }: { rfqId?: string; orderId?: string }) {
  // One panel for an RFQ's files and an order's files (R22): give it the RFQ, or the order.
  const parentId = (orderId ?? rfqId) as string
  const rfqAtts = useRfqAttachments(orderId ? undefined : rfqId)
  const orderAtts = useOrderAttachments(orderId)
  const atts = orderId ? orderAtts : rfqAtts
  const clars = useClarifications(orderId ? undefined : rfqId)
  const upload = useUploadAttachment(rfqId, orderId)
  const urls = useFileUrls(parentId, (atts.data ?? []).map(a => a.path))
  useEffect(() => {
    if (orderId) recordOrderVisit(orderId)
  }, [orderId])
  const { toast } = useToast()
  const [refused, setRefused] = useState<AddedFile[]>([])
  const [sending, setSending] = useState(0)

  const questionOf = new Map((clars.data ?? []).map(c => [c.id, c.question]))

  const onAdd = async (files: AddedFile[]) => {
    const bad = files.filter(f => f.error)
    const good = files.filter(f => !f.error)
    if (bad.length) {
      setRefused(r => [...r, ...bad])
      toast({ title: bad.length === 1 ? 'A file was not added' : `${bad.length} files were not added`, body: bad.map(b => `${b.file.name}: ${b.error}`).join(' '), tone: 'danger' })
    }
    if (!good.length) return
    setSending(n => n + good.length)
    let done = 0
    for (const f of good) {
      try {
        await upload.mutateAsync({ clarificationId: null, file: f.file, path: attachmentPath(parentId, crypto.randomUUID(), f.file.name, f.file.type) })
        done++
      } catch (err) {
        toast({ title: `Could not add ${f.file.name}`, body: mapPgError(err, { entity: 'file' }).message, tone: 'danger' })
      } finally {
        setSending(n => n - 1)
      }
    }
    if (done) toast({ title: done === 1 ? 'File added' : `${done} files added`, tone: 'success' })
  }

  const list = atts.data ?? []
  return (
    <Panel title="Files" meta={atts.isSuccess ? (list.length === 0 ? 'None yet' : `${list.length} ${list.length === 1 ? 'file' : 'files'}`) : undefined}>
      <div className="grid gap-3 p-4">
        <FileDrop onAdd={files => void onAdd(files)} accept={RFQ_FILE_ACCEPT} className="min-h-[132px] py-5" />
        <p role="status" aria-live="polite" className="text-xs text-fg-muted empty:hidden">
          {sending > 0 ? `Adding ${sending} ${sending === 1 ? 'file' : 'files'}` : ''}
        </p>
        {refused.length > 0 ? (
          <ul className="grid gap-2" aria-label="Files that were not added">
            {refused.map(r => (
              <li key={r.id}>
                <FileRow item={r} onRemove={() => setRefused(all => all.filter(x => x.id !== r.id))} />
              </li>
            ))}
          </ul>
        ) : null}
        {atts.isPending ? (
          <Skeleton className="h-12 w-full" />
        ) : atts.isError ? (
          <p className="text-sm text-fg-muted">
            Could not load the files.{' '}
            <button type="button" className="font-medium text-fg underline" onClick={() => void atts.refetch()}>
              Try again
            </button>
          </p>
        ) : list.length === 0 ? (
          <p className="text-sm text-fg-muted">{orderId ? 'No files yet. The customer’s PO or a photo from site goes here.' : 'No files yet. A nameplate photo or the customer’s enquiry PDF goes here, next to the questions.'}</p>
        ) : (
          <ul className="grid gap-2" aria-label={orderId ? 'Files on this order' : 'Files on this RFQ'}>
            {list.map(a => (
              <li key={a.id}>
                <AttachmentItem rfqId={rfqId} orderId={orderId} att={a} url={urls.data?.[a.path]} note={a.clarificationId ? `Photo answer${questionOf.get(a.clarificationId) ? `: ${questionOf.get(a.clarificationId)}` : ''}` : undefined} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  )
}
