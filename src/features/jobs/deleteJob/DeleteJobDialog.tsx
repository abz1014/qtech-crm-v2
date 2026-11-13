import { useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { ListChecks } from 'lucide-react'
import { mapPgError } from '@/lib/pgErrors'
import { Button } from '@/ui/Button'
import { ConfirmDelete } from '@/ui/ConfirmDelete'
import { Dialog, DialogContent } from '@/ui/Dialog'
import { useToast } from '@/ui/useToast'
import { jobLabel } from '@/features/jobs/lib/listModel'
import { refreshAfterJobDelete, useDeleteJob, useJobDeleteBlockers } from '@/features/jobs/deleteJob/hooks'
import { blockerLine, blockerLink, guideIntro, guideOf, KEEP_TITLE, STEP_TITLE, type Blocker, type JobRef } from '@/features/jobs/deleteJob/model'

/*
 * Delete a job (migration 0132; owner request 2026-11-05: "if not, tell the steps that help delete the job without causing any issue").
 * Admin only (the menu item is not drawn for anyone else, and the database refuses them anyway). The dialog first asks the database
 * what stops the delete:
 *   nothing    the shared confirm (ConfirmDelete): what goes with the job, "This cannot be undone", Delete.
 *   something  a guide instead of Delete: "To do first" (numbered, each with a link to where it is cleared) and "These stay for the
 *              books" (a numbered invoice, a voided payment: never deleted, so the way out is Mark the job cancelled). Check again reads the
 *              database again; when nothing is left the dialog becomes the confirm.
 * Downloaded when an admin opens it, not with the job page (perf: LCP).
 */

export interface DeleteJobTarget extends JobRef {
  rfqId: string | null
  companyName: string
}

export default function DeleteJobDialog({ job, onClose, onCancelInstead }: { job: DeleteJobTarget; onClose: () => void; onCancelInstead?: () => void }) {
  const client = useQueryClient()
  const navigate = useNavigate()
  const { toast } = useToast()
  const del = useDeleteJob()
  const ids = { rfqId: job.rfqId, orderId: job.orderId }
  const blockers = useJobDeleteBlockers(ids)
  const label = jobLabel(job.key)

  const confirm = async () => {
    try {
      await del.mutateAsync(ids)
    } catch (e) {
      // the books moved since the dialog opened: read them again, so the guide appears
      if (mapPgError(e).hint === 'has_blockers') void blockers.refetch()
      throw e
    }
    // The rows are gone. Their files stay in storage for 30 days (migration 0120 lists them for the nightly purge).
    navigate('/jobs')
    void refreshAfterJobDelete(client, { ...ids, key: job.key })
    toast({ title: `${label} deleted`, body: job.companyName, tone: 'success' })
  }

  const list = blockers.data
  if (!list || blockers.isError || list.length === 0) {
    const also = [job.rfqId ? 'the RFQ and its items' : null, job.orderId || job.rfqId ? 'its orders and their lines' : null, 'its files'].filter((x): x is string => x !== null)
    return (
      <ConfirmDelete
        open
        onOpenChange={o => {
          if (!o) onClose()
        }}
        thing={label}
        summary={`${label} · ${job.companyName}`}
        also={list && !blockers.isError ? also : undefined}
        loading={blockers.isPending}
        blocked={blockers.isError ? 'Could not check what this job has. Reload the page and try again.' : null}
        onConfirm={confirm}
        errorMessage={e => (mapPgError(e).hint === 'has_blockers' ? 'Something new was recorded on this job. Read the steps and try again.' : mapPgError(e, { entity: 'job' }).message)}
      />
    )
  }
  return <Guide job={job} list={list} label={label} checking={blockers.isFetching} onCheck={() => void blockers.refetch()} onClose={onClose} onCancelInstead={onCancelInstead} />
}

function Guide({
  job,
  list,
  label,
  checking,
  onCheck,
  onClose,
  onCancelInstead,
}: {
  job: DeleteJobTarget
  list: Blocker[]
  label: string
  checking: boolean
  onCheck: () => void
  onClose: () => void
  onCancelInstead?: () => void
}) {
  const g = guideOf(list)
  const intro = guideIntro(g)
  return (
    <Dialog open onOpenChange={o => (o ? null : onClose())}>
      <DialogContent
        size="md"
        tone="danger"
        icon={ListChecks}
        title={g.mustCancel ? 'This job cannot be deleted' : 'This job cannot be deleted yet'}
        context={`${label} · ${job.companyName}`}
        footer={
          <>
            <Button data-cancel onClick={onClose}>
              Close
            </Button>
            {g.todo.length > 0 ? (
              <Button busy={checking} busyLabel="Checking" onClick={onCheck}>
                Check again
              </Button>
            ) : null}
            {onCancelInstead ? (
              <Button variant={g.mustCancel ? 'primary' : 'secondary'} onClick={onCancelInstead}>
                Mark the job cancelled
              </Button>
            ) : null}
          </>
        }
      >
        <div className="grid gap-4 text-base" data-slot="delete-guide">
          <p>{intro}</p>
          {g.todo.length > 0 ? (
            <section aria-labelledby="dj-todo" className="grid gap-2" data-slot="delete-todo">
              <h3 id="dj-todo" className="font-semibold">
                To do first
              </h3>
              <ol className="grid list-decimal gap-4 pl-6">
                {g.todo.map(b => (
                  <Step key={`${b.kind}-${b.refId}`} b={b} job={job} onClose={onClose} />
                ))}
              </ol>
            </section>
          ) : null}
          {g.keep.length > 0 ? (
            <section aria-labelledby="dj-keep" className="grid gap-2" data-slot="delete-keep">
              <h3 id="dj-keep" className="font-semibold">
                These stay for the books
              </h3>
              <ol className="grid list-decimal gap-2 pl-6">
                {g.keep.map(b => (
                  <li key={`${b.kind}-${b.refId}`}>
                    <span className="font-medium">{KEEP_TITLE[b.kind]}:</span> {blockerLine(b)}
                    {/* a numbered invoice: the heading already says it stays for the books */}
                    {b.kind === 'invoice' || !b.why ? null : <span className="block text-fg-muted">{b.why}</span>}
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function Step({ b, job, onClose }: { b: Blocker; job: JobRef; onClose: () => void }) {
  const link = blockerLink(b, job)
  return (
    <li>
      <span className="font-medium">{STEP_TITLE[b.kind]}:</span> {blockerLine(b)}
      <span className="block text-fg-muted">{b.why}</span>
      {link ? (
        <Link to={link.to} onClick={onClose} className="inline-flex min-h-touch items-center rounded font-medium text-primary underline-offset-4 hover:underline">
          {link.label}
        </Link>
      ) : null}
    </li>
  )
}
