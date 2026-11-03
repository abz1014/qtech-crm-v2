import { requireSupabase, unwrap } from '@/lib/supabase'
import type { TableUpdate } from '@/features/dbTypes'
import { draftPatch, sortVisits, toVisit, type VisitDraft, type VisitRow } from '@/features/orders/visits/model'

/* Every database call for the visits of an order (migration 0130). Row Level Security decides who may write; this file only asks. */

const COLS = 'id, order_id, visit_type, visit_on, engineer_id, notes, done_on'

export async function listVisits(orderId: string): Promise<VisitRow[]> {
  const db = requireSupabase()
  const rows = unwrap(await db.from('order_visits').select(COLS).eq('order_id', orderId)) ?? []
  const ids = [...new Set(rows.map(r => r.engineer_id).filter((x): x is string => !!x))]
  const names = new Map<string, string>()
  if (ids.length > 0) for (const u of unwrap(await db.from('users').select('id, name').in('id', ids)) ?? []) names.set(u.id, u.name)
  return sortVisits(rows.map(r => toVisit(r, names)))
}

export async function createVisit(orderId: string, draft: VisitDraft): Promise<void> {
  const { error } = await requireSupabase().from('order_visits').insert({ order_id: orderId, ...draftPatch(draft) })
  if (error) throw error
}

export async function updateVisit(id: string, patch: TableUpdate<'order_visits'>): Promise<void> {
  const { error } = await requireSupabase().from('order_visits').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteVisit(id: string): Promise<void> {
  const { error } = await requireSupabase().from('order_visits').delete().eq('id', id)
  if (error) throw error
}
