import { deadlinesFromRows, type GstDeadlines } from '@/features/settings/gstDeadlines'
import { PlainError } from '@/lib/pgErrors'
import { requireSupabase, unwrap } from '@/lib/supabase'

/* The GST deadline calls (0110), apart from settings/api.ts so Today's loader does not pull the whole Settings API into the first load. */

/** The pay-by and file-by days and the one-off dates. Admin and sales read them; an engineer is never asked (the database gives them nothing). */
export async function getGstDeadlines(): Promise<GstDeadlines> {
  const db = requireSupabase()
  const [s, o] = await Promise.all([
    db.from('gst_deadline_settings').select('pay_day, return_day').eq('id', 1).maybeSingle(),
    db.from('gst_deadline_overrides').select('month, pay_by, return_by').order('month', { ascending: false }),
  ])
  return deadlinesFromRows(unwrap(s), unwrap(o) ?? [])
}

export async function saveGstDays(payDay: number, returnDay: number): Promise<void> {
  // select() after update: a refused update affects no row and returns no error, which must not look like success.
  const rows = unwrap(await requireSupabase().from('gst_deadline_settings').update({ pay_day: payDay, return_day: returnDay }).eq('id', 1).select('id'))
  if (!rows || rows.length === 0) throw new PlainError('Only an admin can change the GST deadlines.')
}

/** Adds or replaces the one-off dates of one month's GST (`month` is "2026-10-01"). An empty date keeps the usual day. */
export async function saveGstOverride(v: { month: string; payBy: string | null; returnBy: string | null }): Promise<void> {
  const rows = unwrap(
    await requireSupabase().from('gst_deadline_overrides').upsert({ month: v.month, pay_by: v.payBy, return_by: v.returnBy }, { onConflict: 'month' }).select('month'),
  )
  if (!rows || rows.length === 0) throw new PlainError('Only an admin can change the GST deadlines.')
}

export async function deleteGstOverride(month: string): Promise<void> {
  const rows = unwrap(await requireSupabase().from('gst_deadline_overrides').delete().eq('month', month).select('month'))
  if (!rows || rows.length === 0) throw new PlainError('Only an admin can change the GST deadlines.')
}
