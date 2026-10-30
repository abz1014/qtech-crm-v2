import { useState } from 'react'
import { Ellipsis, Trash2 } from 'lucide-react'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { MenuItem, MenuSeparator, Popover, PopoverContent, PopoverTrigger } from '@/ui/Popover'
import { useToast } from '@/ui/useToast'
import { useHistoryPanel } from '@/features/history/useHistoryPanel'
import { useDeleteQuotationRevision } from '@/features/quotations/hooks'

/*
 * The "…" on a quotation revision's row: History (W7) and, for an admin on the LATEST revision only, Delete revision (W12a,
 * 0092 delete_quotation_revision; issued quotations stay "revise only", so an older revision cannot be deleted). The confirm
 * says the RFQ's quotation date goes back to the revision before (or to none), and the PDF is removed from storage afterwards.
 */
export function RevisionMenu({
  rfqId,
  quotationId,
  revision,
  hasPdf,
  latest,
  only,
  label,
  context,
}: {
  rfqId: string
  quotationId: string
  revision: number
  hasPdf: boolean
  /** The newest revision: the only one that can be deleted. */
  latest: boolean
  /** The RFQ has no other revision: deleting it leaves the RFQ with no quotation. */
  only: boolean
  label: string
  context: string
}) {
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const history = useHistoryPanel({ table: 'quotations', id: quotationId, context })
  const [deleting, setDeleting] = useState(false)
  const canDelete = isAdmin && latest
  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button size="sm" variant="quiet" icon={Ellipsis} aria-label={`More for ${label}`} aria-haspopup="menu" />
        </PopoverTrigger>
        <PopoverContent variant="menu" align="end" aria-label={`More for ${label}`}>
          {history.item}
          {canDelete ? (
            <>
              <MenuSeparator />
              <MenuItem icon={Trash2} danger onClick={() => setDeleting(true)}>
                Delete revision
              </MenuItem>
            </>
          ) : null}
        </PopoverContent>
      </Popover>
      {history.node}
      {deleting ? <DeleteRevisionConfirm rfqId={rfqId} quotationId={quotationId} label={label} revision={revision} hasPdf={hasPdf} only={only} onClose={() => setDeleting(false)} /> : null}
    </>
  )
}

function DeleteRevisionConfirm({
  rfqId,
  quotationId,
  label,
  revision,
  hasPdf,
  only,
  onClose,
}: {
  rfqId: string
  quotationId: string
  label: string
  revision: number
  hasPdf: boolean
  only: boolean
  onClose: () => void
}) {
  const { toast } = useToast()
  const del = useDeleteQuotationRevision(rfqId)
  return (
    <ConfirmDelete
      open
      onOpenChange={o => {
        if (!o) onClose()
      }}
      thing={label}
      summary={
        only
          ? 'This is the only revision, so the RFQ goes back to having no quotation issued.'
          : `The RFQ's quotation date goes back to revision ${revision - 1}. Earlier revisions are not changed.`
      }
      also={hasPdf ? ['its PDF'] : undefined}
      onConfirm={async () => {
        await del.mutateAsync(quotationId)
        toast({ title: `${label} deleted`, tone: 'success' })
      }}
      errorMessage={e => mapPgError(e, { entity: 'quotation' }).message}
    />
  )
}
