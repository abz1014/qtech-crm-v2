import { useState } from 'react'
import { ExternalLink, FileText, Image as ImageIcon, Trash2 } from 'lucide-react'
import { formatBytes } from '@/lib/fileIntake'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { buttonStyles } from '@/ui/buttonStyles'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { Icon } from '@/ui/Icon'
import { useToast } from '@/ui/useToast'
import type { AttachmentRow } from '@/features/rfqs/api'
import { useDeleteAttachment } from '@/features/rfqs/hooks'
import { HasPricesToggle } from '@/features/rfqs/HasPricesToggle'
import { canPreview } from '@/features/rfqs/lib'

/*
 * One file on an RFQ (R10), as it appears in the Files panel and under a photo answer (26-job-questions-files .qb-file): a square
 * thumbnail, the whole name (it wraps), the size, and what it is. An image opens in a lightbox; a PDF (or a photo the browser cannot
 * show, such as HEIC) opens in a new tab. Delete asks once, because a file cannot be brought back.
 */

const isImage = (mime: string) => mime.startsWith('image/')

export function AttachmentItem({ rfqId, orderId, att, url, note, removable = true }: { rfqId?: string; orderId?: string; att: AttachmentRow; url: string | undefined; note?: string; removable?: boolean }) {
  const [viewing, setViewing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [broken, setBroken] = useState(false)
  const del = useDeleteAttachment(rfqId, orderId)
  const { toast } = useToast()
  const previewable = canPreview(att.mimeType)

  const thumb = (
    <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-control bg-brand-100 text-brand-700">
      {url && previewable && !broken ? (
        <img src={url} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover" />
      ) : (
        <Icon icon={isImage(att.mimeType) ? ImageIcon : FileText} size="lg" />
      )}
    </span>
  )

  const openClass = 'group/open flex min-w-0 flex-1 items-center gap-3 rounded-control text-left'
  // The whole name wraps, never cut (live bug 6); the title still carries it for a pointer.
  const text = (
    <span className="grid min-w-0">
      <b title={att.fileName} className="break-words text-sm font-semibold text-fg [overflow-wrap:anywhere] group-hover/open:underline">{att.fileName}</b>
      <span className="num break-words text-sm text-fg-muted">{[formatBytes(att.sizeBytes), note].filter(Boolean).join(' · ')}</span>
    </span>
  )

  const remove = async () => {
    try {
      await del.mutateAsync({ id: att.id, path: att.path })
      setConfirming(false)
      toast({ title: 'File deleted', body: att.fileName, tone: 'success' })
    } catch (err) {
      toast({ title: 'Could not delete the file', body: mapPgError(err).message, tone: 'danger' })
    }
  }

  return (
    <div className="grid gap-1">
    <div className="flex min-h-row min-w-0 items-center gap-2 rounded-control border bg-surface py-2 pl-2 pr-1 transition-colors duration-fast hover:border-line-strong">
      {previewable ? (
        <button type="button" className={openClass} onClick={() => setViewing(true)}>
          {thumb}
          {text}
        </button>
      ) : url ? (
        <a className={openClass} href={url} target="_blank" rel="noopener noreferrer">
          {thumb}
          {text}
        </a>
      ) : (
        <span className={openClass}>
          {thumb}
          {text}
        </span>
      )}
      {removable ? (
        <Button variant="quiet" size="sm" icon={Trash2} aria-label={`Delete ${att.fileName}`} onClick={() => setConfirming(true)} className="text-fg-muted" />
      ) : null}

      <Dialog open={viewing} onOpenChange={setViewing}>
        <DialogContent
          title={att.fileName}
          context={`${formatBytes(att.sizeBytes)}${note ? ` · ${note}` : ''}`}
          size="lg"
          footer={
            <>
              {url ? (
                <a href={url} target="_blank" rel="noopener noreferrer" className={buttonStyles({ variant: 'secondary' })}>
                  <Icon icon={ExternalLink} />
                  Open in a new tab
                </a>
              ) : null}
              <Button data-cancel onClick={() => setViewing(false)}>
                Close
              </Button>
            </>
          }
        >
          {url ? (
            <img src={url} alt={att.fileName} className="mx-auto max-h-[70dvh] max-w-full rounded-control object-contain" />
          ) : (
            <div className="grid place-items-center gap-2 rounded-control bg-deep px-4 py-10 text-center text-sm text-fg-muted">
              <Icon icon={ImageIcon} size="lg" />
              <p>The picture is not available right now. Try again in a moment.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={confirming} onOpenChange={setConfirming} busy={del.isPending}>
        <DialogContent
          title="Delete this file?"
          context={att.fileName}
          icon={Trash2}
          tone="danger"
          size="sm"
          footer={
            <>
              <Button data-cancel onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void remove()} busy={del.isPending} busyLabel="Deleting">
                Delete file
              </Button>
            </>
          }
        >
          <p className="text-sm text-fg-2">{orderId ? 'It is removed from this order and cannot be brought back.' : 'It is removed from this RFQ and cannot be brought back. A question it answered stays answered.'}</p>
        </DialogContent>
      </Dialog>
    </div>
    <HasPricesToggle att={att} rfqId={rfqId} orderId={orderId} />
    </div>
  )
}
