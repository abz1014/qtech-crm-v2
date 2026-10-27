import { useQuery } from '@tanstack/react-query'
import { qk } from '@/features/queryKeys'
import { requireSupabase, unwrap } from '@/lib/supabase'

/*
 * The orders an RFQ has produced, apart from orders/api.ts and orders/hooks.ts (which are the whole order side): the RFQ page asks this
 * on its first screen and should not download the order page's reads for it (perf: LCP). api.ts and hooks.ts re-export it.
 */
export interface RfqOrderRow {
  id: string
  number: number
  cancelledOn: string | null
}

/** The orders an RFQ has produced (one RFQ may produce several). */
export async function listOrdersForRfq(rfqId: string): Promise<RfqOrderRow[]> {
  const rows = unwrap(await requireSupabase().from('orders').select('id, number, cancelled_on').eq('rfq_id', rfqId).order('number'))
  return rows.map(r => ({ id: r.id, number: r.number, cancelledOn: r.cancelled_on }))
}

export function useOrdersForRfq(rfqId: string | undefined) {
  return useQuery({ queryKey: qk.orders.forRfq(rfqId ?? ''), queryFn: () => listOrdersForRfq(rfqId as string), enabled: Boolean(rfqId) })
}
