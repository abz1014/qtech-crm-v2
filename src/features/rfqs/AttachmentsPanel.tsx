import { useEffect, useId, useState } from 'react'
import { useSeesPrices } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import type { AddedFile } from '@/lib/fileIntake'
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
 *   FE-2  add a file   drop, paste or 1 tap on Choose files (Add file). 0 typed. Required: the file. Nothing else.
 *
 * `slimWhenEmpty` (the Job page): the zone is one "Add file" row (grade-A 6 fix 2; mockup 26 keeps it slim with files too); drop and
 * paste still land on it, and the files list under it. A refused file brings the full zone back, with the reason beside it.
 */

export function AttachmentsPanel({
  rfqId,
  orderId,
  compact = false,
  slimWhenEmpty = false,
}: {
  rfqId?: string
  orderId?: string
  /** A shorter drop zone and one-line empty text, under a fold that already names the panel "Files" (the Job page). */
  compact?: boolean
  /** One "Add file" row instead of the zone (the Job page), with or without files; the zone comes back beside a refused file. */
  slimWhenEmpty?: boolean
}) {
  // One panel for an RFQ's files and an order's files (R22): give it the RFQ, or the order.
  const seesPrices = useSeesPrices()
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
  const headingId = useId()

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
  // One "Add file" row instead of the zone (26-job-questions-files .ff-slim), with or without files: drop and paste still land on it,
  // and the files list under it. No "No files yet" line when empty (the meta already says "None yet"). A refused file brings the zone back.
  const slim = slimWhenEmpty && atts.isSuccess && refused.length === 0
  return (
    // 26-job-questions-files .ff: no box of its own (it sits in a fold inside the step card, which already says "Files"): the count,
    // the drop zone (one "Add file" row while empty), then the file rows.
    <section aria-labelledby={headingId} className="grid w-full min-w-0 gap-3">
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={headingId} className={compact ? 'sr-only' : 'type-section'}>
          Files
        </h2>
        {atts.isSuccess ? (
          <span className="num text-sm text-fg-muted" data-testid="files-meta">
            {list.length === 0 ? 'None yet' : `${list.length} ${list.length === 1 ? 'file' : 'files'}`}
          </span>
        ) : null}
      </header>
      <div className="grid gap-3">
        <FileDrop onAdd={files => void onAdd(files)} accept={RFQ_FILE_ACCEPT} slim={slim} className={slim ? undefined : compact ? 'min-h-row py-3' : 'py-8'} />
        <p role="status" aria-live="polite" className="text-sm text-fg-muted empty:hidden">
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
          <div role="status" aria-busy="true" aria-label="Loading the files" className="grid gap-2">
            {/* Shaped like a file row: the thumbnail, the name and its size. */}
            <div className="flex items-center gap-3 rounded-control border p-2">
              <Skeleton className="size-10 shrink-0 rounded-control" />
              <div className="grid flex-1 gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-4 w-1/4" />
              </div>
            </div>
          </div>
        ) : atts.isError ? (
          <p className="text-sm text-fg-muted">
            Could not load the files.{' '}
            <button type="button" className="rounded-control font-semibold text-primary underline underline-offset-2 hover:text-primary-hover" onClick={() => void atts.refetch()}>
              Try again
            </button>
          </p>
        ) : slim ? null : list.length === 0 ? (
          <p className="text-sm text-fg-muted">{orderId ? (seesPrices ? "No files yet. The customer's PO or a photo from site goes here." : 'No files yet. A photo from site goes here.') : compact ? 'No files yet.' : "No files yet. A nameplate photo or the customer's RFQ PDF goes here, next to the questions."}</p>
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
    </section>
  )
}
