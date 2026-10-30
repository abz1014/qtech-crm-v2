import { requireSupabase, unwrap } from '@/lib/supabase'

/*
 * Reassign owner (process audit 1, migration 0122). Admin only (the functions refuse anyone else). One at a time (an enquiry, a job, an
 * order) or "move all of X's open work to Y". Past credit toward targets stays; payments recorded after the move credit the new owner.
 */
export type OwnedKind = 'rfq' | 'order' | 'job'

export interface OwnerCandidate {
  id: string
  name: string
  role: string
}

export interface OpenWork {
  rfqs: number
  orders: number
}

/** Who can take work over: current admins and salespeople. */
export async function listOwnerCandidates(): Promise<OwnerCandidate[]> {
  const rows = unwrap(await requireSupabase().from('users').select('id, name, role').in('role', ['admin', 'sales']).is('deactivated_at', null).order('name'))
  return rows.map(u => ({ id: u.id, name: u.name, role: u.role }))
}

export async function reassignOwner(kind: OwnedKind, id: string, to: string): Promise<void> {
  const { error } = await requireSupabase().rpc('reassign_owner', { p_kind: kind, p_id: id, p_to: to })
  if (error) throw error
}

export async function openWorkOf(userId: string): Promise<OpenWork> {
  const rows = unwrap(await requireSupabase().rpc('open_work_of', { p_user: userId }))
  const r = rows?.[0]
  return { rfqs: Number(r?.rfqs ?? 0), orders: Number(r?.orders ?? 0) }
}

export async function reassignOpenWork(from: string, to: string): Promise<OpenWork> {
  const rows = unwrap(await requireSupabase().rpc('reassign_open_work', { p_from: from, p_to: to }))
  const r = rows?.[0]
  return { rfqs: Number(r?.rfqs ?? 0), orders: Number(r?.orders ?? 0) }
}

export const workSentence = (w: OpenWork): string => {
  const parts = [w.rfqs ? `${w.rfqs} open ${w.rfqs === 1 ? 'enquiry' : 'enquiries'}` : '', w.orders ? `${w.orders} live ${w.orders === 1 ? 'order' : 'orders'}` : ''].filter(Boolean)
  return parts.length ? parts.join(' and ') : 'no open work'
}
