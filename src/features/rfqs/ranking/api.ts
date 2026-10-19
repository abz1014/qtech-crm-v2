import { requireSupabase, unwrap } from '@/lib/supabase'
import type { RankRow } from '@/features/rfqs/lib/ranking/reasons'

/*
 * A8 (R25): the ranking of an RFQ's supplier quotes. One read, rank_item_quotes(rfq_id): every quote line with its PKR price at
 * today's rate, its rank, the reasons behind it and (admin and sales only; the database returns NULL for an engineer) the selling
 * price and the spread. This is the only place the app calls it. Rows come back ordered by item position, rank (unranked last),
 * supplier name.
 */
export async function rankItemQuotes(rfqId: string): Promise<RankRow[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.rpc('rank_item_quotes', { p_rfq_id: rfqId })) ?? []
  return rows as unknown as RankRow[]
}
