import { useState } from 'react'
import { Archive } from 'lucide-react'
import { useSession } from '@/app/session'
import { mapPgError } from '@/lib/pgErrors'
import { formatDateText } from '@/lib/dateInput'
import { Banner } from '@/ui/Banner'
import { Button } from '@/ui/Button'
import { Dialog, DialogContent } from '@/ui/Dialog'
import type { ArchiveEntity } from '@/features/archive/api'
import { useArchiveState, useUnhideRecord } from '@/features/archive/hooks'

/** "In Archive" strip for the top of a detail page. Nothing at all unless the record is archived; only an admin can bring it back. */
export function ArchiveBanner({ entity, id }: { entity: ArchiveEntity; id: string | null | undefined }) {
  const state = useArchiveState(entity, id)
  const session = useSession()
  const isAdmin = session.status === 'signed-in' && session.user.role === 'admin'
  const unhide = useUnhideRecord()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!id || !state.data?.archived) return null
  const date = formatDateText(state.data.cutoff)
  const text = `This is in the Archive${date ? ` (dated before ${date})` : ''}. It still counts in all totals.`
  const run = async () => {
    setError(null)
    try {
      await unhide.mutateAsync({ entity, id })
      setOpen(false)
    } catch (e) {
      setError(mapPgError(e).message)
    }
  }
  return (
    <>
      <Banner
        icon={Archive}
        className="mb-4"
        title="In Archive"
        action={isAdmin ? <Button onClick={() => setOpen(true)}>Unarchive</Button> : undefined}
      >
        {text}
      </Banner>
      {isAdmin ? (
        <Dialog open={open} onOpenChange={o => !unhide.isPending && setOpen(o)} busy={unhide.isPending}>
          <DialogContent
            title="Unarchive this record?"
            icon={Archive}
            size="sm"
            footer={
              <>
                <Button size="lg" data-cancel onClick={() => setOpen(false)} disabled={unhide.isPending}>
                  Cancel
                </Button>
                <Button size="lg" variant="primary" onClick={() => void run()} busy={unhide.isPending} busyLabel="Unarchiving">
                  Unarchive
                </Button>
              </>
            }
          >
            <p>It will show in the normal lists again.</p>
            {error ? <p role="alert" className="mt-2 text-tone-danger-fg">{error}</p> : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
