import { Suspense, useState, type ReactNode } from 'react'
import { useSession } from '@/app/session'
import { lazyWithReload } from '@/lib/importWithReload'
import type { DeleteJobTarget } from '@/features/jobs/deleteJob/DeleteJobDialog'

// The dialog (the guide, the confirm, the delete itself) is downloaded when an admin opens it (perf: the job page's LCP).
const DeleteJobDialog = lazyWithReload(() => import('@/features/jobs/deleteJob/DeleteJobDialog'))

/**
 * Delete a job (0132). `ask` is undefined for everyone but an admin, so the menu draws no item (the database refuses them anyway).
 * `onCancelInstead` is the order's own cancel flow; it is offered in the guide when the job has a live order.
 */
export function useDeleteJobFlow(job: DeleteJobTarget | null, onCancelInstead?: () => void) {
  const session = useSession()
  const isAdmin = job !== null && session.status === 'signed-in' && session.user.role === 'admin'
  const [open, setOpen] = useState(false)
  const node: ReactNode =
    isAdmin && open && job ? (
      <Suspense fallback={null}>
        <DeleteJobDialog
          job={job}
          onClose={() => setOpen(false)}
          onCancelInstead={
            onCancelInstead
              ? () => {
                  setOpen(false)
                  onCancelInstead()
                }
              : undefined
          }
        />
      </Suspense>
    ) : null
  return { ask: isAdmin ? () => setOpen(true) : undefined, node }
}
