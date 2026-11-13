import { MessageSquareReply } from 'lucide-react'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { FindSupplier, type FoundSupplier } from '@/features/rfqs/FindSupplier'

/*
 * "Enter reply from another supplier": a supplier replied who was not asked from here (the owner's WhatsApp, a call). Find the
 * company, or add it as a new supplier; the page records it as asked today and opens its reply dialog. Prices only, so this is
 * for people who see prices; the caller never offers it to an engineer.
 */
export function ReplyFromOther({ excludeIds, busy, onPick, onClose }: { excludeIds?: ReadonlySet<string>; busy: boolean; onPick: (s: FoundSupplier) => void; onClose: () => void }) {
  return (
    <Dialog open busy={busy} onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        title="Enter reply from another supplier"
        context="Recorded as asked today, then the reply form opens"
        icon={MessageSquareReply}
        footer={
          <Button data-cancel onClick={onClose} disabled={busy}>
            Cancel
          </Button>
        }
      >
        <FindSupplier excludeIds={excludeIds} onPick={onPick} autoFocus />
      </DialogContent>
    </Dialog>
  )
}
