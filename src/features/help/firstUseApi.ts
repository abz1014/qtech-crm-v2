import { requireSupabase } from '@/lib/supabase'

/*
 * "Has this person started yet?" (learnability spec 1.1). A new person is not an empty account: after the import the company
 * has data, but someone hired next month owns nothing. Five cheap head-counts over rows the business already keeps, each
 * readable by the role that asks (DATA_MODEL section 10). Nothing new is recorded. Read only when a list is already empty.
 */
export interface FirstUseFacts {
  /** Owns an RFQ, open or closed. */
  ownsRfq: boolean
  /** Owns an order. */
  ownsOrder: boolean
  /** Has been put on a job (order_engineers). */
  onJob: boolean
  /** The company has at least one invoice (admin and sales; engineers cannot read invoices, so false). */
  companyHasInvoice: boolean
  /** Admin only: the owner is still the only active person on the team. */
  ownerAlone: boolean
}

type Head = PromiseLike<{ count: number | null; error: { code?: string; message: string } | null }>

async function count(q: Head): Promise<number> {
  const { count: n, error } = await q
  if (error) throw error
  return n ?? 0
}

export async function fetchFirstUse(userId: string, role: string): Promise<FirstUseFacts> {
  const db = requireSupabase()
  const head = { count: 'exact', head: true } as const
  const admin = role === 'admin'
  const engineer = role === 'engineer'
  const [rfqs, orders, jobs, invoices, people] = await Promise.all([
    count(db.from('rfqs').select('id', head).eq('owner_id', userId)),
    count(db.from('orders').select('id', head).eq('owner_id', userId)),
    engineer ? count(db.from('order_engineers').select('order_id', head).eq('user_id', userId)) : Promise.resolve(0),
    engineer ? Promise.resolve(0) : count(db.from('invoices').select('id', head)),
    admin ? count(db.from('users').select('id', head).is('deactivated_at', null)) : Promise.resolve(2),
  ])
  return { ownsRfq: rfqs > 0, ownsOrder: orders > 0, onJob: jobs > 0, companyHasInvoice: invoices > 0, ownerAlone: admin && people <= 1 }
}

export type FirstUseScreenName = 'today' | 'rfqs' | 'orders'

/** Is this person new on this screen? Pure, so the rules can be read and tested apart from the reads. */
export function isNewOn(screen: FirstUseScreenName, role: string, f: FirstUseFacts): boolean {
  if (screen === 'rfqs') return !f.ownsRfq
  if (screen === 'orders') return role === 'engineer' ? !f.onJob : !f.ownsOrder
  if (role === 'engineer') return !f.onJob
  if (role === 'admin') return !f.companyHasInvoice || f.ownerAlone
  return !f.ownsRfq && !f.ownsOrder
}
