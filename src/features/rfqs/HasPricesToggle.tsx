import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { Checkbox } from '@/ui/form/Checkbox'
import { useToast } from '@/ui/useToast'
import type { AttachmentRow } from '@/features/rfqs/api'
import { useSetAttachmentHasPrices } from '@/features/rfqs/hooks'

/*
 * "Has prices: hide from engineers" (migration 0100, redesign P5-E-UI): the admin's switch on a file row. A file tagged this way is
 * invisible to engineers (the database hides the row and the file). New files are tagged by the upload itself (attachmentHasPrices:
 * the customer's PO, a supplier's quote and enquiry files true; a site photo or an engineer's file false); this corrects a mistake
 * either way. Admin only: sales tag at upload, and an engineer can never tag.
 */
export function HasPricesToggle({ att, rfqId, orderId }: { att: Pick<AttachmentRow, 'id' | 'fileName' | 'hasPrices'>; rfqId?: string; orderId?: string }) {
  const session = useSession()
  const set = useSetAttachmentHasPrices(rfqId, orderId)
  const { toast } = useToast()
  if (session.status !== 'signed-in' || session.user.role !== 'admin') return null
  const change = async (hasPrices: boolean) => {
    try {
      await set.mutateAsync({ id: att.id, hasPrices })
      toast({ title: hasPrices ? 'Hidden from engineers' : 'Engineers can see this file', body: att.fileName, tone: 'success' })
    } catch (err) {
      toast({ title: 'Could not change the file', body: mapPgError(err, { entity: 'file' }).message, tone: 'danger' })
    }
  }
  return <Checkbox label="Has prices: hide from engineers" checked={att.hasPrices} disabled={set.isPending} onCheckedChange={v => void change(v === true)} className="px-1" />
}
