import { requireSupabase, unwrap } from '@/lib/supabase'
import { toChallan, type ChallanRow } from '@/features/orders/challans/model'

/* Every database call for delivery challans (migration 0131). The number is the database's to give (create_delivery_challan). */

const COLS = 'id, order_id, number, issued_on, deliver_to, notes, lines'

export async function listChallans(orderId: string): Promise<ChallanRow[]> {
  const rows = unwrap(await requireSupabase().from('delivery_challans').select(COLS).eq('order_id', orderId).order('number')) ?? []
  return rows.map(toChallan)
}

export async function createChallan(input: { orderId: string; lines: Array<{ item_id: string; qty: number }>; deliverTo: string; notes?: string }): Promise<ChallanRow> {
  const { data, error } = await requireSupabase().rpc('create_delivery_challan', {
    p_order_id: input.orderId,
    p_lines: input.lines,
    ...(input.deliverTo.trim() ? { p_deliver_to: input.deliverTo } : {}),
    ...(input.notes?.trim() ? { p_notes: input.notes } : {}),
  })
  if (error) throw error
  const r = data as unknown as { id: string; order_id: string; number: string; issued_on: string; deliver_to: string | null; notes: string | null; lines: unknown }
  return toChallan(r)
}
