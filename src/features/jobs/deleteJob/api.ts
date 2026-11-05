import { requireSupabase, unwrap } from '@/lib/supabase'
import { toBlockers, type Blocker, type BlockerRow } from '@/features/jobs/deleteJob/model'

/* Delete a job (migration 0132): what stops it, and the delete itself. Admin only: the database refuses everyone else (42501). */

export interface JobIds {
  rfqId: string | null
  orderId: string | null
}

const args = (j: JobIds) => ({ ...(j.rfqId ? { p_rfq_id: j.rfqId } : {}), ...(j.orderId ? { p_order_id: j.orderId } : {}) })

/** job_delete_blockers: one row per thing that stops the delete, in the order to clear them. */
export async function getJobDeleteBlockers(j: JobIds): Promise<Blocker[]> {
  const rows = unwrap(await requireSupabase().rpc('job_delete_blockers', args(j))) ?? []
  return toBlockers(rows as unknown as BlockerRow[])
}

/** delete_job: the rows are gone when this resolves. The stored files stay for 30 days (migration 0120 lists them for the nightly purge). */
export async function deleteJob(j: JobIds): Promise<Array<{ bucket: string; path: string }>> {
  const rows = unwrap(await requireSupabase().rpc('delete_job', args(j))) ?? []
  return rows.map(r => ({ bucket: r.storage_bucket, path: r.storage_path }))
}
