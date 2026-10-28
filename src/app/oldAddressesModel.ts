import { requireSupabase } from '@/lib/supabase'

/* The pure parts of the old-address redirects (oldAddresses.tsx): which chip a list asks for, the remembered choice, the Job lookup. */
export type OldKind = 'rfq' | 'order'

/** localStorage: "show the old RFQ and Order pages on this device" (set by ?old=1, cleared by ?old=0). Storage may be refused: then ?old=1 works per visit. */
export const OLD_PAGES_KEY = 'qtech.old-pages'

export function wantsOld(search: string): boolean {
  const asked = new URLSearchParams(search).get('old')
  try {
    if (asked === '1') window.localStorage.setItem(OLD_PAGES_KEY, '1')
    else if (asked === '0') window.localStorage.removeItem(OLD_PAGES_KEY)
    else return window.localStorage.getItem(OLD_PAGES_KEY) === '1'
  } catch {
    return asked === '1'
  }
  return asked === '1'
}

/** The Jobs list chip an old list address asks for: its closed or history views are History, "mine" is Mine, the rest the default. */
export function chipForOldList(search: string): 'mine' | 'history' | null {
  const p = new URLSearchParams(search)
  const show = p.get('show') ?? (p.get('tab') === 'closed' ? 'closed' : null)
  if (show && ['closed', 'history', 'cancelled', 'settled', 'paid'].includes(show)) return 'history'
  if (p.get('owner') === 'mine') return 'mine'
  return null
}

/**
 * The Jobs list query string for an old list address: the chip it asks for, and every other parameter kept (new=1 opens the new-order
 * dialog, q is the search text). The old list's own filters (show, tab, owner) and the ?old switch are consumed here.
 */
export function jobsSearchForOldList(search: string): string {
  const chip = chipForOldList(search)
  const next = new URLSearchParams(search)
  for (const k of ['show', 'tab', 'owner', 'old', 'chip']) next.delete(k)
  if (chip) next.set('chip', chip)
  const out = next.toString()
  return out ? `?${out}` : ''
}

/** The Job key for an RFQ or order id, or null when there is none (an address that never existed). */
export async function jobKeyFor(kind: OldKind, id: string): Promise<string | null> {
  const db = requireSupabase()
  let rfqId: string | null = kind === 'rfq' ? id : null
  if (kind === 'order') {
    const byOrder = await db.from('v_jobs').select('job_key').eq('order_id', id).limit(1)
    if (byOrder.error) throw byOrder.error
    if (byOrder.data?.[0]?.job_key) return byOrder.data[0].job_key
    // a cancelled order is not in the view's live-order column: its RFQ still has the job
    const order = await db.from('orders').select('rfq_id').eq('id', id).limit(1)
    if (order.error) throw order.error
    rfqId = order.data?.[0]?.rfq_id ?? null
    if (!rfqId) return null
  }
  const byRfq = await db.from('v_jobs').select('job_key').eq('rfq_id', rfqId as string).limit(1)
  if (byRfq.error) throw byRfq.error
  return byRfq.data?.[0]?.job_key ?? null
}

